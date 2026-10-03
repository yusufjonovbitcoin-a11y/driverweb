# Positioned PDF text + images + source verification

## Rollout status

Implemented with an opt-in authenticated HTTPS worker. The current Mac can use
an explicitly approved Cloudflare Quick Tunnel for internet reachability. With no
`PDF_PREPROCESSOR_URL`, the existing PDF-input flow remains unchanged (schema 8).
With the URL configured, PDF imports use grounded schema 9. Worker failures stop
the import; they never silently fall back to model-authored quotes.

This is source grounding, not an independent semantic audit or a guarantee of
perfect extraction. Model page classification/completeness and field choice can
still be wrong. Dispatcher confirmation remains required. Existing multi-stop
mobile-workflow dispatch protection remains in place.

## Flow and trust boundary

1. Existing Edge authentication, staff/company checks and rate limits authorize
   the uploaded bytes. Browser manifests and worker URLs are never accepted.
2. Edge POSTs the exact PDF bytes to the configured private worker using its own
   server-only bearer token. The worker needs no Supabase or OpenAI credentials.
3. PyMuPDF extracts line/word coordinates and renders every page. Empty/poor text,
   image regions and vector-heavy pages trigger OCR. Failed OCR fails closed.
   Image detection is conservative, not proof that all tiny scanned regions were
   recognized; the page images remain available to the model.
4. Edge verifies the checksum, complete page sequence, unique line IDs and limits.
   It sends the positioned text and one image per page in **one OpenAI call**.
5. Each returned field has `value` and `source_ids`. The server derives page,
   quote and bounding boxes from those IDs. Unknown/duplicate IDs cannot pass.
   Long clauses must be split at page boundaries. Existing value/type/unit/stop
   semantic checks still apply. BOL-only and cargo-value-only labels cannot
   support load number and freight rate respectively.
6. The source manifest, without images/duplicate word data, is stored with the
   extraction audit snapshot. Accepted field evidence includes source IDs,
   bounding boxes and document checksum. Cached and manually corrected values
   are verified against that same manifest. An invented correction quote fails.
7. Existing UI mapping and assignment review use only accepted facts. PDF miles
   remain distinct from Mapbox route miles. Missing PU/DEL references stay null.

## Local worker

On the current Mac, `com.drivex.pdf-worker` runs the loopback-only worker as a
user LaunchAgent. It starts at login and restarts after a process crash. The Mac
must be awake and this user logged in. Runtime: `.venv/pdf`; OCR data:
`.venv/pdf/tessdata`; random bearer token: `.venv/pdf-worker.token` (mode 0600).
None of these local files are committed. The companion `com.drivex.pdf-tunnel`
LaunchAgent runs `scripts/pdf-internet-worker.mjs`: it publishes only port 8788,
authenticates the origin health check, then updates the two Supabase PDF secrets
using the existing CLI login. Tunnel restarts generate a new hostname; the
wrapper updates Supabase again. If CLI authorization expires, configuration
fails and imports must wait for the operator to restore it.

```sh
npm run pdf:worker # foreground alternative; do not run alongside the LaunchAgent
npm run pdf:check -- /absolute/path/to/document.pdf
launchctl print gui/$(id -u)/com.drivex.pdf-worker
launchctl print gui/$(id -u)/com.drivex.pdf-tunnel
```

```sh
python3 -m venv .venv/pdf
.venv/pdf/bin/pip install -r scripts/pdf-worker-requirements.txt
# Install Tesseract English tessdata and set TESSDATA_PREFIX to its directory.
# Set PDF_PREPROCESSOR_TOKEN from a secret manager: >=32 random characters.
.venv/pdf/bin/python scripts/pdf_preprocessor.py --serve
```

The process binds only to `127.0.0.1:8788`. Do not expose its plain HTTP listener
directly. For a deployed worker use an authenticated HTTPS reverse proxy with
request-size/time/concurrency limits, a non-root isolated service, restricted
network/filesystem access, and a memory-limited container. The native parser runs
in a per-document subprocess with a 60-second timeout, CPU limit and (Linux)
2-GiB address-space limit. This is not a substitute for OS/container isolation.

Configure only server-side secrets (never `VITE_*`):

- `PDF_PREPROCESSOR_URL=https://your-private-worker/preprocess`
- `PDF_PREPROCESSOR_TOKEN` matching the worker's random secret

Then deploy the updated `parse-load-document` function and audit a test PDF with
`auditOnly=true` before enabling normal imports. Never reuse the email app
password, Supabase service-role key or OpenAI key as the worker token.
Remote Supabase cannot connect directly to this Mac's `127.0.0.1`. The temporary
tunnel carries uploaded PDFs through Cloudflare to this Mac with HTTPS and an
application bearer token. It is explicitly approved for testing, **not a 24/7
production host**. The Mac must be awake, logged in and connected; Cloudflare
Quick Tunnels have no uptime guarantee. Use a managed stable tunnel or hosted
worker for production. PyMuPDF licensing (AGPL/commercial) must be reviewed before
commercial rollout.

The tunnel URL/state is in ignored `.venv/pdf-tunnel.json`. Logs contain no PDF
contents or tokens. An owner-only temporary env file is deleted after updating
Supabase secrets. Stop internet exposure using:

```sh
launchctl bootout gui/$(id -u)/com.drivex.pdf-tunnel
```

Stopping the tunnel does not reset hosted PDF secrets; imports fail closed until
the tunnel is restored or an operator deliberately disables/replaces the worker.

Limits: 20-MiB PDF, 50 pages, 28-MiB response, 25,000 lines, 1M text characters.
Encrypted, unreadable and oversized PDFs fail with a localized error. Source
content/tokens are not logged. Raw source text stored in the import snapshot is
sensitive customer data and must retain existing company-scoped access controls.

## Reproducible checks

```sh
npm test
TESSDATA_PREFIX=/path/to/tessdata .venv/pdf/bin/python -m unittest discover -s scripts -p test_pdf_preprocessor.py -v
TESSDATA_PREFIX=/path/to/tessdata PDF_PYTHON=.venv/pdf/bin/python node scripts/test-pdf-source-original.mjs /path/to/CarrierConfirmation.pdf
```

The original-PDF regression is intentionally an **offline curated expectation**
test, not a live AI quality score: it checks preprocessing → source binding →
verification → UI model for load 25008654, $1000, 1800 lb, Oct 1/5 2026 and absent
PU/DEL references. The handler tests mock providers, assert one model call and
zero `input_file` items in grounded mode, and verify worker failure stops before
the model. No test creates a database load or sends anything to a driver.
