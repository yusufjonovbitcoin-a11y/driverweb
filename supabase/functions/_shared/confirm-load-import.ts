// Signed preview verification and import ownership/claiming happen in the caller.
// Keep the original upload through caller Storage RLS and server-only attestation.
function fail(message: string, status: number): never { throw Object.assign(Error(message), { status }); }
export async function confirmNewLoadImport({ caller, admin, file, checksum, importId,
  actorId, snapshot, draft, candidate, audit, schemaVersion, model }: any) {
  const started = performance.now();
  const { error: snapshotError } = await admin.from('manual_load_imports').update({
    raw_extraction: { candidate, audit, draft, confirmation: snapshot.preparedLoad },
    extraction_schema_version: schemaVersion,
  }).eq('id', importId);
  if (snapshotError) fail('IMPORT_CONFIRMATION_SNAPSHOT_FAILED', 500);
  const { data: plan, error: planError } = await caller.rpc('prepare_import_assignment_upload', {
    p_import_id: importId, p_expected_checksum: checksum,
  });
  if (planError) fail(planError.message, 409);
  if (plan?.bucket !== 'load-documents' || !plan.loadId || !plan.storagePath
    || !plan.documentId || !plan.versionId || typeof plan.alreadyUploaded !== 'boolean')
    fail('IMPORT_DOCUMENT_PLAN_INVALID', 500);
  const uploadStarted = performance.now();
  let verifyStored = plan.alreadyUploaded;
  if (!plan.alreadyUploaded) {
    const { error } = await caller.storage.from(plan.bucket)
      .upload(plan.storagePath, file, { contentType: file.type, upsert: false });
    if (error && String(error.statusCode ?? error.status) !== '409') fail('IMPORT_DOCUMENT_UPLOAD_FAILED', 502);
    verifyStored = Boolean(error);
  }
  if (verifyStored) {
    const { data, error } = await caller.storage.from(plan.bucket).download(plan.storagePath);
    if (error || !data) fail('IMPORT_DOCUMENT_VERIFY_FAILED', 502);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer()))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (data.size !== file.size || hash !== checksum) fail('IMPORT_DOCUMENT_SOURCE_MISMATCH', 409);
  }
  const uploadMs = Math.round(performance.now() - uploadStarted);
  const { data: document, error: finishError } = await admin.rpc('finalize_import_assignment_source', {
    p_import_id: importId, p_version_id: plan.versionId, p_expected_checksum: checksum,
    p_actor_id: actorId, p_model: model,
  });
  if (finishError) fail(finishError.message, 409);
  if (document?.id !== plan.documentId || document.load_id !== plan.loadId
    || document.current_version_id !== plan.versionId) fail('IMPORT_DOCUMENT_COMMIT_INVALID', 500);
  console.info(JSON.stringify({ event: 'load_import_stage', importId,
    stage: 'confirmation_source', durationMs: Math.round(performance.now() - started), uploadMs }));
  return { loadId: plan.loadId, preparedLoad: { ...snapshot.preparedLoad, id: plan.loadId } };
}
