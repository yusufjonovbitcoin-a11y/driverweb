**T Fleets — Sozlamalar bo‘limining UI/UX auditi**

Sana: 26.10.2026. Mahalliy sayt: `http://127.0.0.1:5174/#profile`.

**Xulosa**

Interfeysning vizual asosi yaxshi: ko‘k asosiy amallar, oq kartalar, umumiy shrift tizimi va profil ichidagi alohida tahrirlash ko‘rinishi bor. Biroq bo‘limni hozircha to‘liq professional, barcha ekranlarda birdek ishlaydigan UI/UX deb baholab bo‘lmaydi. Ikki muammo birinchi navbatda tuzatilishi kerak: tor ekranda traklar jadvali yo‘qoladi; tablar o‘rtasida o‘tilganda saqlanmagan ma’lumotlar ogohlantirishsiz yo‘qoladi.

Bu audit davomida ilova kodi o‘zgartirilmadi. Tekshiruv skriptlari, natijalar va ushbu hisobot yaratildi.

**Tekshiruv usuli va chegaralari**

- Haqiqiy lokal interfeys rus tilida ko‘rildi; aloqa/qurilmalar, xavfsizlik, bildirishnomalar va integratsiya ko‘rinishlari tekshirildi. Akkauntlar, MFA, push ruxsatlari va ishlab turgan ma’lumotlar o‘zgartirilmadi.
- Ajratilgan, haqiqiy kalitlarsiz test muhitida 1223×701 va 390×844 o‘lchamlar, oq va qorong‘i rejimlar tekshirildi.
- 9 ekran holati × 4 konfiguratsiya = **36 ekran holati** uchun DOM o‘lchovlari, skrinshotlar va axe avtomatik tekshiruvi olindi: 6 asosiy tab, foydalanuvchi qo‘shish modali, traklar ro‘yxati va trak qo‘shish modali.
- Ma’lumot yo‘qolishi va navigatsiya ikkala o‘lchamda takrorlandi. Trak jadvali uchun alohida ko‘rinish tekshiruvi bajarildi.
- Avtomatik tekshiruv inglizcha test ma’lumotlarida bajarildi; ruscha haqiqiy UI qo‘lda ko‘rildi. Barcha o‘zbekcha matnlarning barcha o‘lchamlardagi vizual mosligi, haqiqiy telefon, screen reader va 200–400% zoom bo‘yicha to‘liq tekshiruv hali qilinmagan.
- Bu UI/UX auditi. Backend xavfsizligi yoki haqiqiy yozish amallari uchun sertifikatsiya emas. Avtomatik axe natijasi ham to‘liq WCAG muvofiqligini isbotlamaydi.

**Muhim topilmalar**

P1 — foydalanish jarayonini buzadigan yoki kiritilgan ma’lumotni yo‘qotadigan muammo. P2 — muhim qulaylik, izchillik yoki accessibility kamchiligi. P3 — yaxshilash tavsiyasi.

| ID | Daraja | Muammo | Dalil turi |
|---|---|---|---|
| 01 | P1 | Mobil/tor ekranda traklar ro‘yxati butunlay yashirinadi | Amalda takrorlandi + CSS |
| 02 | P1 | Tab almashtirish saqlanmagan shaxsiy va haydovchi ma’lumotlarini yo‘qotadi | Amalda takrorlandi |
| 03 | P2 | Haydovchining tayyorligi va aktiv yuk mezonlari boshqa sahifalar bilan bir xil emas | Kod tekshiruvi + real UI |
| 04 | P2 | To‘xtatilgan haydovchilar Jamoa ma’lumotlar to‘plamidan chiqib ketadi | Kod tekshiruvi |
| 05 | P2 | Tab/tahrirlash holati URL va brauzer tarixida saqlanmaydi | Kod + reload tekshiruvi |
| 06 | P2 | Ayrim matnlar oq va qorong‘i rejimda yetarli kontrastga ega emas | axe o‘lchovi |
| 07 | P2 | “Qurilmalar va seanslar” nomi amaldagi imkoniyatga mos emas | Haqiqiy UI + kod |
| 08 | P2 | Xavfsizlik sahifasida parolni o‘zgartirish yo‘li yo‘q | Haqiqiy UI + kod |
| 09 | P2 | Qo‘lda saqlash va darhol saqlash usullari yetarlicha farqlanmagan | Kod + UX bahosi |
| 10 | P2 | Shaxsiy profil ichida butun kompaniyaga ta’sir qiladigan sozlama bor | Kod + UX bahosi |
| 11 | P2 | Ayrim ikonka va xato holatlari foydalanuvchiga yetarlicha aniq emas | Kod + UX bahosi |
| 12 | P3 | Mobil tablar, bosish maydonlari va uzun matnlar yanada qulaylashtirilishi mumkin | O‘lchov + UX bahosi |

