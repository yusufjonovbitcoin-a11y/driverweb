import { evidenceFromSource, findCorrectionSource, type PdfSource } from './pdf-source.ts';
import { singlePassValueSupported } from './load-single-pass.ts';

// Bounded repairs from server-owned text, never from filenames, model quotes,
// surrounding legal prose or an assumed address/unit. Run only on fresh output.
export function repairSourceMappings(input: any, source: PdfSource) {
  const candidate = structuredClone(input);
  candidate.evidence ??= [];
  candidate.sourceRepairs ??= [];
  const get = (path: string) => path.split('.').reduce((v, k) => v?.[k], candidate);
  const set = (path: string, value: unknown, ids: string[], reason: string) => {
    const evidence = ids.length ? evidenceFromSource(ids, source, path) : null;
    if (value != null && !evidence) return;
    const keys = path.split('.'); let parent = candidate;
    for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
    parent[keys.at(-1)!] = value;
    candidate.evidence = candidate.evidence.filter((e: any) => e.field !== path);
    if (evidence) candidate.evidence.push(evidence);
    candidate.sourceRepairs.push({ field: path, reason, sourceIds: ids });
  };
  type Match = { value: string | number | boolean; ids: string[] };
  const matches = new Map<string, Match[]>();
  const add = (field: string, value: Match['value'], ids: string[]) =>
    matches.set(field, [...(matches.get(field) ?? []), { value, ids }]);
  for (const page of source.pages) for (const block of page.blocks) {
    const text = block.text.trim();
    // PO is accepted only in an actual rate-confirmation heading, not an
    // arbitrary purchase order/stop reference somewhere in the document.
    const load = text.match(/^(?:.*?\bRATE\s+CONFIRMATION\s+(?:FOR\s+)?PO|(?:LOAD|SHIPMENT)\s*(?:NO\.?|NUMBER|ID)?)\s*[:#-]+\s*([A-Z0-9][A-Z0-9/-]*)\s*$/i);
    if (load) add('loadNumber', load[1], [block.id]);
    const broker = text.match(/^([A-Z][A-Z0-9 &.,'-]{1,60})\s+RATE\s+CONFIRMATION\s+(?:FOR\s+)?PO\s*#/i);
    if (broker) add('broker.name', broker[1].trim(), [block.id]);
    // Require the complete quantity cell; generic legal references to pallets
    // and minimum quantities are not shipment facts.
    const counts = text.match(/^(\d+)\s+pallets?\s*\/\s*(\d+)\s+cases?$/i);
    if (counts) {
      add('palletCount', Number(counts[1]), [block.id]);
      add('caseCount', Number(counts[2]), [block.id]);
    }
    if (/^hazmat\s*:?$/i.test(text)) {
      // Explicit cell beneath this column header. Nearby columns cannot win.
      const cells = page.blocks.filter(b => b.bbox[1] >= block.bbox[3]
        && b.bbox[1] - block.bbox[3] <= 24 && Math.abs(b.bbox[0] - block.bbox[0]) <= 4);
      if (cells.length === 1 && /^(hazardous|non[- ]hazardous|yes|no|true|false)$/i.test(cells[0].text.trim())) {
        add('isHazmat', /^(hazardous|yes|true)$/i.test(cells[0].text.trim()), [block.id, cells[0].id]);
      }
    }
    const hazmat = text.match(/^hazmat\s*[:=]\s*(hazardous|non[- ]hazardous|yes|no|true|false)$/i);
    if (hazmat) add('isHazmat', /^(hazardous|yes|true)$/i.test(hazmat[1]), [block.id]);
  }
  // A submission instruction commonly wraps across lines. Recover only its
  // explicitly printed documents, deadline and destination, never broker email
  // or an unchecked QuickPay option elsewhere on the page.
  for (const page of source.pages) {
    const paragraphs = new Map<string, typeof page.blocks>();
    for (const block of page.blocks) {
      const key = block.id.replace(/_line_\d+$/, '');
      paragraphs.set(key, [...(paragraphs.get(key) ?? []), block]);
    }
    for (const blocks of paragraphs.values()) {
      if (blocks.length > 80) continue;
      const text = blocks.map(b => b.text).join(' ').replace(/\s+/g, ' ');
      if (text.length > 4000) continue;
      const submission = text.match(/\b(?:submit|send|email)\s+(.{10,500}?)\s+(within\s+\d+\s+(?:hours?|days?)\s+(?:of|after)\s+delivery)\s+to\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
      if (submission) {
        const ids = blocks.map(b => b.id);
        add('requiredDocuments', submission[1], ids);
        add('documentDeadline', submission[2], ids);
        add('billingEmail', submission[3], ids);
      }
    }
  }
  for (const [field, found] of matches) {
    if (new Set(found.map(m => m.value)).size !== 1) {
      // Conflicting explicit labels stay blocked, even if AI chose one of them.
      candidate.documentReview.uncertainFields = [...new Set([...candidate.documentReview.uncertainFields, field])];
      continue;
    }
    const old = candidate.evidence.find((e: any) => e.field === field);
    // A number can occur in the wrong column too. Prefer the explicit labelled
    // cell even when the old quote happens to contain the same digits.
    if (field === 'broker.name' && old && singlePassValueSupported(field, get(field), old.quote)) continue;
    if (old && get(field) !== found[0].value && singlePassValueSupported(field, get(field), old.quote)) {
      candidate.documentReview.uncertainFields = [...new Set([...candidate.documentReview.uncertainFields, field])];
      continue;
    }
    if (old && get(field) === found[0].value && JSON.stringify(old.sourceIds) === JSON.stringify(found[0].ids)) continue;
    set(field, found[0].value, found[0].ids, 'explicit_label');
  }
  // Repair omitted continuation IDs only for literal clauses found on exactly
  // one source page. Never move a stop field or phone across role boundaries.
  const clauseSource = { ...source, pages: source.pages.map(page => ({ ...page,
    blocks: page.blocks.filter(b => !/^[•◦▪‣●]$/.test(b.text.trim())) })) };
  for (const key of ['requirements', 'contractTerms']) {
    for (const [i, value] of (candidate[key] ?? []).entries()) {
      const path = `${key}.${i}`;
      if (typeof value !== 'string' || value.length < 20 || value.length > 3500) continue;
      const old = candidate.evidence.find((e: any) => e.field === path);
      if (old && singlePassValueSupported(path, value, old.quote)) continue;
      const found = source.pages.flatMap(page => {
        try { const e = findCorrectionSource(clauseSource, page.number, value, path); return e ? [e] : []; }
        catch { return []; }
      });
      if (found.length === 1) set(path, value, found[0].sourceIds, 'exact_clause_lines');
    }
  }
  const fax = candidate.evidence.find((e: any) => e.field === 'broker.fax');
  if (get('broker.fax') === '0' && fax && /^(?:fax\s*:?\s*)?0$/i.test(fax.quote.trim())) {
    set('broker.fax', null, fax.sourceIds, 'printed_placeholder');
  }
  return candidate;
}
