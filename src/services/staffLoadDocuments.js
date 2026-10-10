const types = { ratecon: 'rate_confirmation', bol: 'bol', pod: 'pod' };
export const STAFF_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const failure = code => Object.assign(new Error(code), { code });

export async function validateStaffDocumentFile(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || typeof file.slice !== 'function') {
    throw failure('STAFF_DOCUMENT_FILE_INVALID');
  }
  if (file.size > STAFF_DOCUMENT_MAX_BYTES) throw failure('STAFF_DOCUMENT_FILE_TOO_LARGE');
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mime = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[extension];
  if (!mime || (file.type && file.type !== mime)) throw failure('STAFF_DOCUMENT_FILE_INVALID');
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const signature = mime === 'application/pdf'
    ? new TextDecoder('latin1').decode(bytes).startsWith('%PDF-')
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (!signature) throw failure('STAFF_DOCUMENT_FILE_INVALID');
  return { mimeType: mime, fileName: file.name, sizeBytes: file.size };
}

// Read only this load's document metadata; never pre-sign every private file.
export async function fetchStaffLoadDocumentContext(client, loadId, signal) {
  const [documents, stops] = await Promise.all([
    client.from('documents').select('id,load_id,document_type,stop_id,current_version_id,current_version:document_versions!documents_current_version_fk(file_name,mime_type)')
      .eq('load_id', loadId).order('id').abortSignal(signal),
    client.from('load_stops').select('id,type,sequence,city,region,address_line,facility_name')
      .eq('load_id', loadId).order('sequence').order('id').abortSignal(signal),
  ]);
  if (documents.error) throw documents.error;
  if (stops.error) throw stops.error;
  return {
    documentItems: (documents.data || []).map(({ current_version: version, ...row }) => ({
      ...row, fileName: version?.file_name || null, mimeType: version?.mime_type || null, url: null,
    })),
    stops: stops.data || [],
  };
}

function bounded(work, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer); signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value);
    };
    const aborted = () => finish(failure('STAFF_DOCUMENT_REQUEST_ABORTED'));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(failure('STAFF_DOCUMENT_REQUEST_TIMEOUT')), timeoutMs);
    Promise.resolve(work).then(value => finish(null, value), error => finish(error));
  });
}

