import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CirclePause, CirclePlay, Clock3, Filter, LoaderCircle, MessageSquare, MoreHorizontal, Search, Truck, Users } from 'lucide-react';
import { formatDate, formatTime } from '../i18n/format';
import { activeLoadsForDriver, driverRosterState, lastSeenKind, rosterStopAddress } from './driverRosterModel';
import { useDeliveryMonitor } from '../hooks/useDeliveryMonitor.js';
import { useWorkspaceSelection } from '../hooks/useWorkspaceRoute.js';
import { deliveryMonitorProblemCount } from './deliveryMonitorModel.js';
import { setDriverAccountStatus } from '../services/driverSettingsService.js';
import LoadNumber from './LoadNumber.jsx';
import MemberAvatar from './MemberAvatar.jsx';
import './driver-roster-list.css';
import './delivery-monitor.css';

const DeliveryMonitor = lazy(() => import('./DeliveryMonitor.jsx'));

const PAGE_SIZE = 6;
const VIEWS = ['drivers', 'delivery'];

const driverState = driverRosterState;

function lastSeen(t, value) {
  const kind = lastSeenKind(value);
  if (kind === 'never') return t('drivers.neverSeen');
  if (kind === 'yesterday') return t('common.yesterday');
  if (kind === 'time') return t('drivers.lastSeenTime', { time: formatTime(value) });
  return formatDate(value, { day: 'numeric', month: 'short' });
}

function stopLabel(stop) {
  return [stop?.city, stop?.state].filter(Boolean).join(', ') || rosterStopAddress(stop) || '—';
}

