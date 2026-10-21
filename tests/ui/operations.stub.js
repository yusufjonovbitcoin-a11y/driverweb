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
