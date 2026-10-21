import test from 'node:test';
import assert from 'node:assert/strict';
import { businessMailPolicy } from '../supabase/functions/gmail-sync-worker/business-policy.mjs';
const configuration = JSON.stringify({tenant:{folder:'Logistics/Approved',senders:['broker@example.test']}});
const mail = address => ({from:{value:[{address}]}});
test('business ingestion fails closed for missing malformed or other tenant policy', () => {
  for(const input of ['', '{}', '{', JSON.stringify({tenant:{folder:'INBOX',senders:['broker@example.test']}})]) {
    assert.throws(() => businessMailPolicy(input,'tenant'), /GMAIL_BUSINESS_POLICY_REQUIRED/);
  }
  assert.throws(() => businessMailPolicy(configuration,'other'), /GMAIL_BUSINESS_POLICY_REQUIRED/);
});
test('approved folder and exact single sender are both mandatory', () => {
  const accepts = businessMailPolicy(configuration,'tenant');
  assert.equal(accepts.folder,'Logistics/Approved');
  assert.equal(accepts(mail('BROKER@example.test')),true);
  for(const value of ['security@example.test','broker@example.test.attacker.test','broker+other@example.test']) assert.equal(accepts(mail(value)),false);
  assert.equal(accepts({from:{value:[{address:'broker@example.test'},{address:'other@example.test'}]}}),false);
  assert.equal(accepts({}),false);
});
