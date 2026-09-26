// Keep profile requests tied to the session that started them. A logout or
// account switch invalidates any response still in flight.
export function createAuthStateController({ loadUser, onChange, defer = () => new Promise((resolve) => setTimeout(resolve, 0)) }) {
  let version = 0;
  let disposed = false;
  let state = { session: null, currentUser: null, loading: true, authError: '' };

  function publish(next) {
    state = { ...state, ...next };
    onChange(state);
  }

  return {
    async setSession(session) {
      if (disposed) return;
      const request = ++version;
      const isCurrent = () => !disposed && request === version;
      const sameUser = session?.user?.id && session.user.id === state.currentUser?.id;
      publish({ session, currentUser: sameUser ? state.currentUser : null, loading: Boolean(session) && !sameUser, authError: '' });
      if (!session) return;
      try {
        // Supabase holds an auth lock while delivering auth events. Start API
        // work in a later task, after its synchronous listener has returned.
        await defer();
        if (!isCurrent()) return;
        const currentUser = await loadUser(session.user.id);
        if (isCurrent()) publish({ currentUser, loading: false, authError: '' });
      } catch (error) {
        if (!isCurrent()) return;
        publish({ currentUser: null, loading: false, authError: error.message || 'Sessiyani tekshirib bo‘lmadi.' });
        throw error;
      }
    },
    dispose() {
      disposed = true;
      version += 1;
    },
  };
}
