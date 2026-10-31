import { useCallback, useEffect, useState } from 'react';
import { confirmSettingsNavigation, pushSettingsHistory } from './useSettingsDraft';

export function readProfileRoute(hash, fallback = {}) {
  const [page, query] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const section = params.get('section') || (page === 'profile' ? 'company' : fallback.section) || 'company';
  return {
    section: ['company', 'overview', 'integrations', 'security', 'notifications'].includes(section) ? section : section === 'contact' ? 'security' : 'company',
    team: ['drivers', 'dispatchers', 'vehicles'].includes(params.get('team')) ? params.get('team') : 'drivers',
    driver: params.get('driver') || fallback.driver || null,
    edit: params.get('edit') || fallback.edit || null,
  };
}

export default function useProfileRoute(fallback) {
  const [route, setRoute] = useState(() => readProfileRoute(typeof window === 'undefined' ? '' : window.location.hash, fallback));
  useEffect(() => {
    // App's route guard gets the first chance to reject a browser Back/Forward.
    const sync = () => queueMicrotask(() => {
      if (window.location.hash.split('?')[0] === '#profile') setRoute(readProfileRoute(window.location.hash));
    });
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const navigate = useCallback(patch => {
    const next = { ...route, ...patch };
    const params = new URLSearchParams();
    if (next.section !== 'company') params.set('section', next.section);
    if (next.team !== 'drivers') params.set('team', next.team);
    if (next.driver) params.set('driver', next.driver);
    if (next.edit) params.set('edit', next.edit);
    const hash = `#profile${params.size ? `?${params}` : ''}`;
    if (window.location.hash === hash && Object.keys(next).every(key => next[key] === route[key])) return true;
    if (!confirmSettingsNavigation()) return false;
    if (window.location.hash !== hash) pushSettingsHistory(hash);
    setRoute(next);
    return true;
  }, [route]);
  return [route, navigate];
}
