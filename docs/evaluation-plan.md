# Evaluation Plan

Goal: measure whether DeepSeek through the bridge is reliable enough for Codex
workflows and identify what must improve before claiming 95% parity with native
Codex/OpenAI Responses behavior.

## Phases

1. Protocol correctness

- Unit tests for every request and response mapping in `src/bridge/translator.js`.
- Mock-upstream SSE tests for text, reasoning, function calls, errors, and usage.
- Golden fixtures for real Codex request shapes captured with secrets removed.

2. UI and workflow correctness

- Browser smoke test for `opencodexapp.aialra.online`.
- `npm run smoke:ui -- --timeout-ms 180000` covers app load from a clean
  browser context, optional login-page authentication from local environment
  variables, sidebar/search/settings controls, project menu and new-project
  dialog open/cancel, host browser-upload fixture writes with filesystem
  verification, project writable-root add/clear, core page switching through
  plugins/automation/mobile views and back to new chat, prompt send, model
  response visibility, short-label stop/retry control discovery, completed-turn
  user/assistant action controls including copy, edit, conversation actions,
  and the current branch-from-here action when retry/regenerate is not exposed,
  saved project create, reopen-from-sidebar, cleanup through the browser
  bridge, generated image artifact display via a temporary rollout event that
  is truncated after the assertion, console errors, screenshot capture, and
  reload persistence.
- `npm run smoke:ui -- --timeout-ms 260000 --exercise-active-controls` extends
  that browser path with an active long-running model turn, clicks the visible
  stop/interrupt control when exposed, records a composer-action fallback if
  the stop control is rendered without accessible text, verifies the control
  clears, records whether retry/regenerate/continue is exposed after
  interruption, and submits a recovery prompt to prove the conversation remains
  usable.
- Completed-turn retry/regenerate is recorded as not exposed in the current UI;
  if a future UI exposes that short-label action, the completed-turn smoke path
  will report it through `completed_turn_retry_regenerate_controls`.
- Treat audio-capable Chat providers as provider-specific protocol coverage:
  unit and mock-provider tests must map Responses `input_audio` into Chat
  `input_audio` content parts, preserve `message.audio` and streaming
  `delta.audio` into Responses output, metadata, and replay, while live
  DeepSeek runs verify that text-only providers remain stable when audio
  request fields are filtered or rewritten to safe text markers.
- Treat request-based Audio APIs as bridge-owned protocol coverage: unit tests
  must exercise direct speech bytes, multipart and JSON/base64 transcription
  and translation, transcription SSE, custom voice consent/voice metadata
  lifecycle, and local Batch JSONL transcription / translation; live runs
  verify deterministic placeholder stability and route shape.
- Record screenshots and console logs under ignored `output/playwright/`.

3. Agent task quality

- Start with small deterministic coding tasks to avoid large downloads.
- Add SWE-bench Verified lite/sample only after disk and runtime limits are set.
- Keep HumanEval/MBPP-style unit-test tasks as a quick regression signal before
  heavier SWE-bench prediction/scoring runs.
- Keep repository-maintenance tasks in the quick benchmark loop: docs edit,
  failing test fix, tool-call loop, and multi-turn state replay.

## Current Starter Harness

`scripts/eval-harness.mjs` is the always-on, low-cost regression harness. It is
not a substitute for SWE-bench, but it catches bridge regressions before running
larger agent evaluations.

