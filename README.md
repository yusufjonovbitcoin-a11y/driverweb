# ApexHaul Dispatcher Web

Dispatcher va kompaniya adminlari uchun React/Vite boshqaruv paneli. Ilova Supabase Auth, RLS, Realtime va nomlangan RPC komandalaridan foydalanadi. Klient operatsion jadvallardagi status ustunlariga to‘g‘ridan-to‘g‘ri yozmaydi.

## Lokal ishga tushirish

```bash
npm install
cp .env.example .env.local
npx supabase start
npx supabase functions serve
npm run dev
```

`.env.local` ichida lokal yoki remote Supabase public qiymatlarini kiriting:

```env
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
VITE_TURN_USERNAME=<turn-username>
VITE_TURN_CREDENTIAL=<turn-credential>
```

## Tekshiruv

```bash
npm run lint
npm test
npm run build
npx supabase db lint --local --level warning
npx supabase test db --local
```

Supabase yadro va deploy tartibi [supabase/README.md](supabase/README.md) da yozilgan.

## Asosiy oqim

1. Gmail worker broker xabari va faylini saqlaydi.
2. AI worker ma’lumotlarni ajratadi va warning yaratadi.
3. Dispatcher loadni tekshiradi va bir yoki bir nechta online driverga offer yuboradi.
4. Birinchi accept atomik assignment yaratadi; qolgan offerlar superseded bo‘ladi.
5. Driver bosqichlari, hujjat versiyalari, GPS presence va audit webda Realtime orqali yangilanadi.

Production deploy uchun service-role kalitini brauzerga bermang. Web faqat public publishable/anon key bilan ishlaydi.
`create-member` va `create-company` Edge Function’lari service-role kalitini faqat server muhitida ishlatadi. Admin kiritgan boshlang‘ich parol bilan akkaunt darhol faol holatda yaratiladi; email taklif yuborilmaydi.

Audio/video chat productionda TURN talab qiladi. TURN credentiallari qisqa muddatli bo‘lishi va faqat TLS (`turns:`) endpoint productionda ochiq bo‘lishi tavsiya etiladi. Cloudinary fayllariga haqiqiy muddatli URL kerak bo‘lsa Advanced token access yoqilib, Edge Function secret sifatida `CLOUDINARY_AUTH_TOKEN_KEY` beriladi.
