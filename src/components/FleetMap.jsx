import React, { useState } from 'react';
import { 
  Truck, 
  Navigation,
  Radio,
  MapPin,
  Clock
} from 'lucide-react';

export default function FleetMap({ drivers, loads, onSelectLoad }) {
  const [selectedTruckId, setSelectedTruckId] = useState(drivers[0]?.id || 'd1');

  const selectedDriver = drivers.find(d => d.id === selectedTruckId) || drivers[0];
  const driverLoad = loads.find(l => l.driverId === selectedDriver.id && l.status !== 'COMPLETED');

  const cityCoordinates = {
    'Seattle, WA': { x: 12, y: 15 },
    'Denver, CO': { x: 42, y: 44 },
    'Chicago, IL': { x: 67, y: 35 },
    'Indianapolis, IN': { x: 70, y: 42 },
    'Dallas, TX': { x: 50, y: 70 },
    'Atlanta, GA': { x: 74, y: 64 },
    'Philadelphia, PA': { x: 86, y: 38 },
    'Charlotte, NC': { x: 80, y: 58 },
  };

  const getPos = (loc) => cityCoordinates[loc] || { x: 50, y: 50 };

  return (
    <div className="w-full space-y-6 pb-12">
      
      {/* Flat Header — No Card Box */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Flot Telematikasi va Xarita
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Real vaqtdagi GPS joylashuv, marshrutlar va drayverlar faoliyati
          </p>
        </div>

        <div className="flex items-center space-x-4 text-xs font-mono">
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800/40">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Jonli GPS Aloqada</span>
          </span>
          <span className="text-zinc-500">
            Faol: <strong className="text-zinc-900 dark:text-zinc-100">{drivers.length} ta tyagach</strong>
          </span>
        </div>
      </div>

      {/* Map + Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        
        {/* Interactive Map Box */}
        <div className="lg:col-span-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl h-[560px] relative overflow-hidden flex flex-col justify-between p-4 shadow-xs">
          
          {/* Background USA Map Blueprint Graphic */}
          <svg className="w-full h-full absolute inset-0 opacity-15 dark:opacity-20 pointer-events-none" viewBox="0 0 1000 600">
            <path
              d="M 120 120 L 300 130 L 600 140 L 750 180 L 880 180 L 920 280 L 850 420 L 780 500 L 520 540 L 400 480 L 220 450 L 100 320 Z"
              fill="none"
              stroke="currentColor"
              className="text-zinc-400 dark:text-zinc-600"
              strokeWidth="1.5"
            />
            <line x1="120" y1="140" x2="680" y2="350" stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="680" y1="350" x2="500" y2="480" stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="740" y1="440" x2="880" y2="280" stroke="currentColor" className="text-zinc-300 dark:text-zinc-700" strokeWidth="1" strokeDasharray="3 3" />
          </svg>

          {/* Route Vectors */}
          <svg className="w-full h-full absolute inset-0 pointer-events-none z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="67" y1="35" x2="50" y2="70" stroke="currentColor" className="text-zinc-400 dark:text-zinc-500" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
            <line x1="74" y1="64" x2="86" y2="38" stroke="currentColor" className="text-zinc-400 dark:text-zinc-500" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
          </svg>

          {/* Truck Nodes on Map */}
          {drivers.map((d) => {
            const pos = getPos(d.currentLocation);
            const isSelected = selectedTruckId === d.id;
            const isDriving = d.dutyStatus === 'DRIVING';

            return (
              <div
                key={d.id}
                onClick={() => setSelectedTruckId(d.id)}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform ${
                  isSelected ? 'scale-110 z-30' : 'hover:scale-105'
                }`}
              >
                <div className={`flex items-center space-x-2 px-2.5 py-1 rounded-md border text-xs font-mono shadow-xs ${
                  isSelected
                    ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-white text-white dark:text-zinc-950 font-bold'
                    : isDriving
                    ? 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200'
                    : 'bg-white/90 dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isDriving ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                  <span>{d.driverNumber}</span>
                </div>
              </div>
            );
          })}

          {/* Top Left Info Box */}
          <div className="relative z-10 bg-white/95 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 max-w-sm text-sm space-y-1.5 shadow-xs">
            <div className="font-semibold text-zinc-900 dark:text-zinc-200 flex items-center space-x-2">
              <Navigation className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              <span>Flot telematikasi (Live GPS)</span>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              Doimiy yangilanish: 10s • Barcha sensorlar me'yorda
            </div>
          </div>

          {/* Bottom Right Detailed Telemetry Card */}
          <div className="relative z-10 self-end bg-white/95 dark:bg-zinc-900/95 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 max-w-sm shadow-md text-sm space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <span className="font-bold text-zinc-900 dark:text-zinc-200 text-sm">{selectedDriver.name}</span>
                <span className="text-xs text-zinc-500 font-mono block mt-0.5">{selectedDriver.truck}</span>
              </div>
              <span className="text-xs font-mono font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">
                {selectedDriver.dutyStatus}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
              <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80">
                <span className="text-zinc-500 block text-xs">Joylashuv:</span>
                <span className="text-zinc-900 dark:text-zinc-200 truncate block font-semibold mt-0.5">{selectedDriver.currentLocation}</span>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80">
                <span className="text-zinc-500 block text-xs">HOS qoldi:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold block mt-0.5">{selectedDriver.hos.driveLeft}</span>
              </div>
            </div>

            {driverLoad ? (
              <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800/80 text-xs">
                <div className="flex justify-between items-center text-zinc-800 dark:text-zinc-300 font-mono font-semibold">
                  <span>{driverLoad.loadNumber}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">${driverLoad.rate}</span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-1">
                  {driverLoad.origin.city} ➔ {driverLoad.destination.city} ({driverLoad.distanceMiles} mi)
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 text-center py-1 font-mono">
                Bo'sh (Yangi yuk kutmoqda)
              </div>
            )}
          </div>

        </div>

        {/* Right Sidebar: Telemetry Roster List */}
        <div className="space-y-2">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 px-1">
            Mashinalar ro'yxati
          </div>

          <div className="space-y-2">
            {drivers.map((d) => {
              const isSelected = selectedTruckId === d.id;
              const isDriving = d.dutyStatus === 'DRIVING';

              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedTruckId(d.id)}
                  className={`cursor-pointer p-3 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'bg-white dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-700 dark:text-zinc-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-200">{d.name}</span>
                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{d.driverNumber}</span>
                  </div>

                  <div className="text-xs text-zinc-500 mb-2 truncate">{d.truck}</div>

                  <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                    <span>{d.currentLocation}</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{d.hos.driveLeft}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
