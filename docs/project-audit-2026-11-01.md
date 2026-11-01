# T Fleets — loyiha auditi va o‘sish rejasi

Sana: 2026-11-01. Tekshirilgan checkout: `C:/Users/Intel/Desktop/driverweb`.

Bu hisobot joriy kod, yangi bajarilgan testlar va Supabase’dan faqat o‘qish orqali olingan holatga asoslangan. Audit davomida production ma’lumotlari, vazifalar, foydalanuvchilar va sozlamalar o‘zgartirilmadi. Oldingi bajarilgan, hali commit qilinmagan ishlar saqlandi.

## 1. Asosiy baho

Loyiha ishlaydigan TMS operatsion yadrosiga ega: haydovchi va texnika boshqaruvi, yuk importi/tayinlash, marshrut, hujjat versiyalari, chat/qo‘ng‘iroqlar, hisob-kitob va moliyaviy analitika mavjud. Uni yana to‘liq qayta yozish uchun asos topilmadi.

Keyingi eng foydali bosqich — mavjud jarayonlarni kuzatiladigan va qayta tiklanadigan qilish. Hozir asosiy xavflar alohida ekranlarning ko‘rinishidan ko‘ra, tashqi xizmat xatosidan keyin ishning yakunlanmay qolishi, admin himoyasi, testlarni chiqarishga ulash va tarix ko‘paygandagi ma’lumot yuklanishidir.

«1022 test o‘tdi» degani butun tizim xatosiz yoki katta park uchun sinovdan o‘tgan degani emas. Quyida tasdiqlangan holatlar va hali o‘lchanmagan xavflar alohida ko‘rsatilgan.

## 2. Bajarilgan tekshiruvlar

| Tekshiruv | Natija |
|---|---|
| `npm test` | 1022/1022 o‘tdi; taxminan 4.1 soniya |
| `npm run lint` | O‘tdi |
| `npm run build` | O‘tdi; katta chunk ogohlantirishi bor |
| i18n | 2067 tarjima elementi, 833 koddan ishlatilgan kalit tekshirildi; parity o‘tdi |
| Migration ledger | 11 canonical hash va forward contract tekshiruvi o‘tdi; bu barcha migrationlar jonli bazaga mosligining to‘liq attestatsiyasi emas |
| Izolyatsiyalangan moliyaviy DB sinovi | 204 qatorli snapshot, tasdiqlangan summalar, trash filtri, tenant/rol/RLS chegaralari o‘tdi |
| Izolyatsiyalangan MFA DB sinovi | Enroll qilingan hisobda AAL1 rad etilishi, AAL2 va service yo‘li o‘tdi |
| Umumiy konfiguratsiyadagi desktop sinovi | 28 tadan 18 o‘tdi, 10 profil testi yiqildi; sabab quyida |
| To‘g‘ri profil konfiguratsiyasidagi desktop sinovi | 21/21 o‘tdi; taxminan 45.7 soniya |
| Dependency audit | 1 ta HIGH advisory; ekspluatatsiya yo‘li tasdiqlanmagan |
| Jonli Supabase | Advisorlar, vazifa navbatlari, Cron jadvali, Gmail holati va MFA enroll agregatlari o‘qildi |

MFA va moliyaviy DB harnesslari bir xil test portidan foydalangani uchun dastlab parallel ishga tushirishda port band bo‘ldi. MFA sinovi keyin alohida bajarilib o‘tdi; bu mahsulot nosozligi emas.

Test dalillari `tmp/project-audit-*.log`, dependency natijasi `tmp/project-audit-dependencies.json` ichida. Bu lokal, Git’dan chiqarilgan yordamchi fayllar; hisobot ularning mavjud bo‘lishiga bog‘liq emas.

## 3. Ustuvor kamchiliklar

### P1 — 3 ta faol tayinlovda haydovchi to‘lovi hisoblanmay qolgan