export default function DriverRosterList({ drivers, loads, onOpenDriver, onPrefetchDriver, onAssignLoad, onOpenChat, onOpenLoad, canManageDriver = false, onWorkspaceRefresh, unreadChatsByDriver = {}, routePage }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [truckOnly, setTruckOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [statusBusyId, setStatusBusyId] = useState(null);
  const statusPending = useRef(false);
  const [statusNotice, setStatusNotice] = useState(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useWorkspaceSelection(routePage, 'view', 'drivers', VIEWS);
  const [demo, setDemo] = useState(false);
  const monitoring = useDeliveryMonitor(drivers, loads, demo);
  const problemCount = deliveryMonitorProblemCount(monitoring.rows);

  const roster = drivers.map(driver => {
    const activeLoads = activeLoadsForDriver(loads, driver.id);
    return { driver, activeLoads, state: driverState(driver, activeLoads) };
  });
  const counts = {
    ALL: roster.filter(item => item.state !== 'SUSPENDED').length,
    ON_LOAD: roster.filter(item => item.state === 'ON_LOAD').length,
    AVAILABLE: roster.filter(item => item.state === 'AVAILABLE').length,
    SUSPENDED: roster.filter(item => item.state === 'SUSPENDED').length,
    OFF_DUTY: roster.filter(item => item.state === 'OFF_DUTY').length,
  };
  const query = search.trim().toLowerCase();
  const filtered = roster.filter(({ driver, activeLoads, state }) => {
    if (status === 'ALL' ? state === 'SUSPENDED' : status !== state) return false;
    if (truckOnly && !driver.vehicle && !driver.truck) return false;
    if (!query) return true;
    return [driver.name, driver.driverNumber, driver.truck, driver.vehicle?.number, driver.vehicle?.make,
      driver.currentLocation, ...activeLoads.flatMap(load => view === 'delivery'
        ? [load.loadNumber, load.brokerLoadNumber, load.origin?.city, load.origin?.state, load.destination?.city, load.destination?.state, load.destination?.address]
        : [load.loadNumber, load.brokerLoadNumber])]
      .some(value => String(value || '').toLowerCase().includes(query));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const first = filtered.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(currentPage * PAGE_SIZE, filtered.length);

  function changeStatus(next) { setStatus(next); setPage(1); setOpenMenuId(null); }
  function changeSearch(next) { setSearch(next); setPage(1); }
  function prefetchDriverDetail() { if (onPrefetchDriver) void onPrefetchDriver().catch(() => {}); }
  async function changeAccountStatus(driver) {
    if (!canManageDriver || statusPending.current || !['active', 'suspended'].includes(driver.accountStatus)) return;
    const nextStatus = driver.accountStatus === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`${driver.name}\n${t('driverSettings.confirmStatus')}\n${t(nextStatus === 'suspended' ? 'driverSettings.suspend' : 'driverSettings.activate')}`)) return;
    statusPending.current = true;
    setStatusBusyId(driver.id);
    setStatusNotice(null);
    try {
      await setDriverAccountStatus(driver.id, nextStatus);
      setOpenMenuId(null);
      setStatusNotice({ key: 'driverSettings.statusChanged', error: false });
      try { await onWorkspaceRefresh?.({ quiet: true }); }
      catch { setStatusNotice({ key: 'driverSettings.refreshError', error: true }); }
    } catch {
      setStatusNotice({ key: 'driverSettings.accountError', error: true });
    } finally {
      statusPending.current = false;
      setStatusBusyId(null);
    }
  }

  return <section className="drivers-roster-page" aria-label={t('nav.drivers')}>
    <div className="drivers-roster-toolbar">
      <nav className="drivers-roster-tabs" aria-label={t('drivers.currentStatus')}>
        {[
          ['ALL', t('common.all')],
          ['ON_LOAD', t('drivers.onLoad')],
          ['AVAILABLE', t('drivers.available')],
          ['OFF_DUTY', t('driverStatus.off_duty')],
          ['SUSPENDED', t('driverSettings.suspended')],
        ].map(([key, label]) => <button key={key} type="button" aria-pressed={status === key} onClick={() => changeStatus(key)}>{label} <span>({counts[key]})</span></button>)}
      </nav>
      <div className="drivers-roster-tools">
        <div className="roster-view-switch" role="group" aria-label={t('deliveryMonitor.view')}>
          <button type="button" aria-pressed={view === 'drivers'} onClick={() => setView('drivers')}><Users size={16} />{t('nav.drivers')}</button>
          <button type="button" className={problemCount ? 'has-problems' : undefined} aria-pressed={view === 'delivery'} onClick={() => setView('delivery')}><Truck size={16} />{t('deliveryMonitor.title')}{problemCount > 0 && <span className="roster-problem-count" aria-label={t('deliveryMonitor.problemCount', { count: problemCount })}>{problemCount}</span>}</button>
        </div>
        <label className="drivers-roster-search"><Search size={17} aria-hidden="true" /><span className="sr-only">{t('drivers.search')}</span>
          <input type="search" value={search} onChange={event => changeSearch(event.target.value)} placeholder={t('drivers.searchPlaceholder')} />
        </label>
        <div className="drivers-roster-filter"><button type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><Filter size={17} />{t('drivers.filter')}</button>
          {filterOpen && <div className="drivers-roster-filter-menu"><label><input type="checkbox" checked={truckOnly} onChange={event => { setTruckOnly(event.target.checked); setPage(1); }} />{t('drivers.truckAssignedOnly')}</label>
            <button type="button" onClick={() => { setTruckOnly(false); setFilterOpen(false); setPage(1); }}>{t('drivers.clearFilter')}</button></div>}
        </div>
      </div>
    </div>

    {statusNotice && <p className={`drivers-roster-notice${statusNotice.error ? ' is-error' : ''}`} role={statusNotice.error ? 'alert' : 'status'}>{t(statusNotice.key)}</p>}
    {view === 'delivery' ? <Suspense fallback={<p role="status">{t('common.loading')}</p>}><DeliveryMonitor drivers={filtered.map(item => item.driver)} monitoring={monitoring} demo={demo} onDemoChange={setDemo} query={search}
      onOpenDriver={onOpenDriver} onOpenLoad={onOpenLoad} onAssignLoad={onAssignLoad} onOpenChat={onOpenChat} /></Suspense>
      : <div className="drivers-roster-table-shell"><div className="drivers-roster-table-viewport"><table className="drivers-roster-table">
      <thead><tr><th scope="col">{t('drivers.driver')}</th><th scope="col">{t('loads.loadNumber')}</th><th scope="col">{t('drivers.currentStatus')}</th>
        <th scope="col">{t('drivers.currentLoadLocation')}</th><th scope="col">{t('drivers.lastSeen')}</th><th scope="col">{t('common.actions')}</th></tr></thead>
      <tbody>{rows.length ? rows.map(({ driver, activeLoads, state }) => {
        const load = activeLoads[0];
        const unread = unreadChatsByDriver[driver.id] || 0;
        return <tr key={driver.id} tabIndex={0} aria-label={t('drivers.openDetails', { name: driver.name })}
          onPointerEnter={prefetchDriverDetail}
          onFocus={prefetchDriverDetail}
          onClick={event => { if (!event.target.closest('button, a, input, label')) onOpenDriver(driver.id); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenDriver(driver.id); } }}>
          <td><div className="drivers-roster-person"><MemberAvatar member={driver} className="drivers-roster-avatar" />
            <span className="drivers-roster-person-copy"><strong>{driver.name}{driver.isOnline && <i className="drivers-roster-online-dot" aria-label={t('common.online')} />}</strong><small>{driver.driverNumber || '—'}</small></span>
            {unread > 0 && <span className="drivers-roster-unread" aria-label={t('chat.unreadMessages', { count: unread })}>{unread > 99 ? '99+' : unread}</span>}</div></td>
          <td><strong>{load ? <LoadNumber load={load} /> : '—'}</strong>{activeLoads.length > 1 && <small title={activeLoads.slice(1).map(item => item.loadNumber).filter(Boolean).join(', ')}>+{activeLoads.length - 1}</small>}</td>
          <td><span className={'drivers-roster-status status-' + state.toLowerCase()}>{state === 'ON_LOAD' ? <Truck size={15} /> : <Clock3 size={15} />}{state === 'SUSPENDED' ? t('driverSettings.suspended') : state === 'ON_LOAD' ? t('drivers.onLoad') : state === 'AVAILABLE' ? t('drivers.available') : t('driverStatus.off_duty')}</span></td>
          <td>{load ? <><strong>{stopLabel(load.origin)} → {stopLabel(load.destination)}</strong></> : <><strong>—</strong><small>{driver.currentLocation || t('drivers.noCurrentLoad')}</small></>}</td>
          <td><strong>{lastSeen(t, driver.lastSeenAt)}</strong><small>{driver.isOnline ? t('common.online') : t('common.offline')}</small></td>
          <td><div className="drivers-roster-actions">
            <div className="drivers-roster-more"><button type="button" aria-label={t('drivers.moreActions')} aria-expanded={openMenuId === driver.id} onClick={() => setOpenMenuId(value => value === driver.id ? null : driver.id)}><MoreHorizontal size={18} /></button>
              {openMenuId === driver.id && <div className="drivers-roster-more-menu" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') { setOpenMenuId(null); event.currentTarget.parentElement.querySelector('button')?.focus(); } }}><button type="button" disabled={driver.accountStatus === 'suspended' || statusBusyId === driver.id} title={driver.accountStatus === 'suspended' ? t('driverSettings.suspended') : undefined} onClick={() => { if (driver.accountStatus !== 'suspended') onAssignLoad(driver); setOpenMenuId(null); }}><Truck size={16} aria-hidden="true" />{t('drivers.assignLoad')}</button>
                {onOpenChat && <button type="button" onClick={() => { onOpenChat(driver); setOpenMenuId(null); }}><MessageSquare size={16} aria-hidden="true" />{t('drivers.openChat')}</button>}
                {canManageDriver && ['active', 'suspended'].includes(driver.accountStatus) && <button type="button"
                  className={`drivers-roster-account-action ${driver.accountStatus === 'suspended' ? 'is-activate' : 'is-suspend'}`}
                  disabled={Boolean(statusBusyId)} aria-busy={statusBusyId === driver.id}
                  onClick={() => changeAccountStatus(driver)}>
                  {statusBusyId === driver.id ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : driver.accountStatus === 'suspended' ? <CirclePlay size={16} aria-hidden="true" /> : <CirclePause size={16} aria-hidden="true" />}
                  {t(driver.accountStatus === 'suspended' ? 'driverSettings.activate' : 'driverSettings.suspend')}
                </button>}
              </div>}
            </div></div></td>
        </tr>;
      }) : <tr><td colSpan={6} className="drivers-roster-empty">{t('drivers.noDrivers')}</td></tr>}</tbody>
    </table></div>
      <footer className="drivers-roster-footer"><span>{t('drivers.showing', { first, last, total: filtered.length })}</span><div><button type="button" aria-label={t('analytics.previous')} disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><strong>{currentPage}</strong><button type="button" aria-label={t('analytics.next')} disabled={currentPage >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div></footer>
    </div>}
  </section>;
}