**01. Tor ekranda traklar ro‘yxati yo‘qoladi**

Takrorlash: Jamoa → Traklar → tor ekran. Test ma’lumotida bitta trak bor, lekin jadvalning o‘lchami `0×0`; ota element `display:none` holatida. Desktopda aynan shu jadvalning bitta qatori ko‘rinadi.

Sabab: haydovchilar jadvalini mobil kartalarga almashtirish uchun yozilgan container qoidasi shu ID ichidagi barcha jadval konteynerlariga qo‘llanadi. Traklar panelida esa mobil kartalar yo‘q. Qoida konteyner 690px yoki undan tor bo‘lganda ishga tushadi; bu faqat telefon ekraniga bog‘liq emas.

Ta’sir: administrator trak mavjud emas deb o‘ylashi yoki telefonda uni tahrirlay olmasligi mumkin.

Tavsiya: CSS qoidasini faqat haydovchi jadvaliga cheklash; traklar uchun mobil kartalar yoki ishlaydigan gorizontal jadvalni qoldirish. Har ikki holatda tahrirlash amali ochiq qolishi kerak.

Dalil: [CSS](C:/Users/Intel/Desktop/driverweb/src/components/profileCenter.css:90), [mobil o‘lchov](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/mobile-fleet-visibility.json), [desktop o‘lchov](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/desktop-fleet-visibility.json).

![Testda trak bor, lekin mobil ro‘yxat yashirin](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/mobile-light-trucks.png)

**02. Tab almashtirish ma’lumotni yo‘qotadi**

Ikkala ekran o‘lchamida quyidagilar takrorlandi:

1. Haydovchi → Tahrirlash → ismni o‘zgartirish → Shaxsiy ma’lumotlar → Jamoa: yozilgan yangi ism yo‘qolib, oldingi ism qaytdi.
2. Shaxsiy ma’lumotlar → ismni o‘zgartirish → Jamoa → Shaxsiy ma’lumotlar: yangi qiymat yo‘qoldi.
3. Bu o‘tishlarda tasdiqlash oynalari soni: **0**.

Haydovchi sahifasining o‘zidagi Orqaga tugmasi va brauzerni qayta yuklash uchun himoya bor. Yuqoridagi tablar orqali chiqish bu himoyadan o‘tmaydi. Shaxsiy shakl esa tabdan chiqishda unmount bo‘ladi va draft qayta yaratiladi.

Tavsiya: bitta umumiy draft himoyasi. Tab, sidebar, ichki Orqaga va boshqa navigatsiya yo‘llari bir xil “Saqlash / O‘zgarishlarni bekor qilish / Qolish” qarorini taklif qilishi yoki draftni qayta kirishda saqlab turishi kerak. Maxfiy parol maydonlarini doimiy brauzer xotirasiga yozmaslik kerak.

Dalil: [desktop takrorlash](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/desktop-flows.json), [mobil takrorlash](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/mobile-flows.json), [tab almashtirish](C:/Users/Intel/Desktop/driverweb/src/components/ProfileView.jsx:109), [mavjud qisman himoya](C:/Users/Intel/Desktop/driverweb/src/components/DriverEditPage.jsx:15).

