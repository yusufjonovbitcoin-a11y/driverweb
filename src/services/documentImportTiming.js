// Development-only caller: record durations, never document/account contents.
const now = () => globalThis.performance?.now?.() ?? Date.now();

export function createDocumentImportTiming(clock = now) {
  const startedAt = clock();
  const stages = [];
  return {
    record(entry) { stages.push({ stage: entry.stage, durationMs: Math.round(entry.durationMs) }); },
    ready() { return { startedAt, readyAt: clock(), stages: [...stages] }; },
  };
}

export function documentImportDisplayTiming(timing, clock = now) {
  const displayedAt = clock();
  return {
    event: 'document_import_display',
    stages: timing.stages,
    analysisMs: Math.round(timing.readyAt - timing.startedAt),
    responseToCommitMs: Math.round(displayedAt - timing.readyAt),
    totalMs: Math.round(displayedAt - timing.startedAt),
    visibility: globalThis.document?.visibilityState ?? 'unknown',
  };
}
