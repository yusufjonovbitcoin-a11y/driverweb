import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  X, 
  Sparkles, 
  Send, 
  Search,
  FileImage,
  TriangleAlert,
} from 'lucide-react';
import { formatCurrency } from '../i18n/format';
import DriverBriefPreview from './DriverBriefPreview';
import { briefFieldLabel } from '../services/driverBrief';
import { hasLoadDocument } from '../services/loadDocumentAvailability.js';

const FIELD_LABELS = {
  'broker.contactName': 'missingFields.brokerContact',
  'broker.phone': 'missingFields.brokerPhone',
  'pickup.appointmentFrom': 'missingFields.pickupTime',
  'pickup.appointment': 'missingFields.pickupTime',
  'pickup.appointmentTo': 'missingFields.pickupTimeRange',
  'pickup.contactName': 'missingFields.pickupContact',
  'pickup.contactPhone': 'missingFields.pickupPhone',
  'delivery.appointmentFrom': 'missingFields.deliveryTime',
  'delivery.appointment': 'missingFields.deliveryTime',
  'delivery.appointmentTo': 'missingFields.deliveryTimeRange',
  'delivery.contactName': 'missingFields.deliveryContact',
  'delivery.contactPhone': 'missingFields.deliveryPhone',
  brokerRate: 'missingFields.rate',
  loadedMiles: 'missingFields.distance',
  equipmentType: 'missingFields.equipment',
  weightLbs: 'missingFields.weight',
};

