# T Fleets document engine — implementation and operating notes

Date: 2026-10-31. Implemented locally; **not deployed to production**. No database migrations, production loads, assignments, remote secrets or driver accounts were changed by this task.

## Measured result and release status

The frozen 12-file/40-page suite improved from **263/289 to 282/289 selected checks** (91.0% → 97.6%). Mean local processing time decreased from **16.07 s to 11.56 s**. Total tokens decreased from **107,038 to 95,815** (10.5%). Standard token cost estimate decreased from $0.07241 to $0.06052 for the whole suite, excluding OCR hosting.

The new run used **17 requests**: 12 initial extractions plus 5 bounded field retries. The old run used 12 requests. Unsuccessful retries and their cost/time are included. Source verification deliberately holds some values instead of accepting model guesses: wrong populated selected checks fell from 25 to 1; missing/held checks increased from 1 to 6.

Do not describe this as 99% overall accuracy or a latency SLA. On the nine 1–5-page digital files without OCR, P50 was approximately **10.71 s** and nearest-rank P95 **15.27 s**. The <5 s / <10 s targets are **unmet**. API response generation remains the dominant stage; native parsing measured about 7–335 ms in these traces, selective OCR approximately 1.1–2.0 s where used. A faster native parser alone cannot remove the model generation delay.

Complete-critical agreement, using all frozen load/broker/rate/stop/location/date/time checks plus exact broker aliases, was **8/12 before and 7/12 after**. This decrease is material: explicitly holding the conflicting ZIP and uncertain broker identities prevents some documents from being called complete. Complete agreement across all selected checks increased from 2/12 to 7/12. Neither measure establishes that every instruction/contact/fee in a document is correct.

The 8 additional synthetic PDFs scored **103/104 independent fixture checks**. They cover scanned, mixed, multi-stop, missing-unit/address, contradictory ZIP, repeated references, longer clauses and prompt injection. These results are kept separate from the real suite. The remaining synthetic failure is the scanned weight unit/value being held; OCR is not infallible.

See `output/pdf-engine-benchmark-2026-10-31/report.html`, `report.md`, `comparison.json`, per-file `*.final.json` and `*.validation.json` for exact numbers, stage timings, model usages and source evidence. All 12 original file SHA-256 hashes still match the original manifest. These local reports contain shipment information and should remain private.

## Existing architecture audit

1. `src/App.jsx` calls `prepareLoadFromDocument` in `src/services/operationsService.js` after a dispatcher selects a file.
2. `parse-load-document` authenticates the user, loads the active company role, applies distributed rate limits and checks the file extension, MIME, signature and 20 MB bound.
3. Previously, the complete original PDF was sent to OpenAI as `input_file`, with a large structured output containing values and model-written quotes. PDF image/text processing and verbose generated evidence accounted for most time and tokens. The measured baseline spent almost all its 16.07 s mean in the API, rather than PDF.js viewing or database writes.
4. `verifyLoadExtraction` had an `ai_pdf_direct` compatibility branch. In that branch many source/semantic checks were bypassed because source quotes came from the same model, without an independently extracted PDF text manifest.
5. Preview processing creates no import/load/media row. It signs a 30-minute extraction result bound to actor, company, file hash, filename, MIME and extraction version.
6. Confirmation verifies that binding and reuses the result without another AI call. Existing private source upload, document-version attestation, driver-pay preparation and `review_and_assign_document_load` transaction remain in place. A failed assignment/upload can resume the same draft.
7. PDF viewing uses the separate viewer/document URL flow. Opening or navigating a PDF does **not** call the extraction model.

### Causes of the baseline failures

- Carrier identity and billing/shipper addresses could become broker/route fields.
- BOL number could become load number; signature dates could replace scheduled dates.
- Printed stop order could be replaced with chronological sorting.
- Missing weight units, unknown hazmat and city-only locations could be inferred as complete facts.
- Rate, repeated rate totals, cargo value and penalties were not independently associated with their labels.
- Dates, appointment windows, facility hours and time-like appointment reference numbers were conflated.
- A model-generated citation was treated as a source assertion, rather than checked against server-owned page text and geometry.

The baseline 26 failures are preserved in the report, not replaced with a new answer key. The scorer's already documented date-normalization correction is applied equally to old and new results. Reference answers are never sent to the model.

## Implemented pipeline

