// Synthetic boundary: no credentials, network requests, or business mutations.
export async function setDriverAccountStatus(id, status) {
  window.statusRequests.push({ id, status });
  if (window.statusMode === 'deferred') await new Promise(resolve => { window.finishStatusRequest = resolve; });
  if (window.statusMode === 'error') throw new Error('Synthetic permission/network failure');
  window.savedDriverStatus = status;
  return status;
}
export const fetchDriverAccountStatus = async () => window.savedDriverStatus;
export const fetchDriverSettingsHistory = async () => [];
