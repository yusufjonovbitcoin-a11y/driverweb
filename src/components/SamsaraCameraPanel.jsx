import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Play, RefreshCw, X } from 'lucide-react';
import { samsaraCameraRequest } from '../services/samsaraService';

const inputs = ['dashcamRoadFacing', 'dashcamDriverFacing', 'analog1', 'analog2', 'analog3', 'analog4'];
const localInput = time => { const date = new Date(time); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const localTime = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const mediaKey = media => `${media.vehicleId}:${media.input}:${media.mediaType}:${media.startTime}:${media.endTime}`;

function MediaCard({ media, t }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const image = media.mediaType === 'image';
  return <article className="samsara-camera-media">
    {media.url && !failed ? image ? <a href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={t('samsara.camera.photoAt', { time: localTime(media.startTime) })} width="640" height="360" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /></a>
      : playing ? <video src={media.url} controls playsInline preload="none" width="640" height="360" aria-label={t('samsara.camera.videoAt', { time: localTime(media.startTime) })} onError={() => setFailed(true)} />
        : <button type="button" className="samsara-camera-play" onClick={() => setPlaying(true)}><Play size={28} aria-hidden="true" />{t('samsara.camera.play')}</button>
      : <p className="samsara-muted">{t(`samsara.camera.states.${failed ? 'link_unavailable' : media.status}`)}</p>}
    <div><strong>{t(`samsara.camera.inputs.${media.input}`)}</strong><time dateTime={media.startTime}>{localTime(media.startTime)}</time></div>
    {failed && <p className="samsara-muted">{t('samsara.camera.refreshLinks')}</p>}
  </article>;
}

export default function SamsaraCameraPanel({ vehicle, onClose, onReconnect, request = samsaraCameraRequest }) {
  const { t } = useTranslation();
  const id = useId();
  const heading = useRef(null), alive = useRef(true), locked = useRef(false);
  const [input, setInput] = useState('dashcamRoadFacing');
  const [from, setFrom] = useState(() => localInput(Date.now() - 86400000));
  const [until, setUntil] = useState(() => localInput(Date.now()));
  const [at, setAt] = useState(() => localInput(Date.now() - 300000));
  const [type, setType] = useState('image');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [media, setMedia] = useState([]);
  const [search, setSearch] = useState(null);
  const [after, setAfter] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [requestMedia, setRequestMedia] = useState([]);
  const [pollUntil, setPollUntil] = useState(0);
  const [pollError, setPollError] = useState('');
  const [checked, setChecked] = useState(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => { alive.current = true; heading.current?.focus(); return () => { alive.current = false; }; }, []);

  const remember = useCallback(item => {
    setSelected(item);
    setHistory(previous => [item, ...previous.filter(r => r.id !== item.id)].slice(0, 12));
  }, []);
  const readRequest = useCallback(async item => {
    const result = await request('get', { vehicleId: vehicle.id, input: item.input, id: item.id });
    if (alive.current) { remember(result.request); setRequestMedia(result.media || []); }
    return result;
  }, [request, vehicle.id, remember]);

  useEffect(() => {
    let canceled = false;
    request('history', { vehicleId: vehicle.id, input: 'dashcamRoadFacing' }).then(result => {
      if (!canceled) setHistory(result.requests || []);
    }).catch(failure => { if (!canceled) setError(failure.message); });
    return () => { canceled = true; };
  }, [request, vehicle.id]);

  // Only the selected pending request is polled, for two minutes. Hidden panels
  // and background tabs never poll, and creating requests is always explicit.
  useEffect(() => {
    if (selected?.state !== 'pending' || !pollUntil || pollError) return undefined;
    let canceled = false, timer;
    const tick = async () => {
      if (canceled || Date.now() >= pollUntil) return;
      if (!document.hidden && !locked.current) {
        locked.current = true; setBusy('get');
        try { await readRequest(selected); }
        catch (failure) { if (!canceled && failure.message !== 'SYNC_BUSY') setPollError(failure.message); }
        finally { locked.current = false; if (alive.current) setBusy(''); }
      }
      if (!canceled) timer = setTimeout(tick, 6000);
    };
    timer = setTimeout(tick, 6000);
    return () => { canceled = true; clearTimeout(timer); };
  }, [selected, pollUntil, pollError, readRequest]);

  async function run(kind, action) {
    if (locked.current) return;
    locked.current = true; setBusy(kind); setError(''); setPollError('');
    try { await action(); }
    catch (failure) { if (alive.current) setError(failure.message); }
    finally { locked.current = false; if (alive.current) setBusy(''); }
  }
  async function list(more = false) {
    await run('list', async () => {
      const filters = more ? search : { vehicleId: vehicle.id, input, startTime: new Date(from).toISOString(), endTime: new Date(until).toISOString() };
      if (!filters || Date.parse(filters.endTime) <= Date.parse(filters.startTime) || Date.parse(filters.endTime) - Date.parse(filters.startTime) > 86400000 || Date.parse(filters.endTime) > Date.now()) throw new Error('INVALID_TIME_RANGE');
      const result = await request('list', { ...filters, ...(more ? { after } : {}) });
      if (!alive.current) return;
      setMedia(previous => [...new Map([...(more ? previous : []), ...(result.media || [])].map(m => [mediaKey(m), m])).values()]);
      setSearch(filters); setAfter(result.after); setChecked(true);
    });
  }
  async function create(event) {
    event.preventDefault();
    await run('create', async () => {
      const start = new Date(at).getTime(), end = start + (type === 'image' ? 0 : 15000);
      if (!Number.isFinite(start) || end > Date.now()) throw new Error('INVALID_TIME_RANGE');
      const result = await request('create', { vehicleId: vehicle.id, input, id: crypto.randomUUID(), mediaType: type, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() });
      if (!alive.current) return;
      remember(result.request); setRequestMedia(result.media || []); setPollUntil(Date.now() + 120000);
    });
  }
  const visibleError = error || pollError;
  const errorText = code => t(`samsara.camera.errors.${code}`, { defaultValue: t(`samsara.errors.${code}`, { defaultValue: t('samsara.errors.REQUEST_FAILED') }) });
  return <section className="samsara-camera" aria-labelledby={`${id}-title`}>
    <header className="samsara-camera-header"><div><h3 ref={heading} tabIndex={-1} id={`${id}-title`}><Camera size={20} aria-hidden="true" />{t('samsara.camera.title')} · {vehicle.name || vehicle.id}</h3><p className="samsara-muted">{t('samsara.camera.description')}</p></div><button type="button" aria-label={t('samsara.camera.close')} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <p className="samsara-muted">{t('samsara.camera.timeZone', { zone })}</p>
    {visibleError && <div role="alert" className="samsara-error">{errorText(visibleError)}{['CAMERA_READ_REQUIRED','CAMERA_WRITE_REQUIRED','RECONNECT_REQUIRED'].includes(visibleError) && <button type="button" onClick={onReconnect}>{t('samsara.camera.updatePermissions')}</button>}</div>}
    <form onSubmit={event => { event.preventDefault(); void list(); }} className="samsara-camera-form">
      <fieldset disabled={Boolean(busy)}><legend className="sr-only">{t('samsara.camera.recordings')}</legend>
        <label>{t('samsara.camera.source')}<select value={input} onChange={event => setInput(event.target.value)}>{inputs.map(key => <option key={key} value={key}>{t(`samsara.camera.inputs.${key}`)}</option>)}</select></label>
        <label>{t('samsara.camera.from')}<input type="datetime-local" required value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>{t('samsara.camera.until')}<input type="datetime-local" required value={until} onChange={event => setUntil(event.target.value)} /></label>
        <button type="submit" className="samsara-primary"><RefreshCw size={16} aria-hidden="true" />{t(busy === 'list' ? 'samsara.camera.loading' : 'samsara.camera.show')}</button>
      </fieldset>
    </form>
    <p className="samsara-muted">{t('samsara.camera.rangeHint')}</p>
    {checked && <div className="samsara-camera-results"><h4>{t('samsara.camera.recordings')} · {t(`samsara.camera.inputs.${search.input}`)}</h4><p className="samsara-muted">{localTime(search.startTime)} — {localTime(search.endTime)}</p>
      {!media.length && <p role="status" className="samsara-muted">{t('samsara.camera.empty')}</p>}
      <div className="samsara-camera-grid">{media.map(item => <MediaCard key={`${mediaKey(item)}:${item.url}`} media={item} t={t} />)}</div>
      {after && <button type="button" disabled={Boolean(busy)} onClick={() => list(true)}>{t('samsara.camera.more')}</button>}
    </div>}
    <details className="samsara-camera-retrieve"><summary>{t('samsara.camera.requestTitle')}</summary>
      <p className="samsara-muted">{t('samsara.camera.quotaHint')}</p>
      <form onSubmit={create}><fieldset disabled={Boolean(busy)}><legend className="sr-only">{t('samsara.camera.requestTitle')}</legend>
        <label>{t('samsara.camera.at')}<input type="datetime-local" required value={at} onChange={event => setAt(event.target.value)} /></label>
        <label>{t('samsara.camera.type')}<select value={type} onChange={event => setType(event.target.value)}><option value="image">{t('samsara.camera.photo')}</option><option value="videoHighRes">{t('samsara.camera.video')}</option></select></label>
        <button type="submit" className="samsara-primary"><Camera size={16} aria-hidden="true" />{t(busy === 'create' ? 'samsara.camera.requesting' : 'samsara.camera.request')}</button>
      </fieldset></form>
    </details>
    {selected && <div className="samsara-camera-request"><p role="status"><strong>{t(`samsara.camera.states.${selected.state}`)}</strong> · {localTime(selected.startTime)} · {t(`samsara.camera.inputs.${selected.input}`)}</p>
      {selected.state === 'pending' && <p className="samsara-muted">{t('samsara.camera.pendingHint')}</p>}
      {['submitting','unknown'].includes(selected.state) && <p className="samsara-muted">{t('samsara.camera.errors.REQUEST_UNCONFIRMED')}</p>}
      <div className="samsara-camera-grid">{requestMedia.map(item => <MediaCard key={`${mediaKey(item)}:${item.url}`} media={item} t={t} />)}</div>
      <button type="button" disabled={Boolean(busy)} onClick={() => run('get', async () => { await readRequest(selected); setPollUntil(Date.now() + 120000); })}><RefreshCw size={16} aria-hidden="true" />{t('samsara.camera.check')}</button>
    </div>}
    {history.length > 0 && <details className="samsara-camera-history"><summary>{t('samsara.camera.history')}</summary><ul>{history.map(item => <li key={item.id}><span>{localTime(item.startTime)} · {t(`samsara.camera.inputs.${item.input}`)} · {t(`samsara.camera.states.${item.state}`)}</span><button type="button" disabled={Boolean(busy)} onClick={() => run('get', async () => { await readRequest(item); setPollUntil(Date.now() + 120000); })}>{t('samsara.camera.view')}</button></li>)}</ul></details>}
  </section>;
}
