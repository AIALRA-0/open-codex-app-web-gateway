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

## 2026-06-10 Conversation Replay for Auxiliary Responses Endpoints

- Extended local Conversation replay beyond `POST /v1/responses`:
  - `POST /v1/responses/input_tokens` now replays local Conversation items
    before probing upstream Chat Completions usage;
  - `POST /v1/responses/compact` now summarizes request,
    `previous_response_id`, and local Conversation state together;
  - both auxiliary endpoints now return 404 `conversation_not_found` without
    calling upstream when a referenced local Conversation is missing.
- Added `response.conversation` and
  `metadata.compatibility.local_conversation` to local compaction responses when
  compaction is attached to a Conversation.
- Kept auxiliary endpoint behavior replay-only: `/input_tokens` and `/compact`
  do not append items back to the Conversation item list.
- Updated `responses-conversation-lifecycle` in the live bridge regression
  harness so it exercises:
  - Conversation creation;
  - `/v1/responses/input_tokens` with Conversation replay;
  - `/v1/responses` with Conversation replay and append;
  - `/v1/responses/compact` with Conversation replay;
  - item listing, delete, and post-delete 404.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted server tests for conversation, compact, and input token paths:
    34/34 passed.
  - `npm test`: 61/61 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-conversation-lifecycle` passed 1/1, elapsed 5237 ms,
    with three successful steps: input-token probe 22 tokens, main response
    output `conversation-ok`, and compaction with 2 output items. The case
    ended with item count 4, delete status 200, post-delete GET 404, and total
    usage 429 tokens.
  - Full live `bridge-regression` passed 21/21 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1711 ms, P95 latency 3676 ms, and total
    usage 2910 tokens.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80dhxa`, reload persistence
    confirmed, console errors 0, warnings 0.
  - Local Conversation JSON files after live cleanup: 0.

## 2026-06-10 Office OOXML Input File Extraction

- Closed another local `input_file` compatibility gap by adding dependency-free
  Office OOXML text extraction for inline/base64, local file-id, and fetched
  file inputs:
  - `.docx` extracts text from Word document/header/footer/comment-style XML
    parts;
  - `.xlsx` extracts shared strings and worksheet rows as tab-separated text;
  - `.pptx` extracts slide text from presentation slide XML.
- Implemented a small bounded ZIP reader in `src/bridge/input_files.js` for
  stored and deflated entries, with entry count and inflated-size guards. No new
  npm package was added.
- Added `metadata.compatibility.local_input_files.office_extracted_count` so
  tests and audit reports can distinguish Office extraction from plain text and
  PDF extraction.
- Extended the live bridge regression harness with
  `responses-input-file-office`, using generated minimal `.docx`, `.xlsx`, and
  `.pptx` fixtures.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - targeted `input_file` server tests: passed, including the new Office
    extraction case.
  - `npm test`: 62/62 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Live `responses-input-file-office` passed 1/1, elapsed 1615 ms, output
    `office-input-ok`, total usage 309 tokens.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1987 ms, P95 latency 4032 ms, and total
    usage 3218 tokens.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80pdf1`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Background Restart Reconciliation

- Closed the "stuck forever after restart" part of the local background
  response gap:
  - bridge startup now scans file-backed Responses records;
  - stale `background:true` + `status:"in_progress"` records are marked
    `failed`;
  - the terminal error uses
    `code:"background_job_interrupted_by_restart"` and
    `type:"compatibility_bridge_error"`;
  - `metadata.compatibility.background_restart` is set to
    `marked_failed_on_startup`.
- This does not yet resume an interrupted upstream call; full native-style
  background durability still needs a persisted job queue. It does prevent
  Codex/UI clients from polling an orphaned local background response forever.
- Added a server test that seeds a file-backed stale background response before
  creating the bridge server and verifies startup reconciliation through
  `GET /v1/responses/{response_id}`.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - targeted background server tests: passed, including normal background
    completion, cancellation, and startup reconciliation.
  - `npm test`: 63/63 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Live deployment restart reconciliation passed by writing a temporary
    non-secret stale response record `resp_stale_live_1781093229`, restarting
    `aialra-opencodexapp-bridge.service`, verifying it returned
    `status:"failed"` with `background_job_interrupted_by_restart`, then
    deleting it through `DELETE /v1/responses/{response_id}`.
  - Temporary live stale response files after cleanup: 0.
  - After restart, bridge, web, and app-server services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1881 ms, P95 latency 4093 ms, and total
    usage 3219 tokens. The normal `responses-background` case completed after
    several `in_progress` polls.
  - Public HTTPS returned HTTP/2 200 from `https://opencodexapp.aialra.online`.
  - UI smoke passed with marker `ui-smoke-mq80ygqx`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Web Search Open Page Context

- Closed another part of the hosted `web_search_preview` parity gap for
  Chat-only providers:
  - local search results can now trigger bounded `open_page` fetches for the
    top configured results;
  - HTML/plain text page content is extracted, size-limited, and injected into
    the upstream Chat prompt;
  - Responses output includes auditable `web_search_call` items for both
    `action.type:"search"` and `action.type:"open_page"`;
  - compatibility metadata records `opened_count` and `open_failed_count`.
- Implementation follows the official OpenAI web search output shape where
  searched responses can include `web_search_call` output items whose action is
  `search`, `open_page`, or `find_in_page`, with final message URL citations.
  Source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations`.
- Added bridge flags:
  - `CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES`;
  - `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES`;
  - `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS`.
- Updated `.env.example`, `docs/deployment.md`,
  `docs/compatibility-matrix.md`, and `docs/evaluation-plan.md`.
- Remaining known gap: this is still a local compatibility adapter, not the
  native OpenAI hosted search product. The default no-key provider remains
  Wikipedia-only, and `find_in_page` plus production-grade ranking/citation
  policy are still future work.
- Verified:
  - `node --check src/bridge/web_search.js src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - `npm test`: 65/65 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2066 ms, output `web-search-ok [1]`, and total
    usage 406 tokens. The harness requires a completed search call, an
    attempted `open_page` call, URL citation annotations, and nonzero open-page
    attempt metadata.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1728 ms, P95 latency 3803 ms, and total
    usage 3228 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq81cn6p`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Web Search Find In Page Context

- Closed the next local `web_search_preview` action-shape gap for Chat-only
  providers:
  - successfully opened pages now receive a local `find_in_page` scan over the
    extracted page text;
  - Responses output includes auditable `web_search_call` items for
    `action.type:"search"`, `action.type:"open_page"`, and
    `action.type:"find_in_page"`;
  - bounded `find_in_page` snippets are injected into the upstream Chat prompt;
  - compatibility metadata records `find_in_page_count`,
    `find_in_page_match_count`, and `find_in_page_failed_count`.
- Improved `open_page` robustness for large pages: local page fetches now read
  up to `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES` and mark the page text
  `truncated` instead of failing solely because the remote body is larger than
  the local read limit.
- Implementation follows the official OpenAI web search output shape where
  `web_search_call.action` may be `search`, `open_page`, or `find_in_page`, with
  final message URL citations. Source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations`.
- Added bridge flags:
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE`;
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES`;
  - `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS`.
- Updated `.env.example`, `docs/deployment.md`,
  `docs/compatibility-matrix.md`, and `docs/evaluation-plan.md`.
- Remaining known gap: this is still a local compatibility adapter, not native
  OpenAI hosted search. The default no-key provider remains Wikipedia-only, and
  production-grade web ranking, source policy, and citation selection remain
  future work.
- Verified:
  - `node --check src/bridge/web_search.js src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - `npm test`: 66/66 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Direct live probe for `Use web search for OpenAI` returned completed
    `search`, `open_page`, and `find_in_page` call actions for
    `https://en.wikipedia.org/wiki/OpenAI`, with `opened_count:1`,
    `find_in_page_count:1`, and `find_in_page_match_count:3`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2553 ms, output `web-search-ok [1]`, and total
    usage 4040 tokens. The harness now requires a completed `find_in_page`
    action when the page opens successfully.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1629 ms, P95 latency 3589 ms, and total
    usage 6812 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq81p7ky`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Static Chunking

- Closed a local `file_search` fidelity gap where vector-store file attachments
  stored `chunking_strategy` but search/content generation still used fixed
  paragraph slicing.
- Local vector-store files now:
  - validate OpenAI-style `chunking_strategy` on attach and file-batch attach;
  - use the documented default static strategy of 800-token chunks with
    400-token overlap when no strategy is provided or `type:"auto"` is used;
  - reject invalid static strategies where `max_chunk_size_tokens` is outside
    100-4096 or overlap exceeds half the chunk size;
  - expose effective `chunking_strategy` plus chunk metadata through
    `/v1/vector_stores/{vector_store_id}/files/{file_id}/content`;
  - include `chunk_index`, token offsets, token count, and effective strategy in
    `/v1/vector_stores/{vector_store_id}/search` results.
- Also tightened lexical ranking slightly with exact-phrase and term-frequency
  boosts while keeping the retriever local and auditable.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/retrieval#chunking`, which
  documents the 800/400 default and static chunking limits.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this is still lexical local retrieval, not OpenAI's
  managed semantic vector search with embeddings, reranking, async ingestion,
  and full hosted ranking policy.
- Verified:
  - `node --check src/bridge/local_file_search.js scripts/eval-harness.mjs test/server.test.js`:
    passed.
  - Targeted local vector/file-search tests passed, including the new static
    chunking strategy case.
  - `npm test`: 67/67 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 176 ms, with
    `content_parts:4` and `search_results:3`, proving the configured
    100-token/50-token-overlap static chunking path was exercised.
  - Full live `bridge-regression` passed 22/22 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 1722 ms, P95 latency 3900 ms, and total
    usage 6898 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq820iqn`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Bounded Input File URL Truncation

- Closed a local `input_file` reliability gap where remote HTTP(S)
  `file_url` inputs that exceeded the byte cap failed the entire local file
  extraction path instead of providing any usable prefix context to Chat-only
  providers.
- Remote `file_url` fetches now retain bytes up to
  `CODEXCOMPAT_INPUT_FILE_MAX_BYTES`, continue normal text/PDF/OOXML extraction
  on that bounded prefix, set `truncated: true` in the injected file context,
  and increment `metadata.compatibility.local_input_files.truncated_count`.
- Local Files API `file_id` and inline base64 `file_data` inputs still fail
  when their buffers exceed the local byte cap, preserving strict behavior for
  caller-controlled complete files.
- Extended the live bridge regression harness with `responses-input-file-url`,
  which serves a deterministic local HTTP fixture and verifies that the running
  bridge fetches it through a real `file_url` request path.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/file-inputs`, which documents
  Responses `input_file` support for base64 data, Files API file IDs, and
  external URLs, plus file-type processing and size-limit considerations.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Remaining known gap: this remains a bounded local text-extraction adapter,
  not OpenAI's native file pipeline. PDF page images, OCR, full spreadsheet
  augmentation, richer document parsing, and complete remote files above the
  local cap still require future work or the local `file_search` path.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local `input_file` server tests passed 3/3, including the new
    remote URL truncation case.
  - `npm test`: 68/68 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-input-file-url` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1278 ms, output `url-input-ok`, and total usage
    165 tokens.
  - Full live `bridge-regression` passed 23/23 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1760 ms, P95 latency 4229 ms, and total usage
    7068 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82b356`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Deterministic Spreadsheet Input Augmentation

- Closed part of the `input_file` spreadsheet parity gap for Chat-only
  providers. CSV/TSV inputs and `.xlsx` worksheets now receive deterministic
  local spreadsheet context instead of only raw text or unannotated worksheet
  rows.
- The local adapter now:
  - parses CSV/TSV/IIF-style delimited files with quoted-cell support;
  - parses `.xlsx` worksheet rows through the existing bounded OOXML reader;
  - keeps up to the first 1,000 rows per sheet;
  - injects row limit, parsed row count, detected column count, first-row
    header metadata, and normalized row values into the upstream Chat prompt;
  - sets `truncated_rows: true` and `truncated: true` when row or text caps are
    reached;
  - reports `metadata.compatibility.local_input_files.spreadsheet_extracted_count`
    for CSV/TSV and `.xlsx` extraction paths.
- Extended the live bridge regression harness with
  `responses-input-file-spreadsheet`, which sends a CSV `input_file` payload
  through `/v1/responses` and verifies the running DeepSeek-backed bridge can
  recover the exact spreadsheet answer.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/guides/file-inputs#how-spreadsheet-augmentation-works`,
  which documents spreadsheet-specific processing for `.xlsx`, `.xls`, `.csv`,
  `.tsv`, and `.iif`, including parsing up to the first 1,000 rows per sheet
  with summary/header metadata.
- Updated `docs/compatibility-matrix.md`, `docs/evaluation-plan.md`, and
  `docs/deployment.md`.
- Remaining known gap: this is deterministic local metadata, not OpenAI's
  model-generated spreadsheet summaries or full spreadsheet semantics. Legacy
  binary Excel, formulas/macros, charts, embedded media, merged cells, workbook
  relationships, and richer semantic summarization still require future work.
- Verified:
  - `node --check src/bridge/input_files.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local `input_file` server tests passed 4/4, including CSV
    spreadsheet augmentation and `.xlsx` spreadsheet metadata.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-input-file-spreadsheet` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1259 ms, output `spreadsheet-input-ok`, and
    total usage 202 tokens.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1715 ms, P95 latency 3794 ms, and total usage
    7285 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82ko1e`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Ranking Options

- Closed another local `file_search` parity gap by accepting OpenAI-style
  `ranking_options` on both direct vector-store search requests and Responses
  `file_search` tools.
- Local vector-store search now:
  - normalizes lexical relevance scores to the documented 0..1 range;
  - honors `ranking_options.score_threshold` by filtering low-score chunks
    before sorting and truncating results;
  - returns effective `ranking_options` on
    `/v1/vector_stores/{vector_store_id}/search`;
  - preserves `ranker` and normalized `hybrid_search` metadata for audit
    output, marking hybrid search as `local_mode:"text_only"` because local
    embedding similarity is not available yet;
  - rejects invalid `score_threshold` and hybrid weights with explicit 400
    errors.
- Responses `file_search_call` output items and
  `metadata.compatibility.local_file_search` now include the effective
  ranking options used for the local search.
- Extended live bridge regression coverage so `responses-file-search` sends
  `ranking_options:{ranker:"default_2024_08_21",score_threshold:0.8}` and
  verifies the call output preserves the threshold. The direct
  `vector-store-lifecycle` case now also verifies the search result page
  carries `score_threshold:0.8`.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#improve-file-search-result-relevance-with-chunk-ranking`,
  which documents `file_search.ranking_options`, `ranker`,
  `score_threshold` from 0.0 to 1.0, and hybrid search weights.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this remains local lexical ranking, not OpenAI's managed
  semantic/hybrid file-search stack. Embedding search, reciprocal-rank fusion,
  managed rerankers, and hosted retrieval policy still require future work.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local file-search/vector-store tests passed 3/3, covering default
    ranking options, strict `score_threshold` filtering, hybrid metadata
    normalization, invalid threshold rejection, and Responses call metadata.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1545 ms, output `file-search-ok [1]`, and total
    usage 178 tokens.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 129 ms, with
    `content_parts:4` and threshold-filtered `search_results:2`.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2094 ms, P95 latency 5208 ms, and total usage
    7320 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq82w599`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Multi-Query Decomposition

- Closed another local `file_search` gap against OpenAI hosted retrieval
  behavior: hosted file search can rewrite and break complex user queries into
  multiple searches, while the local adapter previously emitted exactly one
  query.
- Local vector-store search now:
  - accepts `query` as either a string or an array;
  - returns both legacy `search_query` and auditable `search_queries`;
  - scores each chunk against every bounded query and uses the best normalized
    lexical score for ranking;
  - records per-result `matched_queries` so callers can inspect which query
    caused each chunk to be selected.
- Responses `file_search` emulation now:
  - performs bounded deterministic decomposition for prompts such as
    `file search for alpha and beta`;
  - preserves multiple queries in `file_search_call.queries`;
  - reports `metadata.compatibility.local_file_search.query_count`;
  - injects the query list and per-result `matched_queries` into the local
    file-search context prompt.
- Kept the split deliberately conservative and bounded to four queries, 240
  characters each, to avoid prompt/context growth and to stay aligned with the
  bridge's disk- and token-bounded adapter model.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#how-it-works`,
  which documents that hosted `file_search` rewrites user queries and breaks
  complex queries into multiple searches it can run in parallel.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: this is deterministic local decomposition, not OpenAI's
  hosted query rewriting, semantic search, parallel remote retrieval, or managed
  reranking.
- Verified:
  - `node --check src/bridge/local_file_search.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Targeted local file-search/vector-store tests passed 3/3, covering direct
    query arrays, `search_queries`, `matched_queries`, natural-language
    multi-query Responses prompts, and compatibility metadata `query_count`.
  - `npm test`: 69/69 passing tests.
  - `npm run secret-scan`: passed.
  - `git diff --check`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1837 ms, output `file-search-ok [1]`, and total
    usage 219 tokens, verifying multi-query `file_search_call.queries` and
    `matched_queries`.
  - Targeted live `vector-store-lifecycle` passed 1/1, elapsed 157 ms, with
    `content_parts:4` and multi-query `search_results:3`.
  - Full live `bridge-regression` passed 24/24 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2087 ms, P95 latency 4234 ms, and total usage
    7283 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq836bza`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local Hosted Tool `max_tool_calls` Budget

- Closed a Responses compatibility gap where `max_tool_calls` was preserved on
  the response object but did not constrain local hosted-tool emulation for
  Chat-only providers.
- Added a shared local tool-call budget module that:
  - validates `max_tool_calls` as a non-negative integer and returns
    `400 invalid_max_tool_calls` for invalid values;
  - records `max_tool_calls`, `used`, `skipped`, `exhausted`, and bounded
    `skipped_calls` under `metadata.compatibility.local_tool_budget`;
  - avoids running skipped local actions and avoids fabricating tool output.
- Applied the shared budget to local hosted-tool adapters:
  - `web_search` consumes one slot for search, one for each bounded
    `open_page`, and one for each local `find_in_page`;
  - `file_search` consumes one slot per vector-store search;
  - `shell` and `code_interpreter` consume one slot per local command
    execution.
- Tool-specific metadata now exposes skipped counters such as
  `local_web_search.open_skipped_count`,
  `local_file_search.skipped_count`, and `local_shell.skipped_count`.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/reference/responses/create`, whose
  Responses create reference describes `max_tool_calls` as the maximum total
  built-in tool calls processed in a response.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md`.
- Remaining known gap: local hosted-tool execution order is deterministic
  (`shell`/`code_interpreter`, then web search, then file search) rather than
  model-decided dynamic tool planning. Full native parity still requires a real
  tool loop against a Responses-capable model or deeper Codex-side hosted-tool
  negotiation.
- Verified:
  - `node --check` passed for `src/bridge/local_tool_budget.js`,
    `src/bridge/web_search.js`, `src/bridge/local_file_search.js`,
    `src/bridge/local_shell.js`, `src/bridge/server.js`, and
    `scripts/eval-harness.mjs`.
  - Targeted local tests passed 4/4, covering web-search action limiting,
    shared shell/web-search budget consumption, invalid `max_tool_calls`
    rejection, and existing file-search compatibility.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-max-tool-calls` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2007 ms, output `web-budget-ok [1]`, and total
    usage 409 tokens.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1814 ms, P95 latency 4411 ms, and total usage
    7725 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - UI smoke passed with marker `ui-smoke-mq83r5va`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Attribute Filters

- Closed a vector-store search compatibility gap where the local
  `file_search` adapter accepted only simple metadata filters and direct search
  used a smaller max-result ceiling than the OpenAI retrieval guide documents.
- Official sources checked on 2026-06-10:
  - `https://developers.openai.com/api/docs/guides/retrieval#attribute-filtering`,
    which describes attribute filtering over file attributes, comparison
    filters, and compound `and`/`or` filters.
  - `https://developers.openai.com/api/docs/guides/retrieval#semantic-search`,
    which documents vector-store search defaulting to 10 results and accepting
    up to 50 via `max_num_results`.
- Added local vector-store search support for:
  - comparison filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`;
  - legacy-compatible array filters: `in`, `nin`;
  - compound filters: `and`, `or`;
  - aliases such as `attribute_filter`, `attributeFilter`, `filter`, and
    `filters`;
  - plain shorthand maps such as `{suite:"server-test", archived:false}`.
- Invalid filters now fail closed with `400 invalid_vector_store_filter`
  instead of silently behaving like a match-all query. Invalid direct search
  limits now fail with `400 invalid_vector_store_search_limit`.
- Raised the local direct vector-store search `max_num_results` ceiling to 50
  while keeping injected Responses `file_search` context bounded by
  `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS`.
- Updated the evaluation harness, compatibility matrix, deployment notes, and
  95% parity criteria to include comparison/compound attribute filters.
- Remaining known gap: retrieval is still local lexical chunk matching, not
  OpenAI managed semantic vector retrieval, hosted query rewriting, or managed
  reranking.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `src/bridge/server.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 292 ms, with `content_parts:4` and
    `search_results:3`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1646 ms, P95 latency 3890 ms, and total usage
    7760 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq8460h0`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Local File Search Hashed Semantic Hybrid Retrieval

- Closed another `file_search` retrieval parity gap by moving the local vector
  store search path from keyword-only scoring to deterministic hybrid keyword
  plus hashed-semantic scoring.
- Official sources checked on 2026-06-10:
  - `https://developers.openai.com/api/docs/assistants/tools/file-search#how-it-works`,
    which states that hosted file search rewrites queries, breaks complex
    queries into multiple searches, runs both keyword and semantic searches,
    and reranks results.
  - `https://developers.openai.com/api/docs/assistants/tools/file-search#improve-file-search-result-relevance-with-chunk-ranking`,
    which documents `hybrid_search.embedding_weight`,
    `hybrid_search.text_weight`, and `score_threshold`.
- Added a local, dependency-free 256-dimensional hashed semantic scorer using
  token stems, character n-grams, and a small deterministic alias map. This
  improves recall for queries such as `automobile repair` against chunks that
  mention `car maintenance` without requiring a new external embedding API key
  or adding persistent vector files.
- Updated search scoring so:
  - default local search combines keyword and hashed-semantic signals;
  - explicit `hybrid_search.embedding_weight` and `hybrid_search.text_weight`
    control the local blend;
  - exact keyword matches are not penalized by weaker semantic scores;
  - semantic-only results must clear a small local minimum before they can
    satisfy `score_threshold`;
  - results expose `text_score`, `embedding_score`, and `score_details` with
    local embedding model/dimension metadata.
- Updated the eval harness, compatibility matrix, and evaluation plan to cover
  local hashed-semantic hybrid search.
- Remaining known gap: this is still a local deterministic compatibility layer,
  not OpenAI managed embeddings, ANN vector indexing, hosted query rewriting, or
  hosted reranking. Provider/model-backed embeddings and larger retrieval evals
  remain future work.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local file-search/vector-store tests passed 3/3, including a
    semantic-only query with `text_score:0` and `embedding_score >= 0.1`.
  - `npm test`: 72/72 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 173 ms, with `search_results:4` and
    `semantic_search_results:1`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1701 ms, P95 latency 3375 ms, and total usage
    7766 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq84ou0p`, reload persistence
    confirmed, console errors 0, warnings 0.

## 2026-06-10 Runtime Artifact Retention Guard

- Closed an operational maturity gap from the long-running goal: repeated UI
  smoke tests, bridge evaluations, local response storage, and local shell
  artifacts can accumulate under ignored runtime directories even though they
  are not committed to Git.
- Added `scripts/prune-runtime-state.mjs`, a dependency-free retention tool that:
  - defaults to dry-run reporting and only deletes when `--apply` is passed;
  - scans ignored runtime paths under the repository root;
  - prunes by age, item count, and total byte budget;
  - emits a JSON report with scanned, selected, deleted, byte, and reason
    totals for auditability;
  - intentionally leaves local `file_search` vector-store state alone by
    default because it can contain user-provided retrieval data.
- Added `npm run prune:runtime`.
- Added `systemd/aialra-opencodexapp-runtime-prune.service` and
  `systemd/aialra-opencodexapp-runtime-prune.timer` templates for optional
  daily pruning. The service creates its log directory before execution and
  writes JSON reports to `/srv/aialra/logs/opencodexapp/prune/service.log`.
- Updated `docs/deployment.md` and `docs/evaluation-plan.md` with dry-run/apply
  usage, the optional timer, and the retention gate in the 95% parity checklist.
- Verified:
  - `node --check scripts/prune-runtime-state.mjs`: passed.
  - `node --check test/prune_runtime_state.test.js`: passed.
  - Targeted prune test passed 1/1, proving dry-run does not delete, `--apply`
    deletes only selected runtime artifacts, and local file-search state remains
    untouched by default.
  - `npm run prune:runtime -- --dry-run` scanned 211 runtime candidates across
    five targets, selected 0, deleted 0, and reported 0 errors.
  - `npm test`: 73/73 passing tests.
  - `systemd-analyze verify` passed for the runtime prune service and timer
    templates.
  - Bridge, web, and app-server services were active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.

## 2026-06-10 Local Vector Store Expiration Enforcement

- Closed a vector-store lifecycle compatibility gap where local vector stores
  stored `expires_after` / `expires_at` but searches did not refresh
  `last_active_at`, and expired stores could still be used.
- Official source checked on 2026-06-10:
  `https://developers.openai.com/api/docs/assistants/tools/file-search#managing-costs-with-expiration-policies`,
  which says vector-store expiration policies can be set on create/update,
  `last_active_at` is the last time a vector store was part of a run, and runs
  fail when a vector store expires.
- Local vector-store search now:
  - refreshes `last_active_at` whenever a direct vector-store search or
    Responses `file_search` uses the store;
  - recomputes `expires_at` from the configured `expires_after` policy after
    each successful search;
  - marks expired stores as `status:"expired"` on get/list for diagnosis;
  - fails closed with `400 vector_store_expired` when an expired store is used
    for direct search or Responses `file_search`.
