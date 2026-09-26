const PAGE_TARGETS = [
  { id: 'kanban', title: 'Yuklar', keywords: ['reyslar', 'yuklar', 'doska', 'kanban'] },
  { id: 'drivers', title: 'Haydovchilar', keywords: ['haydovchilar', 'drayverlar', 'drivers'] },
  { id: 'map', title: 'Xarita', keywords: ['xarita', 'joylashuv', 'lokatsiya', 'map'] },
  { id: 'docs', title: 'Hujjatlar', keywords: ['hujjatlar', 'rate con', 'ratecon', 'bol', 'pod', 'documents'] },
  { id: 'inbox', title: 'Broker Inbox', keywords: ['broker', 'inbox', 'xatlar', 'email', 'gmail'] },
  { id: 'chat', title: 'Chat', keywords: ['chat', 'xabarlar', 'suhbat'] },
  { id: 'profile', title: 'Profil', keywords: ['profil', 'sozlamalar', 'kompaniya', 'integratsiya'] },
];

const STATUS_LABELS = {
  OFFER: 'taklif',
  ASSIGNED: 'tayinlangan',
  IN_TRANSIT: 'tranzitda',
  DELIVERED: 'yetkazilgan',
  COMPLETED: 'tugallangan',
};

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

function routeLabel(load) {
  const origin = [load.origin?.city, load.origin?.state].filter(Boolean).join(', ');
  const destination = [load.destination?.city, load.destination?.state].filter(Boolean).join(', ');
  return [origin, destination].filter(Boolean).join(' → ') || 'Marshrut kiritilmagan';
}

export function buildGlobalSearchResults({ query, loads = [], drivers = [], limit = 8 }) {
  if (!normalizeSearchText(query)) return [];

  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  const driverResults = drivers.map((driver) => ({
    id: `driver:${driver.id}`,
    type: 'driver',
    entityId: driver.id,
    title: driver.name,
    subtitle: [driver.driverNumber, driver.phone, driver.currentLocation].filter(Boolean).join(' · '),
    category: 'Haydovchi',
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
      subtitle: `${routeLabel(load)}${load.broker ? ` · ${load.broker}` : ''}`,
      category: 'Reys',
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
        STATUS_LABELS[load.status],
        driver?.name,
        driver?.driverNumber,
        ...availableDocuments,
      ]) + (matchScore(query, [load.loadNumber]) ? 20 : 0),
    };
  }).filter((result) => result.score > 0);

  const pageResults = PAGE_TARGETS.map((page) => ({
    id: `page:${page.id}`,
    type: 'page',
    tab: page.id,
    title: page.title,
    subtitle: `${page.title} bo‘limiga o‘tish`,
    category: 'Bo‘lim',
    score: matchScore(query, [page.title, ...page.keywords]) + (matchScore(query, [page.title]) ? 20 : 0),
  })).filter((result) => result.score > 0);

  return [...driverResults, ...loadResults, ...pageResults]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'uz'))
    .slice(0, limit);
}
