# Audit Log

## 2026-06-10 Initial Open Gateway Track

- Created `/srv/aialra/apps/open-codex-app-web-gateway` from tracked files in
  `/srv/aialra/apps/codexapp`.
- Did not copy `state/`, `node_modules/`, logs, Playwright output, or local
  secret files.
- Added local Responses-to-Chat bridge:
  - `/v1/responses`
  - `/v1/chat/completions` passthrough
  - `/v1/models`
  - `/healthz`
- Added local file store for `previous_response_id` replay.
- Added unit and mock-upstream tests.
- Added secret scan script and CI workflow.
- Added compatibility, deployment, and evaluation docs.

Open follow-ups:

- Expand Playwright browser coverage beyond the first successful conversation.
- Add benchmark harness implementation and first small task suite.

## 2026-06-10 Deployment Bring-up

- Installed machine-local secret file at
  `/srv/aialra/config/secrets/opencodexapp.env` with mode `0600`.
- Installed isolated Codex config at
  `/srv/aialra/state/opencodexapp-codex-home/config.toml`.
- Enabled and started:
  - `aialra-opencodexapp-bridge.service`
  - `aialra-opencodexapp-app-server.service`
  - `aialra-opencodexapp-web.service`
- Signed Let's Encrypt certificate for `opencodexapp.aialra.online`, expiring
  2026-09-08.
- Installed nginx vhost from `deploy/nginx/opencodexapp.aialra.online.conf`.
- Verified:
  - `npm test`: 10 passing tests.
  - `npm run secret-scan`: passed.
  - live bridge smoke returned `bridge-ok`.
  - protocol smoke suite passed 2/2 against DeepSeek `deepseek-v4-pro`.
  - HTTPS page returned 200 with certificate CN `opencodexapp.aialra.online`.
  - Playwright loaded the UI, completed onboarding, sent `请只回复 opencodex-ok`,
    and received `opencodex-ok` in the web UI with no console warnings/errors.

## 2026-06-10 Responses Lifecycle Expansion

- Added local lifecycle coverage for stored Responses objects:
  - `GET /v1/responses/{response_id}`
  - `DELETE /v1/responses/{response_id}`
  - `POST /v1/responses/{response_id}/cancel`
  - `GET /v1/responses/{response_id}/input_items`
- Added explicit 501 compatibility errors for:
  - `POST /v1/responses/compact`
  - `POST /v1/responses/input_tokens`
- Stored normalized response input items next to replay messages so later Codex
  requests can inspect the conversation input surface without calling upstream.
- Added mock-provider regression coverage for retrieval, deletion, input item
  pagination, completed-response cancel no-op, and unsupported collection
  endpoints.
- Restarted `aialra-opencodexapp-bridge.service` and live-tested the lifecycle
  path against DeepSeek through the local bridge:
  create response, retrieve response, list input items, cancel completed
  response, delete response, and confirm 404 after deletion.

## 2026-06-10 Evaluation Harness Expansion

- Expanded `scripts/eval-harness.mjs` from protocol-only smoke tests into a
  repeatable bridge regression runner covering:
  - Responses text
  - Responses JSON schema compatibility
  - Chat Completions passthrough
  - Responses SSE event translation
  - function-tool `tool_choice`
  - `previous_response_id` replay
- Added `npm run eval:protocol` and `npm run eval:bridge`.
- Fixed Chat passthrough response header handling so bridge clients do not
  inherit unsafe upstream transfer headers.
- Added DeepSeek compatibility logic that disables thinking mode for function
  tool requests with `tool_choice` by default; this fixed the live
  `Thinking mode does not support this tool_choice` provider error.
- Live result against `deepseek-v4-pro` on `http://127.0.0.1:12912`:
  `bridge-regression` passed 6/6, pass rate 1.0, average latency 2303 ms,
  P95 latency 3622 ms, total usage 873 tokens.

## 2026-06-10 Chat Lifecycle Expansion

- Used the current OpenAI endpoint list to confirm Chat lifecycle routes:
  - `GET /v1/chat/completions/{completion_id}`
  - `GET /v1/chat/completions/{completion_id}/messages`
- Added local storage for non-streaming Chat Completions requests when the
  incoming request sets `store:true`.
- Added local lifecycle coverage for stored Chat completions:
  - `GET /v1/chat/completions/{completion_id}`
  - `GET /v1/chat/completions/{completion_id}/messages`
- Kept ordinary Chat passthrough requests unstored by default to avoid
  unbounded state growth.
- Added mock-provider regression coverage for stored retrieval, stored message
  pagination, and unstored completion 404 behavior.
- Added a live `chat-lifecycle` case to `bridge-regression`.
- Restarted `aialra-opencodexapp-bridge.service` and live-tested against
  `deepseek-v4-pro` on `http://127.0.0.1:12912`:
  `chat-lifecycle` passed with completion retrieval 200, messages retrieval
  200, and 2 stored messages.
- Full `bridge-regression` passed 7/7, pass rate 1.0, average latency 2013 ms,
  P95 latency 3636 ms, total usage 913 tokens.

## 2026-06-10 UI Workflow Smoke Automation

- Added `scripts/ui-smoke.mjs` and `npm run smoke:ui`.
- The first version used the local Playwright CLI wrapper and an authenticated
  session.
- It verifies:
  - app load with an authenticated Playwright session
  - sidebar/search/settings controls
  - prompt submission from the composer
  - visible model response marker
  - reload persistence
  - console error/warning collection
  - screenshot artifact capture under ignored `output/playwright/`
- Live result against `https://opencodexapp.aialra.online`:
  `smoke:ui -- --session default --timeout-ms 180000` passed, marker
  `ui-smoke-mq7mzhmo` appeared twice before reload and once after reload,
  console errors 0, warnings 0.

## 2026-06-10 Clean Browser UI Smoke Upgrade

- Added `playwright` as a dev dependency with browser download skipped during
  install on the deployment host.
- Reworked `scripts/ui-smoke.mjs` to launch a fresh Playwright browser context
  directly from Node instead of relying on a pre-authenticated CLI session.
- Added login-page support that reads credentials only from local environment
  variables (`UI_SMOKE_USERNAME`/`UI_SMOKE_PASSWORD` or
  `CODEXAPP_USERNAME`/`CODEXAPP_PASSWORD`); no credentials are written to the
  repository or command-line arguments.
- Verified current deployment topology:
  - `aialra-opencodexapp-login.service` is inactive.
  - nginx proxies `opencodexapp.aialra.online` directly to `127.0.0.1:12920`.
  - The clean browser run therefore recorded `auth_mode:
    existing_session_or_public` rather than `clean_login`.
- Live result against `https://opencodexapp.aialra.online`:
  `npm run smoke:ui -- --timeout-ms 180000` passed, marker
  `ui-smoke-mq7n5dx9` appeared twice before reload and once after reload,
  console errors 0, warnings 0.

## 2026-06-10 Code Quality Benchmark Harness

- Added `scripts/code-benchmark.mjs` and `npm run bench:code`.
- The harness creates temporary JavaScript repositories under ignored
  `output/code-benchmark/`, asks the bridge model for JSON file replacements,
  applies generated files, and runs task tests.
- Added the first `micro` suite:
  - `slugify-url-safe`
  - `merge-ranges`
  - `parse-duration`
- Reviewed SWE-bench public guidance and recorded that official evaluation is
  Docker-based and resource intensive, with approximately 120GB free storage
  recommended for full evaluation. Full SWE-bench artifacts remain out of the
  repository by policy.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run bench:code -- --timeout-ms 180000` passed 3/3, pass rate 1.0,
  average latency 27595 ms, P95 latency 30290 ms, total usage 5751 tokens.

## 2026-06-10 Bridge Soak Stability Harness

- Added `scripts/soak-test-bridge.mjs` and `npm run soak:bridge`.
- The harness repeatedly creates stored Responses turns, checks
  `/v1/responses/{response_id}/input_items`, deletes stored responses, and
  compares state directory file and byte counts before creation, after
  creation, and after cleanup.
- The report records success rate, cleanup failures, average and P95 latency,
  token usage, per-turn response IDs, and optional JSON output for release
  evidence.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run soak:bridge -- --iterations 5 --timeout-ms 180000` passed 5/5,
  pass rate 1.0, cleanup failures 0, average latency 1593 ms, P95 latency
  1716 ms, total usage 370 tokens.
