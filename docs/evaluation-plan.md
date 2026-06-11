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
  DeepSeek runs only verify that text-only providers remain stable when audio
  request fields are filtered.
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
| `bridge-regression` | Protocol smoke plus model retrieval, local OpenAI-compatible embeddings, standalone and inline local OpenAI-compatible moderations, local Batch API JSONL execution over Responses, local Evals API lifecycle over `purpose:"evals"` Files and deterministic `string_check` output items, local Graders API validate/run coverage for `string_check`, `text_similarity`, local subprocess `python`, `multi`, and provider-backed `score_model`, Responses image-generation, Chat Completions, legacy Completions, embeddings, direct `/v1/audio/speech`, direct `/v1/audio/transcriptions`, direct `/v1/audio/translations`, direct Audio custom voice consent/voice lifecycle, direct `/v1/images/generations`, direct `/v1/images/edits`, direct `/v1/images/variations`, direct Videos API lifecycle, and moderations with Files output/error retrieval, Chat passthrough including direct OpenAI Chat `developer` role normalization, `max_completion_tokens`, `reasoning_effort`, top-level `reasoning:{effort}` object normalization, OpenAI Chat custom-tool filtering for function-only providers, local stored-chat `store`/`metadata` preservation with provider filtering, provider-aware `stream_options` subfield filtering, and direct Chat `tool_choice` DeepSeek compatibility, and DeepSeek field filtering including `parallel_tool_calls`, legacy `/v1/completions` prompt-to-Chat mapping, stored Chat lifecycle including non-streaming and streaming Chat completion list/get/update-metadata/messages/delete, stored Responses lifecycle including get/update-metadata/input_items/cancel/delete, Responses input-token counting, Responses local prompt-template expansion, local MCP `mcp_list_tools` protocol-context compatibility, Responses `reasoning.effort:"none"` to DeepSeek non-thinking compatibility, Responses output logprobs mapping plus `message.output_text.logprobs` create, stored-response retrieve, metadata-update, and completed-cancel include projection, Responses `input_image.detail`, data-URL, and local Files API `file_id` mapping plus `input_audio` to Chat content-part mapping in unit/mock-provider tests, input-item `include:["message.input_image.image_url"]` and `include:["computer_call_output.output.image_url"]` projection for Responses and Conversations item retrieval, Chat audio output preservation and replay in unit/mock-provider tests, non-streaming multi-choice Chat-to-Responses mapping, Chat-native stop sequence passthrough, local `input_file` extraction including completed text and binary/PDF Uploads API files, HTTP(S) `file_url`, PDF text-layer extraction, deterministic spreadsheet augmentation, and `.docx`/`.xlsx`/`.pptx` OOXML text extraction, local background completion, local background stored-chat filtering, local background startup reconciliation, `provider_pending` resume, ready `preparing` checkpoint resume, active foreign lease skip, expired lease takeover, and running-step fail-closed coverage in unit tests, local truncation auto/disabled behavior in unit tests, local Conversations lifecycle and Responses `conversation` replay across create, `/input_tokens`, and `/compact`, local hosted-tool `max_tool_calls` budget enforcement, local web-search search/open-page/find-in-page/citation mapping plus `web_search_call.action.sources` create and stored-response include projection, local file-search/vector-store citation mapping including vector-store update/file update/content, static chunking strategy, ranking options, multi-query search, comparison/compound attribute filters, local hashed-semantic hybrid search, file batches, and `file_search_call.results` create and stored-response include projection, local shell/container artifact mapping including Skills API `skill_reference` mounting, local `code_interpreter_call.outputs` create and stored-response include projection, local computer-use screenshot-first `computer_call` compatibility, local image-generation `image_generation_call` output, streaming partial-image, edit/mask compatibility, id-only multi-turn edit, direct Images API generation/edit JSON/SSE and variation JSON compatibility, direct Videos create/retrieve/content/delete compatibility, and Batch JSONL compatibility for Responses image_generation, direct Audio transcription/translation, direct Images generation/edit/variation, and direct Videos generation, local compaction continuation, local Responses `reasoning.encrypted_content` round-trip and stored-response include projection coverage in unit tests, SSE events, function-tool `tool_choice`, and `previous_response_id` replay |
| `code-benchmark` | Small issue-to-patch coding tasks that generate complete replacement files, apply them, and run tests; includes the default `micro` suite, the broader `humaneval-mbpp` function-repair suite, and the `repo-maintenance` suite for docs/config/test/tool-loop/replay tasks |
| `swebench-runner` | Disk-bounded SWE-bench prediction generator for local JSONL subsets; writes official predictions JSONL and compact audit reports outside the repo |
| `swebench-evaluate` | Guarded wrapper around the official SWE-bench Docker harness; parses scorer artifacts into compact JSON/Markdown reports |
| `bridge-soak` | Repeated stored Responses turns, `/input_items` checks, DELETE cleanup, latency, token usage, and state directory growth |
| `runtime-prune` | Dry-run and apply checks for ignored runtime artifacts under `output/`, `.playwright-cli/`, and bounded bridge state records |

