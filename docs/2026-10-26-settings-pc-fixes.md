# Sozlamalar: PC uchun tuzatishlar

2026-10-26 · Mahalliy sayt: http://127.0.0.1:5174/#profile

Desktop sozlamalari qayta tartiblandi. Administrator uchun Jamoa, Shaxsiy ma’lumotlar, Integratsiyalar, Xavfsizlik va Bildirishnomalar qoldi. Dispetcherga integratsiyalar ko‘rsatilmaydi. Foydalanuvchining so‘nggi ko‘rsatmasiga binoan yangi “Компания” tabi va formasi olib tashlandi. Kompaniya nomini tahrirlash shaxsiy formaga qayta joylashtirilmadi.

## Tuzatilgan jarayonlar

- PC uchun jadval saqlandi; torroq konteyner sababli trak jadvalini yashirgan selektor cheklab qo‘yildi. Shaxsiy ma’lumotlar, regional sozlamalar, xavfsizlik va bildirishnomalar desktop ustunlariga joylashtirildi. Yorug‘ va qorong‘i rejimdagi kontrast, maydonlar, tugmalar hamda shriftlar umumiy tokenlarga moslashtirildi.
- Haydovchi holati umumiy ro‘yxatdagi model bilan hisoblanadi. Bekor qilingan va nizoli yuklar haydovchini “yukda” qilib qo‘ymaydi. To‘xtatilgan haydovchilar boshqaruv ro‘yxatida qoladi; tahrirlash sahifasi akkaunt to‘xtatilganidan keyin ham yopilmaydi.
- Jihoz katagi faqat ma’lumot ko‘rsatadi. Tahrirlash uchun bitta qalam amali qoldi; shu sahifani ochgan takroriy yashirish ikonkasi olib tashlandi. O‘chirish muvaffaqiyatsiz bo‘lsa profil yopilmaydi.
- Bo‘lim, jamoa turi va haydovchini tahrirlash manzilda saqlanadi. Qayta ochish va Back/Forward ushbu holatni tiklaydi.
- Shaxsiy forma, haydovchi muharriri, yangi foydalanuvchi formasi, Gmail paroli, parolni o‘zgartirish va MFA sozlashda saqlanmagan holat himoyalanadi. Navigatsiya va sahifani yangilashda ogohlantirish bor; saqlash davomida chiqish to‘xtatiladi. Bekor qilingan Back/Forward tarixdagi avvalgi yozuvni almashtirmasdan tiklanadi. Parollar brauzer xotirasiga yoki URLga yozilmaydi.
- Soxta qurilmalar ro‘yxati olib tashlandi; xavfsizlikda joriy brauzer haqida haqiqiy ma’lumot ko‘rsatiladi. Parolni o‘zgartirish formasi, server talab qilganida qo‘shimcha tasdiqlash kodi va MFAni o‘chirishdan oldin tasdiqlash qo‘shildi.
- Til, vaqt zonasi va mavzu avtomatik saqlanishi aniq ko‘rsatiladi. Foydalanish analitikasi roziligi shaxsiy sozlamalarda; qo‘ng‘iroq va xabar bildirishnomalari o‘z bo‘limida. Integratsiya holati URL orqali qayta ochilganda ham serverdan yuklanadi.

## Tekshiruv

- `npm test`: 926/926.
- Desktop UI: 28 ta noyob test o‘tdi. Yakuniy to‘plamdagi 24 ta test umumiy yurishda, navigatsiya/holat bo‘yicha 6 ta va MFA bo‘yicha 2 ta test tegishli tuzatishlardan so‘ng alohida qayta tekshirildi.
- UI va kontrast: 1024, 1321, 1600, 1920 px; beshta asosiy bo‘lim, yorug‘ va qorong‘i rejim. Axe WCAG 2 A/AA tekshiruvlarida buzilish topilmadi. Oddiy va keng desktop loyihalari ishlatildi.
- `npm run lint`, `npm run i18n:check`, uch tildagi SSR tekshiruvi va production build o‘tdi. Katta xarita/PDF bundle’lari haqidagi mavjud build ogohlantirishi saqlanadi.
- Lokal ishlayotgan sayt brauzerda ko‘rildi. Skrinshot: `output/profile-settings-pc-local.png`.

Testlar soxta mahalliy hisob va xizmatlar bilan bajarildi. Haqiqiy hisob paroli, MFA, Gmail ulanishi, haydovchi holati yoki ma’lumotlar bazasi sinov uchun o‘zgartirilmadi. Mobil dizayn ushbu ishning maqsadi emas edi. Yangi server migratsiyasi talab qilinmadi.

Parol jarayoni Supabase’ning [updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser) va [reauthenticate](https://supabase.com/docs/reference/javascript/auth-reauthenticate) APIlariga ulanadi; serverning parol va MFA talablari saqlanadi.
