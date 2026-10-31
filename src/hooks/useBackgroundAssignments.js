import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createBackgroundAssignments } from '../services/backgroundAssignments.js';

export function useBackgroundAssignments(accountId) {
  const queue = useMemo(() => createBackgroundAssignments(accountId), [accountId]);
  const tasks = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => () => queue.clear(), [queue]);
  const pending = tasks.some(task => task.status === 'pending');
  useEffect(() => {
    if (!pending) return undefined;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [pending]);
  return { queue, tasks };
}
