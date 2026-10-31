# Chat tuzatishlari — 25.10.2026

Doira: [Chat auditi](2026-10-25-chat-audit.md)dagi C01–C06 va tekshiruvda topilgan qo‘ng‘iroq heartbeat sikli. Mahalliy web ilovada bajarildi; ushbu ishda haqiqiy suhbatga xabar/fayl yuborilmadi, odamga qo‘ng‘iroq qilinmadi va server tarixi o‘chirilmadi. Production deploy qilinmadi.

## Natija

| Topilma | Tuzatish | Tekshiruv |
| --- | --- | --- |
| C01: uzun tarixdan yangi xabarlarga qaytish | `ChatTimeline` mavjud `onLatest` amalini ko‘rsatadi, yuklanish/xato/qayta urinishni boshqaradi va yangi oynaning pastiga joylashadi. | Haqiqiy React komponentida 800 ta sun’iy xabar, StrictMode, birinchi so‘rov xatosi va qayta urinish. 800-xabar ko‘rinishi tekshirildi. |
| C02: fayl formatlari | Yagona MIME allowlist, hajm va bo‘sh fayl tekshiruvi; MediaRecorder codec parametrlari normallashtiriladi. Picker, outbox va upload bir siyosatdan foydalanadi. | Live private bucket MIME ro‘yxati bilan solishtirildi. GIF/HEIC/video WebM kabi qo‘llanmaydigan formatlar serverga yuborilishidan oldin rad etiladi. UI testi xato va nol upload so‘rovini tekshiradi. |
| C03: avtomatik logout | Auth lifecycle oldingi tasdiqlangan account/company/role scope’ni logout yoki hisob almashishida tozalaydi. Local history/outbox epoch React unmount’dan oldin bekor qilinadi; IndexedDB fayl navbati tozalanadi. Token refresh/offline profil xatosi logout deb qabul qilinmaydi. | Haqiqiy cache yordamchilari bilan logout → kechikkan flush, token refresh, hisob va kompaniya almashishi testlari. |
| C04: qo‘ng‘iroq tiklanishi | Alohida RTC controller: cheklangan signal retry, timeout/abort, ICE restart, parallel offer uchun polite rollback, takror/stale signal himoyasi, 40 soniyalik tiklanish muddati. Realtime ishlamasa signal va qo‘ng‘iroq statusi REST orqali tekshiriladi. | Real Chromium peer juftligi: bir ICE signal xatosi, restart va simultaneous offer. Unit testlar: timeout, abort, stale SDP, dublikat va recovery deadline. |
| C05: ovoz yozuvi | 5 daqiqa / 10 MiB limit, vaqt ko‘rsatkichi va bekor qilish. Fayl kengaytmasi MIME’ga mos. Limitdan oshgan container bo‘lagini kesib, buzilgan audio yuborish o‘rniga yozuv rad etiladi. | Vaqt/bayt/cancel testlari; real MediaRecorder sun’iy audio yozuvi dekodlanib, ijro qilinishi va track’lar yopilishi tekshirildi. |
| C06: suhbat preview pagination | O‘zgarmas conversation ID bo‘yicha cursor; oxirgi bo‘sh sahifagacha o‘qish, dedupe, tartiblash, noto‘g‘ri cursor va qisman xato himoyasi. Signal tarixi ham cursor bilan olinadi. | Server 37 tadan qaytargan holatda 1205 suhbat to‘liq o‘qildi; xato bo‘lsa qisman ro‘yxat muvaffaqiyat sifatida saqlanmaydi. |

Qo‘shimcha tuzatishlar:

