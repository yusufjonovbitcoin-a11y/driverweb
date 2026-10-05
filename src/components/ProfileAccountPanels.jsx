import { Bell, Building2, ChevronRight, Clock3, Globe2, KeyRound, Mail, MessageSquare, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOCALE_META, SUPPORTED_LOCALES } from '../i18n/locales';
import ProfileTimeZoneSelect from './ProfileTimeZoneSelect';
import PersonalProfileForm from './PersonalProfileForm';
import { roleLabel } from '../i18n/labels';

export function ProfileSectionHeading({ title, description }) {
  return <header className="profile-section-heading"><h2>{title}</h2>{description && <p>{description}</p>}</header>;
}

function DetailFields({ fields }) {
  return <dl className="profile-detail-fields">{fields.map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd>{value}</dd>
  </div>)}</dl>;
}

export function ProfilePersonalPanel({ currentUser, locale, localeSaving, timeZone, onLocaleChange, onTimeZoneChange, onSaveProfile }) {
  const { t } = useTranslation();
  const missing = t('common.notProvided');
  return <div className="profile-section-stack">
    <section className="profile-panel">
      <ProfileSectionHeading title={t('profile.personal')} description={t('profile.personalDescription')} />
      <div className="profile-personal-banner">
        <span className="profile-personal-avatar" aria-hidden="true">{currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}</span>
        <div><strong>{currentUser?.name || missing}</strong><span>{roleLabel(t, currentUser?.roleCode || currentUser?.role)}</span></div>
      </div>
      <PersonalProfileForm key={currentUser?.id} currentUser={currentUser} onSave={onSaveProfile} />
    </section>
    <section className="profile-panel">
      <div className="profile-panel-title"><Globe2 size={21} aria-hidden="true" /><div><h3>{t('profile.regionalSettings')}</h3><p>{t('profile.languageHint')}</p></div></div>
      <div className="profile-form-grid">
        <label><span>{t('profile.language')}</span><select value={locale} disabled={localeSaving} onChange={event => onLocaleChange?.(event.target.value)}>
          {SUPPORTED_LOCALES.map(code => <option key={code} value={code}>{LOCALE_META[code].label}</option>)}
        </select></label>
        <label><span>{t('profile.timeZone')}</span><ProfileTimeZoneSelect value={timeZone} onChange={onTimeZoneChange} /></label>
      </div>
      <p className="profile-panel-note"><Clock3 size={16} aria-hidden="true" />{t('profile.timeZoneHint')}</p>
    </section>
  </div>;
}

export function ProfileSecurityPanel({ currentUser }) {
  const { t } = useTranslation();
  return <div className="profile-section-stack">
    <ProfileSectionHeading title={t('profile.security')} description={t('profile.securityDescription')} />
    <section className="profile-panel">
      <div className="profile-panel-title"><KeyRound size={22} aria-hidden="true" /><div><h3>{t('profile.signInMethod')}</h3><p>{t('profile.emailAndPassword')}</p></div></div>
      <DetailFields fields={[[t('common.email'), currentUser?.email || t('common.notProvided')], [t('profile.position'), roleLabel(t, currentUser?.roleCode || currentUser?.role)]]} />
      <p className="profile-panel-note">{t('profile.passwordReadOnly')}</p>
    </section>
    <section className="profile-panel">
      <div className="profile-panel-title"><ShieldCheck size={22} aria-hidden="true" /><div><h3>{t('profile.accountProtection')}</h3><p>{t('profile.passwordPrivacyHint')}</p></div></div>
      <div className="profile-security-tip"><Mail size={20} aria-hidden="true" /><div><strong>{t('profile.account')}</strong><p>{currentUser?.email || t('profile.emailMissing')}</p></div></div>
      <div className="profile-security-tip"><Smartphone size={20} aria-hidden="true" /><div><strong>{t('profile.currentSession')}</strong><p>{t('profile.sessionPrivacyHint')}</p></div></div>
    </section>
  </div>;
}

export function ProfileNotificationsPanel({ unreadChatCount = 0, unreadInboxCount = 0, onNavigate }) {
  const { t } = useTranslation();
  const items = [
    { tab: 'chat', icon: MessageSquare, label: t('nav.chat'), description: t('profile.chatDescription'), count: unreadChatCount },
    { tab: 'inbox', icon: Mail, label: t('nav.inbox'), description: t('profile.gmailDescription'), count: unreadInboxCount },
  ];
  return <div className="profile-section-stack">
    <ProfileSectionHeading title={t('profile.notifications')} description={t('profile.notificationsDescription')} />
    <section className="profile-panel profile-notification-panel">
      <div className="profile-panel-title"><Bell size={22} aria-hidden="true" /><div><h3>{t('profile.allNotifications')}</h3><p>{t('profile.newNotifications', { count: unreadChatCount + unreadInboxCount })}</p></div></div>
      {items.map(({ tab, icon: Icon, label, description, count }) => <button key={tab} type="button" className="profile-notification-row" onClick={() => onNavigate?.(tab)}>
        <span className="profile-row-icon"><Icon size={22} aria-hidden="true" /></span>
        <span className="profile-row-copy"><strong>{label}</strong><small>{description}</small><span>{count ? t('profile.newMessages', { count }) : t('profile.noNewMessages')}</span></span>
        <span className={`profile-count-badge ${count ? 'has-unread' : ''}`}>{count}</span><ChevronRight size={17} aria-hidden="true" />
      </button>)}
    </section>
    <p className="profile-panel-note">{t('profile.notificationPreferencesHint')}</p>
  </div>;
}

export function ProfileContactPanel({ currentUser, timeZone }) {
  const { t } = useTranslation();
  return <div className="profile-section-stack">
    <ProfileSectionHeading title={t('profile.contact')} description={t('profile.contactDetails')} />
    <section className="profile-panel">
      <div className="profile-panel-title"><Building2 size={22} aria-hidden="true" /><div><h3>{currentUser?.company || t('common.company')}</h3><p>{t('profile.companyTeam')}</p></div></div>
      <DetailFields fields={[[t('common.email'), currentUser?.email || t('profile.emailMissing')], [t('common.phone'), currentUser?.phone || t('profile.phoneMissing')]]} />
    </section>
    <section className="profile-panel">
      <div className="profile-panel-title"><Smartphone size={22} aria-hidden="true" /><div><h3>{t('profile.devicesAndSessions')}</h3><p>{t('profile.currentSession')}</p></div></div>
      <DetailFields fields={[[t('profile.timeZone'), timeZone]]} />
    </section>
  </div>;
}
