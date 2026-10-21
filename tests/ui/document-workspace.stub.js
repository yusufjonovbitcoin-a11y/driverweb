const stops = [
  { id: 'p1', type: 'pickup', sequence: 1, facility_name: 'First Pickup', city: 'Orwell', region: 'OH' },
  { id: 'p2', type: 'pickup', sequence: 2, facility_name: 'Second Pickup', city: 'Tucson', region: 'AZ' },
  { id: 'd1', type: 'delivery', sequence: 3, facility_name: 'First Delivery', city: 'Phoenix', region: 'AZ' },
  { id: 'd2', type: 'delivery', sequence: 4, facility_name: 'Second Delivery', city: 'Dallas', region: 'TX' },
];
const row = (id, document_type, stop_id) => ({ id, document_type, stop_id, current_version_id: `v-${id}`, fileName: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: 1024, uploadedAt: '2026-10-21T00:00:00Z' });
const context = { stops, documentItems: [row('rate', 'rate_confirmation', null), row('a', 'bol', 'p1'), row('b', 'bol', 'p2'), row('c', 'bol', 'p2'), row('pod1', 'pod', 'd1'), row('pod2', 'pod', 'd2'), row('receipt', 'receipt', null)] };
if (new URLSearchParams(location.search).has('missingReceipt')) Object.assign(context.documentItems.at(-1), { current_version_id: null, fileName: null, sizeBytes: null, uploadedAt: null });
export async function loadStaffDocumentContext() { return structuredClone(context); }
export async function loadStaffDocumentHistory(documentId) {
  await new Promise(resolve => setTimeout(resolve, 30));
  const current = context.documentItems.find(row => row.id === documentId);
  return [{ id: current.current_version_id, document_id: documentId, version_number: 2, file_name: current.fileName, uploaded_at: current.uploadedAt },
    { id: 'previous', document_id: documentId, version_number: 1, file_name: 'previous.pdf', uploaded_at: '2026-10-20T00:00:00Z' }];
}
export async function mutate(_load, action) {
  window.fixtureActions.push({ ...action, file: action.file?.name, onProgress: undefined });
  await new Promise(resolve => setTimeout(resolve, 250));
  let item = context.documentItems.find(row => row.id === action.documentId);
  if (!item) {
    item = row('new-file', { bol: 'bol', pod: 'pod', ratecon: 'rate_confirmation' }[action.type], action.stopId);
    context.documentItems.push(item);
  }
  item.current_version_id = action.action === 'remove' ? null : `new-${item.id}`;
  item.fileName = action.file?.name || item.fileName;
  return { ...item };
}
