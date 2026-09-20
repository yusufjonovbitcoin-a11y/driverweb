import React, { useState } from 'react';
import { 
  MapPin, 
  Plus, 
  Search,
  Truck,
  UserPlus,
  X,
  CheckCircle2
} from 'lucide-react';

export default function DriverRoster({ drivers, loads, onAssignLoad, onAddDriver }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [successToast, setSuccessToast] = useState('');

  // Form State for Adding Driver Inline (No Modal)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [driverNumber, setDriverNumber] = useState('');
  const [truck, setTruck] = useState('');
  const [trailer, setTrailer] = useState("53' Reefer");
  const [location, setLocation] = useState('Chicago, IL');

  const handlePrepareForm = () => {
    const nextNum = `#10${drivers.length + 50}`;
    setDriverNumber(nextNum);
    setName('');
    setPhone('+1 (773) 555-');
    setTruck('Freightliner Cascadia (#' + Math.floor(100 + Math.random() * 900) + ')');
    setTrailer("53' Reefer (#R-" + Math.floor(100 + Math.random() * 900) + ")");
    setLocation('Chicago, IL');
  };

  const handleToggleAddForm = () => {
    if (!isAddFormOpen) {
      handlePrepareForm();
      setIsAddFormOpen(true);
    } else {
      setIsAddFormOpen(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newDriver = {
      name: name.trim(),
      driverNumber: driverNumber.trim() || `#10${Math.floor(10 + Math.random() * 90)}`,
      phone: phone.trim() || '+1 (555) 000-0000',
      truck: truck.trim() || 'Volvo VNL 860',
      trailer: trailer.trim() || "53' Reefer",
      currentLocation: location.trim() || 'Chicago, IL',
      lat: 41.8781,
      lng: -87.6298,
      status: 'AVAILABLE',
      dutyStatus: 'ON_DUTY',
      hos: {
        driveLeft: '11:00',
        shiftLeft: '14:00',
        cycleLeft: '70:00'
      },
      rating: 5.0,
      completedLoads: 0,
      onTimeRate: '100%'
    };

    if (onAddDriver) {
      onAddDriver(newDriver);
    }
    setIsAddFormOpen(false);
    setSuccessToast(`${newDriver.name} tizimga muvaffaqiyatli qo'shildi!`);
    setTimeout(() => setSuccessToast(''), 4000);
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

  return (
    <div className="w-full space-y-6 pb-12">
      
      {/* Toast */}
      {successToast && (
        <div className="bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm font-bold animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast('')} className="opacity-80 hover:opacity-100 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Flat Header — No Card Box */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Haydovchilar Floti
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Barcha drayverlar, HOS qoldiqlari, biriktirilgan texnika va reyslar ro'yxati
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Inline Add Driver Toggle */}
          <button
            onClick={handleToggleAddForm}
            className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl font-bold text-sm shadow-xs transition-colors cursor-pointer ${
              isAddFormOpen
                ? 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100'
                : 'bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950'
            }`}
          >
            {isAddFormOpen ? (
              <>
                <X className="w-4 h-4" />
                <span>Formani yopish</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Yangi haydovchi qo'shish</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline Add Driver Form — No Modal */}
      {isAddFormOpen && (
        <div className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 lg:p-6 space-y-5 animate-in fade-in slide-in-from-top-3 duration-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-bold">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  Yangi Haydovchi Ro'yxatdan O'tkazish
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  To'g'ridan-to'g'ri sahifada to'ldiring — modal oynasiz to'liq rejim
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsAddFormOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Formani yopish"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  F.I.Sh (Ism Familiya) *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masalan: Jasur Aliyev"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Telefon Raqami *
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (773) 555-0188"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Drayver ID (#)
                </label>
                <input
                  type="text"
                  value={driverNumber}
                  onChange={(e) => setDriverNumber(e.target.value)}
                  placeholder="#1056"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-mono placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Tyagach (Model & #)
                </label>
                <input
                  type="text"
                  value={truck}
                  onChange={(e) => setTruck(e.target.value)}
                  placeholder="Peterbilt 579 (#410)"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Treyler Turi
                </label>
                <select
                  value={trailer}
                  onChange={(e) => setTrailer(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-400 transition-colors cursor-pointer"
                >
                  <option value="53' Reefer">53' Reefer (Sovutgich)</option>
                  <option value="53' Dry Van">53' Dry Van (Tent)</option>
                  <option value="53' Flatbed">53' Flatbed (Ochiq platforma)</option>
                  <option value="Step Deck">Step Deck</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Hozirgi Joylashuv (Shahar, Shtat)
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Dallas, TX"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                * Drayver ma'lumotlari kiritilgach, u darhol jadvalda aks etadi va reyslarga tayinlanishi mumkin.
              </p>
              <div className="flex items-center space-x-3 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setIsAddFormOpen(false)}
                  className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs hover:bg-zinc-800 dark:hover:bg-white transition-colors cursor-pointer"
                >
                  Drayverni Tizimga Saqlash
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Filters & Search Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Drayver, texnika yoki joylashuv..."
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl pl-9 pr-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
          />
        </div>

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

      {/* Full-Width Clean Table — No Card Box */}
      <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="py-3.5 px-4">Haydovchi</th>
              <th className="py-3.5 px-4">Holat</th>
              <th className="py-3.5 px-4">Joylashuv</th>
              <th className="py-3.5 px-4">HOS Qoldig'i</th>
              <th className="py-3.5 px-4">Texnika & Treyler</th>
              <th className="py-3.5 px-4">Faol Reys</th>
              <th className="py-3.5 px-4 text-right">Harakat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
            {filteredDrivers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-zinc-400 font-medium">
                  Haydovchilar topilmadi
                </td>
              </tr>
            ) : (
              filteredDrivers.map((driver) => {
                const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');

                return (
                  <tr 
                    key={driver.id} 
                    className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                  >
                    {/* Driver Info */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-xs text-zinc-800 dark:text-zinc-200 flex-shrink-0">
                          {driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}
                        </div>
                        <div>
                          <div className="flex items-center space-x-1.5 whitespace-nowrap">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{driver.name}</span>
                            <span className="text-amber-500 font-semibold text-xs">{driver.rating} ★</span>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber}</span> • <span>{driver.phone}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Duty Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center space-x-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                        driver.dutyStatus === 'DRIVING'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50'
                          : driver.dutyStatus === 'ON_DUTY'
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800/50'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${
                          driver.dutyStatus === 'DRIVING' ? 'bg-emerald-500' : driver.dutyStatus === 'ON_DUTY' ? 'bg-blue-500' : 'bg-zinc-400'
                        }`} />
                        <span>{driver.dutyStatus}</span>
                      </span>
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

                    {/* Equipment */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        <Truck className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{driver.truck}</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono mt-0.5 pl-6">
                        {driver.trailer}
                      </div>
                    </td>

                    {/* Active Load */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {activeLoad ? (
                        <div className="font-mono">
                          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {activeLoad.loadNumber} • ${Number(activeLoad.rate).toLocaleString('en-US')}
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
                        {!activeLoad ? (
                          <button
                            onClick={() => onAssignLoad(driver)}
                            className="inline-flex items-center space-x-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-colors shadow-2xs cursor-pointer"
                            title="Yangi yuk tayinlash"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Yuk berish</span>
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-400 font-mono">—</span>
                        )}
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
