import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Send, 
  Check, 
  Search,
  FileImage
} from 'lucide-react';

export default function QuickDriverModal({ 
  isOpen, 
  onClose, 
  loadData, 
  drivers, 
  onConfirm 
}) {
  if (!isOpen || !loadData) return null;

  const [selectedDriverIds, setSelectedDriverIds] = useState([drivers[0]?.id || 'd1']);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleDriver = (id) => {
    if (selectedDriverIds.includes(id)) {
      if (selectedDriverIds.length > 1) {
        setSelectedDriverIds(selectedDriverIds.filter(d => d !== id));
      }
    } else {
      setSelectedDriverIds([...selectedDriverIds, id]);
    }
  };

  const toggleSelectAll = () => {
    if (isSelectAll) {
      setIsSelectAll(false);
      setSelectedDriverIds([drivers[0]?.id || 'd1']);
    } else {
      setIsSelectAll(true);
      setSelectedDriverIds(drivers.map(d => d.id));
    }
  };

  const filteredDrivers = drivers.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      (d.truck && d.truck.toLowerCase().includes(q)) ||
      (d.currentLocation && d.currentLocation.toLowerCase().includes(q))
    );
  });

  const handleSend = (e) => {
    e.preventDefault();
    onConfirm(selectedDriverIds);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base lg:text-lg font-bold text-zinc-900 dark:text-zinc-100">
                AI Yukni Tayyorladi
              </h2>
              <p className="text-xs lg:text-sm text-zinc-400">
                Faqat haydovchini tanlang va yuboring
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSend} className="p-6 space-y-4">
          
          {/* AI Parsed Summary Card */}
          <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 p-4 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm lg:text-base font-bold text-zinc-900 dark:text-zinc-100">
                <span>{loadData.origin.city}, {loadData.origin.state}</span>
                <span>➔</span>
                <span>{loadData.destination.city}, {loadData.destination.state}</span>
              </div>
              <span className="font-mono font-extrabold text-base lg:text-lg text-zinc-900 dark:text-zinc-100">
                ${loadData.rate?.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs lg:text-sm text-zinc-500 font-medium">
              <span>{loadData.equipment} • {loadData.distanceMiles} mi</span>
              <span className="flex items-center space-x-1.5 text-blue-600 dark:text-blue-400 font-bold">
                <FileImage className="w-4 h-4" />
                <span className="truncate max-w-[140px]">{loadData.fileName || 'Surat biriktirildi'}</span>
              </span>
            </div>
          </div>

          {/* Haydovchi(lar)ni tanlash */}
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-zinc-800 dark:text-zinc-200">
                Haydovchini tanlang
              </span>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs lg:text-sm text-blue-600 dark:text-blue-400 hover:underline font-bold"
              >
                {isSelectAll ? 'Alohida tanlash' : 'Barchasiga yuborish'}
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Haydovchi ismi, truck raqami yoki shahar..."
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
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-400 font-medium">
                  "{searchQuery}" bo'yicha haydovchi topilmadi
                </div>
              ) : (
                filteredDrivers.map((driver) => {
                  const isSelected = selectedDriverIds.includes(driver.id);
                  const truckModel = driver.truck ? driver.truck.split('(')[0].trim() : '';
                  const city = driver.currentLocation ? driver.currentLocation.split(',')[0].trim() : '';

                  return (
                    <div
                      key={driver.id}
                      onClick={() => toggleDriver(driver.id)}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 font-bold'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60 text-zinc-600 dark:text-zinc-400 font-medium'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected 
                            ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-950' 
                            : 'border-zinc-300 dark:border-zinc-700'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
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
          </div>

          {/* Footer */}
          <div className="pt-3.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium">
              Tanlandi: <strong className="text-zinc-900 dark:text-zinc-100 font-bold">{selectedDriverIds.length} ta drayver</strong>
            </span>

            <div className="flex items-center space-x-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Bekor qilish
              </button>
              <button
                type="submit"
                className="inline-flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 px-5 py-2 rounded-xl font-bold text-sm transition-colors shadow-xs"
              >
                <Send className="w-4 h-4" />
                <span>
                  {selectedDriverIds.length > 1
                    ? `${selectedDriverIds.length} drayverga yuborish`
                    : 'Haydovchiga yuborish'}
                </span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
}
