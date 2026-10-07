import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  connectGmailIntegration,
  disconnectGmailIntegration,
  fetchGmailIntegration,
} from '../services/operationsService';
import { 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  X,
  Search,
  Truck,
  UserPlus,
  Settings,
  Bell,
  ShieldCheck,
  Users,
  ChevronRight,
  Link2,
  UserRound,
  UserCog,
  Plug,
  Eye,
  EyeOff,
  LoaderCircle,
  RotateCw,
  Unplug,
  CircleAlert,
  ExternalLink,
  Pencil,
} from 'lucide-react';
import { DEFAULT_TIME_ZONE } from '../i18n/timeZone.js';
import { formatDateTime } from '../i18n/format';
import { roleLabel } from '../i18n/labels';
import { localizedError } from '../i18n/errors';
import FleetVehiclesPanel from './FleetVehiclesPanel';
import DriverVehicleAssignmentModal from './DriverVehicleAssignmentModal';
import DriverContactEditModal from './DriverContactEditModal';
import DriverProfilePanel from './DriverProfilePanel';
import ProfileSettingsHub from './ProfileSettingsHub';
import { ProfileContactPanel, ProfileNotificationsPanel, ProfilePersonalPanel, ProfileSectionHeading, ProfileSecurityPanel } from './ProfileAccountPanels';
import './profileCenter.css';

function GmailIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 21" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M1.64 20.18h3.27V10.27L.23 6.76v11.78c0 .91.73 1.64 1.41 1.64Z" />
      <path fill="#34A853" d="M19.09 20.18h3.27c.91 0 1.64-.73 1.64-1.64V6.76l-4.91 3.68v9.74Z" />
      <path fill="#EA4335" d="M19.09 3.76v6.68L24 6.76V4.58c0-2.02-2.31-3.18-3.93-1.96l-.98.73v.41Z" />
      <path fill="#FBBC04" d="M4.91 10.27V3.76L12 9.08l7.09-5.32v6.68L12 15.76l-7.09-5.49Z" />
      <path fill="#C5221F" d="M0 4.58v2.18l4.91 3.68V3.76l-.98-.74C2.31 1.81 0 2.97 0 4.58Z" />
    </svg>
  );
}