```text
Authenticated upload → file validation → SHA-256
  → actor/company/version/model-bound cache lookup
  → native PDF.js/unpdf text and coordinates, all pages
  → per-page text/image quality classification
  → selective private OCR when configured and necessary
  → compact strict-schema facts referencing source IDs
  → source/label/stop/number/unit checks and original clause reconstruction
  → at most one bounded field retry
  → independent re-verification → signed preview
  → user confirmation → existing private upload/load/assignment transaction
```

### Runtime and extraction

The import-to-load workflow still requires shipment stops. An invoice or POD without enough route information is not automatically turned into an assignable load. The document can be classified, but a complete general-purpose invoice/POD extraction benchmark is not part of the validated corpus yet.

- Supabase Edge uses existing pinned **`npm:unpdf@1.8.1`**. Python is not imported into Deno.
- Digital pages are not rendered or sent as original PDF images to the model. The runtime prompt contains short `[source_id,x,y,text]` lines. Full-precision geometry remains server-owned.
- Every source page is retained, with text blocks and reading positions. The model emits present facts, source IDs and original-clause IDs, rather than regenerating long quotes and many null objects.
- Original PDF bytes are cloned before PDF.js processing. PDF.js can transfer/detach its input buffer; previously this could make the downstream OCR/upload buffer empty. Hash binding and original uploads now retain their bytes.
- Source-ID lookups use maps; PDF documents/pages are cleaned up. File, page, source text/output, coordinate and 2–25 stop limits remain bounded.
- Classification detects nearly empty/broken text and large raster content on low-text pages. This is a heuristic, not proof that every image/table/hidden layer was read. Dense mixed pages, vector-only/rotated text and small image logos remain corpus-expansion priorities.

### Selective OCR

The existing private `scripts/pdf_preprocessor.py` worker now accepts `X-PDF-Mode: text` and `X-PDF-OCR-Pages: 1,3`. It extracts native text on other pages and runs Tesseract only on selected pages. Text-only mode skips preview-page rendering. The returned source checksum/page count must match the authenticated original PDF.

The benchmark used PyMuPDF **1.28.2** with English traineddata, now pinned in `scripts/pdf-worker-requirements.txt`. The HTTP worker retains authentication, subprocess timeout, bounded concurrency/output, signature/page/size limits and POSIX resource limits; Windows no longer tries to import POSIX `resource`.

If OCR is not configured, a scanned document follows the old single-pass PDF Vision path and is explicitly marked **`vision_manual_review`**, `sourceGrounded:false`, with unverified evidence in both preview and final stored metadata. It is not falsely presented as independently verified. Page-subset Vision extraction is **not implemented**; the manual fallback sends the complete original PDF. This limitation is visible in the report and should not be marketed as selective Vision.

### Evidence and semantics

`load-document-engine.ts`, `load-document-values.ts` and `load-document-rules.ts` verify proposed facts before the existing verifier constructs safe operational fields:

- IDs must exist; exact or normalized values must be supported by a complete source page. Pieces from different pages cannot be concatenated to invent a fact.
- Source IDs, checksum, page, original quote and geometry are rebuilt from trusted extraction, never accepted solely from model-written quotes. Accepted hybrid document fields include `verificationStatus: verified` and `confidence: null` rather than fabricated confidence percentages.
- Addresses, dates and times must lie in the correct stop region; shared table headers are reconstructed from distinct source-supported locations and printed role headings. Retries use the normalized displayed stop order.
- Printed order, not dates, determines stop sequence. First pickup, last delivery and 2–25 stops are enforced by the existing verifier.
- Load/BOL, broker/carrier, freight/cargo value, numeric unit strings, explicit hazmat, total weight, city-only street, ready/scheduled date, printed window/reference and Fahrenheit are treated separately.
- A unique explicit source label can restore a missing load/total weight/company heading without another model request. A null plus a present model fact is not automatically a conflict; differing present critical values are.
- Contradictory printed load IDs, ZIPs for the same street and explicitly labelled freight totals are surfaced. Critical `conflicting_*` issues show alternatives in the review UI, disable assignment and are rejected server-side **before any import/draft write**.
- The model cannot claim fewer pages than the trusted source manifest or certify pages as read when its coverage flag is false.
- Complete original instruction/contract paragraphs are independently reconstructed from source blocks, including exceptions, deadlines and penalties. Model paraphrases do not replace those original clauses. Obligations are bounded/chunked; overflow marks completeness for review.
- Broker/rate/accessorial financial fields remain staff-only. Existing schema/mappings and driver brief privacy are preserved; new fields are additive.