- State directory baseline was 10 files and 23796 bytes. Creation added 5 files
  and 13151 bytes. Cleanup returned the directory to the same 10 files and
  23796 bytes, for zero residual file and byte growth after deletion.

## 2026-06-10 Responses Input Token Count Compatibility

- Used the current OpenAI endpoint list and OpenAPI schema to confirm
  `POST /v1/responses/input_tokens` returns an object with
  `object: "response.input_tokens"` and an `input_tokens` count.
- Added a bridge implementation for `POST /v1/responses/input_tokens`.
- The handler reuses Responses-to-Chat translation and local
  `previous_response_id` replay, forces a non-streaming upstream Chat
  Completion probe with `max_tokens:1`, removes upstream `store`, and returns
  the provider's `usage.prompt_tokens` as `input_tokens`.
- At this stage, kept `POST /v1/responses/compact` as an explicit 501 because
  native compaction requires summarization/compaction semantics, not just field
  translation. This was superseded by the local compaction implementation below.
- Added mock-provider coverage for the token probe request shape and response.
- Added `responses-input-tokens` to the live `bridge-regression` suite.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-input-tokens --timeout-ms 45000`
  passed 1/1, latency 888 ms, input tokens 10.
- Full live `bridge-regression` passed 8/8, pass rate 1.0, average latency
  1843 ms, P95 latency 3891 ms, total usage 847 tokens.

## 2026-06-10 Local Responses Compaction

- Implemented `POST /v1/responses/compact` as local bridge compaction.
- The handler translates Responses input to Chat messages, asks the upstream
  Chat provider for a continuation summary, returns `object:
  "response.compaction"`, and emits a `type:"compaction"` output item.
- Local compaction content is encrypted with AES-256-GCM. The key is read from
  `CODEXCOMPAT_COMPACTION_SECRET`, or generated into
  `CODEXCOMPAT_COMPACTION_SECRET_FILE`, defaulting to
  `$CODEXCOMPAT_STATE_DIR/compaction.key`.
- Verified the generated key file is mode `0600` under ignored `state/`; no
  compaction key or generated state was staged.
- Added translator support so local compaction output can be passed directly as
  the next `/v1/responses` input. If a compaction item cannot be decoded, the
  bridge inserts a safe notice instead of forwarding opaque ciphertext.
- Added mock-provider tests for compaction creation, local key generation,
  encrypted content shape, and follow-up replay through decrypted summary
  context.
- Added `responses-compact-continuation` to the live `bridge-regression` suite.
- Caveat: this is not OpenAI native ZDR encrypted compaction. It is local to the
  bridge deployment and key; portability requires explicitly preserving or
  rotating the local key outside Git.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000`
  passed 1/1, latency 6739 ms, total usage 462 tokens, and follow-up output
  recovered `atlas-77`.
- Full live `bridge-regression` passed 9/9, pass rate 1.0, average latency
  3160 ms, P95 latency 9271 ms, total usage 1538 tokens.
- Post-compaction live soak still passed:
  `npm run soak:bridge -- --iterations 5 --timeout-ms 180000` passed 5/5,
  cleanup failures 0, average latency 1815 ms, P95 latency 1982 ms, and zero
  residual state file or byte growth after cleanup.

## 2026-06-10 Model Retrieval Compatibility

- Used the current OpenAI endpoint list to confirm `GET /v1/models/{model}` is
  part of the API surface alongside `GET /v1/models`.
- Added `GET /v1/models/{model}` to the bridge.
- Retrieval strategy:
  - first proxy upstream single-model retrieval at
    `$CODEXCOMPAT_MODELS_PATH/{model}` when the provider supports it;
  - otherwise fetch upstream model list and return the matching model object;
  - otherwise return a local fallback only when `{model}` is the configured
    `CODEXCOMPAT_DEFAULT_MODEL`;
  - return a structured 404 `model_not_found` error for unknown models.
- Refactored local model fallback so list and retrieve return the same model
  object shape.
- Added mock-provider coverage for direct upstream retrieval and list fallback.
- Added `models-retrieve` to live `bridge-regression`.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case models-retrieve --timeout-ms 45000` passed
  1/1, latency 468 ms, retrieved model ID `deepseek-v4-pro`.
- Full live `bridge-regression` passed 10/10, pass rate 1.0, average latency
  2304 ms, P95 latency 7773 ms, total usage 1392 tokens.

## 2026-06-10 Responses Background Mode Compatibility

- Used the current OpenAI Responses API schema and examples to confirm
  background responses expose `background`, transition through `in_progress`,
  and are polled through `GET /v1/responses/{response_id}`.
- Added local `background:true` emulation for `POST /v1/responses`:
  - returns a stored `in_progress` Responses object immediately;
  - runs the upstream Chat Completion asynchronously in the bridge process;
  - updates the stored Responses object to `completed` or `failed`;
  - forces `store:true` because polling requires a local response record;
  - disables upstream streaming for background requests and records that in
    compatibility metadata.
- Added cancellation and deletion behavior for in-process background jobs:
  - `POST /v1/responses/{response_id}/cancel` aborts an in-progress job and
    marks the response `cancelled`;
  - `DELETE /v1/responses/{response_id}` aborts an in-process job before
    deleting the local response record;
  - terminal completed records keep the existing cancel no-op compatibility.
- Added a timeout marker so upstream background timeouts are recorded as
  failed provider errors instead of user cancellations.
- Caveat: background workers are currently process-local. The response record is
  file-backed for audit and polling, but a bridge restart does not resume an
  already in-progress upstream Chat Completion. A persisted job queue remains a
  future hardening item if Codex depends on long-running background jobs across
  restarts.
- Added mock-provider coverage for:
  - immediate `in_progress` creation followed by later `completed`;
  - forced local storage when the caller sends `store:false`;
  - stream disabling when the caller sends `stream:true`;
  - cancellation remaining `cancelled` even if the mock upstream later returns.
- Added `responses-background` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 20/20 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-background --timeout-ms 90000 --verbose`
  passed 1/1, latency 2164 ms, status history
  `in_progress -> in_progress -> completed`, output `background-ok`, total
  usage 63 tokens.
- Full live `bridge-regression` passed 11/11, pass rate 1.0, average latency
  2427 ms, P95 latency 8417 ms, total usage 1431 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7p0kr8` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Web Search Hosted Tool Adapter

- Used the current OpenAI web-search guide to confirm Responses web-search
  outputs include:
  - a `web_search_call` output item with `action.type:"search"` and the query;
  - a message output item with `output_text.annotations` containing
    `url_citation` objects.
- Added a local hosted-tool adapter for `web_search_preview` / `web_search`:
  - local search results are injected into the upstream Chat Completion prompt;
  - final Responses output is decorated with a `web_search_call` item;
  - final message text receives URL citation annotations;
  - streaming responses emit the local `web_search_call` output item before
    Chat text deltas and include citations in the final completed response;
  - background responses run local search inside the background job before the
    upstream Chat Completion call.
- Added local provider configuration:
  - `CODEXCOMPAT_WEB_SEARCH_PROVIDER=disabled|static|wikipedia`;
  - default no-key provider is `wikipedia`, using the public MediaWiki search
    API;
  - `static` provider is available for tests and controlled eval fixtures.
- Added query extraction for common prompts such as `web search for OpenAI`.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  web-search requests by default. This avoids reasoning-only completions
  exhausting `max_output_tokens` before any visible assistant text is emitted.
- Caveat: this is not native OpenAI web search and the default provider is not a
  full web index. Full parity still requires a production web-search backend,
  page open/find support, citation ranking, and policy controls.
- Added mock-provider coverage for:
  - local hosted-tool reservation so `web_search_preview` is not forwarded as
    an unsupported upstream Chat tool;
  - injected search context in upstream Chat messages;
  - `web_search_call` output item shape;
  - `url_citation` annotations;
  - DeepSeek `thinking:{type:"disabled"}` for local web-search requests.
- Added `responses-web-search` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 23/23 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-web-search --timeout-ms 90000 --verbose`
  passed 1/1, latency 1774 ms, output `web-search-ok [1]`, total usage
  390 tokens.
