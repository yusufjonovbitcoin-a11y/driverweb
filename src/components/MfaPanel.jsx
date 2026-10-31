import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { verifiedTotpFactors, verifyTotp } from '../services/mfa';
import './mfa.css';
import { useSettingsDraft } from '../hooks/useSettingsDraft';

export default function MfaPanel({ challengeOnly = false, onVerified, onLogout, client = supabase }) {
  const { t } = useTranslation();
  const [factors, setFactors] = useState([]), [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  useSettingsDraft(Boolean(enrollment), busy, t('driverSettings.discardChanges'));
  useEffect(() => {
    let active = true;
    verifiedTotpFactors(client).then(value => { if (active) { setFactors(value); setReady(true); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [client]);
  async function action(work) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFailed(false);
    try { await work(); } catch { setFailed(true); } finally { lock.current = false; setBusy(false); }
  }
  const refresh = async () => { setFactors(await verifiedTotpFactors(client)); setReady(true); };
  async function enroll() {
    const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'T Fleets authenticator' });
    if (error) throw error;
    setEnrollment(data); setCode('');
  }
  async function cancelEnrollment() {
    const { error } = await client.auth.mfa.unenroll({ factorId: enrollment.id });
    if (error) throw error;
    setEnrollment(null); setCode('');
  }
  async function verify(event) {
    event.preventDefault();
    await action(async () => {
      await verifyTotp(client, enrollment?.id || factors[0]?.id, code);
      setEnrollment(null); setCode(''); await refresh(); await onVerified?.();
    });
  }
  return <section className="profile-panel mfa-panel" aria-label={t('mfa.title')}>
    <h3>{t('mfa.title')}</h3><p>{t(challengeOnly ? 'mfa.challengeHint' : 'mfa.description')}</p>
    {failed && <p role="alert">{t('mfa.failed')} <button type="button" disabled={busy} onClick={() => action(refresh)}>{t('mfa.retry')}</button></p>}
    {!ready && !failed && <p role="status">{t('mfa.loading')}</p>}
    {enrollment && <div><p>{t('mfa.scan')}</p><img width="200" height="200" src={enrollment.totp.qr_code} alt={t('mfa.qr')} /><details><summary>{t('mfa.manual')}</summary><code>{enrollment.totp.secret}</code></details></div>}
    {(enrollment || (ready && challengeOnly && factors.length > 0)) && <form onSubmit={verify}>
      <label>{t('mfa.code')}<input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required disabled={busy} /></label>
      <button className="primary-button" disabled={busy || code.length !== 6}>{t('mfa.verify')}</button>
      {enrollment && <button type="button" disabled={busy} onClick={() => action(cancelEnrollment)}>{t('mfa.cancel')}</button>}
    </form>}
    {!challengeOnly && ready && !enrollment && (factors.length ? <div><p>{t('mfa.enabled')}</p><p>{t('mfa.removeHint')}</p><button disabled={busy} onClick={() => { if (!window.confirm(t('profile.mfaRemoveConfirm'))) return; return action(async () => {
      const { error } = await client.auth.mfa.unenroll({ factorId: factors[0].id });
      if (error) throw error;
      await client.auth.refreshSession(); await refresh();
    }); }}>{t('mfa.remove')}</button></div> : <button className="primary-button" disabled={busy} onClick={() => action(enroll)}>{t('mfa.enable')}</button>)}
    {challengeOnly && <button type="button" disabled={busy} onClick={() => action(onLogout)}>{t('mfa.signOut')}</button>}
  </section>;
}
