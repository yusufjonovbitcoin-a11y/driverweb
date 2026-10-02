# Workspace navigation cache

`WorkspaceCache` wraps all routes in `App`, keyed by authenticated user ID,
company ID and role. Data and view selections are in memory only. Logging out,
switching account/company/role, or reloading the document starts a new cache.
No inbox, accounting or GPS data is persisted to browser storage.

SWR owns request deduplication, concurrent-response protection, background
revalidation, reconnect/focus handling and bounded error retries. The wrapper
adds explicit successful-response freshness for navigation (including React
StrictMode). Cached content remains visible during refresh or refresh errors.
An uncached query still needs its initial loading state.

| Query | Fresh on remount | Visible-page polling |
| --- | --- | --- |
| Broker inbox | 15 seconds | 15 seconds |
| Trip analytics, keyed by all filters and page size | 30 seconds | 60 seconds |
| Driver tracking sessions | 60 seconds | 120 seconds |
| Driver/load track | 60 seconds | 120 seconds for active loads |
| Fleet vehicles | 15 seconds | Focus/reconnect only |

Polling pauses while the document is hidden/offline. Focus revalidation is
throttled to 30 seconds. Shared requests are deduplicated for 10 seconds.
Track history is cached separately per driver/load and refreshed incrementally;
live position still comes from workspace presence, not a cached GPS fallback.
Mapbox canvases/tiles and PDF documents are not kept mounted by this cache.

Successful inbox read actions update cached messages. Accounting saves
invalidate every analytics filter/page, including unmounted queries. Relevant
load/vehicle changes in workspace refreshes invalidate dependent summaries;
location-only heartbeats do not. Fleet saves explicitly refresh their query.

Analytics mode/filters and map/inbox selections survive route changes. Form
drafts and credentials are not retained. The primary workspace already retains
loads/drivers/members above the routes; chat retains its existing lifecycle.

## Focused verification

With Vite running, open `/scripts/workspace-cache-test.html`. The fixture uses
synthetic deferred promises only, no backend reads/writes. It checks StrictMode
deduplication, immediate remount data, retained view state, background refresh,
error retention, mutations, invalidation, expiry, filter keys, session isolation
and late responses. The title reports `PASS: 14 cache checks` on success.

Related model regressions:

```sh
node --test src/components/mapLoadStatsModel.test.js src/services/tripAccounting.test.js src/services/fleetVehicleModel.test.js
```
