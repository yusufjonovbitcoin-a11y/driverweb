import { validatePdfSource, type PdfSource } from './pdf-source.ts';

type TextItem = { str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean };
type PdfPage = { getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: TextItem[] }> };
type PdfDocument = { numPages: number; getPage(number: number): Promise<PdfPage> };
type PdfLoader = () => Promise<{ getDocumentProxy(bytes: Uint8Array): Promise<PdfDocument> }>;

export type CloudPdfResult = { source: PdfSource | null; scanPages: number[] };

// The bytes are parsed inside the authenticated Edge Function. A native PDF
// text layer supplies independent evidence; the original PDF supplies page
// images to the vision model. Scanned pages without native text are never
// described as source-grounded.
export async function extractCloudPdfSource(
  bytes: Uint8Array, checksum: string,
  loadPdf: PdfLoader = () => import('npm:unpdf@1.8.1') as Promise<any>,
): Promise<CloudPdfResult> {
  if (bytes.length > 20 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
    throw Error('PDF_SOURCE_INVALID');
  let document: PdfDocument;
  try {
    const { getDocumentProxy } = await loadPdf();
    document = await getDocumentProxy(bytes);
  } catch {
    throw Error('PDF_SOURCE_UNREADABLE');
  }
  if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > 50)
    throw Error('PDF_SOURCE_LOCKED_OR_TOO_LARGE');

  const pages: PdfSource['pages'] = [];
  const scanPages: number[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    let page: PdfPage;
    let items: TextItem[];
    try {
      page = await document.getPage(number);
      items = (await page.getTextContent()).items;
    } catch {
      throw Error('PDF_SOURCE_UNREADABLE');
    }
    const { width, height } = page.getViewport({ scale: 1 });
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 14400))
      throw Error('PDF_PAGE_SIZE_INVALID');
    const blocks: PdfSource['pages'][number]['blocks'] = [];
    let blockNumber = -1;
    let lineNumber = 0;
    let previous: { x: number; y: number; endX: number; height: number; line: number; block: number } | null = null;
    for (const item of items) {
      const value = typeof item.str === 'string' ? item.str.trim() : '';
      if (!value || !Array.isArray(item.transform) || item.transform.length < 6) continue;
      const x = Number(item.transform[4]);
      const y = height - Number(item.transform[5]);
      const itemWidth = Number(item.width);
      const itemHeight = Number(item.height);
      if (![x, y, itemWidth, itemHeight].every(Number.isFinite) || itemWidth < 0 || itemHeight < 0) continue;
      const top = Math.max(0, y - itemHeight);
      const box = [x, top, x + itemWidth, y].map(n => Math.round(n * 100) / 100);
      const sameLine = previous && Math.abs(y - previous.y) <= Math.max(2, itemHeight * .25)
        && x >= previous.endX - 2 && x - previous.endX <= 12;
      const nextLine = previous && !sameLine && Math.abs(x - previous.x) <= 4
        && y > previous.y && y - previous.y <= Math.max(22, previous.height * 2.2);
      if (sameLine) {
        const prior = blocks[previous!.line];
        prior.text += `${x > previous!.endX + 1 ? ' ' : ''}${value}`;
        prior.bbox[0] = Math.min(prior.bbox[0], box[0]);
        prior.bbox[1] = Math.min(prior.bbox[1], box[1]);
        prior.bbox[2] = Math.max(prior.bbox[2], box[2]);
        prior.bbox[3] = Math.max(prior.bbox[3], box[3]);
      } else {
        if (!nextLine) { blockNumber++; lineNumber = 0; }
        else lineNumber++;
        blocks.push({ id: `page_${number}_block_${blockNumber}_line_${lineNumber}`,
          text: value, bbox: box });
      }
      previous = { x, y, endX: x + itemWidth, height: itemHeight,
        line: blocks.length - 1, block: blockNumber };
      if (blocks.length > 25000) throw Error('PDF_SOURCE_TOO_LARGE');
    }
    const nativeText = blocks.map(block => block.text).join('').replace(/\s/g, '');
    if (nativeText.length < 30 || (nativeText.match(/\uFFFD/g)?.length ?? 0) > Math.max(2, nativeText.length * .01))
      scanPages.push(number);
    pages.push({ number, width, height, ocr: false, blocks });
  }
  // A partially scanned document also needs manual review. We avoid mixing
  // unverifiable image facts into a trusted source manifest.
  if (scanPages.length) return { source: null, scanPages };
  return { source: validatePdfSource({ version: 1, checksum, engine: 'PDF.js-unpdf-1.8.1',
    pageCount: pages.length, pages }, checksum), scanPages: [] };
}
