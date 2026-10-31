// SDK auth endpoints remain usable while protected database requests require AAL2.
export async function requireMfaAssurance(client) {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') throw Error('MFA_REQUIRED');
}

export async function verifiedTotpFactors(client) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp || []).filter(factor => factor.status === 'verified');
}

export async function verifyTotp(client, factorId, code) {
  if (!/^\d{6}$/.test(code)) throw Error('MFA_INVALID_CODE');
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}
