import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from './copyText.js';

const address = '36 Draffin Road, HILTON, NY, 14468';
function legacyEnvironment(success = true) {
  const events = [];
  const input = { style: {}, setAttribute: (...args) => events.push(['attribute', ...args]),
    select: () => events.push(['select']), remove: () => events.push(['remove']) };
  return { input, events, document: {
    activeElement: { focus: options => events.push(['focus', options]) },
    body: { appendChild: element => { assert.equal(element, input); events.push(['append']); } },
    createElement: tag => { assert.equal(tag, 'textarea'); return input; },
    execCommand: command => { events.push(['command', command]); return success; },
  } };
}

test('a click copies exactly the displayed full stop address through the modern clipboard API', async () => {
  const copied = [];
  await copyText(address, { navigator: { clipboard: { writeText: async value => copied.push(value) } } });
  assert.deepEqual(copied, [address]);
});

test('embedded browsers without clipboard API copy using a temporary selection and restore focus', async () => {
  const env = legacyEnvironment();
  await copyText(address, env);
  assert.equal(env.input.value, address);
  assert.equal(env.input.readOnly, true);
  assert.deepEqual(env.events.slice(-4), [['select'], ['command', 'copy'], ['remove'], ['focus', { preventScroll: true }]]);
});

test('a denied clipboard API falls back without reporting a false failure', async () => {
  const env = legacyEnvironment();
  env.navigator = { clipboard: { writeText: async () => { throw Error('Permission denied'); } } };
  await copyText(address, env);
  assert.ok(env.events.some(([event]) => event === 'command'));
});

test('failed copy cleans up and reports an error rather than showing copied', async () => {
  const env = legacyEnvironment(false);
  await assert.rejects(copyText(address, env), /COPY_UNAVAILABLE/);
  assert.deepEqual(env.events.slice(-2), [['remove'], ['focus', { preventScroll: true }]]);
  await assert.rejects(copyText(address, {}), /COPY_UNAVAILABLE/);
});

test('missing addresses never change the clipboard', async () => {
  for (const value of [null, undefined, '', '   ']) {
    await assert.rejects(copyText(value, { navigator: { clipboard: { writeText: () => { throw Error('must not copy'); } } } }), /COPY_TEXT_EMPTY/);
  }
});
