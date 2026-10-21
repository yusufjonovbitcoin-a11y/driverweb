export const managedDocumentTypes = { rateCon: 'ratecon', shipperBol: 'bol', receiverPod: 'pod' };
const databaseTypes = { rateCon: 'rate_confirmation', shipperBol: 'bol', receiverPod: 'pod', receipt: 'receipt' };
const maxBytes = 50 * 1024 * 1024;
export const documentPermissionDenied = cause => [401, 403].includes(Number(cause?.status))
  || /PERMISSION|FORBIDDEN|UNAUTHORIZED|42501/i.test(`${cause?.code || ''} ${cause?.message || ''}`);

export function documentMutationError(cause) {
  const code = `${cause?.code || ''} ${cause?.message || ''}`;
  if (/FILE_TOO_LARGE/.test(code)) return 'fileTooLarge';
  if (/FILE_INVALID/.test(code)) return 'fileType';
  if (/UPLOAD_EXPIRED/.test(code)) return 'uploadExpired';
  if (/STOP_REQUIRED/.test(code)) return 'stopRequired';
  if (/STOP_INVALID/.test(code)) return 'stopInvalid';
  if (/LIMIT_REACHED/.test(code)) return 'limitReached';
  if (/LOAD_TRASHED/.test(code)) return 'loadTrashed';
  if (documentPermissionDenied(cause)) return 'permissionError';
  if (/CONFLICT|STALE|VERSION/.test(code)) return 'conflict';
  if (/BUSY/.test(code)) return 'busyError';
  if (/REQUEST_TIMEOUT|REQUEST_ABORTED/.test(code)) return 'timeoutError';
  return 'saveError';
}

export function documentUploadError(file) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return 'emptyFile';
  if (file.size > maxBytes) return 'fileTooLarge';
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mime = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[extension];
  if (!mime || (file.type && file.type !== mime)) return 'fileType';
  return null;
}

function fromRow(base, row, stopId) {
  return { ...base, documentId: row?.id ?? null, stopId: stopId ?? null,
    versionId: row?.current_version_id ?? null, url: row?.url ?? null,
    fileName: row?.fileName || null, mimeType: row?.mimeType || null,
    sizeBytes: row?.sizeBytes ?? null, uploadedAt: row?.uploadedAt ?? null,
    available: Boolean(row?.current_version_id || row?.url) };
}

// Stable file identities survive replacement. Add targets belong to one exact
// stop and stay separate from the files already attached to that stop.
export function documentWorkspaceEntries(documents, context) {
  const stopMarkers = new Map();
  for (const [type, prefix] of [['pickup', 'P'], ['delivery', 'D']]) {
    (context?.stops || []).filter(stop => stop.type === type).slice()
      .sort((a, b) => a.sequence - b.sequence || String(a.id).localeCompare(String(b.id)))
      .forEach((stop, index) => stopMarkers.set(stop.id, `${prefix}${index + 1}`));
  }
  return documents.flatMap(base => documentChoices(base, context).map(choice => ({
    ...choice, key: `${base.id}:${choice.key}`, marker: stopMarkers.get(choice.stop?.id) || null,
  })));
}

export function selectedWorkspaceEntry(entries, key) {
  return entries.find(entry => entry.key === key)
    || entries.find(entry => entry.document.available) || entries[0] || null;
}

export function documentRegistryEntries(entries, extraKey = null) {
  return entries.filter(entry => !entry.add || entry.key === extraKey || !entries.some(item =>
    item.document.available && item.document.id === entry.document.id && item.document.stopId === entry.document.stopId));
}

export function documentRegistrySummary(entries) {
  const slots = new Map();
  for (const entry of entries) {
    const doc = entry.document;
    const key = `${doc.id}:${doc.stopId || (entry.legacy ? doc.documentId : 'load')}`;
    slots.set(key, Boolean(slots.get(key) || doc.available));
  }
  const uploaded = [...slots.values()].filter(Boolean).length;
  return { total: slots.size, uploaded, pending: slots.size - uploaded, percent: slots.size ? Math.round(uploaded / slots.size * 100) : 0 };
}

