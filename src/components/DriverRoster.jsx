import React, { useState } from 'react';
import { 
  MapPin, 
  MessageSquare,
  Plus, 
  Search,
} from 'lucide-react';
import KanbanBoard from './KanbanBoard';

export default function DriverRoster({
  drivers,
  loads,
  onAssignLoad,
  onOpenDocs,
  onDeleteLoad,
  onDropOnOffer,
  isAiProcessing,
  selectedDriverId,
  onSelectDriver,
  onOpenChat,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const openDriver = (driverId) => {
    onSelectDriver(driverId);
  };

  const availableDriversCount = drivers.filter(d => !loads.some(l => l.driverId === d.id && l.status !== 'COMPLETED')).length;
  const onDutyDriversCount = drivers.length - availableDriversCount;

  const filteredDrivers = drivers.filter(driver => {
    const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');
    
    // Status filter
    if (statusFilter === 'AVAILABLE' && activeLoad) return false;
    if (statusFilter === 'ON_LOAD' && !activeLoad) return false;

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      driver.name.toLowerCase().includes(q) ||
      (driver.truck && driver.truck.toLowerCase().includes(q)) ||
      (driver.trailer && driver.trailer.toLowerCase().includes(q)) ||
      (driver.currentLocation && driver.currentLocation.toLowerCase().includes(q)) ||
      (driver.driverNumber && driver.driverNumber.toLowerCase().includes(q)) ||
      (activeLoad && activeLoad.loadNumber.toLowerCase().includes(q))
    );
  });

  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);

  if (selectedDriver) {
    const driverLoads = loads.filter((load) => (
      load.driverId === selectedDriver.id
      || load.targetDriverIds?.includes(selectedDriver.id)
    ));

    return (
      <DriverLoadWorkspace
        driver={selectedDriver}
        loads={driverLoads}
        drivers={drivers}
        onOpenChat={onOpenChat}
        onOpenDocs={onOpenDocs}
        onDeleteLoad={onDeleteLoad}
        onDropOnOffer={onDropOnOffer}
        isAiProcessing={isAiProcessing}
      />
    );
  }

  return (
    <div className="w-full space-y-6 pb-12">
      {/* Filters & Search Row */}
      <div className="driver-list-toolbar">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Haydovchi yoki joylashuv..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
          />
        </div>

        <div className="driver-list-actions">
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 text-xs font-bold">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Barchasi ({drivers.length})
          </button>
          <button
            onClick={() => setStatusFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'AVAILABLE'
                ? 'bg-white dark:bg-zinc-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Bo'sh ({availableDriversCount})
          </button>
          <button
            onClick={() => setStatusFilter('ON_LOAD')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ON_LOAD'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Yukda ({onDutyDriversCount})
          </button>
          </div>
        </div>
      </div>

      {/* Full-Width Clean Table — No Card Box */}
      <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="py-3.5 px-4">Haydovchi</th>
              <th className="py-3.5 px-4">Joylashuv</th>
              <th className="py-3.5 px-4">HOS Qoldig'i</th>
              <th className="py-3.5 px-4">Faol Reys</th>
              <th className="py-3.5 px-4 text-right">Harakat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-zinc-400 font-medium">
                  Haydovchilar topilmadi
                </td>
              </tr>
            ) : (
              filteredDrivers.map((driver) => {
                const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');

                return (
                  <tr 
                    key={driver.id} 
                    role="button"
                    tabIndex={0}
                    onClick={() => openDriver(driver.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDriver(driver.id);
                      }
                    }}
                    className="driver-row hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    aria-label={`${driver.name} ma’lumotlarini ochish`}
                  >
                    {/* Driver Info */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="relative w-11 h-11 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-sm text-zinc-800 dark:text-zinc-200 flex-shrink-0">
                          {driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}
                          {driver.avatar && (
                            <img
                              src={driver.avatar}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              onError={(event) => { event.currentTarget.style.display = 'none'; }}
                            />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-1.5 whitespace-nowrap">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{driver.name}</span>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber}</span> • <span>{driver.phone}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="py-3.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5 text-sm">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{driver.currentLocation}</span>
                      </div>
                    </td>

                    {/* HOS */}
                    <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {driver.hos.driveLeft} <span className="text-xs text-zinc-400 font-normal">Drive</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-normal mt-0.5">
                        {driver.hos.shiftLeft} Shft • {driver.hos.cycleLeft} Cyc
                      </div>
                    </td>

                    {/* Active Load */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {activeLoad ? (
                        <div className="font-mono">
                          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {activeLoad.loadNumber}
                            {Number(activeLoad.rate) > 0 && ` • $${Number(activeLoad.rate).toLocaleString('en-US')}`}
                          </div>
                          <div className="text-xs text-zinc-500 truncate max-w-[170px] mt-0.5">
                            {activeLoad.origin.city} ➔ {activeLoad.destination.city}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                          ✓ Bo'sh (Tayyor)
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            onAssignLoad(driver);
                          }}
                          className="inline-flex items-center space-x-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                          title={activeLoad ? 'Qo‘shimcha yuk tayinlash' : 'Yangi yuk tayinlash'}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{activeLoad ? 'Qo‘shimcha yuk' : 'Yuk berish'}</span>
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function DriverLoadWorkspace({
  driver,
  loads,
  drivers,
  onOpenChat,
  onOpenDocs,
  onDeleteLoad,
  onDropOnOffer,
  isAiProcessing,
}) {
  const activeLoads = loads.filter((load) => load.status !== 'COMPLETED').length;

  return (
    <div className="driver-workspace space-y-5 pb-12">
      <div className="driver-detail-header">
        <div className="driver-detail-identity">
          <span className="driver-detail-avatar relative overflow-hidden">
            {driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}
            {driver.avatar && (
              <img
                src={driver.avatar}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => { event.currentTarget.style.display = 'none'; }}
              />
            )}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2>{driver.name}</h2>
            </div>
            <p>{driver.driverNumber} <span>•</span> {driver.phone}</p>
          </div>
        </div>

        <div className="driver-detail-meta">
          <div><span>Faol reyslar</span><strong>{activeLoads}</strong></div>
        </div>

        <button type="button" onClick={() => onOpenChat(driver)} className="primary-button">
          <MessageSquare size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </div>

        <KanbanBoard
          loads={loads}
          drivers={drivers}
          onOpenDocs={onOpenDocs}
          onDeleteLoad={onDeleteLoad}
          onDropOnOffer={onDropOnOffer}
          isAiProcessing={isAiProcessing}
        />
    </div>
  );
}
