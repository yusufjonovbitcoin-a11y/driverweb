import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, LoaderCircle, Plus } from 'lucide-react';
import { createCompany, fetchCompanies } from '../services/operationsService';
import { localizedError } from '../i18n/errors';
import { accountStatusLabel } from '../i18n/labels';

export default function PlatformAdminPanel({ onLogout }) {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({
    companyName: '', adminFullName: '', adminEmail: '', adminPassword: '', adminPhone: '',
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setCompanies(await fetchCompanies());
  };

  useEffect(() => {
    let active = true;
    fetchCompanies().then((rows) => { if (active) setCompanies(rows); })
      .catch((error) => { if (active) setMessage(localizedError(t, error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [t]);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await createCompany(form);
      setForm({ companyName: '', adminFullName: '', adminEmail: '', adminPassword: '', adminPhone: '' });
      await refresh();
      setMessage(t('admin.success'));
    } catch (error) {
      setMessage(localizedError(t, error, 'errors.companyCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  const input = (key, label, type = 'text') => (
    <label className="space-y-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
      <span>{label}</span>
      <input
        required={key !== 'adminPhone'}
        type={type}
        minLength={type === 'password' ? 12 : undefined}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        value={form[key]}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
        className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100">{t('admin.title')}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t('admin.description')}</p>
        </div>
        <button onClick={onLogout} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{t('nav.logout')}</button>
      </div>
      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 md:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
        {input('companyName', t('admin.companyName'))}
        {input('adminFullName', t('admin.adminName'))}
        {input('adminEmail', t('admin.adminEmail'), 'email')}
        {input('adminPassword', t('profile.initialPassword'), 'password')}
        {input('adminPhone', `${t('common.phone')} (${t('common.optional')})`, 'tel')}
        <div className="md:col-span-2 flex items-center justify-between gap-4">
          <span className="text-sm text-zinc-500">{message}</span>
          <button disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950">
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('admin.createCompany')}
          </button>
        </div>
      </form>
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 font-bold text-zinc-900 dark:border-zinc-800 dark:text-zinc-100">{t('admin.companies')}</div>
        {loading ? (
          <div className="p-6 text-sm text-zinc-500">{t('common.loading')}</div>
        ) : companies.map((company) => (
          <div key={company.id} className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4 last:border-0 dark:border-zinc-800">
            <Building2 className="h-5 w-5 text-zinc-500" />
            <div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">{company.name}</div>
              <div className="text-xs uppercase text-zinc-500">{accountStatusLabel(t, company.status)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
