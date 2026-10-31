import { completedDocumentLoads } from './driverRosterModel.js';
import { buildLoadDetails } from './loadDetailsModel.js';
import { stopCalendarDate } from '../i18n/stopAppointment.js';

export const DRIVER_DOCUMENT_TYPES = Object.freeze({ rate_confirmation: 'rateCon', bol: 'shipperBol', pod: 'receiverPod', receipt: 'receipt' });
const typeOrder = Object.values(DRIVER_DOCUMENT_TYPES);

export function driverLoadDocuments(load) {
  const rows = Array.isArray(load.documentItems) ? load.documentItems : typeOrder.map(type => ({
    ...load.documentMeta?.[type], document_type: Object.keys(DRIVER_DOCUMENT_TYPES).find(key => DRIVER_DOCUMENT_TYPES[key] === type),
    url: load.documents?.[type] || null,
  }));
  return rows.filter(row => (!row.load_id || row.load_id === load.id) && DRIVER_DOCUMENT_TYPES[row.document_type] && (row.current_version_id || row.url))
    .map((row, index) => ({ id: DRIVER_DOCUMENT_TYPES[row.document_type], key: row.id || `${row.document_type}:${row.current_version_id || index}`,
      documentId: row.id || null, stopId: row.stop_id || null, versionId: row.current_version_id || null,
      url: row.url || null, mimeType: row.mimeType || null, fileName: row.fileName || null,
      sizeBytes: row.sizeBytes != null && Number.isFinite(Number(row.sizeBytes)) && Number(row.sizeBytes) >= 0 ? Number(row.sizeBytes) : null,
      uploadedAt: row.uploadedAt || null, available: true,
    })).sort((a, b) => typeOrder.indexOf(a.id) - typeOrder.indexOf(b.id) || a.key.localeCompare(b.key));
}

export function driverDocumentRegistry(loads, driverId, { query = '', from = '', to = '', labels = {} } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return completedDocumentLoads(loads.filter(load => load.driverId === driverId)).map(load => {
    const details = buildLoadDetails(load);
    const delivery = details.stops.filter(stop => stop.role === 'delivery').at(-1) || details.delivery;
    const day = stopCalendarDate(delivery.scheduleDate || delivery.appointment, delivery.timezone) || '';
    const route = [load.origin, load.destination].map(stop => [stop?.city, stop?.state].filter(Boolean).join(', ') || '—').join(' → ');
    const documents = driverLoadDocuments(load);
    const loadMatches = [load.loadNumber, load.brokerLoadNumber, route].join(' ').toLocaleLowerCase().includes(search);
    return { load, delivery, day, route, documents,
      matches: !search || loadMatches || documents.some(document => [document.fileName, labels[document.id]].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)),
    };
  }).filter(group => group.matches && (!from || group.day >= from) && (!to || Boolean(group.day) && group.day <= to))
    .sort((a, b) => b.day.localeCompare(a.day) || String(a.load.loadNumber).localeCompare(String(b.load.loadNumber), undefined, { numeric: true }));
}
