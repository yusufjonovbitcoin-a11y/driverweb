import React, { useState } from 'react';
import { 
  Building2, 
  Phone, 
  Mail, 
  MapPin, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  X,
  User,
  LogOut,
  Search,
  Truck,
  UserPlus
} from 'lucide-react';

export default function ProfileView({ 
  drivers, 
  loads, 
  onAddDriver, 
  onDeleteDriver, 
  currentUser,
  onLogout
}) {
  // Inline Form State (NO POPUP MODAL - 100% INLINE FULL-WIDTH FORM)
  const [isAddFormOpen, setIsAddFormOpen] = useState(true);
  const [successToast, setSuccessToast] = useState('');
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Form State for Adding Driver
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [driverNumber, setDriverNumber] = useState('');
  const [truck, setTruck] = useState('');
  const [trailer, setTrailer] = useState("53' Reefer");
  const [location, setLocation] = useState('Chicago, IL');

  const handlePrepareForm = () => {
    const nextNum = `#10${drivers.length + 50}`;
    setDriverNumber(nextNum);
    setName('');
    setEmail('');
    setFormError('');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    const newDriver = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
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

    setIsSubmitting(true);
    setFormError('');
    try {
      await onAddDriver(newDriver);
      setIsAddFormOpen(false);
      setSuccessToast(`${newDriver.name} uchun taklif yuborildi.`);
      setTimeout(() => setSuccessToast(''), 4000);
    } catch (error) {
      setFormError(error.message || 'Haydovchini taklif qilib bo‘lmadi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalDrivers = drivers.length;
  const availableDrivers = drivers.filter(d => !loads.some(l => l.driverId === d.id && l.status !== 'COMPLETED')).length;
  const onDutyDrivers = totalDrivers - availableDrivers;

  // Filter drivers for table
  const filteredDrivers = drivers.filter(driver => {
    const activeLoad = loads.find(l => l.driverId === driver.id && l.status !== 'COMPLETED');
    if (statusFilter === 'AVAILABLE' && activeLoad) return false;
    if (statusFilter === 'ON_DUTY' && !activeLoad) return false;

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
      
      {/* Success Notification Toast */}
      {successToast && (
        <div className="bg-emerald-500 text-white px-5 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm font-bold animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast('')} className="opacity-80 hover:opacity-100 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 1. DISPETCHER PROFILI — FULL-WIDTH FLAT HEADER (KARTA/MODAL EMAS, TO'LIQ SAHIFA) */}
      <div className="pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          
          {/* Dispatcher Details */}
          <div className="flex items-start sm:items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center font-mono font-black text-2xl shadow-xs flex-shrink-0">
              {currentUser?.avatarInitial || currentUser?.name?.charAt(0) || 'D'}
            </div>

            <div className="space-y-1">
              <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                <h2 className="text-2xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                  {currentUser?.name || 'Dilshod Rahimov'}
                </h2>
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold border border-emerald-200 dark:border-emerald-800/40">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{currentUser?.role || 'Bosh Dispecher (Admin)'}</span>
                </span>
                {onLogout && (
                  <button
                    onClick={() => {
                      if (window.confirm("Tizimdan chiqishni xohlaysizmi?")) {
                        onLogout();
                      }
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors cursor-pointer"
                    title="Hisobdan chiqish"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Chiqish</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="driver@company.com"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              <div className="flex items-center space-x-3 text-sm text-zinc-600 dark:text-zinc-300 font-medium flex-wrap gap-y-1">
                <span className="flex items-center space-x-1.5">
                  <Building2 className="w-4 h-4 text-zinc-400" />
                  <strong className="text-zinc-900 dark:text-zinc-100">{currentUser?.company || 'ApexHaul Logistics LLC'}</strong>
                </span>
                <span>•</span>
                <span className="font-mono font-bold">{currentUser?.mcNumber || 'MC-984210'}</span>
                <span>•</span>
                <span className="font-mono font-bold">{currentUser?.dotNumber || 'USDOT 3891452'}</span>
              </div>

              <div className="flex items-center space-x-4 text-xs text-zinc-500 dark:text-zinc-400 font-mono flex-wrap gap-y-1">
                <span className="flex items-center space-x-1">
                  <Phone className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{currentUser?.phone || '+1 (312) 555-0100'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center space-x-1">
                  <Mail className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{currentUser?.email || 'dispatch@apexhaul.com'}</span>
                </span>
                <span>•</span>
                <span className="flex items-center space-x-1">
                  <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Chicago, IL, USA</span>
                </span>
              </div>
            </div>

            {formError && (
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">{formError}</p>
            )}
          </div>

          {/* Clean Flat Counter Badges */}
          <div className="flex items-center space-x-3">
            <div className="bg-zinc-100 dark:bg-zinc-800/80 px-4 py-2.5 rounded-xl text-center min-w-[95px]">
              <div className="text-2xl font-black text-zinc-900 dark:text-zinc-100">{totalDrivers}</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-wider">Drayverlar</div>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 px-4 py-2.5 rounded-xl text-center min-w-[95px]">
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{availableDrivers}</div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">Bo'sh</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/40 px-4 py-2.5 rounded-xl text-center min-w-[95px]">
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{onDutyDrivers}</div>
              <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Reysda</div>
            </div>
          </div>

        </div>
      </div>

      {/* 2. HAYDOVCHILARNI BOSHQARISH & AMALLAR PANELI */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Haydovchilarni Boshqarish
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Tizimdagi barcha drayverlar, ularning texnikasi va reys holatlari
          </p>
        </div>

        {/* Toggle Form Button (Modal emas, sahifadagi formani ochish/yopish) */}
        <button
          onClick={handleToggleAddForm}
          className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl font-bold text-sm shadow-xs transition-colors cursor-pointer self-start sm:self-auto ${
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

      {/* 3. YANGI HAYDOVCHI QO'SHISH FORMASI — TO'LIQ SAHIFADA (MODAL EMAS, INLINE FULL-WIDTH FORM) */}
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
              {/* F.I.Sh */}
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
                  placeholder="Masalan: Sardor Rahim"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              {/* Telefon */}
              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Telefon Raqami *
                </label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (773) 555-0199"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              {/* Drayver ID */}
              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Drayver ID (#)
                </label>
                <input
                  type="text"
                  value={driverNumber}
                  onChange={(e) => setDriverNumber(e.target.value)}
                  placeholder="#1055"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 font-mono placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              {/* Tyagach */}
              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Tyagach (Model & #)
                </label>
                <input
                  type="text"
                  value={truck}
                  onChange={(e) => setTruck(e.target.value)}
                  placeholder="Volvo VNL 860 (#702)"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>

              {/* Treyler */}
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

              {/* Joylashuv */}
              <div>
                <label className="block text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-1.5">
                  Hozirgi Joylashuv (Shahar, Shtat)
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Chicago, IL"
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                * Drayver ma'lumotlari to'ldirilgach, saqlash tugmasini bosing — u darhol pastdagi jadvalga qo'shiladi.
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
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-sm font-bold shadow-xs hover:bg-zinc-800 dark:hover:bg-white transition-colors cursor-pointer"
                >
                  {isSubmitting ? 'Taklif yuborilmoqda…' : 'Drayverni taklif qilish'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Drayver ismi, raqami yoki mashinasi..."
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
            Bo'sh ({availableDrivers})
          </button>
          <button
            onClick={() => setStatusFilter('ON_DUTY')}
            className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ON_DUTY'
                ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Reysda ({onDutyDrivers})
          </button>
        </div>
      </div>

      {/* 4. TO'LIQ KENGLIKDAGI JADVAL (MODAL EMAS, FULL-WIDTH FLAT ENTERPRISE TABLE) */}
      <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left border-collapse min-w-[700px]">
          <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="py-3.5 px-4">Haydovchi</th>
              <th className="py-3.5 px-4">Texnika & Treyler</th>
              <th className="py-3.5 px-4">Hozirgi Joylashuv</th>
              <th className="py-3.5 px-4">Holat</th>
              <th className="py-3.5 px-4 text-right">Amal</th>
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
                  <tr key={driver.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-xs text-zinc-800 dark:text-zinc-200 flex-shrink-0">
                          {driver.name.charAt(0)}{driver.name.split(' ')[1]?.charAt(0) || ''}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2 whitespace-nowrap">
                            <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{driver.name}</span>
                            <span className="text-amber-500 font-bold text-xs">{driver.rating} ★</span>
                          </div>
                          <div className="text-xs text-zinc-400 font-mono whitespace-nowrap mt-0.5">
                            <span className="font-bold text-zinc-600 dark:text-zinc-300">{driver.driverNumber}</span> • <span>{driver.phone}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        <Truck className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span>{driver.truck}</span>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono mt-0.5 pl-6">
                        {driver.trailer}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5 text-sm">
                        <MapPin className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                        <span className="font-medium">{driver.currentLocation}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {activeLoad ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40">
                          Reysda ({activeLoad.loadNumber})
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                          ✓ Bo'sh (Tayyor)
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {onDeleteDriver && (
                        <button
                          onClick={() => {
                            if (window.confirm(`${driver.name} drayverini o'chirishni xohlaysizmi?`)) {
                              onDeleteDriver(driver.id);
                            }
                          }}
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                          title="Haydovchini o'chirish"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
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
