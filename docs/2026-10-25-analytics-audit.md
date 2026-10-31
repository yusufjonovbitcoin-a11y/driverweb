# Analitika auditi — 25.10.2026

**Holat yangilanishi:** quyidagi matn tuzatishdan oldingi audit dalillaridir. Besh tasdiqlangan muammoning yechimi va qayta tekshiruv natijalari [tuzatish hisobotida](./2026-10-25-analytics-fixes.md) keltirilgan. Eski diagnostik skriptlar xatoni qayta hosil qilgan tarixiy dalil; amaldagi regressiya testlari `src/`, `tests/ui/` va `scripts/test-financial-center-db.mjs` ichida.

Analitika sahifasi, uning hisoblash modeli, ma’lumot o‘qish va xarajatlarni saqlash yo‘li tekshirildi. Asosiy interfeys ishlaydi, lekin quyidagi beshta holat alohida sinovlarda qayta hosil qilindi. Bu audit mahsulot kodini tuzatmaydi: haqiqiy yuklar, hisob-kitoblar va server sozlamalari o‘zgartirilmadi.

**1. P1 — Avtomatik yangilanish eski tahrir bilan yangi yozuvni bosib ketishga imkon beradi.**

Xarajatlar oynasidagi qiymatlar tahrir boshida olinadi. Analitika har 60 soniyada yangilanadi. Shu paytda boshqa foydalanuvchi yozuvni o‘zgartirsa, ochiq oynaga yangi versiya raqami keladi, lekin kiritilayotgan eski qiymatlar qoladi. Saqlash yangi versiya raqamini eski tahrir bilan yuboradi; serverning versiyalarni solishtirish himoyasi bunday holatda nizoni aniqlay olmaydi.

Brauzerdagi sun’iy sinov: birinchi foydalanuvchi `777` kiritdi; ikkinchisi yozuvni `900`, versiya `1` qilib saqladi; avtomatik yangilanishdan keyin birinchi foydalanuvchi saqlaganda natija `777.00`, versiya `2` bo‘ldi. Ogohlantirish chiqmadi. Sinov haqiqiy komponentlardan foydalandi, serverga moliyaviy yozuv yuborilmadi.

Tuzatish: tahrir boshlangan paytdagi versiyani alohida saqlash; fon yangilanishida uni almashtirmaslik; tashqi o‘zgarish bo‘lsa qayta yuklash yoki tahrirlarni solishtirishni talab qilish.

Manbalar: [FinancialLoadDialog.jsx:16](C:/Users/Intel/Desktop/driverweb/src/components/analytics/FinancialLoadDialog.jsx:16), [saqlash:31](C:/Users/Intel/Desktop/driverweb/src/components/analytics/FinancialLoadDialog.jsx:31), [serverga yuboriladigan versiya:17](C:/Users/Intel/Desktop/driverweb/src/services/tripAnalyticsService.js:17), [avtomatik yangilanish:8](C:/Users/Intel/Desktop/driverweb/src/components/AnalyticsOverview.jsx:8).

**2. P2 — Tasdiqlangan buxgalteriya PDFidagi Net analitikaga avtomatik o‘tmaydi.**

Analitika yuk hisobi, assignment pay va joriy hisoblash sozlamalarini o‘qiydi. Tasdiqlangan `driver_settlements` hujjatini o‘qimaydi. Net ustuvorligi: yuk hisobida yozilgan driver pay → assignment pay → joriy sozlamalar bo‘yicha hisob. Tasdiqlangan PDFdagi alohida Net tahriri bu zanjirga kirmaydi. Komissiya va davriy ushlanmalar ham joriy sozlamalar bo‘yicha qayta hisoblanadi.

Sun’iy misol: Gross `$1,000`, kompaniya `10%`, dispetcher `0.5%`; PDFning tasdiqlangan Net summasi qo‘lda `$700` qilindi. Analitika `$895` ko‘rsatdi. Kompaniya komissiyasini `20%` qilish analitikadagi Netni `$795`ga o‘zgartirdi; tasdiqlangan hujjat `$700` bo‘lib qoldi. Bu manbalar o‘rtasidagi integratsiya bo‘shlig‘i; hozirgi haqiqiy yukdagi `$322.09` noto‘g‘ri degan xulosa emas.

Tuzatish: tasdiqlangan hisoblar uchun o‘sha hujjatning o‘zgarmas versiyasi va yuklar bo‘yicha aniq ajratilgan summalarni o‘qish; hisoblangan, tasdiqlangan va to‘langan summalarni ajratib ko‘rsatish. Bir nechta yukka umumiy ushlanmani hujjatsiz taqsimlash mumkin emas.

Manbalar: [o‘qiladigan manbalar:22](C:/Users/Intel/Desktop/driverweb/src/services/financialCenterReader.js:22), [Net tanlash:38](C:/Users/Intel/Desktop/driverweb/src/components/analytics/financialModel.js:38), [joriy qoidalar bilan hisoblash:56](C:/Users/Intel/Desktop/driverweb/src/components/analytics/financialModel.js:56), [tasdiqlash:171](C:/Users/Intel/Desktop/driverweb/src/components/settlements/SettlementWorkspace.jsx:171).