| Suite | Coverage |
| --- | --- |
| `protocol-smoke` | Responses text generation and JSON schema compatibility |
| `bridge-regression` | Protocol smoke plus model retrieval, local OpenAI-compatible embeddings, local Realtime REST session/client-secret/transcription/translation/call lifecycle compatibility, local Fine-tuning job/checkpoint/permission lifecycle compatibility, local Organization usage/costs ledger-backed admin page compatibility, local Organization user/invite/admin-API-key/certificate/audit-log/role/group/user-role/group-role/group-membership/project/project-user/project-group/spend-alert/policy-control/service-account/API-key/rate-limit lifecycle compatibility, local ChatKit session/thread/item lifecycle, standalone and inline local OpenAI-compatible moderations, local Batch API JSONL execution over Responses, local Evals API lifecycle over `purpose:"evals"` Files and deterministic `string_check` output items, local Assistants API lifecycle over Assistants, Threads, Messages, synchronous Chat-backed Runs, run `additional_messages` / `additional_instructions` / `reasoning_effort` / `truncation_strategy.last_messages` / best-effort `max_prompt_tokens` / observed token-budget `incomplete` states, function-tool `requires_action` / `submit_tool_outputs` loops, active-run thread-lock rejection, Run Steps with include-gated `file_search` result content, and create-and-run SSE event shape, local Graders API validate/run coverage for `string_check`, `text_similarity`, local subprocess `python`, `multi`, and provider-backed `score_model`, Responses image-generation, Chat Completions, legacy Completions, embeddings, direct `/v1/audio/speech`, direct `/v1/audio/transcriptions`, direct `/v1/audio/translations`, direct Audio custom voice consent/voice lifecycle, direct `/v1/images/generations`, direct `/v1/images/edits`, direct `/v1/images/variations`, direct Videos API lifecycle plus Videos character create/retrieve/delete/reference preservation and edit/extension/remix iteration coverage, and moderations with Files output/error retrieval, Chat passthrough including direct OpenAI Chat `developer` role normalization, `max_completion_tokens`, `reasoning_effort`, top-level `reasoning:{effort}` object normalization, OpenAI Chat custom-tool filtering for function-only providers, local stored-chat `store`/`metadata` preservation with official string-metadata validation and provider filtering, provider-aware `stream_options` subfield filtering, and direct Chat `tool_choice` DeepSeek compatibility, and DeepSeek field filtering including `parallel_tool_calls`, legacy `/v1/completions` prompt-to-Chat mapping, stored Chat lifecycle including non-streaming and streaming Chat completion list/get/update-metadata/messages/delete, stored Responses lifecycle including get/update-metadata/input_items/cancel/delete, Responses input-token counting including style preset validation and prompt-level usage probes, Responses local prompt-template expansion, local MCP `mcp_list_tools` protocol-context compatibility plus remote Streamable HTTP JSON-RPC/SSE `tools/list` import, non-streaming, streaming, and active background auto-approved `tools/call`, and non-streaming, streaming, and background `mcp_approval_request` / `mcp_approval_response` coverage in unit/mock-provider tests and live bridge harness cases backed by a local mock MCP server, Responses `reasoning.effort:"none"` to DeepSeek non-thinking compatibility, Responses output logprobs mapping plus `message.output_text.logprobs` create, stored-response retrieve, metadata-update, and completed-cancel include projection, Responses `input_image.detail`, data-URL, and local Files API `file_id` mapping plus `input_audio` to Chat content-part mapping in unit/mock-provider tests, input-item `include:["message.input_image.image_url"]` and `include:["computer_call_output.output.image_url"]` projection for Responses and Conversations item retrieval, Chat audio output preservation and replay in unit/mock-provider tests, non-streaming multi-choice Chat-to-Responses mapping, Chat-native stop sequence passthrough, local `input_file` extraction including completed text and binary/PDF Uploads API files, HTTP(S) `file_url`, PDF text-layer extraction, deterministic spreadsheet augmentation, and `.docx`/`.xlsx`/`.pptx` OOXML text extraction, local background completion, local background stored-chat filtering, local background startup reconciliation, `provider_pending` resume, ready `preparing` checkpoint resume, active foreign lease skip, expired lease takeover, and running-step fail-closed coverage in unit tests, local truncation auto/disabled behavior in unit tests, local Conversations lifecycle and Responses `conversation` replay across create, `/input_tokens`, and `/compact`, local hosted-tool `max_tool_calls` budget enforcement, local web-search search/open-page/find-in-page/citation mapping plus `web_search_call.action.sources` create and stored-response include projection, local file-search/vector-store citation mapping including vector-store update/file update/content, static chunking strategy, ranking options, multi-query search, comparison/compound attribute filters, local hashed-semantic hybrid search, file batches, and `file_search_call.results` create and stored-response include projection, local shell/container artifact mapping including Skills API `skill_reference` mounting, local `code_interpreter_call.outputs` create and stored-response include projection, local computer-use screenshot-first `computer_call` compatibility, local image-generation `image_generation_call` output, streaming partial-image, edit/mask compatibility, id-only multi-turn edit, direct Images API generation/edit JSON/SSE and variation JSON compatibility, direct Videos create/retrieve/content/delete compatibility, and Batch JSONL compatibility for Responses image_generation, direct Audio transcription/translation, direct Images generation/edit/variation, and direct Videos generation, local compaction continuation, local Responses `reasoning.encrypted_content` round-trip and stored-response include projection coverage in unit tests, SSE events, function-tool `tool_choice`, and `previous_response_id` replay |
| `code-benchmark` | Small issue-to-patch coding tasks that generate complete replacement files, apply them, and run tests; includes the default `micro` suite, the broader `humaneval-mbpp` function-repair suite, and the `repo-maintenance` suite for docs/config/test/tool-loop/replay tasks |
| `swebench-runner` | Disk-bounded SWE-bench prediction generator for local JSONL subsets; writes official predictions JSONL and compact audit reports outside the repo |
| `swebench-evaluate` | Guarded wrapper around the official SWE-bench Docker harness; parses scorer artifacts into compact JSON/Markdown reports |
| `bridge-soak` | Repeated stored Responses turns, `/input_items` checks, DELETE cleanup, latency, token usage, and state directory growth |
| `runtime-prune` | Dry-run and apply checks for ignored runtime artifacts under `output/`, `.playwright-cli/`, and bounded bridge state records |

PDF extraction is covered in mock-provider regression tests for both Responses
`input_file` translation and direct Chat passthrough text fallback, and local
`file_search` adds vector-store PDF text-layer and OCR tests. These tests force
empty PDF text-layer extraction where needed and verify the bounded
`pdftoppm`/`tesseract` path plus `pdf_ocr_extracted_count` metadata before
larger live or SWE-bench style evaluations are run. The live
`bridge-regression` suite also includes `responses-file-search-pdf`, which
attaches a PDF to a local vector store and requires retrieved file-search
content to include the PDF marker through `file_search_call.results`.

