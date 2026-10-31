import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rolldown } from 'rolldown';

const bundle = await rolldown({ input: fileURLToPath(new URL('./useWebPush.js', import.meta.url)),
  plugins: [{ name: 'isolated-hook-effects', resolveId(id) {
    if (id === 'react') return '\0react';
    if (id.endsWith('/webPush.js')) return '\0push';
  }, load(id) {
    if (id === '\0react') return 'export const {useState,useRef,useEffect,useCallback}=globalThis.testReact;';
    if (id === '\0push') return 'export const {dispatchBrowserNotification,getPushPreferences,pushConfigurationError,pushPermission,pushSupported,silenceWebPush,webPush}=globalThis.testPush;';
  } }],
});
const { output } = await bundle.generate({ format: 'iife', name: 'PushHook' });
await bundle.close();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let count = 0; count < 15; count++) await Promise.resolve(); };

function harness({ configurationError = null } = {}) {
  const slots = []; let cursor = 0; const effects = []; const silences = [];
  let refreshes = 0; let updates = 0;
  const disabling = deferred();
  const equal = (left, right) => left?.length === right.length && right.every((value, index) => Object.is(value, left[index]));
  const testReact = {
    useState(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { slots[index].value = value; }]; },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = fn(); }); } },
  };
  const context = { testReact, console,
    window: { addEventListener() {}, removeEventListener() {} }, document: { visibilityState: 'visible' },
    testPush: { getPushPreferences: id => ({ calls: id === 'a', messages: true }),
      pushSupported: () => true, pushPermission: () => 'granted',
      pushConfigurationError: () => configurationError,
      silenceWebPush: async id => { silences.push(id); }, dispatchBrowserNotification: async () => ({ shown: true }),
      webPush: { setAccount() {}, refresh: async () => { refreshes++; return true; },
        updatePreferences: async () => { updates++; return true; }, disable: () => disabling.promise } },
  };
  vm.runInNewContext(output[0].code, context);
  return { disabling, silences, refreshes: () => refreshes, updates: () => updates, render(id) {
    cursor = 0; const result = context.PushHook.useWebPush(id, false);
    while (effects.length) effects.shift()();
    return result;
  } };
}

test('late account A disable completion cannot clear account B settings or worker', async () => {
  const h = harness(); h.render('a'); await flush();
  const pending = h.render('a').disable();
  h.render('b'); await flush();
  h.disabling.resolve(); await pending;
  const current = h.render('b');
  assert.equal(current.status, 'on'); assert.equal(current.preferences.messages, true);
  assert.equal(current.preferences.calls, false); assert.equal(current.error, null);
  assert.deepEqual(h.silences, []);
});

test('missing Firebase configuration explains the inactive controls before any registration or enable attempt', async () => {
  const h = harness({ configurationError: 'vapidKeyMissing' });
  h.render('a'); await flush();
  assert.equal(h.render('a').status, 'unconfigured');
  assert.equal(h.render('a').error, 'vapidKeyMissing');
  assert.equal(h.refreshes(), 0);
  await h.render('a').toggleCategory('calls');
  assert.equal(h.updates(), 0);
  assert.equal(h.render('a').status, 'unconfigured');
  const pending = h.render('a').disable();
  h.disabling.resolve(); await pending;
  assert.equal(h.render('a').preferences.calls, false);
  assert.equal(h.render('a').status, 'unconfigured');
  assert.equal(h.render('a').error, 'vapidKeyMissing');
});
test('late account A disable failure cannot publish an error or silence account B', async () => {
  const h = harness(); h.render('a'); await flush();
  const pending = h.render('a').disable();
  h.render('b'); await flush();
  h.disabling.reject(new Error('disableFailed')); await assert.rejects(pending, /disableFailed/);
  assert.equal(h.render('b').error, null); assert.deepEqual(h.silences, []);
});
