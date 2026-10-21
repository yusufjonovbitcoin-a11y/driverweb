import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, MessageCircle, Phone, Search, Truck, TriangleAlert, X } from 'lucide-react';
import { arrivalJobs, arrivalLane, arrivalMatches, arrivalPhone, arrivalState } from './arrivalBoardModel.js';
import { useArrivalEstimates } from '../hooks/useArrivalEstimates.js';
import './arrival-board.css';

const PROBLEMS = new Set(['risk', 'late', 'noGps', 'unknown']);
const FILTERS = ['all', 'problems', 'pickup', 'delivery'];

function duration(milliseconds, t) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? t('arrival.hoursMinutes', { hours, minutes: minutes % 60 }) : t('arrival.minutes', { minutes });
}

function ArrivalCard({ job, state, now, clock, date, t, onOpenChat, onOpenLoad }) {
  const [failedAvatar, setFailedAvatar] = useState(null);
  const { driver, load } = job;
  const phone = arrivalPhone(driver.phone);
  const isProblem = load && PROBLEMS.has(state.status);
  const eta = state.eta;
  const initials = (driver.name || '?').split(' ').map(part => part[0]).slice(0, 2).join('');
  const gpsAge = job.location ? duration(now - job.location.observedAt, t) : null;
  const issue = state.issue === 'late' ? t('arrival.lateBy', { duration: duration(state.minutes * 60_000, t) })
    : state.issue === 'noGps' && gpsAge ? t('arrival.gpsAge', { duration: gpsAge })
      : t(`arrival.issue.${state.issue}`);
  return <article className={`arrival-card arrival-tone-${state.status}`}>
    <div className="arrival-card-heading">
      <span className="arrival-avatar">{driver.avatar && failedAvatar !== driver.avatar
        ? <img src={driver.avatar} alt="" onError={() => setFailedAvatar(driver.avatar)} /> : initials}</span>
      <div className="arrival-person"><strong>{driver.name || t('arrival.driver')}</strong>
        {load ? <button className="arrival-load-link" onClick={() => onOpenLoad(load)}>{load.loadNumber}</button>
          : <small>{driver.driverNumber}</small>}</div>
      <span className="arrival-badge">{t(`arrival.status.${state.status}`)}</span>
    </div>
    {load ? <>
      <div className="arrival-route"><span title={job.origin}>{job.origin}</span><ArrowRight size={14} aria-hidden="true" /><span title={job.destination}>{job.destination}</span></div>
      <div className="arrival-times">
        <div><strong>{eta === null ? '—' : `≈ ${clock(eta)}`}</strong><small>{t('arrival.eta')}{eta !== null && date(eta) !== date(now) ? ` · ${date(eta)}` : ''}</small></div>
        <div><strong>{eta === null ? '—' : duration(eta - now, t)}</strong><small>{t('arrival.remaining')}</small></div>
      </div>
      <div className="arrival-schedule"><CalendarDays size={13} aria-hidden="true" /><span>{t(`arrival.${job.role}`)} · {job.scheduledAt === null ? t('arrival.noSchedule') : `${date(job.scheduledAt)} · ${clock(job.scheduledAt)}`}</span></div>
      <div className={`arrival-route-track ${job.role === 'delivery' ? 'is-delivery' : ''}`} aria-label={t(`arrival.stage.${job.role}`)}>
        <span className="arrival-route-dot" /><span className="arrival-route-line" /><Truck className="arrival-route-truck" size={20} /><MapPin size={19} />
      </div>
      <div className="arrival-route-captions"><span>{t(`arrival.stage.${job.role}`)}</span><span>{t('arrival.nextStop')}</span></div>
    </> : <div className="arrival-idle"><Truck size={28} aria-hidden="true" /><p>{t('arrival.noActiveLoad')}</p><small>{driver.truck || '—'}</small></div>}
    <div className="arrival-card-footer">
      <span className="arrival-issue" title={issue}>{isProblem ? <TriangleAlert size={16} /> : state.status === 'onTime' ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}<span>{issue}</span></span>
      <button className="arrival-icon" onClick={() => onOpenChat(driver)} aria-label={t('arrival.chatWith', { name: driver.name })} title={t('nav.chat')}><MessageCircle size={17} /></button>
      {phone ? <a className="arrival-icon" href={phone} aria-label={t('arrival.call', { name: driver.name })} title={driver.phone}><Phone size={17} /></a>
        : <button className="arrival-icon" disabled aria-label={t('arrival.noPhone')} title={t('arrival.noPhone')}><Phone size={17} /></button>}
    </div>
  </article>;
}

