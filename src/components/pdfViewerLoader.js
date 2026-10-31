import { measureDocumentStage } from '../services/documentPerformance.js';

let pending;
export function loadPdfViewer() {
  if (!pending) {
    const finished = measureDocumentStage('load-pdf-renderer-code');
    pending = import('./PdfDocumentViewer.jsx').then(module => {
      finished();
      void import('./pdfWorker.js').then(({ prewarmPdfWorker }) => prewarmPdfWorker()).catch(() => {});
      return module;
    })
      .catch(error => { pending = null; throw error; });
  }
  return pending;
}

// This warms local renderer code only, never private media or signing endpoints.
export function preloadPdfViewer(document) {
  if (document?.mimeType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(document?.fileName || document?.url || '')) {
    void loadPdfViewer().catch(() => {});
  }
}