- Updated the live vector-store lifecycle eval to re-fetch the store after
  searches and assert refreshed `last_active_at` / `expires_at`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local file-search/vector-store tests passed 3/3, including direct
    expired search and Responses `file_search` expired-store failure.
  - `npm test`: 73/73 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `vector-store-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 145 ms, with `search_results:4` and
    `semantic_search_results:1`.
  - Full live `bridge-regression` passed 25/25 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1707 ms, P95 latency 4045 ms, and total usage
    7710 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq854pt9`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run prune:runtime -- --dry-run` scanned 214 runtime candidates,
    selected 0, deleted 0, and reported 0 errors.

## 2026-06-10 Local Skills API and Shell Skill Mounts

- Closed a Codex/Responses compatibility gap where the bridge did not expose
  OpenAI Skills API endpoints and local shell/code-interpreter requests could
  not mount `skill_reference` bundles.
- Official sources checked on 2026-06-10:
  - OpenAI API endpoint list included `/v1/skills`,
    `/v1/skills/{skill_id}`, `/v1/skills/{skill_id}/content`,
    `/v1/skills/{skill_id}/versions`,
    `/v1/skills/{skill_id}/versions/{version}`, and
    `/v1/skills/{skill_id}/versions/{version}/content`.
  - `https://developers.openai.com/api/docs/guides/tools-skills` describes
    Skills as versioned bundles of files with a `SKILL.md` manifest, directory
    or zip upload, `skill_reference` mounting in shell environments, default
    version updates, and delete rules.
  - `https://developers.openai.com/codex/skills` confirms Codex skills package
    instructions/resources/scripts, use `name` and `description`, and are
    available in the Codex app.
- Added `src/bridge/local_skills.js`, a local file-backed Skills registry under
  `$CODEXCOMPAT_STATE_DIR/local-skills` that:
  - validates exactly one `SKILL.md` manifest and extracts `name` /
    `description`;
  - accepts JSON, multipart directory-style `files[]`, raw `SKILL.md`, and
    storage/deflate zip uploads;
  - exposes skill list/get/update/delete, version create/list/get/delete, and
    content download as `application/zip`;
  - keeps skill bundles in ignored runtime state, not in Git.
- Extended local shell/code-interpreter compatibility so
  `tools[].environment.skills` entries of type `skill_reference` are
  materialized under `/mnt/data/.skills/<skill-name>/v<version>/` before the
  command runs, and recorded under
  `metadata.compatibility.local_shell.mounted_skills`.
- Added `responses-shell-skill` to live `bridge-regression`.
- Updated the compatibility matrix, deployment environment table, and
  evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_shell.js`, `src/bridge/local_skills.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - Targeted local shell/Skills tests passed 2/2, covering Skills API
    lifecycle, default-version deletion protection, zip content retrieval, and
    shell `skill_reference` mounting.
  - `npm test`: 74/74 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-shell-skill` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1305 ms, output `skill-live-ok`, and total usage
    341 tokens.
  - Full live `bridge-regression` passed 26/26 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1638 ms, P95 latency 4285 ms, and total usage
    8093 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq85uxjm`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run prune:runtime -- --dry-run` scanned 217 runtime candidates,
    selected 1 old UI screenshot by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Local Uploads API Compatibility

- Closed a Responses/Files compatibility gap where clients using OpenAI's
  intermediate Uploads API could not create a File before using `input_file` or
  local `file_search`.
- Official sources checked on 2026-06-10:
  - OpenAI `POST /v1/uploads` creates an intermediate Upload object from
    request fields including `purpose`, `filename`, `bytes`, and `mime_type`;
    the returned object has `status:"pending"`, an expiration around one hour,
    and an official maximum of 8 GB.
  - OpenAI Upload Parts add byte chunks to an Upload; each Part has an
    official maximum of 64 MB and parts can be added independently.
  - OpenAI Upload completion accepts ordered `part_ids`; the final byte count
    must match the originally declared Upload `bytes`; the returned completed
    Upload includes a nested usable File object.
  - OpenAI Upload cancellation returns `status:"cancelled"` and prevents more
    Parts from being added.
- Added `src/bridge/local_uploads.js`, a local file-backed Uploads registry
  under `$CODEXCOMPAT_STATE_DIR/local-uploads` that:
  - creates pending Upload objects with local disk-bounded size limits;
  - accepts Part data as JSON `data` / `data_base64` / `content`, multipart
    `data`, or raw request body;
  - completes ordered `part_ids` into a regular local File and returns the
    completed Upload with nested `file`;
  - rejects byte-count mismatches and blocks new Parts after cancellation.
- Wired `/v1/uploads`, `/v1/uploads/{upload_id}/parts`,
  `/v1/uploads/{upload_id}/complete`, and
  `/v1/uploads/{upload_id}/cancel` into the bridge.
- Updated the local Files store to accept Buffer content from Upload
  completion while preserving the existing text-backed file-search/input-file
  behavior.
- Added `responses-upload-input-file` to live `bridge-regression`; it creates
  an Upload, adds Parts in reverse order, completes them with ordered
  `part_ids`, and uses the resulting File as a Responses `input_file`.
- Updated the compatibility matrix, deployment environment table, and
  evaluation plan.
- Verified:
  - `node --check` passed for `src/bridge/local_uploads.js`,
    `src/bridge/server.js`, and `scripts/eval-harness.mjs`.
  - Targeted local Uploads server test passed inside the full server test run,
    covering ordered Part completion, File content retrieval, Responses
    `input_file` use, cancel blocking, and byte mismatch errors.
  - `npm test`: 75/75 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-upload-input-file` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1439 ms, output `upload-input-ok`, and total
    usage 170 tokens.
  - Full live `bridge-regression` passed 27/27 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1894 ms, P95 latency 4273 ms, and total usage
    8294 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq86piuw`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 222 runtime candidates,
    selected 2 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Binary-Safe Local Files and Upload Completion

- Closed the next Uploads/Files fidelity gap: completed Uploads and direct
  Files API uploads now preserve original bytes instead of converting every
  payload through UTF-8 text.
- Official sources checked on 2026-06-10:
  - OpenAI Files API accepts multipart file uploads for use across endpoints;
    the hosted limit is up to 512 MB per file, while this bridge keeps a much
    smaller local default for `/srv/aialra/apps` disk safety.
  - The Files API returns File objects with `id`, `object:"file"`, `bytes`,
    `created_at`, `filename`, and `purpose`; file content is later retrieved
    from `/v1/files/{file_id}/content`.
  - OpenAI Upload completion creates a regular File object from the ordered
    parts; that File must be usable by the rest of the platform.
- Updated the local Files store so new records include `content_base64` and
  `content_encoding:"base64"` for byte preservation. Text-like files also keep
  the previous `content` text field for local file-search indexing and
  backwards compatibility with existing records.
- Updated direct Files API ingestion:
  - multipart parsing now uses the binary parser and preserves each file
    part's content type;
  - raw uploads use `Buffer` content instead of `readBody()` UTF-8 text;
  - JSON uploads accept `content_base64` for binary fixtures and still accept
    legacy `content` strings.
- Updated `/v1/files/{file_id}/content` to return stored bytes with the best
  local content type instead of always returning `text/plain`.
- Updated Responses `input_file.file_id` resolution to read
  `getFileContentBuffer()` first, so completed Upload PDFs can flow through
  the existing local PDF text-layer extractor.
- Added live `responses-upload-input-file-pdf` to `bridge-regression`; it
  uploads a tiny PDF through the Uploads API in two parts, completes it into a
  File, and verifies the model sees the extracted PDF text via Responses
  `input_file`.
- Updated the compatibility matrix, deployment docs, and evaluation plan to
  distinguish byte-preserving Files/Uploads from local text-only file-search
  indexing.
- Verified:
  - `node --check` passed for `src/bridge/local_file_search.js`,
    `src/bridge/input_files.js`, `src/bridge/server.js`, and
    `scripts/eval-harness.mjs`.
  - Targeted local Uploads server tests passed inside the full server test run,
    covering text Uploads, binary PDF Uploads, byte-for-byte content download,
    PDF `input_file` extraction, cancel blocking, and byte mismatch errors.
  - `npm test`: 76/76 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-upload-input-file-pdf` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1359 ms, output `upload-pdf-ok`, and total
    usage 173 tokens.
  - Full live `bridge-regression` passed 28/28 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1970 ms, P95 latency 4945 ms, and total usage
    8445 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq874lt8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 229 runtime candidates,
    selected 5 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.

## 2026-06-10 Legacy Completions Compatibility

- Closed another OpenAI API surface gap by adding local `POST /v1/completions`
  support for legacy prompt-style clients and older evaluation harnesses.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createCompletion` at `/v1/completions` is marked
    legacy and returns `object:"text_completion"` for non-stream responses, or
    a sequence of completion objects for stream responses.
- Implemented the bridge adapter:
  - maps legacy `prompt` strings to upstream Chat `messages`;
  - supports prompt arrays by running one upstream Chat request per prompt and
    aggregating choices;
  - maps `max_tokens` to the configured upstream max-token field;
  - forwards compatible sampling fields, `stop`, `seed`, `n`, optional
    logprobs, stream options, and provider-aware `user`/DeepSeek `user_id`;
  - maps Chat response choices back to legacy `choices[].text`,
    `choices[].index`, `choices[].finish_reason`, and legacy logprobs when
    Chat token logprobs are available;
  - maps Chat streaming chunks to `data: {object:"text_completion"}` SSE
    frames and terminates with `data: [DONE]`;
  - emulates `echo:true` by prefixing the original prompt to returned text;
  - documents best-effort handling for non-lossless legacy fields such as
    `suffix`, token-id prompts, and `best_of`.
- Added two local server tests:
  - non-streaming `/v1/completions` field mapping and response conversion;
  - streaming Chat chunk conversion to legacy completion SSE chunks.
- Added live `completions-legacy` to `bridge-regression`.
- Updated the compatibility matrix and evaluation plan with the legacy
  Completions surface.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - `npm test`: 78/78 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `completions-legacy` passed 1/1 against `deepseek-v4-pro`,
    elapsed 2003 ms, output `completion-ok`, and total usage 52 tokens.
  - Full live `bridge-regression` passed 29/29 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1743 ms, P95 latency 4301 ms, and total usage
    8597 tokens.
  - Direct non-stream `/v1/completions` returned HTTP 200,
    `object:"text_completion"`, output `direct-completion-ok`, and usage 58
    tokens.
  - Direct stream `/v1/completions` returned HTTP 200,
    `text/event-stream; charset=utf-8`, 45 SSE frames, `[DONE]`, and output
    `stream-completion-ok`.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq87kvj8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 232 runtime candidates,
    selected 6 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.1 MB and output
    artifacts are 4.5 MB.

## 2026-06-10 Stored Streaming Chat Lifecycle

- Closed a Chat Completions lifecycle gap: `POST /v1/chat/completions` now
  stores streamed Chat completions when the incoming request sets both
  `stream:true` and `store:true`.
- Official source checked on 2026-06-10:
  - OpenAI Chat Completions `POST /chat/completions` returns either a
    `chat.completion` object or a streamed sequence of
    `chat.completion.chunk` objects.
  - OpenAI Chat Completions `GET /chat/completions` lists stored Chat
    Completions, and only records created with `store:true` are returned.
- Implemented streamed Chat reconstruction in the passthrough path:
  - forwards upstream Chat SSE frames to the client while parsing them;
  - reconstructs a terminal local `object:"chat.completion"` record from the
    observed `chat.completion.chunk` stream;
  - accumulates assistant text, streamed tool-call argument fragments,
    annotations, refusal text, audio deltas, logprobs when present, finish
    reasons, usage-bearing final chunks, service tier, system fingerprint, and
    request metadata;
  - stores normalized input/output messages so
    `/v1/chat/completions/{completion_id}/messages` works for streamed records;
  - keeps storage opt-in: ordinary streamed Chat passthrough requests without
    `store:true` remain unpersisted.
- Added local server coverage for streaming stored Chat:
  - mock upstream streams two choices, text deltas, tool-call argument
    fragments, logprobs, usage, service tier, and system fingerprint;
  - the test verifies SSE passthrough, local retrieval, messages listing, and
    metadata-filtered list behavior.
- Added live `chat-stream-lifecycle` to `bridge-regression`; it streams through
  DeepSeek, retrieves the stored completion, updates metadata, lists messages,
  lists by metadata, deletes, and verifies 404 after deletion.
- Updated the compatibility matrix and evaluation plan to document streaming
  `store:true` support.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `scripts/eval-harness.mjs`, and `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm test`: 79/79 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-stream-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, elapsed 2960 ms, output `chat-stream-life-ok`, 85 SSE
    events, stored message count 2, and total usage 97 tokens.
  - Full live `bridge-regression` passed 30/30 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1663 ms, P95 latency 4565 ms, and total usage
    8569 tokens.
  - Direct streamed Chat passthrough probe returned HTTP 200, 47 SSE frames,
    `[DONE]`, output `direct-chat-stream-ok`, stored
    `object:"chat.completion"`, message count 2, total usage 58 tokens, and
    delete status 200.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq87y0wt`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 234 runtime candidates,
    selected 6 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.2 MB and output
    artifacts are 4.5 MB.

## 2026-06-10 Local Embeddings Endpoint

- Added local OpenAI-compatible `POST /v1/embeddings` coverage so clients,
  retrieval tests, and evaluation tooling can request embedding-shaped vectors
  even when the upstream provider only exposes Chat Completions.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createEmbedding` at `/v1/embeddings` creates an
    embedding vector representing input text and returns `object:"list"` with
    `object:"embedding"` data items, `index`, `model`, and prompt-token usage.
- Implemented a deterministic local adapter:
  - accepts single string input, arrays of strings/items, token id arrays, and
    arrays of token id arrays;
  - supports `dimensions` from 1 to 3072;
  - supports `encoding_format:"float"` and `encoding_format:"base64"`;
  - returns normalized hashed-semantic vectors using the same local feature
    space as the Vector Store hybrid search adapter;
  - returns OpenAI-style `object`, `data`, `model`, and `usage` fields plus a
    `compatibility` block that makes the local provider boundary explicit;
  - adds `CODEXCOMPAT_EMBEDDINGS_MODEL` and
    `CODEXCOMPAT_EMBEDDINGS_DIMENSIONS` configuration.
- Added local server tests for deterministic float vectors, batched inputs,
  base64 token inputs, parameter validation, and no upstream provider calls.
- Added live `embeddings-local` to `bridge-regression`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Tightened the live `chat-stream-lifecycle` eval request with
  `temperature:0` and `thinking:{type:"disabled"}` after one full-regression
  attempt showed DeepSeek could spend the entire Chat stream budget without
  ordinary content deltas when thinking mode was left implicit. The bridge
  behavior was not changed; the eval now tests protocol lifecycle rather than
  provider sampling variance.
- Verified:
  - `node --check` passed for `src/bridge/server.js`,
    `src/bridge/local_file_search.js`, `scripts/eval-harness.mjs`, and
    `test/server.test.js`.
  - `git diff --check`: passed.
  - `npm test`: 81/81 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `embeddings-local` passed 1/1, elapsed 47 ms, output
    `embeddings:2x32`, and local usage 14 prompt tokens.
  - Targeted live `chat-stream-lifecycle` passed 1/1 after eval hardening,
    elapsed 1438 ms, output `chat-stream-life-ok`, and total usage 19 tokens.
  - First full live `bridge-regression` attempt passed 30/31; only
    `chat-stream-lifecycle` failed because the model emitted no ordinary
    content deltas before hitting its output cap with implicit thinking mode.
  - Full live `bridge-regression` after eval hardening passed 31/31 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1600 ms, P95 latency
    3820 ms, and total usage 8490 tokens.
  - Direct `/v1/embeddings` float probe returned HTTP 200,
    `object:"list"`, two 24-dimensional vectors, model
    `text-embedding-3-small`, and usage 12 prompt tokens.
  - Direct `/v1/embeddings` base64 token probe returned HTTP 200,
    `object:"list"`, 12 dimensions encoded as 48 bytes, and usage 3 prompt
    tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq88bold`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 239 runtime candidates,
    selected 7 old UI screenshots by retention policy, deleted 0, and reported
    0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.3 MB and output
    artifacts are 4.6 MB.
- Remaining known gap: local `/v1/embeddings` is deterministic compatibility
  infrastructure, not a hosted/model-backed OpenAI embedding model. Future
  work should add provider-backed embeddings and ANN indexing while preserving
  this local fallback for no-key and disk-bounded tests.

## 2026-06-10 Local Batch API Compatibility

- Added local OpenAI-compatible Batch API coverage for JSONL workloads over the
  bridge's already implemented endpoints.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createBatch` at `/v1/batches` requires
    `input_file_id`, `endpoint`, and `completion_window`, supports endpoint
    values including `/v1/responses`, `/v1/chat/completions`,
    `/v1/embeddings`, and `/v1/completions`, and returns a `batch` object with
    `request_counts`, `output_file_id`, and `error_file_id`.
  - OpenAI Batch guide notes that completed output and error JSONL files are
    retrieved through the Files API and should be joined back to input lines
    via `custom_id` instead of line order.
- Implemented a local synchronous adapter:
  - `POST /v1/batches` validates `purpose:"batch"` Files and JSONL request
    lines;
  - supports `/v1/responses`, `/v1/chat/completions`, `/v1/completions`, and
    `/v1/embeddings`;
  - reuses the existing local endpoint handlers instead of duplicating
    protocol mapping logic;
  - writes successful request records to a local `purpose:"batch_output"`
    JSONL File and per-line failures to a local `purpose:"batch_error"` JSONL
    File;
  - marks the Batch explicitly `failed` if local output/error File creation
    fails, avoiding orphaned `in_progress` records;
  - implements `GET /v1/batches`, `GET /v1/batches/{batch_id}`, and
    `POST /v1/batches/{batch_id}/cancel`;
  - rejects `stream:true` and `background:true` per JSONL line because local
    synchronous Batch files cannot represent open streams or still-running
    background jobs;
  - adds `CODEXCOMPAT_BATCH_MAX_REQUESTS`, defaulting to 1000 for the test
    deployment's disk/quota safety.
- Added unit tests for:
  - Responses Batch execution with one successful output line and one rejected
    streaming line in the error file;
  - retrieve/list/cancel lifecycle shape;
  - local embeddings Batch execution without upstream provider calls.
- Added live `batch-embeddings-local` to `bridge-regression`, covering
  `/v1/files` input upload, `/v1/batches` create/retrieve/list/cancel, output
  JSONL retrieval through `/v1/files/{file_id}/content`, and cleanup.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 55/55 passing tests.
  - `npm test`: 83/83 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `batch-embeddings-local` passed 1/1, elapsed 145 ms, created
    a local `batch` with 2 completed requests, no error file, 2 output JSONL
    lines, retrieve/list/cancel all HTTP 200, and local usage 15 prompt tokens.
  - Full live `bridge-regression` passed 32/32 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1550 ms, P95 latency 3913 ms, and total usage
    8706 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq88xrvs`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 250 runtime candidates,
    selected 10 old UI screenshots by retention policy, deleted 0, and
    reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 42 GB available; bridge state is 1.4 MB and output
    artifacts are 4.8 MB.
- Remaining known gap: this is a local synchronous Batch compatibility layer,
  not OpenAI's distributed asynchronous 24h job service. Future work should add
  persisted async workers, restartable queues, larger disk-governed staging
  profiles, and Batch coverage for moderation/image/video endpoints as those
  local adapters are implemented.

## 2026-06-10 Local Moderations Compatibility

- Added local OpenAI-compatible Moderations API coverage for
  Chat-Completions-only provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI OpenAPI operation `createModeration` at `/v1/moderations`
    classifies text and/or image inputs and returns an object with `id`,
    `model`, and `results`.
  - Each result contains `flagged`, `categories`, `category_scores`, and, for
    current omni moderation responses, `category_applied_input_types`.
  - Current omni categories include harassment, harassment/threatening, sexual,
    hate, hate/threatening, illicit, illicit/violent, self-harm,
    self-harm/intent, self-harm/instructions, sexual/minors, violence, and
    violence/graphic.
- Implemented a local deterministic adapter:
  - `POST /v1/moderations` accepts a string, an array of strings, or a
    multimodal text/image content-part array;
  - returns `modr_` ids, OpenAI-style category booleans, category scores, and
    applied input-type metadata;
  - uses `CODEXCOMPAT_MODERATIONS_MODEL`, defaulting to
    `omni-moderation-latest`, when the request omits `model`;
  - adds the configured moderation model to local `/v1/models/{model}` fallback
    behavior when the upstream provider does not expose it;
  - explicitly marks the response as local deterministic compatibility
    metadata and does not call the upstream Chat provider;
  - extends local Batch execution to accept `/v1/moderations` JSONL requests
    alongside Responses, Chat, legacy Completions, and Embeddings.
- Added unit tests for:
  - direct local Moderations response shape, flagged/unflagged text categories,
    multimodal applied input types, and input validation;
  - local Batch execution over `/v1/moderations` without upstream provider
    calls;
  - model retrieval fallback for `omni-moderation-latest`.
- Added live `moderations-local` and `batch-moderations-local` to
  `bridge-regression`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 57/57 passing tests.
  - `npm test`: 85/85 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Direct local `/v1/moderations` probe returned HTTP 200, a `modr_` id, two
    results, and one flagged violence/threat result.
  - Targeted live `moderations-local` passed 1/1, elapsed 58 ms, output
    `moderations:2:flagged:1`.
  - Targeted live `batch-moderations-local` passed 1/1, elapsed 141 ms, created
    a local `batch` with 2 completed requests, no error file, 2 output JSONL
    lines, retrieve/list/cancel all HTTP 200, and zero provider token usage.
  - Full live `bridge-regression` passed 34/34 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 2075 ms, P95 latency 5653 ms, and total usage
    8559 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq89emsz`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 256 runtime candidates,
    selected 11 old UI screenshots by retention policy, deleted 0, selected
    625129 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 42 GB available; bridge state is 1.5 MB and output
    artifacts are 4.8 MB.
- Remaining known gap: this is deterministic local moderation compatibility,
  not OpenAI's hosted moderation classifier and not image-pixel inspection.
  Future work should add provider-backed or specialized moderation models,
  multilingual safety evals, image inspection, and larger safety benchmark
  suites while preserving the local no-upstream fallback.

## 2026-06-10 Inline Moderation Compatibility

- Added local inline moderation compatibility for Chat-Completions-only
  provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI Chat Completions `create` exposes a `moderation` request
    configuration for running moderation on request input and generated output.
  - OpenAI Responses `create` exposes a `moderation` request configuration for
    running moderation on the input and output of a response.
- Implemented local inline moderation fallback:
  - `/v1/responses` accepts `moderation:{input:true,output:true}` and attaches
    local results to `response.moderation.input` and/or
    `response.moderation.output` when the upstream Chat provider omits a native
    moderation payload;
  - `/v1/chat/completions` accepts the same field, strips it before upstream
    calls when provider-native Chat fields are disabled for DeepSeek-style
    compatibility, and attaches local `completion.moderation` results;
  - stored Chat completions preserve local inline moderation on retrieval;
  - streaming Responses attach local inline moderation to the terminal response
    event; direct streaming Chat passthrough remains byte-preserving and does
    not synthesize extra stream chunks;
  - upstream Chat `moderation` payloads are now preserved on translated
    Responses as `response.moderation` and
    `metadata.compatibility.chat_moderation`.
- Added unit tests for:
  - Responses inline moderation with provider field filtering;
  - streaming Responses terminal moderation metadata;
  - direct Chat Completions inline moderation with stored retrieval;
  - upstream Chat moderation preservation in the translator.
- Added live `responses-inline-moderation` to `bridge-regression`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 59/59 passing tests.
  - `node --test test/translator.test.js`: 25/25 passing tests.
  - `npm test`: 87/87 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Direct local `/v1/responses` inline moderation probe returned HTTP 200 and
    `response.moderation` with local input/output moderation results.
  - Targeted live `responses-inline-moderation` passed 1/1, elapsed 1630 ms,
    output `inline-moderation-ok`, and total usage 53 tokens.
  - Full live `bridge-regression` passed 35/35 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1777 ms, P95 latency 4525 ms, and total usage
    8644 tokens.
  - Public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Bridge, web, and app-server services were all active.
  - UI smoke passed with marker `ui-smoke-mq89v04j`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 261 runtime candidates,
    selected 12 old UI screenshots by retention policy, deleted 0, selected
    705534 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 41 GB available; bridge state is 1.6 MB and output
    artifacts are 4.9 MB.
- Remaining known gap: local inline moderation uses the same deterministic
  compatibility classifier as `/v1/moderations`; it is not OpenAI's hosted
  moderation model and direct streaming Chat passthrough remains byte-preserving
  instead of appending synthetic moderation events.

## 2026-06-10 Encrypted Reasoning Compatibility

- Added local Responses `include:["reasoning.encrypted_content"]`
  compatibility for Chat-Completions-only provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI migration guidance says stateless reasoning workflows should set
    `store:false`, add `["reasoning.encrypted_content"]` to `include`, pass
    encrypted reasoning items back in later requests, and have encrypted content
    decrypted only in memory for continuation.
- Implemented local encrypted reasoning emulation:
  - non-streaming `/v1/responses` adds `encrypted_content` to each output
    `reasoning` item when the request includes
    `reasoning.encrypted_content` and the upstream Chat provider returns
    `message.reasoning_content`;
  - streaming `/v1/responses` adds the same encrypted content before
    `response.output_item.done` and terminal `response.completed` events;
  - returned local reasoning tokens use prefix `ocrsn1.` with AES-256-GCM and a
    dedicated reasoning AAD, while reusing the existing
    `CODEXCOMPAT_COMPACTION_SECRET_FILE` key material kept outside Git;
  - replayed `reasoning` input items with local `encrypted_content` are decoded
    in memory into upstream Chat `reasoning_content`;
  - undecodable foreign encrypted reasoning falls back to visible
    `reasoning.summary[]` text when present;
  - `metadata.compatibility.local_reasoning_encrypted_content` records local
    emulation status and output count.
