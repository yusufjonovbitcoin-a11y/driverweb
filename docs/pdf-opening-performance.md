# PDF opening latency

The trip viewer previously reauthorized a document version, discarded its valid media signature, requested a replacement signature, and only then loaded the PDF renderer. Changing the signed URL also prevented the browser from reusing the same PDF response on later opens. Local React StrictMode could replay the source effect and duplicate the authorization lookup.

Every opening still queries the durable document version under the authenticated client's existing RLS. The existing in-memory media cache now reuses an unexpired signature for that verified storage path and actor. It respects server expiry and clears on logout/account changes. A failed metadata permission lookup never falls back to a signature. HTTP 400/401/403 downloads and PDF source recovery force a new signature once; repeated failures remain bounded.

`pdfViewerLoader` shares one lazy renderer import and warms an empty PDF worker. File-button hover/focus warms renderer code, and `FreshDocumentViewer` starts it alongside authorization. The source promise is shared only inside one opening/effect replay; closing/reopening and source changes create a new permission lookup. Closing destroys the document transport/canvases; the empty worker is reused.

Development-only `[document-performance]` console diagnostics report duration and stage names without file names, URLs or tokens. Measurements on 2026-10-24 using the existing scanned BOL (about 6.1 MB):

| Stage | Before | Warm reopen after the change |
| --- | ---: | ---: |
| Signature generation | 2,919–3,963 ms | 0 ms |
| Worker, PDF response and parsing | 1,984–2,548 ms | 88–108 ms |
| Renderer mount to first painted page | 2,532–3,059 ms | 206–227 ms |
| Version permission lookup | 467–1,858 ms | 478–1,290 ms |

The worker/parse interval is included in first-page time, not additive. Cold first signing, network latency and document size still affect the first opening; these are measured local observations, not a fixed latency guarantee. Reading all page dimensions measured 4–10 ms on this file, so the viewer's page/navigation behavior was kept unchanged.

Checks cover signature reuse with a fresh RLS lookup, forced renewal, expired URLs, server expiry, revoked access, actor switching, StrictMode request deduplication, parallel renderer loading, PDF rendering on desktop/mobile, and existing settlement PDF editing/export.

The UI fixture servers also shared Vite's default dependency optimizer directory with the running app. Each fixture family now uses a separate cache directory so test optimizations cannot replace the live app's renderer/worker dependencies. A repeat of all six PDF UI checks left the live optimizer hash unchanged (`5b34ac65`); the real BOL then rendered successfully after a fresh server start and on reopen. The last reopen measured 478 ms for authorization, 0 ms for signing, and 206 ms from renderer mount to the first painted page.

Commands: `node --test src/services/tripDocumentUrl.test.js src/services/tripDocumentAccess.test.js src/services/mediaUrlCache.test.js`; `npx playwright test --config playwright.pdf-performance.config.js`; existing settlement and driver-document suites; `npm run build`.

## Follow-up: cold opening and stalled downloads

The first patch measured warm rendering rather than the whole opening. On a subsequent real opening, PDF.js stayed on its spinner after a network error. An immediate click after refreshing also took 10,799 ms: downloading the BOL alone took 8,560 ms through Cloudinary's temporary download API. [Cloudinary documents that these temporary URLs bypass its CDN](https://cloudinary.com/documentation/control_access_to_media#providing_time_limited_access_to_private_media_assets).

The document list now prepares at most its first two visible PDF entries while mounted, using normal authorization. `documentContentCache` shares in-flight transfers and stores immutable Blobs in memory for ten minutes, bounded to six files/64 MB. Logout, actor switching and profile changes clear it; each actual opening still reauthorizes the durable version before cached bytes can be returned. A fresh buffer is created per PDF.js task because the worker takes ownership of transferable buffers.

The managed transfer reports byte progress, aborts after twelve seconds without data or forty-five seconds overall, and never retains failed/invalid content. Closing cancels a transfer only when no other consumer needs it. One automatic recovery remains bounded; failures become a retry UI. Worker initialization and legacy URL loading also have deadlines.

Cloudinary PDF previews use the new `document-content` Edge Function (project `gsnbjpqwwpvqtmphsyfs`, deployed v4 with JWT verification). It verifies the session/active profile, uses caller RLS for both version and media lookups, applies a distributed rate limit, and streams the original bytes from authenticated CDN delivery. The permanent upstream signature is kept entirely server-side: no redirect, upstream error, delivery URL or cacheable response is returned. Existing expiring URLs remain the path for opening/downloading an original separately. No database permissions or schema changed.

For scanned Cloudinary image/PDFs, a first-page JPEG (fixed `pg_1,w_1400,q_65,f_jpg` transformation) is prepared separately and displayed while the original opens. The original PDF bytes are unchanged. Existing derived images use authenticated CDN delivery; a missing derived image falls back once to an expiring two-minute transformation API URL, kept server-side. Preview failure does not block the original. The real BOL preview measured 187,084 bytes instead of about 6.1 MB. Thumbnails start only after the real first page paints so they do not compete with it. Preview URLs are local Blob URLs and are revoked when replaced/closed.

In the final real-file cold test on 2026-10-24, the first visible preview measured 4,277 ms and the original PDF's first painted page 5,327 ms, compared with the earlier 10,799 ms opening. A subsequent reopening measured 539 ms. These values include version authorization, transfer and painting, rather than painting alone. Network conditions still vary. A range-only experiment added too many remote round trips on this file and was not retained as the main loading strategy; the managed original transfer plus lightweight preview performed better. The server and URL-based viewer retain tested range support.

New checks cover immutable byte reuse, transfer deduplication, cancellation, memory/TTL limits, stale session capabilities, idle timeouts, bounded stalled-download recovery, and the server reader's denied-content/no-URL-leak behavior. Run `node --experimental-strip-types --test tests/document-content.test.mjs src/services/documentContentCache.test.js` in addition to the checks above.
