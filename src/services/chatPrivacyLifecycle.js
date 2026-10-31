// Keep a verified account through token refresh/offline profile failures, but
// invalidate it synchronously before React unmounts on logout/account changes.
export function createChatPrivacyLifecycle({ keyOf, clear }) {
  let previous = null;
  const retire = () => {
    if (!previous) return;
    const scope = keyOf(previous);
    previous = null;
    clear(scope);
  };
  return {
    update({ session, currentUser }) {
      if (!session || (previous && session.user.id !== previous.id)) retire();
      if (!currentUser) return;
      if (previous && keyOf(currentUser) !== keyOf(previous)) retire();
      previous = currentUser;
    },
  };
}
