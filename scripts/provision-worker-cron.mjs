import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

// Explicit administrative operation. Secrets travel only through child-process
// stdin and memory, never argv, files, stdout or exception diagnostics.
const project = process.argv[2];
const resume = process.argv[3] === '--resume';
const rotate = process.argv[3] === '--rotate';
if (!/^[a-z0-9]{20}$/.test(project ?? '')) {
  console.error('Usage: node scripts/provision-worker-cron.mjs <project-ref> [--resume|--rotate]');
  process.exit(1);
}
let stage = 'preflight';
function cli(args, input) {
  return execFileSync('supabase', args, {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}
function sql(query) {
  return JSON.parse(cli(['db', 'query', '--linked', '--project-ref', project,
    '--file', '/dev/stdin', '--output', 'json'], query)).rows;
}
function metadata() {
  return JSON.parse(cli(['secrets', 'list', '--project-ref', project, '--output', 'json']));
}
const definitions = [
  { vault: 'chat_push_cron_token', edge: 'PUSH_CRON_TOKEN' },
  { vault: 'chat_media_cron_token', edge: 'MEDIA_CLEANUP_CRON_TOKEN' },
];
const urlName = 'chat_cron_project_url';
const names = [...definitions.map((d) => d.vault), urlName];
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const hash = (value) => createHash('sha256').update(value).digest('hex');

try {
  const before = metadata();
  const records = sql(`select name, decrypted_secret as value from vault.decrypted_secrets
    where name in (${names.map(literal).join(',')});`);
  if (!Array.isArray(records)) throw new Error();
  const found = new Map(records.map((row) => [row.name, row.value]));
  if (records.length && ((!resume && !rotate) || records.length !== names.length)) throw new Error();
  if (rotate && records.length !== names.length) throw new Error();
  if (!records.length && before.some((row) => definitions.some((d) => d.edge === row.name))) throw new Error();

  const values = records.length ? found : new Map([
    ...definitions.map((d) => [d.vault, randomBytes(32).toString('hex')]),
    [urlName, `https://${project}.supabase.co`],
  ]);
  if (values.get(urlName) !== `https://${project}.supabase.co` ||
      definitions.some((d) => !/^[0-9a-f]{64}$/.test(values.get(d.vault) ?? ''))) throw new Error();
  // Resuming may restore a missing Edge secret, but never overwrites a different one.
  for (const definition of definitions) {
    const existing = before.find((row) => row.name === definition.edge);
    if (!rotate && existing && existing.value !== hash(values.get(definition.vault))) throw new Error();
  }

  if (rotate) {
    stage = 'dedicated Cron credential rotation';
    for (const definition of definitions) values.set(definition.vault, randomBytes(32).toString('hex'));
    sql(`begin; ${definitions.map((d) => `select vault.update_secret(
      (select id from vault.secrets where name=${literal(d.vault)}),
      ${literal(values.get(d.vault))});`).join('\n')} commit;`);
  }
  if (!records.length) {
    stage = 'Vault provisioning';
    sql(`begin; ${names.map((name) => `select vault.create_secret(
      ${literal(values.get(name))}, ${literal(name)}, 'Dedicated chat Cron configuration');`).join('\n')} commit;`);
  }
  stage = 'Edge Secret provisioning';
  cli(['secrets', 'set', '--project-ref', project, '--env-file', '/dev/stdin'],
    definitions.map((d) => `${d.edge}=${values.get(d.vault)}`).join('\n') + '\n');
  stage = 'verification';
  const after = metadata();
  const oldUnchanged = before.filter((row) => !definitions.some((d) => d.edge === row.name))
    .every((row) => after.some((current) => current.name === row.name && current.value === row.value));
  const newMatch = definitions.every((d) => after.some((row) => row.name === d.edge && row.value === hash(values.get(d.vault))));
  if (!oldUnchanged || !newMatch) throw new Error();
  console.log(JSON.stringify({ provisioned: true, oldSecretsUnchanged: true,
    edgeSecretsMatchVault: true, credentialsPrinted: false,
    firebaseConfigured: after.some((row) => row.name === 'FIREBASE_SERVICE_ACCOUNT_JSON') }));
} catch {
  console.error(`Cron provisioning stopped during ${stage}. No secret diagnostics printed. Inspect names/digests only; use --resume after an uncertain outcome.`);
  process.exitCode = 1;
}
