import React, { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import '../../src/index.css';
import '../../src/workspace-design.css';
import { setAppLocale } from '../../src/i18n/index.js';
import Sidebar from '../../src/components/Sidebar.jsx';
import ImportedLoadPage from '../../src/components/ImportedLoadPage.jsx';
import { applyConfirmedLoadAssignment, completeLoadAssignment } from '../../src/services/loadAssignment.js';
import BackgroundAssignments from '../../src/components/BackgroundAssignments.jsx';
import { useBackgroundAssignments } from '../../src/hooks/useBackgroundAssignments.js';

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
  review: { required: true, warningFields: ['palletCount'], issues: params.has('conflict') ? [
    { field: 'stops.1.postalCode', reason: 'conflicting_postal_codes', alternatives: ['19607', '19611'] },
  ] : [] },
  existingFinalizedLoadId: params.has('duplicate') ? 'existing-load' : null,
  documentDetails: { version: 3, issues: params.has('conflict') ? [
    { field: 'stops.1.postalCode', reason: 'conflicting_postal_codes', alternatives: ['19607', '19611'] },
  ] : [], fields: [
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
  const [assigned, setAssigned] = useState([]);
  const [screen, setScreen] = useState('drivers');
  const [reviewDriver, setReviewDriver] = useState(null);
  const response = useRef(null);
  const { queue, tasks } = useBackgroundAssignments('test-admin');
  return <div className="workspace-shell flex h-dvh">
    <Sidebar activeTab="drivers" setActiveTab={() => {}} loadsCount={1} currentUser={{ name: 'Test Admin', roleCode: 'company_admin' }} onLogout={() => {}} />
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="workspace-header"><strong>T Fleets · Import review</strong><output aria-label="Assignment attempts">{attempts}</output>
        {params.has('background') && <nav className="flex gap-4"><button onClick={() => setScreen('drivers')}>Drivers</button><button onClick={() => setScreen('analytics')}>Analytics</button></nav>}
      </header>
      <BackgroundAssignments tasks={tasks} onRetry={queue.retry} onDismiss={queue.dismiss} onReview={key => {
        const input = queue.takeForReview(key); if (input) { setReviewDriver(input.driverId); setClosed(false); }
      }} reviewDisabled={!closed} />
      {params.has('background') && closed && <div className="m-5 flex gap-4 text-sm">
        <span>Isolated UI check · synthetic data</span>
        <button disabled={!tasks.some(task => task.status === 'pending')} onClick={() => response.current?.resolve({ id: 'test-assignment', load_id: sample.id, driver_id: drivers[0].id, status: 'active' })}>Finish assignment</button>
        <button disabled={!tasks.some(task => task.status === 'pending')} onClick={() => response.current?.reject(Error('Synthetic connection interrupted'))}>Simulate failure</button>
      </div>}
      <main className="workspace-main min-h-0">{screen === 'analytics' ? <section className="review-card m-6 space-y-4"><h1 className="text-xl font-bold">Analytics</h1>
        <p>You can keep working while assignment is pending.</p>{Boolean(assigned.length) && <p role="status">Assignment confirmed</p>}</section>
        : assigned.length ? <section className="review-card m-6 space-y-4">
        <p className="review-muted">Isolated UI check · synthetic data</p><h1 className="text-xl font-bold">Driver assigned</h1>
        <table className="w-full text-left text-sm"><thead><tr><th>Driver</th><th>Load</th><th>Status</th></tr></thead>
          <tbody><tr><td>Test Driver</td><td>{assigned[0].loadNumber}</td><td>Assigned</td></tr></tbody></table>
        <p>Assignment confirmed. Workspace refresh is still pending.</p>
      </section> : closed ? <section className="review-card m-6 space-y-4"><h1 className="text-xl font-bold">Drivers</h1><p>Back to loads</p>
        <table className="w-full text-left text-sm"><thead><tr><th>Driver</th><th>Load</th><th>Status</th></tr></thead><tbody><tr><td>Test Driver</td><td>—</td><td>Not assigned</td></tr></tbody></table>
      </section> : <ImportedLoadPage load={{ ...sample, preferredDriverId: reviewDriver }} drivers={drivers} enableMap={false} onBack={() => setClosed(true)} onRetry={() => {}} onConfirm={async driverIds => {
        if (params.has('background')) {
          queue.start({ key: 'synthetic-checksum', label: '#TEST-654', driverName: drivers[0].name,
            input: { actorId: 'test-admin', driverId: driverIds[0] },
            perform: () => { setAttempts(value => value + 1); return new Promise((resolve, reject) => { response.current = { resolve, reject }; }); },
            formatError: error => error.message,
            confirmed: result => setAssigned(applyConfirmedLoadAssignment([], { ...sample, loadNumber: 'TEST-654' }, drivers[0].id, result)),
          });
          setClosed(true); return true;
        }
        setAttempts(value => value + 1);
        if (params.has('assignmentSuccess')) {
          await completeLoadAssignment({ assign: async () => {
            await new Promise(resolve => setTimeout(resolve, 300));
            return { id: 'test-assignment', load_id: sample.id, driver_id: drivers[0].id, status: 'active', driver_stage: 'accepted' };
          }, confirmed: result => setAssigned(applyConfirmedLoadAssignment([], { ...sample, loadNumber: 'TEST-654' }, drivers[0].id, result)),
          refresh: () => new Promise(() => {}) });
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        return 'Synthetic assignment rejected';
      }} />}</main>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
