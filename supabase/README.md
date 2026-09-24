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

`service_role` kaliti web yoki mobil klientga hech qachon berilmaydi.
Ochiq Auth signup o‘chirilgan: foydalanuvchi Auth Admin API orqali yaratiladi yoki taklif qilinadi, keyin actor-aware worker RPC bilan profilga bog‘lanadi.

## Lokal tekshiruv

```bash
npx --yes supabase@latest start
npx --yes supabase@latest db reset --local
npx --yes supabase@latest db lint --local --level warning
npx --yes supabase@latest test db --local
```

Kutiladigan natija: schema lint xatosiz va `5` test faylidagi `71` test muvaffaqiyatli.

## Keyingi deploy ketma-ketligi

Deploy alohida bosqichda bajariladi:

1. Yangi yoki mavjud Supabase project ref aniqlanadi.
2. Production backup va target schema holati tekshiriladi.
3. `supabase link --project-ref <ref>` bajariladi.
4. `supabase db push --dry-run` natijasi ko‘rib chiqiladi.
5. Gmail OAuth secretlari Supabase Vault yoki alohida secrets managerga yoziladi; bazada faqat `secret_reference` saqlanadi.
6. Migratsiyalar `supabase db push` bilan qo‘llanadi.
7. Production smoke testda tenant RLS, Auth, Storage, Realtime va worker queue tekshiriladi.

Remote deploy va production secret kiritish ushbu bosqichda ataylab bajarilmagan.
