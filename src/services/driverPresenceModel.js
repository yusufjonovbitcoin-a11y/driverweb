export function driverPresenceFields(presence, now = Date.now()) {
  const online = Boolean(presence?.is_online)
    && now - new Date(presence.last_seen_at).getTime() < 120_000;
  const lat = presence?.latitude == null ? null : Number(presence.latitude);
  const lng = presence?.longitude == null ? null : Number(presence.longitude);
  const coordinates = online && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    status: online ? 'AVAILABLE' : 'RESTING',
    dutyStatus: online ? 'ON_DUTY' : 'OFF_DUTY',
    currentLocation: coordinates ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null,
    lat: coordinates ? lat : null,
    lng: coordinates ? lng : null,
    isOnline: online,
    lastSeenAt: presence?.last_seen_at || null,
  };
}

export function updateDriverPresence(drivers, driverId, presence, now) {
  const fields = driverPresenceFields(presence, now);
  let changed = false;
  const updated = drivers.map(driver => {
    if (driver.id !== driverId || Object.keys(fields).every(key => driver[key] === fields[key])) return driver;
    changed = true;
    return { ...driver, ...fields };
  });
  return changed ? updated : drivers;
}

export function expireDriverPresence(drivers, now = Date.now()) {
  let changed = false;
  const updated = drivers.map(driver => {
    if (!driver.isOnline || now - new Date(driver.lastSeenAt).getTime() < 120_000) return driver;
    changed = true;
    return { ...driver, ...driverPresenceFields({ last_seen_at: driver.lastSeenAt, is_online: false }, now) };
  });
  return changed ? updated : drivers;
}
