import React, { useMemo, useState } from 'react';
import { LocateFixed, MapPin, Radio, Truck } from 'lucide-react';

const fallbackCenter = { lat: 39.6542, lng: 66.9597 };

function hasCoordinates(driver) {
  return Number.isFinite(driver?.lat) && Number.isFinite(driver?.lng);
}

export default function FleetMap({ drivers, loads }) {
  const [selectedTruckId, setSelectedTruckId] = useState(drivers[0]?.id || null);
  const selectedDriver = drivers.find((driver) => driver.id === selectedTruckId) || drivers[0];
  const driverLoad = loads.find((load) => load.driverId === selectedDriver?.id && load.status !== 'COMPLETED');
  const locatedDrivers = useMemo(() => drivers.filter(hasCoordinates), [drivers]);
  const center = hasCoordinates(selectedDriver)
    ? { lat: selectedDriver.lat, lng: selectedDriver.lng }
    : fallbackCenter;
  const mapUrl = `https://www.google.com/maps?q=${center.lat},${center.lng}&z=${hasCoordinates(selectedDriver) ? 13 : 6}&output=embed`;

  return (
    <div className="w-full space-y-6 pb-12">
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">Flot telematikasi va xarita</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Google Maps orqali real vaqtdagi driver joylashuvi</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800/40">
            <Radio className="w-3.5 h-3.5" />
            {locatedDrivers.length} ta GPS online
          </span>
          <span className="text-zinc-500">Jami: <strong className="text-zinc-900 dark:text-zinc-100">{drivers.length}</strong></span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 h-[560px] relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shadow-sm">
          <iframe
            key={mapUrl}
            title="Google Maps flot xaritasi"
            src={mapUrl}
            className="absolute inset-0 w-full h-full border-0"
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />

          {selectedDriver && (
            <div className="absolute left-4 top-4 z-10 max-w-xs rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
              <div className="flex items-center gap-2"><Truck className="w-4 h-4 text-blue-600" /><strong className="text-sm">{selectedDriver.name}</strong></div>
              <p className="mt-1 text-xs text-zinc-500">{selectedDriver.driverNumber} · {selectedDriver.currentLocation}</p>
              {driverLoad && <p className="mt-2 text-xs font-semibold text-blue-600">{driverLoad.loadNumber}: {driverLoad.origin.city} → {driverLoad.destination.city}</p>}
            </div>
          )}

          <div className="absolute left-4 bottom-4 z-10 inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-zinc-700 shadow-md backdrop-blur dark:bg-zinc-900/95 dark:text-zinc-200">
            <MapPin className="w-3.5 h-3.5 text-red-500" /> Google Maps
          </div>
        </div>

        <aside className="space-y-2">
          <div className="px-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Mashinalar ro‘yxati</div>
          {drivers.length === 0 && <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">Driver topilmadi.</div>}
          {drivers.map((driver) => {
            const selected = driver.id === selectedDriver?.id;
            return (
              <button key={driver.id} type="button" onClick={() => setSelectedTruckId(driver.id)} className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30' : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-bold text-sm">{driver.name}</span><span className={`w-2.5 h-2.5 rounded-full ${hasCoordinates(driver) ? 'bg-emerald-500' : 'bg-zinc-300'}`} /></div>
                <p className="text-xs text-zinc-500 mt-1">{driver.driverNumber} · {driver.truck}</p>
                <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500"><LocateFixed className="w-3.5 h-3.5" />{driver.currentLocation}</div>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
