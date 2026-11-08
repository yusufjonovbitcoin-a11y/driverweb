import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuthProfile } from './authProfile.js';
import { createClient } from '@supabase/supabase-js';

const profile = { id: 'staff', full_name: 'Test Staff', role: 'dispatcher', status: 'active', company_id: 'fleet', company: { name: 'Test Fleet' }, locale: 'en' };
const verified = { data: { user: { id: 'staff' } } };
const deferred = () => Promise.withResolvers();

function client({ user = verified, result = { data: profile }, mfa = { data: { currentLevel: 'aal1', nextLevel: 'aal1' } }, events = [] } = {}) {
  return {
    auth: { mfa: { async getAuthenticatorAssuranceLevel() { events.push('mfa'); return mfa; } },
      getUser() { events.push('verify'); return Promise.resolve(user); } },
    from(table) {
      events.push('profile'); assert.equal(table, 'profiles');
      return { select(columns) { assert.match(columns, /company:companies!profiles_company_id_fkey\(name\)/); return this; },
        eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'staff'); return this; },
        maybeSingle() { return Promise.resolve(result); } };
    },
  };
}

test('profile and server session verification start concurrently; neither alone publishes a user', async () => {
  for (const first of ['user', 'profile']) {
    const user = deferred(), row = deferred(), events = [];
    let published = false;
    const pending = loadAuthProfile(client({ user: user.promise, result: row.promise, events }), 'staff')
      .then(value => { published = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['mfa', 'verify', 'profile']);
    (first === 'user' ? user : row).resolve(first === 'user' ? verified : { data: profile });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(published, false);
    (first === 'user' ? row : user).resolve(first === 'user' ? { data: profile } : verified);
    const actual = await pending;
    assert.equal(actual.id, 'staff'); assert.equal(actual.company, 'Test Fleet');
    assert.equal(actual.roleCode, 'dispatcher'); assert.equal(actual.locale, 'en');
  }
});

test('MFA gate still blocks both profile and verification requests', async () => {
  const events = [];
  await assert.rejects(loadAuthProfile(client({ mfa: { data: { currentLevel: 'aal1', nextLevel: 'aal2' } }, events }), 'staff'), /MFA_REQUIRED/);
  assert.deepEqual(events, ['mfa']);
});

test('missing, inactive, mismatched and failed authentication never return a profile', async () => {
  for (const options of [
    { result: { data: null } },
    { result: { data: { ...profile, status: 'suspended' } } },
    { user: { data: { user: { id: 'other' } } } },
    { user: { data: { user: null } } },
    { user: { error: new Error('verification unavailable') } },
    { result: { error: new Error('profile unavailable') } },
  ]) await assert.rejects(loadAuthProfile(client(options), 'staff'));
});

test('platform administrator without a company retains its fallback name', async () => {
  const actual = await loadAuthProfile(client({ result: { data: { ...profile, role: 'super_admin', company_id: null, company: null } } }), 'staff');
  assert.equal(actual.company, 'ApexHaul Platform');
});

test('installed Supabase SDK sends verification and joined profile requests concurrently', { timeout: 5000 }, async () => {
  const requests = [], bothStarted = deferred(), release = deferred();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'staff', exp: expiresAt, aal: 'aal1' })).toString('base64url')}.test-signature`;
  const session = { access_token: token, refresh_token: 'synthetic', expires_at: expiresAt, user: { id: 'staff', factors: [] } };
  const sdk = createClient('https://synthetic.invalid', 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'profile-test',
      storage: { getItem: key => key === 'profile-test' ? JSON.stringify(session) : null, setItem() {}, removeItem() {} } },
    global: { fetch: async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (requests.length === 2) bothStarted.resolve();
      await release.promise;
      const data = url.pathname === '/auth/v1/user' ? session.user : [profile];
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  try {
    const pending = loadAuthProfile(sdk, 'staff');
    await bothStarted.promise;
    assert.deepEqual(requests.map(url => url.pathname).sort(), ['/auth/v1/user', '/rest/v1/profiles']);
    const query = requests.find(url => url.pathname.endsWith('/profiles'));
    assert.equal(query.searchParams.get('id'), 'eq.staff');
    release.resolve();
    assert.equal((await pending).company, 'Test Fleet');
  } finally { release.resolve(); await sdk.auth.stopAutoRefresh(); }
});
