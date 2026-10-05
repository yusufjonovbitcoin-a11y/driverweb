import { hasContactLookupAddress, validPhone } from '../../supabase/functions/_shared/load-enrichment.ts';

export function canLookupImportedStop(stop) {
  return !validPhone(stop.phone) && hasContactLookupAddress({
    address_line: stop.address, city: stop.city, region: stop.state, postal_code: stop.postalCode,
  });
}

export function importContactsRequest(loadId, previewTicket) {
  if (loadId) return { key: `load:${loadId}`, loadId };
  if (typeof previewTicket?.payload === 'string' && typeof previewTicket?.signature === 'string') {
    return { key: `preview:${previewTicket.signature}`, previewTicket };
  }
  return null;
}

export function importedStopContact(stop, state, enabled) {
  const documentPhone = validPhone(stop.phone);
  // Role alone is ambiguous when a route has multiple pickups/deliveries.
  const contact = state?.data?.contacts?.find(item => item.sequence === stop.sequence && item.role === stop.role);
  const externalPhone = contact?.status === 'found' ? validPhone(contact.phone) : null;
  return { ...stop, phone: documentPhone || externalPhone,
    phoneSource: documentPhone ? 'broker_document' : externalPhone ? contact.source : null,
    contactPending: Boolean(enabled && canLookupImportedStop(stop) && !state),
    contactError: canLookupImportedStop(stop) && Boolean(state?.error || contact?.status === 'provider_error') };
}

// Start immediately in an effect, never await this from the PDF-analysis path.
// Cleanup protects a different document (and an unmounted page) from late data.
export function startImportContacts(fetcher, onResult) {
  let active = true;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
  Promise.resolve().then(() => active ? fetcher(signal) : undefined)
    .then(data => { if (active) onResult({ data }); })
    .catch(() => { if (active) onResult({ error: true }); });
  return () => { active = false; controller.abort(); };
}
