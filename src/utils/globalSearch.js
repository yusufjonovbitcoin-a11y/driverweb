const FALLBACK_TRANSLATIONS = {
  'nav.loads': 'Yuklar',
  'nav.drivers': 'Haydovchilar',
  'nav.map': 'Xarita',
  'nav.documents': 'Hujjatlar',
  'nav.inbox': 'Broker Inbox',
  'nav.chat': 'Chat',
  'nav.profile': 'Profil',
  'search.driver': 'Haydovchi',
  'search.trip': 'Reys',
  'search.section': 'Bo‘lim',
  'search.routeMissing': 'Marshrut kiritilmagan',
  'search.keywords.loads': ['yuk', 'reys', 'stavka'],
  'search.keywords.drivers': ['haydovchi', 'drayver'],
  'search.keywords.map': ['xarita', 'joylashuv'],
  'search.keywords.documents': ['hujjat', 'pdf', 'pod', 'bol'],
  'search.keywords.inbox': ['broker', 'xat', 'inbox'],
  'search.keywords.chat': ['chat', 'suhbat', 'xabar'],
  'search.keywords.profile': ['profil', 'sozlama', 'til'],
  'loadStatus.in_transit': 'Tranzitda',
};

function fallbackTranslate(key, options = {}) {
  if (key === 'search.goTo') return `${options.title} bo‘limiga o‘tish`;
  return FALLBACK_TRANSLATIONS[key] ?? options.defaultValue ?? key;
}

const PAGE_TARGETS = [
  { id: 'kanban', titleKey: 'nav.loads', keywordsKey: 'search.keywords.loads' },
  { id: 'drivers', titleKey: 'nav.drivers', keywordsKey: 'search.keywords.drivers' },
  { id: 'map', titleKey: 'nav.map', keywordsKey: 'search.keywords.map' },
  { id: 'docs', titleKey: 'nav.documents', keywordsKey: 'search.keywords.documents' },
  { id: 'inbox', titleKey: 'nav.inbox', keywordsKey: 'search.keywords.inbox' },
  { id: 'chat', titleKey: 'nav.chat', keywordsKey: 'search.keywords.chat' },
  { id: 'profile', titleKey: 'nav.profile', keywordsKey: 'search.keywords.profile' },
];

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchScore(query, values) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (!tokens.length) return 0;

  const normalizedValues = values.map(normalizeSearchText).filter(Boolean);
  const searchableValues = normalizedValues.flatMap((value) => [value, value.replaceAll(' ', '')]);
  const haystack = searchableValues.join(' ');
  if (!tokens.every((token) => haystack.includes(token))) return 0;

  const normalizedQuery = tokens.join(' ');
  if (searchableValues.some((value) => value === normalizedQuery)) return 100;
  if (searchableValues.some((value) => value.startsWith(normalizedQuery))) return 80;
  if (searchableValues.some((value) => value.includes(normalizedQuery))) return 60;
  return 40;
}

function routeLabel(load, t) {
  const origin = [load.origin?.city, load.origin?.state].filter(Boolean).join(', ');
  const destination = [load.destination?.city, load.destination?.state].filter(Boolean).join(', ');
  return [origin, destination].filter(Boolean).join(' → ') || t('search.routeMissing');
}

export function buildGlobalSearchResults({ query, loads = [], drivers = [], limit = 8, t, locale }) {
  const translate = t || fallbackTranslate;
  if (!normalizeSearchText(query)) return [];

  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  const driverResults = drivers.map((driver) => ({
    id: `driver:${driver.id}`,
    type: 'driver',
    entityId: driver.id,
    title: driver.name,
    subtitle: [driver.driverNumber, driver.phone, driver.currentLocation].filter(Boolean).join(' · '),
    category: translate('search.driver'),
    score: matchScore(query, [
      driver.name,
      driver.driverNumber,
      driver.phone,
      driver.currentLocation,
      driver.truck,
      driver.trailer,
    ]) + (matchScore(query, [driver.name, driver.driverNumber]) ? 20 : 0),
  })).filter((result) => result.score > 0);

  const loadResults = loads.map((load) => {
    const driver = driverById.get(load.driverId);
    const availableDocuments = [
      load.documents?.rateCon && 'Rate Con RateCon',
      load.documents?.shipperBol && 'BOL',
      load.documents?.receiverPod && 'POD',
    ].filter(Boolean);

    return {
      id: `load:${load.id}`,
      type: 'load',
      entityId: load.id,
      title: load.loadNumber,
      subtitle: `${routeLabel(load, translate)}${load.broker ? ` · ${load.broker}` : ''}`,
      category: translate('search.trip'),
      score: matchScore(query, [
        load.loadNumber,
        load.broker,
        load.origin?.city,
        load.origin?.state,
        load.origin?.address,
        load.destination?.city,
        load.destination?.state,
        load.destination?.address,
        load.equipment,
        load.rate,
        load.distanceMiles,
        load.status,
        translate(`loadStatus.${String(load.status || '').toLowerCase()}`, { defaultValue: load.status }),
        driver?.name,
        driver?.driverNumber,
        ...availableDocuments,
      ]) + (matchScore(query, [load.loadNumber]) ? 20 : 0),
    };
  }).filter((result) => result.score > 0);

  const pageResults = PAGE_TARGETS.map((page) => {
    const title = translate(page.titleKey);
    const keywords = translate(page.keywordsKey, { returnObjects: true });
    return {
      id: `page:${page.id}`,
      type: 'page',
      tab: page.id,
      title,
      subtitle: translate('search.goTo', { title }),
      category: translate('search.section'),
      score: matchScore(query, [title, ...(Array.isArray(keywords) ? keywords : [])])
        + (matchScore(query, [title]) ? 20 : 0),
    };
  }).filter((result) => result.score > 0);

  return [...driverResults, ...loadResults, ...pageResults]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, locale || 'uz'))
    .slice(0, limit);
}
