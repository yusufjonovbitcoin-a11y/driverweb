export function personalProfilePayload({ name, phone, company }, canEditCompany) {
  const fullName = String(name || '').trim();
  const cleanPhone = String(phone || '').trim();
  const companyName = String(company || '').trim();
  if (fullName.length < 2 || fullName.length > 120) throw new Error('PROFILE_NAME_INVALID');
  if (cleanPhone && (cleanPhone.length > 40 || !/^[+0-9() .-]+$/.test(cleanPhone) || !/\d/.test(cleanPhone))) throw new Error('PROFILE_PHONE_INVALID');
  if (canEditCompany && (companyName.length < 2 || companyName.length > 160)) throw new Error('PROFILE_COMPANY_INVALID');
  return { p_full_name: fullName, p_phone: cleanPhone || null, p_company_name: canEditCompany ? companyName : null };
}

export async function savePersonalProfile(client, user, values) {
  const payload = personalProfilePayload(values, user.roleCode === 'company_admin' && Boolean(user.companyId));
  if (payload.p_company_name === user.company) payload.p_company_name = null;
  const { data, error } = await client.rpc('update_my_profile', payload);
  if (error) throw error;
  if (!data || data.id !== user.id) throw new Error('PROFILE_SAVE_FAILED');
  return data;
}