- Full live `bridge-regression` passed 12/12, pass rate 1.0, average latency
  1918 ms, P95 latency 4098 ms, total usage 1582 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7pjgyb` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local File Search Hosted Tool Adapter

- Used the current OpenAI file-search, Files, and Vector Stores documentation to
  confirm the expected bridge-facing shapes:
  - `file_search` is a Responses hosted tool backed by vector stores;
  - file-search output includes `file_search_call` items;
  - message output can include `file_citation` annotations;
  - setup flows through file upload, vector-store creation, file attachment,
    and search.
- Added a local Files/Vector Stores state layer under the bridge state
  directory:
  - `POST/GET/DELETE /v1/files`;
  - `GET /v1/files/{file_id}/content`;
  - `POST/GET/DELETE /v1/vector_stores`;
  - `POST/GET/DELETE /v1/vector_stores/{id}/files`;
  - `POST /v1/vector_stores/{id}/search`.
- Added a local hosted-tool adapter for Responses `file_search`:
  - reserves `file_search` so it is not forwarded as an unsupported Chat tool;
  - searches local vector stores with bounded lexical chunk retrieval;
  - supports simple metadata filters over file metadata and attachment
    attributes;
  - injects retrieved chunks into the upstream Chat Completion prompt;
  - emits `file_search_call` output with query, vector store IDs, and optional
    results for `include:["file_search_call.results"]`;
  - adds `file_citation` annotations to final Responses message text;
  - supports non-streaming, streaming, and background Responses paths.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  file-search requests by default. This avoids reasoning-only completions or
  citation-only visible output under small `max_output_tokens` budgets.
- Caveat: this is not native OpenAI managed file search. The local retriever is
  text-only and lexical; full parity still requires embedding/vector indexing,
  richer file parsers, async file batches, expiration policy, reranking, and
  larger RAG eval sets.
- Added regression coverage for:
  - Files and Vector Stores CRUD/search endpoint shape;
  - vector-store-file attributes and simple filter matching;
  - local hosted-tool reservation for `file_search`;
  - injected local retrieval context in upstream Chat messages;
  - `file_search_call` output shape including vector store IDs and results;
  - `file_citation` annotations;
  - natural-language query extraction that avoids treating `result/results` as
    the search query.
- Added `responses-file-search` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 25/25 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-file-search --timeout-ms 90000 --verbose`
  passed 1/1, latency 1284 ms, output `file-search-ok [1]`, total usage
  177 tokens.
- Full live `bridge-regression` passed 13/13, pass rate 1.0, average latency
  2018 ms, P95 latency 6197 ms, total usage 1965 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7qflpg` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Shell and Container Artifact Adapter

- Used the current OpenAI shell/tools and Containers documentation to confirm:
  - hosted shell is a Responses hosted tool, not a Chat Completions feature;
  - local shell and hosted shell use paired `shell_call` and
    `shell_call_output` output items;
  - hosted containers expose `/mnt/data` for user-downloadable artifacts;
  - reusable containers are created and referenced through the Containers API.
- Added a local Containers state layer under the bridge state directory:
  - `POST/GET/DELETE /v1/containers`;
  - `POST/GET/DELETE /v1/containers/{id}/files`;
  - `GET /v1/containers/{id}/files/{file_id}/content`.
- Added a local hosted-tool adapter for Responses `shell` plus a
  `code_interpreter` compatibility alias:
  - reserves `shell` / `code_interpreter` so they are not forwarded as
    unsupported Chat tools;
  - extracts explicit `Execute:`, `Run:`, `Command:`, shell code block, and
    Python code block commands;
  - runs commands in a local per-container workspace with timeout and output
    limits;
  - maps `/mnt/data` to the local container artifact workspace;
  - emits paired `shell_call` and `shell_call_output` items;
  - injects stdout, stderr, exit code, timeout status, and artifact paths into
    the upstream Chat Completion prompt;
  - exposes generated artifacts through local container files endpoints;
  - supports non-streaming, streaming, and background Responses paths.
- Added local provider configuration:
  - `CODEXCOMPAT_SHELL_PROVIDER=local|disabled`;
  - `CODEXCOMPAT_SHELL_STATE_DIR`;
  - command timeout, output cap, file cap, command length, and max command
    count settings.
- Added DeepSeek compatibility behavior that disables thinking mode for local
  shell and local compaction requests by default. The compaction change fixes a
  live failure where DeepSeek returned no visible summary content.
- Caveat: this is not native OpenAI hosted shell and not a Docker/VM sandbox.
  It is local, disk-bounded, timeout-bounded, and auditable, but full parity
  still requires hardened container isolation, network allowlists, domain secret
  sidecars, service support, and lifecycle garbage collection.
- Added regression coverage for:
  - local container CRUD/list endpoint shape;
  - local shell hosted-tool reservation;
  - `tool_choice:"required"` not being forwarded when only local hosted tools
    are present;
  - `shell_call` / `shell_call_output` output shape;
  - `/mnt/data` artifact creation, listing, and download;
  - DeepSeek `thinking:{type:"disabled"}` for shell and compaction requests.
- Added `responses-shell` to live `bridge-regression`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_shell.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 27/27 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live shell result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-shell --timeout-ms 90000 --verbose`
  passed 1/1, latency 3054 ms before the prompt tightening, artifact
  `shell-ok`, total usage 258 tokens.
- Live compaction stability check:
  `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000 --verbose`
  passed 1/1 after disabling DeepSeek thinking for compaction, latency 4299 ms,
  total usage 267 tokens.
- Full live `bridge-regression` passed 14/14, pass rate 1.0, average latency
  2289 ms, P95 latency 4542 ms, total usage 1998 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7r8xft` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Local Input File Adapter

- Used the current OpenAI file-input documentation to confirm Responses accepts
  `input_file` from local file IDs, inline base64 `file_data`, and HTTP(S)
  `file_url`, with native OpenAI support for richer PDF, document, and
  spreadsheet extraction.
- Added a local `input_file` compatibility layer for Chat-only providers:
  - extracts bounded text from local Files API `file_id` records;
  - decodes strict inline base64 `file_data`, including
    `data:<media>;base64,...` URLs;
  - fetches HTTP(S) `file_url` inputs when enabled, with timeout and byte caps;
  - injects extracted text into upstream Chat Completion messages;
  - reports `metadata.compatibility.local_input_files` with provider, status,
    file counts, resolved/failed counts, and truncation counts;
  - runs before upstream Chat calls for non-streaming Responses, streaming
    Responses, background jobs, `/v1/responses/input_tokens`, and local
    `/v1/responses/compact`.
- Added local provider configuration:
  - `CODEXCOMPAT_INPUT_FILE_PROVIDER=local|disabled`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_FILES`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_BYTES`;
  - `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS`;
  - `CODEXCOMPAT_INPUT_FILE_FETCH_URLS`;
  - `CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS`.
- Caveat: this is not native OpenAI file processing. Text/code/CSV/JSON/Markdown
  and similar inputs are extracted directly; binary PDFs, Office documents,
  spreadsheet augmentation, OCR, and rendered page-image context remain planned
  parity gaps.
- Added regression coverage for:
  - local Files API `file_id` extraction;
  - inline `file_data` extraction;
  - upstream Chat prompt injection;
  - Responses compatibility metadata counts;
  - live `responses-input-file` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 28/28 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live input-file result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose`
  passed 1/1, latency 2248 ms, output `input-file-ok`, total usage 202 tokens.
