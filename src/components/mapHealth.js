// A tile/resource failure after initialization must not stop route or GPS
// updates. Only an unusable initial map warrants the blocking fallback.
export function mapFailureState(loaded) {
  return loaded ? { status: 'ready', resourceError: true }
    : { status: 'error', resourceError: false };
}