The `assistants-lifecycle` bridge-regression case also checks that
create-and-run streaming produces `thread.message.delta` text fragments before
completion. Unit/mock-provider coverage adds streamed Chat tool-call argument
chunks mapped to `thread.run.step.delta` and streamed
`submit_tool_outputs` continuations mapped back to message deltas.
Direct Chat image-content coverage verifies that `/v1/chat/completions`
requests with `messages[].content[]` Chat `image_url` parts are rewritten to
safe text markers for text-only providers such as DeepSeek, that data URLs are
not copied into the upstream prompt, and that
`metadata.compatibility.chat_passthrough.chat_image_inputs` records the
provider mode and aggregate image-part counts.
Direct Chat audio-content coverage verifies that `/v1/chat/completions`
requests with `messages[].content[]` Chat `input_audio` parts are rewritten to
safe text markers for text-only providers such as DeepSeek, that base64 audio
bytes are not copied into the upstream prompt, and that
`metadata.compatibility.chat_passthrough.chat_audio_inputs` records the
provider mode and aggregate audio-part counts.
Direct Chat file-content coverage verifies that `/v1/chat/completions`
requests with `messages[].content[]` Chat `input_file` / compatible `file`
parts are rewritten to safe text markers for text-only providers such as
DeepSeek, that base64 file bytes are not copied into the upstream prompt, that
bounded local extraction supplies usable text context, and that
`metadata.compatibility.chat_passthrough.chat_file_inputs` plus
`metadata.compatibility.chat_passthrough.local_input_files` record the provider
mode and extraction counts.
Bridge-regression live cases and unit/mock-provider coverage also check local
Assistants hosted-tool adapters: `file_search` merges assistant/thread/run
vector-store resources, injects local retrieval evidence, persists a
`file_search` Run Step, and annotates assistant messages with `file_citation`;
`code_interpreter` mounts local Files API `file_ids`, executes explicit Python
blocks in the local container workspace, injects stdout evidence, and persists
a `code_interpreter` Run Step. Attachment coverage verifies that message
`file_search` attachments create or reuse thread vector stores, that
`code_interpreter` attachments populate thread file resources, and that those
resources are visible to the following run. Assistants vision-content coverage
verifies that `image_url` message parts preserve `detail`, that
`image_file.file_id` parts resolve through local Files into bounded Chat vision
data URLs for vision-capable providers or safe text markers for text-only
providers such as DeepSeek, and that compatibility metadata omits image data
while recording provider mode and aggregate image part counts.
Assistants truncation coverage verifies that Run
`truncation_strategy:{type:"last_messages"}` removes older thread messages
before the upstream Chat request, that local hosted-tool context follows the
same selected message set, and that `max_prompt_tokens` records the local
character-estimated prompt-budget action in run metadata.
Assistants token-budget coverage verifies synchronous Run
`status:"incomplete"` for both `max_prompt_tokens` and
`max_completion_tokens`, plus streaming `thread.run.incomplete` when upstream
Chat stops with a length-style finish reason under `max_completion_tokens`.
Remote MCP coverage verifies non-streaming, streaming, and active background
remote `tools/call` execution through generated Chat function tools. The
background call case also forces the original MCP tool name through
`tool_choice` so the harness catches regressions in generated-function-name
mapping. Mock-provider coverage also verifies the official deferred-loading
continuation shape where a request supplies a matching `mcp_list_tools` item in
`input`: the bridge skips a new remote `tools/list`, preserves the cached
schema as Chat function parameters, executes the remote `tools/call`, and avoids
leaking raw MCP protocol JSON into Chat messages.
Tool-search coverage verifies the hosted Responses function/namespace
`defer_loading` flow against a mock Chat provider: the first upstream request
sees only the generated search function and namespace summary, the model's
search call becomes public `tool_search_call` / `tool_search_output` items,
the follow-up upstream request receives the loaded function schema, and the
final Chat function call is remapped back to the original Responses
`namespace`. Mock-provider coverage also verifies client-executed second turns
that pass `tool_search_output.tools` in `input` without repeating the `tools`
array, plus `additional_tools` input items that inject function definitions
without leaking raw protocol items into the prompt. Live bridge-regression
coverage now exercises client-executed `tool_search` against DeepSeek: the
first response emits only a client `tool_search_call`, the harness supplies a
`tool_search_output` containing a namespace tool, and the follow-up response
returns a `function_call` remapped to the original `shipping.get_shipping_eta`
namespace/name. Live large-catalog coverage exercises hosted `tool_search`
against DeepSeek with eight namespaces and 48 deferred functions: the model
loads only the selected `returns` namespace, receives six callable functions,
and returns the public `returns.create_return_label` `function_call` with the
expected `RMA-42`/`pdf` arguments. The
`responses-tool-search-catalog-sweep` live case repeats that shape over eight
deterministically shuffled large-catalog tasks, one for each namespace:
`billing`, `crm`, `shipping`, `returns`, `inventory`, `security`, `support`,
and `analytics`. It records scenario pass rate, average/P95 latency, token
usage, loaded-catalog fraction, DSML text leaks, assistant prose leaks,
suppressed assistant prose counts, and final function-call
namespaces/arguments. The sweep fails if assistant prose is visible on these
tool-only turns. Mock-provider coverage hardens
DeepSeek-style DSML text pseudo-tool outputs for loaded functions by promoting
direct function invocations, `local_tool_call` `path`/`input` wrappers, and
namespace `method`/`params` wrappers into standard tool calls before public
Responses translation, and suppresses ordinary assistant prose that appears in
the same Chat choice as an already-loaded `tool_search` function call while
recording suppression counts. MCP tool-search coverage verifies the official "group by MCP
servers" guidance: a deferred remote MCP server starts as a searchable group,
the model calls the generated
`local_tool_search` function, the bridge imports remote `tools/list`, emits
`mcp_list_tools`, injects the imported MCP schema into a follow-up Chat request,
executes the returned remote `tools/call`, and records
`tool_search_mcp_list_tools_and_call_execution`. Approval coverage verifies the
same deferred MCP loading path with `require_approval:"always"`: the first
response emits `tool_search_call`, `mcp_list_tools`, and `mcp_approval_request`
without running `tools/call`; the continuation uses `previous_response_id` plus
`mcp_approval_response` to reuse that `mcp_list_tools` context, skip a second
remote `tools/list`, execute the approved `tools/call`, and redact
authorization from provider prompts and public Responses output. Live
bridge-regression cases cover both non-streaming and streaming deferred remote
MCP approval against DeepSeek. They also validate provider-specific hardening
for DSML-like pseudo-tool text: text approval invocations are parsed into MCP
approval items before public output, and pseudo-tool text emitted after a
successful approved `mcp_call` is suppressed while preserving the public
`mcp_call` item. Streaming
coverage verifies both auto-approved and approval-required variants: the
approval-required case emits `response.output_item.added` for
`tool_search_call`, `mcp_list_tools`, and `mcp_approval_request` without
surfacing bridge-internal Chat `function_call` events, then the streaming
continuation approves the request, reuses the prior `mcp_list_tools`, emits MCP
argument delta/done/progress events for the approved `mcp_call`, combines usage,
and still skips a second remote `tools/list`. Mock-provider coverage also
exercises collision-heavy streaming function names by splitting a generated
namespace Chat function name across SSE chunks and verifying that public
Responses output keeps the original `namespace` / `name`. Follow-up eval work
should add live bridge cases for hosted connectors and expand the
large-catalog quality/latency/token sweeps beyond the current deterministic
sample.
Computer Use coverage verifies both the screenshot-first local `computer_call`
shape and the follow-up loop where a returned `computer_call_output` lets a
Chat-only model request the next action through a generated function tool. The
live `responses-computer-action` and `responses-computer-action-stream` cases
force `tool_choice:{type:"computer"}` and validate that the public response
contains a `computer_call`, not the bridge-internal function call or function
call stream events. Mock-provider coverage also validates that returned
`acknowledged_safety_checks` are preserved as bounded Chat-visible summaries and
counted in `metadata.compatibility.local_computer`, and that common action
aliases such as `scroll_x` / `scrollX`, `scroll_y` / `scrollY`, and `key` /
`keys[]` are normalized before the public `computer_call` is returned.

