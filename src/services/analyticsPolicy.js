const pages = new Set(['kanban', 'drivers', 'map', 'analytics', 'docs', 'inbox', 'chat', 'profile', 'login']);
export const ANALYTICS_PREFERENCE = 'tfleest.analytics.enabled';
export function analyticsPage(tab, origin) {
  const page = pages.has(tab) ? tab : 'other';
  return { page_title: `T Fleest — ${page}`, page_location: `${origin}/#${page}`, page_referrer: '' };
}
export function analyticsAllowed({ production, hostname, preference, doNotTrack, globalPrivacyControl }) {
  return production && hostname === 'driverweb-nine.vercel.app' && preference !== 'false'
    && doNotTrack !== '1' && !globalPrivacyControl;
}
