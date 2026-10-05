// Private URLs are intentionally resolved on demand, not during list loading.
export function hasLoadDocument(load, type) {
  return Boolean(load?.documentMeta?.[type]?.current_version_id || load?.documents?.[type]);
}
