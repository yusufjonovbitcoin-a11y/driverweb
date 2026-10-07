import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileUp, LoaderCircle, Package, Trash2, UploadCloud, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import KanbanBoard from './KanbanBoard';
import LoadTrashPanel from './LoadTrashPanel';
import SavedLoadRecovery from './SavedLoadRecovery';
import { recoverableLoads } from '../services/savedLoadRecovery.js';
import { summarizeWorkspaceLoads } from './loadWorkspaceModel';
import './loads-workspace.css';

const EMPTY_TRASH = [];

// The fleet board shares the driver's trip cards, but never narrows the source
// data to one driver. Filtering belongs to the board, not this overview.
export default function LoadsWorkspace({ loads, drivers, trashedLoads = EMPTY_TRASH, onRestoreLoad, onPermanentlyDeleteLoad,
  onDropOnOffer, isAiProcessing = false, recoveryRequest = 0, recoveryLoads = loads, ...boardProps }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTrashBusy, setIsTrashBusy] = useState(false);
  // Legacy drafts and offers stay in storage, outside the dispatched-load board.
  const boardLoads = useMemo(() => loads.filter(load => load.status !== 'UNASSIGNED'), [loads]);
  const summary = useMemo(() => summarizeWorkspaceLoads(boardLoads), [boardLoads]);
  const savedLoads = useMemo(() => recoverableLoads(recoveryLoads), [recoveryLoads]);
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files')
    || Boolean(event.dataTransfer?.files?.length);
  const resetDrag = () => { dragDepthRef.current = 0; setIsFileDragging(false); };
  return (
    <div className="driver-trips-view fleet-loads-view"
      onDragEnterCapture={event => {
        if ((!onDropOnOffer && !isTrashOpen) || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        if (isTrashOpen) return;
        dragDepthRef.current += 1;
        if (!isAiProcessing) setIsFileDragging(true);
      }}
      onDragOverCapture={event => {
        if ((!onDropOnOffer && !isTrashOpen) || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = isAiProcessing || isTrashOpen ? 'none' : 'copy';
      }}
      onDragLeaveCapture={event => {
        if ((!onDropOnOffer && !isTrashOpen) || !isFileDrag(event)) return;
        event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setIsFileDragging(false);
      }}
      onDropCapture={event => {
        if ((!onDropOnOffer && !isTrashOpen) || !isFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        resetDrag();
        const file = event.dataTransfer.files?.[0];
        if (file && !isAiProcessing && !isTrashOpen) onDropOnOffer(file);
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
          <div><span>{t('loadsWorkspace.completedLoads')}</span><strong>{summary.completed}</strong></div>
        </div>
        <div className="fleet-loads-actions">
          <button type="button" className="fleet-loads-trash-toggle" aria-pressed={isTrashOpen}
            aria-label={t(isTrashOpen ? 'loadTrash.backToLoads' : 'loadTrash.openTrash')}
            title={t(isTrashOpen ? 'loadTrash.backToLoads' : 'loadTrash.openTrash')}
            disabled={isTrashBusy} onClick={() => { resetDrag(); setIsTrashOpen(previous => !previous); }}>
            {isTrashOpen ? <ArrowLeft size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}
            {t(isTrashOpen ? 'loadTrash.backToLoads' : 'loadTrash.title')}
            {!isTrashOpen && <span aria-label={t('loadTrash.countLabel', { count: trashedLoads.length })}>{trashedLoads.length}</span>}
          </button>
          {onDropOnOffer && !isTrashOpen && <div className="fleet-loads-import">
            <button type="button" className="driver-trip-add" disabled={isAiProcessing} onClick={() => fileInputRef.current?.click()}>
              {isAiProcessing ? <LoaderCircle size={18} className="animate-spin" /> : <FileUp size={18} />}
              {isAiProcessing ? t('common.loading') : t('loadsWorkspace.importPdf')}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif" hidden disabled={isAiProcessing} aria-label={t('loadsWorkspace.importPdf')} onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = '';
              if (file && !isAiProcessing) onDropOnOffer(file);
            }} />
          </div>}
        </div>
      </section>
      {!isTrashOpen && <SavedLoadRecovery key={recoveryRequest} initiallyOpen={recoveryRequest > 0} loads={savedLoads}
        onResume={boardProps.onSendOffer} onOpenDocs={boardProps.onOpenDocs} onTrashLoad={boardProps.onTrashLoad} />}
      <section className="driver-trips-content" aria-label={t(isTrashOpen ? 'loadTrash.title' : 'loadsWorkspace.boardTitle')}>
        {isTrashOpen ? <LoadTrashPanel loads={trashedLoads} drivers={drivers} onRestoreLoad={onRestoreLoad}
          onPermanentlyDeleteLoad={onPermanentlyDeleteLoad} onOpenDocs={boardProps.onOpenDocs} onBusyChange={setIsTrashBusy} />
          : <KanbanBoard {...boardProps} loads={boardLoads} drivers={drivers} onDropOnOffer={onDropOnOffer} isAiProcessing={isAiProcessing}
          includeUnassigned={false} groupDeliveredWithOnRoad
          fleetWorkspace boardOnly hideStageFilters />}
      </section>
    </div>
  );
}
