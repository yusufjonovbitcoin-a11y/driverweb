// This manifest is fetched SERVER-TO-SERVER from a configured private worker.
// Never accept a browser-submitted manifest, quote, bbox or worker URL as trusted.
export type PdfSource = { version: number; checksum: string; engine: string; pageCount: number;
  pages: Array<{ number: number; width: number; height: number; ocr: boolean; image?: string;
    blocks: Array<{ id: string; text: string; bbox: number[] }> }> };

export function validatePdfSource(source: any, checksum: string): PdfSource {
  if (source?.version !== 1 || source.checksum !== checksum || !Array.isArray(source.pages)
    || source.pages.length < 1 || source.pages.length > 50 || source.pageCount !== source.pages.length) throw Error('PDF_SOURCE_INVALID');
  const ids = new Set();
  let textLength = 0;
  for (const [i, page] of source.pages.entries()) {
    if (page.number !== i + 1 || !Number.isFinite(page.width) || !Number.isFinite(page.height)
      || page.width <= 0 || page.height <= 0 || typeof page.ocr !== 'boolean'
      || !Array.isArray(page.blocks) || !page.blocks.length) throw Error('PDF_SOURCE_INVALID');
    for (const b of page.blocks) {
      if (typeof b.id !== 'string' || !new RegExp(`^page_${i + 1}_block_\\d+_line_\\d+$`).test(b.id) || ids.has(b.id)
        || typeof b.text !== 'string' || !b.text.trim() || !Array.isArray(b.bbox) || b.bbox.length !== 4
        || b.bbox.some((n: any) => !Number.isFinite(n)) || b.bbox[2] < b.bbox[0] || b.bbox[3] < b.bbox[1]) throw Error('PDF_SOURCE_INVALID');
      ids.add(b.id); textLength += b.text.length;
    }
  }
  if (ids.size > 25000 || textLength > 1_000_000) throw Error('PDF_SOURCE_TOO_LARGE');
  return source;
}

export async function fetchPdfSource(bytes: Uint8Array, checksum: string, url: string, token: string, fetcher = fetch) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || token.length < 32) throw Error('PDF_WORKER_NOT_CONFIGURED');
  const response = await fetcher(endpoint.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(65_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' }, body: bytes as any });
  if (!response.ok) throw Error('PDF_PREPROCESS_FAILED');
  // Bound the response before JSON parsing, including chunked responses.
  const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > 28 * 1024 * 1024) { await reader.cancel(); throw Error('PDF_SOURCE_TOO_LARGE'); } chunks.push(value); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  const source = validatePdfSource(JSON.parse(new TextDecoder().decode(data)), checksum);
  if (source.pages.some(p => !p.image?.startsWith('data:image/jpeg;base64,'))) throw Error('PDF_SOURCE_IMAGE_MISSING');
  return source;
}

export function pdfSourceInput(source: PdfSource) {
  return source.pages.flatMap(page => [{ type: 'input_text', text: JSON.stringify({ page: page.number,
    width: page.width, height: page.height, ocr: page.ocr, blocks: page.blocks.map(({ id, text, bbox }) => ({ id, text, bbox })) }) },
  { type: 'input_image', image_url: page.image, detail: 'high' }]);
}

export function storedPdfSource(source: PdfSource): PdfSource {
  return { ...source, pages: source.pages.map(({ image: _image, ...page }) => ({ ...page,
    blocks: page.blocks.map(({ id, text, bbox }) => ({ id, text, bbox })) })) };
}

export function evidenceFromSource(ids: unknown, source: PdfSource, field: string) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 80 || new Set(ids).size !== ids.length) return null;
  const selected = ids.map(id => source.pages.flatMap(page => page.blocks.map(b => ({ ...b, page: page.number, ocr: page.ocr }))).find(b => b.id === id));
  // One source page per fact. Long legal clauses must be split at page boundaries.
  if (selected.some(b => !b) || new Set(selected.map(b => b!.page)).size !== 1) return null;
  const blocks = selected as NonNullable<typeof selected[number]>[];
  const quote = blocks.map(b => b.text).join('\n');
  if (quote.length > 4000) return null;
  return { field, page: blocks[0].page, quote, sourceIds: ids,
    sourceBoxes: blocks.map(b => ({ id: b.id, bbox: b.bbox })), sourceChecksum: source.checksum,
    sourceMethod: blocks[0].ocr ? 'ocr' : 'pdf_text' };
}

const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function findCorrectionSource(source: PdfSource, pageNumber: number, quote: string, field: string) {
  const page = source.pages.find(p => p.number === pageNumber);
  if (!page) throw Error('PDF_CORRECTION_SOURCE_MISSING');
  const needle = normalized(quote);
  if (!needle) throw Error('PDF_CORRECTION_SOURCE_MISSING');
  let best: typeof page.blocks | null = null;
  // Only exact contiguous PDF lines (with whitespace normalization), not fuzzy
  // digit/punctuation substitutions which could accept a changed amount or REF.
  for (let start = 0; start < page.blocks.length; start++) {
    for (let end = start; end < Math.min(start + 80, page.blocks.length); end++) {
      const blocks = page.blocks.slice(start, end + 1);
      const text = normalized(blocks.map(b => b.text).join(' '));
      if (text.length > 4000) break;
      if (text.includes(needle)) { if (!best || blocks.length < best.length) best = blocks; break; }
    }
  }
  if (!best) throw Error('PDF_CORRECTION_SOURCE_MISSING');
  return evidenceFromSource(best.map(b => b.id), source, field);
}
