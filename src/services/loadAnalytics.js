function knownAmount(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function label(value, fallback) {
  return typeof value === 'string' && value.trim() && value.trim() !== '—' ? value.trim() : fallback;
}

/** Contract values and requested equipment describe loads, not payments or a fleet. */
export function aggregateLoadAnalytics(loads = []) {
  const rows = Array.isArray(loads) ? loads.filter((load) => load && typeof load === 'object') : [];
  const brokers = new Map();
  const equipment = new Map();
  let contractAmount = 0; let knownRates = 0;
  let miles = 0; let knownDistances = 0;
  let pairedRate = 0; let pairedMiles = 0; let rpmLoads = 0;
  for (const load of rows) {
    const rate = load.rateKnown === false ? null : knownAmount(load.rate);
    const distance = load.distanceKnown === false ? null : knownAmount(load.distanceMiles);
    if (rate !== null) { contractAmount += rate; knownRates++; }
    if (distance !== null) { miles += distance; knownDistances++; }
    if (rate !== null && distance > 0) { pairedRate += rate; pairedMiles += distance; rpmLoads++; }
    const brokerName = label(load.broker, 'Broker ko‘rsatilmagan');
    const broker = brokers.get(brokerName) || { name: brokerName, count: 0, amount: 0, knownRates: 0 };
    broker.count++;
    if (rate !== null) { broker.amount += rate; broker.knownRates++; }
    brokers.set(brokerName, broker);
    const equipmentName = label(load.equipment, 'Texnika ko‘rsatilmagan');
    equipment.set(equipmentName, (equipment.get(equipmentName) || 0) + 1);
  }
  const count = rows.length;
  return {
    count,
    contractAmount: knownRates || !count ? contractAmount : null,
    knownRates,
    miles: knownDistances || !count ? miles : null,
    knownDistances,
    rpm: pairedMiles > 0 ? pairedRate / pairedMiles : null,
    rpmLoads,
    brokers: [...brokers.values()].map((broker) => ({
      ...broker,
      amount: broker.knownRates ? broker.amount : null,
      percent: broker.count / count * 100,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    equipment: [...equipment.entries()].map(([name, quantity]) => ({ name, count: quantity, percent: quantity / count * 100 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
