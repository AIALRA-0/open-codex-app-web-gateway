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
- Cover login, dashboard, project open, thread create, prompt send, streaming,
  stop/retry, file upload, generated image/file display, and page reload.
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
| `bridge-regression` | Protocol smoke plus Chat passthrough, Responses SSE events, function-tool `tool_choice`, and `previous_response_id` replay |

Useful commands:

```bash
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
node scripts/eval-harness.mjs --suite bridge-regression --case responses-function-tool --verbose
node scripts/eval-harness.mjs --suite bridge-regression --repeat 5 --output /srv/aialra/data/opencodexapp/eval/bridge-regression.json
```

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
