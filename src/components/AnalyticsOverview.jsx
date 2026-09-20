import React from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Milestone, 
  CheckCircle2, 
  Truck
} from 'lucide-react';

export default function AnalyticsOverview({ loads }) {
  const totalRevenue = loads.reduce((acc, curr) => acc + (curr.rate || 0), 0);
  const totalMiles = loads.reduce((acc, curr) => acc + (curr.distanceMiles || 0), 0);
  const avgRPM = totalMiles > 0 ? (totalRevenue / totalMiles).toFixed(2) : '3.05';

  const brokerStats = [
    { name: 'C.H. Robinson', loads: 4, revenue: 11400, percent: 38 },
    { name: 'TQL Logistics', loads: 3, revenue: 8650, percent: 29 },
    { name: 'Echo Global Logistics', loads: 2, revenue: 5800, percent: 20 },
    { name: 'Landstar Ranger', loads: 2, revenue: 3900, percent: 13 },
  ];

  return (
    <div className="w-full space-y-6 pb-12">
      
      {/* Flat Header — No Card Box */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Moliyaviy Tahlil va Samaradorlik
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
            Barcha reyslarning daromadlari, stavkalar rentabelligi va brokerlar ulushi
          </p>
        </div>

        <div className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-mono font-bold text-xs border border-emerald-200 dark:border-emerald-800/40 self-start sm:self-auto">
          <TrendingUp className="w-4 h-4" />
          <span>+14.2% oylik o'sish</span>
        </div>
      </div>

      {/* 4 KPIs — Flat Edge-to-Edge Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-wider font-mono">
            <span>Jami Tushum (Gross)</span>
            <DollarSign className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            ${totalRevenue.toLocaleString()}
          </div>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">100% to'lov kafolati</span>
        </div>

        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-wider font-mono">
            <span>O'rtacha Stavka (RPM)</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            ${avgRPM} <span className="text-xs text-zinc-400 font-normal">/ mil</span>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Bozor o'rtacha ko'rsatkichidan yuqori</span>
        </div>

        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-wider font-mono">
            <span>Jami Masofa</span>
            <Milestone className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            {totalMiles.toLocaleString()} <span className="text-xs text-zinc-400 font-normal">mil</span>
          </div>
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Faol yo'nalishlar bo'yicha</span>
        </div>

        <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-wider font-mono">
            <span>Vaqtida Yetkazish</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black font-mono text-zinc-900 dark:text-zinc-100">
            99.2%
          </div>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Kechikishlar: 0 ta</span>
        </div>
      </div>

      {/* Broker Breakdown & Equipment Split — Flat Clean Tables */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Brokerlar Bo'yicha Tushum Taqsimoti
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Har bir brokerning umumiy daromaddagi ulushi va yuk hajmi
          </p>
        </div>

        <div className="w-full overflow-x-auto border-t border-b border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse min-w-[650px]">
            <thead className="bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-500 dark:text-zinc-400 font-mono text-xs font-bold uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Broker Kompaniyasi</th>
                <th className="py-3.5 px-4">Reyslar Soni</th>
                <th className="py-3.5 px-4">Jami Tushum</th>
                <th className="py-3.5 px-4">Ulush</th>
                <th className="py-3.5 px-4 w-48">Grafik</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
              {brokerStats.map((broker) => (
                <tr key={broker.name} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    {broker.name}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                    {broker.loads} ta reys
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                    ${broker.revenue.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {broker.percent}%
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-zinc-900 dark:bg-zinc-100 h-full rounded-full"
                        style={{ width: `${broker.percent}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Equipment Fleet Split */}
      <div className="space-y-4 pt-2">
        <div>
          <h3 className="text-lg font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
            Treylerlar va Texnika Bo'yicha Taqsimot
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Flotdagi har xil turdagi treylerlarning faoliyat balansi
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">53' Reefer</h4>
                <p className="text-xs text-zinc-400">Sovutgichli uskunalar</p>
              </div>
            </div>
            <span className="font-mono font-black text-base text-zinc-900 dark:text-zinc-100">2 ta</span>
          </div>

          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">53' Dry Van</h4>
                <p className="text-xs text-zinc-400">Quruq yuk furgonlari</p>
              </div>
            </div>
            <span className="font-mono font-black text-base text-zinc-900 dark:text-zinc-100">1 ta</span>
          </div>

          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">53' Flatbed</h4>
                <p className="text-xs text-zinc-400">Ochiq platformalar</p>
              </div>
            </div>
            <span className="font-mono font-black text-base text-zinc-900 dark:text-zinc-100">1 ta</span>
          </div>
        </div>
      </div>

    </div>
  );
}