**Jonli holat tasdiqlandi:** `driver.pay_calculation` turidagi 3 ta vazifa `dead_letter` holatida; har birida 8 urinish bajarilgan. Xato kodi `DRIVER_PAY_PROVIDER_UNAVAILABLE`. Ular hali `active` assignment va `assigned` yuklarga tegishli; `assignment_driver_pay` yozuvi yo‘q.

Bu vazifalar 2026-10-31 kuni oxirgi marta yangilangan. Hozir provayderning o‘zi hamon ishlamayotganini bu agregat isbotlamaydi: xizmat tuzatilgan bo‘lsa ham eski vazifa yakunlanmay qolishi mumkin.

**Ta’sir:** yuk ish jarayoni davom etishi mumkin, lekin to‘lov tayyor bo‘lmaydi. Keyingi buxgalteriya va analitikada to‘liq bo‘lmagan qiymatlar qoladi.

**Tavsiya:** avval shu uch holatning sababini request/job bo‘yicha tekshirish; provayderni tiklash; saqlangan START nuqtasi va stavkani o‘zgartirmay, mavjud idempotent retry yo‘li bilan qayta ishlash. Provayder xatosini faqat «кутинг» holatida qoldirmasdan, mas’ul xodimga ko‘rsatish va ogohlantirish. Bu auditda qayta ishlash bajarilmadi.

Kod: `supabase/functions/calculate-driver-start-pay/index.ts`, `supabase/functions/_shared/driver-start-pay.ts`, `src/services/assignmentDriverPay.js`, `supabase/migrations/20261008164042_driver_start_pay_audit_hardening.sql:123`.

### P1 — admin va dispetcherlarda MFA enroll qilinmagan

Jonli agregatda faol 2 ta `super_admin`, 2 ta `company_admin`, 1 ta `dispatcher` uchun verified MFA omili soni 0.

Mavjud guard MFA’ni enroll qilingan hisoblarda to‘g‘ri majbur qiladi. Lekin verified faktor yo‘q bo‘lsa AAL1 sessiya ruxsat oladi. Bu buzilgan MFA tekshiruvi emas, majburiy enroll siyosati yo‘qligidir.

Haydovchi parolini keyin ko‘rish funksiyasi mavjudligi bu xavfni kuchaytiradi. Saqlash ochiq matnda emas: Vault bilan shifrlanadi; reveal kompaniya admini va o‘z kompaniyasi bilan cheklangan, audit/rate-limit/no-store bor. Shunga qaramay, admin hisobiga kirgan shaxsning vakolati katta.

**Tavsiya:** avval privileged hisoblarni MFA’ga enroll qilish; keyin serverda adminlar uchun majburiy siyosat, parolni ochish/almashish kabi amallarga yaqinda qayta tasdiqlangan sessiya. Qayta ko‘rinadigan sirlarni zarur bo‘lmagan joyga kengaytirmaslik.

Kod: `supabase/migrations/20261024132837_enrolled_mfa_session_guard.sql:5`, `supabase/functions/_shared/driver-password-access.ts`, `supabase/functions/read-driver-password/handler.ts`, `supabase/migrations/20261026085439_driver_password_vault.sql`.

Leaked-password himoyasi hamon o‘chiq. Siz uni Pro tarifiga o‘tgach yoqishni rejalashtirgansiz; bu ma’lum keyingi ish, qolgan himoyalarni kechiktirish uchun sabab emas. Oldin ulashilgan maxfiy kalitlar almashtirilganini ham tekshirib qayd etish kerak; bu audit ularning rotation holatini tasdiqlamadi.

### P1 — CI UI testlarini noto‘g‘ri konfiguratsiyada ham ishga tushiryapti

`playwright.config.js` barcha `tests/ui/*.spec.js` fayllarini umumiy 5186 serveriga yuboradi. Ammo `profile-settings.spec.js` uchun 5188 serveri va maxsus service/auth mocklari kerak.

