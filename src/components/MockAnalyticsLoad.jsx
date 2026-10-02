import React, { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, CircleDollarSign, FileText,
  Fish, Fuel, Gauge, Package, ReceiptText, Route, Snowflake,
  Thermometer, TrendingUp, Truck,
} from 'lucide-react';
import { formatCurrency, formatNumber } from '../i18n/format';
import { mockLoad as defaultMockLoad } from '../services/mockAnalyticsLoad';
import './mock-analytics-load.css';

const TrackingMap = lazy(() => import('./TrackingMap'));
const hasMapToken = Boolean(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN?.trim());

function usd(value) { return formatCurrency(value); }
function minutes(value) { return Math.floor(value / 60) + 'h ' + String(value % 60).padStart(2, '0') + 'm'; }

const panels = {
  financials: ['revenue', 'costs', 'profit', 'distance', 'time', 'fuel', 'expenses', 'cargo', 'rate'],
  overview: ['revenue', 'profit', 'distance', 'time', 'cargo', 'rate'],
  distances: ['distance', 'time', 'fuel'],
  fuel: ['fuel', 'expenses', 'costs'],
  rate: ['revenue', 'profit', 'rate'],
};

function DemoMap({ t, load: mockLoad }) {
  return <div className="ml-map" role="region" aria-label={t('mockLoad.routeMap')}>
    {hasMapToken ? <Suspense fallback={<div className="ml-map-fallback" />}>
      <TrackingMap points={mockLoad.routePoints} routeKey={'mock-load-' + mockLoad.number}
        pickupLabel={t('mockLoad.pickup')} deliveryLabel={t('mockLoad.delivery')}
        title={t('mockLoad.routeMap')} lineColor="#087fd5" />
    </Suspense> : <div className="ml-map-fallback" aria-label={t('mockLoad.routeMap')}>
      <svg viewBox="0 0 550 240" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 0 174 Q 88 105 165 144 T 340 131 T 550 92" fill="none" stroke="#ffffff88" strokeWidth="12" />
        <path d="M 0 48 Q 152 88 242 47 T 550 25 M 0 204 Q 156 151 256 208 T 550 167" fill="none" stroke="#ffffff99" strokeWidth="7" />
        <path d="M 56 78 C 120 92 135 150 196 138 S 268 154 326 124 S 399 120 486 94" fill="none" stroke="#087fd5" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 0" />
      </svg>
    </div>}
    <div className="ml-map-tag ml-map-start"><b>A</b><span>{mockLoad.pickup.city}, {mockLoad.pickup.state}</span></div>
    <div className="ml-map-tag ml-map-end"><b>B</b><span>{mockLoad.delivery.city}, {mockLoad.delivery.state}</span></div>
    <div className="ml-map-stat"><strong>{formatNumber(mockLoad.loadedMiles)} mi</strong><small>2 d 6 h</small></div>
    <span className="ml-map-demo">DEMO</span>
  </div>;
}

function FactRow({ label, value, strong = false }) {
  return <div className={'ml-fact-row' + (strong ? ' ml-fact-total' : '')}><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}
function Card({ title, Icon, tone = 'teal', children }) {
  return <article className={'ml-card ml-card-' + tone}><h2><span className="ml-card-icon"><Icon size={19} /></span>{title}</h2><div className="ml-card-body">{children}</div></article>;
}
function RouteStop({ letter, city, facility, date, end }) {
  return <div className="ml-stop"><span className={'ml-stop-mark ' + (end ? 'is-end' : '')}>{letter}</span><div><strong>{city}</strong><span>{facility}</span><small>{date}</small></div></div>;
}

