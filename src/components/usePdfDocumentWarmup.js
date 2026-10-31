import { useEffect } from 'react';
import { resolveTripDocumentSource } from '../services/tripDocumentAccess.js';
import { preloadPdfViewer } from './pdfViewerLoader.js';

// Prepare at most two visible PDFs, only while this document list is mounted.
// Each file is authorized normally; no URL/bytes are persisted to disk.
export default function usePdfDocumentWarmup(documents) {
  const key = JSON.stringify(documents.filter(doc => doc.versionId && (doc.mimeType === 'application/pdf' || /\.pdf$/i.test(doc.fileName || '')))
    .slice(0, 2).map(({ versionId, mimeType, fileName }) => ({ versionId, mimeType, fileName })));
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const doc of JSON.parse(key)) {
        preloadPdfViewer(doc);
        void resolveTripDocumentSource(doc, { forPreview: true }).then(source => {
          controller.signal.throwIfAborted();
          return source.loadPdfPreview ? source.loadPdfPreview({ signal: controller.signal }) : source.loadPdfData?.({ signal: controller.signal });
        }).catch(() => {}); // Opening retains the normal retry/error UI.
      }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key]);
}
