# T Fleets — Chat auditi

Sana: 25.10.2026. Tekshirilgan kod: `C:/Users/Intel/Desktop/driverweb`; ulangan Supabase loyihasi: `gsnbjpqwwpvqtmphsyfs`.

**Keyingi holat:** ushbu fayl audit paytidagi topilmalarni saqlaydi. Tuzatishlar va yakuniy tekshiruvlar: [Chat tuzatishlari](2026-10-25-chat-fixes.md).

Chatning asosiy arxitekturasi ishlashga mo‘ljallangan: doimiy server tarixi, Realtime, takror yuborishdan himoya, offline navbat, xususiy fayllar, ovoz/video qo‘ng‘iroqlar mavjud. Ammo kamchiliksiz emas. Eng avval uzun tarixdan yangi xabarlarga qaytish, fayl formatlari mosligi va avtomatik sessiya tugashidagi kesh tozalashni tuzatish kerak.

Bu auditda mahsulot kodi va server sozlamalari o‘zgartirilmadi. Haqiqiy chatga xabar/fayl yuborilmadi, qo‘ng‘iroq qilinmadi va ma’lumot o‘chirilmadi. Sinovlar sun’iy ma’lumotlar bilan o‘tkazildi. Quyidagi kod topilmalari bilan amalda ikki qurilmada tekshirilmagan holatlar alohida ko‘rsatilgan.

## Qanday qurilgan

| Qatlam | Vazifasi va mavjud mexanizm |
| --- | --- |
| Sahifa | `DispatchChat.jsx`: haydovchini tanlash, chat ro‘yxati, yozish, qidiruv, fayllar, yozuv va qo‘ng‘iroq holati. Sahifa lazy yuklanadi; boshqa bo‘limga o‘tganda qo‘ng‘iroq uchun komponent saqlanadi. |
| Tarix | `ChatTimeline.jsx` / React Virtuoso: ekranga yaqin xabarlarni render qiladi. Server tarixi sahifalab olinadi, xotiradagi faol oyna 500 xabar bilan cheklangan. Bu serverdagi eski xabarlarni o‘chirish degani emas. |
| Server amallari | `chatService.js`: tarix/qidiruv, yuborish/tahrirlash/o‘chirish, o‘qilgan holati va qo‘ng‘iroqlar uchun Supabase so‘rovlari va RPC. |
| Jonli yangilanish | Supabase Realtime: xabarlar, suhbatlar, qo‘ng‘iroqlar, signal va o‘qilgan holati. Qayta ulanishda REST orqali tarix solishtiriladi; tahrir/o‘chirish revision va tombstone bilan kelishtiriladi. |
| Matn navbati | `chatSession.js`: client operation ID, localStorage outbox, tablar orasida Web Locks, retry va optimistic xabar. Serverdagi idempotency bir xil operatsiya ikki marta yaratilishini cheklaydi. |
| Fayl navbati | `chatMediaOutbox.js`: IndexedDB. Bitta fayl 50 MiB, umumiy navbat 200 MiB va 100 fayl; 7 kunlik retention. `chatStorageService.js` upload va serverdagi media commit’ni ajratadi. |
| Saqlash | `chat_conversations`, `chat_messages`, `chat_calls`, `chat_call_signals` va yordamchi jadvallar. Yangi fayllar xususiy `chat-media` bucket’da; eski Cloudinary fayllarini ochish yo‘li ham mavjud. |
| Qo‘ng‘iroq | WebRTC audio/video; offer/answer/ICE signallari server orqali. TURN/STUN, heartbeat, javob beruvchi qurilmani atomik tanlash va serverdagi eskirgan qo‘ng‘iroqni yakunlash mexanizmlari bor. |
| Bildirishnoma | Realtime/browser bildirishnomasi, push yetkazish navbati va native call fanout. Workerlar serverdagi jadval bo‘yicha chaqiriladi. |

## Aniqlangan kamchiliklar

### C01 · P2 · Uzun tarixdan eng yangi xabarlarga qaytish interfeysga ulanmagan

`DispatchChat.jsx:1465` komponentga `hasNewerMessages` va `onLatest` uzatadi. `ChatTimeline.jsx:65` ularni qabul qilib ishlatmaydi; komponentning hech bir joyida bu parametrlar ishlatilmagan.

