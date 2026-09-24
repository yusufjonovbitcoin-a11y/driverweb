# Load va stop holatlari

## Load

| Joriy holat | Keyingi holat | Buyruq yoki sabab | Kim bajaradi |
| --- | --- | --- | --- |
| `draft`, `review` | `ready_for_offer` | `approve_load_draft` | Admin, dispatcher |
| `ready_for_offer` | `ready_for_offer` | Oflayn driverga offer o‘tib ketdi | Tizim |
| `ready_for_offer`, `offered` | `offered` | Online driverga kamida bitta pending offer yuborildi | Admin, dispatcher |
| `offered`, `ready_for_offer` | `assigned` | Pending offerni birinchi driver qabul qildi | Driver |
| `assigned` | `in_progress` | Pickup stop `arrived` yoki `done` | Driver, dispatcher |
| `in_progress`, `assigned` | `delivered` | Delivery stop `done` | Driver, dispatcher |
| `delivered` | `completed` | `complete_load` | Driver, dispatcher, admin |
| Tugallanmagan holat | `cancelled` | Dispatcher yoki broker bekor qildi | Admin, dispatcher |
| Aktiv assignmentli holat | `ready_for_offer` / `offered` | Qayta tayinlash | Admin, dispatcher |

`cancelled` va `completed` terminal holat. Qo‘shimcha yuk birinchi yukdan mustaqil yangi `loads` yozuvi sifatida yaratiladi; umumiy marshrut bekor qilingan load sabab avtomatik qayta yozilmaydi.

## Offer

| Joriy holat | Keyingi holat | Sabab |
| --- | --- | --- |
| Yangi | `missed_offline` | Driver offline yoki presence 2 daqiqadan eski |
| Yangi | `pending` | Driver online |
| `pending` | `accepted` | Driver birinchi bo‘lib qabul qildi |
| `pending` | `declined` | Driver rad etdi |
| `pending` | `withdrawn` | Dispatcher qaytarib oldi yoki load bekor qilindi |
| `pending` | `superseded` | Boshqa driver shu loadni qabul qildi |

Pending offerning avtomatik muddati yo‘q. U driver javob berguncha, dispatcher qaytarib olguncha, load bekor bo‘lguncha yoki boshqa driver qabul qilguncha turadi.

## Stop

| Joriy holat | Keyingi holat | Shart |
| --- | --- | --- |
| `pending` | `arrived` | Aktiv assignment va joriy load version |
| `arrived` | `done` | Kerakli hujjat yuklangan |
| `pending` | `skipped` | Vakolatli foydalanuvchi qarori |

Narx, loaded miles yoki appointment o‘zgargan bo‘lsa, aktiv driver avval `confirm_updated_terms` bajaradi. AI warning stop yoki loadni bloklamaydi; warning driver va dispatcherga ko‘rinadi.

## Hujjat

1. `begin_document_upload` document va navbatdagi version yozuvini yaratadi.
2. Klient faylni private `load-documents` bucketga yuklaydi.
3. `complete_document_upload` storage obyektini tekshiradi, yangi versionni current qiladi va AI check job yaratadi.
4. Worker `record_document_check` bilan `passed`, `warning` yoki `failed_to_read` natijasini saqlaydi.
5. Dispatcher `override_document_warning` bilan sabab yozib warningni yopishi mumkin.
