// Some PDFs print an appointment code immediately before the street address.
// Remove it only when it exactly matches this stop's separate appointment field.
export function streetAddressWithoutAppointmentCode(addressLine: unknown, appointmentReference: unknown) {
  if (typeof addressLine !== 'string' || typeof appointmentReference !== 'string') return addressLine;
  const address = addressLine.trim();
  const reference = appointmentReference.trim();
  if (!/[A-Za-z]/.test(reference) || !address.toLowerCase().startsWith(reference.toLowerCase())) return addressLine;
  const remainder = address.slice(reference.length);
  if (!/^\s+\d+[A-Za-z]?\b/.test(remainder)) return addressLine;
  return remainder.trim();
}
