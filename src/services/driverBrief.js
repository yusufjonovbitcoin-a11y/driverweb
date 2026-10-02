export function briefFieldLabel(t, key) {
  return key.startsWith('requirements.') ? t('driverBrief.instruction')
    : key.startsWith('contractTerms.') ? t('importDetails.terms')
      : t(`importDetails.fields.${key.replaceAll('.', '_')}`, { defaultValue: t(`driverBrief.fields.${key.replaceAll('.', '_')}`, { defaultValue: key }) });
}
