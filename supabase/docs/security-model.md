# Xavfsizlik modeli

## Rollar

| Rol | Asosiy vakolat |
| --- | --- |
| `super_admin` | Barcha kompaniyalarni ko‘rish va platformani boshqarish |
| `company_admin` | O‘z kompaniyasi, Gmail, dispatcher va driverlarni boshqarish |
| `dispatcher` | Ruxsat berilgan driverlar, loadlar, offerlar va hujjatlarni boshqarish |
| `driver` | O‘z offer/assignment/load/hujjatlari va online presence’i |

## Himoya qatlamlari

- Auth foydalanuvchisi `profiles.id = auth.users.id` bilan bog‘langan.
- Ochiq signup va authenticated self-bootstrap yopiq; kompaniyani faqat aktiv super admin nomidan service worker yaratadi.
- Tenant jadvallarida `company_id` majburiy va composite foreign keylar boshqa kompaniya IDlarini aralashtirishni to‘sadi.
- Klient jadvallarda faqat kerakli `SELECT` huquqiga ega; yozish RPC orqali.
- RPC ichida joriy foydalanuvchi roli, kompaniyasi, load versioni va joriy holat tekshiriladi.
- Driver ko‘rishi dispatcher scope’i, offer yoki aktiv assignment bilan cheklangan.
- Storage path formati `company_id/load_id/document_id/version_id/file` bo‘lib, RLS shu identifikatorlarni qayta tekshiradi.
- `broker-originals` faqat admin/dispatcher uchun; `load-documents` tegishli loadga kirishi bor foydalanuvchilarga.
- Worker funksiyalari faqat `service_role`ga ochilgan.
- Kelajakda yaratiladigan public obyektlar uchun default privilege yopilgan; har yangi obyektga ruxsat alohida beriladi.

## Offline va idempotency

- Driver presence 2 daqiqadan eski bo‘lsa offline hisoblanadi.
- Offline offer audit uchun saqlanadi, notification yaratilmaydi va driver uni keyin ko‘rmaydi.
- `respond_offer` va `transition_stop` `operation_id` orqali mobil retry’larni idempotent bajaradi.
- `respond_offer` load qatorini lock qiladi; shu sabab ikki driver bir loadni bir vaqtda qabul qila olmaydi.
- Worker joblari `FOR UPDATE SKIP LOCKED` bilan olinadi va qolib ketgan lease `requeue_stale_jobs` orqali qaytariladi.