- Added unit tests for:
  - translator replay of local encrypted reasoning with summary fallback for
    foreign tokens;
  - non-streaming Responses encrypted reasoning output and stateless replay;
  - streaming Responses encrypted reasoning on `output_item.done` and terminal
    `response.completed`.
- Updated the compatibility matrix, deployment docs, and evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 61/61 passing tests.
  - `node --test test/translator.test.js`: 26/26 passing tests.
  - `npm test`: 90/90 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Direct live `/v1/responses` encrypted-reasoning probe returned
    `status:"completed"`, one reasoning item, one `ocrsn1.` encrypted content
    field, exact visible text `encrypted-reasoning-ok`, and local compatibility
    metadata with `output_count:1`.
  - Direct live stateless replay probe returned `ok:true`; both turns
    completed and the second turn returned exact visible text
    `encrypted-replay-ok` without printing the encrypted token.
  - Full live `bridge-regression` passed 35/35 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1447 ms, P95 latency 3724 ms, and total usage
    8710 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ac4qi`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 266 runtime candidates,
    selected 13 old UI screenshots by retention policy, deleted 0, selected
    789181 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.7 MB and output
    artifacts are 5.1 MB.
- Remaining known gap: this preserves provider-returned reasoning state for
  DeepSeek-style Chat compatibility; it cannot reconstruct hidden reasoning
  tokens when a Chat provider does not expose `reasoning_content`, and local
  encrypted reasoning tokens are only decryptable by this bridge/key.

## 2026-06-10 Prompt Template Compatibility

- Added local Responses `prompt` compatibility for Chat-Completions-only
  provider deployments.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` exposes `prompt` as a reference to a prompt
    template and its variables.
  - The same Responses create reference documents `instructions`, `input`, and
    other request context that may be combined with a prompt reference.
- Implemented local prompt-template handling:
  - official-shaped `prompt:{id,version,variables}` references are expanded
    when a matching local template is configured;
  - templates are keyed by `id` or `id@version` and can come from
    `CODEXCOMPAT_PROMPT_TEMPLATES` JSON or
    `CODEXCOMPAT_PROMPT_TEMPLATE_FILE`, with env JSON overriding duplicate file
    keys;
  - local templates support `instructions`, `messages`, `input`, `content`,
    and `text`, with `{{variable}}` substitution;
  - inline local templates are supported with `prompt.template` /
    `prompt.local_template` for deterministic local evals and migration
    fixtures;
  - when a hosted prompt reference cannot be expanded locally, the bridge
    injects a bounded compatibility system message that preserves prompt
    id/version/variable keys instead of silently dropping the field;
  - `metadata.compatibility.prompt_template` records whether the prompt was
    expanded locally or preserved as an unavailable hosted reference.
- Added tests for:
  - translator expansion of configured prompt templates before request
    instructions/input;
  - translator fallback for hosted prompt references with no local template;
  - server-level `/v1/responses` expansion into upstream Chat messages;
  - config loading from prompt-template file and env JSON.
- Added live `responses-prompt-template-local` to `bridge-regression`.
- Updated `.env.example`, the compatibility matrix, deployment docs, and the
  evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 63/63 passing tests.
  - `node --test test/translator.test.js`: 28/28 passing tests.
  - `npm test`: 94/94 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-prompt-template-local` passed 1/1, elapsed
    1903 ms, output `prompt-template-ok`, and total usage 74 tokens.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1308 ms, P95 latency 3289 ms, and total usage
    8756 tokens.
  - UI smoke passed with marker `ui-smoke-mq8an7w9`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 271 runtime candidates,
    selected 14 old UI screenshots by retention policy, deleted 0, selected
    874090 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.7 MB and output
    artifacts are 5.1 MB.
- Remaining known gap: the bridge cannot fetch OpenAI-hosted dashboard prompt
  templates by id; those references require a local template mirror or are
  preserved as compatibility context for the Chat provider.

## 2026-06-10 Web Search Action Sources Compatibility

- Added local Responses `include:["web_search_call.action.sources"]`
  compatibility for Chat-Completions-only providers.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` lists `web_search_call.action.sources` as a
    supported `include` value for exposing web-search tool-call sources.
- Implemented local source projection:
  - `prepareWebSearchContext` records whether the request explicitly asked for
    `web_search_call.action.sources`;
  - `webSearchOutputItems` now adds `action.sources` only when requested,
    preserving the default response projection otherwise;
  - search actions expose local URL sources with title, snippet, and source
    index;
  - local `open_page` and `find_in_page` actions expose the matching URL source
    plus bounded open/find status metadata;
  - `metadata.compatibility.local_web_search.action_sources` records local
    inclusion status and source count.
- Added tests for:
  - default local web-search output omitting `action.sources`;
  - non-streaming Responses output including local `action.sources` when
    requested;
  - streaming `response.output_item.added` events carrying sources when the
    include value is present.
- Updated live `responses-web-search` in `bridge-regression` to request and
  verify `web_search_call.action.sources`.
- Updated the compatibility matrix and evaluation plan.
- Verified:
  - `node --check src/bridge/web_search.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 64/64 passing tests.
  - `npm test`: 95/95 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-web-search` passed 1/1, elapsed 1784 ms, output
    `web-search-ok [1]`, and total usage 4040 tokens.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1257 ms, P95 latency 2805 ms, and total usage
    8655 tokens.
  - UI smoke passed with marker `ui-smoke-mq8aya7b`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 276 runtime candidates,
    selected 15 old UI screenshots by retention policy, deleted 0, selected
    959516 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 40 GB available; bridge state is 1.8 MB, output
    artifacts are 5.2 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.
- Remaining known gap: this exposes sources from the local web-search adapter;
  it is not OpenAI hosted web-search ranking or policy parity and still depends
  on the configured local provider.

## 2026-06-10 Local Responses Truncation Compatibility

- Added local Responses `truncation` compatibility before upstream Chat calls.
- Official source checked on 2026-06-10:
  - OpenAI Responses `create` documents `truncation:"auto"` as dropping items
    from the beginning of the conversation when input exceeds the model context
    window.
  - The same reference documents `truncation:"disabled"` as the default, where
    oversized input fails with a 400-style error instead of being truncated.
- Implemented local truncation handling:
  - added `CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS`, default `400000`, as the
    bridge's estimated input-character budget for Chat-only providers;
  - `truncation:"auto"` drops oldest `conversation` / `previous_response_id`
    replay messages first, preserving current request input and local tool
    context;
  - `metadata.compatibility.local_truncation` records the local budget, before
    and after estimates, dropped message count, dropped roles, and status;
  - omitted or `disabled` truncation returns `400 context_length_exceeded`
    before calling the provider when the local budget is exceeded;
  - the same preflight is applied to normal Responses, streaming Responses,
    background Responses, `/v1/responses/input_tokens`, and
    `/v1/responses/compact`.
- Added tests for:
  - `truncation:"auto"` dropping the oldest replay messages before upstream
    Chat while preserving current input;
  - omitted/disabled truncation returning `context_length_exceeded` before any
    provider request.
- Updated `.env.example`, deployment docs, the compatibility matrix, and the
  evaluation plan.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 66/66 passing tests.
  - `npm test`: 97/97 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Full live `bridge-regression` passed 36/36 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1273 ms, P95 latency 3475 ms, and total usage
    8640 tokens.
  - UI smoke passed with marker `ui-smoke-mq8bakz7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 281 runtime candidates,
    selected 16 old UI screenshots by retention policy, deleted 0, selected
    1044764 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 1.9 MB, output
    artifacts are 5.3 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.
- Remaining known gap: this uses a deterministic character estimate because
  Chat Completions providers do not expose the Responses service's exact
  tokenizer/context-window truncation behavior. Provider-specific tokenizers can
  replace the estimate later for closer parity.

## 2026-06-10 Stored Responses Metadata Update Compatibility

- Added local support for `POST /v1/responses/{response_id}`:
  - accepts only a JSON `metadata` object, matching the stored-object update
    surface already implemented for Chat Completions;
  - returns `404 response_not_found` for missing local response records;
  - returns `400 unsupported_response_update` when callers try to update fields
    other than `metadata` or pass non-object metadata;
  - preserves local `metadata.compatibility` and `metadata.upstream_object`
    observability fields when replacing user metadata.
- Added background-response metadata durability:
  - metadata updates applied while a local background response is still
    `in_progress` are merged into the final completed response after the
    upstream Chat Completions call returns;
  - final background records still preserve local compatibility flags such as
    `background` and `stream`.
- Official source checked on 2026-06-10:
  - OpenAI's OpenAPI endpoint list includes
    `/responses/{response_id}` alongside `/responses/{response_id}/cancel` and
    `/responses/{response_id}/input_items`.
- Added tests for:
  - successful stored Responses metadata update and subsequent GET persistence;
  - invalid non-metadata update rejection;
  - missing response update returning 404;
  - in-progress background response metadata update persisting into the
    completed response.
- Extended the live `bridge-regression` suite with `responses-lifecycle`,
  covering create, retrieve, update metadata, list input items, terminal cancel
  no-op, delete, and post-delete 404.
- Verified:
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 66/66 passing tests.
  - `npm test`: 97/97 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-lifecycle` passed 1/1, elapsed 2278 ms, returned
    update/input-items/cancel/delete statuses 200/200/200/200, post-delete GET
    404, and total usage 67 tokens.
  - Full live `bridge-regression` passed 37/37 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1617 ms, P95 latency 4206 ms, and total usage
    8828 tokens.
  - UI smoke passed with marker `ui-smoke-mq8bnefq`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 286 runtime candidates,
    selected 17 old UI screenshots by retention policy, deleted 0, selected
    1129626 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 39 GB available; bridge state is 2.0 MB, output
    artifacts are 5.4 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.

## 2026-06-10 Local Computer Use Compatibility

- Added a local Responses `computer` / `computer_use_preview` adapter for
  Chat-only providers:
  - reserves the hosted tool locally so it is not sent upstream as an
    unsupported Chat tool;
  - emits a screenshot-first `computer_call` output item with both GA
    `actions:[{type:"screenshot"}]` and preview-compatible
    `action:{type:"screenshot"}`;
  - preserves `call_id`, `environment`, display dimensions,
    `pending_safety_checks`, and `metadata.compatibility.local_computer`;
  - maps returned `computer_call_output` input items into readable Chat context
    including `call_id`, `output.type`, `output.image_url`, `detail`, text, and
    acknowledged safety-check count;
  - consumes the shared local `max_tool_calls` budget and records skipped
    computer actions in `metadata.compatibility.local_tool_budget`;
  - disables DeepSeek thinking mode by default for local computer-use requests
    so small-output compatibility probes get visible assistant text.
- Wired the adapter through non-streaming, streaming, and background Responses
  paths. Streaming now sends local `computer_call` items as
  `response.output_item.added` before upstream Chat text deltas.
- Extended tests and live evals:
  - translator tests cover local hosted-tool reservation for `computer` and
    `computer_call_output` input mapping;
  - server tests cover non-streaming `computer_call`, streaming `computer_call`,
    `max_tool_calls` exhaustion, metadata, and DeepSeek thinking compatibility;
  - live `bridge-regression` now includes `responses-computer`.
- Updated docs:
  - compatibility matrix references the official OpenAI Computer Use guide;
  - documented request/response mappings, config flags, eval commands, and the
    remaining boundary: this is an action-loop protocol adapter, not a
    browser/VNC executor or OpenAI hosted Computer Use.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js`: 30/30 passing tests.
  - `node --test test/server.test.js`: 69/69 passing tests.
  - `npm test`: 102/102 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all active. Public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/` after the service restart window.
  - Healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Targeted live `responses-computer` passed 1/1, elapsed 1788 ms, returned
    `computer-ok`, and used 170 total tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1748 ms, P95 latency 4157 ms, and total usage
    8876 tokens.
  - UI smoke passed with marker `ui-smoke-mq8c6giz`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 291 runtime candidates,
    selected 18 old UI screenshots by retention policy, deleted 0, selected
    1214456 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 38 GB available; bridge state is 2.0 MB, output
    artifacts are 5.5 MB, and `/srv/aialra/data/opencodexapp` is 48 KB.

## 2026-06-10 Restartable Background Provider Calls

- Added file-backed local background job snapshots for `background:true`
  Responses:
  - newly created background responses now store `background_job.stage:"queued"`
    with the normalized request, Chat request, compatibility metadata,
    previous-message snapshot, and conversation snapshot;
  - after local input-file/tool/context preparation succeeds, the job snapshot
    advances to `stage:"provider_pending"` and stores the final upstream Chat
    request plus local output items that must be prepended to the completed
    Responses output;
  - final completed/failed/cancelled terminal records remove
    `background_job`, keeping state bounded and avoiding accidental replays.
- Added restart recovery:
  - bridge startup now resumes `provider_pending` snapshots by retrying the
    upstream Chat provider call and preserving local output items;
  - `queued` snapshots can restart the full local preparation path;
  - missing snapshots, unknown stages, or `preparing` snapshots fail closed with
    `background_job_interrupted_by_restart` and
    `metadata.compatibility.background_restart_reason` so side-effecting local
    tools are not re-run after an unsafe interruption.
- Fixed a compatibility metadata merge footgun by changing
  `mergeCompatibility` to accept any number of object parts. This preserves
  background resume metadata and extra local moderation compatibility entries
  in paths that already passed more than three merge inputs.
- Added server tests for:
  - stale in-progress background records without a persistent job snapshot
    still reconciling to explicit failed terminal responses;
  - `provider_pending` background records being resumed on startup, completing
    through the mock provider, preserving prepended local output items, and
    clearing `background_job` from the final store record;
  - corrupt resumable snapshots with invalid `max_tool_calls` failing closed
    during startup without crashing the bridge or calling the provider.
- Official source checked on 2026-06-10:
  - OpenAI's Responses migration guide describes background mode as a Responses
    capability with `in_progress` to terminal-state polling semantics; this
    bridge emulates that lifecycle locally for Chat-only providers.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 71/71 passing tests.
  - `npm test`: 104/104 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1259 ms, P95
    latency 1423 ms, and total usage 160 tokens.
  - Targeted live `responses-background` passed 1/1 after the final deploy,
    elapsed 2109 ms, status history `in_progress`, `in_progress`,
    `completed`, and total usage 56 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1315 ms, P95 latency 3344 ms, and total usage
    8899 tokens.
  - UI smoke passed with marker `ui-smoke-bgresume-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 303 runtime candidates,
    selected 20 old UI screenshots by retention policy, deleted 0, selected
    1383964 bytes, and reported 0 errors.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 38 GB available; repository checkout is 38 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Background Preparation Checkpoints

- Added resumable checkpoints inside local `background:true` preparation:
  - the background job now records `prepare.status`, `current_step`,
    `next_step`, completed steps, mutated upstream Chat request, compatibility
    metadata, local context snapshots, and the shared local `max_tool_calls`
    budget after each safe step boundary;
  - completed local contexts are reused to build final Responses output items
    after restart, so already-finished shell/computer/web/file-search work is
    not repeated;
  - startup resumes `stage:"preparing"` snapshots only when
    `prepare.status:"ready"` points to a safe next step, and marks
    `metadata.compatibility.background_restart:"resumed_preparation"`;
  - snapshots interrupted while a local preparation step is actively
    `running` still fail closed with
    `background_restart_reason:"interrupted_during_local_preparation_<step>"`
    to avoid re-running side-effecting local tools such as shell commands.
- Hardened persisted local tool budgets:
  - resume now validates persisted `used`, `skipped`, and bounded
    `skipped_calls` before continuing;
  - corrupt persisted budgets reconcile to explicit failed terminal responses
    without crashing bridge startup or calling the upstream provider.
- Added server tests for:
  - resuming from a ready preparation checkpoint after a persisted shell step
    and continuing with a local computer step;
  - preserving exactly one persisted shell call/output plus the new computer
    call in the final Responses output;
  - failing `running` preparation snapshots closed without calling the
    provider.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 73/73 passing tests.
  - `npm test`: 106/106 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-background` passed 1/1 after the final deploy,
    elapsed 2090 ms, status history `in_progress`, `in_progress`, `completed`,
    and total usage 39 tokens.
  - One full live `bridge-regression` attempt passed 37/38 because
    `chat-passthrough` returned HTTP 200 with empty visible text; targeted
    `chat-passthrough` rerun then passed 1/1, indicating provider output
    nondeterminism rather than bridge failure.
  - Final full live `bridge-regression` passed 38/38 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1545 ms, P95 latency
    4025 ms, and total usage 8911 tokens.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1604 ms, P95
    latency 1670 ms, and total usage 154 tokens.
  - UI smoke passed with marker `ui-smoke-bgprep-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 319 runtime candidates,
    selected 22 old UI screenshots by retention policy, deleted 0, selected
    1553681 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps` and `/srv/aialra/data` are on a
    193 GB filesystem with 37 GB available; repository checkout is 38 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Background Lease Ownership

- Added persistent lease ownership for local `background:true` jobs:
  - each bridge process gets a runtime `backgroundLeaseOwner`;
  - newly created background job snapshots store `background_job.lease` with
    owner, random token, acquisition/renewal timestamps, and expiry;
  - preparation checkpoints and `provider_pending` transitions renew the lease
    while the owning process advances the job.
- Hardened startup recovery for multi-process/restart races:
  - before resuming or reconciling an in-progress background response, startup
    acquires a short-lived per-response claim lock next to the response JSON;
  - startup skips records with an unexpired lease owned by another bridge
    process instead of calling the provider or marking the response failed;
  - expired or missing leases can be claimed, re-read, and verified by token
    before safe resume/reconcile behavior continues.
- Added server tests for:
  - skipping an active foreign lease without touching response metadata or
    calling the upstream provider;
  - claiming an expired lease, exposing the new owner in the store while the
    resumed provider call is pending, then completing and clearing
    `background_job`;
  - preserving prior provider-pending and preparation-checkpoint resume
    behavior.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 75/75 passing tests.
  - `npm test`: 108/108 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `responses-background` passed 1/1 after the deploy, elapsed
    2072 ms, status history `in_progress`, `in_progress`, `completed`, and
    total usage 49 tokens.
  - `protocol-smoke` passed 2/2, pass rate 1.0, average latency 1701 ms, P95
    latency 1744 ms, and total usage 188 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1314 ms, P95 latency 3606 ms, and total usage
    8793 tokens.
  - UI smoke passed with marker `ui-smoke-bgleases-final-20260610`, reload
    persistence confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 325 runtime candidates,
    selected 23 old UI screenshots by retention policy, deleted 0, selected
    1638231 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 38 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 11 MB.

## 2026-06-10 Chat Audio Output Mapping

- Checked current official OpenAI docs through the OpenAI developer-docs MCP:
  Chat Completions exposes audio-capable output through `modalities` plus the
  `audio` request parameter, while the OpenAI audio guide treats audio output as
  an audio-capable Chat provider feature rather than something a text-only
  provider can synthesize.
- Added Chat-to-Responses preservation for audio-capable Chat providers:
  - non-streaming `choices[].message.audio` is normalized into a
    `type:"output_audio"` message content part;
  - known scalar audio fields `data`, `transcript`, `id`, `expires_at`,
    `format`, and `voice` are exposed directly on that content part;
  - provider-specific audio fields are preserved under `content[].audio`;
  - the original Chat audio object is also copied to
    `metadata.compatibility.chat_audio[]` and the local replay store.
- Added streaming `choices[].delta.audio` handling:
  - string `data` and `transcript` fragments are accumulated across chunks;
  - other audio fields are merged with the latest provider value;
  - the final terminal Responses object carries the accumulated
    `output_audio` part plus `metadata.compatibility.chat_audio[]`;
  - `previous_response_id` replay preserves the original assistant `audio`
    object for later Chat requests.
- Added tests for:
  - translator mapping of Chat audio output into Responses message content,
    compatibility metadata, usage audio-token preservation, and replay;
  - mock `/v1/responses` forwarding of `modalities`/`audio`, Chat audio output
    mapping, and previous-response replay of assistant audio;
  - streaming `delta.audio` accumulation alongside text, annotations,
    logprobs, usage, and terminal Responses events.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document audio-object preservation and the remaining text-only-provider
  boundary for DeepSeek.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 107/107 passing
    tests.
  - `npm test`: 110/110 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1470 ms, P95 latency 1475 ms, and total usage 160 tokens.
  - Full live `bridge-regression` passed 38/38 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1391 ms, P95 latency 4011 ms, and total usage
    8959 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ej041`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 330 runtime candidates,
    selected 24 old UI screenshots by retention policy, deleted 0, selected
    1722307 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 39 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Batch Chat and Legacy Completions Coverage

- Checked the current official OpenAI Batch guide through the OpenAI
  developer-docs MCP. The guide lists `/v1/responses`,
  `/v1/chat/completions`, `/v1/embeddings`, `/v1/completions`, and
  `/v1/moderations` among JSONL Batch endpoints, with each line carrying
  `custom_id`, `method`, `url`, and endpoint-specific `body`.
- Promoted existing local Batch support for Chat and legacy Completions from
  implicit code path to tested compatibility surface:
  - added live `bridge-regression` cases for `/v1/chat/completions` Batch and
    `/v1/completions` Batch;
  - added mock-provider server coverage that executes a Chat batch with one
    success and one rejected `stream:true` line, then executes a legacy
    Completions batch and verifies the returned `text_completion` output file;
  - extended eval usage aggregation so Batch output from Responses, Chat, and
    legacy Completions contributes token usage instead of falling back to
    zero-use moderation accounting.
- Fixed a real local Batch capture bug found by the new tests:
  - direct Chat passthrough writes `Uint8Array` chunks from Node `fetch`;
  - the internal Batch capture response previously treated non-`Buffer` chunks
    as strings, corrupting JSON output into comma-separated byte values;
  - `makeCaptureResponse.write()` now preserves any `ArrayBuffer` view as
    binary bytes before parsing the captured JSON body.
- Improved audit fidelity by preserving upstream `x-request-id` headers through
  `proxyResponseHeaders()`, so Batch output lines use provider request ids when
  available and only generate local `req_*` ids as a fallback.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` with the
  Batch Chat/Completions coverage and request-id preservation behavior.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 77/77 passing tests.
  - `npm test`: 111/111 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Targeted live `batch-chat-completions` passed 1/1 against
    `deepseek-v4-pro`, elapsed 3306 ms, request counts 2 completed / 0 failed,
    and total usage 120 tokens.
  - Targeted live `batch-completions-legacy` passed 1/1 against
    `deepseek-v4-pro`, elapsed 1632 ms, request counts 1 completed / 0 failed,
    and total usage 55 tokens.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1860 ms, P95 latency 2127 ms, and total usage 174 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1362 ms, P95 latency 2965 ms, and total usage
    9025 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ewppe`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 339 runtime candidates,
    selected 25 old UI screenshots by retention policy, deleted 0, selected
    1807049 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 39 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Chat Audio Input Mapping

- Checked the current official OpenAI audio guidance through the OpenAI
  developer-docs MCP. Chat audio input uses a user-message content part shaped
  as `type:"input_audio"` with `input_audio:{data,format}`. Responses docs
  still frame audio through provider/model support, so this bridge treats audio
  input as an audio-capable Chat provider compatibility surface rather than a
  feature that DeepSeek text models can understand locally.
- Added Responses-to-Chat audio input normalization:
  - user `input_audio` and compatible `audio` content parts now become Chat
    `input_audio` content parts when inline audio bytes are present;
  - canonical `input_audio.data`, plus compatible top-level `data`,
    `audio_data`, and `file_data`, are accepted and string-normalized;
  - `format` and provider-specific extra audio fields are preserved under
    `input_audio`;
  - non-user or non-forwardable audio parts become explicit text markers with
    any available transcript so replay context remains visible without breaking
    Chat message schemas.
- Added tests for:
  - translator mapping of mixed text, image, and audio Responses input content
    into Chat content parts;
  - assistant/non-user audio fallback text for replay-safe Chat messages;
  - mock `/v1/responses` forwarding that proves upstream Chat receives
    `messages[].content[]` with `text` plus `input_audio`, alongside
    `modalities` and `audio` when supported.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document audio input mapping, audio-capable provider expectations, and the
  remaining text-only-provider boundary for DeepSeek.
- Verified:
  - `node --check src/bridge/translator.js test/translator.test.js test/server.test.js`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 110/110 passing
    tests.
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `npm test`: 113/113 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1507 ms, P95 latency 1651 ms, and total usage 150 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1410 ms, P95 latency 2824 ms, and total usage
    9176 tokens.
  - UI smoke passed with marker `ui-smoke-mq8f7o87`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 346 runtime candidates,
    selected 26 old UI screenshots by retention policy, deleted 0, selected
    1891646 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 38 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Image Detail Content-Part Mapping

- Checked the current official OpenAI Images and Vision guide through the
  OpenAI developer-docs MCP. The guide states that image inputs can be provided
  as URLs, base64 data URLs, or Files API file IDs, and that the `detail`
  parameter has the same meaning for Responses and Chat Completions.
- Tightened Responses-to-Chat image input normalization:
  - user `input_image` parts now normalize through a dedicated image helper;
  - `image_url` strings and `image_url:{url,detail}` objects both map to Chat
    `type:"image_url"` content parts;
  - top-level Responses `detail` is preserved under Chat `image_url.detail`;
  - compatible inline `file_data`, `data`, or `image_data` payloads are turned
    into `data:<media_type>;base64,...` URLs for vision-capable Chat providers;
  - non-user or non-forwardable image parts continue to become explicit text
    markers without accidentally stringifying a malformed `image_url` object.
- Added tests for:
  - translator mapping of `input_image.detail` and existing data URLs;
  - translator conversion of inline base64 image payloads into Chat data URLs;
  - mock `/v1/responses` forwarding that proves upstream Chat receives
    `messages[].content[]` with `image_url.detail`.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document image detail/data-URL coverage and the remaining `file_id` image
  resolver gap.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/translator.test.js test/server.test.js`: 112/112 passing
    tests.
  - `npm test`: 115/115 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1553 ms, P95 latency 1702 ms, and total usage 186 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1317 ms, P95 latency 2935 ms, and total usage
    9021 tokens.
  - UI smoke passed with marker `ui-smoke-mq8fkhyo`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 353 runtime candidates,
    selected 27 old UI screenshots by retention policy, deleted 0, selected
    1976924 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 42 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Local Image File ID Adapter

