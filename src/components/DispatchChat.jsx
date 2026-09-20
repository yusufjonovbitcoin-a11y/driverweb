import React, { useState } from 'react';
import { 
  Send, 
  Phone, 
  Check
} from 'lucide-react';

export default function DispatchChat({ drivers, activeChatDriver, onSelectDriver }) {
  const [selectedDriver, setSelectedDriver] = useState(activeChatDriver || drivers[0]);
  const [inputMessage, setInputMessage] = useState('');
  
  const [messages, setMessages] = useState({
    'd1': [
      { id: 1, sender: 'dispatcher', text: 'Assalomu alaykum John! #LD-78421 bo\'yicha Rate Con biriktirildi.', time: '14:20' },
      { id: 2, sender: 'driver', text: 'Va alaykum assalom! Qabul qildim, omborga 30 daqiqada yetib boraman.', time: '14:22' },
      { id: 3, sender: 'dispatcher', text: 'Kirish: Gate #4, Pickup #9910. BOL qog\'ozini ortgach ilovaga joylang.', time: '14:25' },
      { id: 4, sender: 'driver', text: 'Tushunarli, muhr bilan tushirib ilovaga yuklayman.', time: '14:28' }
    ],
    'd2': [
      { id: 1, sender: 'dispatcher', text: 'Michael, trassa holati qanday? Rejadagi vaqtga yetib borasizmi?', time: '11:05' },
      { id: 2, sender: 'driver', text: 'Hammasi joyida, I-85 bo\'ylab 65 mph tezlikda ketyapman. Kechki 16:00 ga yetib boraman.', time: '11:10' }
    ],
    'd3': [
      { id: 1, sender: 'driver', text: 'Denverdagi ombor yukni qabul qildi, POD imzolandi. Surat ilovada.', time: '12:40' },
      { id: 2, sender: 'dispatcher', text: 'Qabul qilindi Alex. Hozir invoys shakllantirilyapti.', time: '12:44' }
    ]
  });

  const driverMessages = messages[selectedDriver.id] || [];

  const handleSendMessage = (e) => {
    e?.preventDefault();
    if (!inputMessage.trim()) return;

    const newMsg = {
      id: Date.now(),
      sender: 'dispatcher',
      text: inputMessage,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => ({
      ...prev,
      [selectedDriver.id]: [...(prev[selectedDriver.id] || []), newMsg]
    }));

    const sentText = inputMessage;
    setInputMessage('');

    setTimeout(() => {
      let replyText = 'Qabul qilindi.';
      if (sentText.toLowerCase().includes('bol') || sentText.toLowerCase().includes('hujjat')) {
        replyText = 'Hujjatni tekshirib suratini ilovaga yuklayman.';
      } else if (sentText.toLowerCase().includes('qayerdasiz') || sentText.toLowerCase().includes('manzil')) {
        replyText = `Hozir ${selectedDriver.currentLocation} daman, yo'l reja bo'yicha.`;
      }

      setMessages(prev => ({
        ...prev,
        [selectedDriver.id]: [
          ...(prev[selectedDriver.id] || []),
          {
            id: Date.now() + 1,
            sender: 'driver',
            text: replyText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]
      }));
    }, 1200);
  };

  const quickReplies = [
    'Darvoza kodi: #4492',
    'Yuk ortilgach BOL suratini ilovaga yuklang',
    'Harorat setpoint: -18°C',
    'Yuklash vaqti tasdiqlandi'
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[640px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs transition-colors">
      
      {/* Driver List */}
      <div className="border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950 flex flex-col">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-200">Muloqotlar ro'yxati</span>
          <p className="text-xs text-zinc-500 mt-0.5">Haydovchilar ilovasi bilan bog'langan</p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800/60">
          {drivers.map((d) => {
            const isSelected = selectedDriver.id === d.id;
            const lastMsg = messages[d.id]?.[messages[d.id]?.length - 1];

            return (
              <div
                key={d.id}
                onClick={() => setSelectedDriver(d)}
                className={`p-3.5 cursor-pointer transition-colors flex items-center space-x-3 ${
                  isSelected 
                    ? 'bg-zinc-100 dark:bg-zinc-900 border-l-3 border-zinc-900 dark:border-zinc-200' 
                    : 'hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40'
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center font-mono text-xs text-zinc-800 dark:text-zinc-300 flex-shrink-0 font-semibold">
                  {d.name.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 truncate">{d.name}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">{lastMsg?.time || ''}</span>
                  </div>
                  <div className="text-xs text-zinc-500 font-mono truncate">{d.driverNumber} • {d.truck}</div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate mt-1">
                    {lastMsg ? lastMsg.text : 'Yangi suhbat...'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Message Viewport */}
      <div className="md:col-span-2 flex flex-col bg-zinc-50/30 dark:bg-zinc-900/30">
        
        {/* Chat Header */}
        <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-mono text-xs text-zinc-800 dark:text-zinc-200 font-semibold">
              {selectedDriver.name.charAt(0)}
            </div>
            <div>
              <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{selectedDriver.name}</span>
              <span className="text-xs font-mono text-zinc-500 block">{selectedDriver.truck} • {selectedDriver.currentLocation}</span>
            </div>
          </div>

          <a
            href={`tel:${selectedDriver.phone}`}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Phone className="w-4 h-4" />
          </a>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 p-5 overflow-y-auto space-y-3">
          {driverMessages.map((msg) => {
            const isMe = msg.sender === 'dispatcher';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-md px-4 py-2.5 rounded-xl text-sm leading-relaxed ${
                    isMe
                      ? 'bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-950 font-medium'
                      : 'bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs'
                  }`}
                >
                  <p>{msg.text}</p>
                </div>
                <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500 mt-1 px-1 flex items-center space-x-1">
                  <span>{msg.time}</span>
                  {isMe && <Check className="w-3 h-3 text-zinc-400" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Presets */}
        <div className="px-4 py-2 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex items-center space-x-2 overflow-x-auto">
          {quickReplies.map((reply, i) => (
            <button
              key={i}
              onClick={() => setInputMessage(reply)}
              className="text-xs bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 whitespace-nowrap transition-colors font-medium"
            >
              {reply}
            </button>
          ))}
        </div>

        {/* Message Input */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center space-x-2.5">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Xabar yozing..."
            className="flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />
          <button
            type="submit"
            className="bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 p-2 rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

      </div>
    </div>
  );
}
