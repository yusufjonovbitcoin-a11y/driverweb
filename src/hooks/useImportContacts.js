import { useEffect, useState } from 'react';
import { fetchImportContacts, fetchImportPreviewContacts } from '../services/operationsService';
import { importContactsRequest, startImportContacts } from '../services/importContacts';

// Contacts and road routing have separate lifecycles and never gate the PDF UI.
export function useImportContacts(loadId, previewTicket, enabled) {
  const [result, setResult] = useState(null);
  const request = importContactsRequest(loadId, previewTicket);
  const key = request?.key;
  const payload = request?.previewTicket?.payload;
  const signature = request?.previewTicket?.signature;
  useEffect(() => {
    if (!enabled || !key) return;
    return startImportContacts(signal => loadId ? fetchImportContacts(loadId, signal)
      : fetchImportPreviewContacts({ payload, signature }, signal),
    state => setResult({ key, ...state }));
  }, [loadId, key, payload, signature, enabled]);
  return enabled && result?.key === key ? result : null;
}