- Checked current official OpenAI Images and Vision guidance through the
  OpenAI developer-docs MCP. The guide documents image inputs by URL, base64
  data URL, and Files API `file_id`; Chat image inputs use URL/data URL content
  parts, so local `file_id` images can be bridged by resolving bytes to data
  URLs before the upstream Chat request.
- Added a local `input_image.file_id` compatibility adapter:
  - resolves local Files API image records before `responsesToChatRequest()`
    for `/v1/responses`, `/v1/responses/input_tokens`, and
    `/v1/responses/compact`;
  - converts bounded local image bytes into `data:<media_type>;base64,...`
    Chat `image_url.url` values while preserving `detail`;
  - supports configured caps through `CODEXCOMPAT_INPUT_IMAGE_PROVIDER`,
    `CODEXCOMPAT_INPUT_IMAGE_MAX_IMAGES`, and
    `CODEXCOMPAT_INPUT_IMAGE_MAX_BYTES`;
  - records `metadata.compatibility.local_input_images` with file id,
    filename, media type, byte count, status, and errors only, never the base64
    image payload.
- Added mock-provider server coverage that creates a local `purpose:"vision"`
  File, sends it as Responses `input_image.file_id`, proves the upstream Chat
  request receives a PNG data URL plus `detail`, and verifies compatibility
  metadata does not echo the data URL.
- Updated `docs/compatibility-matrix.md` and `docs/evaluation-plan.md` to
  document local image file ID resolution and its text-only-provider boundary.
- Verified:
  - `node --check src/bridge/server.js src/bridge/translator.js src/bridge/input_images.js src/bridge/local_computer.js scripts/eval-harness.mjs test/server.test.js test/translator.test.js`: passed.
  - `git diff --check`: passed.
  - `node --test test/server.test.js`: 80/80 passing tests.
  - `npm test`: 116/116 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`. Public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1688 ms, P95 latency 1793 ms, and total usage 188 tokens.
  - Full live `bridge-regression` passed 40/40 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1298 ms, P95 latency 2969 ms, and total usage
    9054 tokens.
  - UI smoke passed with marker `ui-smoke-mq8fvrn7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 360 runtime candidates,
    selected 28 old UI screenshots by retention policy, deleted 0, selected
    2062112 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 41 GB available;
    repository checkout is 40 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Reasoning None DeepSeek Adapter

- Re-checked official API behavior before changing code:
  - the current OpenAI Chat Completions OpenAPI/docs surface accepts
    reasoning effort values including `none`, `minimal`, `low`, `medium`,
    `high`, and `xhigh`;
  - current DeepSeek Chat Completion and Thinking Mode docs only accept
    `reasoning_effort:"high"` / `"max"` and document compatibility mappings
    for `low`/`medium` to `high` and `xhigh` to `max`.
- Fixed the Responses-to-Chat translator so `reasoning:{effort:"none"}` with
  DeepSeek effort compatibility no longer forwards unsupported
  `reasoning_effort:"none"`. The bridge now sends
  `thinking:{type:"disabled"}` and records:
  - `metadata.compatibility.deepseek_thinking =
    "disabled_for_reasoning_none"`;
  - `metadata.compatibility.reasoning_effort` with source, target, original
    value, mapped value `null`, `forwarded:false`, and reason
    `deepseek_thinking_disabled`.
- Added translator and server mock-provider coverage proving the upstream Chat
  request omits `reasoning_effort`, sends DeepSeek non-thinking mode, and
  returns the compatibility metadata.
- Added a live `bridge-regression` case `responses-reasoning-none` so future
  DeepSeek evals continuously check this mapping.
- Tightened the `responses-computer` live eval to assert the screenshot-first
  `computer_call` protocol item and local metadata instead of requiring a
  model text marker before any `computer_call_output` evidence exists.
- Verification:
  - `node --check src/bridge/translator.js scripts/eval-harness.mjs test/translator.test.js test/server.test.js`: passed.
  - `node --test test/translator.test.js`: 34/34 passing tests.
  - `node --test test/server.test.js`: 81/81 passing tests.
  - `npm test`: 118/118 passing tests.
  - Pre-restart live control check for `responses-reasoning-none` failed 0/1
    with DeepSeek HTTP 400 because the old running service still sent
    `reasoning_effort:"none"`; after restarting the bridge with this patch, the
    same case passed 1/1, latency 1827 ms, total usage 18 tokens.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1629 ms, P95 latency 1814 ms, and total usage 166 tokens.
  - Targeted `responses-computer` live eval passed 1/1 after the protocol-level
    assertion fix, latency 2450 ms, total usage 252 tokens.
  - Full live `bridge-regression` passed 41/41 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1328 ms, P95 latency 3149 ms, and total usage
    9200 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ga8a0`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - Service state: bridge, web, and app-server services were all `active`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 41 GB available;
    repository checkout is 41 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Code Interpreter Call Output Shape

- Updated the local `code_interpreter` compatibility path so Chat-only
  providers now receive the same injected command evidence, while Responses
  clients receive a `code_interpreter_call` output item instead of shell-shaped
  `shell_call` / `shell_call_output` items.
- Implemented `include:["code_interpreter_call.outputs"]` for the local
  adapter. When requested, stdout/stderr logs are attached to
  `code_interpreter_call.outputs` and the request is recorded in
  `metadata.compatibility.local_shell.include_code_interpreter_outputs`.
- Fixed `/mnt/data` path rewriting for Python code blocks: bare shell paths
  still use shell quoting, while paths inside quoted code strings are rewritten
  as escaped string content. This prevents Python snippets such as
  `Path('/mnt/data/file.txt')` from becoming invalid after local workspace
  substitution.
- Added mock-provider server coverage for local `code_interpreter`:
  - the upstream Chat request omits unsupported hosted tools;
  - DeepSeek thinking mode is disabled for the local tool adapter;
  - the response output starts with `code_interpreter_call`;
  - nested `outputs` logs include the executed marker;
  - nested `outputs` are omitted when the include value is not requested;
  - no shell-shaped output items are emitted for `code_interpreter`;
  - generated files are readable through the local Containers file endpoints.
- Added live `bridge-regression` case `responses-code-interpreter`, which
  writes `/mnt/data/shell.txt`, checks `code_interpreter_call.outputs`, verifies
  the container artifact, and asserts the final DeepSeek text marker.
- Updated the compatibility matrix and parity plan to document the
  `code_interpreter_call.outputs` include mapping and the remaining hosted
  runtime boundary.
- Verification:
  - `node --check src/bridge/local_shell.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 82/82 passing tests.
  - `npm test`: 119/119 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-code-interpreter` passed 1/1 against
    `deepseek-v4-pro`, latency 1906 ms, total usage 370 tokens, and artifact
    text `code-interpreter-ok`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 2208 ms, P95 latency 2495 ms, and total usage 197 tokens.
  - Full live `bridge-regression` passed 42/42 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1939 ms, P95 latency 3907 ms, and total usage
    9779 tokens.
  - UI smoke passed with marker `ui-smoke-mq8gooux`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 380 runtime candidates,
    selected 30 old UI screenshots by retention policy, deleted 0, selected
    2234352 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 41 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Input Image URL Include Projection

- Re-checked the current OpenAI Responses and Conversations reference through
  the official OpenAI developer docs MCP. The supported `include` values list
  includes `message.input_image.image_url`, defined as including image URLs from
  input messages.
- Added local input-item projection for
  `include:["message.input_image.image_url"]`:
  - `GET /v1/responses/{response_id}/input_items` hides stored input image
    URLs by default and returns them only when the include value is requested;
  - `GET /v1/conversations/{conversation_id}/items` applies the same projection
    to list results;
  - `GET /v1/conversations/{conversation_id}/items/{item_id}` applies the same
    projection to single-item retrieval.
- Kept the full stored item available internally for replay while redacting
  `image_url` / `url` fields only at API read time, so conversation replay and
  previous-response state continue to see the original request content.
- The include parser accepts `include=...`, repeated `include`, comma-separated
  include values, and `include[]=...` query forms.
- Added mock-provider server coverage proving:
  - upstream Chat image content still receives the original image URL/detail;
  - stored Responses input items hide image URLs by default and expose them with
    `include[]=message.input_image.image_url`;
  - local Conversations list and item-get paths hide image URLs by default and
    expose them with the include parameter;
  - the Conversations include projection is local and does not call upstream.
- Added live `bridge-regression` case `conversation-image-include` to exercise
  the deployed local Conversations projection without depending on multimodal
  DeepSeek support.
- Updated compatibility and evaluation docs to record the include mapping,
  default redaction behavior, and parity gate.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 84/84 passing tests.
  - `npm test`: 121/121 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `conversation-image-include` passed 1/1, latency 143 ms, no
    upstream token usage, and all hidden/included item endpoints returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1938 ms, P95 latency 2071 ms, and total usage 154 tokens.
  - Full live `bridge-regression` passed 43/43 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1484 ms, P95 latency 3356 ms, and total usage
    9522 tokens.
  - UI smoke passed with marker `ui-smoke-mq8h3wz1`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 387 runtime candidates,
    selected 31 old UI screenshots by retention policy, deleted 0, selected
    2320784 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 40 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 12 MB.

## 2026-06-10 Computer Output Image URL Include Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `computer_call_output.output.image_url`, alongside the existing input-image
  include projection work.
- Added local input-item projection for
  `include:["computer_call_output.output.image_url"]`:
  - `GET /v1/responses/{response_id}/input_items` hides stored
    `computer_call_output.output.image_url` values by default and returns them
    only when the include value is requested;
  - `GET /v1/conversations/{conversation_id}/items` applies the same projection
    to list results;
  - `GET /v1/conversations/{conversation_id}/items/{item_id}` applies the same
    projection to single-item retrieval.
- Preserved the full stored item internally for previous-response and
  Conversation replay. The bridge only redacts `output.image_url` / `output.url`
  at API read time and keeps `detail` visible so clients can inspect image
  fidelity without the URL unless they explicitly opt in.
- Kept create-request compatibility behavior intact: returned
  `computer_call_output` input items still translate to Chat-visible evidence,
  and create requests that include this field continue recording
  `metadata.compatibility.local_computer.include_output_image_url`.
- Added mock-provider server coverage proving:
  - upstream Chat context still receives the original computer output image URL
    and `call_id`;
  - stored Responses input items hide `output.image_url` by default and expose it
    with `include=computer_call_output.output.image_url`;
  - local Conversations list and item-get paths hide the URL by default and
    expose it with the include parameter.
- Added live `bridge-regression` case `conversation-computer-output-include` so
  deployed local Conversations projection is exercised without upstream model
  spend.
- Updated compatibility and evaluation docs to record the include mapping,
  default redaction behavior, and parity gate.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `conversation-computer-output-include` passed 1/1, latency
    101 ms, no upstream token usage, and all hidden/included item endpoints
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 2012 ms, P95 latency 2057 ms, and total usage 155 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1507 ms, P95 latency 3072 ms, and total usage
    9621 tokens.
  - UI smoke passed with marker `ui-smoke-mq8hfrp2`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 394 runtime candidates,
    selected 32 old UI screenshots by retention policy, deleted 0, selected
    2407005 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Output Text Logprobs Stored-Response Projection

- Re-checked the current OpenAI Responses create reference through the official
  OpenAI developer docs MCP. The supported `include` values list includes
  `message.output_text.logprobs`, defined as including logprobs with assistant
  messages.
- Extended output-text logprobs handling from create-time preservation to
  stored-response projection:
  - Chat `choices[].logprobs.content[]` remains mapped onto Responses
    `message.content[].logprobs` when requested;
  - stored Responses keep output-text token logprobs internally when the Chat
    provider returns them;
  - create responses hide `message.output_text.logprobs` unless the request
    includes `include:["message.output_text.logprobs"]`;
  - `GET /v1/responses/{response_id}` hides output-text logprobs by default;
  - `GET /v1/responses/{response_id}?include[]=message.output_text.logprobs`
    returns the stored token logprob arrays.
- Updated the live `responses-logprobs` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Secret handling: no provider API key or credential value was written to the
  repository; the verification path used the existing systemd environment.
- Verification:
  - `node --check src/bridge/server.js && node --check scripts/eval-harness.mjs && node --check test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-logprobs` passed 1/1 against `deepseek-v4-pro`,
    latency 1840 ms, total usage 69 tokens, visible text `logprobs-ok`, and
    both hidden/included stored-response retrieves returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1259 ms, P95 latency 1287 ms, and total usage 161 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1183 ms, P95 latency 2454 ms, and total usage
    9693 tokens.
  - UI smoke passed with marker `ui-smoke-mq8iski1`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 422 runtime candidates,
    selected 36 old UI screenshots by retention policy, deleted 0, selected
    2751773 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 44 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Web Search Action Sources Stored-Response Projection

- Re-checked the current OpenAI Responses create reference through the official
  OpenAI developer docs MCP. The supported `include` values list includes
  `web_search_call.action.sources`, defined as exposing sources for the web
  search tool call.
- Extended the local web-search adapter from create-time source inclusion to
  stored-response projection:
  - local web-search `action.sources` are stored internally on
    `web_search_call` output items for `store:true` responses;
  - create responses hide `web_search_call.action.sources` unless the request
    includes `include:["web_search_call.action.sources"]`;
  - `GET /v1/responses/{response_id}` hides web-search action sources by
    default;
  - `GET /v1/responses/{response_id}?include[]=web_search_call.action.sources`
    returns the stored sources.
- Kept final text citation annotations unchanged: `url_citation` annotations
  remain visible on generated output text, while nested `action.sources` are
  controlled by the include projection.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  web-search sources with the include query.
- Updated background local-output preparation so background responses also keep
  full internal web-search sources before retrieve-time projection.
- Updated the live `responses-web-search` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Secret handling: no provider API key or credential value was written to the
  repository; the verification path used the existing systemd environment.
- Verification:
  - `node --check src/bridge/server.js && node --check scripts/eval-harness.mjs && node --check test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-web-search` passed 1/1 against
    `deepseek-v4-pro`, latency 1785 ms, total usage 4040 tokens, visible text
    `web-search-ok [1].`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1216 ms, P95 latency 1473 ms, and total usage 179 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1156 ms, P95 latency 2748 ms, and total usage
    9615 tokens.
  - UI smoke passed with marker `ui-smoke-mq8ij8w8`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 415 runtime candidates,
    selected 35 old UI screenshots by retention policy, deleted 0, selected
    2665509 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 38 GB available;
    repository checkout is 43 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 File Search Results Stored-Response Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `file_search_call.results`, defined as exposing search results from the file
  search tool call.
- Extended the local file-search adapter from create-time result inclusion to
  stored-response projection:
  - local file-search result arrays are kept internally on the response output
    item for `store:true` responses;
  - create responses hide `file_search_call.results` unless the request includes
    `include:["file_search_call.results"]`;
  - `GET /v1/responses/{response_id}` hides file-search results by default;
  - `GET /v1/responses/{response_id}?include[]=file_search_call.results`
    returns the stored result details.
- Kept final text citation annotations unchanged: `file_citation` annotations
  remain visible on generated output text, while the detailed result array is
  controlled by the include projection.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  file-search results with the include query.
- Updated the live `responses-file-search` regression case to create a stored
  response, verify immediate include output, verify default retrieve redaction,
  verify include retrieve recovery, and delete the stored response after the
  case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Verification:
  - `node --check src/bridge/server.js src/bridge/local_file_search.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-file-search` passed 1/1 against
    `deepseek-v4-pro`, latency 1329 ms, total usage 222 tokens, visible text
    `file-search-ok [1]`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1153 ms, P95 latency 1219 ms, and total usage 158 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1428 ms, P95 latency 3118 ms, and total usage
    9476 tokens.
  - UI smoke passed with marker `ui-smoke-mq8i1yvb`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 408 runtime candidates,
    selected 34 old UI screenshots by retention policy, deleted 0, selected
    2579476 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 43 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Code Interpreter Outputs Stored-Response Projection

- Re-checked the current OpenAI Responses reference through the official OpenAI
  developer docs MCP. The supported `include` values list includes
  `code_interpreter_call.outputs`, defined as exposing outputs of Python code
  execution in code-interpreter tool-call items.
- Extended the local code-interpreter adapter from create-time output inclusion
  to stored-response projection:
  - local code-interpreter stdout/stderr logs are stored internally on the
    response output item for `store:true` responses;
  - create responses still hide nested `code_interpreter_call.outputs` unless
    the request includes `include:["code_interpreter_call.outputs"]`;
  - `GET /v1/responses/{response_id}` hides nested outputs by default;
  - `GET /v1/responses/{response_id}?include[]=code_interpreter_call.outputs`
    returns the stored nested logs.
- Kept Conversation append behavior aligned with the public response projection
  so hidden code-interpreter logs are not copied into Conversation items unless
  the originating public response included them.
- Preserved streaming terminal response behavior for clients while storing a
  full internal response after completion so later retrieve calls can project
  code-interpreter outputs with the include query.
- Updated the live `responses-code-interpreter` regression case to create a
  stored response, verify immediate include output, verify default retrieve
  redaction, verify include retrieve recovery, and delete the stored response
  after the case to control runtime state growth.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior.
- Verification:
  - `node --check src/bridge/server.js src/bridge/local_shell.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-code-interpreter` passed 1/1 against
    `deepseek-v4-pro`, latency 1831 ms, total usage 372 tokens, artifact text
    `code-interpreter-ok`, and both hidden/included stored-response retrieves
    returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1697 ms, P95 latency 1701 ms, and total usage 158 tokens.
  - Full live `bridge-regression` passed 44/44 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1744 ms, P95 latency 4226 ms, and total usage
    9638 tokens.
  - UI smoke passed with marker `ui-smoke-mq8hsn1f`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 401 runtime candidates,
    selected 33 old UI screenshots by retention policy, deleted 0, selected
    2493382 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 39 GB available;
    repository checkout is 42 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.

## 2026-06-10 Reasoning Encrypted Content Stored-Response Projection

- Re-checked the current OpenAI deployment checklist through the official
  OpenAI developer docs MCP. The `reasoning.encrypted_content` guidance says to
  add the value to `include`, round-trip the returned reasoning item exactly as
  returned, and pass it back on later requests as a stateless handoff.
- Extended local encrypted reasoning compatibility from create-time projection
  to stored-response projection:
  - local reasoning text returned by Chat providers is encrypted with the local
    `ocrsn1.` payload format and retained internally for stored Responses;
  - create responses return `reasoning.encrypted_content` only when the request
    includes `include:["reasoning.encrypted_content"]`;
  - `GET /v1/responses/{response_id}` hides encrypted reasoning content by
    default;
  - `GET /v1/responses/{response_id}?include[]=reasoning.encrypted_content`
    returns the stored encrypted reasoning content.
- Preserved replay behavior: clients can pass the encrypted reasoning item back
  in a later request, and the bridge decodes it locally into upstream
  `reasoning_content` for Chat-compatible providers.
- Preserved streaming client behavior while storing a full internal response at
  completion time, so later retrieval can project encrypted reasoning content
  only when the include query requests it.
- Extended background response finalization so completed background Responses
  also retain local encrypted reasoning content internally and report
  compatibility metadata when requested.
- Added unit coverage for create-time include projection, default stored
  retrieval redaction, include-based stored retrieval recovery, no-include
  create redaction with internal storage, and replay from encrypted reasoning
  items.
- Added a live `responses-reasoning-encrypted` bridge-regression case that
  verifies visible output, `ocrsn1.` encrypted content on create, default GET
  redaction, include GET recovery, and local compatibility metadata.
- Updated compatibility and evaluation docs to record the stored-response
  projection behavior and the targeted eval command.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-reasoning-encrypted` passed 1/1 against
    `deepseek-v4-pro`, latency 1476 ms, total usage 77 tokens, visible text
    `reasoning-encrypted-ok`, and both hidden/included stored-response
    retrieves returned 200.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1648 ms, P95 latency 1699 ms, and total usage 203 tokens.
  - Full live `bridge-regression` passed 45/45 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1151 ms, P95 latency 2472 ms, and total usage
    9669 tokens.
  - UI smoke passed with marker `ui-smoke-mq8j8rt7`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 429 runtime candidates,
    selected 37 old UI screenshots by retention policy, deleted 0, selected
    2838229 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 44 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Batch Responses image_generation regression coverage

- Added explicit local Batch coverage for Responses image-generation JSONL
  requests:
  - unit coverage creates a `purpose:"batch"` JSONL file containing a
    `/v1/responses` request with `tools:[{type:"image_generation"}]`;
  - the local Batch executor writes a Batch output file whose response body
    preserves the `image_generation_call` item, base64 PNG result, assistant
    message, compatibility metadata, and generated image-call state record;
  - live `bridge-regression` now includes `batch-responses-image-generation`,
    so the DeepSeek-backed bridge checks Batch + image-generation protocol
    compatibility continuously.
- Updated compatibility/evaluation docs:
  - Batch known gap now distinguishes covered Responses image-generation JSONL
    from not-yet-implemented direct Images/video endpoint batch execution;
  - image-generation known gap no longer claims missing call-id persistence,
    since id-only multi-turn edit is now implemented and covered.
- Verification:
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --test --test-name-pattern "Batch API executes Responses image_generation" test/server.test.js`:
    1/1 passing.
  - `npm run eval:bridge -- --case batch-responses-image-generation`: passed
    1/1 against `deepseek-v4-pro`, latency 1312 ms, total usage 185 tokens.
  - `npm test`: 142/142 passing tests.
  - `npm run eval:bridge`: passed 53/53 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1336 ms, P95 latency 3041 ms, and total usage
    10797 tokens. The suite now includes
    `batch-responses-image-generation`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Background remote MCP call-loop compatibility

- Extended the remote MCP call bridge from foreground non-streaming Responses
  to active `background:true` Responses jobs:
  - background preparation now keeps the live MCP context and shared
    `max_tool_calls` budget through the provider phase;
  - auto-approved remote MCP Chat proxy tool calls can execute remote
    `tools/call`, inject Chat `tool` messages, and perform the follow-up
    provider call before storing the completed background Response;
  - `mcp_call` output items and `metadata.compatibility.local_mcp` counters are
    recomputed after the background call loop so final stored output reflects
    the remote execution;
  - approved `mcp_approval_response` continuations now also work with
    `background:true` after the previous response's `mcp_approval_request` is
    replayed.
- Added fail-closed restart behavior for provider-pending background jobs that
  still need ephemeral remote MCP function-tool context. These jobs contain
  per-request remote MCP authorization/session state in memory, so startup
  reconciliation now refuses to resume them after process restart and reports
  `interrupted_provider_pending_ephemeral_mcp_context` instead of replaying a
  partial provider request without the original MCP context.
- Kept the security boundary explicit:
  - per-request MCP `authorization` continues to be stripped from public
    Responses output and persisted background snapshots;
  - outbound authorization is forwarded only to the mock/remote MCP server
    during `initialize`, `tools/list`, or `tools/call`;
  - no API keys, account credentials, provider headers, or env files were added
    to the repository.
- Added coverage:
  - unit/mock-provider coverage for background auto-approved remote MCP
    `tools/call`, including two upstream provider turns, remote session-id
    forwarding, `Authorization` forwarding only to MCP, `mcp_call` output
    persistence, budget accounting, and background snapshot redaction;
  - unit/mock-provider coverage for background approved
    `mcp_approval_response` continuation, including previous-response replay,
    actual remote `tools/call`, provider-pending snapshot redaction, final
    `mcp_call` output, and local MCP compatibility counters;
  - startup reconciliation coverage for provider-pending background responses
    with ephemeral MCP context, proving they fail closed with
    `interrupted_provider_pending_ephemeral_mcp_context`;
  - live bridge regression case `responses-mcp-remote-background-call`, backed
    by a local mock MCP server and the deployed DeepSeek bridge.
- Updated the compatibility matrix, deployment docs, and evaluation plan to
  document that remote MCP auto-approved calls and approval continuations are
  supported for non-streaming and active background requests, while streaming
  call loops and restart-resumable per-request connector credentials remain
  future work.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed, including the new background
    auto-approved remote MCP call and background approved approval-response
    continuation cases.
  - `npm test`: passed 174/174.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-mcp-remote-background-call`: passed 1/1 against
    `deepseek-v4-pro`, output `mcp-remote-background-call-ok`, status history
    reached `completed`, remote MCP methods were `initialize`,
    `notifications/initialized`, `tools/list`, and `tools/call`, and both MCP
    authorization and session forwarding were confirmed.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: 78/78 passing
    cases, pass rate 1.0, average latency 1594 ms, P95 latency 4462 ms, total
    usage 17248 tokens.
  - `npm run eval:protocol`: 2/2 passing protocol-smoke cases, pass rate 1.0.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against `https://opencodexapp.aialra.online`;
    navigation, sidebar controls, project dialog, host upload service, prompt
    submission, completed-turn actions, reload persistence, generated image
    artifact display, saved-project reopen/cleanup, and console checks all
    succeeded.
  - `npm run prune:runtime -- --dry-run`: scanned 971 runtime candidates,
    selected 1 old UI smoke screenshot, selected 84985 bytes, and reported 0
    errors.
  - `npm run prune:runtime -- --apply`: deleted 1 file, freed 84985 bytes, and
    reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available;
    `state/` is 13 MB, `output/` is 4.8 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.

## 2026-06-11 - Remote MCP approval flow compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the approval item flow:
  `mcp_approval_request` output items can be returned before a connector call,
  and a later request can send `mcp_approval_response` input with
  `approval_request_id`, typically chained with `previous_response_id`.
  Authorization remains per-request and is not stored on the Response object.
