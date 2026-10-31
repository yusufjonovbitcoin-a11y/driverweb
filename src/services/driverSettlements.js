import { readAllRows } from './readAllRows.js';

export const SETTLEMENT_BUCKET = 'driver-settlements';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
const columns = 'id,number,approved_at,summary,file_name,storage_path,sha256,size_bytes';

export function savedSettlement(row, full = false) {
  const value = full ? row.snapshot : row.summary;
  if (!row?.id || !value?.calculation?.rows?.length || !value?.driver?.id) throw Error('SETTLEMENT_INVALID_RESPONSE');
  return { ...value, id: row.id, deliveryId: row.id, reference: `#${String(row.number).padStart(4, '0')}`,
    calculatedAt: row.approved_at, approvedAt: row.approved_at, approvalStatus: 'approved', persisted: true, complete: full,
    storedPdf: { path: row.storage_path, sha256: row.sha256, size: Number(row.size_bytes), fileName: row.file_name } };
}
export async function readDriverSettlements(client, signal) {
  const query = q => signal ? q.abortSignal(signal) : q;
  // The list omits the full snapshot/PDF. A detailed statement is loaded on demand.
  const rows = await readAllRows(() => query(client.from('driver_settlements').select(columns)));
  return rows.map(row => savedSettlement(row)).sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt) || b.reference.localeCompare(a.reference));
}
export async function readDriverSettlement(client, id, signal) {
  if (!uuid.test(id)) throw Error('SETTLEMENT_INVALID');
  let query = client.from('driver_settlements').select(columns + ',snapshot').eq('id', id).single();
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return savedSettlement(data, true);
}
export async function confirmDriverSettlement(client, entry, { blob, fileName }) {
  if (!entry || !uuid.test(entry.deliveryId) || !uuid.test(entry.driver?.id) || entry.approvalStatus !== 'approved' || entry.isDemo
    || !blob || blob.type !== 'application/pdf' || blob.size < 1 || blob.size > 20 * 1024 * 1024
    || typeof fileName !== 'string' || !fileName.endsWith('.pdf') || fileName.length > 180) throw Error('SETTLEMENT_INVALID');
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw Error('SETTLEMENT_PERMISSION_DENIED');
  const { data: actor, error: actorError } = await client.from('profiles').select('id,company_id,role,status').eq('id', auth.user.id).single();
  if (actorError) throw actorError;
  if (actor?.status !== 'active' || actor.role !== 'company_admin' || !uuid.test(actor.company_id)) throw Error('SETTLEMENT_PERMISSION_DENIED');
  const sha256 = await hash(blob);
  const path = `${actor.company_id}/${entry.driver.id}/${actor.id}/${entry.deliveryId}.pdf`;
  const snapshot = JSON.parse(JSON.stringify(entry));
  const { error: uploadError } = await client.storage.from(SETTLEMENT_BUCKET).upload(path, blob, { upsert: false, contentType: 'application/pdf', cacheControl: '0' });
  if (uploadError && !(['400', '409'].includes(String(uploadError.statusCode || uploadError.status)) && /already exists|duplicate/i.test(uploadError.message))) throw uploadError;
  if (uploadError) {
    const prior = await client.storage.from(SETTLEMENT_BUCKET).download(path);
    if (prior.error) throw prior.error;
    if (prior.data?.size !== blob.size || await hash(prior.data) !== sha256) throw Error('SETTLEMENT_ID_CONFLICT');
  }
  const { data, error } = await client.rpc('confirm_driver_settlement', {
    p_id: entry.deliveryId, p_snapshot: snapshot, p_file_name: fileName, p_sha256: sha256, p_size_bytes: blob.size,
  });
  if (error) throw error;
  const result = savedSettlement(data, true);
  if (result.id !== entry.deliveryId || result.storedPdf.sha256 !== sha256) throw Error('SETTLEMENT_INVALID_RESPONSE');
  return result;
}
export async function readSettlementPdf(client, entry) {
  // Re-authorize each opening and verify the immutable bytes, including on retry.
  const fresh = await readDriverSettlement(client, entry.deliveryId);
  const { data: blob, error } = await client.storage.from(SETTLEMENT_BUCKET).download(fresh.storedPdf.path);
  if (error) throw error;
  if (!blob || blob.size !== fresh.storedPdf.size || blob.size > 20 * 1024 * 1024 || await hash(blob) !== fresh.storedPdf.sha256) throw Error('SETTLEMENT_PDF_INVALID');
  return new Blob([blob], { type: 'application/pdf' });
}
