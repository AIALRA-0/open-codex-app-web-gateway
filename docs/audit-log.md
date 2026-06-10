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
