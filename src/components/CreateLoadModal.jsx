import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Send, 
  Check, 
  Paperclip,
  Eye,
  Search
} from 'lucide-react';

export default function CreateLoadModal({ isOpen, onClose, drivers, onCreateLoad }) {
  if (!isOpen) return null;

  // Input text or file
  const [brokerText, setBrokerText] = useState("C.H. Robinson #LD-88201: Chicago, IL -> Dallas, TX. Rate: $3,850 (925 mi). 53' Reefer (-18C). 41,200 lbs.");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // Toggle AI Preview (1 ta maxsus ikonka orqali ko'rish)
  const [showAiPreview, setShowAiPreview] = useState(false);

  // Driver search filter
  const [driverSearch, setDriverSearch] = useState('');

  // Core Parsed Fields (AI avtomatik to'ldiradi)
  const [origin, setOrigin] = useState('Chicago, IL');
  const [destination, setDestination] = useState('Dallas, TX');
  const [rate, setRate] = useState(3850);
  const [distanceMiles, setDistanceMiles] = useState(925);
  const [broker, setBroker] = useState('C.H. Robinson');
  const [equipment, setEquipment] = useState("53' Reefer");
  const [weightLbs, setWeightLbs] = useState(41200);

  // Driver selection
  const [selectedDriverIds, setSelectedDriverIds] = useState([drivers[0]?.id || 'd1']);
  const [isSelectAll, setIsSelectAll] = useState(false);

  // Quick Samples
  const handleApplySample = (sampleType) => {
    setIsAiProcessing(true);
    setTimeout(() => {
      if (sampleType === 'reefer') {
        setOrigin('Chicago, IL');
        setDestination('Dallas, TX');
        setRate(3850);
        setDistanceMiles(925);
        setBroker('C.H. Robinson');
        setEquipment("53' Reefer (-18°C)");
        setWeightLbs(41200);
        setBrokerText("C.H. Robinson #LD-88201: Chicago, IL -> Dallas, TX. Rate: $3,850 (925 mi). 53' Reefer (-18C). 41,200 lbs.");
      } else if (sampleType === 'dryvan') {
        setOrigin('Atlanta, GA');
        setDestination('Detroit, MI');
        setRate(2450);
        setDistanceMiles(710);
        setBroker('TQL Logistics');
        setEquipment("53' Dry Van");
        setWeightLbs(36000);
        setBrokerText("TQL Freight: Atlanta, GA -> Detroit, MI. Rate: $2,450 (710 mi). 53' Dry Van. 36,000 lbs.");
      }
      setIsAiProcessing(false);
    }, 200);
  };

  // Auto-parse on text change
  const handleTextChange = (e) => {
    const text = e.target.value;
    setBrokerText(text);

    if (text.length > 10) {
      const rateMatch = text.match(/\$(\d[\d,]*)/);
      if (rateMatch) {
        setRate(Number(rateMatch[1].replace(/,/g, '')));
      }

      const milesMatch = text.match(/(\d[\d,]*)\s*(?:mi|miles)/i);
      if (milesMatch) {
        setDistanceMiles(Number(milesMatch[1].replace(/,/g, '')));
      }

      if (/robinson/i.test(text)) setBroker('C.H. Robinson');
      else if (/tql/i.test(text)) setBroker('TQL Logistics');
      else if (/echo/i.test(text)) setBroker('Echo Global Logistics');
      else if (/coyote/i.test(text)) setBroker('Coyote Logistics');

      const routeMatch = text.match(/([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})\s*(?:->|➔|to|-)\s*([A-Z][a-zA-Z\s]+,\s*[A-Z]{2})/);
      if (routeMatch) {
        setOrigin(routeMatch[1].trim());
        setDestination(routeMatch[2].trim());
      }

      if (/reefer|frozen|temp/i.test(text)) setEquipment("53' Reefer (-18°C)");
      else if (/van|dry/i.test(text)) setEquipment("53' Dry Van");
      else if (/flatbed/i.test(text)) setEquipment("53' Flatbed");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile({
      name: file.name,
      size: `${(file.size / 1024).toFixed(0)} KB`,
      url: URL.createObjectURL(file)
    });
    setIsAiProcessing(true);
    setTimeout(() => {
      setBroker('C.H. Robinson (PDF)');
      setRate(3850);
      setDistanceMiles(925);
      setOrigin('Chicago, IL');
      setDestination('Dallas, TX');
      setEquipment("53' Reefer");
      setIsAiProcessing(false);
    }, 300);
  };

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

  const filteredDrivers = drivers.filter(d => {
    if (!driverSearch.trim()) return true;
    const q = driverSearch.toLowerCase();
    return (
      d.name.toLowerCase().includes(q) ||
      (d.truck && d.truck.toLowerCase().includes(q)) ||
      (d.driverNumber && d.driverNumber.toLowerCase().includes(q)) ||
      (d.currentLocation && d.currentLocation.toLowerCase().includes(q))
    );
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const [origCity, origState] = origin.split(',').map(s => s?.trim() || '');
    const [dstCity, dstState] = destination.split(',').map(s => s?.trim() || '');
    const rpmVal = distanceMiles > 0 ? (rate / distanceMiles).toFixed(2) : '3.50';

    const newLoad = {
      id: `load-${Date.now().toString().slice(-5)}`,
      loadNumber: `#LD-${Math.floor(10000 + Math.random() * 90000)}`,
      status: 'OFFER',
      broker: broker || 'Broker',
      brokerContact: 'Dispatch Dept',
      brokerPhone: '+1 (800) 555-0199',
      rate: Number(rate) || 3000,
      distanceMiles: Number(distanceMiles) || 800,
      ratePerMile: Number(rpmVal),
      origin: {
        city: origCity || 'Chicago',
        state: origState || 'IL',
        facility: 'Logistics Center',
        address: `${origCity || 'Chicago'}, ${origState || 'IL'}`,
        date: new Date().toISOString().split('T')[0],
        time: '08:00 - 10:00',
        lat: 41.8781,
        lng: -87.6298
      },
      destination: {
        city: dstCity || 'Dallas',
        state: dstState || 'TX',
        facility: 'Receiving Depot',
        address: `${dstCity || 'Dallas'}, ${dstState || 'TX'}`,
        date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
        time: '14:00 - 16:00',
        lat: 32.7767,
        lng: -96.7970
      },
      commodity: 'Standart yuk',
      weightLbs: Number(weightLbs) || 40000,
      equipment: equipment || "53' Dry Van",
      temperature: equipment.includes('Reefer') ? '-18°C' : 'N/A',
      pallets: 24,
      driverId: selectedDriverIds[0],
      targetDriverIds: selectedDriverIds,
      dispatchedAt: 'Hozirgina',
      documents: {
        rateCon: uploadedFile?.url || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=700&auto=format&fit=crop&q=80',
        shipperBol: null,
        receiverPod: null
      }
    };

    onCreateLoad(newLoad);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Clean Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="text-base lg:text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Yangi yuk qo'shish
            </h2>
            <p className="text-xs lg:text-sm text-zinc-400 mt-0.5">
              Xabarni joylang, AI qolganini o'zi tayyorlaydi
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          
          {/* 1. Broker Message or File */}
          <div className="space-y-1.5">
            <div className="relative">
              <textarea
                rows={3}
                value={brokerText}
                onChange={handleTextChange}
                placeholder="Telegram, SMS yoki broker xabarini shu yerga qo'ying..."
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl p-3 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors resize-none"
              />
              
              {/* Attachment link and Quick samples */}
              <div className="flex items-center justify-between pt-1.5 px-0.5 text-xs">
                <label className="inline-flex items-center space-x-1.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer font-medium">
                  <Paperclip className="w-4 h-4" />
                  <span className="truncate max-w-[150px]">
                    {uploadedFile ? uploadedFile.name : 'Fayl biriktirish (PDF/surat)'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                <div className="flex items-center space-x-2 text-zinc-400">
                  <span>Namuna:</span>
                  <button
                    type="button"
                    onClick={() => handleApplySample('reefer')}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                  >
                    Reefer
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleApplySample('dryvan')}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                  >
                    Dry Van
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. AI Natijasi Ikonkasi */}
          <div>
            <button
              type="button"
              onClick={() => setShowAiPreview(!showAiPreview)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm transition-colors border ${
                showAiPreview
                  ? 'bg-zinc-100 dark:bg-zinc-800/80 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-bold'
                  : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200/80 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 font-medium'
              }`}
              title="AI tayyorlagan natijani ko'rish"
            >
              <div className="flex items-center space-x-2.5 truncate">
                <Eye className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span className="font-bold text-zinc-900 dark:text-zinc-100">AI tayyorlagan yuk:</span>
                <span className="text-zinc-500 truncate font-mono">{origin} ➔ {destination} • ${rate?.toLocaleString()}</span>
              </div>
              <span className="text-xs text-zinc-400 font-mono font-bold ml-2 flex-shrink-0">
                {showAiPreview ? 'Yopish ▲' : 'Ko\'rish ▼'}
              </span>
            </button>

            {/* AI Preview Card (Opens on click) */}
            {showAiPreview && (
              <div className="mt-2.5 p-3.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2.5 animate-in fade-in duration-150 text-sm">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
                    <span className="text-xs text-zinc-400 block font-medium">Yo'nalish</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">{origin} ➔ {destination}</span>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
                    <span className="text-xs text-zinc-400 block font-medium">Stavka</span>
                    <span className="font-mono font-extrabold text-zinc-900 dark:text-zinc-100 text-base">${Number(rate).toLocaleString()}</span>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
                    <span className="text-xs text-zinc-400 block font-medium">Texnika & Masofa</span>
                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">{equipment} • {distanceMiles} mi</span>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200/60 dark:border-zinc-800">
                    <span className="text-xs text-zinc-400 block font-medium">Broker</span>
                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">{broker}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Haydovchi(lar)ni belgilash & Search */}
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

            {/* Driver Search Box */}
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={driverSearch}
                onChange={(e) => setDriverSearch(e.target.value)}
                placeholder="Haydovchi ismi, truck raqami yoki shahar..."
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl pl-9 pr-8 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-400 transition-colors"
              />
              {driverSearch && (
                <button
                  type="button"
                  onClick={() => setDriverSearch('')}
                  className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Drivers List */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredDrivers.length === 0 ? (
                <div className="py-4 text-center text-sm text-zinc-400 font-medium">
                  "{driverSearch}" bo'yicha haydovchi topilmadi
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

          {/* 4. Clean Footer */}
          <div className="pt-3.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-medium">
              Tanlandi: <strong className="text-zinc-800 dark:text-zinc-200 font-bold">{selectedDriverIds.length} ta drayver</strong>
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