- Extended non-streaming remote MCP compatibility from auto-approved execution
  to approval-required execution:
  - remote MCP tools with `require_approval:"always"`, `"default"`, or no
    matching `never` rule are exposed to Chat providers as temporary function
    tools so the model can request the call;
  - model-produced Chat tool calls for approval-required MCP tools are converted
    into Responses `mcp_approval_request` items instead of calling the remote
    server immediately;
  - internal generated Chat function calls are suppressed from public Responses
    output so clients see the MCP approval item shape, not bridge plumbing;
  - later `mcp_approval_response` items are matched against prior response
    output via `previous_response_id`, then approved calls execute remote
    JSON-RPC `tools/call` with the current request's MCP server authorization
    and session handling;
  - approved call results emit `mcp_call` with `approval_request_id` and are
    injected back into the final Chat prompt so the model can answer from the
    tool output.
- Added compatibility metadata counters for approval requests, approval
  responses, approvals, denials, missing approvals, and remote call execution.
- Updated the bridge regression harness with
  `responses-mcp-remote-approval` and `responses-mcp-remote-denial`, which
  start a local mock MCP server, validate the approval request turn, send
  approved or denied continuations, verify `tools/call` only happens for the
  approved path, and confirm authorization/session behavior without leaking
  secrets into Responses output.
- Updated compatibility matrix, deployment docs, evaluation plan, unit tests,
  and the live harness.
- Kept the compatibility boundary explicit: this supports non-streaming
  approval request/response execution for remote `server_url` MCP tools.
  Streaming remote MCP calls, background approval loops, hosted OpenAI
  connector OAuth/token sidecars, and broader audit UI for tool outputs remain
  future work.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including approval request creation, approved continuation execution,
    denied approval continuation without re-requesting the tool, budget
    accounting, hidden Chat tool-call suppression, and authorization redaction.
  - `npm test`: passed 171/171.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Live targeted
    `npm run eval:bridge -- --case responses-mcp-remote-approval --timeout-ms 120000 --verbose`
    passed 1/1 against `deepseek-v4-pro`, confirmed remote `initialize`,
    `notifications/initialized`, two `tools/list` calls, approved
    `tools/call`, authorization forwarding, and session forwarding.
  - Live targeted
    `npm run eval:bridge -- --case responses-mcp-remote-denial --timeout-ms 120000 --verbose`
    passed 1/1 against `deepseek-v4-pro`, confirmed remote `initialize`,
    `notifications/initialized`, two `tools/list` calls, denied approval
    accounting, no `tools/call`, and no secret leakage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 77/77 passing cases, pass rate 1.0, average latency 1319 ms, P95
    latency 3965 ms, and total usage 15782 tokens.
  - `npm run eval:protocol -- --timeout-ms 120000`: passed 2/2, pass rate
    1.0, average latency 1040 ms, P95 latency 1128 ms, and total usage 99
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; initial cleanup scan selected
    1 old screenshot and 85582 bytes, and the final scan after cleanup scanned
    946 runtime candidates, selected 0 files, and reported 0 errors.
  - `npm run prune:runtime -- --apply`: initial cleanup deleted 1 old
    screenshot and freed 85582 bytes; the final apply scan checked 946 runtime
    candidates, deleted 0 files, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available; the
    repo is 62 MB, `state/` is 13 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, MCP
  authorization values, or local deployment env files were added to the
  repository.

## 2026-06-11 - Remote MCP tools/call execution compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the next request/output boundary:
  Responses MCP tools use `tools:[{type:"mcp"}]`, `server_label`, remote
  `server_url` or hosted `connector_id`, optional per-request
  `authorization`, `require_approval`, `allowed_tools`, and `defer_loading`;
  `mcp_list_tools` output carries imported tools, and `mcp_call` output carries
  `server_label`, `name`, `arguments`, `output`, and `error`.
- Extended the local MCP adapter from remote list-tools import to a first
  non-streaming remote call loop for Chat-only providers:
  - imported remote MCP tools with `require_approval:"never"` or matching
    `require_approval.never.tool_names` are exposed to the upstream Chat
    provider as generated function tools;
  - matching upstream Chat `tool_calls` are translated into remote JSON-RPC
    `tools/call` requests with the model-provided arguments;
  - successful and failed remote tool calls are mapped back into Responses
    `mcp_call` output items and Chat `tool` messages for one bounded follow-up
    completion;
  - `mcp-session-id` values from remote initialize/list calls are carried into
    later remote call requests;
  - `max_tool_calls` now accounts for both `mcp_list_tools` and executed
    remote `mcp_call` items.
- Added configuration knobs:
  - `CODEXCOMPAT_MCP_REMOTE_TOOL_CALLS`;
  - `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS`;
  - `CODEXCOMPAT_MCP_MAX_TOOL_OUTPUT_CHARS`.
- Tightened MCP secret handling:
  - `authorization` remains non-enumerable runtime-only state for remote call
    execution and is not written to Responses output or background snapshots;
  - remote MCP `tools/call` output and JSON-RPC error data are redacted if a
    remote server echoes the current request authorization value or a Bearer
    token-like value.
- Added coverage:
  - unit/mock-provider coverage for remote MCP `tools/call`, Chat function-tool
    proxy injection, second provider call with `tool_choice:"none"`, usage
    aggregation, budget exhaustion, session forwarding, and output redaction;
  - a live bridge regression case, `responses-mcp-remote-call`, that starts a
    local mock MCP server and verifies a deployed bridge performs
    `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`
    while DeepSeek drives the function-tool call and final response.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Compatibility boundary: this is now a real non-streaming, auto-approved
  remote MCP `tools/call` executor for `server_url` tools. It still does not
  execute approval-required remote calls, run streaming/background remote call
  loops, manage hosted connector OAuth/token sidecars, or persist connector
  approval state.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `npm test`: passed 169/169.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - Restarted `aialra-opencodexapp-bridge.service`; `systemctl show` reported
    `ActiveState=active`, `SubState=running`, `MainPID=3926150`, and start
    timestamp `Thu 2026-06-11 08:28:55 CEST`.
  - Bridge healthz returned `ok:true`, provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `responses-mcp-remote-list` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 1513 ms, output `mcp-remote-ok`, total usage
    300 tokens, and confirmed remote `initialize`,
    `notifications/initialized`, `tools/list`, authorization forwarding, and
    session forwarding.
  - Live `responses-mcp-remote-call` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 2802 ms, output `mcp-remote-call-ok`, total
    usage 1097 tokens, `remote_call_success_count:1`, and confirmed remote
    `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 75/75 passing cases, pass rate 1.0, average latency 1308 ms, P95
    latency 3792 ms, and total usage 12738 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run eval:protocol`: passed 2/2, average latency 1374 ms, P95 latency
    1407 ms, and total usage 99 tokens.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 878 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 878 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Recent bridge journal only showed the intentional restart sequence.
  - Disk/storage check after cleanup: the filesystem has 42 GB available;
    `state/` is 12 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Graders API and Evals grader expansion

- Used current official OpenAI Graders docs/OpenAPI metadata to confirm the
  Graders surface and supported grader families:
  - `POST /v1/fine_tuning/alpha/graders/validate`;
  - `POST /v1/fine_tuning/alpha/graders/run`;
  - documented grader types `string_check`, `text_similarity`, `score_model`,
    and `python`, with `multi` documented for RFT composition.
- Added a dependency-free local Graders compatibility module for deterministic
  grading on Chat-only providers:
  - `string_check` supports documented `eq`, `neq`, `like`, and `ilike`,
    plus compatibility aliases for equality, containment, prefix/suffix, and
    regex checks;
  - `text_similarity` supports the documented metric names
    `fuzzy_match`, `bleu`, `gleu`, `meteor`, `cosine`, `rouge_1` through
    `rouge_5`, and `rouge_l` with local deterministic approximations;
  - one-level `multi` combines subgrader rewards through a small safe formula
    parser supporting arithmetic, parentheses, identifiers, comma-separated
    function calls, and `min`, `max`, `abs`, `floor`, `ceil`, `exp`, `sqrt`,
    and `log`;
  - `score_model`, `python`, nested `multi`, hosted judge execution, and
    sandboxed Python execution intentionally return structured unsupported
    errors instead of silently faking parity.
- Added Graders API handlers:
  - validate returns the normalized grader for locally supported deterministic
    graders;
  - run returns `reward`, `metadata`, `sub_rewards`, and empty model-token
    usage for local graders without contacting the upstream provider.
- Reused the same grader engine in local Evals runs, extending Evals beyond
  `string_check` to deterministic `text_similarity` and one-level `multi`
  testing criteria. Run metadata now records
  `supported_graders:["string_check","text_similarity","multi"]`.
- Extended the live bridge-regression harness with `graders-api-local`, which
  validates a `string_check` grader, runs `text_similarity`, runs `multi`, and
  confirms unsupported `score_model` returns
  `unsupported_grader_type`.
- Updated the compatibility matrix, evaluation plan, and deployment
  verification commands to document the Graders API, deterministic Evals
  coverage, local approximation caveats, and remaining parity gaps.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests ran through `test/server.test.js` and
    passed, including the new Graders API and Evals text-similarity/multi
    cases.
  - `npm test`: passed 162/162.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 771 runtime
    candidates, selected 94 old UI screenshots by retention policy, deleted 0
    files, selected 7725496 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `graders-api-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, with `similarity_reward:0.6`,
    `multi_reward:0.9375`, zero token usage, and unsupported `score_model`
    returning HTTP 400.
  - Live `evals-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, with `result_counts:{total:2,passed:1,failed:1,errored:0}`
    and zero token usage because it used sample-driven local grading.
  - Full live `npm run eval:bridge -- --timeout-ms 180000`: 71/71 passing
    cases, pass rate 1.0, average latency 1058 ms, P95 latency 2708 ms, and
    total usage 10857 tokens.
  - `npm run smoke:ui -- --timeout-ms 180000`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - Runtime cleanup with `npm run prune:runtime -- --apply`: deleted 95 old
    UI screenshots by retention policy, freed 7810577 bytes, and reported 0
    errors.
  - Disk/storage check after cleanup: the filesystem has 39 GB available;
    `state/` is 8.3 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-10 Stored Response Lifecycle Include Projection

- Re-checked the current OpenAI Responses include list through the official
  OpenAI developer docs MCP. The supported include-gated response details remain
  `web_search_call.action.sources`, `code_interpreter_call.outputs`,
  `computer_call_output.output.image_url`, `file_search_call.results`,
  `message.input_image.image_url`, `message.output_text.logprobs`, and
  `reasoning.encrypted_content`.
- Found and closed a local lifecycle projection bypass:
  - `GET /v1/responses/{response_id}` already projected stored response bodies
    through include redaction;
  - `POST /v1/responses/{response_id}` metadata updates returned the internal
    stored response object directly;
  - `POST /v1/responses/{response_id}/cancel` terminal no-op responses also
    returned the internal stored response object directly.
- Updated the metadata-update and completed-cancel paths so they return
  `projectResponseForIncludes(...)`, matching retrieval behavior. Include-gated
  fields are hidden by default and returned only when the lifecycle request URL
  includes the matching `include[]` query value.
- Extended unit coverage on the existing `message.output_text.logprobs` fixture
  to verify:
  - update without include hides output-text logprobs;
  - update with `include[]=message.output_text.logprobs` returns logprobs;
  - completed cancel without include hides logprobs;
  - completed cancel with `include[]=message.output_text.logprobs` returns
    logprobs.
- Extended the live `responses-logprobs` bridge-regression case to exercise the
  same stored-response update/cancel projection path against
  `deepseek-v4-pro`.
- Hardened deterministic live evals that are meant to test protocol plumbing,
  not reasoning quality:
  - `responses-text`, `responses-json-schema`, and
    `responses-conversation-lifecycle` now set `reasoning.effort:"none"`;
  - direct Chat exact-string smoke and Batch Chat requests now set DeepSeek
    `thinking:{type:"disabled"}`.
- During validation, an earlier full live run exposed flaky exact-string
  failures from DeepSeek thinking mode: `responses-text` returned no visible
  text after consuming reasoning tokens, and `batch-chat-completions` missed one
  exact marker. After the deterministic non-thinking eval updates, targeted
  retries and the final full run passed.
- Updated compatibility and evaluation docs to record that stored Responses
  metadata update and completed cancel/no-op paths share the same include
  projection contract as response retrieval.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 85/85 passing tests.
  - `npm test`: 122/122 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-logprobs` passed 1/1 against
    `deepseek-v4-pro`, latency 1595 ms, total usage 63 tokens, visible text
    `logprobs-ok`, hidden/included stored-response retrieves returned 200,
    hidden/included metadata updates returned 200, and hidden/included
    completed-cancel no-op requests returned 200.
  - Targeted live `responses-conversation-lifecycle` passed 1/1 after the
    deterministic non-thinking update, latency 2890 ms, output
    `conversation-ok`, and total usage 229 tokens.
  - Targeted live `responses-text` passed 1/1 after the deterministic
    non-thinking update, latency 782 ms, output `ok-text`, and total usage
    13 tokens.
  - Targeted live `batch-chat-completions` passed 1/1 after the deterministic
    non-thinking update, latency 1837 ms, and total usage 34 tokens.
  - Final `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 918 ms, P95 latency 1082 ms, and total usage 99 tokens.
  - Final full live `bridge-regression` passed 45/45 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 1131 ms, P95 latency
    2450 ms, and total usage 9428 tokens.
  - UI smoke passed with marker `ui-smoke-mq8jo2b6`, reload persistence
    confirmed, console errors 0, warnings 0.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 449 runtime candidates,
    selected 38 old UI screenshots by retention policy, deleted 0, selected
    2924128 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: `/srv/aialra/apps`, `/srv/aialra/data`, and
    `/srv/aialra/logs` are on a 193 GB filesystem with 37 GB available;
    repository checkout is 45 MB, `/srv/aialra/data/opencodexapp` is 48 KB,
    and `/srv/aialra/logs/opencodexapp` is 13 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Developer Role Compatibility

- Re-checked the current OpenAI OpenAPI endpoint list and Chat/Responses specs
  through the official OpenAI developer docs MCP. The OpenAPI metadata was
  version `2.3.0`; current Chat examples use `role:"developer"` messages, and
  Chat Completions still exposes create/list/retrieve/update/delete/messages
  lifecycle paths.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already normalized Responses/developer-style
    instruction roles for upstream Chat providers;
  - direct `POST /v1/chat/completions` passthrough still sent OpenAI Chat
    `messages[].role:"developer"` and OpenAI-only request fields directly to
    the upstream provider;
  - DeepSeek-compatible providers expect a narrower Chat role/field surface, so
    direct SDK calls could fail even though the equivalent Responses request
    worked.
- Added provider-aware direct Chat passthrough normalization:
  - `CODEXCOMPAT_CHAT_DEVELOPER_ROLE_COMPAT` defaults to true for DeepSeek
    providers and maps Chat `developer` messages to
    `CODEXCOMPAT_CHAT_DEVELOPER_ROLE`, default `system`, before proxying;
  - DeepSeek user identity compatibility now also applies to direct Chat
    passthrough, mapping `user`, `safety_identifier`, or `prompt_cache_key` to
    `user_id` and hashing values that do not match DeepSeek's safe character
    set;
  - unsupported `service_tier`, non-streaming `stream_options`, and configured
    OpenAI-only Chat fields such as `modalities`, `moderation`, `prediction`,
    `verbosity`, `web_search_options`, and legacy `functions` /
    `function_call` are filtered before the upstream call;
  - non-streaming JSON Chat responses and locally reconstructed stored streaming
    Chat completions record the compatibility action under
    `metadata.compatibility.chat_passthrough`;
  - stored Chat `/messages` retrieval continues to preserve the original client
    request messages, including `role:"developer"`, so audit/replay state is not
    silently rewritten.
- Added unit coverage for direct Chat passthrough against a mock provider:
  upstream sees `developer` mapped to `system`, unsupported fields filtered,
  `user` normalized to hashed `user_id`, returned metadata records
  `chat_passthrough`, local inline moderation still works when `moderation` is
  filtered, retrieve preserves metadata, and `/messages` preserves the original
  developer input message.
- Added a live `chat-developer-compat` bridge-regression case that sends direct
  Chat `developer` role input plus DeepSeek-filtered Chat fields through
  `/v1/chat/completions` and requires both exact output and compatibility
  metadata.
- Updated compatibility, deployment, and evaluation docs for the new direct
  Chat provider-profile behavior and environment knobs.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js`: 86/86 passing tests.
  - `npm test`: 123/123 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1156 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and compatibility metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 998 ms, P95 latency 1064 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1108 ms, P95 latency 2306 ms, and total usage
    9365 tokens.
  - UI smoke passed with marker `ui-smoke-mq8k42j3`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-04-22-479Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 458 runtime candidates,
    selected 39 old UI screenshots by retention policy, deleted 0, selected
    3009969 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; repository checkout
    is 34 MB, `state/` is 4.0 MB, and `output/` is 7.2 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Token Alias Compatibility

- Re-checked official API field direction before changing behavior:
  - OpenAI developer docs MCP search for Chat Completions create confirmed
    `max_completion_tokens` is the current Chat-side upper-bound field and that
    legacy `max_tokens` is deprecated in favor of it for newer model families.
  - OpenAI OpenAPI metadata was still version `2.3.0` for
    `POST /v1/chat/completions`.
  - DeepSeek's official Create Chat Completion reference
    (`https://api-docs.deepseek.com/api/create-chat-completion`) documents
    `max_tokens` as the generated-token limit for DeepSeek Chat Completions.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already accepted `max_completion_tokens` and
    legacy `max_tokens` aliases and mapped them to
    `CODEXCOMPAT_MAX_TOKENS_FIELD`;
  - direct `POST /v1/chat/completions` passthrough still forwarded the raw
    OpenAI Chat field surface, so current OpenAI SDK callers using
    `max_completion_tokens` could send a field that DeepSeek does not document;
  - custom provider profiles with non-`max_tokens` output-limit fields also
    needed to avoid leaking both OpenAI aliases upstream.
- Added provider-aware direct Chat token normalization:
  - direct Chat `max_completion_tokens` is mapped to the configured
    `CODEXCOMPAT_MAX_TOKENS_FIELD`, default `max_tokens` for DeepSeek;
  - when both `max_completion_tokens` and legacy `max_tokens` are present,
    `max_completion_tokens` wins and the old value is recorded as
    `metadata.compatibility.chat_passthrough.max_tokens.forwarded=false`;
  - when a provider uses a custom field such as `max_new_tokens`, OpenAI token
    aliases are removed before proxying so only the provider field is sent;
  - non-streaming JSON Chat responses and locally reconstructed stored streaming
    Chat completions continue to report the action under
    `metadata.compatibility.chat_passthrough`.
- Added unit coverage:
  - DeepSeek-compatible direct Chat passthrough now asserts the upstream mock
    receives `max_tokens:32`, not `max_completion_tokens`, and that conflicting
    legacy `max_tokens:96` is audited but not forwarded;
  - custom provider coverage asserts `max_completion_tokens:21` plus
    `max_tokens:99` becomes only `max_new_tokens:21` upstream, with conflict
    metadata preserved.
- Extended live evaluation:
  - `chat-developer-compat` now sends direct Chat `max_completion_tokens:64`
    and requires returned compatibility metadata to show forwarding to
    DeepSeek `max_tokens`.
- Hardened the UI smoke script while validating this change:
  - optional search/sidebar/settings controls now use short-click attempts
    instead of 30-second default click timeouts;
  - transient command-menu/dialog overlays are closed before composer input, so
    the smoke continues to test the real conversation/reload workflow instead of
    failing on optional UI chrome.
- Updated compatibility, deployment, and evaluation docs to record direct Chat
  token alias mapping and the `CODEXCOMPAT_MAX_TOKENS_FIELD` configuration.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "chat/completions.*token|normalizes OpenAI Chat fields"`: 87/87 passing tests, including the two direct Chat token alias cases.
  - `npm test`: 124/124 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 908 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat token alias metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 964 ms, P95 latency 1041 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1108 ms, P95 latency 2068 ms, and total usage
    9333 tokens.
  - UI smoke passed with marker `ui-smoke-mq8km2bs`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-18-22-024Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 469 runtime candidates,
    selected 42 old UI screenshots by retention policy, deleted 0, selected
    3268828 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 46 MB, `state/` is 4.1 MB, `output/` is 7.5 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Reasoning Effort Compatibility

- Re-checked current field expectations before changing passthrough behavior:
  - OpenAI developer docs MCP search for Chat Completions create confirmed
    direct Chat `reasoning_effort` currently accepts values including `none`,
    `minimal`, `low`, `medium`, `high`, and `xhigh`.
  - OpenAI OpenAPI metadata remained version `2.3.0` for
    `POST /v1/chat/completions`.
  - DeepSeek's official Create Chat Completion and Thinking Mode references
    document a narrower DeepSeek Chat surface around `reasoning_effort` /
    `thinking`, with `thinking:{type:"disabled"}` used for non-thinking mode.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already normalized OpenAI/Codex
    `reasoning.effort` values for DeepSeek-compatible providers;
  - direct `POST /v1/chat/completions` passthrough still sent OpenAI Chat
    `reasoning_effort` values as-is, so `reasoning_effort:"none"` could reach
    DeepSeek instead of becoming non-thinking mode, and `xhigh` was not mapped
    to DeepSeek's `max` effort.
- Added provider-aware direct Chat reasoning normalization:
  - direct Chat `reasoning_effort:"none"` now omits upstream
    `reasoning_effort`, sends `thinking:{type:"disabled"}`, and records
    `metadata.compatibility.chat_passthrough.reasoning_effort` with
    `reason=deepseek_thinking_disabled`;
  - direct Chat `reasoning_effort:"minimal"`, `"low"`, and `"medium"` map to
    DeepSeek `reasoning_effort:"high"`;
  - direct Chat `reasoning_effort:"xhigh"` maps to DeepSeek
    `reasoning_effort:"max"`;
  - already-supported values such as `high` pass through unchanged without
    extra metadata noise.
- Added unit coverage for both passthrough branches:
  - the DeepSeek direct Chat compatibility test now asserts
    `reasoning_effort:"none"` becomes upstream `thinking:{type:"disabled"}`
    and records non-forwarded compatibility metadata;
  - a focused direct Chat reasoning alias test asserts `xhigh` becomes upstream
    `reasoning_effort:"max"` with forwarded compatibility metadata.
- Extended live evaluation:
  - `chat-developer-compat` now sends direct Chat `reasoning_effort:"none"`
    instead of provider-native `thinking:{type:"disabled"}`, and requires
    returned compatibility metadata to prove DeepSeek non-thinking mapping.
- Updated compatibility, deployment, and evaluation docs to state that
  `CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT` covers both Responses
  `reasoning.effort` and direct Chat `reasoning_effort`.
- Verification:
  - `node --check src/bridge/server.js scripts/eval-harness.mjs test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "reasoning_effort|normalizes OpenAI Chat fields"`: 88/88 passing tests, including the direct Chat reasoning cases.
  - `npm test`: 125/125 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1133 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat reasoning metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 998 ms, P95 latency 1124 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 46/46 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1119 ms, P95 latency 2556 ms, and total usage
    9370 tokens.
  - UI smoke passed with marker `ui-smoke-mq8kve9m`, reload persistence
    confirmed, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T21-25-37-402Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 478 runtime candidates,
    selected 43 old UI screenshots by retention policy, deleted 0, selected
    3355553 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 46 MB, `state/` is 4.2 MB, `output/` is 7.5 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Direct Chat Tool Choice Thinking Compatibility

- Re-checked current tool-call field expectations before changing direct Chat
  passthrough behavior:
  - OpenAI developer docs / OpenAPI for `POST /v1/chat/completions` document
    Chat `tools` and `tool_choice`, including `none`, `auto`, `required`, and
    forcing a specific function tool.
  - DeepSeek's official Create Chat Completion reference documents
    `thinking:{type:"enabled|disabled"}` with default `enabled`, `tools`,
    and `tool_choice` with the same control values.
  - DeepSeek's official Thinking Mode and Tool Calls guides document
    thinking-mode tool calls, but also require `reasoning_content` from
    tool-call turns to be passed back on later requests.
- Found a direct Chat passthrough gap:
  - Responses-to-Chat translation already disabled DeepSeek thinking by default
    when function tools and `tool_choice` were present;
  - direct `POST /v1/chat/completions` passthrough preserved `tools` and
    `tool_choice` but did not apply the same default, so OpenAI Chat clients
    could accidentally enter DeepSeek thinking-mode tool-call state without
    managing DeepSeek-specific `reasoning_content` replay.
- Added provider-aware direct Chat tool-choice thinking compatibility:
  - when `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE=true`, direct
    Chat passthrough requests with function `tools` plus `tool_choice` now send
    upstream `thinking:{type:"disabled"}`;
  - the original `tools` and `tool_choice` payloads continue to pass through;
  - returned and stored Chat completion metadata records
    `metadata.compatibility.chat_passthrough.deepseek_thinking` with
    `source=tool_choice`, `target=thinking`, `reason=disabled_for_tool_choice`,
    the chosen tool value, the mapped thinking value, and any previous thinking
    value.
- Added regression coverage:
  - a unit test asserts direct Chat tool-choice requests preserve `tools` /
    `tool_choice`, override `thinking:{type:"enabled"}` to
    `thinking:{type:"disabled"}`, and attach compatibility metadata;
  - the live `bridge-regression` suite now includes `chat-tool-choice-compat`,
    which forces a `record_result` tool call through direct Chat passthrough and
    verifies both the returned `tool_calls` payload and compatibility metadata.
- Updated compatibility, deployment, and evaluation docs to state that
  `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE` covers both Responses
  translation and direct Chat passthrough.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `node --check test/server.test.js`: passed.
  - `node --test test/server.test.js --test-name-pattern "tool_choice|normalizes OpenAI Chat fields|reasoning_effort"`:
    89/89 passing tests, including the new direct Chat `tool_choice` case.
  - `npm test`: 126/126 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-tool-choice-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1232 ms, total usage 371 tokens, and direct Chat
    tool-call metadata checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1201 ms, P95 latency 1271 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1110 ms, P95 latency 2216 ms, and total usage
    9776 tokens.
  - UI smoke passed with marker `ui-smoke-mq8l7u5x`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T21-35-17-877Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 488 runtime candidates,
    selected 44 old UI screenshots by retention policy, deleted 0, selected
    3442101 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 38 GB available; repository checkout
    is 47 MB, `state/` is 4.3 MB, `output/` is 7.6 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Chat Native Parallel Tool Calls Filtering

- Re-checked current field expectations before changing provider profiles:
  - OpenAI developer docs / OpenAPI for `POST /v1/chat/completions` document
    Chat `parallel_tool_calls` as the switch for parallel function calling
    during tool use.
  - DeepSeek's official Create Chat Completion reference documents `tools`,
    `tool_choice`, `logprobs`, `top_logprobs`, `user_id`, and other supported
    request fields, but does not list `parallel_tool_calls`.
- Found a provider-profile gap:
  - direct `POST /v1/chat/completions` passthrough filtered several
    OpenAI-only Chat fields for DeepSeek, but not `parallel_tool_calls`;
  - Responses-to-Chat translation copied `parallel_tool_calls` before the
    provider-aware Chat-native field filter, so DeepSeek could still receive an
    unsupported OpenAI Chat parameter through `/v1/responses`.
- Added provider-aware filtering:
  - moved Responses `parallel_tool_calls` handling into the shared
    Chat-native passthrough field list, so supported providers still receive it
    and DeepSeek defaults to filtering it with
    `metadata.compatibility.chat_native_fields.filtered`;
  - added `parallel_tool_calls` to direct Chat passthrough filtering when
    `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS=false`;
  - updated deployment, compatibility, and evaluation docs to list
    `parallel_tool_calls` in the DeepSeek-filtered Chat-native field matrix.
- Added regression coverage:
  - translator unit tests now assert `parallel_tool_calls:false` is forwarded
    for provider-supported profiles and filtered for unsupported profiles;
  - server unit tests now cover both `/v1/responses` translation and direct
    `/v1/chat/completions` passthrough filtering;
  - live `bridge-regression` now exercises the field in
    `responses-inline-moderation` and `chat-developer-compat`, proving both
    public paths record the DeepSeek filter metadata while still completing.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    and `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/translator.test.js --test-name-pattern "Chat-native request fields|unsupported providers"`:
    34/34 passing tests, including the `parallel_tool_calls` forwarding and
    filtering assertions.
  - `node --test test/server.test.js --test-name-pattern "Chat-native request fields|normalizes OpenAI Chat fields"`:
    89/89 passing tests, including Responses and direct Chat filtering.
  - `npm test`: 126/126 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-inline-moderation` passed 1/1 against
    `deepseek-v4-pro`, latency 1168 ms, total usage 46 tokens, visible text
    `inline-moderation-ok`, and Responses `parallel_tool_calls` filter metadata
    checks passed.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1032 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat `parallel_tool_calls` filter metadata
    checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1035 ms, P95 latency 1117 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1090 ms, P95 latency 2099 ms, and total usage
    9717 tokens.
  - UI smoke passed with marker `ui-smoke-mq8lii3p`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T21-43-35-461Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 498 runtime candidates,
    selected 45 old UI screenshots by retention policy, deleted 0, selected
    3528992 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 42 GB available; repository checkout
    is 47 MB, `state/` is 4.4 MB, `output/` is 7.7 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-10 Stored Chat Fields Provider Filtering

