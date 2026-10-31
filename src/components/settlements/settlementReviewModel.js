import { calculateSettlement } from './calculation.js';
import { calculatedEntry } from './calculatedLoads.js';

function optionalNet(value) {
  if (value === '') return null;
  if (typeof value !== 'string' || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value) || Number(value) > 9999999.99) throw Error('invalid');
  return Math.round(Number(value) * 100);
}

export function settlementDraft(snapshot) {
  return structuredClone({
    driverName: snapshot.driver.name,
    companyName: typeof snapshot.company === 'string' ? snapshot.company : snapshot.company?.name || 'T Fleets',
    period: snapshot.calculation.period,
    settings: snapshot.calculation.settings,
    netOverride: snapshot.calculation.netOverride == null ? '' : (snapshot.calculation.netOverride / 100).toFixed(2),
    loads: snapshot.calculation.rows.map(({ load, netOverride }) => ({
      id: load.id, loadNumber: load.loadNumber || '',
      originCity: load.origin?.city || '', originState: load.origin?.state || '',
      destinationCity: load.destination?.city || '', destinationState: load.destination?.state || '',
      rate: String(load.rate), miles: load.distanceMiles == null ? '' : String(load.distanceMiles),
      netOverride: netOverride == null ? '' : (netOverride / 100).toFixed(2),
    })),
  });
}

export function reviewSettlement(source, draft) {
  const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  if (!validText(draft.driverName, 100) || !validText(draft.companyName, 200)
    || draft.loads.length !== source.calculation.rows.length) throw Error('invalid');
  const loads = source.calculation.rows.map(({ load }, index) => {
    const edit = draft.loads[index];
    if (edit.id !== load.id || !validText(edit.loadNumber, 100)
      || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(edit.rate)
      || edit.miles !== '' && (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(edit.miles) || Number(edit.miles) > 9999999)) throw Error('invalid');
    for (const field of ['originCity', 'originState', 'destinationCity', 'destinationState']) {
      if (typeof edit[field] !== 'string' || edit[field].length > 200) throw Error('invalid');
    }
    return { ...load, loadNumber: edit.loadNumber.trim(), rate: edit.rate, rateKnown: true,
      distanceMiles: edit.miles === '' ? null : Number(edit.miles), distanceKnown: edit.miles !== '',
      origin: { ...load.origin, city: edit.originCity.trim(), state: edit.originState.trim() },
      destination: { ...load.destination, city: edit.destinationCity.trim(), state: edit.destinationState.trim() },
    };
  });
  const calculation = calculateSettlement(loads, draft.settings, draft.period);
  // Document-only adjustments follow the configured fees; the source rules stay intact.
  calculation.loadNetAdjustment = 0;
  calculation.rows.forEach((row, index) => {
    row.netOverride = optionalNet(draft.loads[index].netOverride);
    row.automaticNet = row.gross - row.commission;
    row.net = row.netOverride ?? row.automaticNet;
    row.netAdjustment = row.net - row.automaticNet;
    calculation.loadNetAdjustment += row.netAdjustment;
  });
  calculation.earnings += calculation.loadNetAdjustment;
  calculation.net = calculation.earnings - calculation.deducted;
  calculation.netBeforeOverride = calculation.net;
  calculation.netOverride = optionalNet(draft.netOverride);
  if (calculation.netOverride != null) {
    const adjustment = calculation.net - calculation.netOverride;
    if (adjustment !== 0) calculation.deductions.push({
      id: 'pdf_net_adjustment', label: 'Final Net adjustment', amount: adjustment,
      method: 'fixed', frequency: 'per_settlement', basis: 'gross',
    });
    calculation.deducted += adjustment;
    calculation.net = calculation.netOverride;
  }
  return structuredClone({
    ...source, recipientName: source.recipientName || source.driver.name, driver: { ...source.driver, name: draft.driverName.trim() },
    company: { ...(typeof source.company === 'object' ? source.company : {}), name: draft.companyName.trim() },
    calculation, pdfEdited: true,
  });
}

export function approveSettlement(snapshot, now = new Date().toISOString()) {
  if (!Number.isSafeInteger(snapshot.calculation.net) || snapshot.calculation.net < 0) throw Error('negative');
  return { ...calculatedEntry(snapshot.calculation, snapshot.driver, snapshot.version, now, snapshot.company),
    approvalStatus: 'approved', approvedAt: now, pdfEdited: Boolean(snapshot.pdfEdited), recipientName: snapshot.recipientName || snapshot.driver.name };
}
