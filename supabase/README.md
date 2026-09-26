# ApexHaul Supabase core

Bu katalog dispatcher web ilovasi va driver mobil ilovasi uchun yagona operatsion yadrodir. Hozirgi paket lokal tekshiruvdan o‘tgan, lekin hali masofaviy Supabase loyihasiga deploy qilinmagan.

## Migratsiyalar

1. `202609240001_core_schema.sql`
   - kompaniya, foydalanuvchi, Gmail, broker xabari, AI extraction, load, stop, offer, assignment, hujjat, warning, location, notification, job va audit jadvallari;
   - asosiy enumlar, indekslar, Realtime jadvallari va private Storage bucketlar;
   - load yaratish, tasdiqlash, offer yuborish/qabul qilish, stop holatini o‘zgartirish va loadni yakunlash RPC’lari.
2. `202609240002_integrity_and_commands.sql`
   - kompaniyalar orasida ID aralashib ketishini to‘sadigan composite foreign keylar;
   - bekor qilish, qayta tayinlash, narx/masofa/appointment o‘zgartirish, hujjat versiyalash va warning override buyruqlari.
3. `202609240003_security_workers_and_views.sql`
   - role-aware RLS, xavfsiz read view’lar va Storage policy’lar;
   - Gmail/AI/document worker queue RPC’lari;
   - haydovchi shartlar o‘zgarishini qayta tasdiqlash mexanizmi.
4. `202609240004_operational_hardening.sql`
   - dispatcher uchun `all` yoki `selected` driver ko‘rish scope’i;
   - faqat so‘nggi 2 daqiqada online bo‘lgan driverga offer yetkazish;
   - oflayn paytda o‘tib ketgan offerni driverdan yashirish;
   - birinchi acceptni atomik saqlash va qabul qilingan price snapshotni assignmentga bog‘lash;
   - shartlar o‘zgarganda qayta tasdiqlashsiz stopni yuritishni bloklash;
   - AI extraction retry/upsert, actor-aware member registration va stale job recovery;
   - default privilege’larni yopish va eski xavfsiz bo‘lmagan member registration RPC’ini olib tashlash.
5. `202609240005_web_read_models.sql`
   - dispatcher web uchun load va member read model’lari, manzil koordinatalari va HOS qiymatlari.
6. `202609240006_driver_execution_stage.sql`
   - driver mobil oqimidagi barcha bajarish bosqichlari va atomik `advance_driver_stage` komandasi.
7. `202609240007_service_worker_privileges.sql`
   - faqat ishonchli Gmail/AI/push workerlar uchun `service_role` jadval ruxsatlari.
8. `202609240008_driver_operating_profile.sql`
   - CDL, truck, duty status maydonlari va `set_driver_duty_status` komandasi.
9. `202609240009_driver_load_history_access.sql`
   - driverga pending offer va o‘z assignment tarixinigina ko‘rsatadigan load access qoidasi.

## Muhim invariantlar

- Klient `loads.status`, `load_stops.status`, `offers.status` yoki `assignments`ga to‘g‘ridan-to‘g‘ri yozmaydi.
- Har bir biznes o‘zgarishi nomlangan `SECURITY DEFINER` RPC orqali bajariladi.
- Barcha tenant obyektlari `company_id` bilan bog‘langan va RLS boshqa kompaniya ma’lumotini yashiradi.
- Bir load uchun faqat bitta `active` assignment bo‘ladi.
- Bir load va driver juftligi uchun faqat bitta `pending` offer bo‘ladi.
- Oflayn driverga yuborilgan offer `missed_offline` audit yozuvi bo‘lib qoladi, driver inboxida ko‘rinmaydi.
- AI faqat extraction yoki warning yaratadi; load jarayonini o‘zi bloklamaydi.
- Hujjatning birinchi original versiyasi va keyingi barcha versiyalari saqlanadi.
- Audit jadvali append-only.

## Klient RPC’lari

Dispatcher/admin:

- `create_load_draft`
- `approve_load_draft`
- `send_offer`
- `withdraw_offer`
- `cancel_load`
- `reassign_load`
- `update_load_terms`
- `set_dispatcher_driver_access`
- `override_document_warning`
- `correct_extraction_field`
- `set_member_status`

Driver:

