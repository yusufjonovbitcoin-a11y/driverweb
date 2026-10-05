// Keep analysis independent from driver selection. Cancelling only detaches the
// preview; an already-sent server request may finish, but cannot reopen it.
export function createDocumentImportRunner() {
  let active = null;
  return {
    get busy() { return active !== null; },
    cancel() { active = null; },
    async run({ prepare, onResult, onError, onFinish }) {
      if (active) return false;
      const request = {};
      active = request;
      try {
        const result = await prepare();
        if (active === request) onResult(result);
      } catch (error) {
        if (active === request) onError(error);
      } finally {
        if (active === request) {
          active = null;
          onFinish();
        }
      }
      return true;
    },
  };
}

export function mergeDocumentImportResult(current, requestId, result) {
  if (current?.importRequestId !== requestId) return current;
  // The picker may have changed these while the request was in flight. Neither
  // the original request context nor extracted document data may reset them.
  return {
    ...result.preparedLoad,
    source: current.source,
    importRequestId: current.importRequestId,
    preferredDriverId: current.preferredDriverId,
    awaitingDriverSelection: current.awaitingDriverSelection,
    sourceUrl: result.sourceUrl || current.sourceUrl,
    fileName: current.fileName,
    ...(current.sourceKind ? {
      sourceKind: current.sourceKind,
      brokerMessageId: current.brokerMessageId,
      brokerAttachmentId: current.brokerAttachmentId,
    } : {}),
  };
}

export function continueDocumentImport(current, drivers) {
  if (current?.source !== 'document' || current.importError
    || !drivers.some(driver => driver.id === current.preferredDriverId)) return current;
  return { ...current, awaitingDriverSelection: false };
}

export function shouldCancelImportOnNavigation(importTab, nextTab) {
  return Boolean(importTab && importTab !== nextTab);
}

export function findExistingFinalizedLoad(loads, loadNumber) {
  const number = String(loadNumber || '').trim().replace(/^#/, '');
  if (!number) return null;
  return (loads || []).find(load => String(load.loadNumber || '').trim().replace(/^#/, '') === number
    && !['draft', 'review'].includes(load.databaseStatus)) || null;
}
