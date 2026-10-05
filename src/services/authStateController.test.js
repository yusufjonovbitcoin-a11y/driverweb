import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthStateController } from './authStateController.js';

const session = (id) => ({ user: { id } });

test('saved profile invalidates old reads and cannot change email, role or another account', async () => {
  let state;
  let resolve;
  let calls = 0;
  const controller = createAuthStateController({ defer: async () => {}, onChange: next => { state = next; },
    loadUser: async id => ++calls === 1 ? { id, name: 'Old', email: 'a@mail.test', roleCode: 'dispatcher' } : new Promise(done => { resolve = done; }) });
  await controller.setSession(session('a'));
  const pending = controller.setSession(session('a'));
  await Promise.resolve();
  controller.applyProfileUpdate('a', { full_name: 'New', phone: '+123', email: 'evil', roleCode: 'super_admin' });
  resolve({ id: 'a', name: 'Old' });
  await pending;
  assert.equal(state.currentUser.name, 'New');
  assert.equal(state.currentUser.email, 'a@mail.test');
  assert.equal(state.currentUser.roleCode, 'dispatcher');
  controller.applyProfileUpdate('b', { full_name: 'Wrong' });
  assert.equal(state.currentUser.name, 'New');
  await controller.setSession(null);
  controller.applyProfileUpdate('a', { full_name: 'After logout' });
  assert.equal(state.currentUser, null);
});
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
