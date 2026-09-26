import { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { createAuthStateController } from '../services/authStateController';

function toUiUser(profile, companyName) {
  if (!profile) return null;
  const roleLabels = {
    super_admin: 'Super Admin',
    company_admin: 'Kompaniya Admini',
    dispatcher: 'Dispecher',
    driver: 'Haydovchi',
  };
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    phone: profile.phone || '',
    role: roleLabels[profile.role] || profile.role,
    roleCode: profile.role,
    companyId: profile.company_id,
    company: companyName || (profile.role === 'super_admin' ? 'ApexHaul Platform' : 'Kompaniya'),
    avatarInitial: profile.full_name?.charAt(0)?.toUpperCase() || 'U',
  };
}

async function loadProfile(userId) {
  const { data: verified, error: verificationError } = await supabase.auth.getUser();
  if (verificationError) throw verificationError;
  if (verified.user?.id !== userId) throw new Error('Sessiya tugagan. Hisobga qayta kiring.');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) throw new Error('Bu hisob uchun faol profil topilmadi. Administratorga murojaat qiling.');
  if (profile.status !== 'active') throw new Error('Bu hisob faol emas. Kompaniya administratoriga murojaat qiling.');
  let companyName = '';
  if (profile.company_id) {
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name')
      .eq('id', profile.company_id)
      .maybeSingle();
    if (companyError) throw companyError;
    companyName = company?.name || '';
  }
  return toUiUser(profile, companyName);
}

export function useAuth() {
  const [state, setState] = useState({ session: null, currentUser: null, loading: isSupabaseConfigured, authError: '' });
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!supabase) return undefined;
    const controller = createAuthStateController({ loadUser: loadProfile, onChange: setState });
    controllerRef.current = controller;
    // INITIAL_SESSION also supplies the persisted session. One source of auth
    // events avoids a slower getSession response restoring a logged-out user.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void controller.setSession(nextSession).catch(() => {});
    });
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      listener.subscription.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    if (!supabase) throw new Error('Supabase sozlanmagan.');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    await controllerRef.current?.setSession(data.session);
  };

  const logout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await controllerRef.current?.setSession(null);
  };

  return { ...state, configured: isSupabaseConfigured, login, logout };
}
