// Await the existing authenticated import; never submit the PDF/model job twice.
export async function resolveLoadImportResult(initial, readStatus, {
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(), timeoutMs = 150_000,
} = {}) {
  let result = initial;
  const deadline = now() + timeoutMs;
  while (result?.processing && result.importId) {
    const { data: row, error } = await readStatus(result.importId);
    if (error) throw error;
    if (!row) throw new Error('IMPORT_STATUS_UNAVAILABLE');
    if (['extracted', 'needs_review'].includes(row.status) && row.load_id && row.extracted_result) {
      result = { loadId: row.load_id, preparedLoad: row.extracted_result, duplicate: true };
      break;
    }
    if (row.status === 'parse_failed') throw new Error(row.error_message || 'IMPORT_PARSE_FAILED');
    if (now() >= deadline) throw new Error('IMPORT_STILL_PROCESSING');
    await pause(2000);
  }
  if (!result?.loadId || !result.preparedLoad) throw new Error('IMPORT_RESULT_MISSING');
  return result;
}
