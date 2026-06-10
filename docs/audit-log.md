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
