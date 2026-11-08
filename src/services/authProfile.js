import { normalizeLocale } from '../i18n/locales.js';
import { requireMfaAssurance } from './mfa.js';

export async function loadAuthProfile(client, userId) {
  await requireMfaAssurance(client);
  // Both requests enforce the current session. Publish only after both pass.
  const [verification, profileResult] = await Promise.all([
    client.auth.getUser(),
    client.from('profiles').select('*,company:companies!profiles_company_id_fkey(name)')
      .eq('id', userId).maybeSingle(),
  ]);
  if (verification.error) throw verification.error;
  if (verification.data.user?.id !== userId) throw new Error('Sessiya tugagan. Hisobga qayta kiring.');
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data;
  if (!profile) throw new Error('Bu hisob uchun faol profil topilmadi. Administratorga murojaat qiling.');
  if (profile.status !== 'active') throw new Error('Bu hisob faol emas. Kompaniya administratoriga murojaat qiling.');
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    phone: profile.phone || '',
    role: profile.role,
    roleCode: profile.role,
    locale: profile.locale ? normalizeLocale(profile.locale) : null,
    companyId: profile.company_id,
    company: profile.company?.name || (profile.role === 'super_admin' ? 'ApexHaul Platform' : 'Kompaniya'),
    avatarInitial: profile.full_name?.charAt(0)?.toUpperCase() || 'U',
  };
}
