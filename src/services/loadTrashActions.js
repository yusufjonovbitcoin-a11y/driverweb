import { prepareDriverPayAssignment } from './driverPay.js';
// The server owns authorization and atomic version checks. Never silently retry
// a destructive action against a version the user has not reviewed.
export async function runLoadTrashAction(client, action, load, driverId = null) {
  const rpc = {
    trash: 'trash_load',
    restore: 'restore_trashed_load',
    delete: 'permanently_delete_trashed_load',
  }[action];
  if (!rpc || !load?.id || !Number.isSafeInteger(Number(load.version)) || load.version == null) {
    throw new Error('LOAD_TRASH_CONFLICT');
  }
  if (action === 'restore' && !driverId) throw new Error('DRIVER_REQUIRED');
  const args = { target_load_id: load.id, expected_version: load.version };
  if (action === 'restore') args.target_driver_id = driverId || null;
  if (action === 'restore' && driverId) await prepareDriverPayAssignment(client, load.id, driverId);
  const { data, error } = await client.rpc(rpc, args);
  if (error) throw error;
  if (action !== 'delete' && !data?.id) throw new Error('LOAD_TRASH_EMPTY_RESULT');
  return data;
}

export function loadTrashMetadata(row) {
  return {
    currentAssignmentId: row.current_assignment_id || null,
    trashedAt: row.trashed_at || null,
    trashedBy: row.trashed_by || null,
    trashedDriverId: row.trash_previous_driver_id || null,
    trashedFromStatus: row.trash_previous_status || null,
  };
}

export function partitionTrashedLoads(loads) {
  return {
    active: loads.filter(load => !load.trashedAt),
    trash: loads.filter(load => Boolean(load.trashedAt)),
  };
}
