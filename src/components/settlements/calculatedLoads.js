// Immutable calculation snapshots; approval never represents a payment.
import { displayDayKey } from '../../i18n/timeZone.js';

export function calculatedInRange(entry, range, zone) {
  if (!range.from && !range.to) return true;
  const date = displayDayKey(entry.calculatedAt, zone);
  return Boolean(date && (!range.from || date >= range.from) && (!range.to || date <= range.to));
}

export function calculatedEntry(calculation, driver, version, now = new Date().toISOString(), company) {
  return structuredClone({
    id: `calc:${driver.id}:${now}`,
    deliveryId: crypto.randomUUID(),
    driver,
    settingsVersion: version,
    calculatedAt: now,
    calculation,
    company,
  });
}

export function calculatedStatementSnapshot(entry, isDemo = false) {
  return structuredClone({
    calculation: entry.calculation,
    driver: entry.driver,
    version: entry.settingsVersion,
    company: entry.company,
    pdfEdited: Boolean(entry.pdfEdited),
    approvalStatus: entry.approvalStatus,
    approvedAt: entry.approvedAt,
    deliveryId: entry.deliveryId,
    isDemo: Boolean(entry.isDemo || isDemo),
    recipientName: entry.recipientName || entry.driver.name,
    storedPdf: entry.storedPdf,
  });
}

export function appendCalculatedEntry(entries, entry) {
  const existing = new Set(entries.flatMap(item => item.calculation.rows.map(row => row.load.id)));
  if (entry.calculation.rows.some(row => existing.has(row.load.id))) return entries;
  return [entry, ...entries];
}
