import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDocument } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import DocumentViewerFrame, { DocumentThumbnail } from './DocumentViewerFrame';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfViewer.css';
import { measureDocumentStage } from '../services/documentPerformance.js';
import { formatNumber } from '../i18n/format';
import { prewarmPdfWorker } from './pdfWorker.js';

const assetRoot = `${import.meta.env.BASE_URL}pdfjs/`;

export default function PdfDocumentViewer({ url, title, onOpenOriginal, onRetrySource, ...actions }) {
  const [attempt, setAttempt] = useState(0);
  // A fresh session releases the old worker, canvases and scroll position.
  return <PdfSession key={`${url}:${attempt}`} url={url} title={title} onOpenOriginal={onOpenOriginal} {...actions} onRetry={onRetrySource || (() => setAttempt((value) => value + 1))} />;
}

function PdfSession({ url, loadData, loadPreview, title, onFirstPagePaint, onPreviewPaint, onRetry, onOpenOriginal, onSourceError, onDownload, downloading, actionError, presentation, renderPageOverlay, viewStateRef }) {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState(null);
  const [pages, setPages] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(() => !renderPageOverlay && presentation !== 'workspace' && window.matchMedia('(min-width: 640px)').matches);
  const [overlayHosts, setOverlayHosts] = useState([]);
  const overlayEnabled = Boolean(renderPageOverlay);
  const viewportRef = useRef(null);
  const containerRef = useRef(null);
  const viewerElementRef = useRef(null);
  const pdfViewerRef = useRef(null);
  const linkServiceRef = useRef(null);
  const zoomRef = useRef(1);
  const thumbnailsRef = useRef(null);
  const loadingDeadline = useRef(null);
  const previewScroll = useRef(0);

  useEffect(() => {
    if (!loadPreview || firstPageReady) return;
    const controller = new AbortController(); let objectUrl;
    void loadPreview({ signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl);
    }).catch(() => {}); // A preview failure never prevents opening the original.
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [loadPreview, firstPageReady]);

  useEffect(() => {
    const initialView = viewStateRef?.current;
    zoomRef.current = initialView?.zoom || 1;
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
    const refreshOverlays = () => {
      if (!overlayEnabled) return;
      const hosts = Array.from({ length: viewer.pagesCount }, (_, index) => {
        const page = viewer.getPageView(index).div;
        let host = page.querySelector(':scope > .pdf-custom-overlay');
        if (!host) {
          host = document.createElement('div');
          host.className = 'pdf-custom-overlay';
          page.appendChild(host);
        }
        return host;
      });
      setOverlayHosts(previous => previous.length === hosts.length && previous.every((host, i) => host === hosts[i]) ? previous : hosts);
    };
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width';
      if (zoomRef.current !== 1) viewer.currentScale *= zoomRef.current;
      setZoom(zoomRef.current);
      refreshOverlays();
    }, { signal: controller.signal });
    let restored = false;
    let firstPaint = true;
    const firstPaintTime = measureDocumentStage('first-page-painted');
    eventBus.on('pagerendered', ({ error: renderError }) => {
      if (renderError) {
        clearTimeout(loadingDeadline.current);
        if (!onSourceError?.()) setError('pdfLoadError');
        return;
      }
      if (firstPaint) {
        clearTimeout(loadingDeadline.current);
        firstPaint = false; firstPaintTime(); onFirstPagePaint?.(); setFirstPageReady(true);
        if (previewScroll.current) containerRef.current.scrollTop = previewScroll.current;
      }
      refreshOverlays();
      if (!restored && initialView) {
        containerRef.current.scrollTop = initialView.top;
        containerRef.current.scrollLeft = initialView.left;
        restored = true;
      }
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
  }, [overlayEnabled, viewStateRef, onFirstPagePaint, onSourceError]);

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
    let task;
    const controller = new AbortController();
    const documentTime = measureDocumentStage('worker-download-parse');
    // Start the worker alongside the managed transfer, not after all bytes arrive.
    const loaded = Promise.all([prewarmPdfWorker(), loadData ? loadData({ signal: controller.signal, onProgress: setProgress }) : null]).then(([worker, data]) => {
      if (cancelled) return null;
      task = getDocument({
        ...(data?.url ? data : data ? { data } : { url }),
        worker,
        withCredentials: false,
        isEvalSupported: false,
        cMapUrl: `${assetRoot}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetRoot}standard_fonts/`,
        wasmUrl: `${assetRoot}wasm/`,
        iccUrl: `${assetRoot}iccs/`,
      });
      task.onProgress = setProgress;
      return task.promise;
    });
    // Covers worker initialization and legacy URL loaders as well as transfers.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true; controller.abort(); void task?.destroy().catch(() => {});
      if (!onSourceError?.()) setError('pdfLoadError');
    }, 45_000);
    loadingDeadline.current = timeout;
    loaded.then(async (document) => {
      if (cancelled || !document) return;
      documentTime();
      pdfViewerRef.current?.setDocument(document);
      linkServiceRef.current?.setDocument(document);
      setPdf(document);
      // Read only dimensions first so the scrolling layout never jumps when a
      // distant thumbnail loads. Limit concurrent metadata work for long PDFs.
      const dimensions = [];
      const dimensionsTime = measureDocumentStage('all-page-dimensions');
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
        dimensionsTime();
        setPages(dimensions);
      }
    }).catch((reason) => {
      clearTimeout(timeout);
      if (cancelled) return;
      if (reason?.name !== 'PasswordException' && onSourceError?.()) return;
      setError(reason?.name === 'PasswordException' ? 'pdfPasswordProtected' : 'pdfLoadError');
    });
    return () => {
      cancelled = true;
      clearTimeout(timeout); controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [url, loadData, onSourceError]);

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
    if (viewStateRef) viewStateRef.current = { top: containerRef.current.scrollTop, left: containerRef.current.scrollLeft, zoom: nextZoom };
    setZoom(nextZoom);
  };

  return (
    <DocumentViewerFrame presentation={presentation} url={url} title={title} onOpenOriginal={onOpenOriginal} onDownload={onDownload} downloading={downloading} actionError={actionError} pageNumber={pageNumber} pageCount={pdf?.numPages || 0} zoom={zoom} onZoomChange={changeZoom}
      onPageChange={goToPage} sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen((open) => !open)} thumbnailsRef={thumbnailsRef} viewportRef={viewportRef}
      thumbnails={pdf && firstPageReady && pages.map((page) => (
        <DocumentThumbnail key={page.number} number={page.number} total={pdf.numPages} active={pageNumber === page.number} onClick={() => goToPage(page.number)}>
          <PdfThumbnailPage pdf={pdf} page={page} rootRef={thumbnailsRef} onError={setError} />
        </DocumentThumbnail>
      ))}
    >
        <div ref={containerRef} className="drivex-pdf-container absolute inset-0 overflow-auto overscroll-contain" aria-label={title} onScroll={viewStateRef ? event => { viewStateRef.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, zoom: zoomRef.current }; } : undefined}>
          <div ref={viewerElementRef} className="pdfViewer" />
          {renderPageOverlay && overlayHosts.map((host, index) => createPortal(renderPageOverlay(index + 1), host, String(index)))}
        </div>
        {error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#262626] p-6 text-center text-sm text-zinc-200">
            <p>{t(`documents.${error}`)}</p>
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-zinc-500 bg-zinc-700 px-4 py-2 font-medium"><RotateCw className="h-4 w-4" />{t('documents.retryPdf')}</button>
          </div>
        ) : <>
          {previewUrl && !firstPageReady && <div className="absolute inset-0 overflow-auto bg-[#262626]" onScroll={event => { previewScroll.current = event.currentTarget.scrollTop; }}>
            <img className="mx-auto block h-auto w-full" src={previewUrl} alt={title} onLoad={() => { setPreviewReady(true); onPreviewPaint?.(); }} />
            {previewReady && <span role="status" className="sticky bottom-3 left-3 inline-flex items-center gap-2 rounded bg-zinc-900/90 px-3 py-2 text-xs text-zinc-100"><LoaderCircle size={14} className="animate-spin" />{t('documents.previewLoading')}</span>}
          </div>}
          {!pdf && !previewReady && <div className="pointer-events-none absolute inset-0"><PdfLoading progress={progress} /></div>}
        </>}
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

function PdfLoading({ progress }) {
  const { t } = useTranslation();
  const amount = progress?.loaded > 0 ? progress.total > 0
    ? formatNumber(Math.min(progress.loaded / progress.total, 1), { style: 'percent', maximumFractionDigits: 0 })
    : formatNumber(progress.loaded / 1_000_000, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }) : '';
  return <div role="status" className="flex min-h-full items-center justify-center gap-2 p-8 text-sm text-zinc-300"><LoaderCircle className="h-5 w-5 animate-spin" />{t('documents.loadingPdf')}{amount && <span className="tabular-nums">{amount}</span>}</div>;
}