- Full live `bridge-regression` passed 15/15, pass rate 1.0, average latency
  1962 ms, P95 latency 4168 ms, total usage 2199 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7rpme2` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Responses Output Logprobs Mapping

- Used current OpenAI Responses and Chat Completions reference data to confirm:
  - Responses `include` supports `message.output_text.logprobs`;
  - Responses `top_logprobs` accepts 0-20 likely tokens;
  - Chat Completions uses `logprobs:true` plus optional `top_logprobs`;
  - Chat responses return token probability data under
    `choices[].logprobs.content[]`.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek supports
  `logprobs` and `top_logprobs` on Chat Completion requests, with
  `top_logprobs` requiring `logprobs:true`.
- Added Responses-to-Chat request mapping:
  - `include:["message.output_text.logprobs"]` sets upstream `logprobs:true`;
  - `top_logprobs` is forwarded and also sets `logprobs:true`;
  - compatibility metadata records `logprobs:"chat_logprobs"` when the bridge
    requests Chat log probabilities.
- Added Chat-to-Responses response mapping:
  - non-streaming `choices[0].logprobs.content[]` is preserved as
    `output[].content[].logprobs`;
  - streaming `choice.logprobs.content[]` chunks are accumulated onto the final
    `output_text` content part and final completed response.
- Added regression coverage for:
  - request parameter mapping to upstream Chat;
  - non-streaming output logprobs preservation;
  - streaming logprobs accumulation;
  - live `responses-logprobs` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 30/30 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live logprobs result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-logprobs --timeout-ms 90000 --verbose`
  passed 1/1, latency 2361 ms, output `logprobs-ok`, total usage 67 tokens.
- Full live `bridge-regression` passed 16/16, pass rate 1.0, average latency
  1819 ms, P95 latency 3893 ms, total usage 2186 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7ryfn9` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Stored Chat Completions List Endpoint

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `GET /v1/chat/completions` lists only stored Chat Completions and supports
  `model`, `metadata[key]`, `after`, `limit`, and `order` parameters. The
  response is an OpenAI-style list with `data`, `first_id`, `last_id`, and
  `has_more`.
- Added local `GET /v1/chat/completions` support for Chat passthrough requests
  created with `store:true`.
- Implemented model filtering, bracketed metadata filtering, and existing local
  pagination over the file-backed response store.
- Added local completion normalization so list filtering can use request model
  and request metadata when an upstream Chat provider does not echo those fields
  in the completion object.
- Added regression coverage for:
  - stored Chat completion listing;
  - `model` and `metadata[key]` filters;
  - list pagination shape;
  - unstored Chat completions remaining unavailable;
  - live `chat-lifecycle` checking list/get/messages together.
- Verified:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 30/30 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live Chat lifecycle result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case chat-lifecycle --timeout-ms 90000 --verbose`
  passed 1/1, latency 2119 ms, output `chat-life-ok`, list status 200, message
  count 2, total usage 59 tokens.
- Full live `bridge-regression` passed 16/16, pass rate 1.0, average latency
  1950 ms, P95 latency 4494 ms, total usage 2273 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7s9mln` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Chat-Native Stop and DeepSeek Identity/Usage Mapping

- Used current OpenAI Chat Completions reference data to confirm Chat supports:
  - `stop` sequences;
  - `service_tier` request/response metadata;
  - replacement identity/cache fields such as `safety_identifier` and
    `prompt_cache_key`.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek supports:
  - `stop` on Chat Completion requests;
  - `user_id` for content-safety review, KVCache isolation, and scheduling
    isolation;
  - `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` in usage.
- Added Responses-to-Chat compatibility mapping:
  - `stop` is forwarded to upstream Chat providers;
  - DeepSeek mode maps `user_id`, `safety_identifier`, `prompt_cache_key`, or
    legacy `user` to DeepSeek `user_id`;
  - `user_id` values that already match DeepSeek's allowed character set are
    passed directly; values with unsupported characters are converted to a
    stable SHA-256 identifier before forwarding.
- Added Chat-to-Responses response mapping:
  - DeepSeek `prompt_cache_hit_tokens` fills
    `usage.input_tokens_details.cached_tokens`;
  - upstream Chat `service_tier` overwrites the local skeleton tier when
    present.
- Added regression coverage for:
  - local translator `stop` passthrough and DeepSeek `user_id` aliasing;
  - local prompt-cache usage and service-tier response mapping;
  - mock server `stop` passthrough from `/v1/responses`;
  - live `responses-stop-sequence` in `bridge-regression`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 32/32 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Live stop result against `deepseek-v4-pro` through
  `http://127.0.0.1:12912`:
  `npm run eval:bridge -- --case responses-stop-sequence --timeout-ms 90000 --verbose`
  passed 1/1, latency 2068 ms, output `stop-ok`, total usage 76 tokens.
- First full live `bridge-regression` attempt passed 16/17. The new stop case
  returned an empty visible string after consuming a 64-token output budget,
  consistent with DeepSeek spending the budget on hidden thinking tokens before
  visible output. The eval case was adjusted to a 256-token output budget and
  rerun.
- Full live `bridge-regression` passed 17/17, pass rate 1.0, average latency
  2019 ms, P95 latency 4612 ms, total usage 2375 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7snjqg` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Multi-Choice Chat Response Preservation

- Used current OpenAI migration guidance to confirm:
  - Chat Completions can return multiple parallel generations as `choices[]`
    through the `n` parameter;
  - Responses removed `n` and returns typed output items instead of Chat
    choices.
- Added non-streaming Chat-to-Responses response mapping for every returned
  `choices[]` entry instead of only `choices[0]`:
  - `message.content` and `message.refusal` become output `message` items;
  - `message.tool_calls[]` become Responses `function_call` items;
  - legacy `message.function_call` becomes a Responses `function_call` item.
- Added stable legacy function-call IDs derived from the upstream Chat
  completion id and choice index. The same ID is used in Responses output and
  in local replay messages so a later `function_call_output` can reference it.
- Expanded replay storage for non-streaming Chat choices so multiple returned
  assistant choices are retained as replay messages when a later request uses
  `previous_response_id`.
- Added regression coverage for:
  - multiple Chat choices producing multiple Responses output items;
  - `finish_reason:"length"` in any choice marking the aggregate response
    `incomplete`;
  - legacy `message.function_call` output conversion;
  - server-level `previous_response_id` replay of a legacy Chat function call
    followed by a `function_call_output`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 34/34 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  1977 ms, P95 latency 4308 ms, total usage 2354 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7t10sk` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Chat Finish Reason Terminal State Mapping

- Used the current OpenAI OpenAPI schema to confirm:
  - Responses terminal stream events include `response.completed`,
    `response.incomplete`, and `response.failed`;
  - `Response.incomplete_details.reason` is limited to
    `max_output_tokens` and `content_filter`;
  - `Response.error.code` supports `server_error` for failed generations.
- Used current DeepSeek Chat Completion docs to confirm Chat
  `finish_reason` values include `stop`, `length`, `content_filter`,
  `tool_calls`, and `insufficient_system_resource`.
- Added a shared Chat-to-Responses terminal-state mapper:
  - `length` maps to `status=incomplete` with
    `incomplete_details.reason=max_output_tokens`;
  - `content_filter` maps to `status=incomplete` with
    `incomplete_details.reason=content_filter`;
  - DeepSeek `insufficient_system_resource` maps to `status=failed` with
    `error.code=server_error`;
  - `stop`, `tool_calls`, and legacy `function_call` remain completed.
- Applied the mapper to both non-streaming and streaming Responses output.
  Streaming now collects terminal `choice.finish_reason` values from Chat
  chunks and emits `response.incomplete` or `response.failed` instead of
  always emitting `response.completed`.
- Added regression coverage for:
  - non-streaming `content_filter` and `insufficient_system_resource`
    terminal states;
  - streaming `length` producing a `response.incomplete` terminal event;
  - streaming `insufficient_system_resource` producing a `response.failed`
    terminal event.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 37/37 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2153 ms, P95 latency 4280 ms, total usage 2496 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7tegzw` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Streaming Multi-Choice Preservation

- Used the current OpenAI Chat Completions streaming schema to confirm Chat
  streamed chunks expose `choices[]`, that the array can contain more than one
  element when `n > 1`, and that each choice carries an `index`.
- Used current DeepSeek Chat Completion docs to confirm streaming chunks use
  `object:"chat.completion.chunk"` with `choices[].index`,
  `choices[].delta`, and `choices[].finish_reason`.
- Refactored Responses streaming state from a single assistant accumulator into
  per-choice accumulators keyed by `choice.index`.
- Streaming now preserves separate output `message`, `reasoning`, token
  logprobs, function-call items, and replay assistant messages per Chat choice.
- Added regression coverage for a two-choice interleaved Chat stream:
  - final Responses output contains two message items, `alpha` and `beta`;
  - a later `previous_response_id` request replays both choices as distinct
    assistant messages to upstream Chat.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 38/38 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2035 ms, P95 latency 4608 ms, total usage 2422 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7toti0` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Streaming Refusal Content Mapping

