// Development fixture: synthetic data only, no API calls or real assignments.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/i18n';
import '../src/index.css';
import QuickDriverModal from '../src/components/QuickDriverModal';

function Fixture() {
  const [sent, setSent] = useState(false);
  const blocked = new URLSearchParams(window.location.search).has('blocked');
  return <main>
    <h1>Driver sheet review fixture — synthetic data</h1>
    {sent ? <p role="status">Fixture confirmed; no load was sent.</p> : <QuickDriverModal
      isOpen initialDriverId="fixture-driver" onClose={() => setSent(true)}
      drivers={[{ id: 'fixture-driver', name: 'Test Driver' }]}
      onConfirm={() => setSent(true)}
      loadData={{ id: 'fixture-load', loadNumber: '#TEST-10', lifecycleStatus: 'review', rate: null,
        origin: { city: 'Phoenix', state: 'AZ' }, destination: { city: 'Los Angeles', state: 'CA' },
        review: { required: true, blockingFields: blocked ? ['pickup.addressLine'] : [], checksum: 'fixture' },
        driverBrief: { fields: [
          { key: 'pickup.addressLine', value: '100 First Ave', page: 1, quote: 'Pickup address: 100 First Ave' },
          { key: 'pickup.appointmentPrinted', value: '10/02/2026 08:00 PDT', page: 1, quote: 'Pickup: 10/02/2026 08:00 PDT' },
          { key: 'temperatureFahrenheit', value: -10, page: 1, quote: 'Maintain -10 F' },
          { key: 'isHazmat', value: false, page: 1, quote: 'HAZMAT: NO' },
        ] },
      }} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
