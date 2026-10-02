// UI fixture only. No import, document storage or assignment API is called.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/i18n';
import '../src/index.css';
import ImportedLoadPage from '../src/components/ImportedLoadPage';

const entries = {
  loadNumber: 'TEST-2048', 'pickup.facilityName': 'Example pickup facility',
  'pickup.addressLine': '100 First Avenue', 'pickup.city': 'Phoenix', 'pickup.region': 'AZ',
  'pickup.appointmentPrinted': 'Oct 2, 2026 · 08:00 MST', 'pickup.referenceNumber': 'PU-100',
  'delivery.facilityName': 'Example delivery facility', 'delivery.addressLine': '200 Second Avenue',
  'delivery.city': 'Los Angeles', 'delivery.region': 'CA', 'delivery.appointmentPrinted': 'Oct 3, 2026 · 10:30 PDT',
  'delivery.referenceNumber': 'DEL-200', 'broker.name': 'Example Logistics', 'broker.contactName': 'Test Broker',
  equipmentType: 'Reefer', cargoDescription: 'Frozen produce', temperatureFahrenheit: -10,
  weightLbs: 41000, palletCount: 22, isHazmat: false,
  'requirements.0': 'Maintain the temperature printed in the document.',
  'requirements.1': 'Call the dispatch contact before unloading.',
  specialInstructions: 'Short printed note — must not hide the complete requirements.',
};
const fields = Object.entries(entries).map(([key, value]) => ({ key, value, page: 1, quote: `${key}: ${value}` }));

export default function Fixture() {
  const mode = new URLSearchParams(window.location.search).get('mode');
  const [stage, setStage] = useState(mode === 'processing' ? 'processing' : mode === 'error' ? 'error' : 'ready');
  const [sent, setSent] = useState(false);
  const mapFields = mode === 'map' ? fields.map(field => ({ ...field, value: ({
    'pickup.addressLine': '1023 Buffalo Run', 'pickup.city': 'Missouri City', 'pickup.region': 'TX',
    'delivery.addressLine': '445 Birch Street', 'delivery.city': 'Lake Elsinore', 'delivery.region': 'CA',
  })[field.key] ?? field.value })) : fields;
  const load = { id: stage === 'ready' ? 'test-load' : null, fileName: 'synthetic-rate-confirmation.pdf', rate: 700, distanceMiles: 350,
    preferredDriverId: 'test-driver', importError: stage === 'error' ? 'Synthetic extraction failure' : '',
    lifecycleStatus: 'review', driverBrief: { fields: mapFields },
    review: { required: true, blockingFields: mode === 'blocked' ? ['pickup.addressLine'] : mode === 'map' ? ['caseCount', 'requirements'] : [] } };
  if (mode === 'extended') load.documentDetails = { version: 2, fields: [...fields, ...Object.entries({
    brokerRate: 700, loadedMiles: 350,
    cargoModel: 'Synthetic generator', lengthPrinted: '6 ft 0 in', widthPrinted: '4 ft 2 in', heightPrinted: '2 ft 7 in', cargoValuePrinted: '$100,000',
    bolNumber: 'TEST-BOL-123', 'pickup.scheduledDate': 'Thu 10/01/2026', 'delivery.note': 'Any day, anytime, just give notice.',
    paymentTerms: 'Net 30 after all required documents', billingEmail: 'billing@example.com', requiredDocuments: 'Signed RC, BOL, POD, invoice',
    documentDeadline: 'Within 24 hours', documentDriverName: 'Printed Driver', documentDriverPhone: '(313) 929-0101',
    'contractTerms.0': 'Synthetic full contract clause, including every condition.',
    'contractTerms.1': 'Synthetic second clause from a later page.',
  }).map(([key, value]) => ({ key, value, page: 7, quote: String(value) }))] };
  return <main style={{ maxWidth: 1450, margin: 'auto', padding: 20, height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <p style={{ marginBottom: 10 }}>Synthetic test — no real load is sent</p>
    {sent ? <p role="status">Test assignment confirmed</p> : <ImportedLoadPage load={load} processing={stage === 'processing'}
      enableMap={mode === 'map'} drivers={[
        { id: 'test-driver', name: 'Synthetic GPS driver', truck: '#001', isOnline: true, lat: 31.8, lng: -106.4 },
        { id: 'test-offline', name: 'No GPS driver', isOnline: false },
      ]}
      onBack={() => setSent(true)} onRetry={() => setStage('ready')} onConfirm={() => setSent(true)} />}
    {stage === 'processing' && <button onClick={() => setStage('ready')}>Finish synthetic extraction</button>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
