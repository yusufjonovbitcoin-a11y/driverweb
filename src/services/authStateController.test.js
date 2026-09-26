import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthStateController } from './authStateController.js';

const session = (id) => ({ user: { id } });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('logout invalidates a profile response already in flight', async () => {
  const profile = deferred();
  let state;
  const controller = createAuthStateController({ loadUser: () => profile.promise, onChange: (value) => { state = value; }, defer: async () => {} });
  const pending = controller.setSession(session('A'));
  await Promise.resolve();
  await controller.setSession(null);
  profile.resolve({ id: 'A' });
  await pending;
  assert.equal(state.currentUser, null);
  assert.equal(state.session, null);
  assert.equal(state.loading, false);
});

test('a slow prior account cannot replace the current account', async () => {
  const a = deferred();
  let state;
  const controller = createAuthStateController({ loadUser: (id) => id === 'A' ? a.promise : Promise.resolve({ id }), onChange: (value) => { state = value; }, defer: async () => {} });
  const pending = controller.setSession(session('A'));
  await Promise.resolve();
  await controller.setSession(session('B'));
  a.resolve({ id: 'A' });
  await pending;
  assert.equal(state.currentUser.id, 'B');
  assert.equal(state.session.user.id, 'B');
});

test('obsolete failures do not overwrite a successful login', async () => {
  const a = deferred();
  let state;
  const controller = createAuthStateController({ loadUser: (id) => id === 'A' ? a.promise : Promise.resolve({ id }), onChange: (value) => { state = value; }, defer: async () => {} });
  const pending = controller.setSession(session('A'));
  await Promise.resolve();
  await controller.setSession(session('B'));
  a.reject(new Error('Old account failed'));
  await pending;
  assert.equal(state.authError, '');
  assert.equal(state.currentUser.id, 'B');
});

test('current profile failure removes private UI and reports the error', async () => {
  let fail = false;
  let state;
  const controller = createAuthStateController({ loadUser: async (id) => { if (fail) throw new Error('Inactive account'); return { id }; }, onChange: (value) => { state = value; }, defer: async () => {} });
  await controller.setSession(session('A'));
  fail = true;
  await assert.rejects(controller.setSession(session('A')), /Inactive account/);
  assert.equal(state.currentUser, null);
  assert.equal(state.loading, false);
  assert.equal(state.authError, 'Inactive account');
});

test('disposing prevents late notifications and profile work', async () => {
  const waiting = deferred();
  let calls = 0;
  let updates = 0;
  const controller = createAuthStateController({ loadUser: async () => { calls++; }, onChange: () => { updates++; }, defer: () => waiting.promise });
  const pending = controller.setSession(session('A'));
  controller.dispose();
  waiting.resolve();
  await pending;
  await controller.setSession(session('B'));
  assert.equal(calls, 0);
  assert.equal(updates, 1);
});
