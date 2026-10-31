import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from './settlement-inline.vite.config.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { randomBytes } from 'node:crypto';
const rangePdf = (async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([500, 700]).drawText('First page must appear before the whole PDF arrives', { x: 20, y: 640, size: 12, font });
  await pdf.attach(randomBytes(512 * 1024), 'synthetic-padding.bin');
  return Buffer.from(await pdf.save());
})();
const rangeFixture = { name: 'slow-pdf-range-fixture', configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/tests/ui/range.pdf') return next();
    const bytes = await rangePdf, range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Accept-Ranges', 'bytes'); response.setHeader('Cache-Control', 'no-store');
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
      response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      response.setHeader('Content-Length', end - start + 1); response.end(bytes.subarray(start, end + 1));
    } else {
      response.setHeader('Content-Length', bytes.length); response.write(bytes.subarray(0, 64 * 1024));
      const timer = setTimeout(() => response.end(bytes.subarray(64 * 1024)), 6000);
      response.on('close', () => clearTimeout(timer));
    }
  });
} };
export default mergeConfig(base, { plugins: [rangeFixture], cacheDir: 'node_modules/.vite-pdf-performance-ui', resolve: { alias: [
  { find: /^.*\/services\/tripDocumentAccess\.js$/, replacement: fileURLToPath(new URL('./pdf-performance-source.stub.js', import.meta.url)) },
] } });
