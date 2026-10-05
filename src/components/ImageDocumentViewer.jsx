import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DocumentViewerFrame, { DocumentThumbnail } from './DocumentViewerFrame';

export default function ImageDocumentViewer({ url, title, onOpenOriginal, onRetrySource, ...actions }) {
  const [attempt, setAttempt] = useState(0);
  return <ImageSession key={`${url}:${attempt}`} url={url} title={title} onOpenOriginal={onOpenOriginal} {...actions} onRetry={onRetrySource || (() => setAttempt((value) => value + 1))} />;
}

function ImageSession({ url, title, onRetry, onOpenOriginal, onSourceError, onDownload, downloading, actionError }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  const viewportRef = useRef(null);
  const thumbnailsRef = useRef(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.floor(entry.contentRect.width - 32))));
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <DocumentViewerFrame url={url} title={title} onOpenOriginal={onOpenOriginal} onDownload={onDownload} downloading={downloading} actionError={actionError} pageNumber={1} pageCount={loaded ? 1 : 0} zoom={zoom} onZoomChange={setZoom}
      onPageChange={() => viewportRef.current?.scrollTo({ top: 0, left: 0 })}
      sidebarOpen={sidebarOpen} onSidebarToggle={() => setSidebarOpen((open) => !open)} thumbnailsRef={thumbnailsRef} viewportRef={viewportRef}
      thumbnails={loaded && <DocumentThumbnail number={1} total={1} active onClick={() => viewportRef.current?.scrollTo({ top: 0, left: 0 })}><img src={url} alt="" className="block h-auto w-[120px] bg-white" /></DocumentThumbnail>}
    >
      {failed ? (
        <div role="alert" className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center text-sm text-zinc-200">
          <p>{t('documents.imageLoadError')}</p>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-zinc-500 bg-zinc-700 px-4 py-2 font-medium"><RotateCw className="h-4 w-4" />{t('documents.retryPdf')}</button>
        </div>
      ) : (
        <>
          {!loaded && <div role="status" className="flex min-h-full items-center justify-center gap-2 text-sm text-zinc-300"><LoaderCircle className="h-5 w-5 animate-spin" />{t('documents.loadingImage')}</div>}
          <img src={url} alt={title} onLoad={() => setLoaded(true)} onError={() => { if (!onSourceError?.()) setFailed(true); }} style={{ width: Math.floor(width * zoom), maxWidth: 'none' }} className={`mx-auto h-auto bg-white shadow-lg ${loaded ? 'block' : 'hidden'}`} />
        </>
      )}
    </DocumentViewerFrame>
  );
}
