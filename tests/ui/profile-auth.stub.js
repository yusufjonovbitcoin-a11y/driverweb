const state = () => window.__profileAuth ||= { updates: [], failures: [], codes: 0, removals: 0, verified: false };
export const supabase = { auth: {
  updateUser: async attributes => {
    state().updates.push(attributes);
    const code = state().failures.shift();
    return { data: { user: { id: 'fixture-user' } }, error: code ? { code } : null };
  },
  reauthenticate: async () => { state().codes++; return { error: null }; },
  refreshSession: async () => ({ error: null }),
  mfa: {
    listFactors: async () => ({ data: { totp: state().verified ? [{ id: 'factor-test', status: 'verified' }] : [] }, error: null }),
    unenroll: async () => { state().removals++; state().verified = false; return { error: null }; },
  },
} };
