export const FUEL_TYPES = ['diesel', 'gasoline', 'electric', 'hybrid', 'other'];

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

export const emptyVehicleForm = () => ({
  vehicleNumber: '',
  vin: '',
  make: '',
  model: '',
  modelYear: String(new Date().getFullYear()),
  fuelType: 'diesel',
  plateIssuedState: '',
  plateNumber: '',
  sleeperBerthEnabled: true,
  notes: '',
});

export function vehicleRowToModel(row) {
  return {
    id: row.id,
    vehicleNumber: row.vehicle_number,
    vin: row.vin,
    make: row.make,
    model: row.model,
    modelYear: row.model_year,
    fuelType: row.fuel_type,
    plateIssuedState: row.plate_issued_state || '',
    plateNumber: row.plate_number || '',
    sleeperBerthEnabled: Boolean(row.sleeper_berth_enabled),
    notes: row.notes || '',
    status: row.status,
    assignmentId: row.assignment_id || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    assignedAt: row.assigned_at || null,
  };
}

export function vehicleToForm(vehicle) {
  if (!vehicle) return emptyVehicleForm();
  return {
    vehicleNumber: vehicle.vehicleNumber || '',
    vin: vehicle.vin || '',
    make: vehicle.make || '',
    model: vehicle.model || '',
    modelYear: vehicle.modelYear ? String(vehicle.modelYear) : '',
    fuelType: vehicle.fuelType || 'diesel',
    plateIssuedState: vehicle.plateIssuedState || '',
    plateNumber: vehicle.plateNumber || '',
    sleeperBerthEnabled: vehicle.sleeperBerthEnabled !== false,
    notes: vehicle.notes || '',
  };
}

export function normalizeVehicleForm(form) {
  return {
    vehicleNumber: form.vehicleNumber.trim(),
    vin: form.vin.replace(/\s+/g, '').toUpperCase(),
    make: form.make.trim(),
    model: form.model.trim(),
    modelYear: Number(form.modelYear),
    fuelType: form.fuelType,
    plateIssuedState: form.plateIssuedState.trim().toUpperCase(),
    plateNumber: form.plateNumber.trim().toUpperCase(),
    sleeperBerthEnabled: Boolean(form.sleeperBerthEnabled),
    notes: form.notes.trim(),
  };
}

export function validateVehicleForm(form, now = new Date()) {
  const value = normalizeVehicleForm(form);
  const errors = {};
  if (!value.vehicleNumber || value.vehicleNumber.length > 30) errors.vehicleNumber = 'vehicleNumber';
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value.vin)) errors.vin = 'vin';
  if (!value.make || value.make.length > 80) errors.make = 'make';
  if (!value.model || value.model.length > 80) errors.model = 'model';
  if (!Number.isInteger(value.modelYear)
      || value.modelYear < 1980
      || value.modelYear > now.getFullYear() + 2) errors.modelYear = 'modelYear';
  if (!FUEL_TYPES.includes(value.fuelType)) errors.fuelType = 'fuelType';
  if ((value.plateIssuedState && !value.plateNumber)
      || (!value.plateIssuedState && value.plateNumber)) errors.plate = 'plate';
  if (value.notes.length > 4000) errors.notes = 'notes';
  return { value, errors, valid: Object.keys(errors).length === 0 };
}