Useful commands:

```bash
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
node --test test/server.test.js --test-name-pattern 'tool_search'
node --test test/server.test.js --test-name-pattern 'additional_tools'
node --test test/server.test.js --test-name-pattern 'mcp_list_tools'
node --test test/server.test.js --test-name-pattern 'promotes text tool_search|promotes local_tool_call'
node --test test/server.test.js --test-name-pattern 'loads deferred remote MCP tools through hosted tool_search|streams deferred remote MCP tools loaded through hosted tool_search'
node --test --test-name-pattern 'deferred remote MCP loaded through hosted tool_search|text MCP approval emitted after hosted tool_search|suppresses pseudo tool markup' test/server.test.js
node scripts/eval-harness.mjs --suite bridge-regression --case responses-tool-search-large-catalog --timeout-ms 180000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-tool-search-catalog-sweep --timeout-ms 420000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-tool-search-approval --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-tool-search-stream-approval --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-function-tool --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-background --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-conversation-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-logprobs --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-input-file --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-upload-input-file --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-upload-input-file-pdf --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-input-file-url --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-input-file-pdf --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-input-file-spreadsheet --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case embeddings-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case moderations-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case realtime-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case chatkit-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-inline-moderation --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-reasoning-encrypted --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case batch-embeddings-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case batch-moderations-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-required-action --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-reasoning-effort-none --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-truncation --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-token-budget-incomplete --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-vision-content --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-file-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-code-interpreter --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case assistants-attachments --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case evals-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case fine-tuning-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-usage-costs --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-users-invites --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-roles-groups --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-admin-api-keys --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-certificates --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-audit-logs --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-project-admin --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-project-groups --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-spend-alerts --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-policy-controls --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case organization-project-users-rate-limits --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case graders-api-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case graders-api-score-model --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-list --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-call --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-stream-call --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-background-call --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-approval --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-stream-approval --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-remote-denial --timeout-ms 120000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case completions-legacy --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case chat-vision-content --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case chat-stream-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-function-tool-stream --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-web-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-max-tool-calls --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-computer --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-computer-action --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-computer-action-stream --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell-skill --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search-pdf --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search-batch --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case vector-store-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case video-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case video-character-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case video-iteration-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --repeat 5 --output /srv/aialra/data/opencodexapp/eval/bridge-regression.json
npm run smoke:ui -- --timeout-ms 180000
npm run smoke:ui -- --timeout-ms 260000 --exercise-active-controls
npm run bench:code -- --timeout-ms 180000
npm run bench:code -- --suite humaneval-mbpp --timeout-ms 180000
npm run bench:code -- --suite repo-maintenance --timeout-ms 180000
npm run bench:swe -- --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl --limit 3 --dry-run
npm run bench:swe -- --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl --limit 3 --timeout-ms 180000
npm run bench:swe:score -- --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json --dry-run
npm run soak:bridge -- --iterations 5 --timeout-ms 180000
```

## Current Coding Benchmark

`scripts/code-benchmark.mjs` is a disk-bounded coding-quality harness. It creates
temporary JavaScript repositories under ignored `output/code-benchmark/`, asks
the bridge model to return JSON file replacements, applies the generated files,
and runs each task's tests.

The current `micro` suite covers:

- URL-safe slug normalization.
- Interval range merging without mutating input.
- Compact duration parsing.

The `humaneval-mbpp` suite adds slightly broader HumanEval/MBPP-style function
repair tasks:

- Balanced bracket validation with nested delimiters.
- Stable de-duplication by computed key without mutating inputs.
- Case-insensitive word-frequency ranking with deterministic tie ordering.
- Non-mutating square-matrix rotation.

The `repo-maintenance` suite adds bridge-repo flavored maintenance tasks:

- Deployment documentation edits for provider env vars and secret hygiene.
- Writable project-root normalization without mutating user settings.
- Responses-style function-call/tool-output loop handling.
- Previous-response multi-turn replay reconstruction.

This is not a substitute for SWE-bench. It is a cheap pass/fail sentinel for the
same broad loop: issue text plus code context, generated patch, test execution,
and structured scoring.

## Current SWE-bench Prediction Runner

`scripts/swebench-runner.mjs` is the bounded SWE-bench entry point for this
deployment. It does not download datasets and does not run the Docker scorer.
Instead, it reads a local JSONL or JSON subset, sends issue-only prompts through
the Responses bridge, and writes:

- a compact JSON report with task IDs, latency, usage, patch hashes, and
  metadata about whether gold patches/test patches were present in the source
  dataset;
- a SWE-bench-compatible predictions JSONL containing `instance_id`,
  `model_name_or_path`, and `model_patch`.

Default artifacts are written outside the repository under
`/srv/aialra/data/opencodexapp/eval/swebench/`. Use `--dry-run` to validate
dataset parsing and report generation without a model call. Use `--write-sample`
only for a synthetic smoke fixture, not for benchmark claims.

Example local subset export:

```bash
python - <<'PY'
from datasets import load_dataset
path = "/srv/aialra/data/swebench/verified-smoke.jsonl"
ds = load_dataset("SWE-bench/SWE-bench_Verified", split="test")
ds.select(range(5)).to_json(path, orient="records", lines=True)
print(path)
PY
```

Example prediction run:

```bash
npm run bench:swe -- \
  --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl \
  --dataset-name SWE-bench/SWE-bench_Verified \
  --split test \
  --limit 5 \
  --timeout-ms 180000
```

The report prints the follow-up official scoring command. Run that command only
on a host with enough Docker capacity, for example with `--max_workers 1`,
`--cache_level env`, and `--clean True` for disk-limited machines.

