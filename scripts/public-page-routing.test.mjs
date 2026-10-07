import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('public support and privacy URLs resolve to their static pages without replacing app routes', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites, [
    { source: '/support', destination: '/support/index.html' },
    { source: '/privacy', destination: '/privacy/index.html' },
  ]);
  for (const route of config.rewrites) {
    const html = await readFile(new URL(`../public${route.destination}`, import.meta.url), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes(`https://managefleets.com${route.source}`));
  }
});

test('deployment keeps the pure helpers shared by the web without sending local artifacts', async () => {
  const rules = await readFile(new URL('../.vercelignore', import.meta.url), 'utf8');
  for (const helper of ['load-enrichment.ts', 'load-stop-address.ts', 'load-operational-extraction.ts']) {
    assert.ok(rules.includes(`!supabase/functions/_shared/${helper}`));
  }
  for (const excluded of ['.env*', 'dist', 'output', 'tmp', 'supabase/*']) {
    assert.ok(rules.split('\n').includes(excluded));
  }
});
