export * from './operations.stub.js';

let driver = { id: 'fixture-driver', name: 'Test Driver', driverNumber: 'D-101', email: 'driver@example.invalid', phone: '+1 555 111 2222', truck: 'T-101', trailer: '', currentLocation: 'Chicago, IL', lastSeenAt: '2026-10-26T08:00:00Z' };
let pay = { ratePerMile: null, hideRateCon: false };
let status = 'active';
const history = [];
export const getProfileDriver = () => ({ ...driver, accountStatus: status, dutyStatus: 'OFF_DUTY' });
export const fetchDriverPaySettings = async () => ({ ...pay });
export const updateCompanyDriverContact = async (id, { name, phone, ratePerMile, hideRateCon }) => {
  if (id !== driver.id || name === 'Fail Save') throw new Error('Synthetic save failure');
  driver = { ...driver, name: name.trim(), phone: phone.trim() };
  pay = { ratePerMile, hideRateCon };
  history.unshift({ id: `event-${history.length}`, action: 'driver.contact_updated', occurred_at: '2026-10-26T08:30:00Z', actor_id: 'fixture-admin' });
};
export const fetchDriverAccountStatus = async () => status;
export const fetchDriverSettingsHistory = async () => [...history];
export const setDriverAccountStatus = async (_id, value) => { status = value; return status; };

// Synthetic server storage for this credential-free fixture; no real Auth client is loaded.
let storedDriverPassword = new URLSearchParams(window.location.search).get('credential') === 'available' ? 'Fixture-stored-password' : '';
export const readDriverPassword = async (_driverId, { reveal = false } = {}) => {
  if (new URLSearchParams(window.location.search).get('credential') === 'error') throw new Error('SERVICE_UNAVAILABLE');
  if (reveal) {
    window.__fixturePasswordReads = (window.__fixturePasswordReads || 0) + 1;
    history.unshift({ id: `view-${history.length}`, action: 'driver.password_viewed', occurred_at: '2026-10-26T08:38:00Z' });
  }
  return { available: Boolean(storedDriverPassword), ...(reveal && storedDriverPassword ? { password: storedDriverPassword } : {}) };
};
export const updateDriverPassword = async (_driverId, password) => {
  if (password === 'Fixture-failing-password') throw new Error('PASSWORD_UPDATE_FAILED');
  window.__fixturePasswordUpdates = (window.__fixturePasswordUpdates || 0) + 1;
  history.unshift({ id: `password-${history.length}`, action: 'driver.password_reset_requested', occurred_at: '2026-10-26T08:35:00Z' });
  storedDriverPassword = password === 'Fixture-unretained-password' ? '' : password;
  return { retained: Boolean(storedDriverPassword) };
};
