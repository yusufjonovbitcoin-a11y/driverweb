// React.lazy caches failed module imports, so remounting cannot retry them.
// Runtime/render failures can be retried by remounting only the affected view.
export function isPageModuleLoadError(error) {
  return error?.name === 'ChunkLoadError'
    || /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed|Unable to preload CSS/i.test(String(error?.message || ''));
}