export default function ProfileView({ 
  drivers, 
  members = [],
  loads, 
  onAddDriver, 
  onDeleteMember,
  currentUser,
  browserPush,
  onSaveProfile,
  onNavigate,
  onOpenDriver,
  selectedDriverId = null,
  onAssignDriverLoad,
  onOpenDriverChat,
  onOpenDriverLoad,
  theme = 'light',
  toggleTheme,
  unreadChatCount = 0,
  unreadInboxCount = 0,
  locale = 'uz',
  onLocaleChange,
  timeZone = DEFAULT_TIME_ZONE,
  onTimeZoneChange,
  onWorkspaceRefresh,
  initialDriverToEditId = null,
  onEditDriverClosed,
}) {
  const { t } = useTranslation();
  // Inline Form State (NO POPUP MODAL - 100% INLINE FULL-WIDTH FORM)
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [successToast, setSuccessToast] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [companyMemberView, setCompanyMemberView] = useState('drivers');
  const [activeSection, setActiveSection] = useState(
    initialDriverToEditId || selectedDriverId ? 'company' : 'settings',
  );
  const [gmailConnection, setGmailConnection] = useState(null);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [gmailPasswordVisible, setGmailPasswordVisible] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailSaving, setGmailSaving] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const [localeSaving, setLocaleSaving] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState(null);
  const [vehicleAssignmentDriver, setVehicleAssignmentDriver] = useState(null);
  const [editingDriverId, setEditingDriverId] = useState(initialDriverToEditId);
  const editingDriver = drivers.find((driver) => driver.id === editingDriverId);
  const selectedProfileDriver = drivers.find((driver) => driver.id === selectedDriverId) || null;
  const closeDriverEditor = () => {
    setEditingDriverId(null);
    onEditDriverClosed?.();
  };
  const addFormToggleRef = useRef(null);

  // Form State for Adding Driver
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('driver');
  const [phone, setPhone] = useState('');
  const [gmailLabel, setGmailLabel] = useState('');
  const handlePrepareForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('driver');
    setFormError('');
    setPhone('');
    setGmailLabel('');
  };

  const closeAddForm = () => {
    setIsAddFormOpen(false);
    setFormError('');
    requestAnimationFrame(() => addFormToggleRef.current?.focus());
  };

  const changeSection = (sectionId, { focusPanel = false } = {}) => {
    if (activeSection === 'integrations' && sectionId !== 'integrations') {
      setGmailAppPassword('');
      setGmailPasswordVisible(false);
      setGmailError('');
    }
    setActiveSection(sectionId);
    if (focusPanel) {
      requestAnimationFrame(() => {
        const panel = document.getElementById('profile-section-panel');
        panel?.focus({ preventScroll: true });
        const target = window.matchMedia('(max-width: 1000px)').matches
          ? panel : document.querySelector('.profile-center-layout');
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    }
  };

  const canManageIntegrations = currentUser?.roleCode === 'company_admin';
  const refreshGmailConnection = useCallback(async () => {
    if (!canManageIntegrations) return;
    setGmailLoading(true);
    setGmailError('');
    try {
      const connection = await fetchGmailIntegration();
      setGmailConnection(connection);
      if (connection?.mailboxEmail) setGmailEmail(connection.mailboxEmail);
    } catch (error) {
      setGmailError(localizedError(t, error, 'errors.gmailStatus'));
    } finally {
      setGmailLoading(false);
    }
  }, [canManageIntegrations, t]);

  const handleGmailConnect = async (event) => {
    event.preventDefault();
    const normalizedPassword = gmailAppPassword.replace(/\s+/g, '');
    if (!gmailEmail.trim().toLowerCase().endsWith('@gmail.com')) {
      setGmailError(t('profile.gmailInvalidAddress'));
      return;
    }
    if (!/^[A-Za-z0-9]{16}$/.test(normalizedPassword)) {
      setGmailError(t('profile.gmailInvalidAppPassword'));
      return;
    }

    setGmailSaving(true);
    setGmailError('');
    try {
      const connection = await connectGmailIntegration({
        mailboxEmail: gmailEmail.trim().toLowerCase(),
        appPassword: normalizedPassword,
      });
      setGmailConnection(connection);
      setGmailEmail(connection?.mailboxEmail || gmailEmail.trim().toLowerCase());
      setGmailAppPassword('');
      setGmailPasswordVisible(false);
      setSuccessToast(t('profile.gmailSaved'));
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (error) {
      setGmailAppPassword('');
      setGmailPasswordVisible(false);
      setGmailError(localizedError(t, error, 'errors.gmailSave'));
    } finally {
      setGmailSaving(false);
    }
  };

  const handleGmailDisconnect = async () => {
    if (gmailSaving) return;
    if (!window.confirm(t('profile.gmailDisconnectConfirm'))) return;
    setGmailSaving(true);
    setGmailError('');
    try {
      const connection = await disconnectGmailIntegration();
      setGmailConnection(connection);
      setGmailAppPassword('');
      setSuccessToast(t('profile.gmailDisconnectedSuccess'));
      setTimeout(() => setSuccessToast(''), 4000);
    } catch (error) {
      setGmailError(localizedError(t, error, 'errors.gmailDisconnect'));
    } finally {
      setGmailSaving(false);
    }
  };

  const handleToggleAddForm = () => {
    if (!isAddFormOpen) {
      handlePrepareForm();
      setIsAddFormOpen(true);
    } else {
      closeAddForm();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || password.length < 12 || isSubmitting) return;

    const newDriver = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
      role,
      phone: phone.trim(),
      gmailLabel: role === 'driver' ? (gmailLabel.trim() || name.trim()) : null,
    };

    setIsSubmitting(true);
    setFormError('');
    try {
      await onAddDriver(newDriver);
      closeAddForm();
      const roleName = roleLabel(t, role);
      setSuccessToast(t('profile.accountCreated', { role: roleName, name: newDriver.name }));
      setTimeout(() => setSuccessToast(''), 4000);
    } catch (error) {
      setFormError(localizedError(t, error, 'errors.accountCreate'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteMember = async (member) => {
    if (!onDeleteMember || deletingMemberId) return false;
    const confirmationKey = member.role === 'dispatcher'
      ? 'profile.removeDispatcherConfirm'
      : 'profile.removeDriverConfirm';
    if (!window.confirm(t(confirmationKey, { name: member.name }))) return false;
    setDeletingMemberId(member.id);
    try {
      await onDeleteMember(member);
      if (member.id === selectedDriverId) onOpenDriver?.(null);
      return true;
    } finally {
      setDeletingMemberId(null);
    }
  };

  const totalDrivers = drivers.length;
  const availableDrivers = drivers.filter(d => !loads.some(l => l.driverId === d.id && l.status !== 'COMPLETED')).length;
  const onDutyDrivers = totalDrivers - availableDrivers;
  const activeLoads = loads.filter((load) => load.status !== 'COMPLETED').length;
  const completedLoads = loads.filter((load) => (
    load.databaseStatus ? load.databaseStatus === 'completed' : load.status === 'COMPLETED'
  )).length;
  const notificationCount = unreadChatCount + unreadInboxCount;
  const handleLocaleChange = async (value) => {
    setLocaleSaving(true);
    try { await onLocaleChange?.(value); }
    catch { /* Parent reports localized errors. */ }
    finally { setLocaleSaving(false); }
  };

  // Filter drivers for table
  const filteredDrivers = drivers.filter(driver => {
    const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');
    if (statusFilter === 'AVAILABLE' && activeLoad) return false;
    if (statusFilter === 'ON_DUTY' && !activeLoad) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      driver.name.toLowerCase().includes(q) ||
      (driver.truck && driver.truck.toLowerCase().includes(q)) ||
      (driver.trailer && driver.trailer.toLowerCase().includes(q)) ||
      (driver.currentLocation && driver.currentLocation.toLowerCase().includes(q)) ||
      (driver.driverNumber && driver.driverNumber.toLowerCase().includes(q)) ||
      (activeLoad && activeLoad.loadNumber.toLowerCase().includes(q))
    );
  });
  const dispatchers = members.filter((member) => member.role === 'dispatcher');
  const filteredDispatchers = dispatchers.filter((dispatcher) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    return [dispatcher.name, dispatcher.email, dispatcher.phone]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(query));
  });

  const sections = [
    { id: 'overview', label: t('profile.personal'), icon: UserRound },
    { id: 'company', label: t('common.company'), icon: Building2 },
    { id: 'contact', label: t('profile.contact'), icon: Link2 },
    ...(canManageIntegrations ? [{ id: 'integrations', label: t('profile.integrations'), icon: Plug }] : []),
    { id: 'security', label: t('profile.security'), icon: ShieldCheck },
    { id: 'notifications', label: t('profile.notifications'), icon: Bell },
    { id: 'settings', label: t('profile.settings'), icon: Settings },
  ];


  return (
    <div className="profile-center w-full">
      
      {/* Success Notification Toast */}
      {successToast && (
        <div role="status" aria-live="polite" className="bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm font-bold animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
              <button aria-label={t('profile.closeNotification')} onClick={() => setSuccessToast('')} className="rounded opacity-80 hover:opacity-100 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="profile-center-layout">
        <aside className="profile-identity-card">
          <div className="profile-identity-top">
            <span className="profile-identity-avatar">{currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}</span>
            <h2>{currentUser?.name || '—'}</h2>
            <p>{roleLabel(t, currentUser?.roleCode || currentUser?.role)}</p>
          </div>
          <div className="profile-identity-company"><Building2 size={21} /><div><strong>{currentUser?.company || t('common.notProvided')}</strong><span>{t('profile.companyTeam')}</span></div></div>
          <div className="profile-identity-contacts">
            <p><Mail size={16} /><span>{currentUser?.email || t('profile.emailMissing')}</span></p>
            <p><Phone size={16} /><span>{currentUser?.phone || t('profile.phoneMissing')}</span></p>
          </div>
          <div className="profile-identity-stats">
            <span><strong>{totalDrivers}</strong>{t('nav.drivers')}</span>
            <span><strong>{activeLoads}</strong>{t('profile.activeLoads')}</span>
            <span><strong>{completedLoads}</strong>{t('profile.completed')}</span>
          </div>
          <nav aria-label={t('profile.sections')} className="profile-center-nav">
            {sections.map(section => {
              const Icon = section.icon;
              return <button key={section.id} type="button" aria-pressed={activeSection === section.id} aria-controls="profile-section-panel"
                onClick={() => { changeSection(section.id, { focusPanel: true }); if (section.id === 'integrations') refreshGmailConnection(); }}>
                <Icon size={17} aria-hidden="true" /><span>{section.label}</span><ChevronRight size={15} aria-hidden="true" />
              </button>;
            })}
          </nav>
        </aside>

      <div
        id="profile-section-panel"
        role="region"
        aria-label={t('profile.sectionLabel', { section: sections.find((section) => section.id === activeSection)?.label || t('nav.profile') })}
        tabIndex={-1}
        className={`profile-section-content profile-section-${activeSection} space-y-6 focus:outline-none`}
      >
        {activeSection === 'settings' && <ProfileSettingsHub currentUser={currentUser}
          locale={locale} localeSaving={localeSaving} timeZone={timeZone} theme={theme} toggleTheme={toggleTheme}
          notificationCount={notificationCount} canManageIntegrations={canManageIntegrations} gmailConnection={gmailConnection}
          onSection={section => { changeSection(section, { focusPanel: true }); if (section === 'integrations') refreshGmailConnection(); }}
          onLocaleChange={handleLocaleChange}
          onTimeZoneChange={onTimeZoneChange} />}

        {activeSection === 'overview' && (
          <ProfilePersonalPanel currentUser={currentUser} locale={locale} localeSaving={localeSaving} timeZone={timeZone}
            onLocaleChange={handleLocaleChange} onTimeZoneChange={onTimeZoneChange} onSaveProfile={onSaveProfile} />
        )}

      {activeSection === 'contact' && (
          <ProfileContactPanel currentUser={currentUser} timeZone={timeZone} />
      )}

      {activeSection === 'integrations' && canManageIntegrations && (
        <div className="profile-gmail-layout">
          <ProfileSectionHeading title={t('profile.gmailTitle')} description={t('profile.gmailDescription')} />
          <section aria-labelledby="gmail-integration-heading" aria-busy={gmailLoading || gmailSaving} className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <p role="status" aria-live="polite" className="sr-only">
              {gmailLoading ? t('profile.gmailChecking') : gmailSaving ? t('profile.gmailSaving') : gmailConnection?.status === 'active' ? t('profile.gmailConnected') : gmailConnection?.status === 'needs_reconnect' ? t('profile.gmailChecking') : t('profile.gmailDisconnected')}
            </p>
            <div className="flex flex-col gap-4 border-b border-zinc-100 pb-5 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  <GmailIcon className="h-5 w-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="gmail-integration-heading" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Gmail</h2>
                    {gmailConnection?.status === 'active' && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">{t('profile.connected')}</span>}
                    {gmailConnection?.status === 'needs_reconnect' && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">{t('profile.checking')}</span>}
                    {gmailConnection?.status === 'disabled' && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t('profile.disconnected')}</span>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t('profile.gmailDescription')}</p>
                </div>
              </div>
              <button type="button" onClick={refreshGmailConnection} disabled={gmailLoading || gmailSaving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                <RotateCw className={`h-3.5 w-3.5 ${gmailLoading ? 'animate-spin' : ''}`} aria-hidden="true" /> {t('profile.refreshStatus')}
              </button>
            </div>

            {gmailError && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <span>{gmailError}</span>
              </div>
            )}

            {gmailConnection?.lastError && (
              <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <strong className="block">{t('profile.lastSyncError')}</strong>
                <span className="mt-1 block">{t('profile.gmailSyncFailed')}</span>
              </div>
            )}

            <form onSubmit={handleGmailConnect} className="mt-5">
              <fieldset disabled={gmailSaving || gmailLoading} className="space-y-4 disabled:opacity-70">
              <div>
                <label htmlFor="gmail-mailbox-email" className="mb-1.5 block text-xs font-bold text-zinc-600 dark:text-zinc-300">{t('profile.gmailAddress')}</label>
                <input id="gmail-mailbox-email" type="email" inputMode="email" autoComplete="email" required value={gmailEmail} onChange={(event) => setGmailEmail(event.target.value)} placeholder="company@gmail.com" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label htmlFor="gmail-app-password" className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{t('profile.googleAppPassword')}</label>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300">{t('profile.getAppPassword')} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                </div>
                <div className="relative">
                  <input id="gmail-app-password" type={gmailPasswordVisible ? 'text' : 'password'} autoComplete="new-password" required aria-describedby="gmail-app-password-help gmail-vault-help" value={gmailAppPassword} onChange={(event) => setGmailAppPassword(event.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 pr-11 font-mono text-sm tracking-wider text-zinc-900 outline-none transition placeholder:tracking-normal placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
                  <button type="button" onClick={() => setGmailPasswordVisible((visible) => !visible)} aria-label={gmailPasswordVisible ? t('common.hidePassword') : t('common.showPassword')} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200">
                    {gmailPasswordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p id="gmail-app-password-help" className="mt-1.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{t('profile.appPasswordHelp')}</p>
              </div>

              <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                <p id="gmail-vault-help" className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('profile.vaultHelp')}</p>
                <div className="flex flex-wrap gap-2">
                  {gmailConnection && gmailConnection.status !== 'disabled' && (
                    <button type="button" onClick={handleGmailDisconnect} disabled={gmailSaving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3.5 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">
                      <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> {t('profile.disconnect')}
                    </button>
                  )}
                  <button type="submit" disabled={gmailSaving || gmailLoading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500">
                    {gmailSaving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
                    {gmailConnection && gmailConnection.status !== 'disabled' ? t('profile.updateConnection') : t('profile.connectGmail')}
                  </button>
                </div>
              </div>
              </fieldset>
            </form>
          </section>

          <aside className="profile-gmail-support">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{t('profile.connectionStatus')}</h2>
              {gmailLoading ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> {t('profile.checking')}…</div>
              ) : (
                <dl className="mt-3 divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">{t('profile.account')}</dt><dd className="break-all text-right font-semibold">{gmailConnection?.mailboxEmail || t('profile.disconnected')}</dd></div>
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">IMAP</dt><dd className="text-right font-semibold">imap.gmail.com:993</dd></div>
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">{t('profile.lastSync')}</dt><dd className="text-right font-semibold">{gmailConnection?.lastSyncedAt ? formatDateTime(gmailConnection.lastSyncedAt) : t('profile.neverSynced')}</dd></div>
                </dl>
              )}
            </section>
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">{t('profile.howItWorks')}</h2>
              <ol className="profile-gmail-steps">
                <li><span>1</span><p>{t('profile.gmailStepOne')}</p></li>
                <li><span>2</span><p>{t('profile.gmailStepTwo')}</p></li>
                <li><span>3</span><p>{t('profile.gmailStepThree')}</p></li>
              </ol>
            </section>
          </aside>
          <section className="profile-panel">
            <div className="profile-panel-title"><Mail size={21} aria-hidden="true" /><div><h3>{t('profile.gmailDriverLabel')}</h3><p>{t('profile.gmailDriverLabelHint')}</p></div></div>
            <button type="button" className="profile-inline-action" onClick={() => { setCompanyMemberView('drivers'); changeSection('company', { focusPanel: true }); }}>{t('profile.companyTeam')}<ChevronRight size={16} aria-hidden="true" /></button>
          </section>
        </div>
      )}

      {activeSection === 'security' && (
        <ProfileSecurityPanel currentUser={currentUser} />
      )}

      {activeSection === 'notifications' && (
        <ProfileNotificationsPanel browserPush={browserPush} unreadInboxCount={unreadInboxCount} unreadChatCount={unreadChatCount} onNavigate={onNavigate} />
      )}

      {activeSection === 'company' && (
        selectedProfileDriver && companyMemberView === 'drivers' ? (
          <DriverProfilePanel
            driver={selectedProfileDriver}
            loads={loads}
            canManage={currentUser?.roleCode === 'company_admin'}
            deleting={deletingMemberId === selectedProfileDriver.id}
            onBack={() => onOpenDriver?.(null)}
            onEdit={(driver) => setEditingDriverId(driver.id)}
            onAssignVehicle={setVehicleAssignmentDriver}
            onAssignLoad={onAssignDriverLoad}
            onOpenChat={onOpenDriverChat}
            onOpenLoad={onOpenDriverLoad}
            onDelete={(driver) => handleDeleteMember({ ...driver, role: 'driver' })}
          />
        ) : (
        <section className="profile-panel profile-company-panel">
          <ProfileSectionHeading title={t('common.company')} description={t('profile.companyTeamHint')} />
          <div className="profile-company-identity"><span className="profile-row-icon"><Building2 size={23} aria-hidden="true" /></span><div><strong>{currentUser?.company || t('common.notProvided')}</strong><p>{t('profile.companyTeam')}</p></div></div>
          {formError && <p id="member-form-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{formError}</p>}

      {/* 2. HAYDOVCHILARNI BOSHQARISH & AMALLAR PANELI */}
      <div className="profile-company-toolbar flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            {t('profile.companyTeam')}
          </h3>
        </div>

        {/* Toggle Form Button (Modal emas, sahifadagi formani ochish/yopish) */}
        {companyMemberView !== 'vehicles' && <button
          ref={addFormToggleRef}
          onClick={handleToggleAddForm}
          aria-expanded={isAddFormOpen}
          aria-controls="new-member-form"
          className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl font-bold text-sm shadow-xs transition-colors cursor-pointer self-start sm:self-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
            isAddFormOpen
              ? 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100'
              : 'bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950'
          }`}
        >
          {isAddFormOpen ? (
            <>
              <X className="w-4 h-4" />
              <span>{t('profile.closeForm')}</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>{t('profile.addUser')}</span>
            </>
          )}
        </button>}
      </div>

          <div role="group" aria-label={t('profile.members')} className="profile-company-tabs">
        <button
          type="button"
          aria-pressed={companyMemberView === 'drivers'}
          aria-controls="company-members-panel"
          onClick={() => {
            setCompanyMemberView('drivers');
            setSearchQuery('');
            setStatusFilter('ALL');
          }}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${companyMemberView === 'drivers' ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
        >
          <Users className="h-4 w-4" aria-hidden="true" /> {t('nav.drivers')} <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-700">{drivers.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={companyMemberView === 'dispatchers'}
          aria-controls="company-members-panel"
          onClick={() => {
            setCompanyMemberView('dispatchers');
            setSearchQuery('');
          }}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${companyMemberView === 'dispatchers' ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
        >
          <UserCog className="h-4 w-4" aria-hidden="true" /> {t('profile.dispatchers')} <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-700">{dispatchers.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={companyMemberView === 'vehicles'}
          aria-controls="company-members-panel"
          onClick={() => {
            setCompanyMemberView('vehicles');
            setIsAddFormOpen(false);
            setSearchQuery('');
          }}
          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${companyMemberView === 'vehicles' ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
        >
          <Truck className="h-4 w-4" aria-hidden="true" /> {t('fleet.title')}
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {companyMemberView === 'drivers'
          ? t('profile.driverShown', { count: filteredDrivers.length })
          : companyMemberView === 'dispatchers'
            ? t('profile.dispatcherShown', { count: filteredDispatchers.length })
            : t('fleet.title')}
      </p>

      {/* 3. YANGI HAYDOVCHI QO'SHISH FORMASI — TO'LIQ SAHIFADA (MODAL EMAS, INLINE FULL-WIDTH FORM) */}
      {isAddFormOpen && companyMemberView !== 'vehicles' && (
        <div id="new-member-form" className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-3 duration-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-bold">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  {t('profile.createNewUser')}
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t('profile.accountImmediateHint')}
                </p>
              </div>
            </div>

            <button
              type="button"
              aria-label={t('profile.closeUserForm')}
              onClick={closeAddForm}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              title={t('profile.closeForm')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            aria-describedby={formError ? 'member-form-error' : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* F.I.Sh */}
              <div>
                <label htmlFor="member-name" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  {t('profile.fullName')} *
                </label>
                <input
                  type="text"
                  id="member-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('profile.nameExample')}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>

              {currentUser?.roleCode === 'company_admin' && (
                <div>
                  <label htmlFor="member-role" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                    {t('profile.position')} *
                  </label>
                  <select
                    id="member-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors cursor-pointer"
                  >
                <option value="driver">{t('roles.driver')}</option>
                <option value="dispatcher">{t('roles.dispatcher')}</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="member-email" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  {t('common.email')} *
                </label>
                <input
                  type="email"
                  id="member-email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={role === 'dispatcher' ? 'dispatcher@company.com' : 'driver@company.com'}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>

              {role === 'driver' && (
                <div>
                  <label htmlFor="member-gmail-label" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                    {t('profile.gmailDriverLabel')}
                  </label>
                  <input
                    type="text"
                    id="member-gmail-label"
                    maxLength={100}
                    value={gmailLabel}
                    onChange={(e) => setGmailLabel(e.target.value)}
                    placeholder={name.trim() || t('profile.nameExample')}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('profile.gmailDriverLabelHint')}</p>
                </div>
              )}

              <div>
                <label htmlFor="member-password" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  {t('profile.initialPassword')} *
                </label>
                <input
                  type="password"
                  id="member-password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('profile.passwordMinimum')}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>

              {/* Telefon */}
              <div>
                <label htmlFor="member-phone" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  {t('common.phone')} *
                </label>
                <input
                  type="text"
                  id="member-phone"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (773) 555-0199"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>


            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('profile.accountImmediateNote')}
              </p>
              <div className="flex items-center space-x-3 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={closeAddForm}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs hover:bg-zinc-800 dark:hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? t('profile.creatingAccount') : t('profile.createAccount')}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {companyMemberView === 'vehicles' ? (
        <FleetVehiclesPanel
          canManage={currentUser?.roleCode === 'company_admin'}
          onWorkspaceRefresh={onWorkspaceRefresh}
        />
      ) : companyMemberView === 'drivers' ? (
      <div id="company-members-panel" role="region" aria-label={t('nav.drivers')} className="space-y-4">
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label={t('drivers.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('drivers.searchPlaceholder')}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
          />
        </div>

        <div role="group" aria-label={t('profile.driverStatusFilter')} className="grid w-full grid-cols-3 rounded-xl bg-zinc-100 p-1 text-xs font-bold dark:bg-zinc-900 sm:w-auto">
          <button
            onClick={() => setStatusFilter('ALL')}
            aria-pressed={statusFilter === 'ALL'}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('common.all')} ({drivers.length})
          </button>
          <button
            onClick={() => setStatusFilter('AVAILABLE')}
            aria-pressed={statusFilter === 'AVAILABLE'}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
              statusFilter === 'AVAILABLE'
                ? 'bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('drivers.available')} ({availableDrivers})
          </button>
          <button
            onClick={() => setStatusFilter('ON_DUTY')}
            aria-pressed={statusFilter === 'ON_DUTY'}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
              statusFilter === 'ON_DUTY'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            {t('drivers.onLoad')} ({onDutyDrivers})
          </button>
        </div>
      </div>
      {/* 4. MOBILDA LABEL/VALUE QATORLI IXCHAM JADVAL */}
      <ul className="grid gap-3 lg:hidden">
        {filteredDrivers.length === 0 ? (
          <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            {t('drivers.noDrivers')}
          </li>
        ) : filteredDrivers.map((driver) => {
          const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');
          const details = [
            [t('drivers.truck'), driver.truck || t('common.notProvided'), false],
            [t('drivers.trailer'), driver.trailer || t('common.notProvided'), false],
            [t('drivers.location'), driver.currentLocation || t('common.offline'), false],
            [t('common.status'), activeLoad ? `${t('drivers.onLoad')} (${activeLoad.loadNumber})` : t('drivers.available'), true],
          ];
          const cardTitleId = `driver-card-${driver.id}`;

          return (
            <li key={driver.id} aria-labelledby={cardTitleId} onClick={() => onOpenDriver?.(driver)} className="cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:border-teal-300 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <button type="button" onClick={(event) => { event.stopPropagation(); setVehicleAssignmentDriver(driver); }} disabled={currentUser?.roleCode !== 'company_admin'} aria-label={t('fleet.assignToDriver', { name: driver.name })} title={t('fleet.assignToDriver', { name: driver.name })} className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-zinc-100 text-xs font-bold text-zinc-800 transition hover:ring-2 hover:ring-teal-500 disabled:cursor-default disabled:hover:ring-0 dark:bg-zinc-800 dark:text-zinc-200">
                  {driver.avatar
                    ? <img src={driver.avatar} alt="" className="h-full w-full object-cover" />
                    : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
                </button>
                <div className="min-w-0 flex-1">
                  <h4 id={cardTitleId} className="truncate font-bold text-zinc-900 dark:text-zinc-100"><button type="button" onClick={(event) => { event.stopPropagation(); onOpenDriver?.(driver); }} className="text-left hover:text-teal-700 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:hover:text-teal-300">{driver.name}</button></h4>
                  <p className="mt-0.5 break-words text-xs text-zinc-500">
                    {driver.driverNumber || t('common.notProvided')} · {driver.phone || t('common.notProvided')}
                  </p>
                </div>
                <span className={`h-2.5 w-2.5 flex-none rounded-full ${activeLoad ? 'bg-blue-500' : 'bg-emerald-500'}`} aria-hidden="true" />
              </div>

              <dl className="border-t border-zinc-200 px-4 dark:border-zinc-800">
                {details.map(([label, value, isStatus]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-3 border-b border-zinc-100 py-2.5 last:border-b-0 dark:border-zinc-800">
                    <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{label}</dt>
                    <dd className={`min-w-0 break-words text-right text-xs font-bold ${isStatus ? (activeLoad ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-zinc-800 dark:text-zinc-200'}`}>{value}</dd>
                  </div>
                ))}
              </dl>

              {(onDeleteMember || currentUser?.roleCode === 'company_admin') && (
                <div className="flex flex-wrap justify-end border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} aria-label={`${t('driverPrivacy.title')}: ${driver.name}`} title={t('driverPrivacy.title')} className="rounded-lg p-2 text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><EyeOff className="h-4 w-4" /></button>}
                  {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setVehicleAssignmentDriver(driver); }} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><Truck className="h-4 w-4" />{t('fleet.openAssignment')}</button>}
                  {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><Pencil className="h-4 w-4" />{t('common.edit')}</button>}
                  {onDeleteMember && (
                  <button
                    aria-label={t('profile.removeDriver', { name: driver.name })}
                    onClick={(event) => { event.stopPropagation(); handleDeleteMember({ ...driver, role: 'driver' }); }}
                    disabled={deletingMemberId === driver.id}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                  >
                    {deletingMemberId === driver.id
                      ? <LoaderCircle className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                    {t('profile.remove')}
                  </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* 5. DESKTOPDA TO'LIQ KENGLIKDAGI JADVAL */}
      <div className="hidden w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800 lg:block">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <caption className="sr-only">{t('profile.driverTableCaption')}</caption>
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th scope="col" className="py-3.5 px-4">{t('drivers.driver')}</th>
              <th scope="col" className="py-3.5 px-4">{t('profile.equipmentAndTrailer')}</th>
              <th scope="col" className="py-3.5 px-4">{t('drivers.location')}</th>
              <th scope="col" className="py-3.5 px-4">{t('common.status')}</th>
              <th scope="col" className="py-3.5 px-4 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-zinc-400 font-medium">
                  {t('drivers.noDrivers')}
                </td>
              </tr>
            ) : (
              filteredDrivers.map((driver) => {
                const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');

                return (
                  <tr key={driver.id} onClick={() => onOpenDriver?.(driver)} className="cursor-pointer transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); setVehicleAssignmentDriver(driver); }} disabled={currentUser?.roleCode !== 'company_admin'} aria-label={t('fleet.assignToDriver', { name: driver.name })} title={t('fleet.assignToDriver', { name: driver.name })} className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 font-mono text-xs font-bold text-zinc-800 transition hover:border-teal-500 hover:ring-2 hover:ring-teal-500/30 disabled:cursor-default disabled:hover:border-zinc-200 disabled:hover:ring-0 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                          {driver.avatar
                            ? <img src={driver.avatar} alt="" className="h-full w-full object-cover" />
                            : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
                        </button>
                        <div>
                          <div className="flex items-center space-x-2 whitespace-nowrap">
                            <button type="button" onClick={(event) => { event.stopPropagation(); onOpenDriver?.(driver); }} className="text-left text-sm font-bold text-zinc-900 hover:text-teal-700 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-zinc-100 dark:hover:text-teal-300">{driver.name}</button>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber || t('common.notProvided')}</span> • <span>{driver.phone || t('common.notProvided')}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        <Truck className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{driver.truck || t('common.notProvided')}</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono mt-0.5 pl-6">
                        {driver.trailer || t('common.notProvided')}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5 text-sm">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="font-medium">{driver.currentLocation || t('common.offline')}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {activeLoad ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
                          {t('profile.onTrip', { number: activeLoad.loadNumber })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                          ✓ {t('profile.availableReady')}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} aria-label={`${t('driverPrivacy.title')}: ${driver.name}`} title={t('driverPrivacy.title')} className="rounded-lg p-2 text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><EyeOff className="h-4 w-4" /></button>}
                      {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} aria-label={t('profile.editDriverFor', { name: driver.name })} title={t('common.edit')} className="rounded-lg p-2 text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><Pencil className="h-4 w-4" /></button>}
                      {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setVehicleAssignmentDriver(driver); }} aria-label={t('fleet.assignToDriver', { name: driver.name })} title={t('fleet.assignToDriver', { name: driver.name })} className="rounded-lg p-2 text-teal-700 transition hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30"><Truck className="h-4 w-4" /></button>}
                      {onDeleteMember && (
                        <button
                          onClick={(event) => { event.stopPropagation(); handleDeleteMember({ ...driver, role: 'driver' }); }}
                          disabled={deletingMemberId === driver.id}
                          aria-label={t('profile.removeDriver', { name: driver.name })}
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                          title={t('profile.deleteDriver')}
                        >
                          {deletingMemberId === driver.id
                            ? <LoaderCircle className="h-4 w-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      </div>
      ) : (
        <div id="company-members-panel" role="region" aria-label={t('profile.dispatchers')} className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              type="search"
              aria-label={t('profile.searchDispatchers')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('profile.searchDispatchersPlaceholder')}
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <ul className="grid gap-3 lg:hidden">
            {filteredDispatchers.length === 0 ? (
              <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <UserCog className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-zinc-700 dark:text-zinc-200">{t('profile.noDispatchers')}</p>
                <p className="mt-1 text-xs text-zinc-500">{t('profile.noDispatchersHint')}</p>
              </li>
            ) : filteredDispatchers.map((dispatcher) => (
              <li key={dispatcher.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3 px-4 py-4">
                  <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
                    {dispatcher.avatar ? <img src={dispatcher.avatar} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{dispatcher.name?.charAt(0) || 'D'}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-zinc-900 dark:text-zinc-100">{dispatcher.name}</p>
                    <p className="mt-0.5 break-all text-xs text-zinc-500">{dispatcher.email || t('common.notProvided')}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${dispatcher.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{dispatcher.status === 'active' ? t('common.active') : t('common.suspended')}</span>
                </div>
                <dl className="border-t border-zinc-100 px-4 dark:border-zinc-800">
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-zinc-500">{t('common.phone')}</dt><dd className="break-words text-right font-semibold">{dispatcher.phone || t('common.notProvided')}</dd></div>
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-t border-zinc-100 py-3 text-xs dark:border-zinc-800"><dt className="text-zinc-500">{t('profile.position')}</dt><dd className="text-right font-semibold">{t('roles.dispatcher')}</dd></div>
                </dl>
                {onDeleteMember && (
                  <div className="flex justify-end border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => handleDeleteMember(dispatcher)}
                      disabled={deletingMemberId === dispatcher.id}
                      aria-label={t('profile.removeDispatcher', { name: dispatcher.name })}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      {deletingMemberId === dispatcher.id
                        ? <LoaderCircle className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                      {t('profile.remove')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:block">
            <table className="w-full min-w-[680px] text-left">
              <caption className="sr-only">{t('profile.dispatcherTableCaption')}</caption>
              <thead className="border-b border-zinc-200 bg-zinc-50/80 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                <tr><th scope="col" className="px-4 py-3.5">{t('roles.dispatcher')}</th><th scope="col" className="px-4 py-3.5">{t('common.email')}</th><th scope="col" className="px-4 py-3.5">{t('common.phone')}</th><th scope="col" className="px-4 py-3.5">{t('common.status')}</th><th scope="col" className="px-4 py-3.5 text-right">{t('common.actions')}</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {filteredDispatchers.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">{t('profile.noDispatchers')}</td></tr>
                ) : filteredDispatchers.map((dispatcher) => (
                  <tr key={dispatcher.id} className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-xl bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
                          {dispatcher.avatar ? <img src={dispatcher.avatar} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{dispatcher.name?.charAt(0) || 'D'}</span>}
                        </div>
                        <div><p className="font-bold text-zinc-900 dark:text-zinc-100">{dispatcher.name}</p><p className="mt-0.5 text-xs text-zinc-400">{t('roles.dispatcher')}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-zinc-600 dark:text-zinc-300">{dispatcher.email || t('common.notProvided')}</td>
                    <td className="px-4 py-3.5 font-medium text-zinc-600 dark:text-zinc-300">{dispatcher.phone || t('common.notProvided')}</td>
                    <td className="px-4 py-3.5"><span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${dispatcher.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{dispatcher.status === 'active' ? t('common.active') : t('common.suspended')}</span></td>
                    <td className="px-4 py-3.5 text-right">
                      {onDeleteMember && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMember(dispatcher)}
                          disabled={deletingMemberId === dispatcher.id}
                          aria-label={t('profile.removeDispatcher', { name: dispatcher.name })}
                          title={t('profile.deleteDispatcher')}
                          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                        >
                          {deletingMemberId === dispatcher.id
                            ? <LoaderCircle className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </section>
        )
      )}
      {vehicleAssignmentDriver && <DriverVehicleAssignmentModal driver={vehicleAssignmentDriver} onClose={() => setVehicleAssignmentDriver(null)} onWorkspaceRefresh={onWorkspaceRefresh} />}
      {currentUser?.roleCode === 'company_admin' && editingDriver && <DriverContactEditModal key={editingDriver.id} driver={editingDriver} onClose={closeDriverEditor} onWorkspaceRefresh={onWorkspaceRefresh} />}
      </div>
      </div>

    </div>
  );
}
