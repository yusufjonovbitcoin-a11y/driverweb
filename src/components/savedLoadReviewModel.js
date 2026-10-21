// Saved operational data takes precedence over historical PDF extraction.
// Extraction-only fields/evidence survive only where they still match.
export function loadReviewRequirementRows(details) {
  return details.requirements.map((value, index) => {
    const key = `requirements.${index}`;
    const evidence = details.fields.find(field => field.key === key && field.value === value);
    return { ...evidence, key, value };
  });
}

export function savedLoadReviewDetails(load, details, extracted) {
  const values = {
    loadNumber: details.number, 'broker.name': details.broker, 'broker.contactName': details.brokerContact,
    'broker.phone': details.brokerPhone, 'broker.email': details.brokerEmail,
    equipmentType: details.equipment, cargoDescription: details.commodity,
    weightLbs: details.weightLbs, temperatureFahrenheit: details.temperature,
    palletCount: details.pallets, caseCount: details.cases, isHazmat: details.isHazmat,
    specialInstructions: details.specialInstructions,
    brokerRate: load.rateKnown === false ? null : details.rate,
    loadedMiles: load.distanceKnown === false ? null : details.distanceMiles,
  };
  const weightPrinted = extracted.weight === details.weightLbs ? extracted.weightPrinted : null;
  const fields = extracted.fields.filter(field => {
    if (field.key.startsWith('requirements.')) {
      const index = Number(field.key.slice('requirements.'.length));
      return Number.isInteger(index) && index >= 0 && field.value === details.requirements[index];
    }
    if (field.key === 'weightPrinted') return Boolean(weightPrinted);
    return !Object.hasOwn(values, field.key) || field.value === values[field.key];
  });
  return { ...extracted, fields, number: details.number, broker: details.broker,
    brokerContact: details.brokerContact, brokerPhone: details.brokerPhone, brokerEmail: details.brokerEmail,
    equipment: details.equipment, cargo: details.commodity, weight: details.weightLbs, weightPrinted,
    temperature: details.temperature, pallets: details.pallets, cases: details.cases, hazmat: details.isHazmat,
    rate: values.brokerRate, distance: values.loadedMiles,
    instructions: details.specialInstructions,
    operationalOnly: extracted.operationalOnly || !fields.length,
    requirements: details.requirements,
    stops: details.stops.map(stop => ({ ...stop, scheduledDate: stop.scheduleDate, timePrinted: stop.scheduleTime })),
  };
}
