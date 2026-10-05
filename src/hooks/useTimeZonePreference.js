import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { DEFAULT_TIME_ZONE, timeZonePreference } from '../i18n/timeZone.js';

export function useTimeZonePreference(accountId) {
  const zone = useSyncExternalStore(timeZonePreference.subscribe, timeZonePreference.getSnapshot, () => DEFAULT_TIME_ZONE);
  // Switch before paint without remounting the workspace or resetting chat state.
  useLayoutEffect(() => { timeZonePreference.selectAccount(accountId); }, [accountId]);
  useEffect(() => {
    window.addEventListener('storage', timeZonePreference.onStorage);
    return () => window.removeEventListener('storage', timeZonePreference.onStorage);
  }, []);
  return [zone, timeZonePreference.set];
}