Useful commands:

```bash
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
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
node scripts/eval-harness.mjs --suite bridge-regression --case responses-inline-moderation --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-reasoning-encrypted --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case batch-embeddings-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case batch-moderations-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case evals-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case graders-api-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case graders-api-score-model --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-mcp-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case completions-legacy --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case chat-stream-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-web-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-max-tool-calls --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-computer --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell-skill --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search-batch --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case vector-store-lifecycle --timeout-ms 90000 --verbose
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
  mapping OpenAI Chat `reasoning_effort` values to DeepSeek
  `reasoning_effort` / `thinking`,
  filtering OpenAI Chat custom tools for function-only providers while
  preserving function tools and auditing incompatible `tool_choice` values,
  disabling DeepSeek thinking for direct Chat function-tool `tool_choice`
  requests by default,
  filtering unsupported OpenAI-only Chat fields such as
  `parallel_tool_calls`, preserving local `store`/`metadata` behavior while
  filtering those unsupported upstream fields, mapping stable user identity into `user_id`, and
  recording the compatibility action in returned/stored metadata.
- Tool-call replay works across multi-turn tasks.
- Responses `include:["message.output_text.logprobs"]` and `top_logprobs` map to Chat logprobs and preserve returned token probability arrays in output text content, while stored response retrieval hides or returns them according to the include query.
- Stored Responses metadata update and completed-response cancel/no-op paths apply the same include projection as response retrieval, so include-gated fields are not exposed by lifecycle endpoints unless explicitly requested.
- Responses and Conversations input-item retrieval hides message input image URLs and computer output image URLs by default, returning them only when `include:["message.input_image.image_url"]` or `include:["computer_call_output.output.image_url"]` is requested.
- Non-streaming Chat responses with multiple `choices[]` map each returned message/tool/function call into Responses output items instead of dropping all but `choices[0]`.
- Responses compatibility requests that include Chat-native `stop` sequences forward them to upstream Chat providers and verify the stop marker is omitted from visible output.
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
- Responses `input_file` text extraction works for local file IDs, completed text/PDF Uploads API files, inline base64 payloads, bounded HTTP(S) file URLs, PDF text layers, deterministic CSV/TSV/XLSX spreadsheet augmentation, and basic `.docx`/`.pptx` OOXML document text, with failed/unsupported/truncated files surfaced in compatibility metadata.
- Local Uploads API lifecycle creates pending Upload objects, adds Parts, completes ordered `part_ids` into usable byte-preserving Files, rejects byte-count mismatches, and blocks new Parts after cancellation.
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
  and local Batch JSONL execution over `/v1/videos` JSON requests.
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
  screenshot/result context into follow-up Chat requests.
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