## Current SWE-bench Scoring Wrapper

`scripts/swebench-evaluate.mjs` is the guarded scoring half. It accepts either a
prediction report from `bench:swe` or a direct predictions JSONL path, builds the
official `python -m swebench.harness.run_evaluation` command, and writes a
compact score report plus Markdown summary under
`/srv/aialra/data/opencodexapp/eval/swebench/`.

Default safety settings are tuned for this deployment rather than leaderboard
runs:

- `--max-workers 1`
- `--cache-level env`
- `--clean True`
- `--max-instances 5` unless `--allow-large-run` is explicitly provided
- `--min-free-gb 120` unless overridden for a known smaller local smoke
- local JSONL subsets are preferred through `--dataset-jsonl`

Use `--dry-run` first. Dry-run still validates predictions, derives instance
IDs, computes patch hashes, checks Docker/Python/SWE-bench availability, checks
free disk, and emits the exact official harness command. Live scoring is just
the same command without `--dry-run`.

Example:

```bash
npm run bench:swe:score -- \
  --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json \
  --dry-run

npm run bench:swe:score -- \
  --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json \
  --max-workers 1 \
  --cache-level env \
  --min-free-gb 120
```

## Current Stability Soak

`scripts/soak-test-bridge.mjs` is the bounded stability harness. It repeatedly
creates stored Responses turns through the live bridge, verifies each response
can expose `/input_items`, deletes the stored responses, and records state
directory growth before creation, after creation, and after cleanup.

The current default suite uses short deterministic marker prompts so it can run
often without large token spend. Longer soak runs should use `--iterations`,
`--output`, and a state directory outside the repository if they are intended as
release evidence rather than a quick regression check.

4. Resource and stability

- Track wall time, provider latency, stream stalls, retries, token usage,
  memory, disk growth, and bridge errors.
- Run soak tests with repeated short Codex turns.
- Validate `previous_response_id` replay cleanup and state directory growth.

## Metrics

| Area | Metric |
| --- | --- |
| Protocol | JSON schema acceptance, event order, tool call round trip |
| Quality | pass@1, resolved task rate, reviewer score |
| Stability | successful turn rate, retry rate, incomplete rate |
| Speed | time to first token, total turn time |
| Resource | tokens, RSS, state bytes per turn, log bytes per turn |
| UX | visible stream continuity, no stuck active turn, no broken buttons |

## 95% Parity Rule

DeepSeek parity should not be asserted from one benchmark. The minimum bar:

- At least 95% of native baseline task success on the chosen task suite.
- No critical UI workflow regressions.
- Stored Chat completion list/get/messages endpoints preserve local `store:true` lifecycle records with pagination and filters.
- Direct Chat passthrough accepts current OpenAI Chat `developer` role requests
  against DeepSeek-compatible providers by normalizing the upstream role,
  mapping `max_completion_tokens` to the configured provider token field,
  validating OpenAI Chat `max_completion_tokens` and `max_tokens` integer/null
  request values before token-limit alias routing,
  mapping OpenAI Chat `reasoning_effort` values to DeepSeek
  `reasoning_effort` / `thinking` after validating the OpenAI
  `none` / `minimal` / `low` / `medium` / `high` / `xhigh` enum before
  provider calls,
  filtering OpenAI Chat custom tools for function-only providers while
  preserving function tools and auditing incompatible `tool_choice` values,
  disabling DeepSeek thinking for direct Chat function-tool `tool_choice`
  requests by default,
  validating OpenAI boolean `parallel_tool_calls` requests before provider
  calls, validating OpenAI Chat `logprobs` boolean/null request values before
  log-probability routing, validating OpenAI Chat `seed` integer/range request
  values before deterministic-sampling passthrough, filtering unsupported OpenAI-only Chat fields, preserving local
  `store`/`metadata` behavior while filtering those unsupported upstream
  fields, validating OpenAI Chat `n` integer bounds before provider calls,
  locally emulating unsupported non-streaming and streaming `n>1` requests with
  merged/remapped `choices`, aggregated `usage`, a single logical streaming
  completion id, and stored Chat messages, validating OpenAI `stream`
  boolean/null request values before stream routing, validating OpenAI
  `store` boolean/null request values before stored-completion routing, mapping stable user identity/cache
  aliases into `user_id`
  without reporting consumed aliases as dropped fields, reflecting
  `safety_identifier` / `prompt_cache_key` in local organization usage
  `user_id` dimensions, and recording the compatibility action in
  returned/stored metadata.
- Local ChatKit coverage creates and cancels beta-style sessions, creates,
  lists, updates, and deletes local threads, appends and lists thread items with
  stable ordering, filters threads by `user`, and includes ChatKit runtime
  state in the prune dry-run/apply policy.
- Local Realtime coverage creates REST sessions, client secrets, transcription
  sessions, translation client secrets, WebRTC call SDP setup responses, and
  accept/reject/refer/hangup call state while keeping generated `ek_...`
  compatibility tokens and call records in pruned runtime state.
- Local Fine-tuning coverage creates a protocol-compatible job, retrieves and
  lists it with metadata filters, lists local lifecycle events and synthetic
  checkpoints, creates/lists/deletes checkpoint permissions, and exercises
  pause/resume/cancel without contacting the upstream Chat provider.
- Local Organization usage/costs coverage records local ledger events from
  Chat Completions, Embeddings, Images, Moderations, Audio speech, and Audio
  transcription paths; also creates local vector-store attachments and a
  Responses turn using `file_search`, `web_search_preview`, and
  `code_interpreter` so hosted-tool counters are non-zero. It verifies usage
  `group_by`/filter aggregation, hashed API-key dimensions, context-level and
  vector-store filters, zero-cost `line_item` quantities for completions and
  local hosted tools, ledger exclusion of prompt/file/code content, cursor
  pagination, and invalid/missing parameter errors.
- Local Organization users/invites coverage verifies project-user-to-org-user
  synchronization, organization user listing/retrieval/email filtering/update/
  delete behavior, project membership cleanup, invite create/list/retrieve/
  delete behavior, and invalid org/project role errors without contacting the
  upstream Chat provider.
