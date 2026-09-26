export async function changeLocaleWithProfileSync(locale, {
  applyLocale,
  syncLocale,
  markPending,
  clearPending,
  onSynced,
  onSyncFailed,
}) {
  const selectedLocale = await applyLocale(locale);
  markPending?.(selectedLocale);
  try {
    await syncLocale(selectedLocale);
    clearPending?.(selectedLocale);
    onSynced?.(selectedLocale);
    return { locale: selectedLocale, synced: true };
  } catch (error) {
    onSyncFailed?.(error, selectedLocale);
    return { locale: selectedLocale, synced: false };
  }
}
