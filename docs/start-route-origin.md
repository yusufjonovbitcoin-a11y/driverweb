# Route origin after driver START

The saved-load route uses the GPS location captured by the driver's accepted
`en_route_to_pickup` command. Before START, the existing latest-position estimate
remains available. After START, subsequent presence updates do not move the origin.

`fetchLoadStartLocation` reads the existing RLS-protected tables without schema or
mobile API changes. It selects an accepted `advance_driver_stage` operation for
the exact load, driver and assignment, then matches its `occurred_at` and
`received_at` to the snapshot's `captured_at` and `created_at`. The server writes
both rows in one transaction. This also handles offline capture timestamps while
excluding another assignment's START. Ambiguous or missing GPS is left unknown.

The summary shows road estimates for START → first pickup, every ordered load
stop, their combined distance, and broker rate / combined miles. The map marks
the fixed origin with **S**; both Google Maps actions use the same origin and
preserve every stop, splitting long routes without omissions. Completed trips
never borrow the driver's current position from another trip.

The START evidence is refreshed on assignment/snapshot events, focus and reconnect,
with a visible-page 30-second fallback while waiting for START. Errors expose a
retry action. This display does not rewrite stored driver pay, PDF miles or GPS
tracks. The financial worker remains responsible for immutable pay calculations.

Verification: targeted model/service tests cover assignment isolation, missing or
ambiguous GPS, offline timestamps, coordinates at zero, route splitting and later
GPS movement. A saved load with recorded START GPS was checked in the local UI;
both map links included START → pickup → delivery and the summary included the
initial road distance. No live driver action or financial write was performed.
