import { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { createAuthStateController } from '../services/authStateController';
import { loadAuthProfile } from '../services/authProfile.js';
import { savePersonalProfile } from '../services/personalProfile';
import { chatAccountKey, clearPersistedChatSession } from '../services/chatSession';
import { clearPersistedChatMedia } from '../services/chatMediaOutbox';
import { createChatPrivacyLifecycle } from '../services/chatPrivacyLifecycle';

export function useAuth() {
  const [state, setState] = useState({ session: null, currentUser: null, loading: isSupabaseConfigured, authError: '' });
  const controllerRef = useRef(null);

  useEffect(() => {
    if (!supabase) return undefined;
    const privacy = createChatPrivacyLifecycle({ keyOf: chatAccountKey, clear: scope => {
      clearPersistedChatSession(scope);
      void clearPersistedChatMedia(scope).catch(() => {});
    } });
    const controller = createAuthStateController({ loadUser: userId => loadAuthProfile(supabase, userId), onChange: next => {
      privacy.update(next);
      setState(next);
    } });
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

  const updateProfile = async (values) => {
    if (!supabase || !state.currentUser) throw new Error('PROFILE_SAVE_FAILED');
    const user = state.currentUser;
    const saved = await savePersonalProfile(supabase, user, values);
    controllerRef.current?.applyProfileUpdate(user.id, saved);
    return saved;
  };

  const completeMfa = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await controllerRef.current?.setSession(data.session);
  };
  return { ...state, mfaRequired: state.authError === 'MFA_REQUIRED', completeMfa, configured: isSupabaseConfigured, login, logout, updateProfile };
}