- Re-checked current request-field expectations:
  - OpenAI Chat Completions documents `metadata` as object metadata for stored
    and queryable records and `store` as the stored-chat output retention
    switch.
  - DeepSeek's official Create Chat Completion reference documents its request
    fields for `/chat/completions`, including `messages`, `model`, `thinking`,
    `reasoning_effort`, `max_tokens`, `response_format`, `stream_options`,
    `tools`, `tool_choice`, `logprobs`, `top_logprobs`, and `user_id`, but not
    OpenAI stored-chat `store` / `metadata`.
- Found a provider-profile gap:
  - Responses translation copied `metadata` and `store` directly into upstream
    Chat requests even though the bridge already implements local Responses
    storage and metadata semantics;
  - direct Chat passthrough used `store:true` and `metadata` for the local
    stored Chat lifecycle, but also forwarded them upstream unless the provider
    happened to ignore unsupported fields;
  - `background:true` forced local store correctly, but also forced
    `chat.store=true` on the upstream request path.
- Added provider-aware stored-chat handling:
  - introduced `CODEXCOMPAT_FORWARD_STORED_CHAT_FIELDS`, defaulting to `false`
    for DeepSeek providers and `true` for other OpenAI-compatible Chat
    providers;
  - moved Responses `metadata` / `store` into a dedicated stored-chat
    passthrough/filtering step, recording
    `metadata.compatibility.stored_chat_fields`;
  - added direct Chat filtering that preserves local `store:true` and metadata
    behavior while omitting unsupported upstream fields and recording
    `metadata.compatibility.chat_passthrough.stored_chat_fields`;
  - made background Responses keep local durable storage without sending
    `store` to DeepSeek when stored-chat forwarding is disabled.
- Added regression coverage:
  - translator tests now assert provider-supported profiles forward `metadata`
    and `store`, while unsupported profiles filter them and preserve explicit
    compatibility metadata;
  - server tests now cover Responses filtering, direct Chat passthrough
    filtering, DeepSeek default config behavior, and background local-store
    filtering;
  - live eval harness now checks stored-chat filtering in
    `responses-inline-moderation` and `chat-developer-compat`.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    and `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/translator.test.js --test-name-pattern "Chat-native request fields|stored"`:
    34/34 passing tests.
  - `node --test test/server.test.js --test-name-pattern "Chat-native request fields|normalizes OpenAI Chat fields|background keeps local store"`:
    90/90 passing tests, including the new background local-store case.
  - `npm test`: 127/127 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-inline-moderation` passed 1/1 against
    `deepseek-v4-pro`, latency 1603 ms, total usage 54 tokens, visible text
    `inline-moderation-ok`, and Responses stored-chat filtering metadata checks
    passed.
  - Targeted live `chat-developer-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1092 ms, total usage 31 tokens, visible text
    `chat-developer-ok`, and direct Chat stored-chat filtering metadata checks
    passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1329 ms, P95 latency 1579 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1220 ms, P95 latency 2266 ms, and total usage
    9749 tokens.
  - UI smoke passed with marker `ui-smoke-mq8m57ha`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-01-14-782Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 510 runtime candidates,
    selected 46 old UI screenshots by retention policy, deleted 0, selected
    3615921 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; repository checkout
    is 48 MB, `state/` is 4.5 MB, `output/` is 7.8 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 14 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 Stream Options Provider Filtering

- Re-checked current streaming request-field expectations:
  - OpenAI Chat Completions documents `stream_options` as a streaming-only
    request parameter and includes newer subfields such as usage and
    obfuscation controls.
  - DeepSeek's official Create Chat Completion reference documents
    `stream_options` for `/chat/completions`, but the supported surface is
    narrower; in practice the safe common subfield is `include_usage`.
- Found a provider-profile gap:
  - Responses-to-Chat translation copied all caller `stream_options` subfields
    when `stream:true`;
  - direct Chat passthrough only filtered the whole field for non-streaming
    calls, so OpenAI-only subfields could still reach DeepSeek during streams;
  - legacy `/v1/completions` streaming also copied caller `stream_options`
    before adding bridge usage chunks.
- Added provider-aware `stream_options` subfield filtering:
  - introduced reusable `filterStreamOptionsForProvider`;
  - added `CODEXCOMPAT_STREAM_OPTION_FIELDS`, defaulting to `include_usage` for
    DeepSeek providers and unrestricted for other OpenAI-compatible providers;
  - supports `*` / `all` for unrestricted forwarding and `none` for filtering
    all subfields;
  - applied the filter to Responses translation, direct Chat passthrough, and
    legacy Completions streaming;
  - records filtered subfields with
    `metadata.compatibility.stream_options.reason=provider_stream_option_filter`
    or `metadata.compatibility.chat_passthrough.stream_options.reason=provider_stream_option_filter`.
- Hardened live regression stability:
  - `responses-inline-moderation` and `responses-prompt-template-local` are
    exact-marker protocol tests, not reasoning-quality tests, so the harness now
    sends `reasoning:{effort:"none"}` for those two cases to avoid DeepSeek
    returning hidden reasoning without visible text.
  - Targeted reruns for both cases passed after the adjustment.
- Added regression coverage:
  - translator tests cover unrestricted caller subfields and DeepSeek-style
    allowlist filtering;
  - server tests cover Responses streaming filtering, direct Chat streaming
    stored-completion filtering, legacy Completions streaming filtering, and
    DeepSeek default config behavior;
  - live eval harness checks `include_obfuscation` is filtered while
    `include_usage` remains available for Responses SSE and direct Chat stream
    lifecycle cases.
- Verification:
  - `node --check src/bridge/translator.js`, `node --check src/bridge/server.js`,
    `node --check scripts/eval-harness.mjs`, and `git diff --check`: passed.
  - `node --test test/translator.test.js --test-name-pattern "stream options"`:
    34/34 passing tests.
  - `node --test test/server.test.js --test-name-pattern "stream_options|streams Chat chunks|completions streams|streams and stores reconstructed|loadConfig filters"`:
    90/90 passing tests.
  - `npm test`: 127/127 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `responses-stream-events` passed 1/1 against
    `deepseek-v4-pro`, latency 1324 ms, total usage 50 tokens, visible text
    `stream-ok`, and stream-option subfield filter metadata checks passed.
  - Targeted live `chat-stream-lifecycle` passed 1/1 against
    `deepseek-v4-pro`, latency 1143 ms, total usage 19 tokens, visible text
    `chat-stream-life-ok`, stored Chat lifecycle checks passed, and direct Chat
    stream-option subfield filter metadata checks passed.
  - Targeted live `responses-inline-moderation` passed 1/1 after non-thinking
    marker hardening, latency 1156 ms, total usage 19 tokens, visible text
    `inline-moderation-ok`.
  - Targeted live `responses-prompt-template-local` passed 1/1 after
    non-thinking marker hardening, latency 806 ms, total usage 27 tokens,
    visible text `prompt-template-ok`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 770 ms, P95 latency 828 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 47/47 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1050 ms, P95 latency 2029 ms, and total usage
    9594 tokens.
  - UI smoke passed with marker `ui-smoke-mq8moyd4`, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-16-36-088Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 541 runtime candidates,
    selected 47 old UI screenshots by retention policy, deleted 0, selected
    3702996 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; repository checkout
    is 48 MB, `state/` is 4.8 MB, `output/` is 7.9 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Chat reasoning object compatibility

- Documentation basis:
  - OpenAI Chat Completions Create API and OpenAPI schema document a top-level
    Chat `reasoning` object as well as `reasoning_effort`.
  - DeepSeek Create Chat Completion documents Chat-compatible
    `reasoning_effort` / `thinking` controls, but not OpenAI's top-level
    Chat `reasoning` object.
  - Sources: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`
    and `https://api-docs.deepseek.com/api/create-chat-completion`.
- Found a direct Chat passthrough gap:
  - `/v1/responses` already normalized `reasoning.effort` before forwarding to
    DeepSeek-compatible Chat providers;
  - direct `/v1/chat/completions` normalized `reasoning_effort`, but an
    OpenAI Chat request using `reasoning:{effort,...}` could still forward the
    unsupported `reasoning` object to DeepSeek;
  - unsupported sibling fields such as `summary` needed explicit filtering and
    metadata instead of silent forwarding.
- Added provider-aware Chat reasoning object normalization:
  - direct Chat passthrough now removes top-level `reasoning` for DeepSeek
    compatibility mode;
  - `reasoning.effort` is promoted into the existing `reasoning_effort`
    normalizer, so values such as `none` map to DeepSeek `thinking` controls;
  - unsupported `reasoning` sibling fields are recorded in
    `metadata.compatibility.chat_passthrough.reasoning.filtered`;
  - explicit caller `reasoning_effort` takes precedence over
    `reasoning.effort`, and the precedence is recorded in compatibility
    metadata.
- Added regression coverage:
  - server tests verify direct Chat `reasoning:{effort:"none",summary:"auto"}`
    is converted to DeepSeek `thinking:{type:"disabled"}` with `summary`
    filtered from the upstream request;
  - server tests verify explicit `reasoning_effort` wins when both forms are
    present;
  - live `bridge-regression` now includes `chat-reasoning-object-compat` and
    checks visible output plus compatibility metadata for the object-to-effort
    mapping.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `git diff --check`: passed.
  - `node --test test/server.test.js --test-name-pattern "reasoning object|reasoning_effort values|normalizes OpenAI Chat fields"`:
    92/92 passing tests.
  - `npm test`: 129/129 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-reasoning-object-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 959 ms, total usage 23 tokens, visible text
    `chat-reasoning-object-ok`, and reasoning-object compatibility metadata
    checks passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 855 ms, P95 latency 858 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 48/48 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1101 ms, P95 latency 2095 ms, and total usage
    9652 tokens.
  - A prior full `bridge-regression` run passed 47/48 because the model returned
    the adjacent web-search marker for `responses-max-tool-calls`; a targeted
    rerun of that case passed 1/1 with `web-budget-ok [1]`, latency 1441 ms,
    and total usage 406 tokens before the clean 48/48 full rerun.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8ncb7e`, page load/authentication, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-34-45-818Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 576 runtime candidates,
    selected 48 old UI screenshots by retention policy, deleted 0, selected
    3790202 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; repository checkout
    is 49 MB, `state/` is 5.1 MB, `output/` is 8.0 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Chat custom tool filtering for DeepSeek

- Documentation basis:
  - OpenAI Chat Completions Create API documents Chat `tools` as either custom
    tools or function tools, and includes OpenAI-only request fields such as
    `n`.
  - DeepSeek Create Chat Completion documents `tools` as function-only: the
    tool type enum is `function`, and the docs state that only functions are
    currently supported as tools.
  - Sources: `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create`,
    `https://developers.openai.com/api/docs/guides/function-calling`, and
    `https://api-docs.deepseek.com/api/create-chat-completion`.
- Found a direct Chat passthrough gap:
  - direct `/v1/chat/completions` could forward OpenAI Chat custom tool entries
    such as `type:"custom"` to DeepSeek, even though DeepSeek only documents
    function tools;
  - a custom `tool_choice` could also reach DeepSeek after unsupported tools
    were filtered or when no forwardable function tool remained;
  - direct Chat filtering also missed request-side `n`, while the compatibility
    matrix already documented `n` as a provider-aware OpenAI Chat field.
- Added provider-aware custom-tool filtering:
  - introduced `CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS`, defaulting to `false`
    for DeepSeek providers and `true` for other OpenAI-compatible providers;
  - direct Chat passthrough now removes non-`function` tools when the upstream
    provider is function-tool-only, keeps forwardable function tools, and
    records compact tool descriptors under
    `metadata.compatibility.chat_passthrough.custom_tools`;
  - incompatible custom `tool_choice` values are removed, and `tool_choice` is
    also removed when no forwardable function tools remain;
  - direct Chat provider-field filtering now includes `n`.
- Added regression coverage:
  - server tests verify custom tools are filtered while function tools remain,
    incompatible custom `tool_choice` is removed, and compatibility metadata
    records forwarded and filtered tool descriptors;
  - server tests verify direct Chat `n` is filtered for DeepSeek-compatible
    providers;
  - config tests verify DeepSeek defaults to `forwardChatCustomTools:false`
    while generic OpenAI-compatible providers default to true;
  - live `bridge-regression` now includes `chat-custom-tool-filter-compat` and
    checks visible output plus compatibility metadata for all-custom tool
    filtering.
- Verification:
  - `node --check src/bridge/server.js`, `node --check scripts/eval-harness.mjs`,
    and `git diff --check`: passed.
  - `node --test test/server.test.js --test-name-pattern "custom tools|normalizes OpenAI Chat fields|loadConfig filters"`:
    93/93 passing tests.
  - `npm test`: 130/130 passing tests.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge healthz returned
    `ok:true`, DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`.
  - Targeted live `chat-custom-tool-filter-compat` passed 1/1 against
    `deepseek-v4-pro`, latency 1002 ms, total usage 25 tokens, visible text
    `chat-custom-tool-filter-ok`, and custom-tool compatibility metadata checks
    passed.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 923 ms, P95 latency 960 ms, and total usage 99 tokens.
  - Full live `bridge-regression` passed 49/49 against `deepseek-v4-pro`, pass
    rate 1.0, average latency 1028 ms, P95 latency 2115 ms, and total usage
    9623 tokens.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8nq5hy`, page load/authentication, sidebar controls, new
    conversation submit, reload persistence, console errors 0, warnings 0, and
    screenshot `output/playwright/ui-smoke-2026-06-10T22-45-31-606Z.png`.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 590 runtime candidates,
    selected 49 old UI screenshots by retention policy, deleted 0, selected
    3877672 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    public HTTPS returned HTTP 200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.0 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Expanded UI workflow smoke coverage

- Found a UI workflow coverage gap in the always-on Playwright smoke:
  - it loaded the app, exercised sidebar/search/settings, sent one prompt, and
    verified reload persistence;
  - it did not yet touch the project menu/dialog, the browser-upload bridge,
    project writable-root host services, or stop/retry control discovery.
- Added UI workflow coverage:
  - `scripts/ui-smoke.mjs` now opens the project menu, verifies both new-project
    and existing-folder menu entries, opens the new-project dialog, fills a
    unique smoke project name, and cancels so no project records accumulate;
  - the smoke calls a new browser host service,
    `codexappHostServices.browserUploads.uploadFiles`, to upload a tiny text
    fixture through the same server-side browser-upload path used by file drops;
  - the smoke verifies the uploaded file exists under `state/browser-uploads/`
    and its contents match the fixture;
  - the smoke adds and clears a project writable root through
    `codexappHostServices.projectWritableRoots`, proving the project host-state
    channel remains round-trippable;
  - after the model turn, it records visible stop/retry-style controls for
    workflow observability.
- Kept the UI smoke actionable:
  - Radix dialog title/description development warnings are now treated as
    known benign console noise in the injected web bridge and in the smoke
    collector, matching the existing handling for other third-party browser
    telemetry noise;
  - non-benign console errors still fail the smoke.
- Updated documentation:
  - `docs/evaluation-plan.md` now lists project dialog, upload fixture,
    project writable-root add/clear, and stop/retry discovery as covered UI
    smoke behavior;
  - `docs/deployment.md` now explains the expanded `smoke:ui` behavior and the
    remaining UI gaps.
- Verification:
  - `node --check web-server.js` and `node --check scripts/ui-smoke.mjs`:
    passed.
  - `git diff --check`: passed.
  - `npm test`: 130/130 passing tests.
  - Restarted `aialra-opencodexapp-web.service`; local web health returned
    HTTP 200, and public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8o58jj`, page load/authentication, sidebar controls, project
    dialog open/cancel, existing-folder menu detection, browser-upload fixture
    write and filesystem verification, project writable-root add/clear, new
    conversation submit, visible stop control discovery, reload persistence,
    console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T22-57-15-391Z.png`.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 928 ms, P95 latency 952 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 596 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.1 MB,
    `/srv/aialra/data/opencodexapp` is 48 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - HumanEval/MBPP-style code benchmark suite

- Found a quality-evaluation gap:
  - `scripts/code-benchmark.mjs` had only the default `micro` suite with three
    simple JavaScript repair tasks;
  - `docs/evaluation-plan.md` still called out HumanEval/MBPP-style unit-test
    tasks as a planned quick regression signal before heavier SWE-bench runs.
- Added a new explicit benchmark suite:
  - `npm run bench:code -- --suite humaneval-mbpp --timeout-ms 180000`;
  - cases cover balanced bracket validation, stable de-duplication by computed
    key, deterministic word-frequency ranking, and non-mutating square-matrix
    rotation;
  - default `npm run bench:code` behavior remains the low-cost `micro` suite.
- Updated documentation:
  - README verification commands now include the new suite;
  - deployment/evaluation docs list the suite and the covered task families;
  - the evaluation plan now treats HumanEval/MBPP-style tasks as present quick
    regression signal rather than future work.
- Verification:
  - `node --check scripts/code-benchmark.mjs`: passed.
  - `git diff --check`: passed.
  - `npm test`: 130/130 passing tests.
  - Unknown-suite CLI guard still exits 2 and lists `micro, humaneval-mbpp`.
  - Default live `micro` code benchmark still passed 3/3 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 19202 ms, P95 latency
    27771 ms, and total usage 6088 tokens.
  - Live `humaneval-mbpp` code benchmark passed 4/4 against `deepseek-v4-pro`,
    pass rate 1.0, average latency 7813 ms, P95 latency 10219 ms, and total
    usage 4423 tokens. Before-fix tests failed and after-fix tests passed for
    all four cases.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1059 ms, P95 latency 1065 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 598 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Report artifact written outside release docs at
    `/srv/aialra/data/opencodexapp/eval/code-benchmark/humaneval-mbpp-latest.json`;
    transient work directories remain under ignored `output/code-benchmark/`.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.2 MB,
    `/srv/aialra/data/opencodexapp` is 68 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.
  - This suite is not a SWE-bench substitute; it is a small, deterministic
    pass/fail sentinel for issue-to-patch generation quality.

## 2026-06-11 - Repository-maintenance code benchmark suite

- Closed the next evaluation-plan gap for bridge-repo maintenance scenarios:
  - added `npm run bench:code -- --suite repo-maintenance --timeout-ms 180000`;
  - cases cover deployment documentation with provider env vars and secret
    hygiene, writable project-root normalization, Responses-style function-call
    tool loops, and previous-response multi-turn replay reconstruction;
  - default `npm run bench:code` behavior remains the low-cost `micro` suite.
- Updated documentation:
  - README verification commands include the new suite;
  - deployment verification checklist includes the new suite;
  - evaluation plan now describes repository-maintenance tasks as present quick
    benchmark coverage rather than future work.
- Verification:
  - `node --check scripts/code-benchmark.mjs`: passed.
  - `git diff --check`: passed.
  - Unknown-suite CLI guard exits 2 and lists
    `micro, humaneval-mbpp, repo-maintenance`.
  - Live `repo-maintenance` code benchmark passed 4/4 against
    `deepseek-v4-pro`, pass rate 1.0, average latency 19652 ms, P95 latency
    38633 ms, and total usage 9465 tokens. Before-fix tests failed and
    after-fix tests passed for all four cases.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1131 ms, P95 latency 1177 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 599 runtime candidates,
    selected 51 old UI screenshots by retention policy, deleted 0, selected
    4051398 bytes, and reported 0 errors.
  - Report artifact written outside release docs at
    `/srv/aialra/data/opencodexapp/eval/code-benchmark/repo-maintenance-latest.json`;
    transient work directories remain under ignored `output/code-benchmark/`.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 39 GB available; repository checkout
    is 50 MB, `state/` is 5.2 MB, `output/` is 8.3 MB,
    `/srv/aialra/data/opencodexapp/eval/code-benchmark` is 36 KB, and
    `/srv/aialra/logs/opencodexapp` is 15 MB.
  - No API keys, account credentials, or local secret files were committed.
  - This suite is still a deterministic quick signal; it supports the larger
    quality program but does not replace SWE-bench scoring or justify a 95%
    parity claim on its own.

## 2026-06-11 - Active UI interrupt and recovery smoke coverage

- Extended `scripts/ui-smoke.mjs` with an opt-in active browser workflow:
  - `npm run smoke:ui -- --timeout-ms 240000 --exercise-active-controls`;
  - starts a long-running model turn in a fresh conversation;
  - finds the visible stop/interrupt control using short accessible button
    labels to avoid matching conversation-history text;
  - clicks the stop control, verifies it clears, records any visible
    retry/regenerate/continue controls, and submits a recovery prompt to prove
    the conversation remains usable after interruption.
- Kept the default `npm run smoke:ui -- --timeout-ms 180000` path unchanged for
  cheaper routine checks.
