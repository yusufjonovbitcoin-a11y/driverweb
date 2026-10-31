# Analitika tuzatishlari — 25.10.2026

Auditdagi beshta tasdiqlangan muammo tuzatildi. Ishlayotgan mahalliy sahifa: `http://127.0.0.1:5174/#analytics`. Demo qaytarilmadi. Haqiqiy yuklar, summalar, PDFlar va to‘lov yozuvlari tahrirlanmadi.

| Muammo | Amalga oshirilgan yechim |
| --- | --- |
| Eski tahrir yangi yozuvni bosib ketishi | Tahrir boshlangan versiya alohida saqlanadi. Boshqa foydalanuvchi o‘zgartirsa, saqlash bloklanadi; yangi qiymatlarni yuklashdan oldin qoralama himoyalanadi. Serverdagi versiya tekshiruvi ham saqlangan. |
| Tasdiqlangan PDF Neti hisobga olinmasligi | Tasdiqlangan hujjatning o‘zgarmas hisobi ustuvor manba. Gross, komissiya, yuk Neti va yakuniy Net keyingi sozlama o‘zgarishlaridan himoyalangan. Tasdiqlanganda analitika keshi yangilanadi. |
| Vaqt zonasi sabab noto‘g‘ri sana | Filtr, jadval va grafik ilovaning tanlangan vaqt zonasida ishlaydi; zona o‘zgarganda natija darhol yangilanadi. |
| OFFSET orqali o‘qishda yuk tushib qolishi | Yuk, sozlama, assignment pay va tasdiqlangan hisob bitta server vaqt kesimida o‘qiladi. Takror, noto‘liq yoki buzilgan javob eski to‘liq natijani almashtirmaydi. |
| Saqlanmagan tahrir yo‘qolishi | Esc, yopish, tashqi fon va Bekor qilish qoralamani tashlashdan oldin tasdiq so‘raydi. Sahifani yangilash/yopishda ham ogohlantirish bor. |

## Moliyaviy ma’no

- Tasdiqlangan hujjatdagi yuk Neti — umumiy ushlanmalardan oldingi daromad. Analitikadagi yakuniy yuk Neti umumiy dispetcher va boshqa ushlanmalarning ulushini ham oladi. Ulush butun hujjatdagi Grossga mutanosib, sentgacha aniq taqsimlanadi; qidiruv va sana filtri uni o‘zgartirmaydi. Barcha Gross nol bo‘lsa teng taqsimlanadi. Ushbu qoida oynada ko‘rsatiladi.
- PDFning yakuniy Neti qo‘lda tuzatilgan bo‘lsa, uning musbat yoki manfiy tuzatishi ham hisobga olinadi. Yuklar bo‘yicha yakuniy Netlar yig‘indisi tasdiqlangan yakuniy Netga teng.
- Faqat PDFdagi stavka tahriri broker qarzini o‘zgartirmaydi. Broker daromadi original yuk stavkasi va qo‘shimcha daromadga asoslanadi. Tasdiqlangan hisobdagi Gross alohida ko‘rsatiladi.
- Kompaniya bo‘limida qo‘shimcha daromad, reys daromadi, brokerdan kelgan pul, qolgan qarz, kompaniya xarajati va reys balansi bor. Balans formulasi yonida yozilgan; u kompaniyaning umumiy sof foydasi deb nomlanmaydi.
- Kiritilmagan pul qiymati nol emas. Shunga bog‘liq jami ham `—` bo‘ladi. Tasdiqlangan hisob to‘lov amalga oshganini anglatmaydi.
- Tasdiqlangan hujjatlar bo‘yicha mavjud admin ruxsati kengaytirilmadi. Dispetcherga ushbu cheklov tushuntiriladi; uning ko‘rinishi reys hisobi va taxminiy hisobdan foydalanadi.

## Server va xavfsizlik

`20261025060531_financial_center_consistent_snapshot.sql` Supabase loyihasiga qo‘llandi. `get_financial_center_snapshot()` STABLE va SECURITY INVOKER; bo‘sh search_path; anonim EXECUTE taqiqlangan. Faol rol/kompaniya tekshiruvi va jadval RLS siyosatlari saqlangan. [PostgreSQL snapshot qoidasi](https://www.postgresql.org/docs/current/xfunc-volatility.html).

Izolyatsiyalangan PostgreSQL sinovi 204 ta yuk, tasdiqlangan summalar, boshqa kompaniya, savatdagi yuk, dispetcher, haydovchi, to‘xtatilgan va anonim foydalanuvchi holatlarini tekshiradi. Haqiqiy bazaga test moliyaviy yozuvlari qo‘shilmadi.

Migrationdan keyingi security/performance advisor tekshirildi. Yangi funksiya uchun alohida ogohlantirish yo‘q. Avvalgi umumiy SECURITY DEFINER, private RLS va indeks tavsiyalari yangi zaiflik isboti sifatida talqin qilinmadi; indekslar ko‘r-ko‘rona o‘chirilmadi. Siz qo‘lda yoqishni tanlagan [leaked-password himoyasi](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ogohlantirishi hali mavjud. [Indeks tavsiyasi izohi](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Tekshiruv

- Node: 912 test o‘tdi.
- Analytics brauzer ssenariylari: 36 test o‘tdi; desktop va mobil, tahrir to‘qnashuvi, qoralama, tasdiqlangan Net, vaqt zonasi, pul oqimi, qidiruv, sana, eksport, ruxsat va tarmoq xatolari.
- PostgreSQL: 204 yozuvli snapshot va rol/kompaniya izolyatsiyasi o‘tdi.
- Lint, uch til lug‘ati tekshiruvi va production build o‘tdi.
- Haqiqiy mahalliy UI: yangi snapshot bilan $2,000 Gross, $240 kompaniya, $10 dispetcher, $322.09 haydovchi qiymatlari saqlandi. Kiritilmagan xarajat/broker summalari `—`.

10,000 yuk / 1,000 haydovchili bir martalik mahalliy model o‘lchovi: eski ikki ortiqcha hisob 408 ms; yangi tayyorlash 92 ms, tayyor natijani qidirish 3 ms. Bu server yoki haqiqiy brauzer tezligi kafolati emas. Sahifa barcha kompaniya yuklarini o‘qiydi; juda katta arxivlar uchun server agregatsiyasi keyingi optimizatsiya bo‘lib qoladi.

Qayta ishga tushirish: `npm test`, `npm run test:financial-center-db`, `npx playwright test --config playwright.financial-center.config.js`, `npm run lint`, `npm run i18n:check`, `npm run build`. Bu tekshiruvlar CIga ham ulangan.