Evidence verification is a deterministic source-and-layout check, not a second independent model audit or a guarantee of semantic truth. OCR may misread text; source PDFs may themselves conflict. Full clause recall and adversarial hidden text need a separately annotated corpus.

### Recovery and cache

There is one initial extraction and at most **one** targeted retry, containing at most 6 failed critical paths and a nearby source neighborhood bounded to 6,500 text characters. It never resends the original PDF. Verified fields cannot be overwritten by unsolicited repair entries. Detected contradictions are not retried into a guessed resolution. Unresolved values remain null/reviewable.

Cache keys include company, actor, original SHA-256, extraction schema version, requested model, retry model and engine version. Warm cache is limited to 16 MB/24 entries/20 minutes with concurrent-request coalescing and no cached failures. Already saved compatible imports are read only under company+creator+hash+version, reverified and reused after cold starts. Unsaved previews have no new persistence table; losing a warm isolate can require a new extraction. Authentication, role checks, file validation and rate limits run before cache use.

### Instrumentation

- `load_document_engine`: native/OCR strategy, page count, bytes, requested/actual models, individual API times/usages, response parsing, verification, bounded retry and total engine duration. Cost estimates use dated standard text token rates; unknown models return null.
- `load_preview_stages`: authorization, receiving/parsing form-data, file validation, hash, preview signing, total handler time and warm cache hit.
- Existing source upload, persistence and assignment stage logs remain.
- Logs omit full document text, contact data and credentials. Client upload network latency is not the same measurement as server form parsing; deployed browser-to-Edge end-to-end timing remains to be measured.

## Model decision

On shared files 02, 08 and 12, GPT-4.1-mini achieved 70/71 selected checks after source verification versus GPT-5-mini 69/71. P50 was about 9.00 s versus 18.74 s; estimated cost $0.01182 versus $0.01386 across those three documents. This small sample does not establish universal superiority. The existing mini remains default; no automatic switch to a newer/expensive model was made.

GPT-4.1-nano alias and dated snapshot calls returned 404 for the available account/endpoint despite appearing in model discovery. They are recorded as unavailable, not assigned invented speed/accuracy. Earlier GPT-5-nano probes did not pass coverage validation and are not included as an equal final comparison. `OPENAI_LOAD_RETRY_MODEL` can select a stronger measured repair model for failed fields only; the default uses the same model to avoid unmeasured cost.

