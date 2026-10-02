export function activeLoadsForDriver(loads, driverId) {
  return loads.filter((load) => (
    load.driverId === driverId
    && !['completed', 'cancelled', 'dispute'].includes(load.databaseStatus)
    && load.status !== 'COMPLETED'
  ));
}

export function partitionDriverLoads(loads) {
  const workflow = [];
  const exceptions = [];
  for (const load of loads) {
    if (['cancelled', 'dispute'].includes(load.databaseStatus)) exceptions.push(load);
    else workflow.push(load);
  }
  return { workflow, exceptions };
}

export function rosterStopAddress(stop) {
  return stop?.address
    || [stop?.city, stop?.state, stop?.postalCode].filter(Boolean).join(', ')
    || null;
}

export function rosterAppointment(stop) {
  return stop?.appointmentAt || stop?.date || null;
}

export function lastSeenKind(value, now = Date.now()) {
  if (!value) return 'never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'never';
  const age = Math.max(0, now - timestamp);
  if (age < 24 * 60 * 60 * 1000) return 'time';
  if (age < 48 * 60 * 60 * 1000) return 'yesterday';
  return 'date';
}