- Updated README, deployment, and evaluation docs with the new command and the
  remaining retry/regenerate limitation:
  - the active interrupted-turn UI did not expose a visible
    retry/regenerate/continue control in the verified run;
  - completed-turn retry/regenerate still needs a dedicated browser path when
    that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8p0d4h`: load/authentication, sidebar controls, project dialog
    open/cancel, browser-upload fixture write and filesystem verification,
    project writable-root add/clear, prompt submit, reload persistence, active
    stop click with control name `停止`, `stop_cleared:true`,
    `retry_control_status:"not_visible_after_interrupt"`, recovery marker
    occurrences 2, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-21-27-665Z.png`.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8p30wk`, existing default coverage, console errors 0, warnings
    0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-23-31-796Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 938 ms, P95 latency 981 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 604 runtime candidates,
    selected 56 old UI screenshots by retention policy, deleted 0, selected
    4484726 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 38 GB available; repository checkout
    is 51 MB, `state/` is 5.3 MB, `output/` is 8.8 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 16 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Core UI page-switch smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with core
  sidebar page switching:
  - restores the sidebar when earlier controls hide it;
  - opens the Plugins, Automation, and Codex Mobile views;
  - validates page-specific main-content text instead of generic body text, so
    sidebar labels cannot produce false positives;
  - returns to New Chat and verifies the composer is usable before continuing
    project/upload and model-turn checks.
- Tightened stop/retry control discovery to short accessible button labels so
  older conversation titles containing words like `stop` no longer pollute the
  recorded control list.
- Updated deployment and evaluation docs:
  - default UI smoke now documents plugins/automation/mobile page switching and
    return-to-chat coverage;
  - remaining UI gaps are saved project open, generated artifact display, and
    completed-turn retry/regenerate coverage when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8pcmcg`: core page switches visited `plugins`, `automation`,
    and `mobile`, `returned_to_new_chat:true`, project dialog open/cancel,
    browser-upload fixture write and filesystem verification, project
    writable-root add/clear, prompt submit, reload persistence, short-label
    stop/retry controls `[]`, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-30-59-488Z.png`.
  - Active UI smoke also passed with marker `ui-smoke-mq8pk1dv`, including the
    same core page switches plus active stop click with control name `停止`,
    `stop_cleared:true`, recovery marker occurrences 2, console errors 0,
    warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-10T23-36-45-571Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1155 ms, P95 latency 1214 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 607 runtime candidates,
    selected 59 old UI screenshots by retention policy, deleted 0, selected
    4744738 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 37 GB available; repository checkout
    is 52 MB, `state/` is 5.3 MB, `output/` is 9.1 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 17 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Saved project open UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with saved
  project coverage:
  - creates a unique UI-smoke project through the real Projects menu;
  - verifies the saved project appears in the sidebar;
  - navigates away to Plugins, reopens the project from the sidebar, and checks
    the project context returns;
  - removes the generated workspace root through the browser bridge and then
    applies a file-level cleanup fallback for ignored local state.
- Hardened active UI coverage while validating the new saved-project path:
  - active prompts now request chat-only long output to avoid file-artifact
    shortcuts during stop-control testing;
  - visible stop matching uses exact short labels such as `停止` and
    `Stop generating`, preventing false matches against old conversation text;
  - button discovery is viewport-bounded for faster and less noisy polling;
  - the result records a composer-action fallback path if a future UI renders
    the stop action without accessible text.
- Updated README, deployment notes, and the evaluation plan:
  - active UI smoke command now uses
    `npm run smoke:ui -- --timeout-ms 260000 --exercise-active-controls`;
  - saved project open is no longer listed as a remaining UI gap;
  - remaining UI gaps are generated artifact display and a dedicated
    completed-turn retry/regenerate path when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8r08xl`: core page switches visited `plugins`, `automation`,
    and `mobile`; active stop clicked with control name `停止`;
    `stop_control_rect:{x:1122,y:668,w:28,h:28}`;
    `interrupt_method:"named_stop_control"`; `stop_cleared:true`;
    `retry_control_status:"not_visible_after_interrupt"`; recovery marker
    occurrences 2; saved project `UI smoke saved ui-smoke-mq8r08xl` created
    and reopened; cleanup removed
    `/srv/aialra/apps/open-codex-app-web-gateway/state/browser-workspaces/2026-06-11-ui-smoke-saved-ui-smoke-mq8r08xl`
    with `bridge_updated:true`; console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-17-21-465Z.png`.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8qt71d`: core page switching, project dialog open/cancel,
    browser-upload fixture write and filesystem verification, writable-root
    add/clear, prompt submit, reload persistence, saved project
    `UI smoke saved ui-smoke-mq8qt71d` created and reopened, cleanup removed
    `/srv/aialra/apps/open-codex-app-web-gateway/state/browser-workspaces/2026-06-11-ui-smoke-saved-ui-smoke-mq8qt71d`
    with `bridge_updated:true`, console errors 0, warnings 0, and screenshot
    `output/playwright/ui-smoke-2026-06-11T00-11-52-417Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 982 ms, P95 latency 1221 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 620 runtime candidates,
    selected 72 old UI screenshots by retention policy, deleted 0, selected
    5869605 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    5.4 MB, `output/` is 11 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 19 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Generated image artifact UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with generated
  image artifact display coverage:
  - resolves the newly created smoke thread from the isolated deployment
    `state_5.sqlite`;
  - validates the rollout path stays under the deployment Codex sessions root;
  - appends a temporary `image_generation_end` event with a tiny PNG data
    payload;
  - reopens the matching thread from the sidebar and asserts the page renders a
    visible generated-image `data:image/*` artifact;
  - truncates the rollout back to its original byte size in `finally`, including
    failure paths.
- Hardened the sidebar thread selection used by this path:
  - the smoke now searches only visible sidebar/non-main interactive elements
    containing the marker;
  - the result records the clicked element tag, role, label, and rectangle so
    later regressions have enough DOM context to diagnose.
- Updated deployment and evaluation docs:
  - default UI smoke now documents generated image artifact display coverage;
  - the remaining documented automated UI gap is a dedicated completed-turn
    retry/regenerate path when that action is visible.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8rlbzo`: generated artifact step rendered one image with alt
    `已生成图像 1`, `src_prefix:"data:image/png;base64,iVBORw0K"`,
    natural size `1x1`, rendered rectangle `{x:422,y:263,w:178,h:178}`, and
    `rollout_truncated:true`; console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-33-45-204Z.png`.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8rno9i`: generated artifact rendering also passed, active stop
    clicked with control name `停止`, `stop_cleared:true`,
    `retry_control_status:"not_visible_after_interrupt"`, recovery marker
    occurrences 2, saved project cleanup `bridge_updated:true`, console errors
    0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-35-34-422Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 916 ms, P95 latency 1016 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 626 runtime candidates,
    selected 78 old UI screenshots by retention policy, deleted 0, selected
    6382278 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 43 GB available; `state/` is
    5.4 MB, `output/` is 11 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 20 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Completed turn action UI smoke coverage

- Extended the default `scripts/ui-smoke.mjs` browser workflow with completed
  turn action coverage:
  - waits for the model turn to settle after the main chat content contains
    both the user prompt marker and assistant response marker, preventing
    sidebar titles from prematurely satisfying the completion check;
  - hovers the completed user message, assistant output, and broad completed
    turn container;
  - records and asserts main-content action controls for `编辑用户消息`,
    `复制消息`, `编辑消息`, assistant `复制`, and `从此处开始分叉`;
  - opens the top `对话操作` menu and records the visible menu items;
  - detects compact assistant action icons by geometry as a fallback for
    transiently unlabeled icon buttons.
- Tightened retry/continue control discovery:
  - default stop/retry discovery now requires exact short accessible labels and
    viewport visibility, so old conversation titles containing words such as
    `retry` cannot pollute results;
  - active interrupt recovery now uses the same exact short-label matching,
    preventing the smoke from clicking sidebar history items as retry buttons.
- Hardened reload persistence:
  - after reload, the smoke first checks whether the current main view still
    contains the marker;
  - if the app returns to the new-chat screen, it reopens the matching sidebar
    thread and then verifies the marker in main content.
- Updated deployment and evaluation docs:
  - default UI smoke now documents completed-turn copy/edit/branch and
    conversation menu coverage;
  - the current UI is recorded as exposing branch-from-here rather than
    retry/regenerate, with `completed_turn_retry_regenerate_visible:false`.
- Verification:
  - `node --check scripts/ui-smoke.mjs`: passed.
  - `git diff --check`: passed.
  - Default UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8sisdo`: `turn_settled_before_completed_actions:true`;
    completed turn controls included `编辑用户消息`, `复制消息`, `编辑消息`,
    `复制`, and `从此处开始分叉`; conversation action menu items included
    `置顶对话`, `重命名对话`, `归档对话`, `打开侧边聊天`, `复制`, and
    `添加自动化…`; `completed_turn_retry_regenerate_visible:false`;
    reload recovered through sidebar with `reopened_from_sidebar_after_reload:true`;
    generated image artifact rendering and saved project cleanup also passed;
    console errors 0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T00-59-46-092Z.png`.
  - Active UI smoke passed at `https://opencodexapp.aialra.online` with marker
    `ui-smoke-mq8soxvq`: completed-turn controls and conversation menu passed;
    generated image artifact rendering passed; active stop clicked with control
    name `停止`; `stop_cleared:true`; `controls_after_interrupt:[]`;
    `retry_control_status:"not_visible_after_interrupt"`; recovery marker
    occurrences 2; saved project cleanup `bridge_updated:true`; console errors
    0, warnings 0; screenshot
    `output/playwright/ui-smoke-2026-06-11T01-04-33-158Z.png`.
  - `npm test`: 130/130 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1070 ms, P95 latency 1075 ms, and total usage 99 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Service state: bridge, web, and app-server services were all `active`;
    bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 42 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Local image_generation Responses compatibility

- Added a local hosted-tool adapter for Responses
  `tools:[{type:"image_generation"}]`:
  - reserves `image_generation` so Chat Completions providers do not receive an
    unsupported hosted tool or hosted `tool_choice`;
  - emits `image_generation_call` output items with `status`, `revised_prompt`,
    and base64 PNG `result`;
  - emits streaming `response.image_generation_call.partial_image` events when
    `partial_images` is requested;
  - participates in the shared local `max_tool_calls` budget and records
    skipped image calls in compatibility metadata;
  - injects bounded local context into upstream Chat requests without putting
    base64 image bytes into the prompt;
  - is included in background response preparation checkpoints and persisted
    local output items.
- The default provider is `placeholder`, which creates deterministic non-empty
  PNGs from the prompt and requested image options. This closes the protocol,
  SDK, UI rendering, streaming, and background workflow gap for Chat-only
  providers, but it is not GPT Image semantic quality parity or high-fidelity
  editing. Provider-backed image generation/editing remains a future parity
  task.
- Updated configuration and docs:
  - `.env.example` now lists `CODEXCOMPAT_IMAGE_GENERATION_PROVIDER`,
    `CODEXCOMPAT_IMAGE_GENERATION_PLACEHOLDER_SIZE`, and
    `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_IMAGE_GENERATION`;
  - compatibility docs now describe the adapter boundary and updated known gap;
  - deployment docs list the new environment variables;
  - evaluation docs and `scripts/eval-harness.mjs` include a
    `responses-image-generation` bridge-regression case.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check test/translator.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused image-generation tests passed 4/4:
    `node --test --test-name-pattern='image_generation|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 134/134 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1126 ms, P95 latency 1159 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro`, latency 1153 ms, and total usage 186 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct request-based Audio API compatibility

- Used official OpenAI developer docs and OpenAPI endpoint specs for
  request-based Audio APIs:
  - `POST /v1/audio/speech` (`createSpeech`);
  - `POST /v1/audio/transcriptions` (`createTranscription`);
  - `POST /v1/audio/translations` (`createTranslation`);
  - audio guide boundary between request-based Audio APIs and Realtime voice.
- Added local direct Audio compatibility for Chat-only provider deployments:
  - `POST /v1/audio/speech` accepts JSON speech requests and returns
    deterministic placeholder bytes for `mp3`, `opus`, `aac`, `flac`, `wav`,
    and `pcm`, plus optional `speech.audio.*` SSE events;
  - `POST /v1/audio/transcriptions` accepts official multipart `file`
    requests and JSON/base64 Batch-compatible file shapes; supports `json`,
    `verbose_json`, `diarized_json`, `text`, `srt`, `vtt`, and transcription
    SSE events;
  - `POST /v1/audio/translations` accepts official multipart `file` requests
    and JSON/base64 Batch-compatible file shapes; supports `json`,
    `verbose_json`, `text`, `srt`, and `vtt`;
  - local Batch JSONL now supports `/v1/audio/transcriptions` and
    `/v1/audio/translations` while leaving `/v1/audio/speech` direct-only
    because Batch output files are JSONL and speech responses are binary.
- Added deployment configuration for local Audio defaults:
  - `CODEXCOMPAT_AUDIO_PROVIDER`;
  - `CODEXCOMPAT_AUDIO_SPEECH_MODEL`;
  - `CODEXCOMPAT_AUDIO_TRANSCRIPTION_MODEL`;
  - `CODEXCOMPAT_AUDIO_TRANSLATION_MODEL`;
  - `CODEXCOMPAT_AUDIO_DEFAULT_VOICE`;
  - `CODEXCOMPAT_AUDIO_MAX_INPUT_BYTES`.
- Updated compatibility, deployment, and evaluation docs. The known audio gap
  is now narrowed: request-based protocol coverage exists locally, but
  text-only providers such as DeepSeek still do not natively understand audio
  or synthesize semantic audio; Realtime sessions, custom voice governance, and
  provider-backed audio quality remain future work.
- Added regression coverage:
  - unit tests for direct speech bytes, multipart transcription, JSON/base64
    transcription SSE, multipart translation, JSON/base64 translation, and
    local Batch Audio transcription/translation JSONL;
  - eval harness cases `audio-speech`, `audio-transcription`,
    `audio-translation`, `batch-audio-transcription`, and
    `batch-audio-translation`.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Audio server tests passed 120/120 under the selected test pattern.
  - `npm test`: 158/158 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    726 candidates, selected 91 old UI screenshots by retention policy,
    deleted 0 files, selected 7469499 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `bridge-regression` Audio cases passed after restart:
    `audio-speech` 1/1 at 125 ms with `audio/wav` bytes,
    `audio-transcription` 1/1 at 68 ms,
    `audio-translation` 1/1 at 62 ms,
    `batch-audio-transcription` 1/1 at 224 ms, and
    `batch-audio-translation` 1/1 at 151 ms.
  - `npm run smoke:bridge`: returned a completed response with
    `output_text:"bridge-ok"`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online`; login/public entry, sidebar
    controls, navigation, project dialog/upload services, conversation submit,
    reload persistence, generated image artifact display, saved project reopen,
    and cleanup all passed with no console errors or warnings.
  - Disk/storage check before restart: filesystem had 42 GB available;
    `state/` was 7.2 MB, `output/` was 12 MB,
    `/srv/aialra/data/opencodexapp` was 84 KB, and
    `/srv/aialra/logs/opencodexapp` was 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Direct Images variations compatibility

- Used the official OpenAI OpenAPI operation `createImageVariation`
  (`POST /v1/images/variations`) as the source of truth for the endpoint shape:
  multipart form input, one `image`, `ImagesResponse` output, and default
  compatibility with `dall-e-2`.
- Added direct local `POST /v1/images/variations` support:
  - accepts official multipart requests with `image`, `model`, `n`, `size`,
    `response_format`, and `user`;
  - validates missing image input as `missing_required_parameter` on `image`;
  - returns deterministic placeholder PNG `ImagesResponse` data when the image
    provider is `placeholder`;
  - forwards provider-backed variation requests as multipart form data to the
    configured `/images/variations` provider path;
  - normalizes provider responses through the same Images API response adapter
    used by direct generations and edits;
  - keeps provider credentials sourced only from local environment variables.
- Added Batch-compatible JSON input for variations because Batch JSONL cannot
  carry multipart file parts:
  - JSON bodies can reference source images through `image`, `images`, or
    `image_url`;
  - accepted image sources include data URLs, HTTP(S) URLs, and local `file_id`
    references through the existing bounded image resolver;
  - local Batch now lists and executes `/v1/images/variations` alongside
    `/v1/images/generations` and `/v1/images/edits`.
- Added configuration and documentation:
  - `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_PATH`, default
    `/images/variations`;
  - `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_MODEL`, default `dall-e-2`;
  - updated `.env.example`, deployment docs, compatibility matrix, and
    evaluation plan.
- Added regression coverage:
  - multipart placeholder variation success;
  - missing-image validation;
  - OpenAI-compatible provider multipart forwarding;
  - local Batch JSONL execution over `/v1/images/variations`;
  - live eval cases `images-variation` and `batch-images-variation`.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused variation tests passed 116/116 in `test/server.test.js` under
    `node --test test/server.test.js --test-name-pattern
    "images/variations|Images variation"`; Node ran the full file while the
    new variation and Batch variation tests passed.
  - `npm test`: 154/154 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `images-variation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro` after the final bridge restart, pass rate 1.0,
    latency 76 ms, and output
    `images:2`.
  - Live `batch-images-variation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, pass rate 1.0, latency 191 ms, request counts
    `total:1`, `completed:1`, `failed:0`, and no error file.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    724 runtime candidates, selected 90 old UI screenshots by retention policy,
    deleted 0 files, selected 7353648 bytes, and reported 0 errors.
  - Disk/storage check: the filesystem has 39 GB available; `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Videos API protocol compatibility

- Used official OpenAI developer documentation before implementation:
  - Video generation guide: `POST /v1/videos` creates an async job, `GET
    /v1/videos/{video_id}` polls status, and `GET
    /v1/videos/{video_id}/content` downloads `video`, `thumbnail`, or
    `spritesheet` variants.
  - Batch guide: Batch supports JSON requests to `POST /v1/videos` and does not
    support multipart video inputs.
  - OpenAPI endpoint list: `/v1/videos`, `/v1/videos/{video_id}`,
    `/v1/videos/{video_id}/content`, `/v1/videos/edits`,
    `/v1/videos/extensions`, and `/v1/videos/{video_id}/remix` are current
    Videos API surfaces.
- Added local Videos API compatibility for Chat-Completions-only deployments:
  - `POST /v1/videos` accepts JSON or multipart video creation requests and
    returns a completed OpenAI-style `object:"video"` job with model, status,
    progress, size, seconds, quality, and compatibility metadata.
  - `GET /v1/videos`, `GET /v1/videos/{video_id}`, and
    `DELETE /v1/videos/{video_id}` provide local lifecycle coverage.
  - `GET /v1/videos/{video_id}/content` returns tiny placeholder bytes for
    `variant=video`, `thumbnail`, and `spritesheet` with matching content
    types, keeping `/srv/aialra/apps` disk usage bounded.
  - `POST /v1/videos/edits`, `/v1/videos/extensions`, and
    `/v1/videos/{video_id}/remix` return completed local video jobs with
    operation metadata for UI/SDK workflow compatibility.
  - Local Batch execution now supports `/v1/videos` JSONL lines and writes video
    resources into Batch output files.
- Added configuration:
  - `CODEXCOMPAT_VIDEO_GENERATION_PROVIDER`;
  - `CODEXCOMPAT_VIDEO_GENERATION_MODEL`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SIZE`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SECONDS`;
  - `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_QUALITY`;
  - `CODEXCOMPAT_VIDEO_GENERATION_MAX_INPUT_BYTES`.
- Updated compatibility and evaluation docs to move the gap from "no video
  endpoint coverage" to "protocol-compatible local placeholder, not hosted Sora
  rendering or media-quality parity."
- Verification so far:
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "Videos API|local Batch API executes local video"` ran the full server test file and passed 113/113 subtests, including the two new Videos API cases.
  - Temporary local bridge eval `video-lifecycle`: passed 1/1, created a
    `video_...` record, retrieved it, downloaded content, deleted it, and
    reported `output_text:"video:completed:content"`.
  - Temporary local bridge eval `batch-videos`: passed 1/1, completed a local
    Batch with one `/v1/videos` JSONL request, produced one output line, and no
    error file.
  - `npm test`: passed 151/151 subtests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed with exit code 0.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`.
  - Bridge healthz returned `ok:true`, DeepSeek provider base
    `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Post-restart live `video-lifecycle` bridge-regression case passed 1/1 on
    `http://127.0.0.1:12912`, including create, retrieve, content download,
    list, and delete, with latency 166 ms.
  - Post-restart live `batch-videos` bridge-regression case passed 1/1 on
    `http://127.0.0.1:12912`, completing one `/v1/videos` JSONL request with
    one output line and no error file, latency 217 ms.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned 724
    runtime candidates, selected 90 old UI screenshots by retention policy,
    deleted 0, selected 7353648 bytes, and reported 0 errors.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Direct Images API upstream SSE relay

- Used the official OpenAI Images OpenAPI endpoint specs for
  `POST /v1/images/generations` and `POST /v1/images/edits`:
  - `stream:true` generation responses use
    `image_generation.partial_image` and `image_generation.completed`;
  - `stream:true` edit responses use `image_edit.partial_image` and
    `image_edit.completed`;
  - `partial_images` controls streamed partial image count for GPT image
    models and is forwarded only when explicitly requested by the client.
- Replaced direct Images API streaming for provider-backed calls from
  final-image synthesis to upstream SSE relay:
  - generation stream requests now send JSON `stream:true` and optional
    `partial_images` to the configured `/images/generations` provider path;
  - edit stream requests now send multipart `stream=true` and optional
    `partial_images` to the configured `/images/edits` provider path;
  - upstream provider SSE frames are parsed incrementally, normalized by event
    name, and written to the client as they arrive;
  - provider JSON fallback and placeholder mode still synthesize compatible
    Image API SSE events from the final image for SDK compatibility;
  - streaming provider errors after headers are emitted as SSE `error` events,
    while pre-stream validation/provider HTTP errors keep OpenAI-style JSON
    errors.
- Added bridge-regression cases for direct Images generation/edit SSE:
  `images-generation-stream` and `images-edit-stream`.
- Updated compatibility and evaluation docs so the current known gaps no
  longer list true upstream Images partial-image relay as missing.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Images API streaming tests passed in the 111/111 reported server
    subtests:
    `node --test test/server.test.js --test-name-pattern "images/generations|images/edits|Images API|Images edit"`.
  - `npm test`: 149/149 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 707 runtime
    candidates, selected 90 old UI screenshots by retention policy, deleted
    0 files, selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz on
    `http://127.0.0.1:12912/healthz` returned `ok:true`, DeepSeek provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `images-generation-stream` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 69 ms, event count 3, output
    `image_generation:2:completed`, and zero model tokens because it is local
    placeholder image generation.
  - Live `images-edit-stream` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 52 ms, event count 3, output
    `image_edit:2:completed`, and zero model tokens because it is local
    placeholder image editing.
  - Full live `npm run eval:bridge`: 59/59 passing cases, pass rate 1.0,
    average latency 1240 ms, P95 latency 3423 ms, and total usage 10,720
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Disk/storage check: filesystem has 40 GB available; repo `state/` is
    7.2 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or
  local deployment env files were added to the repository.

## 2026-06-11 - Direct Images API edit endpoint and Batch coverage

- Used the official OpenAI Images edits OpenAPI endpoint shape for
  `POST /v1/images/edits`, including multipart source images and masks,
  JSON-form `images` inputs, `ImagesResponse` output, and
  `image_edit.partial_image` / `image_edit.completed` streaming event names.
- Added direct local `POST /v1/images/edits` support:
  - multipart requests accept repeated `image`, `image[]`, `images`, or
    `images[]` file parts plus optional `mask`;
  - JSON requests accept `images`, `image`, or `image_url` inputs using data
    URLs, inline base64 image data, bounded HTTP(S) URLs, and local Files API
    `file_id` references;
  - optional JSON or multipart masks are resolved with the same byte and media
    type validation as Responses image-generation edits;
  - placeholder mode returns deterministic multi-image base64 PNG responses
    without calling the Chat provider;
  - provider-backed mode calls the configured OpenAI-compatible multipart
    `/images/edits` path, forwards supported edit options, preserves all
    returned `data[]` entries, and maps provider errors into OpenAI-style JSON
    errors;
  - `stream:true` synthesizes direct Images edit SSE events from the final
    image so SDK streaming clients can parse the surface while true upstream
    partial relay remains documented as a gap.
- Extended local Batch API execution to accept JSON-form
  `/v1/images/edits` requests in addition to `/v1/images/generations` and the
  existing text/embedding/moderation endpoints.
- Updated:
  - `docs/compatibility-matrix.md` direct Images edit, Batch coverage, and
    known gaps;
  - `docs/deployment.md` image provider/env descriptions;
  - `docs/evaluation-plan.md` with `images-edit` and `batch-images-edit`
    bridge-regression coverage;
  - `scripts/eval-harness.mjs` with direct and Batch Images edit cases.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused server tests including direct Images edit and Batch edit coverage
    passed 111/111 reported subtests:
    `node --test test/server.test.js --test-name-pattern "images/edits|Images edit"`.
  - `npm test`: 149/149 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 691 runtime
    candidates, selected 90 old UI screenshots by retention policy, deleted
    0 files, selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz on
    `http://127.0.0.1:12912/healthz` returned `ok:true`, DeepSeek provider
    base `https://api.deepseek.com`, default model `deepseek-v4-pro`, and
    `has_provider_key:true`; public HTTPS returned HTTP 200 from
    `https://opencodexapp.aialra.online/`.
  - Live `images-edit` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 111 ms, zero model tokens because it is local
    placeholder image editing.
  - Live `batch-images-edit` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 221 ms, one completed Batch line and no error
    file.
  - Full live `npm run eval:bridge`: 57/57 passing cases, pass rate 1.0,
    average latency 1240 ms, P95 latency 2514 ms, and total usage 10,644
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - Direct runtime multipart smoke for `/v1/images/edits` returned HTTP 200
    with two `data[].b64_json` PNG images and an edit `revised_prompt`.
  - Disk/storage check: filesystem has 40 GB available; repo `state/` is
    6.9 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or
  local deployment env files were added to the repository.

## 2026-06-11 - Direct Images API generation endpoint and Batch coverage

- Used the official OpenAI Image generation guide and OpenAPI endpoint spec for
  `POST /v1/images/generations` to align the local bridge with the current
  Images API shape:
  - JSON requests include `prompt`, optional `model`, `n` from 1 to 10,
    output options such as `size`, `quality`, `background`, `moderation`,
    `output_format`, `output_compression`, `response_format`, `style`, and
    `user`;
  - non-streaming responses return `created`, `data[].b64_json`, optional
    `data[].revised_prompt`, and provider `usage` when present;
  - streaming responses use Image API SSE events
    `image_generation.partial_image` and `image_generation.completed`.
- Added direct local `POST /v1/images/generations` support:
  - placeholder mode returns deterministic base64 PNG data and supports
    multi-image `n` requests without calling the Chat provider;
  - provider-backed mode calls the configured OpenAI-compatible
    `/images/generations` path, forwards supported image options, preserves all
    returned `data[]` entries, and surfaces provider errors as OpenAI-style
    JSON errors;
  - `stream:true` synthesizes Image API SSE events from the final image so SDK
    streaming workflows can parse the endpoint, while true upstream partial
    chunk relay remains documented as a gap.
- Extended local Batch API execution to accept endpoint
  `/v1/images/generations` in addition to existing Responses, Chat,
  Completions, Embeddings, and Moderations endpoints. Batch JSONL output files
  now preserve the direct Images response body.
- Updated:
  - `docs/compatibility-matrix.md` direct Images and known-gap coverage;
  - `docs/deployment.md` image-generation provider/env descriptions;
  - `docs/evaluation-plan.md` live regression coverage;
  - `scripts/eval-harness.mjs` with `images-generation` and
    `batch-images-generation` bridge-regression cases.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused direct Images tests passed 5/5:
    `node --test --test-name-pattern "images/generations|direct Images|OpenAI-compatible Images API|direct Images generation" test/server.test.js`.
  - `npm test`: 145/145 passing tests.
  - Live `images-generation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 61 ms, zero model tokens because it is local
    placeholder image generation.
  - Live `batch-images-generation` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 153 ms, one completed Batch line and no error
    file.
  - Full live `npm run eval:bridge`: 55/55 passing cases, pass rate 1.0,
    average latency 1366 ms, P95 latency 2807 ms, and total usage 10,705
    tokens.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 691 candidates,
    selected 90 old UI screenshots by retention policy, deleted 0 files,
    selected 7,353,648 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Direct runtime smoke for `/v1/images/generations` returned two
    `data[].b64_json` PNG images.
  - Disk/storage check: filesystem has 38 GB available; repo `state/` is
    6.6 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed image_generation edits and masks

- Extended the local Responses `image_generation` adapter to cover edit and
  mask workflows in addition to generation:
  - `action:"edit"` now requires at least one resolved input image and returns
    a failed `image_generation_call` when no image is available, matching the
    documented hosted Responses behavior;
  - `action:"auto"` chooses edit when current input images or masks are present
    while avoiding a forced edit for prior `image_generation_call.id` references
    that do not yet have locally persisted image bytes;
  - provider-backed edit mode calls a configurable multipart endpoint,
    defaulting to `POST /images/edits`;
  - maps resolved input images to `image[]` and a resolved
    `input_image_mask` to `mask`;
  - fails requested-mask edits when the mask cannot be resolved instead of
    silently editing without the requested mask;
  - resolves edit inputs from local Files API `file_id`, data URLs, inline
    base64 image fields, HTTP(S) image URLs with bounded timeout/byte limits,
    and inline `image_generation_call.result` bytes;
  - records edit mode, resolved image count, mask resolution, and image
    resolution failures in compatibility metadata without storing image bytes;
  - replaces consumed Chat `image_url` content parts with a text marker during
    local edit mode so text-only providers such as DeepSeek do not reject the
    upstream Chat request after the bridge has already handled the image.
- Added configuration and docs:
  - `CODEXCOMPAT_IMAGE_GENERATION_EDIT_PATH`;
  - `CODEXCOMPAT_IMAGE_GENERATION_MAX_INPUT_IMAGE_BYTES`;
  - `CODEXCOMPAT_IMAGE_GENERATION_INPUT_FETCH_TIMEOUT_MS`;
  - compatibility/deployment docs now describe provider-backed multipart edits,
    mask mapping, forced-edit failure behavior, and the text-only provider
    sanitization boundary;
  - `scripts/eval-harness.mjs` now includes a `responses-image-edit`
    bridge-regression case.
- Verification:
  - Official OpenAI image-generation docs were checked via the OpenAI docs MCP:
    the Images API has `/images/generations` and `/images/edits`, edit requests
    use multipart `image[]` plus optional `mask`, and forced Responses
    `action:"edit"` without an image returns an error.
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused image-generation tests passed 9/9:
    `node --test --test-name-pattern='image_generation|Images API|image provider|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 139/139 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 1082 ms, P95 latency 1160 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro` after deployment restart, latency 1238 ms, and
    total usage 188 tokens.
  - Live `responses-image-edit` bridge-regression case initially exposed a
    DeepSeek `image_url` content-part rejection; after adding edit-input
    sanitization it passed 1/1 against `deepseek-v4-pro`, latency 1343 ms, and
    total usage 215 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; latest dry
    run reported response records scanned 479, selected 0, deleted 0, and no
    errors. Earlier full summary still selected 89 old UI screenshots by
    retention policy, deleted 0, selected 7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Image generation multi-turn call-id persistence

- Extended the local Responses `image_generation` adapter with generated image
  call persistence for multi-turn edit workflows:
  - successful `image_generation_call.result` bytes are stored under a local
    `local-image-generations` state directory with `0600` JSON files and a
    `0700` directory;
  - generated image state is bounded by
    `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGES`,
    `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGE_BYTES`, and
    `CODEXCOMPAT_IMAGE_GENERATION_STORE_TTL_MS`;
  - id-only follow-up inputs such as
    `{type:"image_generation_call",id:"ig_..."}` are resolved into edit images
    before provider-backed `/images/edits` calls;
  - `previous_response_id` now contributes prior image-generation output to
    local image context so official multi-turn image workflows can enter edit
    mode without resending base64 image data;
  - background and local Batch `/v1/responses` execution paths receive the same
    image-generation state store dependency as foreground requests.
- Added compatibility metadata for generated/stored image-call counts and
  updated `.env.example`, deployment docs, and the compatibility matrix for the
  new state controls.
- Verification:
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/store.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test --test-name-pattern "image_generation" test/server.test.js`:
    10/10 passing, including provider-backed id-only edit and
    `previous_response_id` edit context regressions.
  - `npm test`: 141/141 passing tests.
  - `npm run eval:protocol`: passed 2/2 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1122 ms, P95 latency 1161 ms, and total usage
    99 tokens.
  - `npm run eval:bridge -- --case responses-image-id-edit`: passed 1/1
    against `deepseek-v4-pro`, proving the new id-only image edit eval case.
  - `npm run eval:bridge`: passed 52/52 against `deepseek-v4-pro`, pass rate
    1.0, average latency 1320 ms, P95 latency 2844 ms, and total usage
    10501 tokens. The suite included `responses-image-generation`,
    `responses-image-edit`, and `responses-image-id-edit`.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - `npm run prune:runtime -- --dry-run`: passed with exit code 0; scanned
    637 candidates, selected 89 old UI screenshots by retention policy, deleted
    0 files, selected 7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Post-restart live two-step id-only image edit smoke passed locally:
    first request produced a completed `ig_...` call; second request supplied
    only `{type:"image_generation_call",id:"ig_..."}` and returned
    `mode:"edit"`, `prior_stored_image_call_count:1`,
    `resolved_stored_image_call_count:1`, and `resolved_image_count:1`.
  - Disk/storage check: the filesystem has 39 GB available; `state/` is
    5.6 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed image_generation adapter

- Extended the local Responses `image_generation` hosted-tool adapter from
  placeholder-only protocol coverage to configurable provider-backed image
  generation:
  - added `openai-compatible` / `openai` / `images` provider modes;
  - calls an OpenAI-compatible JSON Images API generation endpoint at
    `POST /images/generations`;
  - sends a dedicated image model, prompt, one requested image, and supported
    generation options such as `size`, `quality`, `background`,
    `output_format`, `output_compression`, and `moderation`;
  - maps provider `data[0].b64_json` into
    `image_generation_call.result`;
  - preserves provider `data[0].revised_prompt` when present;
  - records provider model metadata in
    `metadata.compatibility.local_image_generation.model`;
  - surfaces provider errors as failed `image_generation_call` items and
    compatibility metadata instead of fabricating an image.
- Added configuration for real image providers while keeping secrets outside
  Git:
  - `CODEXCOMPAT_IMAGE_GENERATION_BASE_URL`;
  - `CODEXCOMPAT_IMAGE_GENERATION_PATH`;
  - `CODEXCOMPAT_IMAGE_GENERATION_API_KEY_ENV`;
  - `CODEXCOMPAT_IMAGE_GENERATION_MODEL`;
  - `CODEXCOMPAT_IMAGE_GENERATION_RESPONSE_FORMAT`;
  - `CODEXCOMPAT_IMAGE_GENERATION_TIMEOUT_MS`.
- Kept the default provider as `placeholder`, so development and CI can still
  exercise Responses image output without requiring an image-generation API
  key. Real image-provider keys must be placed in deployment-local environment
  files, not in the repository.
- Updated compatibility/deployment/evaluation docs. The known gap is now
  narrowed to multipart edits/masks, true upstream partial-image streaming
  relay, full hosted prompt-rewrite parity, multi-turn high-fidelity image
  persistence, and image-quality evaluation suites.
- Verification:
  - `node --check src/bridge/local_image_generation.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - Focused image-generation tests passed 6/6:
    `node --test --test-name-pattern='image_generation|Images API|image provider|reserve image_generation' test/translator.test.js test/server.test.js`.
  - `npm test`: 136/136 passing tests.
  - `protocol-smoke` passed 2/2 against `deepseek-v4-pro`, pass rate 1.0,
    average latency 945 ms, P95 latency 1047 ms, and total usage 99 tokens.
  - Live `responses-image-generation` bridge-regression case passed 1/1
    against `deepseek-v4-pro` after deployment restart, latency 1219 ms, and
    total usage 186 tokens.
  - `npm run secret-scan`: passed with exit code 0.
  - `git diff --check`: passed.
  - `npm run prune:runtime -- --dry-run` scanned 637 runtime candidates,
    selected 89 old UI screenshots by retention policy, deleted 0, selected
    7324221 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and app-server
    services were all `active`; bridge healthz returned `ok:true`, DeepSeek
    provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    5.5 MB, `output/` is 12 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
  - No API keys, account credentials, or local secret files were committed.

## 2026-06-11 - Direct Audio custom voice metadata compatibility

- Used current official OpenAI docs and OpenAPI endpoint metadata to confirm
  the direct Audio custom voice flow:
  - `POST /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents/{consent_id}`;
  - `POST /v1/audio/voices`.
- Added a local metadata-only compatibility layer for Chat-only providers:
  - `POST/GET /v1/audio/voice_consents`;
  - `GET /v1/audio/voice_consents/{consent_id}`;
  - `POST/GET /v1/audio/voices`;
  - `GET /v1/audio/voices/{voice_id}` as a local retrieval extension for SDK
    and UI compatibility.
- Stored consent and voice records under a dedicated local state directory with
  `0700` directories and `0600` JSON files. The bridge records filename, byte
  length, content type, detected format, and SHA-256 digest, but does not store
  uploaded audio bytes.
- Enforced a default 20-voice cap matching the documented organization limit
  and bounded upload parsing with `CODEXCOMPAT_AUDIO_VOICE_MAX_INPUT_BYTES`.
- Marked generated voice records with compatibility metadata including
  `synthetic_voice_model_created:false` so callers can distinguish protocol
  compatibility from a real provider-backed cloned voice model.
- Updated `.env.example`, deployment docs, compatibility matrix, evaluation
  plan, and the bridge regression harness with the
  `audio-voice-lifecycle` case.
- Verification:
  - `node --check src/bridge/store.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused direct Audio tests passed through `test/server.test.js`, including
    custom voice lifecycle, missing recording validation, and missing consent
    validation.
  - `npm test`: 159/159 passing tests.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 729 runtime
    candidates, selected 92 old UI screenshots by retention policy, deleted 0
    files, selected 7555293 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `audio-voice-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, creating consent `cons_LvqCugPLFeOPl-GCWJQIh3tR` and
    voice `voice_Wugjq5bEjBvs7uG16QFvJwhE`, with consent get/list and voice
    get/list all returning 200.
  - Full live `npm run eval:bridge`: 69/69 passing cases, pass rate 1.0,
    average latency 1095 ms, P95 latency 3064 ms, and total usage 10696
    tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, and saved-project
    cleanup with no console errors or warnings.
  - Disk/storage check: the filesystem has 41 GB available; `state/` is
    7.6 MB, `output/` is 13 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Evals API compatibility

- Used current official OpenAI docs/OpenAPI metadata to confirm the Evals API
  surface:
  - `POST /v1/evals` / `GET /v1/evals`;
  - `GET` / `POST` / `DELETE /v1/evals/{eval_id}`;
  - `POST` / `GET /v1/evals/{eval_id}/runs`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}/output_items`;
  - `GET /v1/evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}`.
- Recorded the official Evals deprecation dates in the compatibility matrix:
  read-only for existing users on 2026-10-31 and shutdown scheduled for
  2026-11-30.
- Added a local synchronous Evals compatibility layer for Chat-only providers:
  - file-backed `eval_...`, `evalrun_...`, and `eval.run.output_item`
    storage under `CODEXCOMPAT_EVAL_STATE_DIR` with `0700` directories and
    `0600` JSON files;
  - eval create/list/get/update/delete;
  - run create/list/get and a local terminal cancel no-op;
  - output item list/get with stable JSONL line ordering;
  - `purpose:"evals"` Files as run data sources plus inline local row data;
  - `data_source.type:"responses"` template materialization through local
    `/v1/responses` with `store:false` when a row does not provide a sample;
  - sample-driven grading without upstream calls when rows include
    `sample.output_text` or compatible sample fields;
  - deterministic `string_check` graders for `eq`, `ne`, `contains`,
    `not_contains`, `starts_with`, `ends_with`, and `regex`;
  - run-level `result_counts`, `per_model_usage`,
    `per_testing_criteria_results`, local `report_url`, and compatibility
    metadata.
- Added `CODEXCOMPAT_EVAL_STATE_DIR` and `CODEXCOMPAT_EVAL_MAX_ROWS` to
  `.env.example` and deployment docs. The default row cap is 100 for the
  `/srv/aialra/apps` deployment profile.
- Added `evals-lifecycle` to the live `bridge-regression` harness. It creates
  an eval, uploads a `purpose:"evals"` JSONL File, creates a run, checks two
  output items with one pass and one fail, retrieves/list runs, updates eval
  metadata, lists evals, deletes the eval, and cleans up the file.
- Verification:
  - `node --check src/bridge/local_evals.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - `node --test test/server.test.js --test-name-pattern "Evals API"` ran the
    full server test file and passed 122/122, including the new Evals case.
  - `npm test`: passed 160/160.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 750 runtime
    candidates, selected 93 old UI screenshots by retention policy, deleted 0
    files, selected 7640523 bytes, and reported 0 errors.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `evals-lifecycle` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 157 ms, `result_counts:{total:2,passed:1,failed:1,errored:0}`,
    and zero token usage because it used sample-driven local grading.
  - Full live `npm run eval:bridge`: 70/70 passing cases, pass rate 1.0,
    average latency 967 ms, P95 latency 2350 ms, and total usage 10705 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation,
    project dialog/upload services, conversation submission, completed-turn
    actions, reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - Disk/storage check: the filesystem has 40 GB available; `state/` is
    7.9 MB, `output/` is 13 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 22 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Provider-backed score_model graders

- Used current official OpenAI Graders docs and OpenAPI metadata for
  `/v1/fine_tuning/alpha/graders/run` and
  `/v1/fine_tuning/alpha/graders/validate` to confirm the `score_model`
  compatibility shape: message-array `input`, required judge `model`, numeric
  `pass_threshold`, numeric `range`, optional `sampling_params`, JSON-like
  grader output with a numeric `result`, and
  `model_grader_token_usage_per_model` metadata.
- Added provider-backed `score_model` support to the local Graders layer:
  - `/v1/fine_tuning/alpha/graders/validate` validates `score_model`
    structure without calling the provider;
  - `/v1/fine_tuning/alpha/graders/run` renders grader messages with
    item/sample template variables, calls the configured Chat provider as a
    judge, requests JSON output, parses and clamps the numeric score to the
    configured range, applies `pass_threshold`, and records judge token usage;
  - `multi` graders can now include async `score_model` subgraders and
    aggregate token usage and model usage metadata.
- Added provider-backed `score_model` criteria support to local Evals runs, so
  inline rows or `purpose:"evals"` JSONL rows can grade sample output with the
  configured Chat provider while preserving Evals output-item accounting.
- Kept the compatibility boundary explicit:
  - this is a Chat-provider judge compatibility runtime, not OpenAI hosted
    grader execution;
  - `python` graders remain unsupported because there is no sandboxed Python
    grading runtime in this deployment profile.
- Updated compatibility matrix, evaluation plan, deployment verification
  commands, unit tests, and the bridge regression harness with the
  `graders-api-score-model` live case.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests passed through `test/server.test.js`,
    including provider-backed `score_model` validation, direct grader runs, and
    Evals criteria runs.
  - `npm test`: passed 164/164.
  - Targeted live `graders-api-score-model` repeated 3/3 against
    `deepseek-v4-pro`; all three scored `reward:1` and recorded judge token
    usage.
  - Full live `npm run eval:bridge`: 72/72 passing cases, pass rate 1.0,
    average latency 952 ms, P95 latency 2694 ms, and total usage 10824 tokens.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `npm run smoke:ui`: passed against
    `https://opencodexapp.aialra.online/`, covering page navigation, project
    dialog/upload services, conversation submission, completed-turn actions,
    reload persistence, generated image artifact display, saved-project
    cleanup, and no console errors or warnings.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 778 runtime
    candidates, selected 0 files, deleted 0 files, and reported 0 errors.
  - Disk/storage check: the filesystem has 38 GB available; `state/` is
    9.6 MB, `output/` is 4.8 MB, `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local Python grader compatibility

- Used current official OpenAI Graders docs and OpenAPI metadata for
  `/v1/fine_tuning/alpha/graders/run` and
  `/v1/fine_tuning/alpha/graders/validate` to confirm the `python` grader
  shape: `type:"python"`, `source`, optional `image_tag`, a required
  `grade(sample, item)` function with exactly two arguments, float reward
  output, 256 KiB source cap, 2 minute execution limit, no network, 2 GB memory,
  1 GB disk, and 2 CPU cores in the hosted environment.
- Added local Python grader compatibility:
  - `validate` now accepts `python` graders and enforces source shape, optional
    `image_tag`, and the documented source-size cap;
  - `run` executes `grade(sample, item)` in a short-lived Python subprocess
    with a sanitized environment, isolated temporary workdir, local timeout,
    Python `resource` limits where supported, common network/process import and
    audit guards, bounded captured output, reward clamping, and best-effort
    workdir cleanup;
  - Python runtime errors, invalid returns, and timeouts return reward `0`
    with `python_grader_runtime_error` metadata instead of crashing the bridge;
  - local Evals criteria and `multi` graders can include Python subgraders.
- Reused the same configured Python grader options when validating nested
  `multi` subgraders during sync and async execution, so custom source, memory,
  disk, timeout, and interpreter settings behave consistently.
- Added configuration knobs:
  - `CODEXCOMPAT_PYTHON_GRADER_PROVIDER`;
  - `CODEXCOMPAT_PYTHON_GRADER_STATE_DIR`;
  - `CODEXCOMPAT_PYTHON_GRADER_TIMEOUT_MS`;
  - `CODEXCOMPAT_PYTHON_GRADER_MAX_SOURCE_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_DISK_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_MEMORY_BYTES`;
  - `CODEXCOMPAT_PYTHON_GRADER_BIN`.
- Kept the compatibility boundary explicit: this is a local subprocess runner,
  not OpenAI's hosted Python grader image and not a hardened container or
  microVM sandbox. Full parity still needs stronger OS-level isolation,
  dependency-image parity, and larger adversarial grader tests.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness. The live
  `graders-api-local` case now validates Python grader execution and keeps an
  unknown `javascript` grader as the `unsupported_grader_type` check.
- Verification:
  - `node --check src/bridge/local_graders.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused Graders/Evals server tests passed through `test/server.test.js`,
    including direct Python grader validate/run, runtime-error reward `0`, and
    Evals Python criteria execution.
  - `npm test`: passed 164/164.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `graders-api-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, including `python_status:200` and `python_reward:1`
    with zero provider token usage.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 72/72 passing cases, pass rate 1.0, average latency 1096 ms, P95
    latency 2826 ms, and total usage 11161 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 818 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 818 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 37 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Local MCP protocol-context compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to confirm the request and output protocol shape:
  `tools:[{type:"mcp"}]`, `server_label`, remote `server_url` or connector
  `connector_id`, optional per-request `authorization`, `require_approval`,
  `allowed_tools`, `defer_loading`, plus `mcp_list_tools`, `mcp_call`,
  `mcp_approval_request`, and `mcp_approval_response` item flow.
- Added a local MCP compatibility adapter for Chat-only providers:
  - reserves MCP tools so they are not forwarded upstream as unsupported Chat
    tools;
  - emits `mcp_list_tools` output items for non-streaming, streaming, and
    background Responses requests;
  - injects MCP server/tool/context summaries into Chat messages so the model
    can reason over prior MCP state;
  - imports explicit/allowed tool definitions, handles remote-server and
    connector metadata, supports `defer_loading`, and records local MCP counts
    under `metadata.compatibility.local_mcp`;
  - consumes the shared local `max_tool_calls` budget for emitted list-tools
    items and records skipped local MCP work in local budget metadata.
- Tightened MCP secret handling:
  - `authorization` and `headers.Authorization` are removed from public
    Responses `tools` snapshots, matching the OpenAI docs boundary that MCP
    authorization is not stored or visible on the Response object;
  - background job request snapshots are also redacted during initial queueing
    and later `provider_pending` persistence.
- Added live and mock-provider coverage:
  - `responses-mcp-local` in the bridge regression harness;
  - non-streaming unit coverage for `mcp_list_tools`, Chat prompt injection,
    DeepSeek thinking disablement, local budget consumption, prior `mcp_call`
    context, and no authorization leakage;
  - streaming unit coverage for `response.output_item.added` MCP output;
  - background unit coverage that inspects persisted `background_job.request`
    and confirms MCP authorization is not written to disk.
- Kept the compatibility boundary explicit: this is a local protocol-context
  adapter, not a remote MCP transport executor, not hosted OpenAI Connectors,
  and not an OAuth/approval-loop runtime. Full parity still requires
  Streamable HTTP/SSE execution, connector token sidecars, approval state,
  allowlists, and tool-output audit review.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check src/bridge/translator.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including authorization redaction for public responses and persisted
    background jobs.
  - `npm test`: passed 167/167.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - Live `responses-mcp-local` bridge-regression case passed 1/1 against
    `deepseek-v4-pro`, latency 1356 ms, output `mcp-local-ok`, and total usage
    289 tokens.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 73/73 passing cases, pass rate 1.0, average latency 1139 ms, P95
    latency 2794 ms, and total usage 11191 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 838 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 838 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 40 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.

## 2026-06-11 - Remote MCP tools/list import compatibility

- Used current official OpenAI MCP/Connectors Responses docs through the
  OpenAI developer-docs MCP to refine the next compatibility boundary. The
  relevant documented shape remains `tools:[{type:"mcp"}]` with
  `server_label`, remote `server_url` or connector `connector_id`, optional
  per-request `authorization`, `require_approval`, `allowed_tools`, and
  `defer_loading`; Responses output can include `mcp_list_tools`, `mcp_call`,
  and `mcp_approval_request`, while approval responses can be sent as later
  input items.
- Extended the local MCP adapter from protocol-context only to bounded remote
  list-tools import:
  - remote `server_url` tools without explicit local definitions now run
    JSON-RPC `initialize`, `notifications/initialized`, and paginated
    `tools/list`;
  - remote responses can be `application/json` or `text/event-stream`;
  - returned `inputSchema` / `input_schema`, `annotations`, `description`, and
    `name` are normalized into Responses-style `mcp_list_tools.tools`;
  - `allowed_tools` filters the imported remote tool list;
  - returned `mcp-session-id` values are carried on later remote list requests;
  - timeout, response-byte, max-tool, protocol-version, and client-name knobs
    are configurable through `CODEXCOMPAT_MCP_*` env vars.
- Kept MCP secret handling explicit:
  - request `authorization` is used only to form the outbound remote MCP
    `Authorization` header for that request;
  - caller-supplied `headers.Authorization` still conflicts with top-level
    `authorization`;
  - public Responses output, stored snapshots, compatibility metadata, and eval
    reports do not contain the authorization value.
- Added coverage:
  - unit/mock-provider coverage for remote MCP `initialize` /
    `notifications/initialized` / SSE `tools/list`, session-id forwarding,
    `allowed_tools` filtering, normalized schemas, annotations, budget
    consumption, prompt context, and authorization redaction;
  - a live bridge regression case, `responses-mcp-remote-list`, that starts a
    local mock MCP server, verifies the deployed bridge performs the remote
    MCP list-tools round trip, then sends the imported context through
    DeepSeek.
- Updated `.env.example`, compatibility matrix, deployment docs, evaluation
  plan, unit tests, and the bridge regression harness.
- Kept the compatibility boundary explicit: this imports remote MCP tool
  definitions and emits `mcp_list_tools`, but still does not execute remote
  `mcp_call`, run approval loops, or provide OpenAI hosted connector
  OAuth/token sidecars.
- Verification:
  - `node --check src/bridge/local_mcp.js`: passed.
  - `node --check src/bridge/server.js`: passed.
  - `node --check test/server.test.js`: passed.
  - `node --check scripts/eval-harness.mjs`: passed.
  - Focused MCP/background server tests passed through `test/server.test.js`,
    including the remote MCP Streamable HTTP/SSE `tools/list` import case.
  - `npm test`: passed 168/168.
  - Restarted `aialra-opencodexapp-bridge.service`; bridge, web, and
    app-server services were all `active`; bridge healthz returned `ok:true`,
    DeepSeek provider base `https://api.deepseek.com`, default model
    `deepseek-v4-pro`, and `has_provider_key:true`; public HTTPS returned HTTP
    200 from `https://opencodexapp.aialra.online/`.
  - A pre-restart live `responses-mcp-remote-list` check correctly showed the
    old running bridge was still using placeholder-only MCP behavior; after
    restart, the same live case passed 1/1 against `deepseek-v4-pro`, latency
    1667 ms, output `mcp-remote-ok`, 287 total tokens, and confirmed remote
    `initialize`, `notifications/initialized`, `tools/list`, authorization
    forwarding, and session forwarding.
  - Full live `npm run eval:bridge -- --timeout-ms 180000` after bridge
    restart: 74/74 passing cases, pass rate 1.0, average latency 1191 ms, P95
    latency 3074 ms, and total usage 11735 tokens.
  - `npm run smoke:bridge`: passed and returned `bridge-ok`.
  - `git diff --check`: passed.
  - `npm run secret-scan`: passed.
  - `npm run prune:runtime -- --dry-run`: passed; scanned 858 runtime
    candidates, selected 0 files, deleted 0 files, selected 0 bytes, and
    reported 0 errors.
  - `npm run prune:runtime -- --apply`: scanned 858 runtime candidates,
    deleted 0 files, freed 0 bytes, and reported 0 errors.
  - Disk/storage check after cleanup: the filesystem has 39 GB available;
    `state/` is 11 MB, `output/` is 4.7 MB,
    `/srv/aialra/data/opencodexapp` is 84 KB, and
    `/srv/aialra/logs/opencodexapp` is 23 MB.
- Secret handling: no API keys, account credentials, provider headers, or local
  deployment env files were added to the repository.