Price sources checked on 2026-10-31: [GPT-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) and [GPT-5-mini](https://developers.openai.com/api/docs/models/gpt-5-mini). Estimates include cached input usage, exclude hosting/worker cost and are not billing statements.

## Remaining observed cases

- 02/03: broker identity was not recovered reliably from native source/short retry and is held for review.
- 04: the original prints ZIP 19607 and 19611 for the same street. Both are shown; no ZIP is silently chosen. The frozen field scorer still counts null as a failed value check.
- 07: broker identity remains uncertain; `Appt # 0800-1500` is kept separate from facility hours 07:30–15:30. It requires human/broker confirmation; the scorer expects the former time range.
- 10: one delivery time did not survive source/type verification in the final run and needs review.
- Synthetic scan 01: weight was held because the scanned unit/value did not pass the source rule.

Do not disable these checks to make the score look higher. A next iteration should focus on small image/logo OCR, role/column associations, strict scalar typed output and more representative unseen broker documents. Full instruction recall and repeated-run latency must be measured separately before asserting the targets are achieved.

## Verification and reproducibility

Executed: **964/964 Node tests**, **6/6 Python/OCR/HTTP-worker tests**, **5/5 desktop Playwright import-review tests**, Deno type checking, lint, i18n parity and production build. The build retains an existing large-chunk warning for PDF/map bundles. Real production Storage/RLS/assignment RPCs and hosted Edge CPU/memory budgets were not exercised or modified.

Important regression coverage includes unauthorized callers before parser/cache/AI, signature/hash/ticket expiry/binding, no preview writes, no model request at confirmation, private original byte upload, upload 409 verification, lost-response/draft recovery, conflict blocking before writes, source grounding, complete instruction clauses, shared table anchors and bounded retries preserving verified fields.

```powershell
npm test
npm run lint
npm run build
npx -y deno check supabase/functions/parse-load-document/index.ts
npx playwright test tests/ui/import-review.spec.js --project=desktop
# Activate a Python environment with scripts/pdf-worker-requirements.txt first.
# Set TESSDATA_PREFIX to a directory containing eng.traineddata for real OCR tests.
python scripts/test_pdf_preprocessor.py -v
```

The paid benchmark script reads an existing private `.env.openai-secrets` server key; it never prints or writes the key. It skips already recorded run labels. Use a fresh label to intentionally spend on a new run; do not overwrite measurements.

```powershell
node scripts/benchmark-document-engine.mjs --label=another-run
node scripts/benchmark-document-engine.mjs 02 08 12 --model=gpt-5-mini --label=another-run
python scripts/create-document-engine-fixtures.py
node scripts/benchmark-document-engine.mjs --label=another-run --manifest=output/pdf-engine-synthetic-2026-10-31/manifest.json --output=output/pdf-engine-synthetic-2026-10-31
```

The final report uses stored `*.final.json` traces. After identifying a shared-anchor validation bug, `revalidate-document-benchmark.mjs` applied the same final deterministic validator to every saved model/source result, without new AI calls. Original traces, initial scores, all retries, implementation hashes and supplemental validation times are retained. `score-document-engine.py` creates the report and evaluates the frozen reference separately. These are development-set results, not a blind test. Baseline/final runs occurred at different times and model/network load can vary.

## Deployment instructions — not executed

1. Review and preserve the intended patch set: this working directory contains unrelated existing modifications. Do not deploy the entire dirty tree accidentally.
2. Deploy/test the existing authenticated private OCR worker if independent scan support is required. Install the pinned requirements and English traineddata. Configure a dedicated HTTPS endpoint and random server token of at least 32 characters. Use its existing authenticated `/health` route. No client receives this token. Do not expose the worker publicly without its authentication and resource controls.
3. Set only server-side environment values through an excluded local env file or existing secret manager:

   ```text
   OPENAI_PDF_ENGINE=hybrid
   OPENAI_LOAD_MODEL=gpt-4.1-mini
   OPENAI_LOAD_RETRY_MODEL=gpt-4.1-mini
   PDF_PREPROCESSOR_URL=https://your-private-ocr-endpoint/preprocess
   PDF_PREPROCESSOR_TOKEN=<private-random-token>
   ```

   The OCR settings are optional for digital files. They are required for the independently source-checked scan path. Never use `VITE_` for private credentials.

4. Using the already authorized Supabase CLI account, explicitly name the intended staging/project ref. CLI flags were checked with `--help` during this task:

   ```powershell
   npx supabase secrets set --project-ref <project-ref> --env-file <excluded-server-env-file>
   npx supabase functions deploy parse-load-document --project-ref <project-ref> --use-api
   ```

   Do not add `--no-verify-jwt`, prune unrelated functions, change Auth policies or run database migrations for this patch. The handler also retains its own active-user/role check.

5. Build/release the frontend through the existing process. In staging, measure authenticated browser upload → preview, original PDF viewing, tenant/role isolation, scan OCR, critical conflict rejection, confirmation without another AI call, and lost-response draft recovery. Use explicitly designated disposable staging records for write-path tests.
6. Check hosted function limits, cold starts and large/adversarial PDFs. [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits) document 256 MB memory and a 2 s CPU budget. Successful local Node timings and Deno checking do not certify hosted CPU/memory behavior. For larger PDFs, run the already supported private preprocessing service rather than assuming Python can execute inside Edge.

No DB schema change is required. New extraction version is `DOCUMENT_EXTRACTION_VERSION + 1000` (currently 1019), with an additional engine/model cache key. Previews signed by the previous extraction strategy must be reselected after switching modes; they are deliberately not silently reused.

## Rollback

For a quick runtime rollback, set `OPENAI_PDF_ENGINE=direct` using the same server secret flow. This selects the existing single-pass PDF behavior, whose private-upload/ticket/recovery tests remain covered. Do not delete existing documents or migrations. New hybrid previews will need reselection because direct mode uses the older version binding (currently 21).

For a code rollback, redeploy a known reviewed previous backend/frontend artifact; do not hard-reset this dirty working directory. Saved documents and assignment transactions do not require data rollback. Direct mode loses the new independent verification and token savings; it should be a temporary operational fallback, not described as equally verified.
