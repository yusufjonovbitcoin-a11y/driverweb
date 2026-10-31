import { useTranslation } from 'react-i18next';
import { loadIdentity } from '../services/loadIdentity.js';

export default function LoadNumber({ load }) {
  const { t } = useTranslation();
  const identity = loadIdentity(load);
  return <span className="load-number-reference"><span>{identity.brokerLoadNumber || identity.loadNumber}</span>
    {identity.internalNumber && identity.brokerLoadNumber && <small title={t('loads.internalNumberAutomatic')}>
      {t('loads.internalReferenceShort')} {identity.loadNumber}
    </small>}
  </span>;
}