Auditda bu aniq takrorlandi: umumiy konfiguratsiyada profil testlaridan 10 tasi yiqildi; `playwright.profile-settings.config.js` bilan 21/21 o‘tdi. Masalan, umumiy serverda `window.__profileAuth` yo‘q va saved-password chaqiruvlari kerakli stubga bormaydi. Bularni foydalanuvchi sahifasidagi 10 ta tasdiqlangan bug deb hisoblash noto‘g‘ri.

**Tavsiya:** har bir suite’ni o‘z konfiguratsiyasiga biriktirish; umumiy suite’dan ajratilgan fixture testlarini chiqarish. CI’da xuddi shu konfiguratsiyalar matritsasini ishlatish.

Bundan tashqari, workflow backend integrity testiga `PENDING_DRIVER_PAY_TEST`, `START_PAY_AUDIT_TEST`, `STAFF_DOCUMENT_TEST`, `STAFF_COMPLETION_TEST` flaglarini bermayapti. Bu flaglar ostidagi yangi tekshiruvlar asosiy CI ishida bajarilmaydi. `playwright.documents.config.js` ham alohida workflow bosqichiga ulanmagan.

Kod: `playwright.config.js:6`, `tests/ui/vite.config.js:10`, `tests/ui/profile-settings.vite.config.js`, `playwright.profile-settings.config.js`, `.github/workflows/quality.yml:27`, `scripts/test-load-trash-db.mjs:205`.

### P1 — nosozliklarni umumiy kuzatish va tiklash paneli yetishmaydi

Serverda ayrim foydali loglar bor. Lekin kodda browser xatolarini markaziy yig‘ish, frontend va Edge chaqiruvlarini bitta request ID bilan bog‘lash, biznes jarayon tugamay qolganda avtomatik alert qilish tizimi topilmadi. Route error boundary xatoni ko‘rsatadi, markaziy kuzatuvga yubormaydi.

**Tavsiya:** xato → qaysi amal → qaysi job → qaysi provider zanjiri; maxfiy ma’lumotlarsiz structured log; job age, xatolar soni, p95 latency, AI token/xarajat ko‘rsatkichlari. Rate Con, marshrut, push, Gmail va to‘lov holati uchun operator paneli.

Kod: `src/components/LazyRouteBoundary.jsx:9`, `src/main.jsx`, `supabase/functions/parse-load-document/index.ts:376`.

### P1 — zaxira nusxadan tiklash kafolati dalil bilan tasdiqlanmagan

Release hujjatida backup va restore rehearsal talabi bor. Lekin ushbu auditda avtomatik tashqi backup natijasi, fayllar nusxasi va amalda tiklash protokoli tasdiqlanmadi. Bu «backup yo‘q» degani emas; holat tekshirilmagan.

**Tavsiya:** DB, PDF/BOL/POD, avatar/chat fayllari va konfiguratsiya uchun alohida tiklash rejasi; shifrlangan tashqi nusxa; davriy izolyatsiyalangan restore sinovi. RPO/RTO’ni biznes bilan belgilash va sinovda o‘lchash.

