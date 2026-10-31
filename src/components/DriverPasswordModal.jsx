import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, KeyRound, LoaderCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useModalFocus from '../hooks/useModalFocus';
import { useSettingsDraft } from '../hooks/useSettingsDraft';
import { readDriverPassword, updateDriverPassword } from '../services/driverSettingsService';
import './driver-password.css';

const errorKey = failure => ({ MFA_REQUIRED: 'mfaRequired', FORBIDDEN: 'forbidden', DRIVER_NOT_FOUND: 'notFound',
  INVALID_PASSWORD: 'invalid', PASSWORD_REJECTED: 'rejected', RATE_LIMITED: 'rateLimited' }[failure?.message]);

export default function DriverPasswordModal({ driver, onClose, onSaved, onViewed }) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef(null);
  const savedStatusRef = useRef(null);
  const lock = useRef(false);
  const lifecycle = useRef({ active: false, version: 0 });
  const [form, setForm] = useState({ password: '', confirmation: '' });
  const [visible, setVisible] = useState({ password: false, confirmation: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [retained, setRetained] = useState(false);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [revealing, setRevealing] = useState(false);
  const [readError, setReadError] = useState('');
  // A revealed value exists only in this dialog. Reopening fetches status, never plaintext.
  const [storedPassword, setStoredPassword] = useState('');
  const [storedVisible, setStoredVisible] = useState(false);
  const dirty = Boolean(form.password || form.confirmation);
  useSettingsDraft(dirty, busy || revealing, t('driverSettings.discardChanges'));
  const close = () => {
    if (!lock.current && !busy && !revealing && (!dirty || window.confirm(t('driverSettings.discardChanges')))) {
      setStoredPassword(''); setForm({ password: '', confirmation: '' });
      setVisible({ password: false, confirmation: false }); setStoredVisible(false);
      onClose();
    }
  };
  useModalFocus(dialogRef, { onClose: close, busy: busy || revealing });
  const loadAvailability = useCallback(async () => {
    const request = ++lifecycle.current.version;
    setChecking(true); setReadError('');
    try {
      const result = await readDriverPassword(driver.id);
      if (lifecycle.current.active && request === lifecycle.current.version) setAvailable(result.available);
    } catch (failure) {
      if (lifecycle.current.active && request === lifecycle.current.version) setReadError(`driverPassword.${errorKey(failure) || 'readFailed'}`);
    } finally {
      if (lifecycle.current.active && request === lifecycle.current.version) setChecking(false);
    }
  }, [driver.id]);
  useEffect(() => {
    const state = lifecycle.current;
    state.active = true;
    queueMicrotask(() => { if (state.active) void loadAvailability(); });
    return () => { state.active = false; state.version++; };
  }, [loadAvailability]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setStoredPassword(''); setStoredVisible(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => { if (saved) savedStatusRef.current?.focus(); }, [saved]);
  const reveal = async () => {
    if (busy || revealing) return;
    if (storedVisible) { setStoredVisible(false); setStoredPassword(''); return; }
    if (storedPassword) { setStoredVisible(true); return; }
    if (!available) return;
    setRevealing(true); setReadError('');
    try {
      const result = await readDriverPassword(driver.id, { reveal: true });
      if (!lifecycle.current.active) return;
      setAvailable(result.available);
      if (document.hidden) { setStoredPassword(''); setStoredVisible(false); return; }
      if (result.available) { setStoredPassword(result.password); setStoredVisible(true); onViewed?.(); }
      else { setStoredPassword(''); setStoredVisible(false); }
    } catch (failure) {
      if (lifecycle.current.active) setReadError(`driverPassword.${errorKey(failure) || 'readFailed'}`);
    } finally { if (lifecycle.current.active) setRevealing(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (lock.current || revealing) return;
    if (form.password.length < 6 || form.password.length > 128 || !form.password.trim()) { setError('driverPassword.invalid'); return; }
    if (form.password !== form.confirmation) { setError('profile.passwordMismatch'); return; }
    lock.current = true; lifecycle.current.version++; setChecking(false);
    setStoredPassword(''); setStoredVisible(false);
    setBusy(true); setError(''); setSaved(false);
    try {
      const result = await updateDriverPassword(driver.id, form.password);
      if (!lifecycle.current.active) return;
      setStoredPassword(document.hidden ? '' : form.password); setStoredVisible(false); setReadError('');
      setRetained(result.retained); setAvailable(result.retained);
      setForm({ password: '', confirmation: '' }); setVisible({ password: false, confirmation: false });
      setSaved(true); onSaved?.();
    } catch (failure) {
      if (lifecycle.current.active) { setError(`driverPassword.${errorKey(failure) || 'failed'}`); setVisible({ password: false, confirmation: false }); }
    } finally { lock.current = false; if (lifecycle.current.active) setBusy(false); }
  };
  return createPortal(<div className="driver-password-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} className="driver-password-dialog">
      <header><span className="driver-password-icon"><KeyRound size={22} aria-hidden="true" /></span><div><h2 id={`${id}-title`}>{t('driverPassword.manage')}</h2><p>{driver.name} · {driver.driverNumber}</p></div><button type="button" onClick={close} disabled={busy || revealing} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button></header>
      <div className="driver-password-body">
        {saved && <p ref={savedStatusRef} tabIndex={-1} role="status">{t('driverPassword.saved')}</p>}
        <section className="driver-password-stored" aria-labelledby={`${id}-stored-heading`}>
          <h3 id={`${id}-stored-heading`}>{t('driverPassword.storedHeading')}</h3>
          {checking ? <p role="status">{t('driverSettings.loading')}</p> : <>
            {(available || saved) ? <>
              <label className="sr-only" htmlFor={`${id}-saved-password`}><span>{t('driverPassword.savedValue')}</span></label>
              <div className="driver-password-input">
                <input id={`${id}-saved-password`} type={storedVisible ? 'text' : 'password'} value={storedPassword} placeholder="••••••••" readOnly autoComplete="off" spellCheck={false} aria-describedby={`${id}-stored-hint`} />
                <button type="button" disabled={busy || revealing || (!available && !storedPassword)} aria-controls={`${id}-saved-password`} aria-pressed={storedVisible} aria-label={t(storedVisible ? 'common.hidePassword' : 'driverPassword.reveal')} onClick={reveal}>{revealing ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : storedVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
              </div>
              <p id={`${id}-stored-hint`}>{t(saved && !retained ? 'driverPassword.notRetained' : 'driverPassword.availableHint')}</p>
            </> : !readError && <p>{t('driverPassword.noSavedPassword')}</p>}
            {readError && <p role="alert" className="driver-password-error">{t(readError)} <button type="button" disabled={busy || revealing} onClick={loadAvailability}>{t('driverSettings.retry')}</button></p>}
          </>}
        </section>
        {saved ? <footer><button type="button" onClick={close} disabled={revealing}>{t('common.close')}</button></footer> : <form onSubmit={submit} aria-busy={busy}>
          <h3 className="driver-password-new-heading">{t('driverPassword.title')}</h3>
          <input type="text" name="username" autoComplete="username" value={driver.email || ''} readOnly hidden />
          <fieldset disabled={busy || revealing}>{['password', 'confirmation'].map(key => <label key={key} htmlFor={`${id}-${key}`}><span>{t(key === 'password' ? 'profile.newPassword' : 'profile.confirmPassword')}</span><div className="driver-password-input"><input id={`${id}-${key}`} name={key} type={visible[key] ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} required value={form[key]} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setForm(previous => ({ ...previous, [key]: event.target.value })); setError(''); }} /><button type="button" aria-controls={`${id}-${key}`} aria-pressed={visible[key]} aria-label={t(visible[key] ? 'common.hidePassword' : 'common.showPassword')} onClick={() => setVisible(previous => ({ ...previous, [key]: !previous[key] }))}>{visible[key] ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></label>)}</fieldset>
          {error && <p id={`${id}-error`} role="alert" className="driver-password-error">{t(error)}</p>}
          <footer><button type="button" onClick={close} disabled={busy || revealing}>{t('common.cancel')}</button><button type="submit" disabled={busy || revealing || !form.password || !form.confirmation}>{busy && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}{t(busy ? 'profile.editSaving' : 'driverPassword.set')}</button></footer>
        </form>}
      </div>
    </section>
  </div>, document.body);
}
