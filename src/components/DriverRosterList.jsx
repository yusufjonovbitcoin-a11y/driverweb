import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Clock3, Filter, MoreHorizontal, Search, Truck } from 'lucide-react';
import { formatDate, formatTime } from '../i18n/format';
import { activeLoadsForDriver, lastSeenKind, rosterStopAddress } from './driverRosterModel';
import './driver-roster-list.css';

const PAGE_SIZE = 6;

function driverState(driver, activeLoads) {
  if (activeLoads.length) return 'ON_LOAD';
  return driver.dutyStatus === 'OFF_DUTY' ? 'OFF_DUTY' : 'AVAILABLE';
}

function lastSeen(t, value) {
  const kind = lastSeenKind(value);
  if (kind === 'never') return t('drivers.neverSeen');
  if (kind === 'yesterday') return t('common.yesterday');
  if (kind === 'time') return t('drivers.lastSeenTime', { time: formatTime(value) });
  return formatDate(value, { dateStyle: 'medium' });
}

function stopLabel(stop) {
  return [stop?.city, stop?.state].filter(Boolean).join(', ') || rosterStopAddress(stop) || '—';
}

export default function DriverRosterList({ drivers, loads, onOpenDriver, onPrefetchDriver, onAssignLoad, onOpenChat, unreadChatsByDriver = {} }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [truckOnly, setTruckOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [page, setPage] = useState(1);

  const loadsByDriver = useMemo(() => {
    const grouped = new Map();
    for (const load of loads) {
      if (!load.driverId) continue;
      if (!grouped.has(load.driverId)) grouped.set(load.driverId, []);
      grouped.get(load.driverId).push(load);
    }
    return grouped;
  }, [loads]);
  const { roster, counts } = useMemo(() => {
    const counts = { ALL: drivers.length, ON_LOAD: 0, AVAILABLE: 0, OFF_DUTY: 0 };
    const roster = drivers.map(driver => {
      const activeLoads = activeLoadsForDriver(loadsByDriver.get(driver.id) || [], driver.id);
      const state = driverState(driver, activeLoads);
      counts[state] += 1;
      return { driver, activeLoads, state };
    });
    return { roster, counts };
  }, [drivers, loadsByDriver]);
  const query = search.trim().toLowerCase();
  const filtered = roster.filter(({ driver, activeLoads, state }) => {
    if (status !== 'ALL' && status !== state) return false;
    if (truckOnly && !driver.vehicle && !driver.truck) return false;
    if (!query) return true;
    return [driver.name, driver.driverNumber, driver.truck, driver.vehicle?.number, driver.vehicle?.make,
      driver.currentLocation, ...activeLoads.map(load => load.loadNumber)]
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

  return <section className="drivers-roster-page" aria-label={t('nav.drivers')}>
    <div className="drivers-roster-toolbar">
      <nav className="drivers-roster-tabs" aria-label={t('drivers.currentStatus')}>
        {[
          ['ALL', t('common.all')],
          ['ON_LOAD', t('drivers.onLoad')],
          ['AVAILABLE', t('drivers.available')],
          ['OFF_DUTY', t('driverStatus.off_duty')],
        ].map(([key, label]) => <button key={key} type="button" aria-pressed={status === key} onClick={() => changeStatus(key)}>{label} <span>({counts[key]})</span></button>)}
      </nav>
      <div className="drivers-roster-tools">
        <label className="drivers-roster-search"><Search size={17} aria-hidden="true" /><span className="sr-only">{t('drivers.search')}</span>
          <input type="search" value={search} onChange={event => changeSearch(event.target.value)} placeholder={t('drivers.searchPlaceholder')} />
        </label>
        <div className="drivers-roster-filter"><button type="button" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><Filter size={17} />{t('drivers.filter')}</button>
          {filterOpen && <div className="drivers-roster-filter-menu"><label><input type="checkbox" checked={truckOnly} onChange={event => { setTruckOnly(event.target.checked); setPage(1); }} />{t('drivers.truckAssignedOnly')}</label>
            <button type="button" onClick={() => { setTruckOnly(false); setFilterOpen(false); setPage(1); }}>{t('drivers.clearFilter')}</button></div>}
        </div>
      </div>
    </div>

    <div className="drivers-roster-table-shell"><div className="drivers-roster-table-viewport"><table className="drivers-roster-table">
      <thead><tr><th scope="col">{t('drivers.driver')}</th><th scope="col">{t('drivers.truck')}</th><th scope="col">{t('drivers.currentStatus')}</th>
        <th scope="col">{t('drivers.currentLoadLocation')}</th><th scope="col">{t('drivers.lastSeen')}</th><th scope="col">{t('common.actions')}</th></tr></thead>
      <tbody>{rows.length ? rows.map(({ driver, activeLoads, state }) => {
        const load = activeLoads[0];
        const unread = unreadChatsByDriver[driver.id] || 0;
        const truck = driver.vehicle;
        return <tr key={driver.id} tabIndex={0} aria-label={t('drivers.openDetails', { name: driver.name })}
          onPointerEnter={prefetchDriverDetail}
          onFocus={prefetchDriverDetail}
          onClick={event => { if (!event.target.closest('button, a, input, label')) onOpenDriver(driver.id); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenDriver(driver.id); } }}>
          <td><div className="drivers-roster-person"><span className="drivers-roster-avatar">{driver.avatar ? <img src={driver.avatar} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : driver.name.split(' ').map(part => part.charAt(0)).slice(0, 2).join('')}</span>
            <span className="drivers-roster-person-copy"><strong>{driver.name}{driver.isOnline && <i className="drivers-roster-online-dot" aria-label={t('common.online')} />}</strong><small>{driver.driverNumber || '—'}</small></span>
            {unread > 0 && <span className="drivers-roster-unread" aria-label={t('chat.unreadMessages', { count: unread })}>{unread > 99 ? '99+' : unread}</span>}</div></td>
          <td><strong>{truck?.number ? '#' + truck.number : driver.truck || '—'}</strong><small>{[truck?.make, truck?.model, truck?.year].filter(Boolean).join(' ') || '—'}</small></td>
          <td><span className={'drivers-roster-status status-' + state.toLowerCase()}>{state === 'ON_LOAD' ? <Truck size={15} /> : <Clock3 size={15} />}{state === 'ON_LOAD' ? t('drivers.onLoad') : state === 'AVAILABLE' ? t('drivers.available') : t('driverStatus.off_duty')}</span></td>
          <td>{load ? <><strong>{stopLabel(load.origin)} → {stopLabel(load.destination)}</strong><small>{load.loadNumber}{activeLoads.length > 1 ? ' · +' + (activeLoads.length - 1) : ''}</small></> : <><strong>—</strong><small>{driver.currentLocation || t('drivers.noCurrentLoad')}</small></>}</td>
          <td><strong>{lastSeen(t, driver.lastSeenAt)}</strong><small>{driver.isOnline ? t('common.online') : t('common.offline')}</small></td>
          <td><div className="drivers-roster-actions"><button type="button" onClick={() => onOpenDriver(driver.id)}>{t('drivers.view')}</button>
            <div className="drivers-roster-more"><button type="button" aria-label={t('drivers.moreActions')} aria-expanded={openMenuId === driver.id} onClick={() => setOpenMenuId(value => value === driver.id ? null : driver.id)}><MoreHorizontal size={18} /></button>
              {openMenuId === driver.id && <div className="drivers-roster-more-menu"><button type="button" onClick={() => { onAssignLoad(driver); setOpenMenuId(null); }}>{t('drivers.assignLoad')}</button>
                {onOpenChat && <button type="button" onClick={() => { onOpenChat(driver); setOpenMenuId(null); }}>{t('drivers.openChat')}</button>}
              </div>}
            </div></div></td>
        </tr>;
      }) : <tr><td colSpan={6} className="drivers-roster-empty">{t('drivers.noDrivers')}</td></tr>}</tbody>
    </table></div>
      <footer className="drivers-roster-footer"><span>{t('drivers.showing', { first, last, total: filtered.length })}</span><div><button type="button" aria-label={t('analytics.previous')} disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><strong>{currentPage}</strong><button type="button" aria-label={t('analytics.next')} disabled={currentPage >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div></footer>
    </div>
  </section>;
}
