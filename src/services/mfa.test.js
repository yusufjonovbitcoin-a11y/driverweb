import test from 'node:test';import assert from 'node:assert/strict';
import { requireMfaAssurance, verifiedTotpFactors, verifyTotp } from './mfa.js';
test('enrolled users cannot load the application before AAL2; failures are closed',async()=>{
 const client=(data,error)=>({auth:{mfa:{getAuthenticatorAssuranceLevel:async()=>({data,error})}}});
 await requireMfaAssurance(client({currentLevel:'aal1',nextLevel:'aal1'}));
 await requireMfaAssurance(client({currentLevel:'aal2',nextLevel:'aal2'}));
 await assert.rejects(requireMfaAssurance(client({currentLevel:'aal1',nextLevel:'aal2'})),/MFA_REQUIRED/);
 await assert.rejects(requireMfaAssurance(client(null,Error('network'))),/network/);
});
test('only verified factors qualify; invalid codes never reach the verification API',async()=>{
 let calls=0;const client={auth:{mfa:{listFactors:async()=>({data:{totp:[{id:'1',status:'verified'},{id:'2',status:'unverified'}]}}),challengeAndVerify:async value=>{calls++;assert.deepEqual(value,{factorId:'1',code:'123456'});return {};}}}};
 assert.deepEqual(await verifiedTotpFactors(client),[{id:'1',status:'verified'}]);
 await assert.rejects(verifyTotp(client,'1','12345x'),/MFA_INVALID_CODE/);assert.equal(calls,0);
 await verifyTotp(client,'1','123456');assert.equal(calls,1);
});
