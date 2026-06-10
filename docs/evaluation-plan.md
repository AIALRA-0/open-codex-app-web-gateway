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
| `bridge-regression` | Protocol smoke plus Chat passthrough, stored Chat lifecycle, Responses input-token counting, SSE events, function-tool `tool_choice`, and `previous_response_id` replay |
| `code-benchmark` | Small issue-to-patch coding tasks that generate complete replacement files, apply them, and run tests |
| `bridge-soak` | Repeated stored Responses turns, `/input_items` checks, DELETE cleanup, latency, token usage, and state directory growth |

Useful commands:

```bash
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
node scripts/eval-harness.mjs --suite bridge-regression --case responses-function-tool --verbose
node scripts/eval-harness.mjs --suite bridge-regression --repeat 5 --output /srv/aialra/data/opencodexapp/eval/bridge-regression.json
npm run smoke:ui -- --timeout-ms 180000
npm run bench:code -- --timeout-ms 180000
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
- Tool-call replay works across multi-turn tasks.
- P95 bridge overhead stays below 750 ms excluding upstream model latency.
- State/log growth remains bounded under the configured cleanup policy.

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
Docker, and writes only compact JSON/Markdown reports back to this repo.

## Initial Command Skeleton

```bash
npm test
npm run secret-scan
node scripts/eval-harness.mjs --suite protocol-smoke --model deepseek-v4-pro
npm run eval:bridge -- --timeout-ms 45000
```
