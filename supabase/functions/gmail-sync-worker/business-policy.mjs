// Explicit company-specific business senders; unset/malformed configuration stops ingestion.
export function businessMailPolicy(serialized, companyId) {
  let mapping;
  try { mapping = JSON.parse(serialized || ''); } catch { throw new Error('GMAIL_BUSINESS_POLICY_REQUIRED'); }
  const configuration = mapping?.[companyId];
  const folder = configuration?.folder;
  // oxlint-disable-next-line eslint/no-control-regex -- reject mailbox control characters before IMAP use.
  if (typeof folder !== 'string' || folder.length > 100 || !folder.trim() || /[\u0000-\u001f\u007f]/.test(folder)
    || /^(inbox|\[gmail\]|\[googlemail\])(?:\/|$)/i.test(folder)) throw new Error('GMAIL_BUSINESS_POLICY_REQUIRED');
  const values = configuration?.senders;
  if (!Array.isArray(values) || values.length === 0 || values.length > 500
    || values.some(value => typeof value !== 'string' || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value))) {
    throw new Error('GMAIL_BUSINESS_POLICY_REQUIRED');
  }
  const allowed = new Set(values.map(value => value.toLowerCase()));
  const accepts = parsed => {
    const addresses = parsed?.from?.value;
    return Array.isArray(addresses) && addresses.length === 1
      && allowed.has(String(addresses[0]?.address || '').toLowerCase());
  };
  accepts.folder = folder;
  accepts.senders = [...allowed];
  return accepts;
}
