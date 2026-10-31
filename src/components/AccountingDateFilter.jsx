import { useTranslation } from 'react-i18next';
import { DateRangePicker } from './CalendarPicker';
import './accounting.css';

export default function AccountingDateFilter({ value, onChange, iconOnly = false, allowReset = true, periodForDate, label }) {
  const { t } = useTranslation();
  const title = label || t('accounting.period.title');
  return <div className={`accounting-date-filter${iconOnly ? ' accounting-date-icon-only' : ''}`}>
    {!iconOnly && <span className="accounting-date-label">{title}</span>}
    <DateRangePicker value={value} onChange={onChange} title={title} iconOnly={iconOnly} allowClear={allowReset} periodForDate={periodForDate}
      triggerLabel={iconOnly ? `${title}: ${value.from} — ${value.to}` : undefined} />
  </div>;
}