// Each staged operation keeps its UUID, version and uploaded media through a
// lost response. Never remove the old file before the server commits the new one.
export function createStaffDocumentManager({ client, ownerId, uploadMedia, timeoutMs = 20_000, uuid = () => crypto.randomUUID() }) {
  const records = new Map();
  const controller = new AbortController();
  let busy = false;
  const signal = controller.signal;
  const ensureOwner = async () => {
    if (signal.aborted) throw failure('STAFF_DOCUMENT_REQUEST_ABORTED');
    const session = await bounded(client.auth.getSession(), signal, timeoutMs);
    if (session.error || !ownerId || session.data?.session?.user?.id !== ownerId) {
      throw failure('STAFF_DOCUMENT_PERMISSION_DENIED');
    }
  };
  const rpc = async (name, params) => {
    await ensureOwner();
    const result = await bounded(client.rpc(name, params).abortSignal(signal), signal, timeoutMs);
    if (result.error) throw result.error;
    await ensureOwner();
    return result.data;
  };
  return {
    dispose() { controller.abort(); records.clear(); },
    async run(load, request) {
      if (busy) throw failure('STAFF_DOCUMENT_BUSY');
      if (!load?.id || load.trashedAt || !types[request?.type] || !['upload', 'remove'].includes(request.action)
        || request.expectedVersionId === undefined) throw failure('STAFF_DOCUMENT_CONFLICT');
      if (request.action === 'remove' && (!request.documentId || !request.expectedVersionId)) throw failure('STAFF_DOCUMENT_CONFLICT');
      busy = true;
      try {
        const metadata = request.action === 'upload' ? await validateStaffDocumentFile(request.file) : null;
        await ensureOwner();
        const key = JSON.stringify([load.id, request.type, request.stopId || null, request.documentId || null,
          request.expectedVersionId, request.action]);
        let record = records.get(key);
        if (!record || record.file !== request.file) {
          record = { operationId: request.operationId || uuid(), file: request.file, plan: null, media: null };
          records.set(key, record);
        }
        let row;
        if (request.action === 'remove') {
          row = await rpc('remove_staff_load_document', {
            p_load_id: load.id, p_document_id: request.documentId,
            p_expected_current_version_id: request.expectedVersionId, p_operation_id: record.operationId,
          });
        } else {
          record.plan ||= await rpc('begin_staff_document_upload', {
            p_load_id: load.id, p_document_type: types[request.type], p_stop_id: request.stopId || null,
            p_document_id: request.documentId || null, p_expected_current_version_id: request.expectedVersionId,
            p_file_name: metadata.fileName, p_mime_type: metadata.mimeType, p_size_bytes: metadata.sizeBytes,
            p_operation_id: record.operationId,
          });
          if (!record.plan?.versionId || !record.plan.documentId) throw failure('STAFF_DOCUMENT_INVALID_RESULT');
          if (!record.media) {
            await ensureOwner();
            // Supply a correct MIME type even if the OS file chooser omitted it.
            const file = request.file.type ? request.file : new File([request.file], metadata.fileName, { type: metadata.mimeType });
            record.media = await bounded(uploadMedia({ file, scope: 'load_document', contextId: record.plan.versionId,
              signal, onProgress: progress => { if (!signal.aborted) request.onProgress?.(progress * 100); } }), signal, 125_000);
          }
          if (!record.media?.reference?.startsWith('cloudinary:')) throw failure('STAFF_DOCUMENT_INVALID_RESULT');
          row = await rpc('complete_staff_document_upload', {
            p_version_id: record.plan.versionId, p_media_ref: record.media.reference, p_checksum_sha256: null,
          });
        }
        if (!row?.id || row.load_id !== load.id || row.document_type !== types[request.type]
          || row.id !== (record.plan?.documentId || request.documentId)
          || (request.stopId && row.stop_id !== request.stopId)) throw failure('STAFF_DOCUMENT_INVALID_RESULT');
        // A replay must never label someone else's newer version with this
        // operation's filename/MIME, even if a stale server returns that row.
        if ((row.current_version_id || null) !== (request.action === 'upload' ? record.plan.versionId : null)) {
          throw failure('STAFF_DOCUMENT_CONFLICT');
        }
        records.delete(key);
        return { ...row, fileName: metadata?.fileName || null, mimeType: metadata?.mimeType || null, url: null };
      } finally { busy = false; }
    },
  };
}

const uiType = { rate_confirmation: 'rateCon', bol: 'shipperBol', pod: 'receiverPod' };
export function applyStaffDocumentResult(load, row) {
  if (load.id !== row.load_id || !uiType[row.document_type]) return load;
  const key = uiType[row.document_type];
  const documentItems = [...(load.documentItems || []).filter(item => item.id !== row.id), row];
  const previousId = load.documentMeta?.[key]?.id;
  const representative = documentItems.find(item => item.id === previousId && item.current_version_id)
    || documentItems.find(item => item.document_type === row.document_type && item.current_version_id) || row;
  const unchanged = representative.id !== row.id;
  return { ...load,
    documentItems,
    documents: { ...load.documents, [key]: unchanged && representative.id === previousId ? load.documents?.[key] : null },
    documentMeta: { ...load.documentMeta, [key]: representative },
    documentChecks: { ...load.documentChecks, [key]: unchanged && representative.id === previousId ? load.documentChecks?.[key] : null },
  };
}

export function refreshOpenDocumentLoad(open, fresh) {
  if (!open || open.id !== fresh.id) return open;
  const documents = { ...fresh.documents }, documentMeta = { ...fresh.documentMeta };
  for (const key of ['rateCon', 'shipperBol', 'receiverPod', 'receipt']) {
    const previous = open.documentMeta?.[key];
    if (!previous?.id) continue;
    // The viewer may target a non-first stop. Keep that selection, not the
    // overview's first BOL/POD, and clear access after removal.
    const row = fresh.documentItems?.find(item => item.id === previous.id);
    documentMeta[key] = row || null;
    documents[key] = row?.signedUrl || null;
  }
  return { ...fresh, documents, documentMeta };
}
