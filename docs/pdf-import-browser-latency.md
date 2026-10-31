# PDF import: browser latency investigation

Measured 2026-10-31 at 16:20 UTC in the running localhost:5174 app, using the previously supplied `Carrier Rate confirmation.pdf` (406,670 bytes). The file was analyzed as a preview; no driver assignment was submitted. This is one measured request, not a latency guarantee.

| Stage | Duration |
| --- | ---: |
| Browser session lookup | 10 ms |
| Browser function invocation, including response decoding | 10,761 ms |
| Server execution, correlated by timestamp/execution ID | 10,206 ms |
| AI request within that server execution | 6,958 ms |
| Analysis result to React review commit | 38 ms |
| File-selection handler to review commit | 10,810 ms |

The browser request exceeded server execution by approximately 555 ms. Other server work accounted for approximately 3,248 ms beyond the AI call; it was not separately instrumented, so do not attribute it all to one database/auth/network operation. The deployed function remains version 69, using `ai_pdf_direct` and `gpt-5.4-mini`. The local hybrid parser is not deployed.

The reported 20+ second delay was not reproduced by this request. Server-only measurements from different requests cannot establish the cause of that reported browser delay. Optional contact and route requests do not gate the preview result.

## Local diagnostics

In Vite development mode, each successful import records one `[document-import-timing]` console entry when the review commits. It contains only stage names, millisecond durations and page visibility. No document text, file names, account IDs, tokens or signed tickets are logged. These records are not sent to an analytics service or stored permanently.

Stages distinguish session lookup, proactive token refresh, function invocation and a possible 401 refresh/retry. Diagnostic callbacks cannot interrupt or replay the request and are not forwarded to the Functions SDK. Production builds do not create or emit import timing records.

`responseToCommitMs` measures the result-to-review interval, not a browser presentation timestamp. If the flow intentionally waits for a driver choice, it also includes that user wait; check the flow before treating it as render latency. A hidden tab can also delay presentation. For the measured request, the driver was selected before file selection and the page was visible.

Validation: 17 focused authentication/import timing/session tests passed; lint and production build passed. A real browser preview was checked to verify that the extraction was displayed and the diagnostic emitted once.