export function filterDocumentRegistry(entries, { filter = 'all', query = '', sort = 'type', direction = 1, labels = {} } = {}) {
  const search = query.trim().toLocaleLowerCase();
  const value = entry => {
    const doc = entry.document;
    if (sort === 'file') return doc.fileName || '';
    if (sort === 'stop') return entry.stop?.sequence ?? -1;
    if (sort === 'status') return Number(doc.available);
    if (sort === 'size') return doc.sizeBytes ?? -1;
    return ['rateCon', 'shipperBol', 'receiverPod', 'receipt'].indexOf(doc.id);
  };
  return entries.filter(entry => (filter === 'all' || entry.document.available === (filter === 'uploaded'))
    && (!search || [entry.document.title, entry.document.fileName, labels[entry.document.id], entry.marker,
      entry.stop?.facility_name, entry.stop?.city, entry.stop?.region, entry.stop?.address_line].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)))
    .slice().sort((a, b) => {
      const x = value(a), y = value(b);
      return direction * (typeof x === 'number' ? x - y : x.localeCompare(y, undefined, { numeric: true }));
    });
}

// Staff data comes only from the exact load context. The old first-of-type
// projection must not accidentally target another stop's document.
export function documentChoices(base, context) {
  if (!context) return [{ key: 'current', document: base }];
  const rows = context.documentItems.filter(row => row.document_type === databaseTypes[base.id]);
  if (!['shipperBol', 'receiverPod'].includes(base.id)) {
    const current = rows.find(row => row.stop_id == null && (row.current_version_id || row.url));
    return [{ key: 'load', document: fromRow(base, current || rows.find(row => row.stop_id == null), null) }];
  }
  const role = base.id === 'shipperBol' ? 'pickup' : 'delivery';
  const stops = context.stops.filter(stop => stop.type === role).slice().sort((a, b) => a.sequence - b.sequence);
  const currentRows = rows.filter(row => row.current_version_id || row.url);
  const choices = stops.flatMap(stop => {
    const current = currentRows.filter(row => row.stop_id === stop.id);
    return [...current.map(row => ({ key: `document:${row.id}`, stop, document: fromRow(base, row, stop.id) })),
      ...(current.length < 10 ? [{ key: `add:${stop.id}`, stop, add: true, document: fromRow(base, null, stop.id) }] : [])];
  });
  const legacy = currentRows.filter(row => row.stop_id == null);
  choices.unshift(...legacy.map(row => ({ key: `document:${row.id}`, legacy: true, document: fromRow(base, row, null) })));
  return choices.length ? choices : [{ key: 'unavailable', missingStop: true, document: fromRow(base, null, null) }];
}

export function documentViewerLoad(load, document) {
  return { ...load, documents: { ...load.documents, [document.id]: document.url || null },
    documentMeta: { ...load.documentMeta, [document.id]: { id: document.documentId, stop_id: document.stopId,
      current_version_id: document.versionId || null, fileName: document.fileName, mimeType: document.mimeType } },
    documentChecks: { ...load.documentChecks, [document.id]: load.documentMeta?.[document.id]?.current_version_id === document.versionId
      ? load.documentChecks?.[document.id] : null } };
}

export function documentActionSnapshot(load, document, action, operationId = crypto.randomUUID()) {
  return { reviewedLoad: load, type: managedDocumentTypes[document.id], action,
    documentId: document.documentId ?? null, stopId: document.stopId ?? null,
    expectedVersionId: document.versionId || null, operationId };
}

// Viewer actions must refer to the exact displayed version, never the first
// document of that type. Empty views offer only explicit empty/add slots.
export function documentViewerActionChoices(base, context) {
  const choices = documentChoices(base, context);
  if (!base.available) return choices.filter(choice => !choice.document.available && !choice.missingStop);
  if (!base.documentId && !base.versionId) return [];
  return choices.filter(choice =>
    (base.documentId ? choice.document.documentId === base.documentId : choice.document.versionId === base.versionId)
    && choice.document.versionId === base.versionId);
}
