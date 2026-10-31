import React, { StrictMode, useEffect, useState } from 'react';
import i18n from '../../src/i18n/index';
import { createRoot } from 'react-dom/client';
import AnalyticsOverview from '../../src/components/AnalyticsOverview.jsx';
import { WorkspaceCache } from '../../src/hooks/WorkspaceCache';
import { financialSource, roster } from './financial-source.js';
import { calculateSettlement, effectiveSettings } from '../../src/components/settlements/calculation.js';
import { approveSettlement, reviewSettlement, settlementDraft } from '../../src/components/settlements/settlementReviewModel.js';
import { timeZonePreference } from '../../src/i18n/timeZone.js';
import '../../src/index.css';
import '../../src/workspace-design.css';
import '../../src/components/driver-roster-list.css';
import '../../src/components/profileCenter.css';
import '../../src/components/settlements/settlements.css';
import '../legacy/src/components/finance/finance.css';
await i18n.changeLanguage('ru');
function TypographySamples() {
  return <div style={{ padding: 20, overflow: 'auto', height: '100%' }}>
    <h1>Workspace type scale</h1>
    {['drivers-roster-page', 'profile-center', 'ds-workspace', 'fin-workspace'].map(kind => <section key={kind} className={kind} data-type-sample={kind} style={{ marginBlock: 18, overflow: 'auto' }}>
      <h2>Section title</h2><p>Page description</p>
      <nav className="profile-center-nav"><button role="tab">Tab label</button></nav>
      <label>Form label<input placeholder="Search records" /></label>
      <table className={kind === 'drivers-roster-page' ? 'drivers-roster-table' : 'ds-load-table'}><thead><tr><th>Driver</th><th>Amount</th></tr></thead><tbody><tr><td><strong>Maria Santos</strong><small>Supplementary details</small></td><td>$15,600.00</td></tr></tbody></table>
    </section>)}
  </div>;
}
export function Fixture() {
  const localeControls = <>{new URLSearchParams(location.search).has('locales') && <div>{['ru','en','uz'].map(code => <button key={code} onClick={() => i18n.changeLanguage(code)}>Language {code}</button>)}</div>}{new URLSearchParams(location.search).get('case') === 'boundary' && <div>{['America/New_York','America/Los_Angeles'].map(zone => <button key={zone} onClick={() => timeZonePreference.set(zone)}>{zone}</button>)}</div>}</>;
  const [dark, setDark] = useState(false);
  const [message, setMessage] = useState('');
  const [scopeId, setScopeId] = useState(() => new URLSearchParams(location.search).get('scope') || '');
  const scopeDriver = scopeId ? roster.find(driver => driver.id === scopeId) || { id: scopeId, name: 'Driver without trips' } : undefined;
  const [api] = useState(() => {
    const mode = new URLSearchParams(location.search).get('case');
    let source = financialSource(), reads = 0, networkDown = mode === 'error';
    if (mode === 'empty') { source.rows = []; source.loads = []; source.pay = []; }
    if (mode === 'unknown') { source.settings = null; source.pay = []; source.rows.forEach(row => { row.driver_pay = null; row.fuel_cost = null; }); }
    if (mode === 'boundary') source.rows[0].trip_date = '2026-10-02T05:30:00Z';
    if (mode === 'approved') {
      const loads = source.rows.slice(0,2).map(row => ({id:row.id,loadNumber:row.load_number,driverId:row.driver_id,rate:row.contract_amount}));
      const original = {driver:roster[0],version:1,company:{name:'Isolated test'},calculation:calculateSettlement(loads,effectiveSettings(source.settings,'alpha'),{from:'2026-10-01',to:'2026-10-14'})};
      const draft = settlementDraft(original); draft.netOverride='2200.01'; draft.loads[0].netOverride='850';
      const approved = approveSettlement(reviewSettlement(original,draft));
      source.settlements=[{id:approved.deliveryId,number:1,driverId:'alpha',calculation:approved.calculation}];
      source.rows[0].additional_income='100'; source.rows[0].broker_paid='950';
    }
    return {
      read: async () => {
        reads++;
        if (mode === 'permission') throw Object.assign(Error('ACCOUNTING_PERMISSION'), { code: '42501' });
        if (networkDown || mode === 'stale' && reads > 1) throw Error('Network unavailable');
        if (mode === 'concurrent' && reads === 2) Object.assign(source.rows[0], {driver_pay:'900',accounting_version:1});
        return structuredClone(source);
      },
      recover: () => { networkDown = false; },
      save: async (row, amounts, notes) => {
        if (mode === 'conflict') throw Error('ACCOUNTING_CONFLICT');
        const stored = source.rows.find(item => item.id === row.id);
        if (stored.accounting_version !== row.accounting_version) throw Error('ACCOUNTING_CONFLICT');
        Object.assign(stored, amounts, { notes, accounting_version: stored.accounting_version + 1 });
        setMessage(`saved:${row.id}`);
      },
    };
  });
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return <WorkspaceCache><div className="workspace-shell flex"><aside className="workspace-sidebar" style={{width:64, flexShrink:0}}>Original sidebar</aside><div style={{ flex: 1, minWidth: 0, height: '100dvh', display: 'flex', flexDirection: 'column' }}><header className="workspace-header"><span>Original header</span>{localeControls}<button aria-label={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setDark(value => !value)}>Тема</button>{new URLSearchParams(location.search).get("case") === "error" && <button onClick={() => api.recover()}>Restore test network</button>}{new URLSearchParams(location.search).has('scope') && <div>{roster.map(driver => <button key={driver.id} onClick={() => setScopeId(driver.id)}>Open {driver.id}</button>)}<button onClick={() => setScopeId('')}>Company analytics</button></div>}<output aria-label="Fixture action">{message}</output></header><main className="workspace-main" style={{ flex: 1, minHeight: 0 }}>{new URLSearchParams(location.search).has('typography') ? <TypographySamples /> : <AnalyticsOverview scopeDriver={scopeDriver} drivers={roster} api={api} canEditAccounting onOpenLoad={id => setMessage(`load:${id}`)} onOpenAccountingSettings={() => setMessage('accounting-settings')} />}</main></div></div></WorkspaceCache>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
