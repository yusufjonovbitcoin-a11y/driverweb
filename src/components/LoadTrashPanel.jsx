import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, LoaderCircle, RotateCcw, Search, Trash2, Truck, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizedError } from '../i18n/errors';
import { formatDateTime } from '../i18n/format';
import { normalizeSearchText } from '../utils/globalSearch';
import './load-trash.css';

const EMPTY_LIST = [];

// oxlint-disable-next-line react/only-export-components -- Exported to verify trash search without mounting live workspace services.
export function filterTrashedLoads(loads, query, driversById) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  return loads.filter((load) => {
    const previousDriver = driversById.get(load.trashedDriverId);
    const values = [load.loadNumber, load.origin?.city, load.origin?.state, load.origin?.address,
      load.destination?.city, load.destination?.state, load.destination?.address,
      previousDriver?.name, previousDriver?.driverNumber, previousDriver?.truck];
    const normalized = values.map(normalizeSearchText).filter(Boolean);
    const search = normalized.flatMap(value => [value, value.replaceAll(' ', '')]).join(' ');
    return tokens.every(token => search.includes(token));
  });
}

// oxlint-disable-next-line react/only-export-components -- Exported to verify suspended-driver exclusion with local fixtures.
export function activeTrashDrivers(drivers) {
  return drivers.filter(driver => driver?.id != null
    && String(driver.accountStatus || '').toLowerCase() !== 'suspended'
    && String(driver.status || '').toUpperCase() !== 'SUSPENDED');
}

// oxlint-disable-next-line react/only-export-components -- Destructive-action guard is tested independently of event rendering.
export function matchesDeleteConfirmation(load, confirmation) {
  const number = String(load?.loadNumber ?? '');
  return Boolean(number.trim()) && confirmation === number;
}

// oxlint-disable-next-line react/only-export-components -- Confirms that realtime changes cannot replace a reviewed delete target.
export function isReviewedTrashLoadCurrent(reviewed, current) {
  return Boolean(reviewed && current && reviewed.id === current.id
    && reviewed.version === current.version && reviewed.trashedAt === current.trashedAt
    && reviewed.loadNumber === current.loadNumber);
}