- Used the current OpenAI Chat Completions streaming schema to confirm Chat
  stream deltas can include `delta.refusal`, and Chat stream logprobs can
  include `logprobs.refusal[]`.
- Used the current OpenAI Responses streaming schema to confirm Responses emits
  `response.refusal.delta` and `response.refusal.done` events, and that
  refusal output content parts only contain `type` and `refusal`.
- Added streaming Chat-to-Responses refusal mapping:
  - `choices[].delta.refusal` creates a Responses `refusal` content part;
  - refusal text streams as `response.refusal.delta` and finalizes as
    `response.refusal.done`;
  - pure refusal messages no longer emit fake `response.output_text.done`
    events;
  - refusal history is stored as Chat assistant `refusal` when a later request
    uses `previous_response_id`.
- Preserved Chat `logprobs.refusal[]` under
  `metadata.compatibility.chat_refusal_logprobs[]` instead of attaching it to
  refusal content parts, because the Responses refusal schema has no logprobs
  field.
- Added regression coverage for:
  - streamed refusal deltas and done events;
  - final Responses refusal content shape;
  - refusal logprobs compatibility metadata;
  - follow-up replay through `previous_response_id`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 39/39 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  1987 ms, P95 latency 4179 ms, total usage 2345 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7txna0` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Non-Streaming Refusal Logprobs Preservation

- Used the current OpenAI Chat Completions schema to confirm non-streaming
  `choices[].logprobs` can contain both `content[]` and `refusal[]` token
  probability arrays.
- Reused the Responses refusal schema boundary from the streaming refusal pass:
  refusal content parts only expose `type` and `refusal`, not `logprobs`.
- Added non-streaming Chat-to-Responses preservation for
  `choices[].logprobs.refusal[]` under
  `metadata.compatibility.chat_refusal_logprobs[]`.
- Tightened non-streaming text-logprob normalization so refusal-only logprob
  objects are not accidentally attached to `output_text` content parts.
- Updated server metadata merging so translator-level compatibility metadata is
  not overwritten when the bridge appends local adapter compatibility metadata.
- Added regression coverage for:
  - direct translator refusal-logprobs preservation;
  - `/v1/responses` non-streaming refusal output shape;
  - preservation of `chat_refusal_logprobs` alongside request compatibility
    metadata such as `logprobs:"chat_logprobs"`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 41/41 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
- Full live `bridge-regression` against `deepseek-v4-pro` through
  `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
  2092 ms, P95 latency 5020 ms, total usage 2334 tokens.
- Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
  `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
  `ui-smoke-mq7u4c2c` appeared before reload and after reload, console errors
  0, warnings 0.

## 2026-06-10 Service Tier Passthrough and DeepSeek Visible-Output Stability

- Used current OpenAI Chat Completions reference data to confirm
  `service_tier` is a Chat request parameter and response field when supported
  by the provider.
- Used current DeepSeek Chat Completion docs to confirm DeepSeek does not
  document `service_tier`, so DeepSeek deployments now filter this field by
  default instead of blindly forwarding it upstream.
- Added provider-aware `service_tier` request handling:
  - non-DeepSeek/OpenAI-compatible providers forward `service_tier` by default;
  - DeepSeek filters `service_tier` by default and records
    `metadata.compatibility.service_tier.forwarded=false`;
  - `CODEXCOMPAT_FORWARD_SERVICE_TIER` can override the provider-aware default.
- Added streaming Chat-to-Responses `service_tier` preservation when an upstream
  Chat stream chunk includes the actual tier used.
- Tightened DeepSeek visible-output stability for local compatibility contexts:
  - local `input_file` injection now disables DeepSeek thinking by default and
    records `metadata.compatibility.local_input_files.deepseek_thinking`;
  - local compaction replay follow-ups now disable DeepSeek thinking by default
    and record `metadata.compatibility.local_compaction.deepseek_thinking`.
- Added regression coverage for:
  - translator `service_tier` passthrough and provider-unsupported filtering;
  - config defaults that filter `service_tier` for DeepSeek providers;
  - mock server non-streaming `service_tier` forwarding and upstream tier
    preservation;
  - streaming terminal Responses `service_tier` preservation;
  - DeepSeek thinking disablement for local `input_file` and compaction replay.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 45/45 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - `npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose`:
    passed 1/1, latency 1567 ms, output `input-file-ok`.
  - `npm run eval:bridge -- --case responses-compact-continuation --timeout-ms 90000 --verbose`:
    passed 1/1, latency 2937 ms, output `atlas-77`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1728 ms, P95 latency 3463 ms, total usage 2176 tokens.
  - Live DeepSeek `service_tier` filter check returned HTTP 200, visible output
    `tier filter ok`, and `metadata.compatibility.service_tier.forwarded=false`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7uoyl8` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Streaming Chat Options and Usage Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `stream_options` is a Chat request parameter for streaming responses.
- Used the current DeepSeek Chat Completion docs to confirm DeepSeek documents
  `stream_options` with `include_usage`, so forwarding this field is safe for
  the live provider.
- Added Responses-to-Chat `stream_options` handling:
  - streaming Responses requests now forward caller-provided `stream_options`;
  - when the caller omits `stream_options.include_usage`, the bridge sets
    `include_usage:true` so the terminal Responses stream event can preserve
    upstream usage;
  - non-streaming requests that contain `stream_options` filter the field and
    record `metadata.compatibility.stream_options.reason=stream_required`;
  - `CODEXCOMPAT_FORWARD_STREAM_OPTIONS` and
    `CODEXCOMPAT_STREAM_INCLUDE_USAGE` can disable forwarding or bridge-added
    usage requests.
- Strengthened the live `responses-stream-events` regression so it now requires
  terminal `usage.total_tokens > 0` and
  `metadata.compatibility.stream_options.reason=enabled_by_bridge`.
- Added regression coverage for:
  - default streaming `stream_options.include_usage=true`;
  - caller-specified stream options such as `include_usage:false`;
  - non-streaming filtering and compatibility metadata;
  - server-side upstream request shape and final streaming metadata.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - `npm run eval:bridge -- --case responses-stream-events --timeout-ms 90000 --verbose`:
    passed 1/1, latency 2021 ms, usage 62 tokens, output `stream-ok`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1996 ms, P95 latency 4564 ms, total usage 2406 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7v403h` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Response Metadata Preservation

- Used the current OpenAI Chat Completions API reference to confirm Chat
  response and streaming chunk metadata fields, especially `id` and
  `system_fingerprint`, are part of the upstream Chat response surface:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
  and
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
- Added Chat-to-Responses compatibility metadata preservation:
  - non-streaming Chat `id` is preserved as
    `metadata.compatibility.chat_completion_id`;
  - non-streaming Chat `system_fingerprint`, including explicit `null`, is
    preserved as `metadata.compatibility.chat_system_fingerprint`;
  - stored Chat metadata fields `request_id` and `input_user` are preserved as
    `metadata.compatibility.chat_request_id` and
    `metadata.compatibility.chat_input_user` when returned by the provider;
  - streaming Chat chunks now accumulate the same top-level metadata and expose
    it on the terminal Responses event.
- Kept the bridge-generated Responses `resp_*` id unchanged so storage,
  `previous_response_id`, lifecycle retrieval, and cancellation semantics remain
  local and stable.
- Updated `docs/compatibility-matrix.md` with the new response metadata rows.
- Added regression coverage for:
  - non-streaming compatibility metadata preservation in
    `chatCompletionToResponse`;
  - streaming terminal `response.completed` preservation of Chat completion id
    and `system_fingerprint`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; `systemctl is-active`
    returned `active`.
  - `curl -fsS http://127.0.0.1:12912/healthz` returned `ok:true`, provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1931 ms, P95 latency 4442 ms, total usage 2289 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vdte4` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Streaming Chat Annotation Preservation