Supabase DB backup’i Storage API’dagi fayllarning o‘zini qamramaydi. Cloudinary’dagi media uchun ham alohida siyosat kerak. [Supabase backup hujjati](https://supabase.com/docs/guides/platform/backups).

Dalil: `docs/release-readiness.md:31`. Jonli tarif, backup retention va provayder media nusxalari bu auditda tasdiqlanmadi.

### P2 — tarix oshganda workspace ko‘p ma’lumotni qayta o‘qiydi

`fetchWorkspace()` yuklar, offerlar, hujjatlar, memberlar va reviewlar bo‘yicha barcha ko‘rinadigan qatorlarni o‘qiydi. Parallel o‘qish va presence uchun alohida yangilash yaxshi qilingan. Ammo ko‘p Realtime hodisalarida workspace to‘liq qayta olinadi. Qatorlarni API chegarasiga sig‘dirish uchun sahifalab o‘qish bor, foydalanuvchi ekrani uchun server pagination esa bu yo‘lda yo‘q.

**Ta’sir:** tarix ko‘payganda ko‘proq HTTP so‘rovi, egress, client xotirasi va saralash. Hozirgi kichik parkda aniq latency regressiyasi o‘lchanmagan.

**Tavsiya:** aktiv ishlar va arxivni ajratish; server filter/pagination; sahifaga kerakli read model; o‘zgargan entity’ni qayta olish; search’da server indekslari. 100/500/1000 haydovchi hamda katta yuk tarixi bilan o‘lchash.

Kod: `src/services/operationsService.js:228`, `src/services/operationsService.js:801`.

### P2 — katta map/PDF bundle’lari va o‘lchanmagan foydalanuvchi tezligi

Yangi build’da map chunk 1,871 kB / gzip 521 kB, PDF chunk 717 kB / gzip 333 kB, PDF worker 429 kB / gzip 129 kB. Ko‘p sahifalarda lazy loading mavjud; barcha paket har sahifada birdan yuklanadi deb aytish mumkin emas.

**Tavsiya:** map/PDF ochilishigacha og‘ir modullarni kechiktirishni tekshirish, worker/cache’ni o‘lchash, keraksiz dependency qismi va takroriy importlarni tahlil qilish. LCP/INP va PDF tanlashdan previewgacha p50/p95’ni haqiqiy sessiyalarda o‘lchash. Bir martalik tez testni barcha PDFlar uchun va’da qilmaslik.

Dalil: `tmp/project-audit-build.log`, `src/App.jsx` dagi lazy importlar.

### P2 — marshrutlarda truck xususiyatlari uzatilmayapti

Ko‘rilgan Mapbox chaqiruvlari `mapbox/driving` ishlatadi; `max_height`, `max_width`, `max_weight` yuborilmaydi. Serverdagi Google yo‘li `DRIVE` va `TRAFFIC_UNAWARE` ishlatadi. Shuning uchun buni truck cheklovlari va barcha real vaqt omillarini hisobga olgan to‘liq navigatsiya sifatida qabul qilish mumkin emas.

Mapbox bunday o‘lcham/vazn parametrlarini qo‘llaydi, lekin hududiy qamrov farqlanishi mumkin. [Mapbox Directions hujjati](https://docs.mapbox.com/api/navigation/directions/).

**Tavsiya:** transport o‘lchami, umumiy og‘irlik va zarur cheklovlarni hisobga olish; provider qaytargan violationlarni ko‘rsatish; yo‘l taxmini va amaldagi GPS trace’ni alohida saqlash. ETA uchun HOS, tanaffus, appointment oynasi va dwell time qo‘shish. Moliyaviy START stavka/mil snapshotini keyingi taxmin bilan yashirin almashtirmaslik.

Kod: `src/services/importRoute.js:22`, `src/services/fleetRoute.js:67`, `supabase/functions/_shared/google-load-route.ts:111`, `supabase/functions/_shared/google-load-route.ts:129`.

### P2 — eski Gmail navbati va o‘chirilgan integratsiya holatini boshqarish kerak

Jonli snapshot: 190 ta `broker_message.extract`, 1 ta `gmail_create_driver_label`, 5 ta `gmail_label_assignment` vazifasi pending; urinishlari 0. Bitta Gmail ulanishi `disabled`; oxirgi sync 2026-10-08. Cloud worker hujjati ham uni atayin paused holatda tasvirlaydi.

Shuning uchun bu raqamlar yangi email yo‘qolayotganini isbotlamaydi. Eski `broker_message.extract` job turi hozirgi attachment-processing yo‘lidan oldingi tarixiy qarz bo‘lishi mumkin; mavjud worker fayllarida uni bevosita iste’mol qilish topilmadi.

**Tavsiya:** legacy vazifalarni amaldagi jarayon bilan reconciliation qilish; zarur bo‘lmaganini audit bilan bekor qilish/arxivlash, yangi ishni takroran yaratmaslik. Integratsiyada «o‘chirilgan», «provider xatosi», «navbat kutmoqda», «oxirgi muvaffaqiyat» holatlarini ajratish. Ulanishni avtomatik qayta yoqish yoki barcha eski emailni ko‘r-ko‘rona qayta ishlash kerak emas.

Kod: `docs/gmail-supabase-worker.md`, `scripts/gmail-imap-sync.mjs`, `supabase/functions/gmail-sync-worker/runtime.mjs`. Yana 1 ta eski `document.ai_check` dead-letter vazifasi bor; biznesga hali tegishliligi alohida tekshirilishi kerak.

### P2 — dependency ogohlantirishi bor, amaliy ta’sirini oshirib ko‘rsatmaslik kerak

`npm audit --omit=dev` bitta HIGH topdi: `re2js@2.8.6`, Firebase → Firestore orqali tranzitiv dependency. Advisory’da tuzatilgan versiya 2.8.7. Zaiflik lookbehind’ning maxsus rejimida takroriy matching bilan bog‘liq. [GitHub advisory](https://github.com/advisories/GHSA-gg6h-894w-4m9c).

Ilova kodida Firebase Messaging va Analytics importlari bor, Firestore importi topilmadi. Shu sabab ushbu audit ekspluatatsiya qilinadigan runtime yo‘lini tasdiqlamadi.

**Tavsiya:** dependency/lockfile patch, toza `npm ci`, build va regressiya testlari; unused Firestore bo‘lagi web bundle’ga tushmaganini tekshirish. «HIGH bor»ni «saytni hozir buzish mumkin» deb talqin qilmaslik.

### P2/P3 — kod chegaralari va operatsion hujjatlar eskiryapti

`App.jsx` 1163, `DispatchChat.jsx` 1692, `ProfileView.jsx` 795 qator. Ko‘p vazifali fayllar o‘zgarish ta’sirini kuzatish va test yozishni qiyinlashtiradi. Bu o‘z-o‘zidan ortiqcha kod isboti emas.

`README.md` va `supabase/README.md` hali ApexHaul nomini ishlatadi; Supabase README’da «hali masofaga deploy qilinmagan» deyilgan, amalda jonli backend bor.

**Tavsiya:** chatni xabarlar/media/call/composer holati bo‘yicha, App’ni navigation/workspace/import boshqaruvi bo‘yicha kichik chegaralarga ajratish. Har katta funksiyani birdan qayta yozmaslik. O‘chiriladigan kodni import graph va foydalanish dalili bilan aniqlash. Deploy manifestida commit SHA, migrationlar va Edge versiyalarini qayd etish; README/runbookni yangilash.

## 4. Supabase advisorlarini to‘g‘ri talqin qilish

- `authenticated_security_definer_function_executable`: 116 ta warning. Bu 116 ta tasdiqlangan zaiflik emas. Ko‘p RPC biznes komandasi sifatida aynan shu yo‘l bilan ishlaydi. Har birida rol, kompaniya, input, `search_path`, concurrency va grantlar tekshirilishi kerak.
- `rls_enabled_no_policy`: private schema’dagi 9 ta jadval. Bu avtomatik ravishda ma’lumot ochiqligi emas; policy yo‘qligi ko‘pincha client access’ni yopadi. Privileged service yo‘li alohida tekshiriladi.
- `unindexed_foreign_keys`: advisor javobida 100 ta finding. Ularning barchasiga indeksni ko‘r-ko‘rona qo‘shish kerak emas; avval real query/lock statistikasi va `EXPLAIN` bilan tanlash kerak.
- `unused_index`: 40 ta finding. Qisqa statistika davri yoki kam traffic sabab bo‘lishi mumkin; integrity/rare query uchun zarur indeksni o‘chirmaslik kerak.

Remediation: [RPC grantlari](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [FK indekslari](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [unused indekslar](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [password himoyasi](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 5. Hozir yaxshi ishlangan qismlar

- Yuk va hujjatlarni o‘zgartirish server komandalariga ko‘chirilgan; optimistic version, idempotency va audit naqshlari bor.
- Tasdiqlangan hisob-kitoblar DB’da saqlanadi, snapshotlari keyingi sozlama o‘zgarishi bilan qayta yozilmaydi. Ularni eski vaqtinchalik demo arxitekturasi bilan adashtirmaslik kerak.
- Moliyaviy snapshot sinovida tenant/rol chegaralari va tasdiqlangan raqamlar tekshirildi.
- Hujjatlarning oldingi versiyalari, current-version tekshiruvi va BOL/POD bilan webdan yakunlash yo‘li bor.
- PDF importida hujjat turi serverda ajratiladi; BOL/POD’ni Rate Con kabi to‘liq import qilishning oldi olingan. Oldingi model parametri xatosi tuzatilgan; uni ushbu auditdagi ochiq bug deb sanamadim.
- Roster, delivery monitor, real-time chat, push/call yo‘llari allaqachon mavjud. O‘sish uchun ularni yana parallel sahifalarda takrorlash shart emas.
- CSP, frame cheklovi, `nosniff`, Referrer/Permissions policy konfiguratsiyasi va UI accessibility testlari bor. Biroq production headerlarining ayni deploy’da ishlashi bu auditda tarmoq orqali qayta tasdiqlanmadi.

## 6. Eng katta foyda beradigan mahsulot rivoji

| Taklif | Mavjud asos | Qo‘shiladigan aniq imkoniyat | Qanday foyda o‘lchanadi |
|---|---|---|---|
| Yagona dispatch nazorati | Delivery monitor, GPS, hujjatlar, yuklar | Kechikish, GPS eskirishi, yetishmagan BOL/POD, tayyor bo‘lmagan pay va bo‘shaydigan driver’ni bir ustuvor ish ro‘yxatida ko‘rsatish; mas’ul va bajarish amali | E’tibor talab qilgan holatni topish/hal qilish vaqti, on-time % |
| Broker to‘lovi va invoicing | `broker_paid`, `outstanding`, invoice hujjat turi bor | Invoice raqami/sanasi/due date, BOL/POD paketi, qisman tushumlar tarixi, qarz yoshi, factoring va reconciliation | Yetkazishdan invoicegacha vaqt, muddati o‘tgan summa, pul kelish muddati |
| To‘liq operatsion rentabellik | Fuel/toll/other cost, commission, driver pay, trip balance mavjud | Xarajatlarni import qilish va receipt bilan bog‘lash; taxminiy/haqiqiy/tasdiqlangan summani ajratish; haydovchi, truck, broker, yo‘nalish bo‘yicha natija | Net/load, deadhead %, cost/mile, ma’lum xarajatlar ulushi |
| HOS asosidagi ETA va mos driver tavsiyasi | Duty status, compatibility, ETA va assignment bor | ELD’dan qolgan ish vaqtini olish; pickupgacha yo‘l, appointment, tanaffus, truck mosligi va keyingi bo‘shash vaqtini hisoblash; tavsiyani inson tasdiqlaydi | Kechikkan assignmentlar, bo‘sh yurish, qo‘lda rejalash vaqti |
| Hujjatlar va compliance nazorati | Versionlangan BOL/POD/Rate Con | Har stop uchun yetishmagan hujjatlar, muddat tugayotgan license/insurance va javobgar xodimga eslatma | To‘liq hujjatli tugagan yuklar %, qayta so‘ralgan hujjatlar |
| Tez onboarding va boshqariladigan kirish | Kompaniya, rollar va foydalanuvchi yaratish bor | Driver/truck CSV importi, takrorlarni oldindan ko‘rsatish, invite orqali kirish, kompaniya setup yo‘riqnomasi | Birinchi yuk yaratilguncha vaqt, aktivlashgan kompaniyalar |

Bu takliflar mavjud funksiyalar yo‘q degani emas; ularning operatsion chuqurligini oshiradi. Masalan, `financialModel.js:84` dagi kompaniya komissiyasi minus operatsion xarajat bilan `tripBalance`’ni bir xil «foyda» deb atamaslik kerak. Kompaniya biznes modeli va xarajat egasi ko‘rinishda aniq bo‘lsin.

ELD integratsiyasiga texnik misol: Samsara API HOS clocklarni beradi. Bu provider tanlandi yoki obuna shartlari tekshirildi degani emas. [Samsara HOS clocks](https://developers.samsara.com/reference/gethosclocks), [compliance API](https://developers.samsara.com/docs/compliance-guide).

## 7. PDF tizimini keyingi kuchaytirish

Yangi parser yoki kattaroq modelni darhol qo‘shishdan oldin mavjud 12 ta namunani qo‘lda tekshirilgan kutilgan qiymatlar bilan regression to‘plamiga aylantirish kerak. Hujjat turi, broker/load raqami, har bir stop ketma-ketligi, to‘liq manzil, sana/vaqt oynasi, summa va vazn birliklari alohida baholansin.

Hisoblanadigan ko‘rsatkichlar:

1. Muhim maydonlar to‘g‘riligi — maydonlar kesimida, faqat JSON schema’dan o‘tish emas.
2. Noto‘g‘ri slotga joylashish va stop almashtirish xatolari.
3. Operator qo‘lda tuzatgan maydonlar ulushi.
4. PDF tanlashdan foydali previewgacha p50/p95 va provayder xato ulushi.
5. Har muvaffaqiyatli import uchun token va pul xarajati.

Oxirgi real-model tekshiruvdagi taxminan 12.3 soniyali Rate Con va 6.3 soniyali BOL tasnifi bitta-bitta namuna; bular p95 yoki umumiy aniqlik foizi emas. Kam aniqlikdagi yoki isboti yetishmagan maydon uchun hujjatning tegishli sahifasini ochib tekshirish imkoniyati foydaliroq bo‘ladi.

## 8. Tavsiya etilgan ish tartibi

**Birinchi bosqich — ishonchlilik:** 3 ta pay vazifasini tiklash, CI suite/flaglarini to‘g‘rilash, admin MFA, monitoring va backup restore dalili. Yakun mezoni: queue holati operatorga ko‘rinadi, kirish cheklovlari tekshirilgan, kerakli testlar CI’da o‘tadi, tiklash amalda bajarilgan.

**Ikkinchi bosqich — tezlik va hisoblar:** workspace paging, kerakli entity yangilanishi, map/PDF o‘lchovi, moliyaviy ma’lumot completeness nazorati. Yakun mezoni: kelishilgan park/tarix hajmida p95 va egress budjeti bajariladi.

**Uchinchi bosqich — daromad va operatsion o‘sish:** invoice/qarz nazorati, yagona exception ish ro‘yxati, HOS/ELD va haqiqiy xarajatlar importi. Har katta integratsiyani alohida pilot kompaniyada tekshirib kengaytirish.

Aniq muddat va xarajat integratsiyalar, jamoa hajmi hamda qabul mezonlari belgilangach baholanishi kerak. Bu audit asosida o‘sish foizini ishonchli hisoblab bo‘lmaydi.

## 9. Tekshiruv chegaralari

- Barcha sahifalarning barcha holati jonli production’da boshdan oxirigacha bajarilmadi; UI testlar synthetic fixture bilan ishladi.
- Haqiqiy Android/iPhone’da ekran bloklanishi, tarmoq almashtirish va qo‘ng‘iroq yetkazilishi qayta sinovdan o‘tkazilmadi.
- Deno lokal PATH’da topilmadi; Deno suite bu auditda qayta bajarilmadi.
- Katta park load testi, mustaqil penetration test va disaster recovery mashqi bajarilmadi.
- Advisor’dagi barcha 116 SECURITY DEFINER funksiyasi bu audit doirasida birma-bir yangi formal tekshiruvdan o‘tkazilmadi. Tanlangan kritik yo‘llarning testlari o‘tdi.
- Production backup rejalari, provider shartlari, barcha API secretlar holati va remote deploy/checkout to‘liq pariteti tasdiqlanmadi.
- Kod yoki DB’da tuzatish bajarilmadi; ushbu fayl audit natijasidir.
