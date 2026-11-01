import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MemberAvatar from './MemberAvatar.jsx';
import {
  connectGmailIntegration,
  disconnectGmailIntegration,
  fetchGmailIntegration,
} from '../services/operationsService';
import { 
  Mail, 
  MapPin, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  X,
  Search,
  Truck,
  Users,
  ChevronRight,
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
import DriverEditPage from './DriverEditPage';
import CreateCompanyMemberModal from './CreateCompanyMemberModal';
import DriverProfilePanel from './DriverProfilePanel';
import { ProfileNotificationsPanel, ProfilePersonalPanel, ProfileSectionHeading, ProfileSecurityPanel } from './ProfileAccountPanels';
import './profileCenter.css';
import useProfileRoute from '../hooks/useProfileRoute';
import { useSettingsDraft } from '../hooks/useSettingsDraft';
import { activeLoadsForDriver, driverRosterState } from './driverRosterModel';

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
  selectedDriverId = null,
  initialSection,
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
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [successToast, setSuccessToast] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [route, navigateProfile] = useProfileRoute({ section: initialSection, driver: selectedDriverId, edit: initialDriverToEditId });
  const companyMemberView = route.team;
  const setCompanyMemberView = team => navigateProfile({ team, driver: null, edit: null });
  const [fleetActionsTarget, setFleetActionsTarget] = useState(null);
  const activeSection = route.section === 'integrations' && currentUser?.roleCode !== 'company_admin' ? 'company' : route.section;
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
  const setEditingDriverId = id => navigateProfile({ section: 'company', edit: id });
  const editingDriver = drivers.find(driver => driver.id === route.edit);
  const selectedProfileDriver = drivers.find(driver => driver.id === route.driver) || null;
  const openDriver = driver => navigateProfile({ section: 'company', team: 'drivers', driver: driver?.id || null, edit: null });
  const closeDriverEditor = () => {
    if (navigateProfile({ edit: null })) onEditDriverClosed?.();
  };
  useSettingsDraft(Boolean(gmailAppPassword), gmailSaving, t('driverSettings.discardChanges'));
  const changeSection = (sectionId, { focusPanel = false, scrollPanel = false } = {}) => {
    if (!navigateProfile({ section: sectionId, edit: null, driver: null })) return;
    if (activeSection === 'integrations' && sectionId !== 'integrations') {
      setGmailAppPassword('');
      setGmailPasswordVisible(false);
      setGmailError('');
    }
    if (focusPanel || scrollPanel) {
      requestAnimationFrame(() => {
        const panel = document.getElementById('profile-section-panel');
        if (focusPanel) panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
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

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Restore remote connection status when the integration route opens.
    if (activeSection === 'integrations') void refreshGmailConnection();
  }, [activeSection, refreshGmailConnection]);

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

  const handleDeleteMember = async (member) => {
    if (!onDeleteMember || deletingMemberId) return false;
    const confirmationKey = member.role === 'dispatcher'
      ? 'profile.removeDispatcherConfirm'
      : 'profile.removeDriverConfirm';
    if (!window.confirm(t(confirmationKey, { name: member.name }))) return false;
    setDeletingMemberId(member.id);
    try {
      const deleted = await onDeleteMember(member);
      if (deleted === false) return false;
      if (member.id === route.driver) openDriver(null);
      return true;
    } finally {
      setDeletingMemberId(null);
    }
  };

  const totalDrivers = drivers.length;
  const stateFor = driver => driverRosterState(driver, activeLoadsForDriver(loads, driver.id));
  const stateLabels = { AVAILABLE: t('drivers.available'), ON_LOAD: t('drivers.onLoad'), OFF_DUTY: t('driverStatus.off_duty'), SUSPENDED: t('driverSettings.suspended') };
  const stateCount = state => drivers.filter(driver => stateFor(driver) === state).length;
  const notificationCount = unreadChatCount + unreadInboxCount;
  const handleLocaleChange = async (value) => {
    setLocaleSaving(true);
    try { await onLocaleChange?.(value); }
    catch { /* Parent reports localized errors. */ }
    finally { setLocaleSaving(false); }
  };

  // Filter drivers for table
  const filteredDrivers = drivers.filter(driver => {
    const activeLoad = activeLoadsForDriver(loads, driver.id)[0];
    if (statusFilter !== 'ALL' && stateFor(driver) !== statusFilter) return false;

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
    { id: 'company', label: t('profile.teamTab') },
    { id: 'overview', label: t('profile.personal') },
    ...(canManageIntegrations ? [{ id: 'integrations', label: t('profile.integrations') }] : []),
    { id: 'security', label: t('profile.security') },
    { id: 'notifications', label: t('profile.notifications') },
  ];


  return (
    <div className="profile-center w-full">
      
      <div className="profile-topbar">
      <h1 className="profile-settings-title">{t('profile.settingsTitle')}</h1>
      <div role="tablist" aria-label={t('profile.sections')} className="profile-center-nav" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
        const current = tabs.indexOf(document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
      }}>
        {sections.map(section => <button key={section.id} id={`profile-tab-${section.id}`} type="button" role="tab"
          aria-selected={activeSection === section.id} tabIndex={activeSection === section.id ? 0 : -1} aria-controls="profile-section-panel"
          onClick={() => { changeSection(section.id, { scrollPanel: true }); }}>
          {section.label}{section.id === 'notifications' && notificationCount > 0 && <span className="profile-tab-count">{notificationCount}</span>}
        </button>)}
      </div>
      </div>

      {successToast && (
        <div role="status" aria-live="polite" className="workspace-success-banner mb-6 px-5 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm font-bold animate-in fade-in slide-in-from-top duration-200">
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

      <div
        id="profile-section-panel"
        role="tabpanel"
        aria-labelledby={`profile-tab-${activeSection}`}
        tabIndex={0}
        className={`profile-section-content profile-section-${activeSection} space-y-6 focus:outline-none`}
      >
        {activeSection === 'overview' && (
          <ProfilePersonalPanel currentUser={currentUser} locale={locale} localeSaving={localeSaving} timeZone={timeZone}
            theme={theme} toggleTheme={toggleTheme} onLocaleChange={handleLocaleChange} onTimeZoneChange={onTimeZoneChange} onSaveProfile={onSaveProfile} />
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
              <div id="gmail-form-error" role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
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
                <input id="gmail-mailbox-email" aria-invalid={gmailError ? true : undefined} aria-describedby={gmailError ? 'gmail-form-error' : undefined} type="email" inputMode="email" autoComplete="email" required value={gmailEmail} onChange={(event) => setGmailEmail(event.target.value)} placeholder="company@gmail.com" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label htmlFor="gmail-app-password" className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{t('profile.googleAppPassword')}</label>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold workspace-link hover:underline">{t('profile.getAppPassword')} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                </div>
                <div className="relative">
                  <input id="gmail-app-password" type={gmailPasswordVisible ? 'text' : 'password'} autoComplete="new-password" required aria-invalid={gmailError ? true : undefined} aria-describedby={`gmail-app-password-help gmail-vault-help${gmailError ? ' gmail-form-error' : ''}`} value={gmailAppPassword} onChange={(event) => setGmailAppPassword(event.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 pr-11 font-mono text-sm tracking-wider text-zinc-900 outline-none transition placeholder:tracking-normal placeholder:text-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
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
                  <button type="submit" disabled={gmailSaving || gmailLoading} className="inline-flex items-center justify-center gap-2 rounded-lg workspace-action px-4 py-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60">
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
        currentUser?.roleCode === 'company_admin' && editingDriver ? (
          <DriverEditPage key={editingDriver.id} driver={editingDriver} onBack={closeDriverEditor}
            backToList={!selectedProfileDriver} onWorkspaceRefresh={onWorkspaceRefresh} />
        ) : selectedProfileDriver && companyMemberView === 'drivers' ? (
          <DriverProfilePanel
            driver={selectedProfileDriver}
            loads={loads}
            canManage={currentUser?.roleCode === 'company_admin'}
            deleting={deletingMemberId === selectedProfileDriver.id}
            onBack={() => openDriver(null)}
            onEdit={(driver) => setEditingDriverId(driver.id)}
            onAssignVehicle={setVehicleAssignmentDriver}
            onAssignLoad={onAssignDriverLoad}
            onOpenChat={onOpenDriverChat}
            onOpenLoad={onOpenDriverLoad}
            onDelete={(driver) => handleDeleteMember({ ...driver, role: 'driver' })}
          />
        ) : (
        <section className="profile-panel profile-company-panel">
      {/* 2. HAYDOVCHILARNI BOSHQARISH & AMALLAR PANELI */}
      <div className="profile-company-toolbar flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            {t('profile.companyTeam')}
          </h3>
        </div>

        {['drivers', 'dispatchers'].includes(companyMemberView) && <button type="button"
          onClick={() => setIsAddFormOpen(true)} aria-haspopup="dialog" aria-controls={isAddFormOpen ? 'new-member-form' : undefined}
          className="profile-team-add">
          <Plus className="h-4 w-4" aria-hidden="true" />{t('profile.addUser')}
        </button>}
        {companyMemberView === 'vehicles' && <div ref={setFleetActionsTarget} className="profile-company-actions" />}
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

      {companyMemberView === 'vehicles' ? (
        <FleetVehiclesPanel
          canManage={currentUser?.roleCode === 'company_admin'}
          onWorkspaceRefresh={onWorkspaceRefresh}
          actionsTarget={fleetActionsTarget}
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
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 transition-colors"
          />
        </div>

        <div role="group" aria-label={t('profile.driverStatusFilter')} className="profile-status-filters">
          {['ALL', 'AVAILABLE', 'ON_LOAD', 'SUSPENDED'].map(state => <button key={state} type="button" aria-pressed={statusFilter === state} onClick={() => setStatusFilter(state)}>{state === 'ALL' ? t('common.all') : stateLabels[state]} <span>{state === 'ALL' ? totalDrivers : stateCount(state)}</span></button>)}
        </div>
      </div>
      {/* 4. MOBILDA LABEL/VALUE QATORLI IXCHAM JADVAL */}
      <ul className="profile-mobile-list grid gap-3 lg:hidden">
        {filteredDrivers.length === 0 ? (
          <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            {t('drivers.noDrivers')}
          </li>
        ) : filteredDrivers.map((driver) => {
          const activeLoad = activeLoadsForDriver(loads, driver.id)[0];
          const details = [
            [t('drivers.truck'), driver.truck || t('common.notProvided'), false],
            [t('drivers.trailer'), driver.trailer || t('common.notProvided'), false],
            [t('drivers.location'), driver.currentLocation || t('common.offline'), false],
            [t('common.status'), stateLabels[stateFor(driver)], true],
          ];
          const cardTitleId = `driver-card-${driver.id}`;

          return (
            <li key={driver.id} aria-labelledby={cardTitleId} onClick={() => openDriver(driver)} className="cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:border-blue-300 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <MemberAvatar member={driver} className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-zinc-100 text-xs font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" />
                <div className="min-w-0 flex-1">
                  <h4 id={cardTitleId} className="truncate font-bold text-zinc-900 dark:text-zinc-100"><button type="button" onClick={(event) => { event.stopPropagation(); openDriver(driver); }} className="text-left hover:text-blue-700 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:text-blue-300">{driver.name}</button></h4>
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
                  {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"><Pencil className="h-4 w-4" />{t('common.edit')}</button>}
                  {onDeleteMember && (
                  <button
                    aria-label={t('profile.removeDriver', { name: driver.name })}
                    onClick={(event) => { event.stopPropagation(); handleDeleteMember({ ...driver, role: 'driver' }); }}
                    disabled={deletingMemberId === driver.id}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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
      <div className="profile-desktop-table hidden w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800 lg:block">
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
                const activeLoad = activeLoadsForDriver(loads, driver.id)[0];

                return (
                  <tr key={driver.id} onClick={() => openDriver(driver)} className="cursor-pointer transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <MemberAvatar member={driver} className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 font-mono text-xs font-bold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
                        <div>
                          <div className="flex items-center space-x-2 whitespace-nowrap">
                            <button type="button" onClick={(event) => { event.stopPropagation(); openDriver(driver); }} className="text-left text-sm font-bold text-zinc-900 hover:text-blue-700 focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-zinc-100 dark:hover:text-blue-300">{driver.name}</button>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber || t('common.notProvided')}</span> • <span>{driver.phone || t('common.notProvided')}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="profile-equipment-value"><Truck size={16} aria-hidden="true" /><span><strong>{driver.truck || t('common.notProvided')}</strong><small>{driver.trailer || t('common.notProvided')}</small></span></div>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5 text-sm">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="font-medium">{driver.currentLocation || t('common.offline')}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`profile-driver-status is-${stateFor(driver).toLowerCase()}`}>
                        {stateLabels[stateFor(driver)]}{stateFor(driver) === 'ON_LOAD' && activeLoad ? ` · ${activeLoad.loadNumber}` : ''}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {currentUser?.roleCode === 'company_admin' && <button type="button" onClick={(event) => { event.stopPropagation(); setEditingDriverId(driver.id); }} aria-label={t('profile.editDriverFor', { name: driver.name })} title={t('common.edit')} className="rounded-lg p-2 text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30"><Pencil className="h-4 w-4" /></button>}
                      {onDeleteMember && (
                        <button
                          onClick={(event) => { event.stopPropagation(); handleDeleteMember({ ...driver, role: 'driver' }); }}
                          disabled={deletingMemberId === driver.id}
                          aria-label={t('profile.removeDriver', { name: driver.name })}
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <ul className="profile-mobile-list grid gap-3 lg:hidden">
            {filteredDispatchers.length === 0 ? (
              <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <UserCog className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-zinc-700 dark:text-zinc-200">{t('profile.noDispatchers')}</p>
                <p className="mt-1 text-xs text-zinc-500">{t('profile.noDispatchersHint')}</p>
              </li>
            ) : filteredDispatchers.map((dispatcher) => (
              <li key={dispatcher.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3 px-4 py-4">
                  <MemberAvatar member={dispatcher} className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300" />
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
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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

          <div className="profile-desktop-table hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:block">
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
                        <MemberAvatar member={dispatcher} className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-xl bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300" />
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
                          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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
      {isAddFormOpen && <CreateCompanyMemberModal canAddDispatcher={currentUser?.roleCode === 'company_admin'}
        initialRole={companyMemberView === 'dispatchers' ? 'dispatcher' : 'driver'} onCreate={onAddDriver}
        onClose={() => setIsAddFormOpen(false)} onCreated={member => {
          setSuccessToast(t('profile.accountCreated', { role: roleLabel(t, member.role), name: member.name }));
          setTimeout(() => setSuccessToast(''), 4000);
        }} />}
      {vehicleAssignmentDriver && <DriverVehicleAssignmentModal driver={vehicleAssignmentDriver} onClose={() => setVehicleAssignmentDriver(null)} onWorkspaceRefresh={onWorkspaceRefresh} />}
      </div>
      </div>

    </div>
  );
}
