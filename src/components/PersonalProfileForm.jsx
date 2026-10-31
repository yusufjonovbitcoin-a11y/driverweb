import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { roleLabel } from '../i18n/labels';
import { useSettingsDraft } from '../hooks/useSettingsDraft';
import { personalProfilePayload } from '../services/personalProfile';

const fieldsFrom = user => ({ name: user?.name || '', phone: user?.phone || '', company: user?.company || '' });
export default function PersonalProfileForm({ currentUser, onSave }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => fieldsFrom(currentUser));
  const [saved, setSaved] = useState(() => fieldsFrom(currentUser));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const lastServerValues = useRef(fieldsFrom(currentUser));
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const next = { name: currentUser?.name || '', phone: currentUser?.phone || '', company: currentUser?.company || '' };
    const previousServer = lastServerValues.current;
    lastServerValues.current = next;
    setDraft(previous => Object.keys(next).every(key => previous[key] === previousServer[key]) ? next : previous);
    setSaved(next);
  }, [currentUser?.name, currentUser?.phone, currentUser?.company]); // Do not overwrite unsaved edits on auth refresh.
  const canEditCompany = currentUser?.roleCode === 'company_admin' && Boolean(currentUser?.companyId);
  const editableKeys = ['name', 'phone'];
  const dirty = editableKeys.some(key => draft[key].trim() !== saved[key]);
  useSettingsDraft(dirty, saving, t('driverSettings.discardChanges'));
  const change = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setNotice(''); setError(''); };
  const submit = async event => {
    event.preventDefault();
    if (inFlight.current || !onSave || !dirty) return;
    setError(''); setNotice('');
    try {
      const payload = { ...fieldsFrom(currentUser), ...Object.fromEntries(editableKeys.map(key => [key, draft[key]])) };
      personalProfilePayload(payload, canEditCompany);
      inFlight.current = true; setSaving(true);
      const result = await onSave(payload);
      if (!mounted.current) return;
      const next = { name: result.full_name, phone: result.phone || '', company: result.company_name ?? draft.company };
      setDraft(next); setSaved(next); setNotice(t('profile.editSaved'));
    } catch (failure) {
      if (!mounted.current) return;
      const key = { PROFILE_NAME_INVALID: 'editNameInvalid', PROFILE_PHONE_INVALID: 'editPhoneInvalid', PROFILE_COMPANY_INVALID: 'editCompanyInvalid', PROFILE_COMPANY_FORBIDDEN: 'editCompanyAdminOnly' }[failure?.message];
      setError(t(`profile.${key || 'editFailed'}`));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <form className="profile-personal-form" onSubmit={submit}>
    <fieldset disabled={saving} className="profile-form-grid">
      <label><span>{t('profile.fullName')}</span><input name="fullName" autoComplete="name" required minLength={2} maxLength={120} value={draft.name} onChange={event => change('name', event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'profile-form-error' : undefined} /></label>
      <label><span>{t('common.email')}</span><input name="email" type="email" autoComplete="email" readOnly value={currentUser?.email || ''} /></label>
      <label><span>{t('common.phone')}</span><input name="phone" type="tel" autoComplete="tel" maxLength={40} value={draft.phone} placeholder="+1 555 123 4567" onChange={event => change('phone', event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'profile-form-error' : undefined} /></label>
      <label><span>{t('profile.position')}</span><input name="role" readOnly value={roleLabel(t, currentUser?.roleCode || currentUser?.role)} /></label>
    </fieldset>
    <p className="profile-panel-note">{t('profile.editLockedHint')}</p>
    {error && <p id="profile-form-error" role="alert" className="profile-save-error">{error}</p>}
    {notice && <p role="status" className="profile-save-success">{notice}</p>}
    <div className="profile-save-actions">
      <button type="button" disabled={saving || !dirty} onClick={() => { setDraft(saved); setNotice(''); setError(''); }}>{t('profile.editCancel')}</button>
      <button type="submit" disabled={saving || !dirty || !onSave}>{t(saving ? 'profile.editSaving' : 'profile.editSave')}</button>
    </div>
  </form>;
}
