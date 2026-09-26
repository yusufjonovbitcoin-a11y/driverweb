import React, { useMemo } from 'react';
import { DollarSign, Milestone, Package, TrendingUp, Truck } from 'lucide-react';
import { aggregateLoadAnalytics } from '../services/loadAnalytics';

const number = (value) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (value) => value == null ? '—' : `$${number(value)}`;

export default function AnalyticsOverview({ loads = [] }) {
  const stats = useMemo(() => aggregateLoadAnalytics(loads), [loads]);
  const cards = [
    { label: 'Yuk shartnomalari summasi', value: money(stats.contractAmount), detail: `${stats.knownRates} / ${stats.count} yukda stavka kiritilgan`, icon: DollarSign },
    { label: 'O‘rtacha stavka / mil', value: money(stats.rpm), detail: `${stats.rpmLoads} ta stavka va masofasi ma’lum yuk bo‘yicha`, icon: TrendingUp },
    { label: 'Yuk marshrutlari masofasi', value: `${number(stats.miles)} mi`, detail: `${stats.knownDistances} / ${stats.count} yukda masofa kiritilgan`, icon: Milestone },
    { label: 'Yuklar soni', value: number(stats.count), detail: 'Barcha yuk holatlari hisobga olingan', icon: Package },
  ];
  return (
    <div className="w-full space-y-6 pb-12">
      <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h2 className="text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">Yuklar bo‘yicha tahlil</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Summalar yuk shartnomalaridagi stavkalarga asoslangan. To‘lov kelib tushgani haqida ma’lumot yo‘q.</p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon }) => <div key={label} className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-zinc-500 dark:text-zinc-400"><span>{label}</span><Icon className="h-4 w-4 shrink-0" /></div>
          <div className="font-mono text-2xl font-black text-zinc-900 dark:text-zinc-100">{value}</div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
        </div>)}
      </div>
      {!stats.count && <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Hozircha tahlil uchun yuklar yo‘q.</p>}
      <section className="space-y-3">
        <div><h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Brokerlar bo‘yicha yuklar</h3><p className="mt-1 text-xs text-zinc-500">Ulush yuklar sonidan hisoblanadi. Summa faqat stavkasi ma’lum yuklarni qamrab oladi.</p></div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"><tr><th scope="col" className="px-4 py-3">Broker</th><th scope="col" className="px-4 py-3">Yuklar</th><th scope="col" className="px-4 py-3">Shartnoma summasi</th><th scope="col" className="px-4 py-3">Yuklar ulushi</th></tr></thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {stats.brokers.map((broker) => <tr key={broker.name} className="text-zinc-800 dark:text-zinc-200"><th scope="row" className="px-4 py-3 font-semibold">{broker.name}</th><td className="px-4 py-3">{broker.count}</td><td className="px-4 py-3 font-mono">{money(broker.amount)}{broker.knownRates < broker.count && <span className="mt-1 block font-sans text-xs text-zinc-500">{broker.knownRates}/{broker.count} stavka ma’lum</span>}</td><td className="px-4 py-3"><span>{number(broker.percent)}%</span><div aria-hidden="true" className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-blue-600" style={{ width: `${broker.percent}%` }} /></div></td></tr>)}
              {!stats.brokers.length && <tr><td colSpan={4} className="px-4 py-5 text-center text-zinc-500">Brokerlar bo‘yicha ma’lumot yo‘q.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <div><h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Yuklarda ko‘rsatilgan texnika</h3><p className="mt-1 text-xs text-zinc-500">Har bir texnika turi bo‘yicha yuklar soni.</p></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.equipment.map((item) => <div key={item.name} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"><Truck className="h-5 w-5 shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><h4 className="break-words text-sm font-bold text-zinc-900 dark:text-zinc-100">{item.name}</h4><p className="mt-1 text-xs text-zinc-500">{number(item.percent)}% yuk</p></div><span className="whitespace-nowrap text-sm font-bold text-zinc-900 dark:text-zinc-100">{item.count} ta yuk</span></div>)}
          {!stats.equipment.length && <p className="text-sm text-zinc-500">Texnika bo‘yicha ma’lumot yo‘q.</p>}
        </div>
      </section>
    </div>
  );
}
