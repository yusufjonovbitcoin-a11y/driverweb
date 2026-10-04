// These rules check internal consistency, not independent PDF/OCR verification.
// Source quotes are model supplied; dispatcher review remains mandatory.
export const documentReviewSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    documentReadable: { type: 'boolean' }, singleLoad: { type: 'boolean' },
    allPagesRead: { type: 'boolean' }, pageCount: { type: 'integer' },
    operationalRequirementsComplete: { type: 'boolean' },
    documentDetailsComplete: { type: 'boolean' },
    uncertainFields: { type: 'array', items: { type: 'string' } },
  },
  required: ['documentReadable', 'singleLoad', 'allPagesRead', 'pageCount',
    'operationalRequirementsComplete', 'documentDetailsComplete', 'uncertainFields'],
};

const normalized = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[‐‑–—−]/g, '-').replace(/\s+/g, ' ').trim();

function validTimestamp(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = '0'] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && hour < 24 && minute < 60 && Number(second) < 60
    && Number.isFinite(Date.parse(value));
}

function printedTimestampMatches(value: string, quote: string) {
  if (!validTimestamp(value)) return false;
  const text = normalized(quote);
  if (text.includes(normalized(value))) return true;
  // Never validate an offset conversion using a quote without that offset.
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const [year, month, day, hour, minute, second = 0] = value.match(/\d+/g)!.map(Number);
  if (second !== 0) return false;
  const numericDate = new RegExp(`(?:^|\\D)0?${month}[/-]0?${day}[/-]${year}(?!\\d)`);
  const isoDate = value.slice(0, 10);
  const monthName = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'jun(?:e)?',
    'jul(?:y)?', 'aug(?:ust)?', 'sep(?:tember)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'][month - 1];
  const namedDate = new RegExp(`\\b${monthName}\\.?\\s+0?${day}(?:st|nd|rd|th)?[,]?\\s+${year}\\b`);
  if (!text.includes(isoDate) && !numericDate.test(text) && !namedDate.test(text)) return false;
  return [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/g)].some(([, h, m, period]) => {
    let hours = Number(h);
    if (period) {
      if (hours < 1 || hours > 12) return false;
      hours = hours % 12 + (period === 'pm' ? 12 : 0);
    }
    return hours === hour && Number(m) === minute;
  });
}

export function singlePassValueSupported(path: string, value: unknown, quote: string) {
  if (quote.includes('\uFFFD') || (typeof value === 'string' && value.includes('\uFFFD'))) return false;
  const text = normalized(quote);
  if (typeof value === 'number') {
    const numbers = text.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
      .match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return numbers.includes(value);
  }
  if (typeof value === 'boolean') {
    // Require an explicit HAZMAT yes/no label, not an inferred absence.
    return value
      ? /(?:hazmat|hazardous(?: materials?)?)\s*[:=]?\s*(?:yes|true)\b/.test(text)
        || /^hazmat\s*[:=]?\s*hazardous$/.test(text)
        || /\bhazmat\s+(?:un\s*)?\d{4}\b/.test(text)
      : /(?:hazmat|hazardous(?: materials?)?)\s*[:=]?\s*(?:no|false)\b|\bnon[- ]hazardous\b/.test(text);
  }
  if (typeof value !== 'string') return false;
  if (/\.(scheduledDate|readyDate)$/.test(path) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Compare calendar dates, never locale-dependent Date.parse of a US date.
    return printedTimestampMatches(`${value}T00:00:00`, `${quote} 00:00`);
  }
  if (/email$/i.test(path) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (/\.appointment(?:From|To)$/.test(path)) {
    return printedTimestampMatches(value, quote);
  }
  if (/\.appointmentTimezone$/.test(path)) {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { return false; }
  }
  if (/phone$|fax$/i.test(path)) {
    return quote.replace(/\D/g, '').includes(value.replace(/\D/g, ''));
  }
  // Punctuation/case may differ, but digits/words cannot be invented.
  const words = (s: string) => normalized(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return (` ${words(quote)} `).includes(` ${words(value)} `);
}

// A two-digit year does not establish a century. Preserve the printed date
// instead of discarding a real date or claiming an inferred ISO year is verified.
export function sourcePrintedDate(path: string, value: unknown, quote: string) {
  if (!/\.(scheduledDate|readyDate)$/.test(path) || typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(value) || singlePassValueSupported(path, value, quote)) return value;
  if (!validTimestamp(`${value}T00:00:00`)) return value;
  const [year, month, day] = value.split('-').map(Number);
  const dates = [...quote.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?!\d)/g)]
    .filter(([,m,d,y]) => Number(m) === month && Number(d) === day && Number(y) === year % 100);
  return dates.length === 1 ? dates[0][0] : value;
}

export async function runSinglePassExtraction<T, V>(extract: () => Promise<T>, verify: (candidate: T) => V) {
  const candidate = await extract(); // Deliberately no automatic model retry/audit.
  return { candidate, audit: { method: 'single_pass_rules', independentAudit: false }, verified: verify(candidate) };
}
