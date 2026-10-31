# BOL/POD ochilishi — server ruxsati tuzatishi

Sabab: MFA pre-request hook serverning `service_role` REST/RPC so‘rovlarida ham ishlaydi. Ushbu rolga `private.mfa_session_satisfied()`ni bajarish ruxsati yetishmagan. Natijada Cloudinary media profili va PDF byte-stream rate-limit tekshiruvlari 403/42501 bilan rad etilgan. Supabase Storage’dagi Rate Con boshqa yo‘ldan ochilgani uchun muammo ayniqsa BOL/PODda ko‘ringan.

`20261025040520_mfa_backend_service_access.sql` migratsiyasi faqat serverdagi ishonchli service_role uchun private schema/guard va pre-request hook ruxsatlarini aniq berdi. Mavjud foydalanuvchi RLS, tenant va AAL2 shartlari o‘zgarmadi. Backendga qo‘llandi; frontend relizi talab qilinmaydi.

Tekshiruvlar:

- Haqiqiy service-role REST o‘qishi oldin 403, `permission denied for function mfa_session_satisfied`; tuzatishdan keyin 200.
- `scripts/test-mfa-db.mjs` ushbu xatoni izolyatsiya qilingan bazada qayta yaratadi va tuzatishdan keyin backend so‘rovi o‘tishini tekshiradi. Shu bilan birga enrolled AAL1 foydalanuvchisi records/Storage/RPCdan hamon rad etiladi, AAL2 o‘tadi.
- 12 ta desktop/mobile PDF regressiya testi o‘tdi: ochish, qayta ochish, stale URL, bekor qilingan ruxsat, range, preview va timeout oqimlari.
- Haqiqiy #2536705 BOL fayli ikki sahifasi bilan brauzerda ochildi. Mahalliy dalil: `output/bol-restored-2026-10-25.png`.
- Haqiqiy POD JPEG ham 1080 px asl tasvir sifatida yuklandi; ko‘ruvchida xato qolmadi. Dalil: `output/pod-restored-2026-10-25.png`.
- Migratsiya ledgeri tekshiruvi o‘tdi; yangi anonim/public ruxsat berilmadi. Security advisor toifalari avvalgidek qoldi.

Bu tuzatish oldingi MFA o‘zgarishining backend xizmatlari uchun qolib ketgan ruxsatini to‘ldiradi. Tasdiqlash, to‘lov yoki hujjatni o‘zgartirish bajarilmadi.
