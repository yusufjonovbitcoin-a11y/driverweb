import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeVehicleForm,
  validateVehicleForm,
  vehicleRowToModel,
} from './fleetVehicleModel.js';

const validForm = {
  vehicleNumber: ' 007 ',
  vin: '4v4bc9eh7tn704159',
  make: ' Volvo Truck ',
  model: ' VNL (4) ',
  modelYear: '2026',
  fuelType: 'diesel',
  plateIssuedState: 'il',
  plateNumber: ' applied ',
  sleeperBerthEnabled: false,
  notes: ' Team truck ',
};

test('normalizes vehicle identifiers before persistence', () => {
  assert.deepEqual(normalizeVehicleForm(validForm), {
    vehicleNumber: '007',
    vin: '4V4BC9EH7TN704159',
    make: 'Volvo Truck',
    model: 'VNL (4)',
    modelYear: 2026,
    fuelType: 'diesel',
    plateIssuedState: 'IL',
    plateNumber: 'APPLIED',
    sleeperBerthEnabled: false,
    notes: 'Team truck',
  });
});

test('validates VIN, year, and paired plate fields', () => {
  assert.equal(validateVehicleForm(validForm, new Date('2026-01-01')).valid, true);
  const invalid = validateVehicleForm({
    ...validForm,
    vin: 'INVALID',
    modelYear: '2030',
    plateIssuedState: '',
  }, new Date('2026-01-01'));
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['modelYear', 'plate', 'vin']);
});

test('maps the active driver assignment from the fleet view', () => {
  assert.deepEqual(vehicleRowToModel({
    id: 'vehicle-a', vehicle_number: '007', vin: '4V4BC9EH7TN704159',
    make: 'Volvo', model: 'VNL', model_year: 2026, fuel_type: 'diesel',
    sleeper_berth_enabled: true, status: 'active', driver_id: 'driver-a',
    driver_name: 'Driver A', assignment_id: 'assignment-a',
  }).driverName, 'Driver A');
});