- Local Organization roles/groups coverage creates, lists, retrieves, updates,
  and deletes local custom roles and groups, verifies group membership plus
  direct user-role and group-role assignments, validates missing-assignment and
  invalid-permission errors, and checks that all work stays local with zero
  upstream Chat provider calls.
- Local Organization admin API-key coverage creates, lists, retrieves, and
  deletes local redacted `organization.admin_api_key` records, validates that
  the one-time `oc_local_admin_key_` create value is not returned by list/get
  paths, checks pagination, missing-name/missing-key errors, and audit-log
  writes, and avoids storing usable provider keys.
- Local Organization audit-log coverage records local admin lifecycle events,
  validates official list-page shape, `effective_at`, project, event type,
  actor id/email, resource id, `after`/`before` pagination, and invalid filter
  errors without contacting the upstream Chat provider.
- Local Organization project-admin coverage creates and updates a project,
  creates/updates/deletes a project service account, validates one-time
  synthetic service-account key creation, redacted project API-key listing and
  retrieval, service-account-owned key deletion rejection, archive filtering,
  and missing/archived project errors without contacting the upstream Chat
  provider.
- Local Organization project-group coverage grants and revokes local group
  access to projects, validates `group_id` cursor pagination, `group_type`
  retrieve filtering, missing field/missing group errors, audit-log writes,
  and cleanup when the source organization group is deleted.
- Local Organization spend-alert coverage creates, lists, updates, and deletes
  local organization and project threshold alerts, validates required
  `threshold_amount`, supported `currency:"USD"`, email notification-channel
  errors, audit-log filters, pagination, missing-alert errors, and archived
  project rejection without contacting the upstream Chat provider.
- Local Organization certificate coverage uploads local PEM certificate
  metadata, rejects private-key material, retrieves details with and without
  `include[]=content`, updates names, toggles organization/project activation,
  prevents deletion while active at either scope, verifies audit-log filters,
  deletes records, and checks archived project rejection without contacting the
  upstream Chat provider.
- Local Organization policy-control coverage retrieves and updates local
  organization/project data-retention metadata, project model permissions, and
  hosted-tool permissions, validates invalid retention types, model permission
  modes, `model_ids`, hosted-tool `enabled` values, delete/reset behavior,
  audit-log filters, and archived project rejection without contacting the
  upstream Chat provider.
- Local Organization project users/rate-limits coverage creates, lists,
  retrieves, updates, and deletes a local project user, validates project-role
  errors, lists seeded local `project.rate_limit` records, updates numeric
  rate-limit fields, and checks invalid/missing/archived project errors without
  contacting the upstream Chat provider.
- Tool-call replay works across multi-turn tasks.
- Streaming Responses function-tool coverage includes modern Chat
  `delta.tool_calls` in live provider tests and legacy Chat
  `delta.function_call` in mock-provider regression tests, including stored
  replay as Chat `tool_calls` for follow-up `function_call_output` turns.
- Deprecated Chat `functions` / `function_call` request compatibility must be
  tested on both `/v1/responses` Chat-native alias handling and direct
  `/v1/chat/completions`: providers that do not accept the legacy fields should
  receive modern `tools` / `tool_choice` instead, with mapped-field metadata
  recorded rather than generic dropped-field metadata.
- `parallel_tool_calls` compatibility must verify that Responses and direct
  Chat requests reject non-boolean values locally with zero upstream calls, and
  that valid `false` tool-bearing requests sent to providers without native
  field support receive a single-tool-call system instruction, omit the
  upstream `parallel_tool_calls` field, and record mapped compatibility
  metadata.
- Chat choice-count compatibility must verify that Responses Chat-native
  aliases, direct Chat requests, and legacy Completions requests reject `n`
  values outside the official integer 1-128 range locally with zero upstream
  calls, while valid boundary values still enter provider passthrough or local
  fan-out paths.
- Streaming flag compatibility must verify that Responses, direct Chat, and
  legacy Completions reject non-boolean `stream` values locally with zero
  upstream calls, while valid `false` stays on non-streaming paths and valid
  `true` remains covered by existing SSE conversion tests.
- Storage/background flag compatibility must verify that Responses reject
  non-boolean `background` and `store` values locally with zero upstream calls,
  direct Chat rejects non-boolean `store` values locally, valid
  `background:false` stays synchronous, and valid `store:false` does not create
  local stored Responses or Chat completion records.
- Token-limit compatibility must verify that Responses create and local
  `/v1/responses/input_tokens` reject non-integer `max_output_tokens` and
  values below 16 before provider calls, that Responses/direct Chat reject
  non-integer Chat token aliases before provider calls, and that legacy
  Completions rejects non-integer or negative `max_tokens` before
  prompt-to-Chat mapping.
- Seed compatibility must verify that Responses create, local
  `/v1/responses/input_tokens`, direct Chat, and legacy Completions reject
  non-integer or out-of-official-range `seed` values locally with zero upstream
  calls, while valid seeds continue through provider-aware passthrough.
