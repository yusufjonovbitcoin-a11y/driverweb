import { GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let sharedWorker;
export async function prewarmPdfWorker() {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new PDFWorker({ name: 'trip-documents' });
  const worker = sharedWorker;
  let timer;
  try {
    await Promise.race([worker.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF worker timed out.')), 10_000); })]);
    return worker;
  }
  catch (error) { if (sharedWorker === worker) sharedWorker = null; worker.destroy(); throw error; }
  finally { clearTimeout(timer); }
}
// Documents release their transports/canvases on close. The empty worker is
// shared to avoid downloading/starting it again for each document.
if (import.meta.hot) import.meta.hot.dispose(() => { sharedWorker?.destroy(); sharedWorker = null; });
