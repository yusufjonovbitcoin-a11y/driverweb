import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import Sidebar from '../../src/components/Sidebar.jsx';
import ImportedLoadPage from '../../src/components/ImportedLoadPage.jsx';

const params = new URLSearchParams(location.search);
await setAppLocale(params.get('locale') || 'en', { persist: false });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const text of ['Synthetic load confirmation TEST-654', 'Synthetic requirements: call before arrival.']) {
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 40, y: 720, size: 16, font });
}
const pdfUrl = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
const field = (key, value) => ({ key, value, page: 1, quote: `Source: ${String(value)}` });
const sample = {
  id: 'synthetic-load', lifecycleStatus: 'ready_for_offer', fileName: 'Synthetic_Confirmation_TEST-654.pdf', sourceUrl: pdfUrl,
  review: { required: true, warningFields: ['palletCount'] },
  existingFinalizedLoadId: params.has('duplicate') ? 'existing-load' : null,
  documentDetails: { version: 3, fields: [
    field('loadNumber', 'TEST-654'), field('brokerRate', 1000), field('loadedMiles', 2400), field('weightLbs', 1800),
    field('equipmentType', 'Equipment unspecified'), field('cargoDescription', 'Portable generator'), field('isHazmat', false), field('bolNumber', 'BOL-654'),
    field('broker.name', 'Example Freight'), field('broker.contactName', 'Test Broker'), field('broker.phone', '320-760-3209'), field('broker.email', 'broker@example.invalid'),
    field('pickup.city', 'Rockaway'), field('pickup.region', 'NJ'), field('pickup.addressLine', '25 Example Avenue'), field('pickup.scheduledDate', '2026-10-01'), field('pickup.timePrinted', '09:00'), field('pickup.hours', '7:00am-3:30pm M-F'),
    field('delivery.city', 'Tucson'), field('delivery.region', 'AZ'), field('delivery.addressLine', '7027 Test Way'), field('delivery.scheduledDate', '2026-10-05'), field('delivery.timePrinted', '18:00'),
    field('requirements.0', 'Call before arrival.'), field('requirements.1', 'Secure equipment and send loaded photos.'), field('specialInstructions', 'Keep the broker informed of delays.'), field('paymentTerms', 'Net 30'), field('contractTerms.0', 'Refer to the signed original.'),
  ] },
};
const drivers = [{ id: 'driver-one', name: 'Test Driver', truck: 'T-101' }];
export function Fixture() {
  const [attempts, setAttempts] = useState(0);
  const [closed, setClosed] = useState(false);
  return <div className="workspace-shell flex h-dvh">
    <Sidebar activeTab="drivers" setActiveTab={() => {}} loadsCount={1} currentUser={{ name: 'Test Admin', roleCode: 'company_admin' }} onLogout={() => {}} />
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="workspace-header"><strong>T Fleets · Import review</strong><output aria-label="Assignment attempts">{attempts}</output></header>
      <main className="workspace-main min-h-0">{closed ? <p>Back to loads</p> : <ImportedLoadPage load={sample} drivers={drivers} enableMap={false} onBack={() => setClosed(true)} onRetry={() => {}} onConfirm={async () => {
        setAttempts(value => value + 1);
        await new Promise(resolve => setTimeout(resolve, 300));
        return 'Synthetic assignment rejected';
      }} />}</main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