**03. Haydovchi holati bir xil talqin qilinmaydi**

Jamoada “Свободен (готов)” hisoblash asosan tugallanmagan yuk bor-yo‘qligiga qaraydi. `dutyStatus` hisobga olinmaydi; `cancelled` va `dispute` yuklar ham shu sodda tekshiruvda aktiv deb hisoblanishi mumkin. Asosiy Haydovchilar sahifasida bular uchun boshqa, batafsil qoida mavjud.

Ta’sir: bir odam turli sahifalarda turli holatda ko‘rinadi. “Aktiv yuk yo‘q” bilan “yangi ishga tayyor” bir ma’noda ishlatiladi.

Tavsiya: yagona holat modelidan foydalanish. Akkaunt holati, smena/aloqa holati va yuk holatini ajratish. Tayyorlik ishonchli ma’lum bo‘lmasa, “Aktiv yuk yo‘q” deb yozish aniqroq.

Dalil: [Jamoa hisobi](C:/Users/Intel/Desktop/driverweb/src/components/ProfileView.jsx:210), [roster qoidasi](C:/Users/Intel/Desktop/driverweb/src/components/driverRosterModel.js:1).

**04. To‘xtatilgan foydalanuvchini boshqarish izchil emas**

Sozlamalar sahifasiga faol `drivers` va `members` uzatiladi; `suspended` foydalanuvchilar uchun alohida to‘liq roster mavjud. Jamoa sahifasida ular uchun ko‘rinadigan filtr yo‘q. Haydovchini shu yerdagi tahrirlash oynasidan to‘xtatib, ro‘yxat yangilansa, hozirgi yozuv faol ro‘yxatdan chiqib ketishi va tahrirlash konteksti yopilishi mumkin. Bu oqim haqiqiy akkauntni to‘xtatish orqali sinovdan o‘tkazilmadi; xulosa ma’lumotlar oqimi kodidan chiqarildi.

Tavsiya: Jamoa boshqaruvida faol va to‘xtatilgan foydalanuvchilarni ko‘rsatish, aniq status filtri va qayta faollashtirish yo‘lini saqlash. Faol yuk tayinlash ro‘yxati alohida filtrlangan bo‘lishi mumkin.

Dalil: [ro‘yxatlarni ajratish](C:/Users/Intel/Desktop/driverweb/src/services/workspaceMembers.js:4), [workspace modeli](C:/Users/Intel/Desktop/driverweb/src/services/operationsService.js:262), [ProfileView props](C:/Users/Intel/Desktop/driverweb/src/App.jsx:980).

**05. Alohida ko‘rinish bor, lekin navigatsiya holati yo‘q**

Tab va tahrirlanayotgan haydovchi React holatida saqlanadi. URL `#profile` bo‘lib qoladi. Testda boshqa tabdan reload qilinganda Jamoa ochildi. Shu sabab aniq sozlama sahifasiga havola berish va brauzer Orqaga/Oldinga tugmalarini odatiy tarzda ishlatish cheklangan.

Tavsiya: subtab va tahrirlash ko‘rinishi uchun route holatini yaratish; reload va Back/Forward xatti-harakatini oldindan belgilash. Saqlanmagan ma’lumot himoyasi bilan birga ishlashi kerak.

Dalil: [tab holati](C:/Users/Intel/Desktop/driverweb/src/components/ProfileView.jsx:89), [hash navigatsiyasi](C:/Users/Intel/Desktop/driverweb/src/App.jsx:358), yuqoridagi flow JSON fayllari.

**06. Kontrast to‘liq standartga mos emas**

O‘lchangan misollar:

| Element | Rejim | Kontrast |
|---|---|---|
| Jamoa status filtri matni | Oq | 4.27:1 |
| Jadval ustun sarlavhalari | Oq | 4.40:1 |
| Mobil “Available” matni | Oq | 3.65:1 |
| Ayrim ikkilamchi matnlar/status filtrlari | Qorong‘i | 3.13:1 |
| Traklar/Gmail ichidagi ayrim ikkilamchi matnlar | Qorong‘i | 3.33:1 |

Bu 12–14px matnlar uchun kerak bo‘lgan 4.5:1 chegarasidan past. W3C oddiy matn uchun 4.5:1, katta matn uchun esa tegishli istisno bilan 3:1 chegarasini belgilaydi. [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Tavsiya: ikkilamchi matnlarning rangini ikkala mavzu uchun alohida moslash; `zinc-500` kabi eski ranglar va yangi tokenlarning aralashishini kamaytirish. Modal ochiq holatdagi ayrim avtomatik natijalar uning ortidagi sahifaga tegishli: ular alohida modal nuqsonlari sifatida qayta sanalmadi.

Dalil: [oq rejim natijasi](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/desktop-light.json), [qorong‘i rejim natijasi](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/mobile-dark.json).

**07. “Qurilmalar va seanslar” foydalanuvchiga ortiqcha va’da beradi**

Haqiqiy UI’da bu bo‘limda qurilma nomi, brauzer, faol seanslar, oxirgi faollik yoki seansni tugatish amali yo‘q. Faqat vaqt mintaqasi ko‘rsatiladi. Email va telefon esa Shaxsiy ma’lumotlar hamda Xavfsizlikda ham takrorlanadi.

Tavsiya: nomni mavjud mazmunga moslash yoki haqiqiy qurilma/seans ro‘yxatini yaratish. Kontaktlarni Shaxsiy ma’lumotlarda, seanslarni Xavfsizlik ichida jamlash mumkin.

Dalil: [panel kodi](C:/Users/Intel/Desktop/driverweb/src/components/ProfileAccountPanels.jsx:95), [haqiqiy sahifa](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/live-devices.png).

**08. Xavfsizlik bo‘limining asosiy vazifasi qisman bajarilgan**

MFA sozlash uchun haqiqiy boshqaruv mavjud. Biroq parolni o‘zgartirish qismida faqat bu imkoniyat hozir mavjud emasligi yozilgan; foydalanuvchiga aniq keyingi qadam berilmagan. Bu backendda parol himoyasi yo‘q degani emas, aynan ushbu sahifadagi foydalanish yo‘li to‘liq emasligini bildiradi.

Tavsiya: parolni almashtirish/tiklashning aniq oqimi yoki shu oqimga olib boradigan amal. MFA o‘chirishda xatti-harakatning oqibatini va kerakli tasdiqlashni aniq ko‘rsatish; haqiqiy seanslar bilan birlashtirish.

Dalil: [xavfsizlik paneli](C:/Users/Intel/Desktop/driverweb/src/components/ProfileAccountPanels.jsx:55), [MFA UI](C:/Users/Intel/Desktop/driverweb/src/components/MfaPanel.jsx).

**09. Saqlash usullari foydalanuvchi uchun bir xil tushuntirilmagan**

Ism/telefon Saqlash tugmasi bilan, til/mavzu/vaqt mintaqasi darhol, trak biriktirish o‘z modalining Saqlash tugmasi bilan, bildirishnomalar esa switch orqali saqlanadi. Bu usullarning har biri alohida ishlashi mumkin, lekin sahifada qaysi sozlama qachon kuchga kirishini doim ham bilish oson emas.

Tavsiya: qo‘lda saqlanadigan formalarni darhol saqlanadigan preferences blokidan ajratish. Preferences yonida “Avtomatik saqlanadi” va muvaffaqiyat/xato holatini ko‘rsatish. Trak biriktirishning alohida saqlanishini ham tahrirlash sahifasida tushuntirish.

Dalil: [preferences onChange amallari](C:/Users/Intel/Desktop/driverweb/src/components/ProfileAccountPanels.jsx:35), [haydovchi formasi](C:/Users/Intel/Desktop/driverweb/src/components/DriverSettingsPanel.jsx:66).

**10. Shaxsiy va kompaniyaga tegishli sozlamalar aralashgan**

Administrator Shaxsiy ma’lumotlar ichida kompaniya nomini ham o‘zgartiradi. Ta’sir butun jamoaga tegishli ekanini bildiradigan izoh bor — bu yaxshi. Biroq maydonning joylashuvi uni shaxsiy profil ma’lumoti sifatida qabul qilishga olib kelishi mumkin.

Tavsiya: kompaniya nomi va umumiy kompaniya sozlamalarini Jamoa/Kompaniya kontekstiga ko‘chirish. Shaxsiy qismda administratorning o‘z ism, telefon va shaxsiy preferences maydonlari qoladi.

Dalil: [shaxsiy forma](C:/Users/Intel/Desktop/driverweb/src/components/PersonalProfileForm.jsx:25).

**11. Ikonkalar va xato holatlari izchilligi**

- Jadvaldagi ko‘zchani yopish ikonkasida joriy Rate Con holati ko‘rinmaydi. U umumiy tahrirlash sahifasini ochadi; yonidagi qalam ham shu sahifaga olib boradi. Ikki amal o‘rtasidagi farq tushunarsiz. Bittasini qoldirish yoki hujjat sozlamasiga bevosita olib borish aniqroq.
- Trak maydonlarining ayrim xatolari oddiy span orqali chiqariladi; input bilan `aria-invalid` va `aria-describedby` orqali bog‘lanmagan. Avtomatik statik tekshiruvdan o‘tish buni to‘liq qoplamaydi.
- Ayrim fleet/assignment xatolari serverning `message` matnini to‘g‘ridan-to‘g‘ri ko‘rsatadi. Lokal tilda, amalga bog‘langan xabar va qayta urinish yo‘li izchil emas.
- O‘chirish callback’i ota komponentda xatoda `false` qaytaradi, ProfileView esa natijani tekshirmay profilni yopishi mumkin. Xato toast’i chiqsa ham foydalanuvchi nega ro‘yxatga qaytganini tushunmasligi mumkin. Bu haqiqiy o‘chirish bilan sinalmadi; koddan aniqlangan holat.

Tavsiya: har ikonka uchun bitta aniq ma’no; field xatolarini inputga bog‘lash; xato yuz bersa foydalanuvchining konteksti va kiritgan ma’lumotlarini saqlash; muvaffaqiyatni callback natijasi bilan tekshirish.

Dalil: [ikonka amallari](C:/Users/Intel/Desktop/driverweb/src/components/ProfileView.jsx), [Field komponenti](C:/Users/Intel/Desktop/driverweb/src/components/FleetVehiclesPanel.jsx), [o‘chirish callback’i](C:/Users/Intel/Desktop/driverweb/src/App.jsx:579).

**12. Mobil qulaylik va matnlar**

390px viewportda tab qatori 358px joy egallaydi, ichki tarkibi esa 644px. Oxirgi bo‘limlar yon tomonda qoladi. Gorizontal scroll ishlashi mumkin, ammo keyingi tablar borligini ko‘rsatadigan aniq belgi yo‘q. Mobil ro‘yxatdagi uzun izohlar va bir xil vaznli ko‘p sarlavhalar ham asosiy amalni pastga suradi.

Ba’zi matn tugmalarining balandligi 21px, ko‘p amallar esa 44px dan kichik. Bu avtomatik ravishda WCAG AA buzilishi degani emas: minimum 24px talabida oraliq, teng muqobil boshqaruv va boshqa istisnolar mavjud. Muhim mobil amallar uchun 44px bosish maydoni qulayroq maqsad. [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [WCAG 2.5.5, AAA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).

Tavsiya: tor ekranda section tanlagichi yoki ko‘rinadigan scroll indikatori; muhim tugmalar uchun kattaroq bosish maydoni; yordam matnlarini kerak joyda ochiladigan izohga yig‘ish. Oddiy gorizontal tabning o‘zi xato hisoblanmaydi.

**Yaxshi ishlayotgan jihatlar**

- Asosiy amallar uchun ko‘k rang, neutral kartalar va umumiy shrift tizimi shakllangan.
- Foydalanuvchi qo‘shish va trak qo‘shish tugmalari bir joyda va bir xil o‘lchamda.
- Profil tablarida `tablist`/`tab`/`tabpanel`, tanlangan holat va klaviatura strelkalari mavjud. Manual activation Enter/Space bilan ishlashi WAI-ARIA modeliga mos. [W3C Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
- Modal fokusini cheklash, Escape bilan yopish va asosiy busy holatlari mavjud.
- Driver settings uchun saqlash, saqlash xatosi, retry, account status, audit tarixi va administratorga tegishli amallar ajratilgan.
- Shaxsiy forma server yangilanishi paytida draftni o‘z-o‘zidan ustidan yozmaslikka harakat qiladi.
- 36 holatning hech birida butun hujjatning gorizontal overflow’i qayd etilmadi. Bu ichki jadvalning yashirilishi muammosini bekor qilmaydi.

**Tavsiya etiladigan tuzilma**

| Bo‘lim | Mazmuni |
|---|---|
| Shaxsiy ma’lumotlar | O‘z ism/telefon/email ma’lumoti, til, vaqt mintaqasi va mavzu |
| Kompaniya va jamoa | Kompaniya ma’lumoti, faol/to‘xtatilgan haydovchilar, dispetcherlar, traklar |
| Integratsiyalar | Ulangan servislar, tushunarli status, ulash/uzish va muammo yechimi |
| Xavfsizlik va qurilmalar | Parol, MFA, haqiqiy qurilma va seanslar |
| Bildirishnomalar | Qo‘ng‘iroq/xabar kanallari, ruxsat holati, test va darhol saqlanish belgisi |

Analitika roziligi bildirishnomadan alohida maxfiylik/preferences blokida aniq nom bilan turishi ma’qul. Bu jadval taklif; amaldagi bo‘limlar audit davomida o‘zgartirilmadi.

**Tuzatish tartibi va qabul mezonlari**

1. Ma’lumot yo‘qolishi va mobil trak jadvalini tuzatish. Tab/Orqaga/sidebar/reload oqimlari bo‘yicha draft himoyasini tekshirish; bor trak va uning amallari tor ekranda ham ko‘rinishi kerak.
2. Holatlar modelini va faol/to‘xtatilgan foydalanuvchilar boshqaruvini birlashtirish. Tugallangan/bekor qilingan/bahsli yuklar, smena va akkaunt holatlari bilan testlar kerak.
3. Route holati, oq/qorong‘i kontrast va xato/saqlash holatlarini standartlashtirish.
4. Ma’lumotlar arxitekturasini soddalashtirish: takroriy kontaktlarni kamaytirish, qurilma nomini amaldagi imkoniyatga moslash, asosiy xavfsizlik vazifasini tugallash.
5. 390px telefon, tablet va odatiy desktopda; RU/UZ/EN; ikkala mavzuda, klaviatura, screen reader va zoom bilan qayta tekshirish. Muhim yozish amallari alohida test akkauntida sinovdan o‘tishi kerak.

**Natija fayllari**

[Audit xulosasi JSON](C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/audit-summary.json), [tekshiruv skripti](C:/Users/Intel/Desktop/driverweb/output/profile-ux-audit.spec.mjs), [tekshiruv logi](C:/Users/Intel/Desktop/driverweb/output/profile-ux-audit-run.log).

Screenshot va batafsil JSON natijalari: `C:/Users/Intel/Desktop/driverweb/output/profile-ux-2026-10-26/`.