**3. P2 — Sana filtri ilovada tanlangan vaqt zonasini hisobga olmaydi.**

Model sanani timestampning dastlabki o‘nta belgisidan oladi. `2026-10-02T00:30:00Z` Nyu-Yorkda 1-oktabr bo‘lsa ham, analitika uni 2-oktabrga qo‘shadi. 1-oktabr filtrida bu yuk ko‘rinmadi. Kunlik grafik ham shu noto‘g‘ri guruhlangan sana bilan ishlaydi.

Tuzatish: timestampni ilovaning tanlangan vaqt zonasida kun kalitiga aylantirish; filtr, jadval va grafikda bitta qoidadan foydalanish.

Manba: [financialModel.js:38](C:/Users/Intel/Desktop/driverweb/src/components/analytics/financialModel.js:38).

**4. P2 — Bir nechta sahifada o‘qish paytida yozuvlar o‘zgarsa, yuk tushib qolishi mumkin.**

RPC 100 tadan OFFSET bilan o‘qiladi. Dublikatlar va bo‘sh javob tekshiriladi, lekin birinchi va keyingi sahifaning umumiy soni hamda ma’lumot versiyasi bir xil ekanligi tekshirilmaydi.

Sun’iy misol: dastlab 201 yozuv bor. Birinchi 100 tasi o‘qilgach oldingi yozuv o‘chirildi. Ikkinchi javobda umumiy son 200 bo‘ldi. O‘quvchi xatosiz tugadi, ammo o‘chirilgan yozuvni saqlab qoldi va mavjud `0100` yozuvini tashlab ketdi. Parallel o‘qiladigan sozlamalar, yuklar va pay ham umumiy vaqt kesimiga bog‘lanmagan.

Tuzatish: serverda izchil snapshot/cursor bilan o‘qish; kamida umumiy son yoki versiya o‘zgarsa cheklangan qayta o‘qish va natijani to‘liq tekshirish.

Manba: [financialCenterReader.js:8](C:/Users/Intel/Desktop/driverweb/src/services/financialCenterReader.js:8).

**5. P2 — Saqlanmagan tahrirni yo‘qotishdan himoya yo‘q.**

`Esc`, yopish tugmasi va tashqi fonni bosish oynani darhol yopadi. `dirty` holati bor, ammo yopishdan oldin tekshirilmaydi. Sinovda `777` kiritilib, `Esc` bosilgach oyna yopildi; qayta ochilganda qiymat yo‘q edi. Hech qanday tasdiqlash so‘ralmadi.

Tuzatish: barcha yopish yo‘llari uchun umumiy saqlanmagan o‘zgarishlar tekshiruvini qo‘llash va kerak bo‘lsa qoralamani saqlab qolish.

Manba: [FinancialLoadDialog.jsx:35](C:/Users/Intel/Desktop/driverweb/src/components/analytics/FinancialLoadDialog.jsx:35).

**Moliyaviy ko‘rsatkichlar qamrovi.**

Asosiy sahifadagi kompaniya natijasi hozir `kompaniya komissiyasi − yoqilg‘i − toll − boshqa kompaniya xarajatlari` degani. Yorliq ham “Комиссия минус расходы” deb yozilgan. Bu barcha pul oqimlarini qamragan sof foyda emas. `additional_income`, brokerdan kelgan pul va broker qarzi tahrirlash oynasida hisoblanadi, ammo umumiy dashboardda alohida jami ko‘rsatkichlari yo‘q.

Misol: Gross `$1,000`, qo‘shimcha daromad `$100`, driver pay `$900`, xarajat `$60`, brokerdan olingan `$1,000`. Tahrir oynasida daromad `$1,100`, yuk balansi `$140`, broker qarzi `$100`; bosh sahifada Gross `$1,000` va komissiyadan xarajatlarni ayirish natijasi `$40`. Bular turli ko‘rsatkichlar; arifmetik xato deb baholanmadi. To‘liq moliyaviy nazorat uchun alohida ko‘rsatkichlar va ularning ma’nosi kerak.

**Haqiqiy sahifadagi ko‘rilgan holat.**

Tekshiruv vaqtida bitta tugallangan yuk ko‘rindi. Uning taqsimoti sentgacha tenglashadi:

`$2,000.00 = $240.00 kompaniya + $10.00 dispetcher + $7.14 boshqa ushlanmalar + $322.09 driver Net + $1,420.77 taqsimlanmagan summa`.

Bu tenglik summalar yo‘qolmaganini ko‘rsatadi; taqsimlanmagan `$1,420.77` avtomatik ravishda kompaniya foydasi deb olinmaydi. Kompaniya xarajatlari noma’lum bo‘lgani uchun natijada `—` chiqishi to‘g‘ri. Noma’lum qiymat nolga almashtirilmaydi.