export default function ArrivalBoard({ drivers = [], loads = [], searchQuery = '', timeZone, onOpenChat, onOpenLoad, onClearSearch }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const [filter, setFilter] = useState('all');
  const [grouping, setGrouping] = useState('time');
  const [period, setPeriod] = useState('all');
  const [query, setQuery] = useState('');
  const [dismissedAlert, setDismissedAlert] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const jobs = useMemo(() => arrivalJobs(drivers, loads, now), [drivers, loads, now]);
  const estimates = useArrivalEstimates(jobs, now);
  const locale = i18n.resolvedLanguage || i18n.language;
  const clockFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [locale, timeZone]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: 'short' }), [locale, timeZone]);
  const clock = value => clockFormatter.format(value);
  const date = value => dateFormatter.format(value);
  const all = jobs.map(job => ({ job, state: arrivalState(job, estimates[job.id], now) }));
  const matching = all.filter(({ job, state }) => arrivalMatches(job, `${searchQuery} ${query}`)
    && (period === 'all' || state.eta === null || state.eta - now <= Number(period) * 3_600_000));
  const problems = matching.filter(({ job, state }) => job.load && PROBLEMS.has(state.status));
  const alertKey = problems.map(({ job, state }) => `${job.id}:${state.status}`).sort().join('|');
  const shown = matching.filter(({ job, state }) => filter === 'all' || (filter === 'problems' ? job.load && PROBLEMS.has(state.status) : job.role === filter));
  const lanes = grouping === 'time' ? ['soon', 'next', 'later'] : ['onTime', 'risk', 'late'];
  const laneFor = ({ state }) => grouping === 'time' ? arrivalLane(state.eta, now)
    : state.status === 'noGps' ? 'risk' : lanes.includes(state.status) ? state.status : 'unknown';
  const sorted = [...shown].sort((a, b) => (a.state.eta ?? Infinity) - (b.state.eta ?? Infinity) || String(a.job.driver.name).localeCompare(String(b.job.driver.name)));
  const unknown = sorted.filter(item => laneFor(item) === 'unknown');
  const card = ({ job, state }) => <ArrivalCard key={job.id} {...{ job, state, now, clock, date, t, onOpenChat, onOpenLoad }} />;
  return <section className="arrival-board" aria-labelledby="arrival-title">
    <header className="arrival-heading"><div><h2 id="arrival-title">{t('arrival.title')}</h2><p>{t('arrival.subtitle')}</p></div>
      <div className="arrival-date-controls"><label><CalendarDays size={17} aria-hidden="true" /><select aria-label={t('arrival.period')} value={period} onChange={event => setPeriod(event.target.value)}>
        <option value="all">{t('arrival.allActive')}</option><option value="24">{t('arrival.next24')}</option><option value="48">{t('arrival.next48')}</option></select></label>
        <span className="arrival-clock">{clock(now)}<small>{timeZone}</small></span></div>
    </header>
    <div className="arrival-summary"><strong>{t('arrival.driverCount', { count: new Set(matching.map(item => item.job.driver.id)).size })}</strong>
      {['onTime', 'risk', 'late', 'noGps'].map(status => <span key={status} className={`arrival-summary-status arrival-tone-${status}`}><i />{matching.filter(item => item.state.status === status).length} {t(`arrival.status.${status}`)}</span>)}
    </div>
    {problems.length > 0 && dismissedAlert !== alertKey && <div className="arrival-alert" role="status"><TriangleAlert size={20} aria-hidden="true" />
      <button onClick={() => setFilter('problems')}><strong>{t('arrival.attention')}</strong> {problems.slice(0, 3).map(({ job, state }) => `${job.driver.name} — ${t(`arrival.status.${state.status}`)}`).join(' · ')}{problems.length > 3 ? ` +${problems.length - 3}` : ''}</button>
      <button className="arrival-alert-close" aria-label={t('common.dismiss')} onClick={() => setDismissedAlert(alertKey)}><X size={17} /></button></div>}
    <div className="arrival-toolbar"><div className="arrival-filters" role="group" aria-label={t('arrival.filters')}>
      {FILTERS.map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === 'pickup' ? <Truck size={16} /> : key === 'delivery' ? <MapPin size={16} /> : null}{t(`arrival.${key}`)}{key === 'problems' && problems.length > 0 && <b>{problems.length}</b>}</button>)}
    </div><div className="arrival-view" role="group" aria-label={t('arrival.grouping')}><button aria-pressed={grouping === 'time'} onClick={() => setGrouping('time')}>{t('arrival.byTime')}</button><button aria-pressed={grouping === 'status'} onClick={() => setGrouping('status')}>{t('arrival.byStatus')}</button></div></div>
    <label className="arrival-search"><Search size={16} /><input type="search" aria-label={t('arrival.search')} placeholder={t('arrival.search')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    {!shown.length ? <div className="arrival-empty"><Truck size={32} /><h3>{t('arrival.empty')}</h3><p>{t(drivers.length ? 'arrival.changeFilters' : 'arrival.addDrivers')}</p>
      {drivers.length > 0 && <button onClick={() => { setFilter('all'); setQuery(''); setPeriod('all'); onClearSearch?.(); }}>{t('arrival.reset')}</button>}</div>
      : <><div className="arrival-lanes">{lanes.map((lane, index) => <section className={`arrival-lane arrival-lane-${index}`} key={lane} aria-labelledby={`arrival-lane-${lane}`}>
        <div className="arrival-lane-heading"><h3 id={`arrival-lane-${lane}`}>{t(`arrival.lane.${lane}`)}</h3><p>{grouping === 'time' && <>{t(`arrival.range.${lane}`)} · </>}{t('arrival.cardCount', { count: sorted.filter(item => laneFor(item) === lane).length })}</p></div>
        <div className="arrival-stack">{sorted.filter(item => laneFor(item) === lane).map(card)}{!sorted.some(item => laneFor(item) === lane) && <p className="arrival-lane-empty">{t('arrival.noArrivals')}</p>}</div>
      </section>)}</div>
      {unknown.length > 0 && <section className="arrival-unknown"><h3>{t('arrival.lane.unknown')} <span>{unknown.length}</span></h3><p>{t('arrival.unknownHelp')}</p><div className="arrival-unknown-grid">{unknown.map(card)}</div></section>}</>}
    <footer className="arrival-footer"><div>{['onTime', 'risk', 'late', 'noGps'].map(status => <span key={status} className={`arrival-summary-status arrival-tone-${status}`}><i />{t(`arrival.status.${status}`)}</span>)}</div><p>{t('arrival.estimateNote')}</p></footer>
  </section>;
}
