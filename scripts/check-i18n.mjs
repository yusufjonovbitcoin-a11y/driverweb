import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const localeNames = ['uz', 'ru', 'en'];
const localeDir = path.join(root, 'src/i18n/resources');

function flatten(value, prefix = '', output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, fullKey, output);
    } else {
      output.set(fullKey, Array.isArray(child) ? 'array' : typeof child);
    }
  }
  return output;
}

const catalogs = Object.fromEntries(await Promise.all(localeNames.map(async (locale) => {
  const contents = await readFile(path.join(localeDir, `${locale}.json`), 'utf8');
  return [locale, JSON.parse(contents)];
})));

const baseline = flatten(catalogs.uz);
for (const locale of localeNames.slice(1)) {
  const candidate = flatten(catalogs[locale]);
  assert.deepEqual([...candidate.keys()].sort(), [...baseline.keys()].sort(), `${locale}.json keys differ from uz.json`);
  for (const [key, type] of baseline) {
    assert.equal(candidate.get(key), type, `${locale}.json has a different value type at ${key}`);
  }
}

const componentDir = path.join(root, 'src/components');
const sourcePaths = [
  path.join(root, 'src/App.jsx'),
  path.join(root, 'src/utils/globalSearch.js'),
  ...(await readdir(componentDir)).filter((name) => name.endsWith('.jsx')).map((name) => path.join(componentDir, name)),
];
const namespaces = 'common|nav|header|auth|profile|loads|loadStatus|drivers|driverStatus|documents|inbox|ingestionStatus|chat|map|search|roles|admin|errors|toasts|missingFields|warningCodes|accountStatus|driverInstructions';
const keyPattern = new RegExp(`["']((?:${namespaces})\\.[A-Za-z0-9_.-]+)["']`, 'g');
const referenced = new Set();
for (const sourcePath of sourcePaths) {
  // Workspace view persistence keys intentionally share names such as map.*;
  // they are storage identifiers, not user-visible translation references.
  const source = (await readFile(sourcePath, 'utf8'))
    .replace(/useWorkspaceView\(\s*(["'])[^"']+\1/g, 'useWorkspaceView(');
  for (const match of source.matchAll(keyPattern)) referenced.add(match[1]);
}
const missing = [...referenced].filter((key) => !baseline.has(key)).sort();
assert.deepEqual(missing, [], `Missing Uzbek catalog keys: ${missing.join(', ')}`);

const forbiddenSource = {
  'src/components/DispatchChat.jsx': [
    "? 'Onlayn' : 'Oflayn'",
    "image: 'Rasmlar'",
    "'Eski xabarlarni yuklash'",
    'label="Kiruvchi qo‘ng‘iroq"',
    'label="Faol qo‘ng‘iroq"',
    "callDriver?.name || 'Haydovchi'",
    'profil surati`',
    'Xabarni ikkala tomondan o‘chirasizmi?',
  ],
  'src/components/CreateLoadModal.jsx': [
    'Haydovchilar · {selectedIds.length} tanlandi',
    "'Tanlovni tozalash'",
    "'Barchasini tanlash'",
  ],
  'src/services/operationsService.js': [
    'Vaqt belgilanmagan',
    "Broker ko\\'rsatilmagan",
    'Yuk tavsifi kiritilmagan',
    "'Oflayn'",
    'Texnika kiritilmagan',
    'Treyler kiritilmagan',
    'formatDateTime(',
    'formatTime(',
    "broker_name: proposal.broker || 'Broker aniqlanmadi'",
    "cargo_description: proposal.commodity || 'Yuk tavsifi aniqlanmadi'",
    "equipment_type: proposal.equipment || 'Aniqlanmadi'",
    'message: `AI hujjatdan ${field} maydonini aniq topa olmadi.`',
  ],
  'src/components/KanbanBoard.jsx': [
    '+ Surat/PDF yoki Ctrl+V (AI)',
    '>Invoys<',
  ],
  'src/components/BrokerInbox.jsx': [
    "|| 'Noma’lum'",
  ],
  'src/components/DocumentViewerModal.jsx': [
    'warning.message',
    'Rate Confirmation (Shartnoma)',
    "title: 'Broker Rate Con'",
    "title: 'Shipper BOL'",
    "title: 'Receiver POD'",
  ],
  'src/components/ProfileView.jsx': [
    'Gmail manzilini to‘g‘ri kiriting.',
    'App Password 16 ta belgidan iborat bo‘lishi kerak.',
    'Gmail integratsiyasini uzasizmi?',
    '>Email *<',
  ],
  'src/components/QuickDriverModal.jsx': [
    '} pallet</span>',
  ],
  'src/components/PlatformAdminPanel.jsx': [
    '{company.status}',
  ],
};
for (const [relativePath, forbiddenValues] of Object.entries(forbiddenSource)) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  for (const value of forbiddenValues) {
    assert.equal(source.includes(value), false, `${relativePath} contains raw presentation text: ${value}`);
  }
}

const inboxSource = await readFile(path.join(root, 'src/components/BrokerInbox.jsx'), 'utf8');
assert.equal(inboxSource.includes('<span>{selected.error_message}</span>'), false, 'BrokerInbox renders a raw provider error');
const profileSource = await readFile(path.join(root, 'src/components/ProfileView.jsx'), 'utf8');
assert.equal(profileSource.includes('{gmailConnection.lastError}</span>'), false, 'ProfileView renders a raw Gmail provider error');

for (const relativePath of [
  'supabase/functions/parse-load-document/index.ts',
  'supabase/functions/process-broker-attachment/index.ts',
]) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  for (const placeholder of [
    'Broker aniqlanmadi',
    'Yuk tavsifi aniqlanmadi',
    'text(extracted.equipmentType, "Aniqlanmadi")',
    'text(extracted.pickup.facilityName, "Pickup")',
    'text(extracted.delivery.facilityName, "Delivery")',
  ]) {
    assert.equal(source.includes(placeholder), false, `${relativePath} persists presentation placeholder: ${placeholder}`);
  }
}

const documentCheckSource = await readFile(
  path.join(root, 'supabase/functions/check-load-document/index.ts'),
  'utf8',
);
for (const forbiddenWarningPayload of [
  'message: String(item.message',
  'message: "Hujjat aniq',
  'message: "Hujjat ushbu reys',
  'message: "POD hujjatida',
]) {
  assert.equal(
    documentCheckSource.includes(forbiddenWarningPayload),
    false,
    `check-load-document sends localized warning text: ${forbiddenWarningPayload}`,
  );
}
assert.equal(
  documentCheckSource.includes('required: ["code", "params", "severity"]'),
  true,
  'check-load-document warning schema must require semantic code and params',
);

const semanticWarningMigration = await readFile(
  path.join(root, 'supabase/migrations/202609270002_semantic_warning_payloads.sql'),
  'utf8',
);
for (const forbiddenPersistence of [
  "warning->>'message'",
  "'message', w.message",
  ') to authenticated;',
]) {
  assert.equal(
    semanticWarningMigration.includes(forbiddenPersistence),
    false,
    `semantic warning migration retains an unsafe presentation/privilege path: ${forbiddenPersistence}`,
  );
}
assert.equal(
  semanticWarningMigration.includes(') to service_role;'),
  true,
  'semantic warning recorder must remain executable by service_role',
);

console.log(`i18n catalogs are in parity (${baseline.size} leaves); ${referenced.size} referenced keys resolved.`);
