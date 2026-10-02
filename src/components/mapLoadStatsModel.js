const activeStatuses = new Set(['ASSIGNED', 'PICKED_UP', 'ON_ROAD', 'DELIVERED']);

export function currentDriverLoad(loads, driverId) {
  if (!driverId) return null;
  const priorities = { ON_ROAD: 0, PICKED_UP: 1, ASSIGNED: 2, DELIVERED: 3 };
  return loads
    .filter((load) => load.driverId === driverId
      && activeStatuses.has(load.status)
      && !['cancelled', 'dispute'].includes(load.databaseStatus))
    .sort((a, b) => priorities[a.status] - priorities[b.status])[0] || null;
}

export function loadStageIndex(load) {
  if (!load || ['cancelled', 'dispute'].includes(load.databaseStatus)) return null;
  if (load.databaseStatus === 'completed' || load.status === 'COMPLETED') return 3;
  if (load.databaseStatus === 'delivered' || load.status === 'DELIVERED') return 2;
  if (load.databaseStatus === 'in_progress' || ['PICKED_UP', 'ON_ROAD'].includes(load.status)) return 1;
  if (load.databaseStatus === 'assigned' || load.status === 'ASSIGNED') return 0;
  return null;
}

export function knownLoadStatistics(load) {
  const distance = Number(load?.distanceMiles);
  const weight = Number(load?.weightLbs);
  const rate = Number(load?.rate);
  return {
    distance: load?.distanceKnown && load.distanceMiles != null && Number.isFinite(distance) && distance >= 0 ? distance : null,
    weight: load?.weightLbs != null && Number.isFinite(weight) && weight >= 0 ? weight : null,
    rate: load?.rateKnown && load.rate != null && Number.isFinite(rate) && rate >= 0 ? rate : null,
  };
}
