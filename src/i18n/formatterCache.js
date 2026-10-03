// Formatters hold only locale/options, never values or workspace data.
export function createFormatterCache(createFormatter, limit = 64) {
  const cache = new Map();
  return (locale, options = {}) => {
    const entries = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const key = JSON.stringify([locale, entries]);
    let formatter = cache.get(key);
    if (formatter) cache.delete(key);
    else formatter = createFormatter(locale, options);
    cache.set(key, formatter);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return formatter;
  };
}