**Tezlik va kod.**

Har renderda `financialView` ikki marta chaqiriladi. Har haydovchi uchun ro‘yxat qayta filtrlanadi. Fon yangilanishi har 60 soniyada barcha yuklar va tegishli yozuvlarni qaytadan o‘qiydi. Sun’iy 10,000 yuk/1,000 haydovchi bilan ikki model hisobi mahalliy Node sinovida 408 ms oldi. Bu brauzer yoki server tezligi o‘lchovi emas; hozirgi bitta yukli sahifaning qotish sababi tasdiqlanmadi.

O‘sish uchun: guruhlarni Map orqali bir yurishda hisoblash, bir xil hisobni qayta ishlatish/memoizatsiya, server agregatsiyasi va filtrlangan o‘qish. Analytics build bo‘lagi taxminan 46.18 kB, gzip 13.28 kB. Umumiy buildda PDF/xarita kabi 500 kBdan katta bo‘laklar haqida ogohlantirish bor; bu Analytics bo‘lagi haddan tashqari katta degani emas.

Supabase performance advisor qaytargan ma’lumotlarda Analytics bilan bog‘liq ayrim foreign key indekslari yetishmaydi, jumladan `load_price_snapshots.load_id` va company ustunlari. “Unused index” tavsiyalari ham bor. Bu tavsiyalar real query plan va yuklama bilan tekshirilmasdan indekslarni o‘chirish uchun yetarli emas. [Supabase indeks tekshiruvi izohi](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

**Xavfsizlik bo‘yicha tekshirilganlar.**

- Analytics o‘qish RPCsi kompaniya va faol foydalanuvchi rolini tekshiradi; anonim EXECUTE ruxsati yo‘q.
- Saqlash RPCsi yuk kompaniyasini, rolni, versiyani, ruxsat etilgan summalarni va izoh uzunligini tekshiradi, audit yozuvi yaratadi. 1-banddagi muammo frontend qaysi versiyani yuborishi bilan bog‘liq.
- `loads`, `assignments`, `assignment_driver_pay`, `load_accounting`, `company_accounting_settings` va `driver_settlements` jadvallarida RLS yoqilgan va siyosatlar mavjud.
- CSV qiymatlarida formula kiritishdan himoya mavjud. Interfeys foydalanuvchi matnini React orqali chiqaradi.
- Oldindan ma’lum bo‘lgan leaked-password himoyasi ogohlantirishi hali bor; uni qo‘lda yoqishingiz aytilgan edi. [Supabase parol himoyasi](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Bu natijalar barcha jadvallarning har bir siyosati yoki butun sayt uchun mutlaq xavfsizlik kafolati emas. Haqiqiy kompaniyalararo yozuv sinovlari va zararli amallar bajarilmadi. Advisorning authenticated SECURITY DEFINER funksiyalar haqidagi umumiy ogohlantirishi o‘zi alohida tasdiqlangan ekspluatatsiya emas; tekshirilgan saqlash funksiyasida ichki rol/kompaniya himoyasi bor.

**Tekshiruv dalillari.**

| Tekshiruv | Natija |
| --- | --- |
| Model, reader va tegishli hisoblash testlari | 30 o‘tdi |
| Mavjud Analytics brauzer testlari: desktop va mobil | 28 o‘tdi |
| Yangi diagnostik brauzer ssenariylari | 2 holatda xato qayta hosil qilindi |
| Lint | O‘tdi |
| Production build | O‘tdi; umumiy katta chunk ogohlantirishi bor |
| Haqiqiy UI va Supabase schema/RPC/policy o‘qilishi | Bajarildi; biznes yozuvlari o‘zgartirilmadi |

Mavjud testlar yuqoridagi chegaraviy holatlarni qamramagani uchun ularning o‘tishi topilgan xatolarni inkor etmaydi. Diagnostik testlar xato xatti-harakatni qayta hosil qilish uchun yozilgan; ular tuzatish amalga oshirilganini bildirmaydi.

Qayta tekshirish uchun: [model repro skripti](C:/Users/Intel/Desktop/driverweb/output/analytics-audit-repro.mjs), [natijalar JSON](C:/Users/Intel/Desktop/driverweb/output/analytics-audit-repro-results.json), [brauzer repro testlari](C:/Users/Intel/Desktop/driverweb/output/analytics-audit.check.js). `output/` fayllari mahalliy, Git tomonidan e’tiborga olinmaydi.

Tavsiya etilgan tartib: avval tahrir versiyasi va saqlanmagan ma’lumotlar himoyasi; keyin tasdiqlangan hisoblarning Analytics bilan bog‘lanishi; so‘ng vaqt zonasi va izchil o‘qish; oxirida kengaytirilgan moliyaviy ko‘rsatkichlar hamda katta hajm uchun optimizatsiya.
