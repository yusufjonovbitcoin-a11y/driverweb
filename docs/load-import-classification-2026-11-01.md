# Rate Con import gate and model compatibility

The new-load import checks the document type before extracting shipment data. Clear native PDF headings are classified without an AI extraction call. Ambiguous native PDFs, scans and images use a type-only structured response. Only a confidently identified rate/load/carrier confirmation can proceed; BOL, POD, invoices, driver sheets, unrelated and uncertain documents produce a dedicated document-type screen without assignment controls. Existing document-slot uploads remain separate.

The classification is server-owned and included in the signed preview ticket. A version change invalidates older unchecked previews/cache entries. The parser reuses native PDF parsing in hybrid mode. Deployed extraction stays direct unless hybrid is explicitly configured. Authentication, rate limits and tenant checks remain enforced.

## Model compatibility fix

The initial gate sent `reasoning.effort=minimal` to every model whose name started with `gpt-5`. The deployed model was `gpt-5.4-mini`, which rejected this with HTTP 400, `unsupported_value`, parameter `reasoning.effort`. The frontend mapped that provider failure to the generic analysis-error screen. The classifier and hybrid engine now use the model defaults rather than an unsupported blanket setting. Classification provider failures log only status, model, error code and parameter; API keys and document contents are not logged. Classification timeouts use the existing timeout error.

## Verification

- 1,022 automated tests passed, including a regression for the exact configured model and real Edge-handler BOL/POD/Invoice rejection before extraction, writes or preview signing.
- Four desktop document-type UI tests passed; lint, production build, catalog parity and diff whitespace checks passed.
- The actual `gpt-5.4-mini` API reproduced the unsupported-parameter error before the fix.
- After the fix, the real Edge handler ran with isolated authentication/database adapters and the real model using the previously supplied PDFs: `BILL OF LADING.pdf` was classified as BOL in 6.284 seconds, with one type-only call and no load preview; `Load Confirmation 2536705 (1).pdf` returned a valid signed preview in 12.308 seconds, with one extraction call. No customer load, assignment, document or media record was written by these tests.
- Updated `parse-load-document` was deployed with JWT verification retained. The real-model timing/token evidence is in ignored `output/import-type-real-model-2026-11-01.json`.

The native-heading checks identify document titles, not incidental mentions or filenames. Classification remains probabilistic for ambiguous/scanned documents and fails closed on low confidence. These timings are individual test measurements, not guaranteed response times.
