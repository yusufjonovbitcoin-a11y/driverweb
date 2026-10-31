# START pay address verification fix

The selected load (broker reference 258567, internal number 106) had an accepted
START (`en_route_to_pickup`) and immutable origin/rate, but its mileage job was
retrying with `DRIVER_PAY_PROVIDER_UNAVAILABLE`. Cron was enabled and retrying;
START itself had not failed.

The live Mapbox geocoder returned both **10 Burton Drive** and **10 Button Drive**
in the same town/postcode with `confidence: exact` and `street: matched`. The old
filter accepted both provider labels and then rejected the ambiguous result set.
This safely avoided choosing arbitrary payable mileage, but prevented settlement.

The Mapbox filter now independently compares returned structured street/number,
state, country and ZIP (or city when ZIP is absent), using the same canonical
address comparison already used by Google Places. Similar spelling is not an
exact match. Genuine multiple matching candidates still fail closed. No provider
fallback, GPS replacement, rate change or manual mileage override was added.

Only `google-load-route.ts` changed in the deployed `calculate-driver-start-pay`
v5 bundle; the existing handler, dedicated worker authentication and dependencies
were preserved and read back. The rollback bundle is in ignored
`tmp/start-pay-worker-v4-backup.json`.

Verification: 36 targeted routing/worker/reader/START tests and lint passed.
The actual provider calculation with the stored START snapshot succeeded without
changing the input. Normal cron then completed the existing job at 20:38 UTC:
1,150.17 loaded miles + 1,498.01 deadhead miles = 2,648.18 miles, frozen rate
$0.50/mile, amount $1,324.09. The database job was completed with no error and the
web panel changed automatically to “Оплата рассчитана”. No second START was sent.
OPTIONS returned 200 and unauthenticated POST returned 401. Temporary local GPS
input was removed after verification.

UI proof: `output/start-pay-route-fixed-2026-11-01.png`.

Provider reference: [Mapbox Smart Address Match](https://docs.mapbox.com/api/search/geocoding/).
