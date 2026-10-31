import { useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useSettingsDraft } from '../hooks/useSettingsDraft';

export default function ProfilePasswordForm({ currentUser, client = supabase }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ current: '', password: '', confirmation: '', nonce: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const lock = useRef(false);
  useSettingsDraft(Object.values(form).some(Boolean), busy, t('driverSettings.discardChanges'));
  const change = (key, value) => { setForm(previous => ({ ...previous, [key]: value })); setError(''); setSaved(false); };
  const submit = async event => {
    event.preventDefault();
    if (lock.current) return;
    if (form.password.length < 12 || form.password.length > 128) { setError('passwordLength'); return; }
    if (form.password !== form.confirmation) { setError('passwordMismatch'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const { error: failure } = await client.auth.updateUser({ current_password: form.current, password: form.password, ...(needsCode ? { nonce: form.nonce } : {}) });
      if (failure) throw failure;
      setForm({ current: '', password: '', confirmation: '', nonce: '' });
      setNeedsCode(false); setCodeSent(false); setSaved(true);
    } catch (failure) {
      if (failure?.code === 'reauthentication_needed' || failure?.code === 'reauthentication_not_valid') { setNeedsCode(true); setError('passwordCodeRequired'); }
      else if (failure?.code === 'weak_password') setError('passwordWeak');
      else if (failure?.code === 'same_password') setError('passwordSame');
      else setError('passwordFailed');
    } finally { lock.current = false; setBusy(false); }
  };
  const sendCode = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { error: failure } = await client.auth.reauthenticate();
      if (failure) throw failure;
      setCodeSent(true);
    } catch { setError('passwordFailed'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="profile-panel">
    <div className="profile-panel-title"><KeyRound size={22} aria-hidden="true" /><div><h3>{t('profile.changePassword')}</h3><p>{currentUser?.email}</p></div></div>
    <form onSubmit={submit} className="profile-password-form">
      <input type="text" name="username" autoComplete="username" value={currentUser?.email || ''} readOnly hidden />
      <fieldset disabled={busy} className="profile-form-grid">
        {[['current', 'currentPassword', 'current-password'], ['password', 'newPassword', 'new-password'], ['confirmation', 'confirmPassword', 'new-password']].map(([key, label, autocomplete]) => <label key={key}><span>{t(`profile.${label}`)}</span><input required type="password" name={key} autoComplete={autocomplete} maxLength={128} value={form[key]} onChange={event => change(key, event.target.value)} aria-invalid={error ? true : undefined} aria-describedby="profile-password-hint profile-password-error" /></label>)}
        {needsCode && <label><span>{t('profile.verificationCode')}</span><input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" maxLength={10} value={form.nonce} onChange={event => change('nonce', event.target.value.replace(/\D/g, ''))} /></label>}
      </fieldset>
      <p id="profile-password-hint" className="profile-panel-note">{t('profile.passwordLength')}</p>
      <p id="profile-password-error" role={error ? 'alert' : undefined} className="profile-save-error">{error ? t(`profile.${error}`) : ''}</p>
      {codeSent && <p role="status" className="profile-panel-note">{t('profile.passwordCodeSent')}</p>}
      {saved && <p role="status" className="profile-save-success">{t('profile.passwordSaved')}</p>}
      <div className="profile-save-actions">
        {needsCode && <button type="button" disabled={busy} onClick={sendCode}>{t('profile.sendCode')}</button>}
        <button type="submit" disabled={busy || !form.current || !form.password || !form.confirmation}>{t(busy ? 'profile.editSaving' : 'profile.changePassword')}</button>
      </div>
    </form>
  </section>;
}
