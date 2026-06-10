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
