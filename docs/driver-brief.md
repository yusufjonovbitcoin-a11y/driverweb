# Source-backed driver sheet

## Contract

PDF/photo import prepares a fixed driver sheet, not a free-form AI summary. This
reduces unsupported output; it does **not** guarantee 100% factual accuracy.
Both extraction and audit are model-generated and can share an error. Dispatchers
must compare the sheet against the original before assigning it.

1. Validate file type, signature, size, authenticated role and company.
2. Extract structured fields, each with a source page and verbatim excerpt.
3. Audit the candidate independently against the original document.
4. Apply deterministic type/provenance checks. Unsupported fields are removed.
5. Save an unreviewed draft and the exact source-backed sheet. Retries reuse the
   saved extraction so the draft route and driver sheet do not diverge.
6. Open `ImportedLoadPage` immediately when a valid file is chosen (including
   loading/error/retry states), then populate its pickup/delivery, commercial,
   broker and cargo panels from the extraction. The original remains accessible
   in the toolbar; the duplicated expanded driver-sheet block was removed at the
   user's request. Source excerpts remain saved in the reviewed snapshot. Require the
   dispatcher to confirm review. Unresolved blocking fields prevent assignment.
7. `review_and_assign_document_load` verifies tenant/role/checksum and atomically
   records review, approves the draft and assigns the driver. Assignment/offer
   triggers reject unreviewed sheets even if another client skips the web dialog.
8. The Flutter load information tab displays the reviewed snapshot and source
   excerpts. Its existing local load cache preserves the sheet for offline use.

## Deliberate restrictions

- Exactly one load, one pickup and one delivery per uploaded document. Multi-stop,
  unreadable and multi-load documents fail closed rather than lose information.
- Dates/times are shown exactly as printed. A timezone is never guessed from a
  state. Missing values stay unknown; negative temperature and explicit false/zero
  are preserved where valid (cargo weight must be positive).
- Missing essential route/load identifiers, rejected fields, incomplete operating
  requirements or missing reefer temperature block dispatch.
- Existing imports from older extraction schemas are not silently reanalyzed.
- Source quotes are not independently OCR-validated; the human original-document
  comparison remains necessary. No real-document accuracy benchmark was run.
- Mapbox geocoding and driving directions provide a separate display-only route.
  Weak address matches are rejected, map failure does not prevent document review,
  and route estimates never overwrite document distance or RPM. This is not truck
  navigation. See the [Geocoding API](https://docs.mapbox.com/api/search/geocoding/)
  and [Directions API](https://docs.mapbox.com/api/navigation/directions/).
- Only address-related blockers disable the route, not unrelated cargo/instruction
  warnings. Map markers show pickup A, delivery B and the selected online driver's
  valid GPS location. Missing or offline GPS is explicitly marked unavailable.

## Verification

- `npm test`, `npm run lint`, `npm run build`, `npm run i18n:check`.
- `deno check supabase/functions/parse-load-document/index.ts`.
- With PostgreSQL server binaries on PATH: `npm run test:driver-brief-db`.
  This creates an isolated temporary local cluster and tests tenant isolation,
  assignment/offer guards, atomic rollback and successful review/assignment.
- Browser-only synthetic review fixture: `/scripts/driver-brief-test.html` and
  `?blocked`. It never sends or assigns a real load.
- Full import page fixture: `/scripts/import-load-page-test.html?mode=processing`
  (also `mode=error` and `mode=blocked`). `mode=map` exercises real Mapbox calls with
  public business addresses and an explicitly synthetic GPS driver. Other modes
  disable map networking. No fixture performs real assignments.
- Flutter: `flutter test test/unit/driver_brief_test.dart` and
  `flutter analyze --no-pub` in the companion driverapp repository.

## Delivery status (2026-10-02)

- Migration `20261001220059_verified_driver_brief.sql` applied to linked Supabase
  project `gsnbjpqwwpvqtmphsyfs`.
- `parse-load-document` deployed with JWT verification enabled (version 13).
- Web changes are local; no public web hosting release was performed.
- Flutter source/tests updated; no physical-device install or mobile release.
- No real load was dispatched during browser validation. Production authenticated
  PDF/image extraction and multi-device delivery still need a real-document trial.
