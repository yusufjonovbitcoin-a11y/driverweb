const savedStatuses = new Set(['draft', 'review', 'ready_for_offer', 'offered']);

export function isRecoverableLoad(load) {
  return Boolean(load?.id && !load.trashedAt && savedStatuses.has(load.databaseStatus));
}

export function recoverableLoads(loads) {
  return loads.filter(isRecoverableLoad);
}

// Resume the durable record; never create a duplicate after an ambiguous failure.
export async function recoverSavedLoad(load, driverId, { approve, assign, review }) {
  if (!driverId) throw new Error('DRIVER_REQUIRED');
  if (!isRecoverableLoad(load)) throw new Error('LOAD_RECOVERY_UNAVAILABLE');
  if (load.review?.required) return review(load.id, driverId, load.review.checksum);
  if (['draft', 'review'].includes(load.databaseStatus)) await approve(load.id);
  return assign(load.id, driverId);
}

export async function approveSavedLoadDraft(client, loadId) {
  // Approval may have committed before its response was lost; inspect durable state.
  const { data: current, error: readError } = await client.from('loads').select('status').eq('id', loadId).maybeSingle();
  if (readError) throw readError;
  if (['ready_for_offer', 'offered'].includes(current?.status)) return;
  const { error } = await client.rpc('approve_load_draft', { load_id: loadId });
  if (error) throw error;
}
