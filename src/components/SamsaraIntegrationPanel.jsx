import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { Plug, Unplug, RefreshCw, Satellite, ArrowUpRight } from 'lucide-react';
import { samsaraRequest, validSamsaraAuthorizationUrl, hosDuration } from '../services/samsaraService';
import { formatDateTime } from '../i18n/format';
import './samsaraIntegration.css';

function FleetTable({ connection, t }) {
  const [view, setView] = useState('vehicles');
  const [page, setPage] = useState(0);
  const vehicleNames = useMemo(() => new Map((connection.vehicles || []).map(v => [v.id, v.name])), [connection.vehicles]);
  const rows = connection[view] || [];
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  return <div className="samsara-fleet">
    <div className="samsara-fleet-switch">
      {['vehicles', 'drivers'].map(kind => <button type="button" key={kind} aria-pressed={view === kind} onClick={() => { setView(kind); setPage(0); }}>{t(`samsara.${kind}`)} · {connection[kind]?.length || 0}</button>)}
    </div>
    {!rows.length ? <p className="samsara-muted">{t('samsara.noData')}</p> : <>
      <div className="samsara-table-scroll" role="region" aria-label={t(`samsara.${view}`)} tabIndex={0}>
        <table><caption className="sr-only">{t(`samsara.${view}`)}</caption>
          <thead><tr>{(view === 'vehicles' ? ['vehicle', 'location', 'gpsTime'] : ['driver', 'vehicle', 'driveLeft', 'shiftLeft']).map(key => <th scope="col" key={key}>{t(`samsara.${key}`)}</th>)}</tr></thead>
          <tbody>{rows.slice(visiblePage * 20, visiblePage * 20 + 20).map(row => <tr key={row.id}>
            <th scope="row">{row.name || row.id}{view === 'vehicles' && row.vin && <small>{row.vin}</small>}</th>
            {view === 'vehicles' ? <>
              <td>{row.latitude != null && row.longitude != null ? <a href={`https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}`} target="_blank" rel="noreferrer">{row.location || `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`}<ArrowUpRight size={14} aria-hidden="true" /></a> : '—'}</td>
              <td>{row.gpsAt ? formatDateTime(row.gpsAt) : '—'}</td>
            </> : <><td>{vehicleNames.get(row.vehicleId) || '—'}</td><td>{hosDuration(row.driveRemainingMs)}</td><td>{hosDuration(row.shiftRemainingMs)}</td></>}
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > 20 && <div className="samsara-pagination">
        <button type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>{t('samsara.previous')}</button>
        <span>{visiblePage + 1} / {Math.ceil(rows.length / 20)}</span>
        <button type="button" disabled={(visiblePage + 1) * 20 >= rows.length} onClick={() => setPage(visiblePage + 1)}>{t('samsara.next')}</button>
      </div>}
    </>}
  </div>;
}

export default function SamsaraIntegrationPanel({ currentUser, request = samsaraRequest }) {
  const { t } = useTranslation();
  const allowed = currentUser?.roleCode === 'company_admin';
  const { data, error, isLoading, mutate } = useSWR(allowed ? ['samsara', currentUser.id, currentUser.companyId] : null,
    () => request('status'), { refreshInterval: value => value?.connection?.syncing || (value?.connection?.status === 'active' && !value.connection.lastSyncedAt && !value.connection.lastError) ? 4000 : 60000, revalidateOnFocus: true, shouldRetryOnError: false });
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.hash.split('?')[1]).get('samsara') || '');
  useEffect(() => {
    mounted.current = true;
    const [route, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    if (params.has('samsara')) {
      params.delete('samsara');
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${route}?${params}`);
    }
    return () => { mounted.current = false; };
  }, []);
  const connection = data?.connection;
  const connected = connection?.status === 'active';
  const reconnect = connection?.status === 'needs_reconnect';
  const translateError = code => t(`samsara.errors.${code}`, { defaultValue: t('samsara.errors.REQUEST_FAILED') });
  async function act(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action); setActionError(''); setNotice('');
    try {
      const result = await request(action);
      if (!mounted.current) return;
      if (action === 'connect') {
        if (!validSamsaraAuthorizationUrl(result?.url)) throw new Error('REQUEST_FAILED');
        window.location.assign(result.url);
      } else if (action === 'disconnect') {
        await mutate(result, false);
        setNotice(result.warning || 'disconnected');
      } else if (action === 'sync') {
        // Poll only this card while the server syncs; the rest of the web stays usable.
        await mutate(previous => ({ ...previous, connection: { ...previous.connection, syncing: true } }), false);
        setNotice('queued');
      } else await mutate(result, false);
    } catch (failure) {
      if (mounted.current) setActionError(failure.message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy('');
    }
  }
  if (!allowed) return null;
  const visibleError = actionError || error?.message;
  return <section className="samsara-panel" aria-labelledby="samsara-title" aria-busy={isLoading || Boolean(busy)}>
    <header className="samsara-header">
      <span className="samsara-symbol"><Satellite size={25} aria-hidden="true" /></span>
      <div><h2 id="samsara-title">Samsara</h2><p>{t('samsara.description')}</p></div>
      <span className={`samsara-status ${connected ? 'is-active' : ''}`}>{t(`samsara.${isLoading ? 'checking' : reconnect ? 'needsReconnect' : connected ? 'connected' : 'disconnected'}`)}</span>
    </header>
    {notice && <p role="status" className="samsara-notice">{t(`samsara.notices.${notice}`, { defaultValue: t('samsara.errors.REQUEST_FAILED') })}</p>}
    {visibleError && <p role="alert" className="samsara-error">{translateError(visibleError)}</p>}
    {data?.configured === false && <p className="samsara-error">{t('samsara.errors.NOT_CONFIGURED')}</p>}
    {connection?.lastError && <p className="samsara-error">{translateError(connection.lastError)}</p>}
    {(connected || reconnect) && <>
      <dl className="samsara-metrics">{['vehicles', 'drivers', 'gps', 'hos'].map(feed => <div key={feed}><dt>{t(`samsara.${feed}`)}</dt><dd>{connection.capabilities?.[feed] === 'ok' ? t('samsara.available') : connection.capabilities?.[feed] ? translateError(connection.capabilities[feed]) : t('samsara.waiting')}</dd></div>)}</dl>
      <p className="samsara-muted">{t('samsara.lastSync')}: {connection.lastSyncedAt ? formatDateTime(connection.lastSyncedAt) : t('samsara.waiting')}{connection.syncing ? ` · ${t('samsara.syncing')}` : ''}</p>
      {connection.lastSyncedAt && <FleetTable connection={connection} t={t} />}
    </>}
    <footer className="samsara-actions">
      <p>{t('samsara.syncHint')}</p>
      <div>
        {error && <button type="button" disabled={Boolean(busy)} onClick={() => act('status')}><RefreshCw size={16} aria-hidden="true" />{t('samsara.retry')}</button>}
        {(connected || reconnect) && <button type="button" disabled={Boolean(busy) || connection.syncing} onClick={() => act('disconnect')}><Unplug size={16} aria-hidden="true" />{t('samsara.disconnect')}</button>}
        {connected ? <button type="button" className="samsara-primary" disabled={Boolean(busy) || connection.syncing} onClick={() => act('sync')}><RefreshCw size={16} aria-hidden="true" />{t(connection.syncing ? 'samsara.syncing' : 'samsara.sync')}</button>
          : <button type="button" className="samsara-primary" disabled={isLoading || Boolean(busy) || !data?.configured} onClick={() => act('connect')}><Plug size={16} aria-hidden="true" />{t(busy === 'connect' ? 'samsara.redirecting' : reconnect ? 'samsara.reconnect' : 'samsara.connect')}</button>}
      </div>
    </footer>
  </section>;
}
