export const PRESENCE_TTL_MS = 120_000;
export const presenceTimestamp = presence => Date.parse(presence?.updated_at || presence?.last_seen_at) || 0;

export function mergePresenceSnapshot(current, atStart, rows) {
  const merged = new Map(current);
  const foundIds = new Set(rows.map(row => row.driver_id));
  for (const row of rows) {
    const latest = current.get(row.driver_id);
    if (latest !== atStart.get(row.driver_id)) continue;
    if (!latest || presenceTimestamp(row) >= presenceTimestamp(latest)) merged.set(row.driver_id, row);
  }
  for (const [id, started] of atStart) {
    if (!foundIds.has(id) && current.get(id) === started) merged.set(id, null);
  }
  return merged;
}

export function driverPresenceFields(presence, now = Date.now()) {
  const lastSeen = Date.parse(presence?.last_seen_at);
  const age = now - lastSeen;
  const isOnline = Boolean(presence?.is_online) && Number.isFinite(lastSeen)
    && age >= -30_000 && age < PRESENCE_TTL_MS;
  const locationAge = now - Date.parse(presence?.location_captured_at);
  const hasFreshLocation = isOnline && Number.isFinite(locationAge)
    && locationAge >= -30_000 && locationAge < PRESENCE_TTL_MS;
  const latitude = presence?.latitude == null ? NaN : Number(presence.latitude);
  const longitude = presence?.longitude == null ? NaN : Number(presence.longitude);
  const validPosition = Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  return {
    presence: presence || null,
    isOnline,
    lastSeenAt: presence?.last_seen_at || null,
    status: isOnline ? 'AVAILABLE' : 'RESTING',
    dutyStatus: isOnline ? 'ON_DUTY' : 'OFF_DUTY',
    currentLocation: hasFreshLocation && validPosition ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : null,
    lat: hasFreshLocation && validPosition ? latitude : null,
    lng: hasFreshLocation && validPosition ? longitude : null,
  };
}

export function refreshDriverPresence(drivers, presenceById, now = Date.now()) {
  let changed = false;
  const result = drivers.map(driver => {
    const incoming = presenceById?.get(driver.id);
    // An HTTP snapshot that started before a realtime update cannot roll it back.
    const current = driver.presence;
    const presence = incoming === undefined ? current
      : incoming === null ? null
      : presenceTimestamp(current) > presenceTimestamp(incoming) ? current : incoming;
    const fields = driverPresenceFields(presence, now);
    if (Object.keys(fields).every(key => driver[key] === fields[key])) return driver;
    changed = true;
    return { ...driver, ...fields };
  });
  return changed ? result : drivers;
}