- Used the current OpenAI web search and migration guidance to confirm citation
  annotations are exposed on message output content and that Chat streaming
  arrives as incremental `delta` chunks:
  https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations
  and
  https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers
- Added streaming Chat annotation aggregation:
  - `choices[].delta.annotations[]` and provider-style `choices[].annotations[]`
    are accumulated per Chat choice;
  - terminal Responses message parts expose the accumulated annotations at
    `output_text.annotations[]`;
  - no synthetic annotation-specific SSE event is emitted yet because this
    bridge only emits documented typed events it already models.
- Updated `docs/compatibility-matrix.md` to document native Chat annotation
  preservation for non-streaming and streaming responses.
- Added regression coverage to the typed streaming mock so the final
  `response.completed` object must include a preserved `url_citation`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1813 ms, P95 latency 3830 ms, total usage 2234 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vm1ky` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Choice Metadata Preservation

- Used the current OpenAI migration guidance to confirm the structural mismatch:
  Chat Completions returns an array of `choices`, while Responses returns
  typed `output` items:
  https://developers.openai.com/api/docs/guides/migrate-to-responses#messages-vs-items
- Added original Chat choice metadata preservation:
  - non-streaming Chat `choices[].index` and `choices[].finish_reason` are
    recorded in `metadata.compatibility.chat_choices[]`;
  - streaming Chat choice states record the latest `finish_reason` per
    `choice.index` and expose the final values in terminal Responses metadata;
  - the existing terminal status mapping remains unchanged, so
    `length`, `content_filter`, and DeepSeek `insufficient_system_resource`
    still map to Responses incomplete/failed states while the raw Chat value is
    also retained.
- Updated `docs/compatibility-matrix.md` with the new `chat_choices[]` row.
- Added regression coverage for:
  - non-streaming multi-choice raw index and finish reason preservation;
  - streaming terminal `response.completed` raw choice metadata preservation.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1731 ms, P95 latency 3501 ms, total usage 2173 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vqg7y` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Top-Level Metadata Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm Chat
  completion responses and streaming chunks expose top-level `id`, `object`,
  `created`, `model`, `system_fingerprint`, `choices`, and optional stored
  completion metadata fields:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Extended Chat-to-Responses compatibility metadata preservation:
  - `object`, `created`, and `model` are preserved as
    `metadata.compatibility.chat_object`, `chat_created`, and `chat_model` for
    non-streaming responses and streaming chunks;
  - stored-completion metadata fields returned by an upstream Chat provider,
    including `seed`, `tool_choice`, `response_format`, sampling parameters,
    `metadata`, and `tools`, are preserved under `metadata.compatibility.chat_*`;
  - this keeps the bridge-generated Responses object identity (`object=response`
    and local `resp_*` id) stable while retaining the original Chat envelope.
- Updated `docs/compatibility-matrix.md` with the new top-level metadata rows.
- Added regression coverage for:
  - non-streaming Chat top-level/stored metadata preservation;
  - streaming Chat chunk `object`, `created`, and `model` preservation in the
    terminal Responses event.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1696 ms, P95 latency 3599 ms, total usage 2135 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7vw0s8` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Full Chat Usage Preservation

- Used the current OpenAI Chat Completions OpenAPI schema to confirm Chat usage
  can include provider-specific token details such as
  `prompt_tokens_details.audio_tokens`,
  `completion_tokens_details.audio_tokens`,
  `accepted_prediction_tokens`, and `rejected_prediction_tokens`:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Kept the direct Responses usage mapping stable:
  - `prompt_tokens` / `completion_tokens` continue to map to
    `input_tokens` / `output_tokens`;
  - `prompt_tokens_details.cached_tokens` and DeepSeek
    `prompt_cache_hit_tokens` continue to map to
    `input_tokens_details.cached_tokens`;
  - `completion_tokens_details.reasoning_tokens` continues to map to
    `output_tokens_details.reasoning_tokens`.
- Added lossless Chat usage preservation:
  - the full upstream Chat `usage` object is now stored as
    `metadata.compatibility.chat_usage` for non-streaming Responses;
  - streaming terminal Responses events preserve the final usage chunk in the
    same compatibility metadata field.
- Updated `docs/compatibility-matrix.md` with the `chat_usage` preservation row.
- Added regression coverage for:
  - non-streaming Chat audio and prediction token details;
  - streaming Chat usage detail preservation on `response.completed`.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 48/48 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1851 ms, P95 latency 3554 ms, total usage 2306 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7w0j6g` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Chat Max Completion Token Alias

- Used the current OpenAI Chat Completions OpenAPI schema to confirm
  `max_completion_tokens` is the current Chat-side token limit parameter while
  Responses uses `max_output_tokens`:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Added `/v1/responses` request compatibility for Chat-native token limits:
  - when `max_output_tokens` is absent, `max_completion_tokens` is accepted as
    a Chat-native alias and forwarded to the configured upstream token field
    (`CODEXCOMPAT_MAX_TOKENS_FIELD`, default `max_tokens`);
  - when both fields are present and differ, `max_output_tokens` takes
    precedence and the ignored Chat alias is recorded in
    `metadata.compatibility.max_completion_tokens`;
  - alias forwarding is also recorded in compatibility metadata so callers can
    audit which request field controlled the upstream token limit.
- Updated `docs/compatibility-matrix.md` with the new request mapping row.
- Added regression coverage for:
  - translator alias forwarding and conflict handling;
  - mock server upstream request shape and final metadata preservation.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `npm test`: 50/50 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1724 ms, P95 latency 3880 ms, total usage 2195 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7wc1mb` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Provider-Aware Chat-Native Request Fields

- Used the current OpenAI Chat Completions schema and DeepSeek Chat Completion
  reference to split Chat-native request fields into provider-aware behavior:
  - OpenAI Chat reference:
    https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
  - DeepSeek Chat reference:
    https://api-docs.deepseek.com/api/create-chat-completion
- Added `/v1/responses` compatibility for additional Chat-native fields:
  - `logit_bias`, `modalities`, `audio`, `prediction`, `n`,
    `prompt_cache_key`, `prompt_cache_retention`, `safety_identifier`,
    `moderation`, `verbosity`, `web_search_options`, and legacy
    `functions` / `function_call`;
  - non-DeepSeek/OpenAI-compatible providers forward these fields by default;
  - DeepSeek filters them by default and records the filtered field names in
    `metadata.compatibility.chat_native_fields`;
  - `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS` can override the provider default.
- Extended token-limit aliasing:
  - `max_tokens` is now accepted on `/v1/responses` as a legacy Chat-native
    alias for the configured upstream max-token field;
  - precedence is `max_output_tokens`, then `max_completion_tokens`, then
    `max_tokens`;
  - ignored alias conflicts are recorded under
    `metadata.compatibility.max_completion_tokens` and/or
    `metadata.compatibility.max_tokens`.
- Updated `docs/compatibility-matrix.md` and `docs/deployment.md` with the new
  request mapping and environment flag.
- Added regression coverage for:
  - translator `max_tokens` alias forwarding and conflict metadata;
  - translator Chat-native field forwarding and provider-unsupported filtering;
  - mock server upstream request shape and final compatibility metadata;
  - config defaults that filter Chat-native fields for DeepSeek providers.
- Verified:
  - `node --check src/bridge/translator.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live DeepSeek Chat-native filter probe returned HTTP 200, visible output
    `chat native filter ok`, `metadata.compatibility.max_tokens.forwarded=true`,
    and `metadata.compatibility.chat_native_fields.filtered=["logit_bias","n"]`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1715 ms, P95 latency 3655 ms, total usage 2219 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7wsw2n` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Stored Chat Completion Metadata Update

- Used the current OpenAI Chat Completions docs/search index to identify the
  stored completion update method:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/update
- Added local support for `POST /v1/chat/completions/{completion_id}`:
  - only locally stored `store:true` Chat completion records can be updated;
  - only `{ "metadata": {...} }` is accepted, matching OpenAI's current
    restriction that stored Chat completion updates modify metadata only;
  - unsupported update fields return a `400 invalid_request_error` with
    `code=unsupported_chat_completion_update`;
  - the stored Chat completion and stored request metadata are both updated so
    later `GET`, `LIST`, and `metadata[key]` filters observe the new metadata.
- Extended the bridge regression harness:
  - `chat-lifecycle` now creates a stored Chat completion, updates metadata,
    fetches the completion, lists by the updated metadata filter, verifies the
    old metadata filter no longer returns the same id, and retrieves stored
    messages.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with
  the update endpoint and regression coverage.
- Added regression coverage for:
  - invalid non-metadata update rejection;
  - successful metadata update response;
  - refetch after update;
  - list filtering by updated metadata and no match for prior metadata.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1899 ms, P95 latency 5580 ms, total usage 2323 tokens. The
    `chat-lifecycle` case returned `update_status:200`, `list_count:1`, and
    `old_list_status:200`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7x3zir` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Stored Chat Completion Delete

