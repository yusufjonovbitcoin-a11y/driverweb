import { useEffect, useState } from 'react';
import { fetchImportContacts, fetchImportRoadRoute } from '../services/operationsService';

export function useImportEnrichment(loadId, driverId, enabled, revision = 0) {
  const [route, setRoute] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [retry, setRetry] = useState(0);
  const key = `${loadId}:${driverId}:${retry}:${revision}`;
  const contactsKey = `${loadId}:${retry}:${revision}`;
  useEffect(() => {
    if (!loadId || !enabled) return;
    let active = true;
    const controller = new AbortController();
    fetchImportRoadRoute(loadId, driverId, controller.signal)
      .then(data => { if (active) setRoute({ key, data }); })
      .catch(() => { if (active) setRoute({ key, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [loadId, driverId, enabled, key]);
  useEffect(() => {
    if (!loadId || !enabled) return;
    let active = true;
    const controller = new AbortController();
    fetchImportContacts(loadId, controller.signal)
      .then(data => { if (active) setContacts({ key: contactsKey, data }); })
      .catch(() => { if (active) setContacts({ key: contactsKey, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [loadId, enabled, contactsKey]);
  // A changed driver can never display the previous driver's distance.
  return { route: enabled && route?.key === key ? route : null,
    contacts: enabled && contacts?.key === contactsKey ? contacts : null,
    retry: () => setRetry(value => value + 1) };
}
