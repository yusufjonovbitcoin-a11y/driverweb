const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const EARNINGS_BUCKET = 'driver-earnings';

// Exact preview bytes are uploaded; a retry keeps the same immutable delivery ID.
export async function deliverDriverEarnings(client, { snapshot, blob, fileName }) {
  const c = snapshot.calculation;
  if (snapshot.isDemo || snapshot.approvalStatus !== 'approved' || !uuid.test(snapshot.deliveryId) || !uuid.test(snapshot.driver.id)
    || !blob || blob.type !== 'application/pdf' || blob.size < 1 || blob.size > 20 * 1024 * 1024
    || !Number.isSafeInteger(c.gross) || !Number.isSafeInteger(c.net) || c.gross < 0 || c.net < 0
    || !c.rows.length || c.rows.some(row => row.load.driverId !== snapshot.driver.id)
    || !/^\d{4}-\d{2}-\d{2}$/.test(c.period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(c.period.to)
    || typeof fileName !== 'string' || fileName.length > 180 || !fileName.endsWith('.pdf')) throw Error('EARNINGS_INVALID');
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw Error('EARNINGS_PERMISSION_DENIED');
  const { data: actor, error: profileError } = await client.from('profiles').select('id,company_id,role,status').eq('id', auth.user.id).single();
  if (profileError) throw profileError;
  if (actor?.role !== 'company_admin' || actor.status !== 'active' || !uuid.test(actor.company_id)) throw Error('EARNINGS_PERMISSION_DENIED');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const payload = { p_id: snapshot.deliveryId, p_driver: snapshot.driver.id, p_period_from: c.period.from, p_period_to: c.period.to,
    p_gross_cents: c.gross, p_net_cents: c.net, p_load_count: c.rows.length, p_file_name: fileName, p_sha256: sha256, p_size_bytes: blob.size };
  const { data: existing, error: readError } = await client.from('driver_earnings').select('*').eq('id', snapshot.deliveryId).maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.driver_id !== snapshot.driver.id || existing.company_id !== actor.company_id || existing.sha256 !== sha256
      || Number(existing.net_cents) !== c.net || Number(existing.gross_cents) !== c.gross || existing.period_from !== c.period.from || existing.period_to !== c.period.to) throw Error('EARNINGS_ID_CONFLICT');
    return existing;
  }
  const path = `${actor.company_id}/${snapshot.driver.id}/${actor.id}/${snapshot.deliveryId}.pdf`;
  const { error: uploadError } = await client.storage.from(EARNINGS_BUCKET).upload(path, blob, { upsert: false, contentType: 'application/pdf', cacheControl: '0' });
  if (uploadError && !(['400', '409'].includes(String(uploadError.statusCode || uploadError.status)) && /already exists|duplicate/i.test(uploadError.message))) throw uploadError;
  const { data, error } = await client.rpc('publish_driver_earnings', payload);
  if (error) throw error;
  if (!data || data.id !== snapshot.deliveryId || data.driver_id !== snapshot.driver.id || data.sha256 !== sha256) throw Error('EARNINGS_DELIVERY_FAILED');
  return data;
}
