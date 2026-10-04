// Keep dispatch blocked only when the driver cannot safely identify or complete
// the route. Other unverified document fields still require human confirmation.
const CRITICAL_FIELDS = new Set([
  'loadNumber', 'requirements', 'specialInstructions', 'equipmentType',
  'weightLbs', 'temperatureFahrenheit', 'multiStopDriverWorkflow',
]);
const CRITICAL_STOP_FIELD = /^(?:pickup|delivery|stops\.\d+)\.(?:addressLine|city|region|referenceNumber|scheduledDate|readyDate|appointmentFrom|appointmentTo|appointmentPrinted|timePrinted)$/;

export function isDispatchBlockingField(field: string): boolean {
  return CRITICAL_FIELDS.has(field) || field.startsWith('requirements.') || CRITICAL_STOP_FIELD.test(field);
}

export function dispatchBlockingFields(fields: string[] = []): string[] {
  return fields.filter(isDispatchBlockingField);
}

export function dispatchWarningFields(fields: string[] = []): string[] {
  return fields.filter(field => !isDispatchBlockingField(field));
}
