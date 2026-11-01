const eligible = new Set(['assigned', 'in_progress', 'delivered']);
const fault = code => Object.assign(new Error(code), { code });

// Presentation only. The RPC repeats these checks against locked server rows.
export function completionEvidence(load, context) {
  if (!load?.currentAssignmentId || load.trashedAt || !eligible.has(load.databaseStatus) || !context) return null;
  const stops = context.stops.filter(stop => stop.status !== 'skipped' || stop.requires_document);
  if (!stops.some(stop => stop.type === 'pickup') || !stops.some(stop => stop.type === 'delivery')) return null;
  const documents = context.documentItems.filter(document => document.current_version_id && !document.removed_at
    && (!load.executionResetAt || Date.parse(document.uploadedAt) >= Date.parse(load.executionResetAt)));
  const selected = [];
  for (const stop of stops) {
    const type = stop.type === 'pickup' ? 'bol' : 'pod';
    const matching = documents.filter(document => document.stop_id === stop.id && document.document_type === type);
    if (!matching.length) return null;
    selected.push(...matching);
  }
  return { stops, documents: selected, versionIds: [...new Set(selected.map(document => document.current_version_id))].sort() };
}

export async function completeStaffLoad(client, load, request) {
  if (!load?.id || !load.currentAssignmentId || !eligible.has(load.databaseStatus)
    || load.trashedAt || load.version == null || !Number.isSafeInteger(Number(load.version))
    || !request?.operationId || !request.versionIds?.length) throw fault('STAFF_COMPLETION_CONFLICT');
  const parameters = {
    p_load_id: load.id, p_assignment_id: load.currentAssignmentId, p_expected_version: load.version,
    p_operation_id: request.operationId, p_document_versions: request.versionIds,
    p_delivered_local: request.deliveredLocal, p_time_zone: request.timeZone, p_note: request.note || '',
  };
  let data;
  try {
    const response = await client.rpc('complete_staff_load', parameters);
    if (response.error) throw response.error;
    data = response.data;
  } catch (cause) {
    // Reconcile an acknowledged commit whose HTTP response was lost. A receipt
    // must match this exact actor/request/current assignment, not just the load.
    let receipt;
    try {
      const result = await client.rpc('get_staff_load_completion', { p_operation_id: request.operationId });
      if (!result.error) receipt = result.data;
    } catch { /* Retain the original actionable error. */ }
    const saved = receipt?.request;
    if (!saved || Number(saved.baseVersion) !== Number(load.version) || saved.deliveredLocal !== request.deliveredLocal
      || saved.timeZone !== request.timeZone || saved.note !== (request.note || '').trim()
      || JSON.stringify(saved.documentVersions) !== JSON.stringify([...new Set(request.versionIds)].sort())) throw cause;
    data = receipt;
  }
  if (data?.loadId !== load.id || data.assignmentId !== load.currentAssignmentId || data.driverId !== load.driverId
    || data.operationId !== request.operationId || data.status !== 'completed' || data.driverStage !== 'completed'
    || !Number.isSafeInteger(Number(data.version)) || Number(data.version) <= Number(load.version)
    || !Number.isFinite(Date.parse(data.deliveredAt)) || !Number.isFinite(Date.parse(data.completedAt))) {
    throw fault('STAFF_COMPLETION_INVALID_RESPONSE');
  }
  return data;
}

export function applyStaffLoadCompletion(load, result) {
  if (load.id !== result.loadId || load.currentAssignmentId !== result.assignmentId || load.driverId !== result.driverId
    || Number(load.version) > Number(result.version)) return load;
  return { ...load, status: 'COMPLETED', databaseStatus: 'completed', version: result.version,
    driverStage: 'completed', deliveredAt: result.deliveredAt, completedAt: result.completedAt };
}

export function completionErrorKey(error) {
  const code = String(error?.message || error?.code || '');
  if (code.includes('STAFF_COMPLETION_PERMISSION_DENIED')) return 'permissionError';
  if (code.includes('STAFF_COMPLETION_DOCUMENTS_REQUIRED')) return 'documentsError';
  if (code.includes('STAFF_COMPLETION_AMBIGUOUS_TIME')) return 'ambiguousTime';
  if (code.includes('STAFF_COMPLETION_INVALID_TIME')) return 'timeError';
  if (/STAFF_COMPLETION_(CONFLICT|UNAVAILABLE)/.test(code)) return 'conflictError';
  return 'saveError';
}
