import { Bell, Building2, ChevronRight, Globe2, Mail, MonitorCog, ShieldCheck, Smartphone, UserRound, Settings, Link2, Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOCALE_META, SUPPORTED_LOCALES } from '../i18n/locales';
import ProfileTimeZoneSelect from './ProfileTimeZoneSelect';

export default function ProfileSettingsHub({ query = '', currentUser, locale, localeSaving, timeZone, theme,
  toggleTheme, notificationCount, canManageIntegrations, gmailConnection, onSection, onLocaleChange, onTimeZoneChange }) {
  const { t } = useTranslation();
  const groups = [
    { id: 'workspace', icon: Settings, title: t('profile.workspaceGroup'), hint: t('profile.workspaceHint'), rows: [
      { id: 'company', icon: Building2, title: t('common.company'), description: t('profile.companyTeam'), value: currentUser?.company || '—', action: () => onSection('company') },
      { id: 'language', icon: Globe2, title: t('profile.language'), description: t('profile.languageHint'), value: LOCALE_META[locale]?.label,
        control: <select aria-label={t('profile.language')} value={locale} disabled={localeSaving} onChange={event => onLocaleChange(event.target.value)}>{SUPPORTED_LOCALES.map(code => <option key={code} value={code}>{LOCALE_META[code].label}</option>)}</select> },
      { id: 'timeZone', icon: Clock3, title: t('profile.timeZone'), description: t('profile.timeZoneHint'), value: timeZone,
        control: <ProfileTimeZoneSelect aria-label={t('profile.timeZone')} value={timeZone} onChange={onTimeZoneChange} /> },
      { id: 'theme', icon: MonitorCog, title: t('profile.interface'), value: t(theme === 'dark' ? 'profile.dark' : 'profile.light'), action: toggleTheme },
    ] },
    { id: 'connections', icon: Link2, title: t('profile.connectionsGroup'), hint: t('profile.connectionsHint'), rows: [
      ...(canManageIntegrations ? [{ id: 'gmail', icon: Mail, title: 'Gmail', description: t('profile.gmailDescription'),
        value: gmailConnection?.status === 'active' ? t('profile.connected') : t('profile.integrations'), connected: gmailConnection?.status === 'active', action: () => onSection('integrations') }] : []),
      { id: 'devices', icon: Smartphone, title: t('profile.devices'), value: t('profile.currentSession'), action: () => onSection('contact') },
    ] },
    { id: 'account', icon: UserRound, title: t('profile.accountGroup'), hint: t('profile.accountHint'), rows: [
      { id: 'personal', icon: UserRound, title: t('profile.personal'), value: currentUser?.name || '—', action: () => onSection('overview') },
      { id: 'security', icon: ShieldCheck, title: t('profile.security'), value: t('profile.emailAndPassword'), action: () => onSection('security') },
      { id: 'notifications', icon: Bell, title: t('profile.notifications'), value: notificationCount ? t('profile.newNotifications', { count: notificationCount }) : t('profile.noNewMessages'), action: () => onSection('notifications') },
    ] },
  ];
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = groups.map(group => ({ ...group, rows: group.rows.filter(row => tokens.every(token =>
    [group.title, row.title, row.description, row.value].filter(Boolean).join(' ').toLocaleLowerCase().includes(token))) })).filter(group => group.rows.length);
  return <div className="profile-settings-groups">
    {visible.map(group => {
      const GroupIcon = group.icon;
      return <section key={group.id} className="profile-settings-group" aria-labelledby={`profile-group-${group.id}`}>
        <header><GroupIcon size={23} aria-hidden="true" /><div><h2 id={`profile-group-${group.id}`}>{group.title}</h2><p>{group.hint}</p></div></header>
        {group.rows.map(row => {
          const Icon = row.icon;
          const content = <><Icon className="profile-setting-icon" size={21} aria-hidden="true" /><span className="profile-setting-copy"><strong>{row.title}</strong>{row.description && <small>{row.description}</small>}</span>
            <span className={`profile-setting-value ${row.connected ? 'is-connected' : ''}`}>{row.control || row.value}</span>{!row.control && <ChevronRight size={17} aria-hidden="true" />}</>;
          return row.control ? <div key={row.id} className="profile-setting-row">{content}</div> : <button key={row.id} type="button" className="profile-setting-row" onClick={row.action}>{content}</button>;
        })}
      </section>;
    })}
    {visible.length === 0 && <p role="status" className="profile-settings-empty">{t('profile.noSettingsFound')}</p>}
  </div>;
}
