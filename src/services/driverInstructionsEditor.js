// A controller keeps network races independently testable without a live client.
export function createDriverInstructionsEditor({ loadId, getClient }) {
  let state = { draft: null, version: null, busy: false, error: null, saved: false,
    remoteText: null, requiresReview: false, reviewed: false };
  let request = null;
  const listeners = new Set();
  const update = patch => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const run = async (action, receive) => {
    if (request) return false;
    const controller = new AbortController();
    request = controller;
    update({ busy: true, error: null, saved: false });
    try {
      const { data, error } = await action(controller.signal);
      if (request !== controller) return false;
      if (error) throw error;
      receive(data);
      return true;
    } catch (error) {
      if (request === controller) update({ error: /Load changed; refresh before retrying/.test(error?.message || '') ? 'conflict' : 'request' });
      return false;
    } finally {
      if (request === controller) { request = null; update({ busy: false }); }
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setDraft(draft) { if (!request) update({ draft, saved: false }); },
    setReviewed(reviewed) { if (!request) update({ reviewed: Boolean(reviewed) }); },
    load() {
      return run(signal => getClient().from('loads').select('driver_instructions,version')
        .eq('id', loadId).single().abortSignal(signal), data => {
        const text = data.driver_instructions || '';
        const initial = state.draft === null;
        const requiresReview = !initial && (state.version !== data.version || state.requiresReview);
        update({ draft: initial ? text : state.draft, version: data.version,
          remoteText: initial ? null : text, requiresReview, reviewed: false });
      });
    },
    save() {
      if (state.draft === null || state.version == null || state.error === 'conflict' ||
        (state.requiresReview && !state.reviewed)) return Promise.resolve(false);
      const params = { target_load_id: loadId, expected_version: state.version, instructions: state.draft };
      return run(signal => getClient().rpc('save_driver_instructions', params).abortSignal(signal), data => {
        update({ draft: data.driver_instructions || '', version: data.version,
          saved: true, remoteText: null, requiresReview: false, reviewed: false });
      });
    },
    dispose() {
      const pending = request;
      request = null;
      pending?.abort();
      // A late result cannot publish into a new load or overwrite another request.
      // Reusable after React StrictMode's effect cleanup/reconnect.
      state = { ...state, busy: false };
    },
  };
}
