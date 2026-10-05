import { useMemo, useRef, useState } from 'react';
import { FileUp, LoaderCircle, Package, UploadCloud, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import KanbanBoard from './KanbanBoard';
import { summarizeWorkspaceLoads } from './loadWorkspaceModel';
import './loads-workspace.css';

// The fleet board shares the driver's trip cards, but never narrows the source
// data to one driver. Filtering belongs to the board, not this overview.
export default function LoadsWorkspace({ loads, drivers, onDropOnOffer, isAiProcessing = false, ...boardProps }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const summary = useMemo(() => summarizeWorkspaceLoads(loads), [loads]);
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files')
    || Boolean(event.dataTransfer?.files?.length);
  const resetDrag = () => { dragDepthRef.current = 0; setIsFileDragging(false); };
  return (
    <div className="driver-trips-view fleet-loads-view"
      onDragEnterCapture={event => {
        if (!onDropOnOffer || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        dragDepthRef.current += 1;
        if (!isAiProcessing) setIsFileDragging(true);
      }}
      onDragOverCapture={event => {
        if (!onDropOnOffer || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = isAiProcessing ? 'none' : 'copy';
      }}
      onDragLeaveCapture={event => {
        if (!onDropOnOffer || !isFileDrag(event)) return;
        event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setIsFileDragging(false);
      }}
      onDropCapture={event => {
        if (!onDropOnOffer || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        resetDrag();
        const file = event.dataTransfer.files?.[0];
        if (file && !isAiProcessing) onDropOnOffer(file);
      }}
      onDragEnd={resetDrag}
    >
      {isFileDragging && <div className="driver-trip-drop-overlay" aria-hidden="true">
        <UploadCloud size={42} /><strong>{t('drivers.pdfDropTitle')}</strong><span>{t('loads.aiDropHint')}</span>
      </div>}
      <section className="driver-trip-summary fleet-loads-summary" aria-label={t('loadsWorkspace.title')}>
        <div className="fleet-loads-identity">
          <span className="fleet-loads-icon"><Package size={25} strokeWidth={1.7} /></span>
          <div><h1>{t('loadsWorkspace.title')}</h1><p><UsersRound size={14} />{t('loadsWorkspace.driversCount')}: {summary.driverCount}</p></div>
        </div>
        <div className="driver-trip-stats fleet-loads-stats">
          <div><span>{t('loadsWorkspace.totalLoads')}</span><strong>{summary.total}</strong></div>
          <div><span>{t('loadsWorkspace.activeLoads')}</span><strong>{summary.active}</strong></div>
          <div><span>{t('loadsWorkspace.unassignedLoads')}</span><strong>{summary.unassigned}</strong></div>
          <div><span>{t('loadsWorkspace.completedLoads')}</span><strong>{summary.completed}</strong></div>
        </div>
        {onDropOnOffer && <div className="fleet-loads-import">
          <button type="button" className="driver-trip-add" disabled={isAiProcessing} onClick={() => fileInputRef.current?.click()}>
            {isAiProcessing ? <LoaderCircle size={18} className="animate-spin" /> : <FileUp size={18} />}
            {isAiProcessing ? t('common.loading') : t('loadsWorkspace.importPdf')}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={isAiProcessing} aria-label={t('loadsWorkspace.importPdf')} onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file && !isAiProcessing) onDropOnOffer(file);
          }} />
        </div>}
      </section>
      <section className="driver-trips-content" aria-label={t('loadsWorkspace.boardTitle')}>
        <KanbanBoard {...boardProps} loads={loads} drivers={drivers} onDropOnOffer={onDropOnOffer} isAiProcessing={isAiProcessing}
          includeUnassigned={loads.some(load => load.status === 'UNASSIGNED')} groupDeliveredWithOnRoad
          fleetWorkspace boardOnly hideStageFilters />
      </section>
    </div>
  );
}
