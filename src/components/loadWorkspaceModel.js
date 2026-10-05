import { normalizeSearchText } from '../utils/globalSearch.js';

function availableLoads(loads) {
  return Array.isArray(loads) ? loads.filter(Boolean) : [];
}

function stopSearchValues(stop) {
  return [stop?.city, stop?.state, stop?.region, stop?.address, stop?.addressLine, stop?.street];
}

export function filterWorkspaceLoads(loads, { query = '', driverId = 'ALL', driversById = new Map() } = {}) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  return availableLoads(loads).filter((load) => {
    if (driverId === 'UNASSIGNED' && load.driverId) return false;
    if (driverId !== 'ALL' && driverId !== 'UNASSIGNED' && load.driverId !== driverId) return false;
    if (!tokens.length) return true;

    // Offered recipients are not the assigned driver and must not affect scope or search.
    const driver = load.driverId ? driversById?.get?.(load.driverId) : null;
    const values = [
      load.loadNumber,
      ...stopSearchValues(load.origin),
      ...stopSearchValues(load.destination),
      load.broker,
      driver?.name, driver?.driverNumber, driver?.truck, driver?.trailer,
    ].map(normalizeSearchText).filter(Boolean);
    const searchableText = values.flatMap(value => [value, value.replaceAll(' ', '')]).join(' ');
    return tokens.every(token => searchableText.includes(token));
  });
}

export function summarizeWorkspaceLoads(loads) {
  const source = availableLoads(loads);
  return {
    total: source.length,
    active: source.filter(load => !['UNASSIGNED', 'COMPLETED'].includes(load.status)).length,
    unassigned: source.filter(load => load.status === 'UNASSIGNED').length,
    completed: source.filter(load => load.status === 'COMPLETED').length,
    driverCount: new Set(source.map(load => load.driverId).filter(Boolean)).size,
  };
}
