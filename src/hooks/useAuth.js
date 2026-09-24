import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

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

export function useAuth() {
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authError, setAuthError] = useState('');

  const loadProfile = useCallback(async (userId) => {
    if (!supabase || !userId) {
      setCurrentUser(null);
      return;
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('Bu hisob uchun faol profil topilmadi. Administratorga murojaat qiling.');
    }
    if (profile.status !== 'active') {
      await supabase.auth.signOut();
      throw new Error('Bu hisob faol emas. Kompaniya administratoriga murojaat qiling.');
    }
    let companyName = '';
    if (profile.company_id) {
      const { data: company } = await supabase
        .from('companies')
        .select('name')
        .eq('id', profile.company_id)
        .maybeSingle();
      companyName = company?.name || '';
    }
    setCurrentUser(toUiUser(profile, companyName));
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      let verifiedSession = data.session;
      try {
        if (verifiedSession) {
          const { data: verified, error: verificationError } = await supabase.auth.getUser();
          if (verificationError || !verified.user) {
            await supabase.auth.signOut({ scope: 'local' });
            verifiedSession = null;
            setAuthError('Sessiya tugagan. Hisobga qayta kiring.');
          }
        }
        setSession(verifiedSession);
        await loadProfile(verifiedSession?.user?.id);
      } catch (profileError) {
        setAuthError(profileError.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      queueMicrotask(async () => {
        try {
          await loadProfile(nextSession?.user?.id);
        } catch (profileError) {
          setAuthError(profileError.message);
        } finally {
          setLoading(false);
        }
      });
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const login = async (email, password) => {
    if (!supabase) throw new Error('Supabase sozlanmagan.');
    setAuthError('');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    await loadProfile(data.user.id);
  };

  const logout = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setCurrentUser(null);
  };

  return {
    session,
    currentUser,
    loading,
    configured: isSupabaseConfigured,
    authError,
    login,
    logout,
  };
}
