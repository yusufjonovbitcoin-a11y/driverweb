export function roleLabel(t, role) {
  return t(`roles.${role}`, { defaultValue: role || '—' });
}

export function loadStatusLabel(t, status) {
  return t(`loadStatus.${String(status || '').toLowerCase()}`, { defaultValue: status || '—' });
}

export function driverStatusLabel(t, status) {
  return t(`driverStatus.${String(status || '').toLowerCase()}`, { defaultValue: status || '—' });
}

export function ingestionStatusLabel(t, status) {
  return t(`ingestionStatus.${status}`, { defaultValue: status || '—' });
}

export function accountStatusLabel(t, status) {
  return t(`accountStatus.${String(status || '').toLowerCase()}`, { defaultValue: t('common.unknown') });
}

const WARNING_FIELD_KEYS = {
  brokerRate: 'rate',
  loadedMiles: 'distance',
  'broker.name': 'brokerName',
  cargoDescription: 'commodity',
  equipmentType: 'equipment',
  'pickup.city': 'pickupCity',
  'pickup.region': 'pickupRegion',
  'pickup.facilityName': 'pickupFacility',
  'pickup.address': 'pickupAddress',
  'delivery.city': 'deliveryCity',
  'delivery.region': 'deliveryRegion',
  'delivery.facilityName': 'deliveryFacility',
  'delivery.address': 'deliveryAddress',
  loadNumber: 'loadNumber',
  receiverSignature: 'receiverSignature',
  'broker.phone': 'brokerPhone',
  'pickup.appointment': 'pickupTime',
  'pickup.contactPhone': 'pickupPhone',
  'delivery.appointment': 'deliveryTime',
  'delivery.contactPhone': 'deliveryPhone',
};

export function warningLabel(t, warning = {}) {
  const code = String(warning.code || '').trim();
  const fieldCode = String(warning.params?.field || warning.field || '').trim();
  const fieldKey = WARNING_FIELD_KEYS[fieldCode] || fieldCode;
  const field = fieldCode
    ? t(`missingFields.${fieldKey}`, { defaultValue: t('common.unknown') })
    : t('common.unknown');
  const translated = code
    ? t(`warningCodes.${code}`, {
      ...warning.params,
      field,
      expected: warning.params?.expected || '—',
      actual: warning.params?.actual || '—',
      defaultValue: '',
    })
    : '';

  return translated || t('warningCodes.unknown');
}