- `upsert_driver_presence`
- `mark_offer_seen`
- `respond_offer`
- `update_driver_profile`
- `confirm_updated_terms`
- `transition_stop`
- `complete_load`
- `advance_driver_stage`
- `set_driver_duty_status`

Hujjat:

- `begin_document_upload`
- Storage bucketga berilgan `storagePath` bilan upload
- `complete_document_upload`

Worker-only, `service_role`:

- `register_super_admin`
- `create_company_with_admin`
- `register_company_member_as`
- `register_gmail_connection`
- `set_gmail_connection_status`
- `ingest_broker_message`
- `record_ai_extraction`
- `claim_jobs`, `complete_job`, `fail_job`, `requeue_stale_jobs`
- `record_document_check`

Edge Function’lar:

- `create-member` — company admin/dispatcher ruxsatiga qarab driver yoki dispatcher hisobini parol bilan darhol yaratadi.
- `create-company` — super admin uchun kompaniya va birinchi company admin taklifini yaratadi; profil xatosida Auth invite qaytarib olinadi.
- `cloudinary-media` — tenant/participant tekshiruvli media upload, delete va private delivery URL yaratadi.
- `gmail-integration` — company admin uchun Gmail App Password’ni Supabase Vault’da saqlaydi, holatini qaytaradi va integratsiyani uzadi.
- `turn-credentials` — aktiv foydalanuvchiga Cloudflare Realtime TURN API orqali bir soatlik WebRTC credential beradi.
- `process-push-notifications` — faqat `PUSH_WORKER_TOKEN` bilan chaqiriladigan worker; navbatdagi `push.notification` joblarini FCM HTTP v1 orqali yuboradi va `UNREGISTERED` tokenlarni tozalaydi.
- `process-media-deletions` — faqat `MEDIA_CLEANUP_WORKER_TOKEN` bilan chaqiriladigan worker; tugallanmay qolgan uploadlarning `provider.media_delete` navbatini Cloudinary yoki private Storage'dan idempotent tozalaydi.

`service_role` kaliti web yoki mobil klientga hech qachon berilmaydi.
Ochiq Auth signup o‘chirilgan: foydalanuvchi Auth Admin API orqali yaratiladi yoki taklif qilinadi, keyin actor-aware worker RPC bilan profilga bog‘lanadi.

Gmail credential brauzerga yoki `gmail_connections` jadvaliga ochiq matn sifatida yozilmaydi. Profil → Integratsiyalar oqimi App Password’ni `gmail-integration` Edge Function’iga yuboradi, funksiya uni Vault’da saqlaydi. Node IMAP worker `get_gmail_worker_credentials` service-role RPC orqali credential’ni faqat ish jarayonida oladi. Worker muvaffaqiyatli IMAP login qilgach ulanish `active` bo‘ladi; ungacha UI `Tekshirilmoqda` holatini ko‘rsatadi.

## Lokal tekshiruv

```bash
npx --yes supabase@latest start
npx --yes supabase@latest db reset --local
npx --yes supabase@latest db lint --local --level warning
npx --yes supabase@latest test db --local
```

Kutiladigan natija: schema lint xatosiz va joriy `9` SQL test faylidagi `204` pgTAP assertion muvaffaqiyatli.

## Keyingi deploy ketma-ketligi

Deploy alohida bosqichda bajariladi:

1. Yangi yoki mavjud Supabase project ref aniqlanadi.
2. Production backup va target schema holati tekshiriladi.
3. `supabase link --project-ref <ref>` bajariladi.
4. `supabase db push --dry-run` natijasi ko‘rib chiqiladi.
5. Gmail OAuth, Cloudinary, TURN, CORS va Firebase secretlari Supabase secrets managerga yoziladi. Cloudinary uchun `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` va `CLOUDINARY_API_SECRET` yetarli; Free tarifda private media `authenticated` delivery URL imzosi bilan ochiladi. Cloudflare TURN uchun `CLOUDFLARE_TURN_KEY_ID` va `CLOUDFLARE_TURN_KEY_API_TOKEN`; browser Edge Function chaqiruvlari uchun vergul bilan ajratilgan, aniq originlardan iborat `CORS_ALLOWED_ORIGINS` (masalan `https://driverweb.example.com`); push uchun `FIREBASE_SERVICE_ACCOUNT_JSON` va `PUSH_WORKER_TOKEN`; media tozalash uchun alohida `MEDIA_CLEANUP_WORKER_TOKEN` ishlatiladi. `CORS_ALLOWED_ORIGINS`ga `*`, path yoki trailing slash yozilmaydi.
6. Migratsiyalar `supabase db push` bilan qo‘llanadi.
7. Production smoke testda tenant RLS, Auth, Storage, Realtime va worker queue tekshiriladi. CORS preflight ham production origin bilan tekshiriladi: `Origin: https://driverweb.example.com` va `Access-Control-Request-Method: POST` headerli `OPTIONS` so‘rovi `2xx`, aynan shu `Access-Control-Allow-Origin` va `Vary: Origin` qaytarishi; ro‘yxatda bo‘lmagan origin esa `403` qaytarishi shart.

