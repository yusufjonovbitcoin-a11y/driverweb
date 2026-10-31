# T Fleets — audit tuzatishlari

Sana: 24.10.2026. Ishchi loyiha: `C:/Users/Intel/Desktop/driverweb`. Backend: `gsnbjpqwwpvqtmphsyfs`. Asos: `docs/2026-10-24-web-audit.md`.

Koddagi aniqlangan funksional xatolar, dependency zaifliklari va asosiy server xavflari tuzatildi. Frontend o‘zgarishlari lokalda tayyor; quyida ko‘rsatilgan SQL va Edge o‘zgarishlari ulangan backendga qo‘llandi. Frontend production relizi bu ishda amalga oshirilmadi. Sizib chiqqan parollarni bloklashni foydalanuvchi qo‘lda yoqishni tanladi.

## Natijalar

| Audit | Holat va tuzatish |
| --- | --- |
| A01 — muddatsiz media URL | `cloudinary-media` barcha xususiy scope uchun 900 soniyalik, provider tomonidan muddati tekshiriladigan URL beradi. Oldingi 5 asset identifikatori faylni o‘chirmasdan almashtirildi. Eski 5 URL rad etildi; yangi 5 muddatli URL ochildi. |
| A02 — hisob-kitob tarixi | Tasdiqlangan hisob, to‘liq tahrirlangan snapshot va aynan ko‘rilgan PDF serverda doimiy saqlanadi. Ro‘yxat yengil summary o‘qiydi, tafsilot va PDF alohida yuklanadi. Kompaniya/admin RLS, SHA-256, hajm, versiya, takror tasdiqlash va parallel tasdiqlash nazorati qo‘shildi. Storage FK tasdiqlash bilan bir vaqtdagi fayl o‘chirishni ham cheklaydi. Qayta ochishda ruxsat va fayl yaxlitligi yangidan tekshiriladi. |
| A03 — Vite/Windows | Vite 8.3.5 ga yangilandi; dev server loopback va aniq hostlar bilan ishlaydi. |
| A04 — dependency | mailparser 3.12.4, imapflow 2.9.1, ip-address 10.7.4; Gmail Deno lock ham yangilandi. Yakuniy npm audit: 0 zaiflik. |
| A05 — masofa | Hujjatdagi mavjud masofa saqlanadi. Yetishmagan loaded miles faqat ayni load, assignment, driver va USD snapshotidan olinadi; deadhead yoki umumiy masofa bilan almashtirilmaydi. Haqiqiy #2536705 snapshotida 288.23 mi borligi tekshirildi. |
| A06 — driver holati | Ro‘yxat va driver tafsilotlari umumiy `driverRosterState` qoidalaridan foydalanadi: suspended, faol load, duty status. Jonli ro‘yxat va tafsilotda «Не на смене» mosligi tekshirildi. |
| A07 — release/migratsiya farqi | Lokal/server 108 ta migratsiya versiyasi to‘liq mos. Earnings fayllari serverning haqiqiy timestampiga moslandi. Gmail business sender/pending scope va worker yangilandi. Pochta workerining avvalgi paused holati saqlandi. |
| A08 — CI qamrovi | Barcha maxsus Playwright konfiguratsiyalari `test:ui:all` orqali CIga qo‘shildi. PDF document-content yordamchi testlari, durable settlement, MFA va earnings SQL tekshiruvlari ham CIga kiritildi. Test globlari shell tomonidan bir qavatli ro‘yxatga aylantirilmasligi uchun qo‘shtirnoqqa olindi; Node 22.18 bilan ham barcha 906 test o‘tdi. |
| A09 — Windows/Linux | Izolyatsiya qilingan PostgreSQL sinovlari Windowsda TCP, Linuxda socket ishlatadi; Windows pg_ctl pipe va tozalash retry muammolari tuzatildi. Chrome tanlash umumlashtirildi, CRLF manba tekshiruvlari moslandi, LF qoidalari qo‘shildi. Test hisobotlari va fixture buildlari dev sahifasini qayta yuklamasligi uchun watcher’dan chiqarildi. |
| A10 — analitika tillari | Analitika matnlari RU/EN/UZ kataloglariga o‘tkazildi. Pul, raqam va sanalar umumiy formatterlardan foydalanadi. Til sahifani qayta ochmasdan yangilanadi; uch til desktop va mobile sinovidan o‘tdi. |
| A11 — hisob himoyasi | Autentifikatorni ulash, QR/qo‘lda kalit, kodni tekshirish, kirishda challenge va olib tashlash oqimlari qo‘shildi. Enrolled foydalanuvchilar AAL2siz REST/RPC, public RLS jadvallari, Realtime va Storage ma’lumotlariga kira olmaydi. Service orqali profil tekshiradigan Cloudinary/Gmail/TURN funksiyalariga ham user MFA tekshiruvi qo‘shildi. Leaked-password protection qo‘lda yoqilishi kerak. |
| A12 — CSP | `vercel.json` endi faqat report-only emas, to‘liq enforced CSP tayyorlaydi. Inline scriptlar va script atributlari bloklanadi. PDF worker, blob yuklash va WASM zarur ruxsatlari saqlangan; production build ostida PDF render sinovi o‘tdi. Haqiqiy hostingda kuchga kirishi uchun frontend relizi kerak. |
| A13 — eski kod | 26 ta production entry’dan foydalanilmaydigan modul, prototype CSS va qo‘llanmagan eski finance migratsiyasi `tests/legacy/`ga ko‘chirildi; test importlari moslandi. Fayllar yo‘qotilmadi; manifest va dastlabki SHA qiymatlari `docs/legacy-source-archive.json`da. Test/arxiv va mahalliy audit artefaktlari deploydan chiqarildi, output/tmp Git ignore’ga qo‘shildi. |
| A14 — indeks/grantlar | Asosiy assignment/document/chat/financial yo‘llariga 28 ta takrorlanmaydigan indeks qo‘shildi, 38 ta FK qamrab olindi. Trigger helperning PUBLIC/anon/authenticated EXECUTE granti bekor qilindi. Qolgan INFO maslahatlar quyida triage qilingan. |