- Used the current OpenAI Chat Completions API reference to confirm
  `DELETE /chat/completions/{completion_id}` deletes only stored Chat
  Completions created with `store:true` and returns a
  `ChatCompletionDeleted` object:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/delete/
- Added local support for `DELETE /v1/chat/completions/{completion_id}`:
  - only locally stored Chat completion records can be deleted;
  - non-Chat records in the shared response store are not deleted by this route;
  - successful deletion returns
    `{object:"chat.completion.deleted", id, deleted:true}`;
  - follow-up get/messages calls return 404 and list filters no longer return
    the deleted id.
- Extended the bridge regression harness:
  - `chat-lifecycle` now writes the created completion id into updated
    metadata, lists by that unique metadata key, deletes the stored Chat
    completion, verifies `post_delete_get_status=404`, and confirms the
    metadata-filtered list no longer contains the deleted id.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with
  the delete endpoint and regression coverage.
- Added regression coverage for:
  - successful delete response shape;
  - get/messages 404 after delete;
  - list filter empty after delete;
  - repeated delete 404.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for stored Chat lifecycle: passed.
  - `npm test`: 54/54 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active after systemd settled.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 17/17, pass rate 1.0, average latency
    1780 ms, P95 latency 3617 ms, total usage 2150 tokens. The
    `chat-lifecycle` case returned `update_status:200`, `delete_status:200`,
    `post_delete_get_status:404`, and `post_delete_list_status:200`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7xa7js` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Vector Store File Batches and Web Search Resilience

- Used the current OpenAI file-search guide and Vector Store File Batch API
  reference to close a local vector-store compatibility gap:
  - guide:
    https://developers.openai.com/api/docs/assistants/tools/file-search#creating-vector-stores-and-adding-files
  - create batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/create
  - retrieve batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/retrieve
  - list batch files:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/list_files
  - cancel batch:
    https://developers.openai.com/api/reference/python/resources/vector_stores/subresources/file_batches/methods/cancel
- Added local support for the OpenAI Vector Store File Batch lifecycle:
  - `POST /v1/vector_stores/{vector_store_id}/file_batches`;
  - `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}`;
  - `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/files`;
  - `POST /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel`.
- Batch creation now accepts both current OpenAI request shapes:
  - `file_ids` with global `attributes` and `chunking_strategy`;
  - `files[]` entries with per-file `file_id`, `attributes`, and
    `chunking_strategy`.
- The local adapter enforces `file_ids` / `files` mutual exclusion and a 2000
  file upper bound from the current API reference. Because local indexing is
  synchronous, new batches return `status:"completed"` immediately with
  OpenAI-style `file_counts`; canceling an already completed batch returns the
  completed batch as a compatibility no-op.
- Extended the live bridge regression harness with
  `responses-file-search-batch`, which creates a local file, creates a vector
  store, attaches the file through the new file-batch endpoint, then verifies
  Responses `file_search` returns a `file_search_call`, result citation, and
  visible answer through DeepSeek.
- During live verification, the existing `responses-web-search` case exposed a
  Wikimedia HTTP 403 from the default MediaWiki API request. The bridge now:
  - uses a more complete default `CODEXCOMPAT_WEB_SEARCH_USER_AGENT`;
  - falls back from the default MediaWiki API endpoint to Wikipedia REST page
    search when the first request is rejected;
  - still prefers configured `CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS` when
    present.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Added regression coverage for:
  - vector-store file batch creation with `file_ids`;
  - vector-store file batch creation with `files[]`;
  - batch retrieve, list-files with `filter`, completed cancel no-op, and
    mutual-exclusion rejection;
  - MediaWiki API rejection falling back to Wikipedia REST search.
- Verified:
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 18/18, pass rate 1.0, average latency
    1663 ms, P95 latency 4052 ms, total usage 2358 tokens. The new
    `responses-file-search-batch` case returned `file_batch_status:"completed"`
    and the `responses-web-search` case returned `ok:true`.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7xthoj` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Vector Store Update, File Attributes, and File Content

- Used the current OpenAI Vector Stores API reference to close three local
  file-search support gaps:
  - update vector store:
    https://developers.openai.com/api/reference/resources/vector_stores/methods/update/
  - update vector-store file attributes:
    https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/update/
  - retrieve vector-store file content:
    https://developers.openai.com/api/reference/resources/vector_stores/subresources/files/methods/content/
- Added local support for:
  - `POST /v1/vector_stores/{vector_store_id}` to update `name`, `metadata`,
    and `expires_after`, with local `expires_at` computation from
    `last_active_at`;
  - `POST /v1/vector_stores/{vector_store_id}/files/{file_id}` to update
    vector-store file `attributes`;
  - `GET /v1/vector_stores/{vector_store_id}/files/{file_id}/content` to return
    local extracted text chunks for the attached file, including the
    `vector_store.file_content.page` page fields plus an example-compatible
    `content` alias.
- Added `usage_bytes` as a compatibility alias on hydrated local vector-store
  objects while preserving the existing `bytes` field.