`chatSession.js:159–172` bo‘yicha, 500 xabarlik oynadan ortiq eski tarix yuklanganda `detached=true` bo‘ladi. Shu holatda undan yangi xabarlar faol oynaga qo‘shilmaydi. Demak, foydalanuvchi eski yozishmalar ichida qoladi va shu yerdan eng yangi xabarlarga qaytish tugmasi yo‘q. Bu serverda xabar yo‘qolishi emas. Fokus/qayta ulanishdagi to‘liq sync oynani almashtirishi mumkin, lekin foydalanuvchi bunday bilvosita tiklanishga tayanmasligi kerak.

**Dalil:** `node output/chat-audit-probe.mjs` 600 ta sun’iy xabar bilan detached holatini, keyingi xabar ko‘rinmasligini va callback ishlatilmaganini qayta yaratdi.

**Tavsiya:** ko‘rinadigan “Eng yangi xabarlar” tugmasini `onLatest`ga ulash; loading/error holati va 600+ xabarlik UI regressiya testi qo‘shish. Qidiruvning detached holatini ham tekshirish.

### C02 · P2 · Fayl tanlash va serverdagi format cheklovlari mos emas

`DispatchChat.jsx:1522` barcha `image/*,video/*,audio/*` va PDF’ni tanlashga ruxsat beradi. `chatStorageService.js:6` hajm va path’ni tekshiradi, MIME formatini oldindan tekshirmaydi.

Live `chat-media` bucket esa faqat JPEG/PNG/WebP, MP4/QuickTime, AAC/MP4/M4A/MPEG/OGG/WebM audio, PDF va octet-stream qabul qiladi. Masalan, odatiy MIME bilan kelgan GIF/HEIC yoki `video/webm` tanlanishi mumkin, ammo Storage yuklashni rad etadi. Bu haqiqiy fayl yubormasdan UI kodi va live bucket konfiguratsiyasi bilan tasdiqlandi.

**Tavsiya:** umumiy ruxsat etilgan formatlar ro‘yxati, upload’dan oldin tushunarli xato, kerak bo‘lsa HEIC yoki boshqa formatni konvertatsiya qilish. Server cheklovini shunchaki barcha formatga ochish shart emas.

