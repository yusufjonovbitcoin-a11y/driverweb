import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from '../../src/i18n/index';
import DatePicker, { DateRangePicker } from '../../src/components/CalendarPicker';
import AccountingDateFilter from '../../src/components/AccountingDateFilter';
import { periodFor } from '../../src/components/settlements/calculation.js';
import useModalFocus from '../../src/hooks/useModalFocus';
import '../../src/index.css';
import '../../src/workspace-design.css';
await i18n.changeLanguage(new URLSearchParams(location.search).get('locale') || 'ru');
export function TestModal({ native, onClose }) {
  const ref = useRef(null), [day, setDay] = useState('2026-10-08');
  useModalFocus(ref, { open: !native, onClose });
  useEffect(() => { if (native) ref.current.showModal(); }, [native]);
  const Tag = native ? 'dialog' : 'section';
  return <Tag ref={ref} role="dialog" aria-label="Test finance dialog" aria-modal="true" onCancel={event => { event.preventDefault(); onClose(); }} style={{ position: 'fixed', inset: 16, margin: 'auto', width: 'min(360px,calc(100vw - 32px))', height: 220, overflow: 'auto', padding: 16, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 12, zIndex: 1000 }}>
    <button onClick={onClose}>Close test modal</button><div style={{ transform: 'translateZ(0)', marginTop: 75 }}><label>Modal date<DatePicker calendarTitle="Modal calendar" value={day} onChange={event => setDay(event.target.value)} /></label></div>
  </Tag>;
}
export function Fixture() {
  const [range, setRange] = useState({ from: '2026-10-05', to: '2026-10-07' }), [accounting, setAccounting] = useState({ from: '2026-10-12', to: '2026-10-18' });
  const [date, setDate] = useState('2026-10-08'), [saved, setSaved] = useState(''), [modal, setModal] = useState(null), [dark, setDark] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  return <div className="workspace-shell"><main className="workspace-main" style={{ display: 'grid', gap: 24, padding: 24, overflow: 'auto', height: '100dvh', alignContent: 'start' }}>
    <button onClick={() => setDark(value => !value)}>Toggle test theme</button>
    <section><DateRangePicker value={range} onChange={setRange} triggerLabel="Test range calendar" /><output aria-label="Selected range">{range.from}|{range.to}</output></section>
    <section><AccountingDateFilter value={accounting} onChange={setAccounting} label="Accounting period" allowReset={false} periodForDate={day => periodFor('week', day)} /><output aria-label="Accounting range">{accounting.from}|{accounting.to}</output></section>
    <form onSubmit={event => { event.preventDefault(); setSaved(date); }} data-date-form>
      <div data-single-picker><label>Invoice date<DatePicker required calendarTitle="Invoice calendar" min="2026-10-05" max="2026-10-20" value={date} onChange={event => setDate(event.target.value)} /></label></div>
      <button type="submit">Save test form</button><output aria-label="Saved date">{saved}</output>
    </form>
    <fieldset disabled><label>Disabled date<DatePicker value="2026-10-08" onChange={() => { throw Error('Disabled input changed'); }} /></label></fieldset>
    <button onClick={() => setModal('custom')}>Open custom modal</button><button onClick={() => setModal('native')}>Open native modal</button>
    {modal && <TestModal native={modal === 'native'} onClose={() => setModal(null)} />}
  </main></div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
