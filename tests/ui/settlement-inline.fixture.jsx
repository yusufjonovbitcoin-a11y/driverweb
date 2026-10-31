import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/workspace-design.css';
import '../../src/components/settlements/settlements.css';
import { setAppLocale } from '../../src/i18n/index.js';
import { calculateSettlement, effectiveSettings } from '../../src/components/settlements/calculation.js';
import { createDemoApi, demoDrivers, demoInitialView, demoLoads } from '../fixtures/settlement-samples.js';
import SettlementPdfReview from '../../src/components/settlements/SettlementPdfReview.jsx';
import Statement from '../../src/components/settlements/Statement.jsx';
import { approveSettlement } from '../../src/components/settlements/settlementReviewModel.js';
import { calculatedStatementSnapshot } from '../../src/components/settlements/calculatedLoads.js';

await setAppLocale('en', { persist: false });
const record = await createDemoApi().readCalculationSettings();
const source = {
  driver: demoDrivers[0], version: record.version, company: { name: 'T Fleets DEMO' },
  calculation: calculateSettlement(demoLoads.filter(load => demoInitialView.selected.includes(load.id)), effectiveSettings(record, demoDrivers[0].id), demoInitialView.period),
};
export function Fixture() {
  const deliveryMode = new URLSearchParams(location.search).has('delivery');
  const demoMode = new URLSearchParams(location.search).has('demo');
  const [open, setOpen] = useState(true);
  const [approved, setApproved] = useState(null);
  const [pdf, setPdf] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [deliveredNet, setDeliveredNet] = useState(null);
  const approvedSnapshot = useMemo(() => approved ? calculatedStatementSnapshot(approved, demoMode) : null, [approved, demoMode]);
  async function deliveryApi({ snapshot, blob }) {
    setAttempts(value => value + 1);
    await new Promise(resolve => setTimeout(resolve, 250));
    if (attempts === 0) throw Error('synthetic first transfer failed');
    if (blob.type !== 'application/pdf' || !blob.size) throw Error('invalid fixture PDF');
    setDeliveredNet(snapshot.calculation.net);
    return { id: snapshot.deliveryId };
  }
  return <>
    <button onClick={() => setOpen(true)}>Edit settlement</button>
    {open && <SettlementPdfReview source={source} onClose={() => setOpen(false)} onApprove={snapshot => { setApproved(approveSettlement(snapshot)); setOpen(false); }} />}
    {approved && <><output aria-label="Approved Net">{approved.calculation.net}</output><button onClick={() => setPdf(true)}>Reopen approved PDF</button></>}
    <output aria-label="Delivery attempts">{attempts}</output><output aria-label="Delivered Net">{deliveredNet}</output>
    {pdf && <Statement snapshot={approvedSnapshot} canSendToDriver={deliveryMode} deliveryApi={deliveryApi} onClose={() => setPdf(false)} />}
  </>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
