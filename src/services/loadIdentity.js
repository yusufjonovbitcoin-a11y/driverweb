const clean = value => value == null ? '' : String(value).trim().replace(/^#/, '');

// Display numbers never replace the UUID used by documents, assignments or pay.
export function loadIdentity(row) {
  const internal = clean(row.internal_number ?? row.internalNumber);
  const internalNumber = /^[1-9]\d{2,}$/.test(internal) ? internal : null;
  const reference = clean(Object.hasOwn(row, 'brokerLoadNumber') ? row.brokerLoadNumber : row.load_number ?? row.loadNumber);
  return {
    internalNumber,
    brokerLoadNumber: reference ? `#${reference}` : null,
    loadNumber: internalNumber ? `#${internalNumber}` : reference ? `#${reference}` : '—',
  };
}
