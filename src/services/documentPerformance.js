// Local diagnostics contain timings only, never private URLs or document data.
export function measureDocumentStage(stage) {
  if (!import.meta.env?.DEV) return () => {};
  const started = performance.now();
  return () => console.debug('[document-performance]', stage, `${Math.round(performance.now() - started)}ms`);
}
