import React, { useCallback, useRef, useState } from 'react';
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
  Languages,
  ShieldCheck,
  Smartphone,
  Users,
  PackageCheck,
  Route,
  Pencil,
  ChevronRight,
  MessageSquare,
  Link2,
  UserRound,
  MonitorCog,
  KeyRound,
  UserCog,
  Plug,
  Eye,
  EyeOff,
  LoaderCircle,
  RotateCw,
  Unplug,
  CircleAlert,
  ExternalLink,
} from 'lucide-react';

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
  onDeleteDriver, 
  currentUser,
  onNavigate,
  theme = 'light',
  toggleTheme,
  unreadChatCount = 0,
  unreadInboxCount = 0,
}) {
  // Inline Form State (NO POPUP MODAL - 100% INLINE FULL-WIDTH FORM)
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [successToast, setSuccessToast] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [companyMemberView, setCompanyMemberView] = useState('drivers');
  const [activeSection, setActiveSection] = useState('settings');
  const [gmailConnection, setGmailConnection] = useState(null);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [gmailPasswordVisible, setGmailPasswordVisible] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailSaving, setGmailSaving] = useState(false);
  const [gmailError, setGmailError] = useState('');
  const addFormToggleRef = useRef(null);

  // Form State for Adding Driver
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('driver');
  const [phone, setPhone] = useState('');
  const handlePrepareForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('driver');
    setFormError('');
    setPhone('');
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
      requestAnimationFrame(() => document.getElementById('profile-section-panel')?.focus());
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
      setGmailError(error.message || 'Gmail holatini olib bo‘lmadi.');
    } finally {
      setGmailLoading(false);
    }
  }, [canManageIntegrations]);

  const handleGmailConnect = async (event) => {
    event.preventDefault();
    const normalizedPassword = gmailAppPassword.replace(/\s+/g, '');
    if (!gmailEmail.trim().toLowerCase().endsWith('@gmail.com')) {
      setGmailError('Gmail manzilini to‘g‘ri kiriting.');
      return;
    }
    if (!/^[A-Za-z0-9]{16}$/.test(normalizedPassword)) {
      setGmailError('App Password 16 ta belgidan iborat bo‘lishi kerak.');
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
      setSuccessToast('Gmail ma’lumotlari saqlandi. IMAP worker ulanishni tekshiradi.');
      setTimeout(() => setSuccessToast(''), 5000);
    } catch (error) {
      setGmailAppPassword('');
      setGmailPasswordVisible(false);
      setGmailError(error.message || 'Gmail ulanishini saqlab bo‘lmadi.');
    } finally {
      setGmailSaving(false);
    }
  };

  const handleGmailDisconnect = async () => {
    if (gmailSaving) return;
    if (!window.confirm('Gmail integratsiyasini uzasizmi? Yangi broker xatlari sinxronlanmaydi va qayta ulash uchun yangi App Password kerak bo‘ladi.')) return;
    setGmailSaving(true);
    setGmailError('');
    try {
      const connection = await disconnectGmailIntegration();
      setGmailConnection(connection);
      setGmailAppPassword('');
      setSuccessToast('Gmail integratsiyasi uzildi.');
      setTimeout(() => setSuccessToast(''), 4000);
    } catch (error) {
      setGmailError(error.message || 'Gmail ulanishini uzib bo‘lmadi.');
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
    };

    setIsSubmitting(true);
    setFormError('');
    try {
      await onAddDriver(newDriver);
      closeAddForm();
      const roleName = role === 'dispatcher' ? 'Dispecher' : 'Haydovchi';
      setSuccessToast(`${roleName} hisobi yaratildi: ${newDriver.name}.`);
      setTimeout(() => setSuccessToast(''), 4000);
    } catch (error) {
      setFormError(error.message || 'Foydalanuvchi hisobini yaratib bo‘lmadi.');
    } finally {
      setIsSubmitting(false);
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
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent';

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
    { id: 'overview', label: "Shaxsiy ma'lumot", icon: UserRound },
    { id: 'company', label: 'Kompaniya', icon: Building2 },
    { id: 'contact', label: 'Aloqa va qurilmalar', icon: Link2 },
    ...(canManageIntegrations ? [{ id: 'integrations', label: 'Integratsiyalar', icon: Plug }] : []),
    { id: 'security', label: 'Xavfsizlik', icon: ShieldCheck },
    { id: 'notifications', label: 'Bildirishnomalar', icon: Bell },
    { id: 'settings', label: 'Tizim sozlamalari', icon: Settings },
  ];

  const settings = [
    { label: 'Til', value: "O‘zbek (UZ)", icon: Languages, tone: 'emerald' },
    {
      label: 'Bildirishnomalar',
      value: notificationCount ? `${notificationCount} ta yangi` : 'Barcha bildirishnomalar',
      icon: Bell,
      badge: notificationCount || null,
      tone: 'emerald',
      action: () => changeSection('notifications', { focusPanel: true }),
    },
    {
      label: 'Interfeys',
      value: theme === 'dark' ? 'Tungi rejim' : 'Yorug‘ rejim',
      icon: MonitorCog,
      tone: 'blue',
      action: toggleTheme,
    },
    { label: 'Vaqt mintaqasi', value: timeZone, icon: Route, tone: 'teal' },
    { label: 'Maxfiylik', value: 'Faol', icon: ShieldCheck, tone: 'emerald', action: () => changeSection('security', { focusPanel: true }) },
    { label: 'Qurilmalar', value: 'Joriy web sessiya', icon: Smartphone, tone: 'blue', action: () => changeSection('contact', { focusPanel: true }) },
  ];

  const quickActions = [
    { label: 'Yuklar', description: 'Reyslar va holatlar', icon: PackageCheck, tab: 'kanban' },
    { label: 'Haydovchilar', description: 'Barcha haydovchilar', icon: Users, tab: 'drivers' },
    { label: 'Chat', description: 'Jonli suhbatlar', icon: MessageSquare, tab: 'chat' },
  ];

  const settingsPanel = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-labelledby="system-settings-heading" className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <Settings className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 id="system-settings-heading" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Tizim sozlamalari</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {settings.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone === 'blue' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : item.tone === 'teal' ? 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  {item.badge && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">{item.badge}</span>}
                </div>
                <div className="mt-5">
                  <span className="block text-sm font-bold text-zinc-900 dark:text-zinc-100">{item.label}</span>
                  <p className="mt-1 break-words text-xs text-zinc-500 dark:text-zinc-400">{item.value}</p>
                </div>
              </>
            );
            return item.action ? (
              <button key={item.label} type="button" onClick={item.action} className="min-h-36 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-white hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-emerald-800 dark:hover:bg-zinc-900">
                {content}
              </button>
            ) : (
              <article key={item.label} className="min-h-36 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                {content}
              </article>
            );
          })}
        </div>
      </section>

      <aside aria-labelledby="quick-actions-heading" className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <Route className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 id="quick-actions-heading" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Tezkor funksiyalar</h2>
        </div>
        <div className="space-y-2">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.tab} type="button" onClick={() => onNavigate?.(item.tab)} className="group flex w-full items-center gap-3 rounded-xl border border-transparent bg-zinc-50 px-3 py-3 text-left transition hover:border-zinc-200 hover:bg-white dark:bg-zinc-950/50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-zinc-900 dark:text-zinc-100">{item.label}</span>
                  <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{item.description}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-zinc-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );

  return (
    <div className="w-full space-y-6 pb-12">
      
      {/* Success Notification Toast */}
      {successToast && (
        <div role="status" aria-live="polite" className="bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm font-bold animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
          <button aria-label="Bildirishnomani yopish" onClick={() => setSuccessToast('')} className="rounded opacity-80 hover:opacity-100 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <section className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-zinc-900 sm:p-6">
        <img src="/images/profile-logistics-banner.webp" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/95 via-white/80 to-cyan-50/30 dark:from-zinc-950/95 dark:via-zinc-950/80 dark:to-cyan-950/35" aria-hidden="true" />

        <div className="relative z-10 grid items-center gap-5 xl:grid-cols-[minmax(260px,1fr)_auto_auto]">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-emerald-800 text-2xl font-black text-white shadow-sm dark:bg-emerald-200 dark:text-emerald-950 sm:h-20 sm:w-20 sm:text-3xl">
              {currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-2xl">{currentUser?.name || '—'}</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/75 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Faol
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{currentUser?.company || '—'} · {currentUser?.role || '—'}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{currentUser?.phone || 'Telefon kiritilmagan'}</span>
                <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 flex-none" aria-hidden="true" /><span className="truncate">{currentUser?.email || 'Email kiritilmagan'}</span></span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { value: totalDrivers, label: 'Haydovchilar', icon: Users },
              { value: activeLoads, label: 'Faol yuklar', icon: PackageCheck },
              { value: completedLoads, label: 'Tugallangan', icon: Route },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="min-w-0 rounded-xl border border-white/80 bg-white/85 px-3 py-3 shadow-xs backdrop-blur dark:border-zinc-700/80 dark:bg-zinc-900/80 sm:min-w-28">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300"><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <strong className="text-lg font-black text-zinc-900 dark:text-zinc-100">{metric.value}</strong>
                  </div>
                  <span className="mt-1.5 block break-words text-[10px] font-semibold leading-tight text-zinc-500 dark:text-zinc-400">{metric.label}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 xl:flex-col xl:items-stretch">
            <button type="button" onClick={() => changeSection('overview', { focusPanel: true })} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white/90 px-3 py-2 text-xs font-bold text-emerald-800 shadow-xs transition hover:bg-white dark:border-emerald-800 dark:bg-zinc-900/90 dark:text-emerald-300 dark:hover:bg-zinc-900">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Profil ma’lumotlari
            </button>
          </div>
        </div>
      </section>

      <nav aria-label="Profil bo‘limlari" className="profile-tabs-scroll overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex min-w-max gap-1">
          {sections.map((section) => {
            const Icon = section.icon;
            const selected = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-pressed={selected}
                aria-controls="profile-section-panel"
                onClick={() => {
                  changeSection(section.id);
                  if (section.id === 'integrations') refreshGmailConnection();
                }}
                className={`relative inline-flex items-center gap-2 px-3 py-3 text-xs font-semibold transition ${selected ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {section.label}
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </nav>

      <div
        id="profile-section-panel"
        role="region"
        aria-label={`${sections.find((section) => section.id === activeSection)?.label || 'Profil'} bo‘limi`}
        tabIndex={-1}
        className="space-y-6 focus:outline-none"
      >
        {activeSection === 'settings' && settingsPanel}

        {activeSection === 'overview' && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="text-base font-bold">Shaxsiy ma’lumotlar</h2>
            </div>
            <dl className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
              {[
                ['F.I.Sh', currentUser?.name || 'Kiritilmagan'],
                ['Lavozim', currentUser?.role || 'Kiritilmagan'],
                ['Kompaniya', currentUser?.company || 'Kiritilmagan'],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[100px_minmax(0,1fr)] gap-4 py-3 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
                  <dd className="break-words text-right font-semibold text-zinc-900 dark:text-zinc-100">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

      {activeSection === 'contact' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /><h2 className="text-base font-bold">Aloqa ma’lumotlari</h2></div>
              <dl className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
                {[
                  ['Telefon', currentUser?.phone || 'Kiritilmagan'],
                  ['Email', currentUser?.email || 'Kiritilmagan'],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-4 py-3 text-sm">
                    <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
                    <dd className="break-words text-right font-semibold text-zinc-900 dark:text-zinc-100">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-emerald-600" aria-hidden="true" /><h2 className="text-base font-bold">Qurilmalar va sessiyalar</h2></div>
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50">
                <p className="text-sm font-bold">Joriy web sessiya</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Faol · {timeZone}</p>
              </div>
            </section>
          </div>
      )}

      {activeSection === 'integrations' && canManageIntegrations && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="gmail-integration-heading" aria-busy={gmailLoading || gmailSaving} className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <p role="status" aria-live="polite" className="sr-only">
              {gmailLoading ? 'Gmail ulanish holati tekshirilmoqda.' : gmailSaving ? 'Gmail sozlamalari saqlanmoqda.' : gmailConnection?.status === 'active' ? 'Gmail ulangan.' : gmailConnection?.status === 'needs_reconnect' ? 'Gmail ulanishi worker tomonidan tekshirilmoqda.' : 'Gmail ulanmagan.'}
            </p>
            <div className="flex flex-col gap-4 border-b border-zinc-100 pb-5 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  <GmailIcon className="h-5 w-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="gmail-integration-heading" className="text-base font-bold text-zinc-900 dark:text-zinc-100">Gmail</h2>
                    {gmailConnection?.status === 'active' && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Ulangan</span>}
                    {gmailConnection?.status === 'needs_reconnect' && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">Tekshirilmoqda</span>}
                    {gmailConnection?.status === 'disabled' && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Uzilgan</span>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">Broker xatlari va PDF hujjatlarni Broker Inbox’ga avtomatik qabul qiladi.</p>
                </div>
              </div>
              <button type="button" onClick={refreshGmailConnection} disabled={gmailLoading || gmailSaving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                <RotateCw className={`h-3.5 w-3.5 ${gmailLoading ? 'animate-spin' : ''}`} aria-hidden="true" /> Holatni yangilash
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
                <strong className="block">Oxirgi sinxronlash xatosi</strong>
                <span className="mt-1 block break-words">{gmailConnection.lastError}</span>
              </div>
            )}

            <form onSubmit={handleGmailConnect} className="mt-5">
              <fieldset disabled={gmailSaving || gmailLoading} className="space-y-4 disabled:opacity-70">
              <div>
                <label htmlFor="gmail-mailbox-email" className="mb-1.5 block text-xs font-bold text-zinc-600 dark:text-zinc-300">Gmail manzili</label>
                <input id="gmail-mailbox-email" type="email" inputMode="email" autoComplete="email" required value={gmailEmail} onChange={(event) => setGmailEmail(event.target.value)} placeholder="company@gmail.com" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label htmlFor="gmail-app-password" className="text-xs font-bold text-zinc-600 dark:text-zinc-300">Google App Password</label>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300">App Password olish <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                </div>
                <div className="relative">
                  <input id="gmail-app-password" type={gmailPasswordVisible ? 'text' : 'password'} autoComplete="new-password" required aria-describedby="gmail-app-password-help gmail-vault-help" value={gmailAppPassword} onChange={(event) => setGmailAppPassword(event.target.value)} placeholder="xxxx xxxx xxxx xxxx" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 pr-11 font-mono text-sm tracking-wider text-zinc-900 outline-none transition placeholder:tracking-normal placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" />
                  <button type="button" onClick={() => setGmailPasswordVisible((visible) => !visible)} aria-label={gmailPasswordVisible ? 'App Passwordni yashirish' : 'App Passwordni ko‘rsatish'} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200">
                    {gmailPasswordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p id="gmail-app-password-help" className="mt-1.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">Google hisobida 2 bosqichli himoyani yoqing va 16 belgili App Password yarating. Oddiy Gmail parolini kiritmang.</p>
              </div>

              <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                <p id="gmail-vault-help" className="text-[11px] text-zinc-500 dark:text-zinc-400">Parol Supabase Vault’da shifrlangan holda saqlanadi.</p>
                <div className="flex flex-wrap gap-2">
                  {gmailConnection && gmailConnection.status !== 'disabled' && (
                    <button type="button" onClick={handleGmailDisconnect} disabled={gmailSaving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 px-3.5 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">
                      <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> Uzish
                    </button>
                  )}
                  <button type="submit" disabled={gmailSaving || gmailLoading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500">
                    {gmailSaving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
                    {gmailConnection && gmailConnection.status !== 'disabled' ? 'Ma’lumotni yangilash' : 'Gmail’ni ulash'}
                  </button>
                </div>
              </div>
              </fieldset>
            </form>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Ulanish holati</h2>
              {gmailLoading ? (
                <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Tekshirilmoqda…</div>
              ) : (
                <dl className="mt-3 divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">Hisob</dt><dd className="break-all text-right font-semibold">{gmailConnection?.mailboxEmail || 'Ulanmagan'}</dd></div>
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">IMAP</dt><dd className="text-right font-semibold">imap.gmail.com:993</dd></div>
                  <div className="flex items-start justify-between gap-4 py-3"><dt className="text-zinc-500">Oxirgi sinxron</dt><dd className="text-right font-semibold">{gmailConnection?.lastSyncedAt ? new Date(gmailConnection.lastSyncedAt).toLocaleString('uz-UZ') : 'Hali bajarilmagan'}</dd></div>
                </dl>
              )}
            </section>
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">Qanday ishlaydi?</h2>
              <ol className="mt-3 space-y-2 text-xs leading-5 text-emerald-800 dark:text-emerald-300">
                <li>1. Gmail va App Password saqlanadi.</li>
                <li>2. IMAP worker yangi xatlarni tekshiradi.</li>
                <li>3. PDF va suratlar Broker Inbox’da ko‘rinadi.</li>
              </ol>
            </section>
          </aside>
        </div>
      )}

      {activeSection === 'security' && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Hisob holati', 'Faol va himoyalangan', ShieldCheck],
            ['Kirish usuli', 'Email va parol', KeyRound],
            ['Sessiya', 'Joriy web sessiya faol', Smartphone],
          ].map(([label, value, Icon]) => (
            <article key={label} className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <h2 className="mt-4 text-sm font-bold">{label}</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{value}</p>
            </article>
          ))}
        </section>
      )}

      {activeSection === 'notifications' && (
        <section className="grid gap-3 sm:grid-cols-2">
          {[
            ['Broker Inbox', unreadInboxCount, 'inbox'],
            ['Chat', unreadChatCount, 'chat'],
          ].map(([label, count, tab]) => (
            <button key={label} type="button" onClick={() => onNavigate?.(tab)} className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-5 text-left transition hover:border-emerald-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-800">
              <span><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{count ? `${count} ta yangi xabar` : 'Yangi xabar yo‘q'}</span></span>
              <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            </button>
          ))}
        </section>
      )}

      {activeSection === 'company' && (
        <>
          {formError && <p id="member-form-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{formError}</p>}

      {/* 2. HAYDOVCHILARNI BOSHQARISH & AMALLAR PANELI */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Kompaniya jamoasi
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Haydovchilar va dispecherlarni bitta joydan boshqaring
          </p>
        </div>

        {/* Toggle Form Button (Modal emas, sahifadagi formani ochish/yopish) */}
        <button
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
              <span>Formani yopish</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>Yangi foydalanuvchi yaratish</span>
            </>
          )}
        </button>
      </div>

      <div role="group" aria-label="Kompaniya foydalanuvchilari" className="inline-grid w-full grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900 sm:w-auto">
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
          <Users className="h-4 w-4" aria-hidden="true" /> Haydovchilar <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-700">{drivers.length}</span>
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
          <UserCog className="h-4 w-4" aria-hidden="true" /> Dispecherlar <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-700">{dispatchers.length}</span>
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {companyMemberView === 'drivers'
          ? `${filteredDrivers.length} ta haydovchi ko‘rsatildi`
          : `${filteredDispatchers.length} ta dispecher ko‘rsatildi`}
      </p>

      {/* 3. YANGI HAYDOVCHI QO'SHISH FORMASI — TO'LIQ SAHIFADA (MODAL EMAS, INLINE FULL-WIDTH FORM) */}
      {isAddFormOpen && (
        <div id="new-member-form" className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-3 duration-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-bold">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  Yangi foydalanuvchi yaratish
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Akkaunt email taklifisiz darhol faol holatda yaratiladi
                </p>
              </div>
            </div>

            <button
              type="button"
              aria-label="Yangi foydalanuvchi formasini yopish"
              onClick={closeAddForm}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              title="Formani yopish"
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
                  F.I.Sh (Ism Familiya) *
                </label>
                <input
                  type="text"
                  id="member-name"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: Sardor Rahim"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>

              {currentUser?.roleCode === 'company_admin' && (
                <div>
                  <label htmlFor="member-role" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                    Rol *
                  </label>
                  <select
                    id="member-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors cursor-pointer"
                  >
                    <option value="driver">Haydovchi</option>
                    <option value="dispatcher">Dispecher</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="member-email" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Email *
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

              <div>
                <label htmlFor="member-password" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Boshlang'ich parol *
                </label>
                <input
                  type="password"
                  id="member-password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Kamida 12 ta belgi"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
                />
              </div>

              {/* Telefon */}
              <div>
                <label htmlFor="member-phone" className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Telefon Raqami *
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
                * Hisob darhol faol bo'ladi. Foydalanuvchi email va boshlang'ich parol bilan kiradi.
              </p>
              <div className="flex items-center space-x-3 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={closeAddForm}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs hover:bg-zinc-800 dark:hover:bg-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Hisob yaratilmoqda…' : 'Hisob yaratish'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {companyMemberView === 'drivers' ? (
      <div id="company-members-panel" role="region" aria-label="Haydovchilar" className="space-y-4">
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Haydovchilarni qidirish"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Drayver ismi, raqami yoki mashinasi..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 transition-colors"
          />
        </div>

        <div role="group" aria-label="Haydovchi holati filtri" className="grid w-full grid-cols-3 rounded-xl bg-zinc-100 p-1 text-xs font-bold dark:bg-zinc-900 sm:w-auto">
          <button
            onClick={() => setStatusFilter('ALL')}
            aria-pressed={statusFilter === 'ALL'}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Barchasi ({drivers.length})
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
            Bo'sh ({availableDrivers})
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
            Reysda ({onDutyDrivers})
          </button>
        </div>
      </div>
      {/* 4. MOBILDA LABEL/VALUE QATORLI IXCHAM JADVAL */}
      <ul className="grid gap-3 lg:hidden">
        {filteredDrivers.length === 0 ? (
          <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            Haydovchilar topilmadi
          </li>
        ) : filteredDrivers.map((driver) => {
          const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');
          const details = [
            ['Texnika', driver.truck || 'Kiritilmagan'],
            ['Treyler', driver.trailer || 'Kiritilmagan'],
            ['Joylashuv', driver.currentLocation || 'Oflayn'],
            ['Holat', activeLoad ? `Reysda (${activeLoad.loadNumber})` : "Bo'sh (Tayyor)"],
          ];
          const cardTitleId = `driver-card-${driver.id}`;

          return (
            <li key={driver.id} aria-labelledby={cardTitleId} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-zinc-100 text-xs font-bold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                  {driver.avatar
                    ? <img src={driver.avatar} alt="" className="h-full w-full object-cover" />
                    : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 id={cardTitleId} className="truncate font-bold text-zinc-900 dark:text-zinc-100">{driver.name}</h4>
                  <p className="mt-0.5 break-words text-xs text-zinc-500">
                    {driver.driverNumber || 'Raqam kiritilmagan'} · {driver.phone || 'Telefon kiritilmagan'}
                  </p>
                </div>
                <span className={`h-2.5 w-2.5 flex-none rounded-full ${activeLoad ? 'bg-blue-500' : 'bg-emerald-500'}`} aria-hidden="true" />
              </div>

              <dl className="border-t border-zinc-200 px-4 dark:border-zinc-800">
                {details.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-3 border-b border-zinc-100 py-2.5 last:border-b-0 dark:border-zinc-800">
                    <dt className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{label}</dt>
                    <dd className={`min-w-0 break-words text-right text-xs font-bold ${label === 'Holat' ? (activeLoad ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-zinc-800 dark:text-zinc-200'}`}>{value}</dd>
                  </div>
                ))}
              </dl>

              {onDeleteDriver && (
                <div className="flex justify-end border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <button
                    aria-label={`${driver.name} haydovchisini olib tashlash`}
                    onClick={() => {
                      if (window.confirm(`${driver.name} drayverini o'chirishni xohlaysizmi?`)) onDeleteDriver(driver.id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Olib tashlash
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* 5. DESKTOPDA TO'LIQ KENGLIKDAGI JADVAL */}
      <div className="hidden w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800 lg:block">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <caption className="sr-only">Haydovchilar, texnika, joylashuv va reys holati</caption>
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th scope="col" className="py-3.5 px-4">Haydovchi</th>
              <th scope="col" className="py-3.5 px-4">Texnika & Treyler</th>
              <th scope="col" className="py-3.5 px-4">Hozirgi Joylashuv</th>
              <th scope="col" className="py-3.5 px-4">Holat</th>
              <th scope="col" className="py-3.5 px-4 text-right">Amal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-zinc-400 font-medium">
                  Haydovchilar topilmadi
                </td>
              </tr>
            ) : (
              filteredDrivers.map((driver) => {
                const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');

                return (
                  <tr key={driver.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-xs text-zinc-800 dark:text-zinc-200 flex-shrink-0">
                          {driver.avatar
                            ? <img src={driver.avatar} alt="" className="h-full w-full object-cover" />
                            : <span aria-hidden="true">{driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}</span>}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2 whitespace-nowrap">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{driver.name}</span>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber || 'Raqam kiritilmagan'}</span> • <span>{driver.phone || 'Telefon kiritilmagan'}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        <Truck className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{driver.truck || 'Kiritilmagan'}</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono mt-0.5 pl-6">
                        {driver.trailer || 'Kiritilmagan'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5 text-sm">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="font-medium">{driver.currentLocation || 'Oflayn'}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {activeLoad ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
                          Reysda ({activeLoad.loadNumber})
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                          ✓ Bo'sh (Tayyor)
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {onDeleteDriver && (
                        <button
                          onClick={() => {
                            if (window.confirm(`${driver.name} drayverini o'chirishni xohlaysizmi?`)) {
                              onDeleteDriver(driver.id);
                            }
                          }}
                          aria-label={`${driver.name} haydovchisini olib tashlash`}
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                          title="Haydovchini o'chirish"
                        >
                          <Trash2 className="w-4 h-4" />
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
        <div id="company-members-panel" role="region" aria-label="Dispecherlar" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              type="search"
              aria-label="Dispecherlarni qidirish"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Ism, email yoki telefon..."
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <ul className="grid gap-3 lg:hidden">
            {filteredDispatchers.length === 0 ? (
              <li className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <UserCog className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-zinc-700 dark:text-zinc-200">Dispecherlar topilmadi</p>
                <p className="mt-1 text-xs text-zinc-500">Yangi foydalanuvchi yaratishda “Dispecher” rolini tanlang.</p>
              </li>
            ) : filteredDispatchers.map((dispatcher) => (
              <li key={dispatcher.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3 px-4 py-4">
                  <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
                    {dispatcher.avatar ? <img src={dispatcher.avatar} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{dispatcher.name?.charAt(0) || 'D'}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-zinc-900 dark:text-zinc-100">{dispatcher.name}</p>
                    <p className="mt-0.5 break-all text-xs text-zinc-500">{dispatcher.email || 'Email kiritilmagan'}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${dispatcher.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{dispatcher.status === 'active' ? 'Faol' : 'To‘xtatilgan'}</span>
                </div>
                <dl className="border-t border-zinc-100 px-4 dark:border-zinc-800">
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-zinc-500">Telefon</dt><dd className="break-words text-right font-semibold">{dispatcher.phone || 'Kiritilmagan'}</dd></div>
                  <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 border-t border-zinc-100 py-3 text-xs dark:border-zinc-800"><dt className="text-zinc-500">Rol</dt><dd className="text-right font-semibold">Dispecher</dd></div>
                </dl>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:block">
            <table className="w-full min-w-[680px] text-left">
              <caption className="sr-only">Kompaniya dispecherlari</caption>
              <thead className="border-b border-zinc-200 bg-zinc-50/80 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
                <tr><th scope="col" className="px-4 py-3.5">Dispecher</th><th scope="col" className="px-4 py-3.5">Email</th><th scope="col" className="px-4 py-3.5">Telefon</th><th scope="col" className="px-4 py-3.5">Holat</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {filteredDispatchers.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-zinc-400">Dispecherlar topilmadi</td></tr>
                ) : filteredDispatchers.map((dispatcher) => (
                  <tr key={dispatcher.id} className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 flex-none place-items-center overflow-hidden rounded-xl bg-cyan-50 text-xs font-black text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
                          {dispatcher.avatar ? <img src={dispatcher.avatar} alt="" className="h-full w-full object-cover" /> : <span aria-hidden="true">{dispatcher.name?.charAt(0) || 'D'}</span>}
                        </div>
                        <div><p className="font-bold text-zinc-900 dark:text-zinc-100">{dispatcher.name}</p><p className="mt-0.5 text-xs text-zinc-400">Dispecher</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-zinc-600 dark:text-zinc-300">{dispatcher.email || 'Kiritilmagan'}</td>
                    <td className="px-4 py-3.5 font-medium text-zinc-600 dark:text-zinc-300">{dispatcher.phone || 'Kiritilmagan'}</td>
                    <td className="px-4 py-3.5"><span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${dispatcher.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{dispatcher.status === 'active' ? 'Faol' : 'To‘xtatilgan'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}
      </div>

    </div>
  );
}
