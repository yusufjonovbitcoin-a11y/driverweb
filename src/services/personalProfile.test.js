import test from 'node:test';
import assert from 'node:assert/strict';
import { personalProfilePayload, savePersonalProfile } from './personalProfile.js';
import { formatTimeZoneClock } from '../i18n/timeZone.js';

test('profile payload allows only own editable fields', () => {
  assert.deepEqual(personalProfilePayload({ name: ' Name ', phone: ' +1 555 ', company: ' Evil ', role: 'super_admin', email: 'other@mail.test', id: 'other' }, false),
    { p_full_name: 'Name', p_phone: '+1 555', p_company_name: null });
  assert.throws(() => personalProfilePayload({ name: 'x' }), /PROFILE_NAME_INVALID/);
  assert.throws(() => personalProfilePayload({ name: 'Name', phone: '++' }), /PROFILE_PHONE_INVALID/);
  assert.throws(() => personalProfilePayload({ name: 'Name', phone: 'abc' }), /PROFILE_PHONE_INVALID/);
  assert.throws(() => personalProfilePayload({ name: 'Name', company: '' }, true), /PROFILE_COMPANY_INVALID/);
});
test('saving forwards only allowlisted fields, does not rename unchanged company', async () => {
  const client = { rpc: async (name, payload) => {
    assert.equal(name, 'update_my_profile');
    assert.deepEqual(payload, { p_full_name: 'New Name', p_phone: null, p_company_name: null });
    return { data: { id: 'a', full_name: 'New Name' } };
  } };
  await savePersonalProfile(client, { id: 'a', roleCode: 'company_admin', companyId: 'c', company: 'Company' }, { name: 'New Name', phone: '', company: 'Company', email: 'bad' });
  await assert.rejects(savePersonalProfile({ rpc: async () => ({ error: new Error('offline') }) }, { id: 'a' }, { name: 'Name' }), /offline/);
  await assert.rejects(savePersonalProfile({ rpc: async () => ({ data: { id: 'b' } }) }, { id: 'a' }, { name: 'Name' }), /PROFILE_SAVE_FAILED/);
});
test('timezone clock respects DST, Arizona and midnight', () => {
  assert.equal(formatTimeZoneClock(new Date('2026-07-01T12:00:00Z'), 'America/New_York'), '08:00');
  assert.equal(formatTimeZoneClock(new Date('2026-01-01T12:00:00Z'), 'America/New_York'), '07:00');
  assert.equal(formatTimeZoneClock(new Date('2026-07-01T12:00:00Z'), 'America/Phoenix'), '05:00');
  assert.equal(formatTimeZoneClock(new Date('2026-01-01T12:00:00Z'), 'America/Phoenix'), '05:00');
  assert.equal(formatTimeZoneClock(new Date('2026-07-01T04:00:00Z'), 'America/New_York'), '00:00');
});