Cloudflare TURN secretlari va `turn-credentials` funksiyasi production’ga
2026-09-26 kuni deploy qilindi. Qolgan migratsiya va funksiyalar yuqoridagi
ketma-ketlik bo‘yicha alohida tekshiriladi.

## Push worker scheduler runbook

`process-push-notifications` o‘z-o‘zidan ishga tushmaydi. Supabase Cron yoki tashqi scheduler har daqiqada function endpoint’iga `POST` yuborishi, `X-Worker-Token` headerida Supabase secret sifatida saqlangan `PUSH_WORKER_TOKEN`ni berishi kerak. Body sifatida `{ "batchSize": 3 }` yetarli. Scheduler faqat HTTP statusni emas, javobdagi `claimed`, `completed`, `failed`, `transitionFailures` va `deadlineReached` maydonlarini ham kuzatishi kerak; non-2xx yoki nol bo‘lmagan failure qiymati alert yaratadi. `FIREBASE_SERVICE_ACCOUNT_JSON` to‘liq service-account JSON bo‘lib, faqat server-side Supabase secret sifatida saqlanadi; uni Vite yoki mobil environment’ga yozish mumkin emas.

Worker `claim_push_deliveries` bilan har notification/qurilma juftligini atomik egallaydi. Muvaffaqiyat `complete_push_delivery` bilan `sent` bo‘ladi; vaqtinchalik xato `fail_push_delivery` orqali qayta navbatga tushadi, doimiy provider xatosi esa terminal `cancelled` holatiga o‘tadi. `(notification_id, device_id)` queue dublikatini oldini oladi. FCM qabul qilganidan keyin DB acknowledgement yo‘qolsa external delivery at-least-once bo‘lib, qayta yuborilishi mumkin; klient `notificationId` bo‘yicha dublikatni yutishi shart. Worker ko‘pi bilan 9 ta delivery claim qiladi, ularni uchta parallel so‘rov bilan yuboradi va deadline oldidan ishlanmagan claimlarni qayta navbatga bo‘shatadi. Worker crashidan keyin besh daqiqadan eski `processing` lease keyingi claimda qayta egallanadi. FCM `UNREGISTERED` javobini qaytargan device token bazadan o‘chiriladi; har user uchun 10 ta faol qurilma limiti bor.

## Media cleanup worker scheduler runbook

`process-media-deletions` ham o‘z-o‘zidan ishga tushmaydi. Scheduler har besh daqiqada endpoint'ga `POST`, `X-Worker-Token: <MEDIA_CLEANUP_WORKER_TOKEN>` va `{ "batchSize": 3 }` yuboradi. Secret push worker tokenidan alohida bo‘lishi shart. Javobdagi `failed`, `transitionFailures`, `deadlineReached`, `maintenance` va non-2xx status monitoringga ulanadi. Har ishga tushishda worker bounded `cleanup_expired_document_uploads`, `requeue_stale_jobs` va `cleanup_edge_rate_limits` maintenance RPC’larini bajaradi, keyin faqat `provider.media_delete` turini claim qiladi. Uchta parallel cleanup bilan ishlaydi, doimiy payload/provider xatosini darhol dead-letter qiladi, Cloudinary `not found` javobini idempotent muvaffaqiyat deb qabul qiladi va deadline'da qolgan claimlarni qayta navbatga chiqaradi.
