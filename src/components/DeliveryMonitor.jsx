import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock3, Info, MapPin, MinusCircle, Truck, TriangleAlert } from 'lucide-react';
import { formatAppointment, formatTime } from '../i18n/format';
import { displayDayKey, timeZonePreference } from '../i18n/timeZone.js';
import { arrivalMatches } from './arrivalBoardModel.js';
import { compareDeliveryRows, deliveryMonitorGroup } from './deliveryMonitorModel.js';
import './delivery-monitor.css';

const GROUPS = ['attention', 'onTime', 'idle'];
function duration(milliseconds, t) {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  return minutes >= 60 ? t('arrival.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t('arrival.minutes', { minutes });
}

export default function DeliveryMonitor({ drivers, monitoring, demo, onDemoChange, query, onOpenDriver, onOpenLoad, onAssignLoad, onOpenChat }) {
  const { t } = useTranslation();
  const { now } = monitoring;
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('priority');
  const [collapsed, setCollapsed] = useState({});
  const [menu, setMenu] = useState(null);
  const zone = useSyncExternalStore(timeZonePreference.subscribe, timeZonePreference.getSnapshot, timeZonePreference.getSnapshot);
  useEffect(() => {
    if (!menu) return;
    const close = event => { if (event.key === 'Escape' || event.type === 'pointerdown' && !event.target.closest('.delivery-actions-menu')) setMenu(null); };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [menu]);
  const driverIds = useMemo(() => new Set(drivers.map(driver => driver.id)), [drivers]);
  const all = demo ? monitoring.rows : monitoring.rows.filter(({ job }) => driverIds.has(job.driver.id));
  const matching = all.filter(({ job }) => arrivalMatches(job, query));
  const rows = matching.filter(({ state }) => filter === 'all' || deliveryMonitorGroup(state) === filter)
    .sort(sort === 'name' ? (a, b) => String(a.job.driver.name).localeCompare(String(b.job.driver.name)) : sort === 'appointment'
      ? (a, b) => (a.job.scheduledAt ?? Infinity) - (b.job.scheduledAt ?? Infinity) : compareDeliveryRows);
  const counts = group => matching.filter(({ state }) => deliveryMonitorGroup(state) === group).length;
  return <div className="delivery-monitor">
    <div className="delivery-toolbar">
      <nav className="delivery-group-tabs" aria-label={t('deliveryMonitor.groups')}>
        {['all', ...GROUPS].map(group => <button type="button" key={group} aria-pressed={filter === group} onClick={() => setFilter(group)}>{t(`deliveryMonitor.${group}`)} <span>({group === 'all' ? matching.length : counts(group)})</span></button>)}
      </nav>
      <div className="delivery-controls"><label><span className="sr-only">{t('deliveryMonitor.sort')}</span><select value={sort} onChange={event => setSort(event.target.value)}>{['priority', 'appointment', 'name'].map(key => <option key={key} value={key}>{t(`deliveryMonitor.sort_${key}`)}</option>)}</select></label>
        <button type="button" className="delivery-demo-toggle" aria-pressed={demo} onClick={() => { onDemoChange(!demo); setMenu(null); }}>{t(demo ? 'arrival.showLive' : 'arrival.showDemo')}</button>
      </div>
    </div>
    {demo && <p className="delivery-demo-note" role="status">{t('arrival.demoNotice')}</p>}
    <p className="delivery-zone"><Clock3 size={13} />{t('deliveryMonitor.asOf', { time: formatTime(now) })} · {zone}</p>
    {GROUPS.map(group => {
      const items = rows.filter(({ state }) => deliveryMonitorGroup(state) === group);
      if (!items.length) return null;
      const Icon = group === 'attention' ? TriangleAlert : group === 'onTime' ? CheckCircle2 : MinusCircle;
      return <section className={`delivery-section delivery-section-${group}`} key={group}>
        <h2><button type="button" aria-expanded={!collapsed[group]} aria-controls={`delivery-group-${group}`} onClick={() => setCollapsed(value => ({ ...value, [group]: !value[group] }))}>{collapsed[group] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<Icon size={20} /><span>{t(`deliveryMonitor.${group}`)}</span><small>{items.length}</small></button></h2>
        <div id={`delivery-group-${group}`} hidden={Boolean(collapsed[group])} className="delivery-group-content" role="region" aria-label={t(`deliveryMonitor.${group}`)}>
          <div className="delivery-column-head" aria-hidden="true">{['driver', 'load', 'location', 'delivery', 'appointment'].map(key => <span key={key}>{t(`deliveryMonitor.${key}`)}</span>)}<span /></div>
          {items.map(({ job, state }) => {
            const { driver, load } = job;
            const gpsAge = job.location ? duration(now - job.location.observedAt, t) : null;
            const place = job.demo ? job.origin : driver.currentLocation || (job.location ? `${job.location.lat.toFixed(3)}, ${job.location.lng.toFixed(3)}` : '—');
            const issue = state.issue === 'awaitingPickup' ? t('deliveryMonitor.awaitingPickup') : state.issue === 'late' ? t('arrival.lateBy', { duration: duration(state.minutes * 60_000, t) }) : t(`arrival.issue.${state.issue}`);
            const timing = state.status === 'late' ? t('deliveryMonitor.lateBy', { duration: duration(state.minutes * 60_000, t) })
              : state.eta != null && job.scheduledAt != null ? t(state.status === 'risk' ? 'deliveryMonitor.buffer' : 'deliveryMonitor.early', { duration: duration(job.scheduledAt - state.eta, t) }) : t('deliveryMonitor.unknown');
            const appointment = job.scheduledAt != null ? formatAppointment(new Date(job.scheduledAt).toISOString(), zone) : load ? formatAppointment(load.destination?.appointmentAt || load.destination?.date, load.destination?.appointmentTimezone || load.destination?.timezone || zone) : '—';
            return <article className={`delivery-row delivery-tone-${state.status}`} key={job.id}>
              <div className="delivery-row-main">
                <div className="delivery-person"><span className="delivery-avatar">{String(driver.name || '?').split(' ').map(part => part[0]).slice(0, 2).join('')}</span><div><button disabled={demo} type="button" className="delivery-name" onClick={() => onOpenDriver(driver.id)}>{driver.name || t('arrival.driver')}</button><small><Truck size={13} />{driver.truck || driver.vehicle?.number || driver.driverNumber || '—'}</small></div></div>
                <div className="delivery-load" data-label={t('deliveryMonitor.load')}>{load ? <button disabled={demo} type="button" onClick={() => onOpenLoad?.(load)}>{load.loadNumber || '—'}</button> : <span>—</span>}</div>
                <div className="delivery-place" data-label={t('deliveryMonitor.location')}><strong><MapPin size={14} />{place}</strong><small>{demo ? t('deliveryMonitor.sample') : gpsAge ? t(job.location.stale ? 'deliveryMonitor.lastGps' : 'deliveryMonitor.gpsAge', { duration: gpsAge }) : t('deliveryMonitor.locationUnknown')}</small></div>
                <div className="delivery-destination" data-label={t('deliveryMonitor.delivery')}><strong><MapPin size={14} />{load ? job.destination || '—' : '—'}</strong></div>
                <strong className="delivery-appointment" data-label={t('deliveryMonitor.appointment')}>{appointment || '—'}</strong>
                <div className="delivery-row-actions"><div className="delivery-actions-menu"><button type="button" disabled={demo} aria-label={t('drivers.moreActions')} aria-expanded={menu === job.id} onClick={() => setMenu(menu === job.id ? null : job.id)}>···</button>{menu === job.id && <div role="group" aria-label={t('common.actions')}><button type="button" onClick={() => { onOpenDriver(driver.id); setMenu(null); }}>{t('drivers.view')}</button>{onOpenChat && <button type="button" onClick={() => { onOpenChat(driver); setMenu(null); }}>{t('drivers.openChat')}</button>}{!load && onAssignLoad && <button type="button" disabled={driver.accountStatus === 'suspended'} onClick={() => { onAssignLoad(driver); setMenu(null); }}>{t('drivers.assignLoad')}</button>}</div>}</div><button type="button" disabled={demo} aria-label={t('drivers.openDetails', { name: driver.name })} onClick={() => onOpenDriver(driver.id)}><ChevronRight size={18} /></button></div>
              </div>
              {load ? <dl className="delivery-metrics"><div><dt><ArrowRight size={15} />{t('arrival.remaining')}</dt><dd>{state.eta == null ? '—' : duration(state.eta - now, t)}</dd></div><div><dt><Clock3 size={15} />{t('arrival.eta')}</dt><dd>{state.eta == null ? '—' : displayDayKey(state.eta, zone) === displayDayKey(now, zone) ? formatTime(state.eta) : formatAppointment(new Date(state.eta).toISOString(), zone)}</dd></div><div className="delivery-timing"><dt className="sr-only">{t('deliveryMonitor.timing')}</dt><dd>{state.status === 'onTime' ? <CheckCircle2 size={15} /> : <Info size={15} />}{timing}</dd></div><div className="delivery-issue"><dt className="sr-only">{t('deliveryMonitor.issue')}</dt><dd title={issue}>{state.status === 'onTime' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}{issue}</dd></div></dl>
                : <div className="delivery-idle"><span><Info size={15} />{t('deliveryMonitor.availabilityUnknown')}</span>{onAssignLoad && <button type="button" disabled={demo || driver.accountStatus === 'suspended'} onClick={() => onAssignLoad(driver)}>{t('drivers.assignLoad')}</button>}</div>}
            </article>;
          })}
        </div>
      </section>;
    })}
    {!rows.length && <p className="delivery-empty">{t('deliveryMonitor.empty')}</p>}
    <footer className="delivery-footer"><div>{['late', 'risk', 'noGps'].map(status => <span key={status} className={`delivery-tone-${status}`}><i />{t(`arrival.status.${status}`)}</span>)}</div><p>{t('arrival.estimateNote')}</p></footer>
  </div>;
}
