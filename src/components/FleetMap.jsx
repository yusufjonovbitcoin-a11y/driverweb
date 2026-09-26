import React, { useState } from 'react';
import { LocateFixed, MapPin, Truck } from 'lucide-react';

const fallbackCenter = { lat: 39.6542, lng: 66.9597 };

function hasCoordinates(driver) {
  return Number.isFinite(driver?.lat) && Number.isFinite(driver?.lng);
}

function stopAddress(stop) {
  return [stop?.address, stop?.city, stop?.state, stop?.postalCode].filter(Boolean).join(', ');
}

export default function FleetMap({ drivers, loads }) {
  const [selectedTruckId, setSelectedTruckId] = useState(drivers[0]?.id || null);
  const selectedDriver = drivers.find((driver) => driver.id === selectedTruckId) || drivers[0];
  const driverLoad = loads.find((load) => (
    (load.driverId === selectedDriver?.id || load.targetDriverIds?.includes(selectedDriver?.id))
    && load.status !== 'COMPLETED'
  ));
  const center = hasCoordinates(selectedDriver)
    ? { lat: selectedDriver.lat, lng: selectedDriver.lng }
    : fallbackCenter;
  const pickupAddress = stopAddress(driverLoad?.origin);
  const deliveryAddress = stopAddress(driverLoad?.destination);
  const mapUrl = pickupAddress && deliveryAddress
    ? `https://www.google.com/maps?output=embed&f=d&source=s_d&saddr=${encodeURIComponent(pickupAddress)}&daddr=${encodeURIComponent(deliveryAddress)}&dirflg=d`
    : `https://www.google.com/maps?q=${center.lat},${center.lng}&z=${hasCoordinates(selectedDriver) ? 13 : 6}&output=embed`;

  return (
    <div className="fleet-map-workspace h-[calc(100dvh-80px)] w-full">
      <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3 lg:h-full">
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
            <div className="absolute left-4 top-4 z-10 w-[min(360px,calc(100%-2rem))] rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-600" />
                <strong className="text-sm">{selectedDriver.name}</strong>
                {driverLoad && (
                  <span className="ml-auto text-xs font-bold text-blue-600">
                    {driverLoad.loadNumber} · {driverLoad.distanceMiles || 0} mi
                  </span>
                )}
              </div>
              {driverLoad ? (
                <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <RouteStop marker="A" label="Pickup" stop={driverLoad.origin} />
                  <RouteStop marker="B" label="Delivery" stop={driverLoad.destination} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">{selectedDriver.driverNumber} · {selectedDriver.currentLocation}</p>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-2">
          <div className="px-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Mashinalar ro‘yxati</div>
          {drivers.length === 0 && <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">Driver topilmadi.</div>}
          {drivers.map((driver) => {
            const selected = driver.id === selectedDriver?.id;
            return (
              <button key={driver.id} type="button" onClick={() => setSelectedTruckId(driver.id)} className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30' : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-bold text-sm">{driver.name}</span><span className={`w-2.5 h-2.5 rounded-full ${hasCoordinates(driver) ? 'bg-emerald-500' : 'bg-zinc-300'}`} /></div>
                <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500"><LocateFixed className="w-3.5 h-3.5" />{driver.currentLocation}</div>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function RouteStop({ marker, label, stop }) {
  const address = stopAddress(stop);
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${marker === 'A' ? 'bg-teal-600' : 'bg-red-500'}`}>
        {marker}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{stop?.facility || `${stop?.city || '—'}${stop?.state ? `, ${stop.state}` : ''}`}</p>
        {address && <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400"><MapPin className="mr-1 inline h-3 w-3" />{address}</p>}
      </div>
    </div>
  );
}
