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
  variables, sidebar/search/settings controls, prompt send, model response
  visibility, console errors, screenshot capture, and reload persistence.
- Expand coverage for project open, stop/retry, file upload, generated
  image/file display, and complete page switching.
- Record screenshots and console logs under ignored `output/playwright/`.

3. Agent task quality

- Start with small deterministic coding tasks to avoid large downloads.
- Add SWE-bench Verified lite/sample only after disk and runtime limits are set.
- Add HumanEval/MBPP-style unit-test tasks for quick regression checks.
- Add repository-maintenance tasks from this repo: docs edit, failing test fix,
  tool-call loop, and multi-turn state replay.

## Current Starter Harness

`scripts/eval-harness.mjs` is the always-on, low-cost regression harness. It is
not a substitute for SWE-bench, but it catches bridge regressions before running
larger agent evaluations.

| Suite | Coverage |
| --- | --- |
| `protocol-smoke` | Responses text generation and JSON schema compatibility |
| `bridge-regression` | Protocol smoke plus model retrieval, local OpenAI-compatible embeddings, standalone and inline local OpenAI-compatible moderations, local Batch API JSONL execution over embeddings and moderations with Files output retrieval, Chat passthrough, legacy `/v1/completions` prompt-to-Chat mapping, stored Chat lifecycle including non-streaming and streaming Chat completion list/get/update-metadata/messages/delete, Responses input-token counting, Responses local prompt-template expansion, Responses output logprobs mapping, non-streaming multi-choice Chat-to-Responses mapping, Chat-native stop sequence passthrough, local `input_file` extraction including completed text and binary/PDF Uploads API files, HTTP(S) `file_url`, PDF text-layer extraction, deterministic spreadsheet augmentation, and `.docx`/`.xlsx`/`.pptx` OOXML text extraction, local background completion, local background startup reconciliation in unit tests, local Conversations lifecycle and Responses `conversation` replay across create, `/input_tokens`, and `/compact`, local hosted-tool `max_tool_calls` budget enforcement, local web-search search/open-page/find-in-page/citation mapping, local file-search/vector-store citation mapping including vector-store update/file update/content, static chunking strategy, ranking options, multi-query search, comparison/compound attribute filters, local hashed-semantic hybrid search, and file batches, local shell/container artifact mapping including Skills API `skill_reference` mounting, local compaction continuation, local Responses `reasoning.encrypted_content` round-trip coverage in unit tests, SSE events, function-tool `tool_choice`, and `previous_response_id` replay |
| `code-benchmark` | Small issue-to-patch coding tasks that generate complete replacement files, apply them, and run tests |
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
node scripts/eval-harness.mjs --suite bridge-regression --case batch-embeddings-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case batch-moderations-local --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case completions-legacy --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case chat-stream-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-web-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-max-tool-calls --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-shell-skill --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case responses-file-search-batch --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --case vector-store-lifecycle --timeout-ms 90000 --verbose
node scripts/eval-harness.mjs --suite bridge-regression --repeat 5 --output /srv/aialra/data/opencodexapp/eval/bridge-regression.json
npm run smoke:ui -- --timeout-ms 180000
npm run bench:code -- --timeout-ms 180000
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
- Tool-call replay works across multi-turn tasks.
- Responses `include:["message.output_text.logprobs"]` and `top_logprobs` map to Chat logprobs and preserve returned token probability arrays in output text content.
- Non-streaming Chat responses with multiple `choices[]` map each returned message/tool/function call into Responses output items instead of dropping all but `choices[0]`.
- Responses compatibility requests that include Chat-native `stop` sequences forward them to upstream Chat providers and verify the stop marker is omitted from visible output.
- Background response polling and cancellation remain stable for in-process jobs.
- Stale in-progress background responses left by a bridge restart are reconciled
  to explicit failed terminal records instead of remaining stuck forever.
- Responses `input_file` text extraction works for local file IDs, completed text/PDF Uploads API files, inline base64 payloads, bounded HTTP(S) file URLs, PDF text layers, deterministic CSV/TSV/XLSX spreadsheet augmentation, and basic `.docx`/`.pptx` OOXML document text, with failed/unsupported/truncated files surfaced in compatibility metadata.
- Local Uploads API lifecycle creates pending Upload objects, adds Parts, completes ordered `part_ids` into usable byte-preserving Files, rejects byte-count mismatches, and blocks new Parts after cancellation.
- Local Batch API accepts `purpose:"batch"` JSONL Files, executes supported endpoints, exposes OpenAI-style Batch objects, and writes output/error JSONL Files that can be read through `/v1/files/{file_id}/content`.
- Hosted-tool emulation returns auditable search/open-page/find-in-page call items, requested `web_search_call.action.sources`, and citations for web search.
- Responses `max_tool_calls` is enforced across local hosted-tool emulation so
  skipped web/file/shell actions are not executed and are recorded in
  compatibility metadata.
- Hosted-tool emulation returns auditable call items and citations for file search.
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
