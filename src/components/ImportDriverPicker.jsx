import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, FileText, LoaderCircle, Search, Truck, UsersRound, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizedError } from '../i18n/errors';
import './importDriverPicker.css';

export default function ImportDriverPicker({
  drivers = [],
  fileName,
  processing = false,
  error,
  selectedDriverId,
  onSelectDriver,
  onCancel,
  onRetry,
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const cancelRef = useRef(onCancel);
  const [query, setQuery] = useState('');
  const availableDrivers = drivers.filter((driver) => driver?.id != null);
  const selectedDriver = availableDrivers.find((driver) => driver.id === selectedDriverId);
  const search = query.trim().toLocaleLowerCase();
  const filteredDrivers = availableDrivers.filter((driver) => [driver.name, driver.truck, driver.driverNumber]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(search)));
  const errorText = typeof error === 'string' ? error : localizedError(t, error, 'documentImportSelection.errorHint');

  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchRef.current?.focus();

    const focusableItems = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      .filter((item) => item.getClientRects().length > 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableItems();
      const first = items[0];
      const last = items.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const driverName = (driver) => driver.name || t('documentImportSelection.unnamedDriver');

  return (
    <div className="import-driver-overlay">
      <section
        ref={dialogRef}
        className="import-driver-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        tabIndex={-1}
      >
        <header className="import-driver-header">
          <div>
            <h2 id={`${id}-title`}>{t('documentImportSelection.title')}</h2>
            <p id={`${id}-description`}>{t('documentImportSelection.description')}</p>
          </div>
          <button type="button" className="import-driver-close" onClick={onCancel} aria-label={t('documentImportSelection.close')}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="import-driver-body">
          <div className={`import-driver-document${error ? ' has-error' : processing ? ' is-processing' : ' is-ready'}`}>
            <div className="import-driver-file"><FileText size={19} aria-hidden="true" /><span title={fileName}>{fileName || t('documentImportSelection.document')}</span></div>
            <div className="import-driver-progress" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">
              {error ? <AlertCircle size={18} aria-hidden="true" /> : processing ? <LoaderCircle size={18} className="import-driver-spinner" aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
              <div>
                <strong>{t(error ? 'documentImportSelection.errorTitle' : processing ? 'documentImportSelection.processingTitle' : 'documentImportSelection.readyTitle')}</strong>
                <p>{error ? errorText : t(processing ? 'documentImportSelection.processingHint' : 'documentImportSelection.readyHint')}</p>
              </div>
            </div>
            {error && onRetry && <button type="button" className="import-driver-retry" onClick={onRetry} disabled={processing}>{t('documentImportSelection.retry')}</button>}
          </div>

          <label className="import-driver-search" htmlFor={`${id}-search`}>
            <Search size={18} aria-hidden="true" />
            <input
              id={`${id}-search`}
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('documentImportSelection.searchPlaceholder')}
              aria-label={t('documentImportSelection.searchLabel')}
              autoComplete="off"
            />
          </label>

          <fieldset className="import-driver-list">
            <legend>{t('documentImportSelection.drivers')}</legend>
            {filteredDrivers.map((driver) => {
              const selected = driver.id === selectedDriverId;
              return (
                <button key={driver.id} type="button" className={`import-driver-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => onSelectDriver(driver.id)}>
                  <span className="import-driver-avatar" aria-hidden="true"><UsersRound size={19} /></span>
                  <span className="import-driver-identity">
                    <strong>{driverName(driver)}</strong>
                    <span className="import-driver-details">
                      {driver.driverNumber && <span>{t('documentImportSelection.driverNumber', { number: driver.driverNumber })}</span>}
                      {driver.truck && <span><Truck size={13} aria-hidden="true" />{t('documentImportSelection.truck', { number: driver.truck })}</span>}
                    </span>
                  </span>
                  {selected ? <Check size={18} className="import-driver-check" aria-hidden="true" /> : <ArrowRight size={17} className="import-driver-check" aria-hidden="true" />}
                </button>
              );
            })}
            {filteredDrivers.length === 0 && <div className="import-driver-empty" role="status">
              <UsersRound size={27} aria-hidden="true" />
              <strong>{t(availableDrivers.length ? 'documentImportSelection.noMatches' : 'documentImportSelection.noDrivers')}</strong>
              <p>{t(availableDrivers.length ? 'documentImportSelection.noMatchesHint' : 'documentImportSelection.noDriversHint')}</p>
              {availableDrivers.length > 0 && <button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>{t('documentImportSelection.clearSearch')}</button>}
            </div>}
          </fieldset>
        </div>

        <footer className="import-driver-footer">
          <p aria-live="polite">{selectedDriver ? t('documentImportSelection.selectedDriver', { name: driverName(selectedDriver) }) : t('documentImportSelection.selectHint')}</p>
          <div>
            <button type="button" className="import-driver-cancel" onClick={onCancel}>{t('documentImportSelection.cancel')}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