## Serverga qo‘llangan o‘zgarishlar

- `20261024130206_durable_driver_settlements.sql`
- `20261024130621_gmail_business_pending_scope.sql`
- `20261024132752_settlement_pdf_referential_integrity.sql`
- `20261024132800_operational_foreign_key_indexes.sql`
- `20261024132837_enrolled_mfa_session_guard.sql`
- `20261024134146_mfa_hook_invoker_permissions.sql`

Edge: `cloudinary-media` v34, `gmail-sync-worker` v6, `gmail-integration` v23, `turn-credentials` v26. Avvalgi JWT gateway rejimlari saqlandi; gateway o‘chiq funksiyalarning o‘z ichki autentifikatsiya tekshiruvlari saqlangan.

## Tekshiruvlar va dalillar

- 906 Node testi Node 24 va CI minimal Node 22.18 versiyalarida o‘tdi. 34 Deno yordamchi testi, lint, i18n parity/manba kalitlari, build va 11 tarixiy migratsiya hash tekshiruvi ham o‘tdi.
- Playwright: yakuniy umumiy yugurishda 12 ta konfiguratsiya, jami 160 desktop/mobile test bajarilishi xatosiz o‘tdi. PDF inline tahrirlash, reload/persistence, yo‘qolgan tasdiqlash javobini qayta urinish, ruxsat bekor qilinishi, uch tilda analitika, modal fokus, kalendar va accessibility qamrab olindi.
- 8 ta izolyatsiya qilingan SQL suite: chat, driver brief, load/backend integrity, native call, Gmail cloud worker, durable settlement, MFA va earnings. Haqiqiy biznes ma’lumotlariga test yozilmadi.
- `output/remediation-node-verified.log`, `remediation-node22-ci.log`, `remediation-edge-tests.log`, `remediation-all-ui-clean.log`, `remediation-*-sql*.log` va `remediation-media-verified-final.log` mahalliy dalillarni saqlaydi. Output katalogi Git/deployga kirmaydi.
- npm auditda critical/high/moderate/low: 0. Lokal HTTP health check: 200. Jonli analytics o‘qilishi va driver holati tekshirildi. Yakuniy IAB qayta ochish tekshiruvi brauzerning vaqtinchalik socket/error-page chekloviga uchradi; xavfsizlik sozlamalari chetlab o‘tilmadi.

## Qolgan administrator amallari va chegaralar

1. Supabase Dashboard’da loyiha → Authentication → parol/email xavfsizlik sozlamalari → **Leaked password protection**ni yoqing. Panelda login mavjud bo‘lmagani uchun o‘zgartirilmadi; foydalanuvchi uni qo‘lda yoqishni tanladi. Agar tarif bu funksiyani bermasa, uni yoqilgan deb hisoblamang.
2. Profil → Xavfsizlik orqali har bir foydalanuvchi autentifikatorini o‘zi ulaydi va kodni kiritadi. Audit vaqtida verified faktorlar 0 edi. Hech kim foydalanuvchi nomidan MFAga ulanmagan; unenrolled hisoblar hozircha ishlashda davom etadi.
3. Frontend va CSP hostingda kuchga kirishi uchun sinovdan o‘tgan kod odatiy release jarayoni bilan chiqarilishi kerak. Bu ishda production frontend deploy yoki foydalanuvchi xabarlari/PDF yuborish bajarilmadi.
4. Advisor’da 100 ta indeksiz FK INFO va 39 ta unused-index INFO qoldi, shu jumladan yangi indekslar. Ular tasdiqlangan data access zaifligi emas. Asosiy faol yo‘llar indekslandi; qolgan indekslarni faqat haqiqiy yuklama va query plan bo‘yicha qo‘shish, unused indekslarni esa yetarli kuzatuvsiz o‘chirmaslik qarori olindi. 7 ta RLS/no-policy INFO private yoki worker jadvallarini klientdan yopib turadi. 113 ta authenticated SECDEF maslahatlari role/tenant tekshiruvchi biznes RPC’lar bo‘lib, ularni ommaviy revoke qilish ilovani buzadi. Anon SECDEF ogohlantirishi qolmadi.
5. Tasdiqlangan hisob tarixining eski, faqat xotirada bo‘lgan nusxalarini qayta tiklab bo‘lmaydi. Yangi tasdiqlashlar doimiy saqlanadi. Tasdiqlash to‘lov amalga oshganini anglatmaydi.

Bu natijalar tekshirilgan kod va joriy backend holatiga tegishli; barcha kelajak holatlar uchun mutlaq xavfsizlik kafolati emas.