Manba: [Supabase upload restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets#restricting-uploads).

### C03 · P2 · Avtomatik logout’da mahalliy chat ma’lumotlari qoladi

`chatSession.js:131–140` oxirgi 5 suhbatning 100 tadan xabarini va draft’ni localStorage’da ochiq JSON sifatida saqlaydi. Media outbox IndexedDB’da fayl nusxalarini saqlaydi. Bu tez ochilish va offline ishlash uchun qilingan.

`App.jsx:115–120`dagi qo‘lda logout keshni tozalaydi. Ammo `useAuth.js:60–62`dagi auth hodisasi faqat session holatini almashtiradi. Chat unmount’i keshni flush qiladi (`DispatchChat.jsx:355`); oddiy `close()` saqlangan yozuvni o‘chirmaydi. Sessiya muddati tugashi yoki tashqaridan bekor qilinishi shu tozalash yo‘lidan o‘tmaydi.

Bu boshqa ilova hisobi interfeysda oldingi chatni ko‘radi degani emas: scope user/company/role bo‘yicha ajratilgan, `App.jsx:104–105` komponentni qayta yaratadi. Lekin umumiy kompyuterda mahalliy saqlashni o‘qiy oladigan shaxs yoki shu origin’da ishlaydigan zararli script uchun yozishma nusxasi qoladi.

**Dalil:** audit probe `flush → close`dan so‘ng sun’iy matn localStorage adapterida qolishini tasdiqladi; auth cleanup bo‘shlig‘i koddan tekshirildi.

**Tavsiya:** `SIGNED_OUT` va account/tenant almashishida oldingi scope’ni tozalaydigan yagona lifecycle; offline qolish bilan haqiqiy logout’ni farqlash; oldingi async yozuvlar keshni qayta yaratmasligi uchun epoch himoyasini saqlash.

### C04 · P2 · Qo‘ng‘iroqning tarmoq uzilishidan tiklanishi cheklangan

`DispatchChat.jsx:657–659` ICE signalini yuborish xatosini yutadi va signalni qayta yubormaydi. `668–679`da disconnected holati 15 soniyadan keyin qo‘ng‘iroqni yakunlaydi. `restartIce()` orqali yangi tarmoq yo‘lini qidirish mavjud emas.

Wi-Fi’dan mobil internetga o‘tish yoki qisqa tarmoq nosozligida WebRTC o‘zi tiklana olmasa, foydalanuvchi qayta qo‘ng‘iroq qilishi kerak. Bu kod bilan tasdiqlangan cheklov; haqiqiy ikki qurilmada tarmoq almashtirish tajribasi ushbu auditda bajarilmadi.

**Tavsiya:** cheklangan signal retry/navbati, ICE restart va qayta negotiation, keyin timeout bilan yakunlash; ikki brauzer va Wi-Fi/mobil tarmoq sinovi.

### C05 · P2 · Ovoz yozuvi vaqtida hajm/davomiylik limiti yo‘q

`DispatchChat.jsx:1135` audio bo‘laklarini xotiraga yig‘adi; `1146` har 250 ms ma’lumot oladi. Davomiylik yoki yig‘ilgan bayt bo‘yicha avtomatik to‘xtatish yo‘q. 50 MiB cheklovi yozuv tugagandan keyin fayl navbatiga qo‘shishda tekshiriladi.

Natija: juda uzun yozuv xotira sarflaydi va faqat oxirida rad etilishi mumkin. Bundan tashqari, MIME fallback boshqa format bo‘lsa ham nom `.webm` qilinadi (`1139–1141`); bu format nomini MIME’ga moslash kerak.

**Tavsiya:** yozuv paytida bayt/vaqt limitlari, qolgan vaqt ko‘rsatkichi, bekor qilish va MIME’ga mos kengaytma. Haqiqiy mikrofon yozuvi bu auditda yoqilmadi.

### C06 · P2 · Suhbatlar preview ro‘yxatida parent pagination yo‘q

`chatService.js:272–285` barcha suhbatlarning oxirgi xabarini bir so‘rovda oladi. `.limit(1, { referencedTable: 'chat_messages' })` xabarlarga tegishli; suhbatlar uchun keyingi sahifa/cursor yo‘q.

Katta ro‘yxatda server response limiti sabab ayrim preview’lar kelmasligi va tez-tez yangilanish ko‘p o‘qish talab qilishi mumkin. Hozirgi kichik ro‘yxatda yo‘qolgan preview tasdiqlanmadi; aniq row limit bu tekshiruvda olinmadi.

**Tavsiya:** parent suhbatlarni cursor bilan sahifalash, kerakli haydovchilar uchun oxirgi xabar/unread summary RPC; staging’da ko‘p suhbat bilan sinov.

### C07 · P2 · Hisob darajasidagi leaked-password himoyasi hali o‘chiq

25.10.2026 live security advisor `auth_leaked_password_protection` ogohlantirishini qaytardi. Bu chatning alohida koding xatosi emas, chatga kiradigan akkauntlar himoyasi masalasi. Hisob buzilganiga dalil topilmadi.

Avval foydalanuvchi bu sozlamani qo‘lda yoqishini bildirgan; auditda sozlama o‘zgartirilmadi. Hozirgi tekshiruvda ham o‘chiq qaytdi.

Tavsiya va rasmiy yo‘riqnoma: [Password strength and leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Ishlayotgan himoyalar va ijobiy jihatlar

- Chat jadvallarida RLS yoqilgan; suhbatni o‘qish company va ishtirokchi bilan cheklangan. Faol profil tekshiruvi bor.
- Chatning asosiy command RPC’lari anonimga execute bermaydi; tekshirilgan SECURITY DEFINER funksiyalarda search_path o‘rnatilgan. Authenticated uchun execute mavjudligi o‘zi zaiflik degani emas: role/tenant tekshiruvi bilan ishlaydigan RPC shunday quriladi.
- MFA yoqilgan hisoblar uchun chat jadvallarida `enrolled_mfa_required` RESTRICTIVE siyosati bor. Bu har bir hisobda MFA majburiy yoqilgan degani emas.
- `chat-media` private, 50 MiB cheklovli. Fayl ownership va conversation bog‘lanishi serverda tekshiriladi.
- Cloudinary live v35 kodi barcha ko‘rilgan signedUrl oqimida 900 soniyalik vaqtinchalik URL qaytaradi. Avvalgi auditdagi v32 muddatsiz yangi URL chiqarish holati hozirgi deployed kodda takrorlanmadi. Eski chiqarilgan linklarning barchasi bekor qilinganini bu audit tasdiqlamaydi.
- Matn React orqali render qilinadi; ko‘rilgan xabar oqimida raw HTML injection topilmadi. Faylni alohida ochish yo‘li URL protokolini tekshiradi.
- Takror yuborish, edit/delete revision, tombstone, ko‘rinadigan xabarlar uchun read receipt, qidiruvdagi eski javoblarni bekor qilish, logout epoch va media commit/cleanup race himoyalari bor.
- WebRTC transport himoyasi mavjud, lekin matn/fayl tarixi uchun foydalanuvchidan foydalanuvchigacha E2EE implementatsiyasi topilmadi. Serverda saqlangan tarixni E2EE deb ta’riflash to‘g‘ri emas.

## Live worker va yetkazish holati

- `drivex-chat-push`: faol, har 10 soniya; `drivex-chat-media-cleanup`: faol, har 5 daqiqa.
- Tekshiruvning 24 soatlik oynasida push cron 8616 muvaffaqiyatli va 1 xatoli ishga tushish, media cron 288 muvaffaqiyatli ishga tushish qaytardi. Cron success — HTTP chaqiruv navbatga qo‘yilganini bildiradi, qurilmaga yetib borganini emas.
- Push delivery jadvalida oldingi `sent` yozuvlar bor (web 5, Android 1); cancelled yozuvlar ham bor. Native FCM incoming-call uchun 2 ta `sent` yozuv bor. Joriy status agregatlarida pending/failed push backlog ko‘rinmadi. `sent` foydalanuvchi xabarni ko‘rganini isbotlamaydi.
- Media delete job agregatida 5 completed yozuv qaytdi.
- `worker_cron.last_invocations` bilan `net._http_response` join’da javob statusi topilmadi; shuning uchun eng oxirgi HTTP worker javobi muvaffaqiyatli deb da’vo qilinmadi.
- Eski `docs/chat-cron.md`da push’ni paused saqlash haqida yo‘riq bor; bu live holat bilan mos emas. Runbook’ni yangilash kerak.

## Kod sifati va test bo‘shliqlari

- `DispatchChat.jsx` 1700+ qator: chat UI, outbox, audio recorder, WebRTC va signal boshqaruvini birlashtiradi. Uni history/composer/media/call controller bo‘lib ajratish regressiya xavfini kamaytiradi. Bu o‘zi ishlamaslik xatosi emas.
- Backendda `set_chat_user_block` va `report_chat_message` mavjud; ko‘rilgan web DispatchChat/service oqimida ularga ulangan amal yo‘q. Web’da bu boshqaruvlar kerak bo‘lsa, xavfsizlik imkoniyati interfeysga chiqarilmagan. Mobil tomondagi ishlatilishi ushbu web audit doirasidan tashqarida.
- Mavjud timeline fixture qo‘lda “Replace with latest 100” tugmasini o‘zi yaratadi; komponentdagi yo‘qolgan `onLatest` tugmasini aniqlamaydi. Ko‘p xabarli haqiqiy component contract testi kerak.
- Ikki haqiqiy qurilmada yuborish/qabul qilish, brauzer yopiq paytdagi push, Safari/iOS audio, TURN-only tarmoq, katta video upload va uzoq uzilishlar sinovi qolgan. Bularni bajarilmagan holda 100% ishlaydi deyish mumkin emas.

## Bajarilgan sinovlar

1. Chat/session/reliability/subscription, RTC signal queue, attachment URL, browser notification receiver, timeline yordamchi modullari, chat worker va native-call-push uchun mavjud Node testlari o‘tdi.
2. `npm run test:chat-db` — izolyatsiya qilingan PostgreSQL testlari o‘tdi: tenant/RLS, permission, unread, idempotency, search, read receipts, cheklovlar, qo‘ng‘iroq participant race va upload cleanup/commit race. Log: `output/chat-audit-db.log`.
3. `npm run test:native-call-db` — izolyatsiya qilingan SQL testlari o‘tdi: fanout, expiry, device ownership, ikki qurilma answer race va transfer. Log: `output/chat-audit-native-db.log`.
4. `node output/chat-audit-probe.mjs` — uzun tarixdagi mavjud uzilish va cache close’dan keyingi local persistence sun’iy ma’lumot bilan qayta yaratildi.
5. Live metadata: RLS/policy/grant, bucket, Realtime publication, cron, delivery status agregatlari, security advisor va deployed Cloudinary kodini faqat o‘qish orqali tekshirish.

Ustuvor ketma-ketlik: C01 → C02 → C03 → C04/C05 → C06. C07 alohida Supabase Auth sozlamasi. O‘zgarishlardan keyin katta tarix, avtomatik logout, formatlar va ikki qurilmali qo‘ng‘iroq uchun yakuniy integratsion sinov zarur.
