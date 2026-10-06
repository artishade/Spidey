# Architecture

## Browser boundary

`popup.js` handles explicit activation and local pairing. The service worker stores the pairing code in trusted extension storage, injects three packaged scripts using activeTab, and maintains a bounded outbox. There are no remote extension scripts and no broad `<all_urls>` permission.

`shared.js` extracts a post's rendered text, timestamp permalink and external anchors. `content.js` samples visible tweet articles every 2.8 seconds, skips hidden tabs and excluded routes, and sends one captured item at a time. `spider-ui.js` creates a shadow-root overlay and moves it toward the inspected card; reduced-motion users get immediate movement instead of walking animation. Auto-scroll is explicit and avoids scrolling while typing.

The outbox holds at most 200 items. An alarm retries forwarding every minute while Chrome is running. Closing Chrome suspends work. Captures are idempotent by X status ID; a crash after backend acknowledgement can cause a harmless duplicate submission.

The extension currently expects the engine at `http://127.0.0.1:8787`. A custom backend port requires changing its BASE constant and dashboard links. Only those local endpoints receive captures; the browser never sends xAI credentials.

## Local engine

`Jev.ingest` validates a strict captured-post shape and writes it to SQLite before acknowledging. It rejects malformed/non-X permalinks and future timestamps. A single background loop handles batches of 20. Project links enter the cached crawler pipeline; narrative synthesis uses a rolling 24-hour sample with distinct-author and repetition checks.

The crawler is bounded to three pages per project, standard HTTP(S) ports and capped page sizes. Every DNS result must be globally routable; the TCP connection is pinned to a validated IP and TLS still verifies the requested hostname. Redirects re-enter validation. JavaScript is not executed. A page's content is evidence, never code or instructions.

Besides topics (built-in or a local `topics.json`), each pass extracts cashtags, Solana addresses that decode to 32 bytes, and two-word phrases repeated by at least three distinct authors in the last six hours outside the known topics. Every spider lead carries a 6h-versus-previous-18h growth rate and a first-seen time. Ticker, address and phrase leads are marked `research_only`, and the launch queue refuses them.

Four local checks always retain their own explanations. Optional Grok reviews are attached separately, and a missing/negative Grok review prevents an otherwise-positive candidate from becoming approved when Grok mode is enabled. A scan-wide mutex limits concurrent batches. HN is a separately labeled source with different explicit scoring rules.

## Grok boundary

Four role-specific Chat Completions requests run concurrently. Requests contain at most eight 1,200-character post excerpts and three 2,500-character page excerpts, plus bounded metadata. No browsing or code tools are provided. All model output is treated as untrusted; vote enums, fields and evidence IDs are validated locally.

The shared 24-hour request allowance is reserved atomically before a full review. Timeouts/errors remain charged to the allowance and become hold votes. The limit bounds call count, not xAI billing. Identical evidence/model reviews cache for 24 hours. The user must configure their own model/key; default model availability can change.

## API

| Route | Authorization | Purpose |
| --- | --- | --- |
| GET /api/state | Loopback, same-origin browser boundary | Local dashboard state and pairing code |
| GET /api/extension/status | X-Gem-Extension | Capture counts and nonsecret model status |
| POST /api/extension/ingest | X-Gem-Extension | Durably accept up to 20 posts |
| POST /api/demo, /api/import | X-Gem-Token | Dashboard research actions |
| POST /api/launch-control | X-Gem-Token | Pause/resume the separate optional queue |

Extension credentials cannot invoke dashboard actions. CORS headers are restricted to the extension API and Chrome extension origins, with a separate pairing key still required. The engine is a single-user local process, not a remotely authenticated service.

## Optional launch boundary

Browser findings stay research-only by default. Both SPIDER_ALLOW_LAUNCH=1 and a separately configured launch mode are needed to make them launch candidates. Grok cannot issue launch commands. The launcher consumes structured locally validated shortlist records and applies its own deduplication, quotas and transaction checks. See [AUTOLAUNCH.md](AUTOLAUNCH.md).