export default function QuickDriverModal({ 
  isOpen, 
  onClose, 
  loadData, 
  drivers, 
  initialDriverId = null,
  onOpenDocs,
  onConfirm 
}) {
  const { t } = useTranslation();
  const [selectedDriverIds, setSelectedDriverIds] = useState(() => initialDriverId ? [initialDriverId] : []);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submittingRef = useRef(false);
  const warningFields = [...new Set([
    ...(loadData?.review?.blockingFields || []), ...(loadData?.review?.warningFields || []),
  ])];
  const reviewRequired = loadData?.review?.required === true;
  const missingFields = loadData?.missingFields || [];
  const isReassignment = ['assigned', 'in_progress'].includes(loadData?.lifecycleStatus);
  const isClosed = Boolean(loadData?.lifecycleStatus) && ![
    'ready_for_offer',
    'offered',
    'assigned',
    'in_progress',
    ...(reviewRequired || loadData?.source === 'saved' ? ['review', 'draft'] : []),
  ].includes(loadData.lifecycleStatus);

  if (!isOpen || !loadData) return null;

  const toggleDriver = (id) => {
    setSelectedDriverIds((current) => current[0] === id ? [] : [id]);
  };

  const availableDrivers = isReassignment
    ? drivers.filter((driver) => driver.id !== loadData.currentDriverId)
    : drivers;
  const fixedDriver = initialDriverId ? availableDrivers.find(driver => driver.id === initialDriverId) : null;
  const effectiveDriverIds = initialDriverId ? (fixedDriver ? [fixedDriver.id] : [])
    : selectedDriverIds.filter(id => availableDrivers.some(driver => driver.id === id));
  const filteredDrivers = availableDrivers.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      (d.truck && d.truck.toLowerCase().includes(q)) ||
      (d.currentLocation && d.currentLocation.toLowerCase().includes(q))
    );
  });

  const handleSend = async (e) => {
    e.preventDefault();
    if (effectiveDriverIds.length === 0 || submittingRef.current || isClosed) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const result = await onConfirm(effectiveDriverIds);
      if (result !== true) setSubmitError(typeof result === 'string' ? result : t('errors.createLoad'));
    } catch {
      setSubmitError(t('errors.createLoad'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div role="dialog" aria-modal="true" aria-label={t('loads.aiPreparedTitle')} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base lg:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                {isReassignment ? t('loads.reassign') : loadData.source === 'saved' ? t('loads.savedTitle') : t('loads.aiPreparedTitle')}
              </h2>
              <p className="text-xs lg:text-sm text-zinc-400">
                {isReassignment
                  ? t('loads.reassignHint')
                  : initialDriverId ? t('loads.assignToDriver') : t('loads.selectDriver')}
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label={t('common.close')}
            disabled={isSubmitting}
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSend} className="p-6 space-y-4 overflow-y-auto min-h-0">
          
          {/* AI Parsed Summary Card */}
          <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm lg:text-base font-bold text-zinc-900 dark:text-zinc-100">
                <span>{loadData.origin.city}, {loadData.origin.state}</span>
                <span>➔</span>
                <span>{loadData.destination.city}, {loadData.destination.state}</span>
              </div>
              <span className="font-mono font-extrabold text-base lg:text-lg text-zinc-900 dark:text-zinc-100">
                {loadData.rate == null || loadData.rateKnown === false ? '—' : formatCurrency(loadData.rate)}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs lg:text-sm text-zinc-500 font-medium">
              <span>{loadData.equipment || '—'}{loadData.distanceMiles != null && loadData.distanceKnown !== false ? ` • ${loadData.distanceMiles} mi` : ''}</span>
              {loadData.source !== 'saved' && <span className="flex items-center space-x-1.5 text-blue-600 dark:text-blue-400 font-bold">
                <FileImage className="w-4 h-4" />
                <span className="truncate max-w-[140px]">{loadData.fileName || t('loads.imageAttached')}</span>
              </span>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {loadData.temperatureFahrenheit != null && (
                <span>{loadData.temperatureFahrenheit}°F</span>
              )}
              {loadData.palletCount != null && <span>{t('loads.palletCount', { count: loadData.palletCount })}</span>}
              {loadData.freightMode && <span>{loadData.freightMode}</span>}
          {loadData.isHazmat === false && <span>{t('loads.nonHazmat')}</span>}
            </div>
            {!loadData.driverBrief && loadData.requirements?.length > 0 && (
              <div className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                <span className="font-bold">{t('loads.requirements')}:</span> {loadData.requirements.join(' • ')}
              </div>
            )}
          </div>

          {loadData.driverBrief && <DriverBriefPreview brief={loadData.driverBrief}
            sourceUrl={loadData.sourceUrl || loadData.documents?.rateCon}
            onOpenSource={onOpenDocs && hasLoadDocument(loadData, 'rateCon') ? () => onOpenDocs(loadData, 'rateCon') : undefined} />}
          {warningFields.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">{t('driverBrief.warning')}</p>
            <p className="mt-1">{warningFields.map(key => briefFieldLabel(t, key)).join(', ')}</p>
          </div>}

          {missingFields.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-bold">{t('loads.missingFields')}</div>
                <div className="mt-1 leading-relaxed">
                  {missingFields.map((field) => FIELD_LABELS[field] ? t(FIELD_LABELS[field]) : field).join(', ')}.
                </div>
              </div>
            </div>
          )}

          {isClosed && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              {t('loads.closedCannotOffer')}
            </div>
          )}

          {initialDriverId ? <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-zinc-500">{t('loads.assignToDriver')}</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{fixedDriver?.name || t('loadsWorkspace.missingDriver')}</p>
          </div> : <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-zinc-800 dark:text-zinc-200">
                {t('loads.selectDriver')}
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('drivers.searchPlaceholder')}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl pl-9 pr-8 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Driver List */}
            <div role="radiogroup" aria-label={t('loads.selectDriver')} className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-400 font-medium">
                  {searchQuery
                    ? t('drivers.noSearchResults', { query: searchQuery })
                    : isReassignment
                      ? t('drivers.noReassignmentDriver')
                      : t('drivers.noActiveDriver')}
                </div>
              ) : (
                filteredDrivers.map((driver) => {
                  const isSelected = selectedDriverIds.includes(driver.id);
                  const truckModel = driver.truck ? driver.truck.split('(')[0].trim() : t('common.notProvided');
                  const city = driver.currentLocation ? driver.currentLocation.split(',')[0].trim() : t('common.offline');

                  return (
                    <div
                      key={driver.id}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onClick={() => toggleDriver(driver.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleDriver(driver.id);
                        }
                      }}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 font-bold'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-zinc-600 dark:text-zinc-400 font-medium'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                          isSelected 
                            ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-950' 
                            : 'border-zinc-300 dark:border-zinc-700'
                        }`}>
                          {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </div>
                        <div className="truncate">
                          <span className="font-bold text-sm lg:text-base text-zinc-900 dark:text-zinc-100 mr-2">
                            {driver.name}
                          </span>
                          <span className="text-xs font-mono text-zinc-400">
                            {truckModel} • {city}
                          </span>
                        </div>
                      </div>

                      <div className="text-sm font-mono text-emerald-600 dark:text-emerald-400 font-bold ml-2 flex-shrink-0">
                        {driver.hos?.driveLeft}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>}

          {submitError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{submitError}</p>}

          {/* Footer */}
          <div className="pt-3.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium">
              {t('loads.selected', { count: effectiveDriverIds.length })}
            </span>

            <div className="flex items-center space-x-2.5">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={effectiveDriverIds.length === 0 || isSubmitting || isClosed}
                className="inline-flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 px-5 py-2 rounded-xl font-bold text-sm transition-colors shadow-xs"
              >
                <Send className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? t('loads.sending')
                    : isReassignment
                    ? t('loads.reassign')
                    : t('loads.assignToDriver')}
                </span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
}