- Responses `include:["message.output_text.logprobs"]` and `top_logprobs` map to Chat logprobs and preserve returned token probability arrays in output text content, while stored response retrieval hides or returns them according to the include query. Regression coverage also validates official `logprobs` boolean/null handling on Responses and direct Chat requests, official `top_logprobs` integer bounds, the direct Chat requirement that `logprobs:true` be present whenever `top_logprobs` is set, and legacy Completions `echo` boolean/null plus `logprobs` integer 0..5 validation before prompt-to-Chat mapping.
- Stored Responses metadata update and completed-response cancel/no-op paths apply the same include projection as response retrieval, so include-gated fields are not exposed by lifecycle endpoints unless explicitly requested.
- Responses and Conversations input-item retrieval hides message input image URLs and computer output image URLs by default, returning them only when `include:["message.input_image.image_url"]` or `include:["computer_call_output.output.image_url"]` is requested.
- Non-streaming Chat responses with multiple `choices[]` map each returned message/tool/function call into Responses output items instead of dropping all but `choices[0]`.
- Local Assistants compatibility runs deprecated Assistants/Threads workflows
  through upstream Chat Completions, persists assistant messages and
  `message_creation` Run Steps, verifies function-tool `requires_action` /
  `submit_tool_outputs` continuation with `tool_calls` Run Steps, rejects
  message creation and run creation while an active run is waiting for tool
  outputs, expires stale `requires_action` runs when `expires_at` has elapsed,
  verifies run `additional_messages`, `additional_instructions`, and
  `reasoning_effort` DeepSeek thinking compatibility, including
  attachment-created thread vector stores before the run starts,
  and checks create-and-run lifecycle SSE event shape plus streamed message
  deltas. It also verifies local Assistants `file_search` and `code_interpreter`
  adapters, including resource merging, local tool evidence injection, Run Step
  persistence, include-gated `file_search` result content on list/retrieve and
  streaming Run Step events, file citations, attachment-created thread vector
  stores, and mounted file resources.
- Responses compatibility requests that include Chat-native `stop` sequences validate the official string-or-up-to-4-strings shape locally, forward valid values to upstream Chat providers, and verify the stop marker is omitted from visible output.
- Responses and direct Chat requests that include Chat-native `logit_bias` validate the official object/value contract locally before provider calls, including invalid object shapes, non-number bias values, and out-of-range values, while valid -100 and 100 boundaries still pass through to upstream Chat providers unchanged.
- Responses and direct Chat requests that include `reasoning.effort`,
  direct Chat `reasoning_effort`, or a direct Chat `reasoning` object validate
  the current OpenAI reasoning-effort enum locally before provider calls; valid
  OpenAI values still reach the existing DeepSeek `reasoning_effort` /
  `thinking` compatibility mapper, while provider-only aliases such as
  DeepSeek `max` fail at the OpenAI-compatible boundary.
- Legacy `/v1/completions` requests that include `logit_bias` use the same local object/value contract validation before non-streaming or streaming Chat-backed execution, with regression coverage for zero upstream calls on invalid values and boundary passthrough for valid values.
- Responses and direct Chat requests that include Chat-native `verbosity` validate the official `low` / `medium` / `high` enum locally before provider calls, with regression coverage for invalid strings, case mismatches, empty strings, and non-string values producing zero upstream calls while valid values still feed the provider-aware passthrough or prompt-instruction compatibility path.
- Responses and direct Chat requests that include Chat-native `service_tier` validate the official `auto` / `default` / `flex` / `priority` enum locally before provider calls, with regression coverage for invalid strings, case mismatches, legacy tier names, and non-string values producing zero upstream calls while valid values still follow provider-aware passthrough/filtering.
- Responses `text.format` and direct Chat `response_format` requests validate the official `text` / `json_object` / `json_schema` union locally before provider calls, including response-format object shape, schema config `name`, required Responses `schema`, optional Chat `json_schema.schema`, `strict` boolean/null, and `description` string/null coverage with zero upstream calls on invalid structures.
- Responses and direct Chat sampling requests validate official `temperature`, `top_p`, `frequency_penalty`, and `presence_penalty` numeric bounds locally before provider calls, while valid boundary values still pass through to upstream Chat providers unchanged.
- Local `code_interpreter` compatibility emits `code_interpreter_call` items and only includes nested call logs when `include:["code_interpreter_call.outputs"]` is requested on create or stored-response retrieval.
- Local reasoning compatibility emits `reasoning` items with encrypted local replay payloads hidden by default and returned only when `include:["reasoning.encrypted_content"]` is requested on create or stored-response retrieval.
- Local `web_search` compatibility emits `web_search_call` items and only includes `action.sources` when `include:["web_search_call.action.sources"]` is requested on create or stored-response retrieval.
- Local `file_search` compatibility emits `file_search_call` items and only includes search result details when `include:["file_search_call.results"]` is requested on create or stored-response retrieval.
- Background response polling and cancellation remain stable for in-process jobs.
- Stale in-progress background responses left by a bridge restart either resume
  from a safe persisted `preparing` checkpoint or `provider_pending` snapshot,
  or reconcile to explicit failed terminal records when no safe resume snapshot
  exists.
- Startup recovery must not duplicate work owned by another bridge process:
  background records with an unexpired foreign lease are skipped, while expired
  leases can be claimed before safe resume/reconcile actions continue.
- Responses `truncation:"auto"` drops oldest local `conversation` /
  `previous_response_id` replay messages before upstream Chat calls when the
  local context budget is exceeded, while disabled truncation returns a bounded
  `context_length_exceeded` error before provider calls.
- Responses `context` request compatibility records the official
  context-management field as a local boundary only: mock-provider tests must
  prove it is not forwarded to Chat Completions providers, compatibility
  metadata exposes only the value type and object keys, and caller-provided
  context values do not leak into compatibility metadata.
- Responses `input_file` and direct Chat `file` / `input_file` text extraction works for local file IDs, completed text/PDF Uploads API files, inline base64 payloads, bounded HTTP(S) file URLs, PDF text layers, optional bounded local PDF OCR fallback, deterministic CSV/TSV/XLSX spreadsheet augmentation, and basic `.docx`/`.pptx` OOXML document text, with failed/unsupported/truncated files surfaced in compatibility metadata.
- Local Uploads API lifecycle creates pending Upload objects, adds Parts, completes ordered `part_ids` into usable byte-preserving Files, validates optional local SHA-256 part/final checksums, rejects byte-count and checksum mismatches, records completed File checksum metadata, persists expired pending Uploads as `status:"expired"`, blocks new Parts after cancellation, completion, or expiration, prunes intermediate Part `.bin` files by default after completion/cancellation/expiration while keeping metadata/checksums, and includes Upload workdirs in runtime prune coverage.
- Local Batch API accepts `purpose:"batch"` JSONL Files, executes supported endpoints including Responses `image_generation`, direct `/v1/audio/transcriptions`, direct `/v1/audio/translations`, direct `/v1/images/generations`, JSON-form direct `/v1/images/edits`, JSON-form direct `/v1/images/variations`, and direct `/v1/videos` requests, exposes OpenAI-style Batch objects, and writes output/error JSONL Files that can be read through `/v1/files/{file_id}/content`.
- Local Evals API accepts eval definitions, `purpose:"evals"` JSONL Files,
  synchronous Responses-template runs, deterministic `string_check`,
  `text_similarity`, local subprocess `python`, provider-backed `score_model`,
  and non-nested `multi` grading, result aggregation, output item list/get, run
  list/get, eval metadata update, and eval deletion.