export default function MockAnalyticsLoad({ onBack, load = defaultMockLoad }) {
  const mockLoad = load;
  const { t } = useTranslation();
  const m = key => t('mockLoad.' + key);
  const [section, setSection] = useState('financials');
  const [cardPage, setCardPage] = useState(0);
  const [notice, setNotice] = useState('');
  const selected = panels[section] || [];
  const otherExpenses = mockLoad.otherExpenseItems.reduce((sum, item) => sum + item.amount, 0);
  async function share() {
    try {
      await navigator.clipboard.writeText('DEMO Load #' + mockLoad.number + ' · ' + mockLoad.pickup.city + ', ' + mockLoad.pickup.state + ' → ' + mockLoad.delivery.city + ', ' + mockLoad.delivery.state + ' · ' + usd(mockLoad.rate));
      setNotice(m('copied'));
    } catch {
      setNotice(m('copyFailed'));
    }
  }

  const cards = {
    revenue: <Card title={m('revenue')} Icon={CircleDollarSign} key="revenue">
      <FactRow label={m('rateTotal')} value={usd(mockLoad.rate)} />
      <FactRow label={m('ratePerMile')} value={usd(mockLoad.ratePerMile) + '/mi'} />
      <FactRow label={m('totalRevenue')} value={usd(mockLoad.rate)} strong />
    </Card>,
    costs: <Card title={m('totalCosts')} Icon={ReceiptText} tone="red" key="costs">
      <FactRow label={t('mockLoad.fuelFormula', { gallons: formatNumber(mockLoad.fuelGallons), price: usd(mockLoad.fuelPrice) })} value={usd(mockLoad.fuel)} />
      <FactRow label={m('tolls')} value={usd(mockLoad.tolls)} />
      <FactRow label={m('maintenance')} value={usd(mockLoad.maintenance)} />
      <FactRow label={m('otherCosts')} value={usd(mockLoad.other)} />
      <FactRow label={m('totalCosts')} value={usd(mockLoad.costs)} strong />
    </Card>,
    profit: <Card title={m('tripBalance')} Icon={TrendingUp} key="profit">
      <FactRow label={m('netTripBalance')} value={usd(mockLoad.profit)} strong />
      <FactRow label={m('perMile')} value={usd(mockLoad.profitPerMile) + '/mi'} />
      <FactRow label={m('margin')} value={formatNumber(mockLoad.margin, { maximumFractionDigits: 1 }) + '%'} />
    </Card>,
    distance: <Card title={m('distanceBreakdown')} Icon={Route} tone="blue" key="distance">
      <FactRow label={m('loadedDistance')} value={formatNumber(mockLoad.loadedMiles) + ' mi'} />
      <FactRow label={m('deadhead')} value={formatNumber(mockLoad.deadheadMiles) + ' mi'} />
      <FactRow label={m('totalDistance')} value={formatNumber(mockLoad.loadedMiles + mockLoad.deadheadMiles) + ' mi'} strong />
    </Card>,
    time: <Card title={m('timeBreakdown')} Icon={Clock3} tone="blue" key="time">
      <FactRow label={m('driveLoaded')} value={minutes(mockLoad.drivingMinutes)} />
      <FactRow label={m('driveDeadhead')} value={minutes(mockLoad.deadheadMinutes)} />
      <FactRow label={m('stops')} value={minutes(mockLoad.stopMinutes)} />
      <FactRow label={m('rest')} value={minutes(mockLoad.restMinutes)} />
      <FactRow label={m('totalTime')} value={minutes(mockLoad.drivingMinutes + mockLoad.deadheadMinutes + mockLoad.stopMinutes + mockLoad.restMinutes)} strong />
    </Card>,
    fuel: <Card title={m('fuelCalculation')} Icon={Fuel} tone="blue" key="fuel">
      <FactRow label={m('fuelEconomy')} value={formatNumber(mockLoad.loadedMiles / mockLoad.fuelGallons, { maximumFractionDigits: 1 }) + ' MPG'} />
      <FactRow label={m('fuelNeeded')} value={formatNumber(mockLoad.fuelGallons) + ' gal'} />
      <FactRow label={m('fuelPrice')} value={usd(mockLoad.fuelPrice) + '/gal'} />
      <FactRow label={m('fuelCost')} value={usd(mockLoad.fuel)} strong />
    </Card>,
    expenses: <Card title={m('additionalExpenses')} Icon={FileText} tone="blue" key="expenses">
      {mockLoad.otherExpenseItems.map(item => <FactRow key={item.name} label={m(item.name === 'Tolls' ? 'tolls' : item.name === 'Parking' ? 'parking' : item.name === 'Truck wash' ? 'truckWash' : 'otherCosts')} value={usd(item.amount)} />)}
      <FactRow label={m('total')} value={usd(otherExpenses)} strong />
    </Card>,
    cargo: <Card title={m('cargoDetails')} Icon={Package} tone="blue" key="cargo">
      <FactRow label={m('commodity')} value={mockLoad.cargo} />
      <FactRow label={m('temperature')} value={mockLoad.temperature} />
      <FactRow label={m('weight')} value={formatNumber(mockLoad.weightLbs) + ' lb'} />
      <FactRow label={m('trailer')} value={mockLoad.equipment} />
      <FactRow label={m('pallets')} value={formatNumber(mockLoad.pallets)} />
    </Card>,
    rate: <Card title={m('rateAnalysis')} Icon={Gauge} tone="blue" key="rate">
      <FactRow label={m('ratePerMile')} value={usd(mockLoad.ratePerMile) + '/mi'} />
      <FactRow label={m('loadedDistance')} value={formatNumber(mockLoad.loadedMiles) + ' mi'} />
      <FactRow label={m('rateTotal')} value={usd(mockLoad.rate)} strong />
      <p className="ml-card-note">{m('mockEstimate')}</p>
    </Card>,
  };

  return <section className="mock-load-page" aria-label={m('pageTitle')}>
    <div className="ml-page-top"><button type="button" className="ml-back" onClick={onBack}><ArrowLeft size={17} />{m('back')}</button><div className="ml-top-actions">
      <button type="button" onClick={() => setSection('documents')}><FileText size={16} />{m('viewDocuments')}</button>
      <button type="button" onClick={share}><Copy size={16} />{m('share')}</button>
    </div></div>
    <div className="ml-hero"><div className="ml-hero-left">
      <div className="ml-heading"><h1>Load #{mockLoad.number}</h1><span className={'ml-delivered ' + (mockLoad.status === 'active' ? 'is-active' : '')}>{m(mockLoad.status === 'active' ? 'activeStatus' : 'delivered')}</span><span className="ml-demo-tag">DEMO</span></div>
      <p className="ml-refs">PU# {mockLoad.pickupRef}&nbsp;&nbsp;&nbsp; DEL# {mockLoad.deliveryRef}</p>
      <div className="ml-badges"><span><Snowflake size={15} />Reefer</span><span className="ml-cold"><Thermometer size={15} />{mockLoad.temperature}</span><span><Fish size={15} />{mockLoad.cargo}</span><span><Truck size={15} />53′</span></div>
      <div className="ml-stops"><RouteStop letter="A" city={mockLoad.pickup.city + ', ' + mockLoad.pickup.state} facility={mockLoad.pickup.facility} date={mockLoad.pickup.date} />
        <div className="ml-distance"><strong>{formatNumber(mockLoad.loadedMiles)} mi</strong><span>→</span></div>
        <RouteStop letter="B" end city={mockLoad.delivery.city + ', ' + mockLoad.delivery.state} facility={mockLoad.delivery.facility} date={mockLoad.delivery.date} /></div>
    </div><DemoMap t={t} load={mockLoad} /></div>
    <nav className="ml-tabs" aria-label={m('sections')}>{['overview','financials','distances','fuel','rate','documents','activity'].map(key => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setCardPage(0); }}>{m('tabs.' + key)}</button>)}</nav>
    {notice && <p className="ml-notice" role="status">{notice}</p>}
    {section === 'documents' ? <div className="ml-single-panel"><Card title={m('viewDocuments')} Icon={FileText}><p className="ml-card-note">{m('noDocuments')}</p></Card></div>
    : section === 'activity' ? <div className="ml-single-panel"><Card title={m('tabs.activity')} Icon={CalendarDays}><FactRow label={m('pickup')} value={mockLoad.pickup.date} /><FactRow label={m('delivery')} value={mockLoad.delivery.date} /><p className="ml-card-note">{m('sampleOnly')}</p></Card></div>
    : <><div className={'ml-cards ' + (section === 'financials' ? 'ml-financial-cards' : 'ml-filtered-cards')} data-page={cardPage}>{selected.map(key => cards[key])}</div>
      <div className="ml-mobile-pages"><button type="button" aria-label={m('previous')} disabled={cardPage === 0} onClick={() => setCardPage(page => page - 1)}><ChevronLeft size={16} /></button><span>{cardPage + 1} / {Math.ceil(selected.length / 2)}</span><button type="button" aria-label={m('next')} disabled={cardPage >= Math.ceil(selected.length / 2) - 1} onClick={() => setCardPage(page => page + 1)}><ChevronRight size={16} /></button></div></>}
    <p className="ml-disclaimer">{m('sampleOnly')}</p>
  </section>;
}
