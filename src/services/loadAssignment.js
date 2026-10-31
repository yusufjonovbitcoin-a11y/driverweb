import { loadIdentity } from './loadIdentity.js';
import { loadBoardStatus } from './loadBoardStatus.js';

// The RPC checks driver access and freezes the rate atomically in the database.
// A separate Edge Function preflight repeats these reads and cannot protect a
// subsequent transaction from concurrent changes.
export async function assignDriverLoad(client, { loadId, driverId, checksum }) {
  if (!loadId || !driverId) throw new Error('DRIVER_REQUIRED');
  const review = checksum !== undefined;
  if (review && !checksum) throw new Error('DOCUMENT_CHECKSUM_REQUIRED');
  const { data, error } = await client.rpc(review ? 'review_and_assign_document_load' : 'assign_load_directly', review
    ? { target_load_id: loadId, target_driver_id: driverId, source_checksum: checksum }
    : { load_id: loadId, driver_id: driverId });
  if (error) throw error;
  if (!data?.id || data.load_id !== loadId || data.driver_id !== driverId || data.status !== 'active') {
    throw new Error('ASSIGN_RESULT_MISSING');
  }
  return data;
}

// Only a server-confirmed assignment reaches this function. Refresh can fail
// after a successful commit; that must not turn success into a retryable send.
export async function completeLoadAssignment({ assign, confirmed, refresh }) {
  const result = await assign();
  confirmed(result);
  void Promise.resolve().then(refresh).catch(() => {});
  return result;
}

// A lost HTTP response is not proof of failure. Reconcile only the exact source,
// creator, current assignment and driver; RLS still scopes every read.
export async function readConfirmedPreviewAssignment(client, { actorId, checksum, driverId }) {
  if (!actorId || !checksum || !driverId) return null;
  const sameAccount = async () => {
    const { data, error } = await client.auth.getSession();
    return !error && data?.session?.user?.id === actorId;
  };
  if (!await sameAccount()) return null;
  const imported = await client.from('manual_load_imports').select('load_id,status')
    .eq('created_by', actorId).eq('checksum_sha256', checksum).maybeSingle();
  if (imported.error || imported.data?.status !== 'extracted' || !imported.data.load_id) return null;
  const loadId = imported.data.load_id;
  const load = await client.from('loads').select('id,status,current_assignment_id').eq('id', loadId).maybeSingle();
  if (load.error || !load.data?.current_assignment_id || !['assigned', 'in_progress'].includes(load.data.status)) return null;
  const assigned = await client.from('assignments').select('id,load_id,driver_id,status')
    .eq('id', load.data.current_assignment_id).eq('load_id', loadId).eq('driver_id', driverId).eq('status', 'active').maybeSingle();
  if (assigned.error || assigned.data?.id !== load.data.current_assignment_id
    || assigned.data?.load_id !== loadId || assigned.data?.driver_id !== driverId || assigned.data?.status !== 'active'
    || !await sameAccount()) return null;
  return { assigned: true, loadId };
}

export function applyConfirmedLoadAssignment(loads, prepared, driverId, result) {
  const preview = result?.assigned === true;
  const loadId = preview ? result.loadId : result?.load_id;
  if (!loadId || (!preview && (!result.id || result.driver_id !== driverId || result.status !== 'active'))
    || (!preview && prepared.id && prepared.id !== loadId)) throw new Error('ASSIGN_RESULT_MISSING');
  const existing = loads.find(load => load.id === loadId);
  const source = existing || { ...prepared, ...result.preparedLoad };
  // A Realtime refresh may already contain a later stage of this assignment.
  if (existing?.driverId === driverId && existing.currentAssignmentId
    && (preview || existing.currentAssignmentId === result.id)) return loads;
  const databaseStatus = source.databaseStatus === 'in_progress' ? 'in_progress' : 'assigned';
  const assigned = { ...source, ...loadIdentity(source), id: loadId, driverId,
    currentAssignmentId: preview ? null : result.id, targetDriverIds: [driverId],
    databaseStatus, status: loadBoardStatus({ status: databaseStatus }, result.driver_stage || 'accepted'),
    lifecycleStatus: 'assigned', review: source.review ? { ...source.review, required: false } : source.review };
  delete assigned.previewTicket;
  delete assigned.existingFinalizedLoadId;
  return existing ? loads.map(load => load.id === loadId ? assigned : load) : [assigned, ...loads];
}