- Extended regression coverage:
  - server tests now update vector-store metadata/expiry policy, update file
    attributes, retrieve vector-store file content, and verify the updated
    attributes are returned;
  - live `bridge-regression` now includes a new `vector-store-lifecycle` case
    that creates a file and vector store, updates the vector store, attaches and
    updates a vector-store file, retrieves file content, searches using updated
    attributes, and cleans up without model token spend.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for local Vector Store file batches/lifecycle: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `vector-store-lifecycle` case passed 1/1 in 262 ms with
    `vector_store_file_status:"completed"`, `content_parts:1`, and
    `search_results:1`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 19/19, pass rate 1.0, average latency
    1708 ms, P95 latency 4102 ms, total usage 2447 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7y9d8c` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Input File PDF Text Extraction

- Closed a local `input_file` compatibility gap for PDFs with extractable text
  layers:
  - inline `file_data` PDFs now run through local Poppler `pdftotext`;
  - extracted PDF text is injected into the upstream Chat prompt like other
    local `input_file` text;
  - unsupported/scanned PDFs still surface as compatibility metadata rather
    than invented content.
- Added bounded PDF extraction controls:
  - `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR=pdftotext` by default;
  - `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR=disabled` to turn this off;
  - `CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS=10000` by default;
  - extraction still obeys `CODEXCOMPAT_INPUT_FILE_MAX_BYTES` and
    `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS`.
- Added `metadata.compatibility.local_input_files.pdf_extracted_count` and an
  `extraction_method: pdftotext` prompt header. Regression tests assert the
  prompt does not contain the raw `%PDF-1.4` body, preventing a false pass from
  raw ASCII PDF injection.
- Extended the live bridge regression harness with `responses-input-file-pdf`,
  which sends an inline base64 PDF through `/v1/responses`, verifies
  `pdf_extracted_count:1`, and requires DeepSeek to answer from the extracted
  PDF text.
- Updated `docs/compatibility-matrix.md`, `docs/deployment.md`, and
  `docs/evaluation-plan.md`.
- Verified:
  - `pdftotext` is installed at `/usr/bin/pdftotext`, version 24.02.0.
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server test for Responses `input_file`: passed.
  - `npm test`: 56/56 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-input-file-pdf` passed 1/1 after restart, elapsed 1524 ms,
    total usage 129 tokens, output `pdf-input-ok`. The same stricter case failed
    before restart because the previous service did not report
    `pdf_extracted_count`, proving the live check gates the new behavior.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 20/20, pass rate 1.0, average latency
    1532 ms, P95 latency 2336 ms, total usage 2538 tokens.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq7ypehb` appeared before reload and after reload, console errors
    0, warnings 0.

## 2026-06-10 Disk-Bounded SWE-bench Prediction Runner

- Reviewed current SWE-bench public evaluation guidance:
  - evaluation guide:
    https://www.swebench.com/SWE-bench/guides/evaluation/
  - harness reference:
    https://www.swebench.com/SWE-bench/reference/harness/
  - Docker setup guide:
    https://www.swebench.com/SWE-bench/guides/docker_setup/
  - Verified dataset card:
    https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified
- Added `scripts/swebench-runner.mjs` and `npm run bench:swe`.
- The runner is intentionally disk-bounded:
  - it accepts a local JSONL/JSON subset instead of downloading datasets into
    the repository;
  - it defaults reports and predictions to
    `/srv/aialra/data/opencodexapp/eval/swebench/`;
  - it writes SWE-bench-compatible predictions JSONL with `instance_id`,
    `model_name_or_path`, and `model_patch`;
  - it records compact task metadata, patch hashes, latency, token usage, and
    an official `swebench.harness.run_evaluation` follow-up command;
  - it omits gold `patch` and `test_patch` contents from prompts and compact
    reports to avoid benchmark leakage;
  - it includes `--dry-run` for dataset/report validation without model spend
    and `--write-sample` for a synthetic smoke fixture only.
- Added unit coverage for dry-run report and prediction generation, including
  checks that gold patch strings do not appear in stdout.
- Updated `docs/evaluation-plan.md` and `docs/deployment.md`.
- Verified:
  - `node --check scripts/swebench-runner.mjs`: passed.
  - targeted `node --test test/swebench_runner.test.js`: passed.
  - `npm test`: 57/57 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Synthetic dry-run smoke:
    `npm run bench:swe -- --dataset-jsonl /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke.jsonl --write-sample --dry-run --limit 1 --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke-report.json --predictions /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke-predictions.jsonl`
    passed, wrote 1 empty official prediction without model usage, and recorded
    zero transport errors.
  - Synthetic live bridge smoke:
    `npm run bench:swe -- --dataset-jsonl /srv/aialra/data/opencodexapp/eval/swebench/synthetic-smoke.jsonl --limit 1 --timeout-ms 90000 --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-report.json --predictions /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-predictions.jsonl`
    passed through `http://127.0.0.1:12912`, generated 1 diff-like patch,
    latency 25068 ms, total usage 1611 tokens, and recorded zero transport
    errors or secret rejections.

## 2026-06-10 SWE-bench Docker Scorer Wrapper

- Added `scripts/swebench-evaluate.mjs` and `npm run bench:swe:score`.
- The scorer wrapper is intentionally separated from `bench:swe`:
  - `bench:swe` generates DeepSeek/bridge predictions;
  - `bench:swe:score` invokes the official SWE-bench Docker harness when
    `--dry-run` is omitted.
- The wrapper accepts either a `bench:swe` prediction report or direct
  `--predictions` plus dataset arguments, then builds the official
  `python -m swebench.harness.run_evaluation` command.
- Added deployment-safe defaults:
  - `--max-workers 1`;
  - `--cache-level env`;
  - `--clean True`;
  - `--max-instances 5` unless `--allow-large-run` is explicit;
  - `--min-free-gb 120` for live Docker scoring;
  - compact artifacts under `/srv/aialra/data/opencodexapp/eval/swebench/`.
- Added preflight checks for Python, SWE-bench import, Docker, free disk,
  selected instance IDs, prediction count, and secret-like patch content before
  any live harness execution.
- Added compact score outputs:
  - JSON score report with prediction counts, patch hashes, harness command,
    preflight status, parsed `results.json`, parsed `instance_results.jsonl`,
    and summary metrics;
  - Markdown score summary for audit review.
- Updated `bench:swe` prediction reports to include a `wrapper_command` pointing
  to `npm run bench:swe:score -- --prediction-report ... --dry-run`.
- Updated `docs/evaluation-plan.md` and `docs/deployment.md`.
- Verified:
  - `node --check scripts/swebench-evaluate.mjs`: passed.
  - targeted `node --test test/swebench_evaluate.test.js`: passed.
  - `npm test`: 58/58 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Synthetic scorer dry-run:
    `npm run bench:swe:score -- --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/synthetic-live-report.json --dry-run --output /srv/aialra/data/opencodexapp/eval/swebench/synthetic-score-dry-run.json --summary-md /srv/aialra/data/opencodexapp/eval/swebench/synthetic-score-dry-run.md --report-dir /srv/aialra/data/opencodexapp/eval/swebench/harness-smoke`
    passed as a dry-run and produced compact JSON/Markdown score artifacts.
  - Dry-run preflight intentionally did not start Docker scoring because the
    current host cannot yet satisfy the live scorer gate:
    `python3 -c "import swebench"` failed with `ModuleNotFoundError`, and free
    disk was 34.86GB, below the 120GB live scoring guard. Docker itself was
    available: `Docker version 29.1.3`.

## 2026-06-10 Local Conversations API and Responses Conversation Replay

- Used OpenAI's current endpoint list and conversation-state guide to close the
  local Conversations API gap:
  - endpoint list includes `/v1/conversations`,
    `/v1/conversations/{conversation_id}`,
    `/v1/conversations/{conversation_id}/items`, and
    `/v1/conversations/{conversation_id}/items/{item_id}`;
  - the conversation-state guide documents passing `conversation:"conv_..."`
    into Responses and notes that Conversation items are durable separately from
    ordinary stored response TTL.
- Added `FileConversationStore`, backed by
  `CODEXCOMPAT_CONVERSATION_STATE_DIR` with the default
  `$CODEXCOMPAT_STATE_DIR/local-conversations`.
- Implemented local endpoints:
  - `POST /v1/conversations`;
  - `GET`, `POST`, and `DELETE /v1/conversations/{conversation_id}`;
  - `GET` and `POST /v1/conversations/{conversation_id}/items`;
  - `GET` and `DELETE /v1/conversations/{conversation_id}/items/{item_id}`.
- Added Responses integration:
  - `conversation:"conv_..."`, `conversation_id`, and `{conversation:{id}}`
    references are accepted;
  - existing conversation items are replayed into the upstream Chat prompt;
  - successful non-streaming, streaming, and background responses return
    `response.conversation` and append input/output items back to the local
    conversation;
  - append occurs even when the Responses request sets `store:false`, matching
    the Conversation durability boundary described by the official guide.
- Added server tests for conversation CRUD, item pagination/retrieval/deletion,
  `store:false` Responses conversation append, and missing-conversation 404.
- Extended live `bridge-regression` with `responses-conversation-lifecycle`.
- Updated `.env.example`, `docs/compatibility-matrix.md`,
  `docs/evaluation-plan.md`, and `docs/deployment.md`.
- Verified:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server tests for local Conversations and missing conversation
    references: passed.
  - `npm test`: 60/60 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-conversation-lifecycle` passed 1/1, elapsed 1985 ms,
    item count 4, delete status 200, post-delete GET 404, total usage 96
    tokens, output `conversation-ok`.
  - Full live `bridge-regression` against `deepseek-v4-pro` through
    `http://127.0.0.1:12912` passed 21/21, pass rate 1.0, average latency
    1687 ms, P95 latency 2714 ms, total usage 2682 tokens. The new
    `responses-conversation-lifecycle` case returned `conversation-ok` and
    deleted the conversation successfully.
  - Post-change UI smoke against `https://opencodexapp.aialra.online` passed:
    `npm run smoke:ui -- --timeout-ms 180000` returned `ok:true`, marker
    `ui-smoke-mq8001kz` appeared before reload and after reload, console errors
    0, warnings 0.