- Local Graders API evaluation covers
  `/v1/fine_tuning/alpha/graders/validate` and
  `/v1/fine_tuning/alpha/graders/run` for deterministic graders, local
  subprocess `python`, and provider-backed `score_model`, including Python
  runtime error flags and judge token accounting.
- Hosted-tool emulation returns auditable search/open-page/find-in-page call items, create/retrieve `web_search_call.action.sources` projection, and citations for web search.
- Responses `max_tool_calls` is enforced across local hosted-tool emulation so
  skipped web/file/shell/computer/image-generation actions are not executed and
  are recorded in compatibility metadata.
- Hosted-tool emulation returns auditable call items and citations for file search.
- Hosted-tool emulation returns auditable `image_generation_call` items with
  base64 PNG `result` data, `revised_prompt`, streaming partial-image events,
  local placeholder metadata, OpenAI-compatible Images API `data[0].b64_json`
  mapping, multipart edit/mask mapping to `image[]` and `mask`, and failed
  provider call mapping for image-generation protocol coverage; Batch JSONL
  `/v1/responses` image-generation cases preserve those output items in Batch
  output files.
- Direct Images API evaluation covers `/v1/images/generations` JSON responses,
  `/v1/images/edits` JSON edit responses, `/v1/images/variations` JSON
  variation responses, Image API SSE streaming for direct generation and edit
  endpoints, multi-image `n` handling, and local Batch JSONL execution over
  direct image-generation, image-edit, and image-variation requests.
- Direct Audio API evaluation covers `/v1/audio/speech` placeholder bytes,
  `/v1/audio/transcriptions` multipart, JSON/base64, verbose JSON, and SSE
  paths, `/v1/audio/translations` multipart and JSON/base64 paths, custom
  voice consent/voice metadata lifecycle, and local Batch JSONL execution over
  audio transcription and translation requests.
- Direct Videos API evaluation covers `/v1/videos` create, `GET
  /v1/videos/{video_id}`, `GET /v1/videos/{video_id}/content`, list, delete,
  `/v1/videos/characters` create/retrieve/delete, `characters` references on
  video creation, `/v1/videos/edits`, `/v1/videos/extensions`,
  `/v1/videos/{video_id}/edits` compatibility alias, remix source tracking, and
  local Batch JSONL execution over `/v1/videos` JSON
  requests.
- Local vector-store file batches accept both OpenAI batch request shapes and remain compatible with file-search retrieval.
- Local vector-store files honor static `chunking_strategy` limits and expose chunk metadata through file content and search results.
- Local vector stores refresh `last_active_at` / `expires_at` when searched and
  fail closed with `vector_store_expired` once their expiration policy is past.
- Local file-search honors `ranking_options.score_threshold` and preserves ranker metadata in search/call audit output.
- Local file-search accepts vector-store search query arrays and emits multiple `file_search_call.queries` with per-result `matched_queries`.
- Local file-search accepts comparison and compound attribute filters, including
  `attribute_filter` aliases, without silently treating invalid filters as
  matches.
- Local file-search supports deterministic local hashed-semantic search, exposes
  `text_score` and `embedding_score`, and honors
  `hybrid_search.embedding_weight` / `hybrid_search.text_weight`.
- Hosted-tool emulation returns auditable shell call/output items and downloadable artifacts for shell/code-interpreter requests.
- Hosted-tool emulation returns auditable screenshot-first `computer_call`
  items for computer-use requests and maps returned `computer_call_output`
  screenshot/result context into follow-up Chat requests, including streaming
  follow-up action requests through a generated Chat function tool and
  compatibility metadata for pending and acknowledged safety checks.
- Local Skills API can create, version, retrieve zip content, delete, and mount
  `skill_reference` bundles into local shell/code-interpreter containers.
- P95 bridge overhead stays below 750 ms excluding upstream model latency.
- State/log growth remains bounded under the configured cleanup policy, with
  `npm run prune:runtime -- --dry-run` producing an auditable candidate report
  and `--apply` reserved for explicit pruning.

## SWE-bench Storage Policy

Do not download full SWE-bench artifacts into this repo. Use an external cache
under `/srv/aialra/data` or a small sample set. Record exact dataset revision,
task IDs, model, bridge commit, Codex version, and run command in `docs/audit-log.md`.
The official SWE-bench repository warns that evaluation is resource intensive
and recommends about 120GB free storage, 16GB RAM, 8 CPU cores, and Docker-based
execution; this deployment must therefore start with Lite, Verified subsets, or
external caches rather than repository-local artifacts.

Current public SWE-bench references to track:

- SWE-bench official repository: https://github.com/swe-bench/SWE-bench
- SWE-bench Verified dataset: https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified
- SWE-bench leaderboard and dataset overview: https://www.swebench.com/

The next evaluation milestone is a disk-bounded runner that samples
SWE-bench Verified or SWE-bench Lite into `/srv/aialra/data`, executes inside
Docker, and writes only compact JSON/Markdown reports back to this repo. The
prediction-generation half now exists as `npm run bench:swe`; the Docker scorer
wrapper and result parser now exist as `npm run bench:swe:score`. The remaining
milestone is an actual small Verified/Lite live scorer run on a host with enough
Docker cache and disk capacity, followed by native Codex baseline comparison.

## Initial Command Skeleton

```bash
npm test
npm run secret-scan
node scripts/eval-harness.mjs --suite protocol-smoke --model deepseek-v4-pro
npm run eval:bridge -- --timeout-ms 45000
```
