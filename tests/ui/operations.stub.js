// Synthetic local data only. This entry point cannot access production services.
export const fetchDriverPaySettings = async () => ({ ratePerMile: null, hideRateCon: false });
export const updateCompanyDriverContact = async () => {};
export const fetchFleetVehicles = async () => [{ id: 'vehicle-test', unitNumber: 'T-101', type: 'truck', status: 'active' }];
export const assignFleetVehicleDriver = async () => {};
export const unassignFleetVehicleDriver = async () => {};
export const fetchImportContacts = async () => ({ stops: [] });
export const fetchImportPreviewContacts = async () => ({ stops: [] });

// Profile fixture imports share this service boundary; mutations fail closed.
export const fetchGmailIntegration = async () => null;
const unavailableInFixture = async () => { throw new Error('Operation unavailable in the synthetic UI fixture'); };
export const connectGmailIntegration = unavailableInFixture;
export const disconnectGmailIntegration = unavailableInFixture;
export const createFleetVehicle = unavailableInFixture;
export const decodeVehicleVin = unavailableInFixture;
export const updateFleetVehicle = unavailableInFixture;

const driver = { id: 'route-driver', name: 'Route Test Driver', driverNumber: '#TEST', accountStatus: 'active' };
const load = {
  id: 'route-load', driverId: driver.id, loadNumber: 'ROUTE-101', status: 'ASSIGNED', databaseStatus: 'assigned',
  origin: { city: 'Buffalo', state: 'NY' }, destination: { city: 'Boston', state: 'MA' },
  rate: 2200, distanceMiles: 455, documents: {},
};
export const fetchWorkspace = async ({ onCoreReady } = {}) => {
  const snapshot = status => ({ loads: [{ ...load, documentReviewsStatus: status }], drivers: [driver], rosterDrivers: [driver], members: [], rosterMembers: [] });
  if (new URLSearchParams(window.location.search).get('reviews') === 'held') {
    onCoreReady?.(snapshot('loading'));
    const outcome = await new Promise(resolve => { window.releaseWorkspaceReviews = resolve; });
    if (outcome === 'error') {
      onCoreReady?.(snapshot('error'));
      throw new Error('Synthetic review unavailable');
    }
  }
  return snapshot('ready');
};
export const subscribeWorkspace = () => () => {};
export const fetchDriverPresence = async () => [];
export const fetchWorkspaceAvatar = async () => null;
export const fetchBrokerInboxUnreadCount = async () => 0;
export const createManualLoad = unavailableInFixture;
export const approveLoadDraft = unavailableInFixture;
export const prepareLoadFromDocument = unavailableInFixture;
export const prepareLoadFromBrokerAttachment = unavailableInFixture;
export const sendPreviewDocumentLoad = unavailableInFixture;
export const assignLoadDirectly = unavailableInFixture;
export const reviewAndAssignDocumentLoad = unavailableInFixture;
export const createMember = unavailableInFixture;
export const deleteCompanyMember = unavailableInFixture;
export const updateMyLocale = unavailableInFixture;
