import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsDraft, confirmSettingsNavigation } from '../hooks/useSettingsDraft';
import DriverSettingsPanel from './DriverSettingsPanel';

export default function DriverEditPage({ driver, onBack, onWorkspaceRefresh, backToList = false }) {
  const { t } = useTranslation();
  const pageRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pageRef.current?.focus({ preventScroll: true });
    pageRef.current?.scrollIntoView({ block: 'start' });
  }, []);
  useSettingsDraft(dirty, busy, t('driverSettings.discardChanges'));
  const goBack = () => {
    if (!confirmSettingsNavigation()) return;
    onBack();
  };
  return <section id="company-members-panel" ref={pageRef} tabIndex={-1} className="profile-driver-editor" aria-label={t('profile.editDriver')}>
    <button type="button" onClick={goBack} disabled={busy} className="cdp-back"><ArrowLeft size={16} aria-hidden="true" />{t(backToList ? 'header.backToDrivers' : 'driverSettings.backToDriver')}</button>
    <DriverSettingsPanel driver={driver} canManageDriver onWorkspaceRefresh={onWorkspaceRefresh}
      title={`${t('profile.editDriver')}: ${driver.name}`} onDirtyChange={setDirty} onBusyChange={setBusy} />
  </section>;
}
