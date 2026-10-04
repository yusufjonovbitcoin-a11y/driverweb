export function briefFieldLabel(t, key) {
  const stop = /^stops\.(\d+)\.(\w+)$/.exec(key);
  if (stop) return `${t('driverBrief.stopNumber', { number: Number(stop[1]) + 1 })} · ${t(`stopFields.${stop[2]}`, { defaultValue: stop[2] })}`;
  return key.startsWith('requirements.') ? t('driverBrief.instruction')
    : key.startsWith('contractTerms.') ? t('importDetails.terms')
      : t(`importDetails.fields.${key.replaceAll('.', '_')}`, { defaultValue: t(`driverBrief.fields.${key.replaceAll('.', '_')}`, { defaultValue: key }) });
}