export default function LoadTrashPanel({
  loads = EMPTY_LIST,
  drivers = EMPTY_LIST,
  onOpenDocs,
  onRestoreLoad,
  onPermanentlyDeleteLoad,
  onBusyChange,
}) {
  const { t } = useTranslation();
  const id = useId();
  const confirmationInputRef = useRef(null);
  const confirmationTriggerRef = useRef(null);
  const reviewedDeleteRef = useRef(null);
  const pendingRef = useRef(false);
  const [query, setQuery] = useState('');
  const [selectedDrivers, setSelectedDrivers] = useState({});
  const [confirmLoadId, setConfirmLoadId] = useState(null);
  const [reviewedDeleteLoad, setReviewedDeleteLoad] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const driversById = useMemo(() => new Map(drivers.filter(Boolean).map(driver => [driver.id, driver])), [drivers]);
  const availableDrivers = useMemo(() => activeTrashDrivers(drivers), [drivers]);
  const visibleLoads = useMemo(() => filterTrashedLoads(loads, query, driversById), [loads, query, driversById]);
  const isBusy = Boolean(pending);

  useEffect(() => {
    if (confirmLoadId != null) confirmationInputRef.current?.focus();
  }, [confirmLoadId]);

  const runAction = async (load, action, driverId = null) => {
    const handler = action === 'restore' ? onRestoreLoad : onPermanentlyDeleteLoad;
    if (pendingRef.current || !handler) return;
    const actionLoad = action === 'delete' ? reviewedDeleteRef.current : load;
    if (action === 'delete' && !isReviewedTrashLoadCurrent(actionLoad, load)) {
      setError({ loadId: load.id, message: t('loadTrash.conflict') });
      return;
    }
    if (action === 'delete' && !matchesDeleteConfirmation(actionLoad, confirmation)) return;
    if (driverId != null && !availableDrivers.some(driver => driver.id === driverId)) return;
    pendingRef.current = true;
    setPending({ loadId: load.id, action });
    setError(null);
    onBusyChange?.(true);
    try {
      if (action === 'restore') await handler(load, driverId);
      else await handler(actionLoad);
      setConfirmLoadId(null);
      setConfirmation('');
      reviewedDeleteRef.current = null;
      setReviewedDeleteLoad(null);
      setSelectedDrivers(previous => {
        const next = { ...previous };
        delete next[load.id];
        return next;
      });
    } catch (failure) {
      setError({ loadId: load.id, message: localizedError(t, failure,
        action === 'restore' ? 'loadTrash.restoreError' : 'loadTrash.deleteError') });
    } finally {
      pendingRef.current = false;
      setPending(null);
      onBusyChange?.(false);
    }
  };

  const closeConfirmation = (restoreFocus = true) => {
    if (pendingRef.current) return;
    setConfirmLoadId(null);
    setConfirmation('');
    reviewedDeleteRef.current = null;
    setReviewedDeleteLoad(null);
    setError(null);
    if (restoreFocus) confirmationTriggerRef.current?.focus();
  };
  const driverName = driver => driver?.name || driver?.driverNumber || t('loadTrash.unknownDriver');
  const stopName = stop => [stop?.city, stop?.state].filter(Boolean).join(', ') || t('common.notProvided');

  return (
    <section className="load-trash-panel" aria-labelledby={`${id}-title`} aria-busy={isBusy}>
      <header className="load-trash-header">
        <div>
          <h2 id={`${id}-title`}><Trash2 size={20} aria-hidden="true" />{t('loadTrash.title')}<span>{loads.length}</span></h2>
          <p>{t('loadTrash.subtitle')}</p>
        </div>
        <label className="load-trash-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={query} disabled={isBusy} autoComplete="off"
            aria-label={t('loadTrash.searchPlaceholder')} placeholder={t('loadTrash.searchPlaceholder')}
            onChange={event => { setQuery(event.target.value); closeConfirmation(false); }} />
        </label>
      </header>

      {loads.length > 0 && <p className="load-trash-restore-hint"><RotateCcw size={15} aria-hidden="true" />{t('loadTrash.restoreHint')}</p>}
      <div className="load-trash-list">
        {visibleLoads.map(load => {
          const previousDriver = driversById.get(load.trashedDriverId);
          const selectedDriverId = selectedDrivers[load.id] || '';
          const selectedDriver = availableDrivers.find(driver => driver.id === selectedDriverId);
          const isConfirming = confirmLoadId === load.id;
          const confirmationStale = isConfirming && !isReviewedTrashLoadCurrent(reviewedDeleteLoad, load);
          const reviewedNumber = isConfirming ? String(reviewedDeleteLoad?.loadNumber ?? '') : '';
          const isRestoring = pending?.loadId === load.id && pending.action === 'restore';
          const isDeleting = pending?.loadId === load.id && pending.action === 'delete';
          const number = String(load.loadNumber ?? '');
          const rowId = `${id}-${load.id}`;
          return (
            <article key={load.id} className="load-trash-card" aria-labelledby={`${rowId}-number`}>
              <div className="load-trash-card-body">
                <div className="load-trash-load-info">
                  <h3 id={`${rowId}-number`}>{t('loadTrash.loadNumber', { number: number || t('common.notProvided') })}</h3>
                  <p className="load-trash-route"><span>{stopName(load.origin)}</span><ArrowRight size={15} aria-hidden="true" /><span>{stopName(load.destination)}</span></p>
                  <div className="load-trash-metadata">
                    <span><UsersRound size={14} aria-hidden="true" />{t('loadTrash.previousDriver')}: <strong>{load.trashedDriverId ? driverName(previousDriver) : t('loadTrash.unassigned')}</strong></span>
                    {load.trashedAt && <span>{t('loadTrash.deletedAt')}: <time dateTime={load.trashedAt}>{formatDateTime(load.trashedAt)}</time></span>}
                  </div>
                </div>
                {onOpenDocs && <button type="button" className="load-trash-documents" disabled={isBusy} onClick={() => onOpenDocs(load)}>
                  <FileText size={16} aria-hidden="true" />{t('loadTrash.documents')}
                </button>}
              </div>

              {(onRestoreLoad || onPermanentlyDeleteLoad) && <div className="load-trash-actions">
                {onRestoreLoad && <>
                  <button type="button" className="load-trash-restore" disabled={isBusy} onClick={() => runAction(load, 'restore')}>
                    {isRestoring ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
                    {t(isRestoring ? 'loadTrash.restoring' : 'loadTrash.restore')}
                  </button>
                  <div className="load-trash-assign">
                    <label className="load-trash-driver-picker">
                      <Truck size={15} aria-hidden="true" />
                      <select aria-label={t('loadTrash.chooseDriver')} value={selectedDriver ? selectedDriverId : ''}
                        disabled={isBusy || availableDrivers.length === 0}
                        onChange={event => {
                          const driver = availableDrivers.find(item => String(item.id) === event.target.value);
                          setSelectedDrivers(previous => ({ ...previous, [load.id]: driver?.id ?? '' }));
                        }}>
                        <option value="">{t(availableDrivers.length ? 'loadTrash.chooseDriver' : 'loadTrash.noActiveDrivers')}</option>
                        {availableDrivers.map(driver => <option key={driver.id} value={driver.id}>{driverName(driver)}{driver.name && driver.driverNumber ? ` · ${driver.driverNumber}` : ''}</option>)}
                      </select>
                    </label>
                    <button type="button" className="load-trash-assign-button" disabled={isBusy || !selectedDriver}
                      onClick={() => runAction(load, 'restore', selectedDriverId)}>{t('loadTrash.restoreWithDriver')}</button>
                  </div>
                </>}
                {onPermanentlyDeleteLoad && <button type="button" className="load-trash-delete" disabled={isBusy || !number.trim()}
                  aria-expanded={isConfirming} aria-controls={isConfirming ? `${rowId}-confirmation` : undefined}
                  onClick={event => {
                    confirmationTriggerRef.current = event.currentTarget;
                    if (isConfirming) { confirmationInputRef.current?.focus(); return; }
                    reviewedDeleteRef.current = { ...load };
                    setReviewedDeleteLoad(reviewedDeleteRef.current);
                    setConfirmLoadId(load.id); setConfirmation(''); setError(null);
                  }}>
                  <Trash2 size={15} aria-hidden="true" />{t('loadTrash.permanentlyDelete')}
                </button>}
              </div>}

              {isConfirming && <form id={`${rowId}-confirmation`} className="load-trash-confirmation"
                aria-labelledby={`${rowId}-confirm-title`} onSubmit={event => { event.preventDefault(); runAction(load, 'delete'); }}>
                <h4 id={`${rowId}-confirm-title`}><AlertCircle size={17} aria-hidden="true" />{t('loadTrash.deleteTitle', { number: reviewedNumber })}</h4>
                <p>{t('loadTrash.deleteWarning')}</p>
                {confirmationStale && <p role="alert">{t('loadTrash.conflict')}</p>}
                <label htmlFor={`${rowId}-confirm-input`}>{t('loadTrash.confirmLabel', { number: reviewedNumber })}</label>
                <input id={`${rowId}-confirm-input`} ref={confirmationInputRef} type="text" value={confirmation}
                  disabled={isBusy || confirmationStale} autoComplete="off" spellCheck={false}
                  onChange={event => setConfirmation(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeConfirmation(); } }} />
                <div className="load-trash-confirm-actions">
                  <button type="button" className="load-trash-cancel" disabled={isBusy} onClick={closeConfirmation}>{t('loadTrash.cancel')}</button>
                  <button type="submit" className="load-trash-delete-confirm" disabled={isBusy || confirmationStale || !matchesDeleteConfirmation(reviewedDeleteLoad, confirmation)}>
                    {isDeleting && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
                    {t(isDeleting ? 'loadTrash.deleting' : 'loadTrash.deleteConfirm')}
                  </button>
                </div>
              </form>}
              {error?.loadId === load.id && <p className="load-trash-error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error.message}</p>}
            </article>
          );
        })}
        {visibleLoads.length === 0 && <div className="load-trash-empty" role="status">
          {loads.length ? <Search size={30} aria-hidden="true" /> : <Trash2 size={30} aria-hidden="true" />}
          <h3>{t(loads.length ? 'loadTrash.noMatches' : 'loadTrash.emptyTitle')}</h3>
          {loads.length ? <button type="button" onClick={() => setQuery('')}>{t('loadTrash.clearSearch')}</button> : <p>{t('loadTrash.emptyHint')}</p>}
        </div>}
      </div>
    </section>
  );
}
