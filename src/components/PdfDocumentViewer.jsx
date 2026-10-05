import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import DocumentViewerFrame, { DocumentThumbnail } from './DocumentViewerFrame';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfViewer.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const assetRoot = `${import.meta.env.BASE_URL}pdfjs/`;

export default function PdfDocumentViewer({ url, title, onOpenOriginal, onRetrySource, ...actions }) {
  const [attempt, setAttempt] = useState(0);
  // A fresh session releases the old worker, canvases and scroll position.
  return <PdfSession key={`${url}:${attempt}`} url={url} title={title} onOpenOriginal={onOpenOriginal} {...actions} onRetry={onRetrySource || (() => setAttempt((value) => value + 1))} />;
}

function PdfSession({ url, title, onRetry, onOpenOriginal, onSourceError, onDownload, downloading, actionError }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const viewportRef = useRef(null);
  const containerRef = useRef(null);
  const viewerElementRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const linkServiceRef = useRef(null);
  const zoomRef = useRef(1);
  const thumbnailsRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({
      container: containerRef.current,
      viewer: viewerElementRef.current,
      eventBus,
      linkService,
      abortSignal: controller.signal,
      enableSelectionRendering: true,
    });
    linkService.setViewer(viewer);
    pdfViewerRef.current = viewer;
    linkServiceRef.current = linkService;
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width';
    }, { signal: controller.signal });
    eventBus.on('pagechanging', ({ pageNumber: currentPage }) => {
      setPageNumber(currentPage);
    }, { signal: controller.signal });
    return () => {
      viewer.setDocument(null);
      controller.abort();
      pdfViewerRef.current = null;
      linkServiceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const viewer = pdfViewerRef.current;
      if (!viewer?.pdfDocument || !viewer.pagesCount) return;
      viewer.currentScaleValue = 'page-width';
      if (zoomRef.current !== 1) viewer.currentScale *= zoomRef.current;
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({
      url,
      withCredentials: false,
      isEvalSupported: false,
      cMapUrl: `${assetRoot}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetRoot}standard_fonts/`,
      wasmUrl: `${assetRoot}wasm/`,
      iccUrl: `${assetRoot}iccs/`,
    });
    task.promise.then(async (document) => {
      if (cancelled) return;
      pdfViewerRef.current?.setDocument(document);
      linkServiceRef.current?.setDocument(document);
      setPdf(document);
      // Read only dimensions first so the scrolling layout never jumps when a
      // distant thumbnail loads. Limit concurrent metadata work for long PDFs.
      const dimensions = [];
      for (let start = 1; start <= document.numPages; start += 16) {
        if (cancelled) return;
        const batch = await Promise.all(Array.from({ length: Math.min(16, document.numPages - start + 1) }, async (_, index) => {
          const page = await document.getPage(start + index);
          const viewport = page.getViewport({ scale: 1 });
          return { number: start + index, ratio: viewport.height / viewport.width };
        }));
        dimensions.push(...batch);
      }
      if (!cancelled) {
        setPages(dimensions);
      }
    }).catch((reason) => {
      if (cancelled) return;
      if (reason?.name !== 'PasswordException' && onSourceError?.()) return;
      setError(reason?.name === 'PasswordException' ? 'pdfPasswordProtected' : 'pdfLoadError');
    });
    return () => {
      cancelled = true;
      void task.destroy().catch(() => {});
    };
  }, [url, onSourceError]);

  useEffect(() => {
    const sidebar = thumbnailsRef.current;
    const active = sidebar?.children[pageNumber - 1];
    if (!active) return;
    const item = active.getBoundingClientRect();
    const bounds = sidebar.getBoundingClientRect();
    if (item.top < bounds.top || item.bottom > bounds.bottom) {
      sidebar.scrollTo({ top: sidebar.scrollTop + item.top - bounds.top - (sidebar.clientHeight - item.height) / 2 });
    }
  }, [pageNumber, sidebarOpen]);

  const goToPage = (number) => {
    if (pdfViewerRef.current) pdfViewerRef.current.currentPageNumber = number;
  };

  const changeZoom = (nextZoom) => {
    const viewer = pdfViewerRef.current;
    if (!viewer || !pdf) return;
    if (nextZoom === 1) viewer.currentScaleValue = 'page-width';
    else viewer.currentScale *= nextZoom / zoom;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  };

  return (
    <DocumentViewerFrame url={url} title={title} onOpenOriginal={onOpenOriginal} onDownload={onDownload} downloading={downloading} actionError={actionError} pageNumber={pageNumber} pageCount={pdf?.numPages || 0} zoom={zoom} onZoomChange={changeZoom}
      onPageChange={goToPage} sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen((open) => !open)} thumbnailsRef={thumbnailsRef} viewportRef={viewportRef}
      thumbnails={pdf && pages.map((page) => (
        <DocumentThumbnail key={page.number} number={page.number} total={pdf.numPages} active={pageNumber === page.number} onClick={() => goToPage(page.number)}>
          <PdfThumbnailPage pdf={pdf} page={page} rootRef={thumbnailsRef} onError={setError} />
        </DocumentThumbnail>
      ))}
    >
        <div ref={containerRef} className="drivex-pdf-container absolute inset-0 overflow-auto overscroll-contain" aria-label={title}>
          <div ref={viewerElementRef} className="pdfViewer" />
        </div>
        {error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#262626] p-6 text-center text-sm text-zinc-200">
            <p>{t(`documents.${error}`)}</p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-zinc-500 bg-zinc-700 px-4 py-2 font-medium"><RotateCw className="h-4 w-4" />{t('documents.retryPdf')}</button>
          </div>
        ) : !pdf && <div className="pointer-events-none absolute inset-0"><PdfLoading /></div>}
    </DocumentViewerFrame>
  );
}

function PdfThumbnailPage({ pdf, page, rootRef, onError }) {
  const { t } = useTranslation();
  const width = 120;
  const frameRef = useRef(null);
  const hostRef = useRef(null);
  const [nearby, setNearby] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: rootRef.current,
      rootMargin: '200px',
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!nearby) return;
    let cancelled = false;
    let renderTask;
    const canvas = document.createElement('canvas');
    const host = hostRef.current;
    const render = async () => {
      const pdfPage = await pdf.getPage(page.number);
      if (cancelled) return;
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width / baseViewport.width });
      // Thumbnails are previews; full-resolution text comes from PDFViewer.
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.className = 'block bg-white';
      renderTask = pdfPage.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await renderTask.promise;
      if (!cancelled) {
        host.replaceChildren(canvas);
        setReady(true);
      }
    };
    void render().catch((reason) => {
      if (!cancelled && reason?.name !== 'RenderingCancelledException') onError('pdfLoadError');
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      setReady(false);
    };
  }, [pdf, page.number, nearby, onError]);

  return (
    <div ref={frameRef} style={{ width, height: width * page.ratio }} className="relative shrink-0 bg-white shadow-lg" aria-hidden="true" aria-busy={!ready}>
      {!ready && nearby && <div className="absolute inset-0 flex items-center justify-center text-zinc-500"><LoaderCircle className="h-5 w-5 animate-spin" aria-label={t('documents.loadingPdf')} /></div>}
      <div ref={hostRef} />
    </div>
  );
}

function PdfLoading() {
  const { t } = useTranslation();
  return <div role="status" className="flex min-h-full items-center justify-center gap-2 p-8 text-sm text-zinc-300"><LoaderCircle className="h-5 w-5 animate-spin" />{t('documents.loadingPdf')}</div>;
}
