import { useSettingsDraft, confirmSettingsNavigation } from '../hooks/useSettingsDraft';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, UserPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useModalFocus from '../hooks/useModalFocus';
import { localizedError } from '../i18n/errors';

const inputClass = 'mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]';

export default function CreateCompanyMemberModal({ canAddDispatcher, initialRole = 'driver', onCreate, onCreated, onClose }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', gmailLabel: '', role: canAddDispatcher ? initialRole : 'driver' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const minimumPasswordLength = form.role === 'driver' ? 6 : 12;
  useSettingsDraft(Object.entries(form).some(([key, value]) => key !== 'role' && value), saving, t('driverSettings.discardChanges'));
  const close = () => { if (confirmSettingsNavigation()) onClose(); };
  useModalFocus(dialogRef, { onClose: close, busy: saving });
  const update = event => setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    if (saving || !form.name.trim() || !form.email.trim() || !form.phone.trim() || form.password.length < minimumPasswordLength || !form.password.trim()) return;
    const member = {
      name: form.name.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim(),
      password: form.password, role: canAddDispatcher ? form.role : 'driver',
      gmailLabel: form.role === 'driver' ? form.gmailLabel.trim() || form.name.trim() : null,
    };
    setSaving(true);
    setError('');
    try {
      await onCreate(member);
      onCreated?.(member);
      onClose();
    } catch (cause) {
      setError(localizedError(t, cause, 'errors.accountCreate'));
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[160] grid place-items-center bg-zinc-950/60 p-3 backdrop-blur-sm" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
      <section ref={dialogRef} id="new-member-form" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="new-member-title"
        aria-describedby="new-member-hint" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--line)] p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><UserPlus size={20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><h2 id="new-member-title" className="text-lg font-bold">{t('profile.createNewUser')}</h2><p id="new-member-hint" className="mt-1 text-sm text-[var(--muted)]">{t('profile.accountImmediateHint')}</p></div>
          <button type="button" onClick={close} disabled={saving} aria-label={t('profile.closeUserForm')} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-muted)] disabled:opacity-50"><X size={20} aria-hidden="true" /></button>
        </header>
        <form onSubmit={submit} aria-describedby={error ? 'member-form-error' : undefined} className="min-h-0 overflow-y-auto p-5">
          <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
            <label className="text-sm font-semibold">{t('profile.fullName')} *<input name="name" autoComplete="name" required maxLength={120} value={form.name} onChange={update} placeholder={t('profile.nameExample')} className={inputClass} /></label>
            {canAddDispatcher && <label className="text-sm font-semibold">{t('profile.position')} *<select name="role" value={form.role} onChange={update} className={inputClass}><option value="driver">{t('roles.driver')}</option><option value="dispatcher">{t('roles.dispatcher')}</option></select></label>}
            <label className="text-sm font-semibold">{t('common.email')} *<input name="email" type="email" autoComplete="off" required value={form.email} onChange={update} placeholder={form.role === 'dispatcher' ? 'dispatcher@company.com' : 'driver@company.com'} className={inputClass} /></label>
            <label className="text-sm font-semibold">{t('common.phone')} *<input name="phone" type="tel" autoComplete="off" required maxLength={40} value={form.phone} onChange={update} placeholder="+1 (773) 555-0199" className={inputClass} /></label>
            <label className="text-sm font-semibold">{t('profile.initialPassword')} *<input name="password" type="password" autoComplete="new-password" required minLength={minimumPasswordLength} maxLength={128} value={form.password} onChange={update} placeholder={t(form.role === 'driver' ? 'driverPassword.invalid' : 'profile.passwordMinimum')} className={inputClass} /></label>
            {form.role === 'driver' && <label className="text-sm font-semibold">{t('profile.gmailDriverLabel')}<input name="gmailLabel" maxLength={100} value={form.gmailLabel} onChange={update} placeholder={form.name.trim() || t('profile.nameExample')} className={inputClass} /><span className="mt-1.5 block text-xs font-normal leading-relaxed text-[var(--muted)]">{t('profile.gmailDriverLabelHint')}</span></label>}
          </fieldset>
          {error && <p id="member-form-error" role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          <footer className="mt-5 space-y-4 border-t border-[var(--line)] pt-4">
            <p className="text-xs leading-relaxed text-[var(--muted)]">{t('profile.accountImmediateNote')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={saving} className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50">{t('common.cancel')}</button>
              <button type="submit" disabled={saving || !onCreate} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--action-ink)] hover:bg-[var(--action-hover)] disabled:opacity-50">{saving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}{t(saving ? 'profile.creatingAccount' : 'profile.createAccount')}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>, document.body,
  );
}