- Heartbeat effect butun `activeCall` obyektiga bog‘liq edi. Har heartbeat serverda UPDATE yaratib, Realtime orqali yangi obyekt qaytarishi va yana heartbeat boshlashi mumkin edi. Endi interval faqat accepted call ID bilan boshqariladi. UI regressiya testi server UPDATE’ni taqlid qiladi: birinchi heartbeat, 20 soniyadan keyin ikkinchi; sikl yo‘q.
- Realtime orqali hangup kelmasa, REST status tekshiruvi mahalliy call va mikrofonni yopadi. UI testi aynan shu holatni tekshiradi.
- Qo‘ng‘iroq almashganda eski async signal so‘rovi yangi call cursor’ini almashtirmaydi.
- Matn kiritishning IME composition bosqichidagi Enter tasodifan xabar yubormaydi.
- Yozuv yoki upload davomida ikkinchi attachment amali bloklanadi; mikrofon ruxsati bo‘yicha kechikkan xato yangi suhbatga tushmaydi.
- RTC, yozuv, MIME, privacy lifecycle va preview pagination alohida testlanadigan modullarga ajratildi. Katta chat UI’ni to‘liq qayta yozish amalga oshirilmadi.
- `docs/chat-cron.md` live jadval bilan moslashtirildi.
- Realtime summary kanali qayta mount/HMR paytida asinxron yopilayotgan eski kanal bilan to‘qnashishi mumkin edi. Yangi subscription uchun noyob topic, idempotent cleanup va HMR dispose qo‘shildi. Haqiqiy service moduli bilan asinxron unsubscribe regressiya testi o‘tdi.

## Server holati

Faqat o‘qish orqali qayta tekshirildi:

- Private `chat-media` bucket formatlari saqlangan; server cheklovlari kengaytirilmadi.
- Chat push har 10 soniyada, media cleanup har 5 daqiqada faol. 25.10.2026 08:50 UTC atrofidagi `worker_cron.last_invocations`: HTTP 200, failed=0, deadlineReached=false. Qurilma bildirishnomani ko‘rganini bu tasdiqlamaydi.
- C07: Supabase security advisor hanuz `auth_leaked_password_protection` o‘chiq ekanini ko‘rsatmoqda. Foydalanuvchi avval buni qo‘lda yoqishini bildirgan. Ushbu server Auth sozlamasi o‘zgartirilmadi.
- SECURITY DEFINER RPC uchun authenticated execute ogohlantirishi o‘zi ruxsat chetlab o‘tish dalili emas; mavjud tenant/ishtirokchi/RLS/MFA cheklovlari va SQL regression testlari saqlandi.

## Bajarilgan tekshiruvlar

- `npm test` — 926 ta Node testi o‘tdi.
- `npm run lint`, `npm run i18n:check`, `npm run build`.
- `npx playwright test --config playwright.chat-reliability.config.js` — 5 ta browser testi: tarix, real RTC juftligi, real MediaRecorder audio, production call UI/heartbeat/hangup, attachment validation.
- `npm run test:chat-db` — izolyatsiyalangan PostgreSQL: RLS/tenant/permission, read/unread, idempotency, search, qo‘ng‘iroq ishtirokchilari race, media upload/cleanup race.
- `npm run test:native-call-db` — izolyatsiyalangan native call fanout, expiry, device ownership, answer/transfer race.
- Mahalliy `http://127.0.0.1:5174/#chat` tekshirildi. Kodni jonli yangilashda topilgan Realtime kanal to‘qnashuvi tuzatildi; yakuniy tekshiruv sahifani toza yuklash bilan bajarildi.

Loglar: `output/chat-fix-{full-tests,lint,i18n,build,browser,db,native-db}.log`.

Chegara: real ikki qurilmada Wi-Fi → mobil tarmoq almashishi, TURN-only tarmoq, Safari/iOS yozuvi va brauzer yopiq paytdagi push yetkazilishi ushbu avtomatik sinov bilan tasdiqlanmagan. Matn/fayllar uchun E2EE qo‘shilmadi. Ixtiyoriy block/report web UI imkoniyati bu auditdagi funksional bug tuzatishlaridan alohida qoladi; backend imkoniyati mavjud.
