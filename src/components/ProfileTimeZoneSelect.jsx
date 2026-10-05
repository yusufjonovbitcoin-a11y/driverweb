import { useEffect, useState } from 'react';
import { TIME_ZONES, formatTimeZoneClock } from '../i18n/timeZone';

export default function ProfileTimeZoneSelect({ value, onChange, ...props }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <select {...props} value={value} onChange={event => onChange?.(event.target.value)}>
    {TIME_ZONES.map(zone => <option key={zone.value} value={zone.value}>{zone.label} · {formatTimeZoneClock(now, zone.value)}</option>)}
  </select>;
}
