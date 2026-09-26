const text = (value) => typeof value === 'string' ? value.trim() || null : null;

function requiredText(value, label) {
  const result = text(value);
  if (!result) throw new Error(`${label} kiriting.`);
  return result;
}

function amount(value, label, required = false) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    if (required) throw new Error(`${label} kiriting.`);
    return null;
  }
  if ((typeof value !== 'string' && typeof value !== 'number') || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${label} manfiy bo‘lmagan son bo‘lishi kerak.`);
  }
  return Number(value);
}

/** Only explicit dispatcher data is persisted. Unknown logistics facts stay null. */
export function normalizeManualLoad(form, selectedDriverIds, availableDriverIds) {
  const allowed = new Set(availableDriverIds);
  const targets = [...new Set(selectedDriverIds)].filter((id) => allowed.has(id));
  if (!targets.length) throw new Error('Kamida bitta haydovchini tanlang.');
  const stop = (prefix, label) => ({
    city: requiredText(form[`${prefix}City`], `${label} shahri`),
    state: requiredText(form[`${prefix}State`], `${label} shtati / hududi`),
    address: text(form[`${prefix}Address`]),
    facility: text(form[`${prefix}Facility`]),
    date: null,
    time: null,
    lat: null,
    lng: null,
  });
  const rate = amount(form.rate, 'Stavka', true);
  const distanceMiles = amount(form.distanceMiles, 'Masofa', true);
  const weightLbs = amount(form.weightLbs, 'Og‘irlik');
  if (weightLbs !== null && (!Number.isInteger(weightLbs) || weightLbs <= 0)) {
    throw new Error('Og‘irlik musbat butun son bo‘lishi kerak.');
  }
  return {
    loadNumber: requiredText(form.loadNumber, 'Yuk raqamini'),
    broker: requiredText(form.broker, 'Broker nomini'),
    equipment: requiredText(form.equipment, 'Texnika turini'),
    commodity: text(form.commodity),
    rate,
    distanceMiles,
    ratePerMile: distanceMiles > 0 ? rate / distanceMiles : null,
    weightLbs,
    origin: stop('origin', 'Yuklash'),
    destination: stop('destination', 'Yetkazish'),
    targetDriverIds: targets,
    brokerContact: null,
    brokerPhone: null,
    temperature: null,
    pallets: null,
    documents: { rateCon: null, shipperBol: null, receiverPod: null },
  };
}
