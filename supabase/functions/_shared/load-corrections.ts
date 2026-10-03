import { FIELD_TYPES } from './load-extraction-verification.ts';
import { findCorrectionSource } from './pdf-source.ts';

// Human corrections are explicit, source-bound and retained in the audit snapshot.
// They do not approve or assign the load, or override semantic validators.
export function correctExtraction(original: any, edits: any, actorId: string) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 32) throw Error('1–32 corrections required');
  const candidate = structuredClone(original);
  for (const edit of edits) {
    const path = String(edit.field ?? '');
    const parts = path.split('.');
    const indexed = /^stops\.(\d+)\.(\w+)$/.exec(path);
    const clause = /^(requirements|contractTerms)\.(\d+)$/.exec(path);
    const type = indexed && candidate.stops?.[Number(indexed[1])] ? FIELD_TYPES[`pickup.${indexed[2]}`]
      : clause && typeof candidate[clause[1]]?.[Number(clause[2])] === 'string' ? 'string' : FIELD_TYPES[path];
    if (!type || (candidate.stops && /^(pickup|delivery)\./.test(path)) || parts.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) throw Error('Invalid correction field');
    const value = edit.value;
    if (value != null && (type === 'string' ? typeof value !== 'string' || value.length > 3500
      : type === 'boolean' ? typeof value !== 'boolean'
        : typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value)))) throw Error('Invalid correction value');
    if (!Number.isInteger(edit.page) || edit.page < 1 || edit.page > candidate.documentReview?.pageCount
      || typeof edit.quote !== 'string' || !edit.quote.trim() || edit.quote.length > 4000) throw Error('Original PDF page and quote required');
    let parent = candidate;
    for (const key of parts.slice(0, -1)) parent = parent[key] ??= {};
    parent[parts.at(-1)!] = value;
    candidate.evidence = candidate.evidence.filter((e: any) => e.field !== path);
    const source = candidate.sourceManifest ? findCorrectionSource(candidate.sourceManifest, edit.page, edit.quote, path) : null;
    if (value != null) candidate.evidence.push(source ?? { field: path, page: edit.page, quote: edit.quote });
    candidate.documentReview.uncertainFields = candidate.documentReview.uncertainFields.filter((key: string) => key !== path);
  }
  candidate.corrections = [...(candidate.corrections ?? []), { actorId, at: new Date().toISOString(), edits }];
  return candidate;
}
