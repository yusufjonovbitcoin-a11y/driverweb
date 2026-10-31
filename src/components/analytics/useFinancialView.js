import { useMemo, useSyncExternalStore } from 'react';
import { timeZonePreference } from '../../i18n/timeZone.js';
import { filterFinancialView, prepareFinancialView } from './financialModel.js';

export function useFinancialView(source, { from = '', to = '', group = 'completed', scopeDriverId = '', search = '', driverId = '' }, drivers) {
  const timeZone = useSyncExternalStore(timeZonePreference.subscribe, timeZonePreference.getSnapshot);
  const allView = useMemo(() => prepareFinancialView(source, { from, to, group, scopeDriverId, timeZone }, drivers), [source, from, to, group, scopeDriverId, timeZone, drivers]);
  const view = useMemo(() => filterFinancialView(allView, { search, driverId }), [allView, search, driverId]);
  return { allView, view };
}
