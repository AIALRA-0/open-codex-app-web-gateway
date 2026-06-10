#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const datasetJsonl = args.get("dataset-jsonl") || args.get("dataset");
const outputDir = path.resolve(String(
  args.get("output-dir") ||
  process.env.CODEXCOMPAT_SWEBENCH_OUTPUT_DIR ||
  "/srv/aialra/data/opencodexapp/eval/swebench",
));
const outputPath = path.resolve(String(args.get("output") || path.join(outputDir, `report-${stamp}.json`)));
const predictionsPath = path.resolve(String(args.get("predictions") || path.join(outputDir, `predictions-${stamp}.jsonl`)));
const baseUrl = trimTrailingSlash(args.get("base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912");
const model = String(args.get("model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro");
const datasetName = String(args.get("dataset-name") || "SWE-bench/SWE-bench_Verified");
const split = String(args.get("split") || "test");
const runId = String(args.get("run-id") || `opencodexapp-${stamp}`);
const limit = parsePositiveInt(args.get("limit"), 10);
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 180000);
const maxOutputTokens = parsePositiveInt(args.get("max-output-tokens"), 4096);
const maxProblemChars = parsePositiveInt(args.get("max-problem-chars"), 40000);
const maxPatchChars = parsePositiveInt(args.get("max-patch-chars"), 240000);
const dryRun = args.has("dry-run");
const writeSample = args.has("write-sample");
const verbose = args.has("verbose");
const taskIds = parseTaskIds(args.values("task-id"));

if (!datasetJsonl) {
  usage("Missing required --dataset-jsonl <path>.");
}

const datasetPath = path.resolve(String(datasetJsonl));
if (writeSample) writeSampleDataset(datasetPath);
if (!fs.existsSync(datasetPath)) {
  usage(`Dataset JSONL does not exist: ${datasetPath}`);
}

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(predictionsPath), { recursive: true, mode: 0o700 });

const startedAt = new Date().toISOString();
const results = [];
const selectedTaskIds = [];
const predictionLines = [];

for await (const task of selectTasks(datasetPath, { limit, taskIds })) {
  if (verbose) console.error(`running ${task.instance_id}`);
  selectedTaskIds.push(task.instance_id);
  const result = dryRun ? dryRunTask(task) : await generatePrediction(task);
  results.push(result);
  predictionLines.push(JSON.stringify({
    instance_id: task.instance_id,
    model_name_or_path: model,
    model_patch: result.model_patch || "",
  }));
}

if (!results.length) {
  usage(`No SWE-bench tasks selected from ${datasetPath}.`);
}

fs.writeFileSync(predictionsPath, `${predictionLines.join("\n")}\n`, { mode: 0o600 });

const report = makeReport({
  baseUrl,
  datasetName,
  datasetPath,
  dryRun,
  model,
  outputPath,
  predictionsPath,
  results,
  runId,
  selectedTaskIds,
  split,
  startedAt,
});
const serialized = `${JSON.stringify(report, null, 2)}\n`;
fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
console.log(serialized);
process.exit(report.summary.transport_errors === 0 && report.summary.secret_rejected === 0 ? 0 : 1);

function parseArgs(argv) {
  const parsed = new Map();
  const lists = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    const value = !next || next.startsWith("--") ? true : next;
    parsed.set(key, value);
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(value);
    if (value !== true) index += 1;
  }
  parsed.values = (key) => lists.get(key) || [];
  return parsed;
}

function usage(message) {
  if (message) console.error(message);
  console.error([
    "Usage:",
    "  node scripts/swebench-runner.mjs --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl --limit 3",
    "",
    "Useful flags:",
    "  --dry-run                 Parse tasks and write empty official predictions without calling the model.",
    "  --write-sample            Create a tiny synthetic JSONL at --dataset-jsonl before running.",
    "  --task-id <id>            Select one or more instance IDs; comma separated values are accepted.",
    "  --output <path>           Write compact JSON report. Defaults under /srv/aialra/data/opencodexapp/eval/swebench.",
    "  --predictions <path>      Write SWE-bench predictions JSONL. Defaults beside the report.",
  ].join("\n"));
  process.exit(2);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseTaskIds(values) {
  return new Set(
    values
      .flatMap((value) => String(value).split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function writeSampleDataset(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const sample = {
    instance_id: "synthetic__tiny-1",
    repo: "synthetic/tiny",
    base_commit: "0000000000000000000000000000000000000000",
    problem_statement: "Fix add(a, b) so it returns the numeric sum instead of the first argument.",
    hints_text: "",
    patch: "diff --git a/math.py b/math.py\n--- a/math.py\n+++ b/math.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a\n+    return a + b\n",
    test_patch: "diff --git a/test_math.py b/test_math.py\nnew file mode 100644\n--- /dev/null\n+++ b/test_math.py\n@@ -0,0 +1,2 @@\n+from math import add\n+assert add(2, 3) == 5\n",
  };
  fs.writeFileSync(filePath, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
}

async function* selectTasks(filePath, { limit: maxTasks, taskIds: selectedIds }) {
  let yielded = 0;
  for await (const rawRecord of readDataset(filePath)) {
    const task = normalizeTask(rawRecord);
    if (!task) continue;
    if (selectedIds.size && !selectedIds.has(task.instance_id)) continue;
    yield task;
    yielded += 1;
    if (yielded >= maxTasks) break;
    if (selectedIds.size && yielded >= selectedIds.size) break;
  }
}

async function* readDataset(filePath) {
  if (filePath.endsWith(".json")) {
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const records = Array.isArray(json) ? json : json.data;
    if (!Array.isArray(records)) throw new Error("JSON dataset must be an array or contain a data array.");
    for (const record of records) yield record;
    return;
  }

  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

function normalizeTask(record) {
  if (!record || typeof record !== "object") return null;
  const instanceId = firstString(record.instance_id, record.id);
  const problemStatement = firstString(record.problem_statement, record.issue, record.prompt);
  if (!instanceId || !problemStatement) return null;
  return {
    instance_id: instanceId,
    repo: firstString(record.repo, record.repository, ""),
    base_commit: firstString(record.base_commit, record.commit, ""),
    problem_statement: problemStatement,
    hints_text: firstString(record.hints_text, record.hints, ""),
    created_at: firstString(record.created_at, ""),
    version: firstString(record.version, ""),
    gold_patch_present: typeof record.patch === "string" && record.patch.length > 0,
    test_patch_present: typeof record.test_patch === "string" && record.test_patch.length > 0,
    fail_to_pass_count: countMaybeArray(record.FAIL_TO_PASS ?? record.fail_to_pass),
    pass_to_pass_count: countMaybeArray(record.PASS_TO_PASS ?? record.pass_to_pass),
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function countMaybeArray(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "string" || !value.trim()) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 1;
  }
}

function dryRunTask(task) {
  return {
    instance_id: task.instance_id,
    ok: true,
    mode: "dry-run",
    elapsed_ms: 0,
    model_patch: "",
    model_patch_sha256: sha256(""),
    model_patch_chars: 0,
    empty_patch: true,
    diff_like: false,
    prompt_chars: makePrompt(task).length,
    metadata: taskMetadata(task),
    generation: {
      skipped: true,
      usage: zeroUsage(),
    },
  };
}

async function generatePrediction(task) {
  const prompt = makePrompt(task);
  const request = {
    model,
    input: prompt,
    max_output_tokens: maxOutputTokens,
    temperature: 0,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "swebench_prediction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["model_patch", "notes"],
          properties: {
            model_patch: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
  };

  const started = performance.now();
  let response;
  let body;
  try {
    response = await postJson(`${baseUrl}/v1/responses`, request);
    body = await response.text();
  } catch (error) {
    return {
      instance_id: task.instance_id,
      ok: false,
      mode: "live",
      elapsed_ms: Math.round(performance.now() - started),
      model_patch: "",
      model_patch_sha256: sha256(""),
      model_patch_chars: 0,
      empty_patch: true,
      diff_like: false,
      prompt_chars: prompt.length,
      metadata: taskMetadata(task),
      generation: {
        status: null,
        error: truncate(error?.message || String(error)),
        usage: zeroUsage(),
      },
    };
  }

  const elapsedMs = Math.round(performance.now() - started);
  if (!response.ok) {
    return {
      instance_id: task.instance_id,
      ok: false,
      mode: "live",
      elapsed_ms: elapsedMs,
      model_patch: "",
      model_patch_sha256: sha256(""),
      model_patch_chars: 0,
      empty_patch: true,
      diff_like: false,
      prompt_chars: prompt.length,
      metadata: taskMetadata(task),
      generation: {
        status: response.status,
        error: truncate(body),
        usage: zeroUsage(),
      },
    };
  }

  const json = parseJsonOrNull(body);
  const text = outputText(json);
  const parsed = parseJsonish(text);
  const rawPatch = typeof parsed?.model_patch === "string" ? parsed.model_patch : "";
  const modelPatch = rawPatch.length > maxPatchChars ? rawPatch.slice(0, maxPatchChars) : rawPatch;
  const secretFindings = findSecretLike(modelPatch);
  const parseError = typeof parsed?.model_patch === "string" ? null : "model output did not contain model_patch string";
  const truncated = rawPatch.length > maxPatchChars;

  return {
    instance_id: task.instance_id,
    ok: !parseError && secretFindings.length === 0,
    mode: "live",
    elapsed_ms: elapsedMs,
    model_patch: secretFindings.length ? "" : modelPatch,
    model_patch_sha256: sha256(secretFindings.length ? "" : modelPatch),
    model_patch_chars: secretFindings.length ? 0 : modelPatch.length,
    empty_patch: !modelPatch.trim() || secretFindings.length > 0,
    diff_like: looksLikeDiff(modelPatch) && secretFindings.length === 0,
    prompt_chars: prompt.length,
    metadata: taskMetadata(task),
    generation: {
      status: response.status,
      usage: responseUsage(json),
      notes: truncate(parsed?.notes || ""),
      output_text_preview: truncate(text),
      parse_error: parseError,
      patch_truncated: truncated,
      secret_findings: secretFindings,
    },
  };
}

function makePrompt(task) {
  const problem = truncateMiddle(task.problem_statement, maxProblemChars);
  const hints = truncateMiddle(task.hints_text || "", Math.min(8000, maxProblemChars));
  return [
    "You are generating a SWE-bench prediction for an OpenCodexApp compatibility evaluation.",
    "Return only JSON matching the schema. The model_patch field must be a git unified diff that can be applied to the repository at base_commit.",
    "Do not include Markdown fences, explanations, shell transcripts, or test output in model_patch.",
    "Do not modify tests unless the issue requires test fixtures as part of the production fix.",
    "If the issue cannot be solved from the provided issue text alone, return an empty model_patch and explain the limitation in notes.",
    "The prompt intentionally omits gold patches and test patches to avoid benchmark leakage.",
    "",
    "Task metadata:",
    `instance_id: ${task.instance_id}`,
    task.repo ? `repo: ${task.repo}` : "repo: unknown",
    task.base_commit ? `base_commit: ${task.base_commit}` : "base_commit: unknown",
    task.version ? `version: ${task.version}` : "",
    task.created_at ? `created_at: ${task.created_at}` : "",
    "",
    "Problem statement:",
    problem,
    hints ? ["", "Hints:", hints].join("\n") : "",
  ].filter((line) => line !== "").join("\n");
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function makeReport({
  baseUrl: reportBaseUrl,
  datasetName: reportDatasetName,
  datasetPath: reportDatasetPath,
  dryRun: reportDryRun,
  model: reportModel,
  outputPath: reportOutputPath,
  predictionsPath: reportPredictionsPath,
  results: reportResults,
  runId: reportRunId,
  selectedTaskIds: reportSelectedTaskIds,
  split: reportSplit,
  startedAt: reportStartedAt,
}) {
  const latencies = reportResults.map((result) => result.elapsed_ms).sort((a, b) => a - b);
  const usage = sumUsage(reportResults.map((result) => result.generation?.usage).filter(Boolean));
  const transportErrors = reportResults.filter((result) => !result.ok && result.generation?.status !== 200).length;
  const secretRejected = reportResults.filter((result) => result.generation?.secret_findings?.length).length;
  const command = officialEvaluationCommand({
    datasetName: reportDatasetName,
    instanceIds: reportSelectedTaskIds,
    predictionsPath: reportPredictionsPath,
    runId: reportRunId,
    split: reportSplit,
  });
  const wrapperCommand = `npm run bench:swe:score -- --prediction-report ${shellQuote(reportOutputPath)} --dry-run`;

  return {
    kind: "swebench_prediction_report",
    dry_run: reportDryRun,
    model: reportModel,
    base_url: reportBaseUrl,
    dataset: {
      name: reportDatasetName,
      split: reportSplit,
      jsonl_path: reportDatasetPath,
      selected_instance_ids: reportSelectedTaskIds,
    },
    artifacts: {
      report_path: reportOutputPath,
      predictions_path: reportPredictionsPath,
    },
    official_evaluation: {
      status: "not_run_by_this_script",
      reason: "SWE-bench scoring requires the official Docker harness; this script only generates bounded predictions.",
      command,
      wrapper_command: wrapperCommand,
    },
    started_at: reportStartedAt,
    finished_at: new Date().toISOString(),
    summary: {
      total: reportResults.length,
      predictions_written: reportResults.length,
      generated_patches: reportResults.filter((result) => !result.empty_patch).length,
      diff_like_patches: reportResults.filter((result) => result.diff_like).length,
      empty_patches: reportResults.filter((result) => result.empty_patch).length,
      transport_errors: transportErrors,
      secret_rejected: secretRejected,
      latency_ms_avg: average(latencies),
      latency_ms_p95: percentile(latencies, 0.95),
      usage,
    },
    results: reportResults.map((result) => ({
      instance_id: result.instance_id,
      ok: result.ok,
      mode: result.mode,
      elapsed_ms: result.elapsed_ms,
      model_patch_sha256: result.model_patch_sha256,
      model_patch_chars: result.model_patch_chars,
      empty_patch: result.empty_patch,
      diff_like: result.diff_like,
      prompt_chars: result.prompt_chars,
      metadata: result.metadata,
      generation: result.generation,
    })),
  };
}

function officialEvaluationCommand({ datasetName: commandDatasetName, instanceIds, predictionsPath: commandPredictionsPath, runId: commandRunId, split: commandSplit }) {
  const parts = [
    "python -m swebench.harness.run_evaluation",
    `--dataset_name ${shellQuote(commandDatasetName)}`,
    `--split ${shellQuote(commandSplit)}`,
    `--predictions_path ${shellQuote(commandPredictionsPath)}`,
    "--max_workers 1",
    "--cache_level env",
    "--clean True",
    `--run_id ${shellQuote(commandRunId)}`,
  ];
  if (instanceIds.length) parts.push(`--instance_ids ${instanceIds.map(shellQuote).join(" ")}`);
  return parts.join(" ");
}

function taskMetadata(task) {
  return {
    repo: task.repo,
    base_commit: task.base_commit,
    created_at: task.created_at,
    version: task.version,
    gold_patch_present: task.gold_patch_present,
    test_patch_present: task.test_patch_present,
    fail_to_pass_count: task.fail_to_pass_count,
    pass_to_pass_count: task.pass_to_pass_count,
  };
}

function looksLikeDiff(value) {
  const text = String(value || "");
  return /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text));
}

function outputText(response) {
  return (response?.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function responseUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function zeroUsage() {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

function sumUsage(values) {
  return values.reduce((sum, value) => ({
    input_tokens: sum.input_tokens + (value?.input_tokens || 0),
    output_tokens: sum.output_tokens + (value?.output_tokens || 0),
    total_tokens: sum.total_tokens + (value?.total_tokens || 0),
  }), zeroUsage());
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonish(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function truncate(value, max = 1200) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function truncateMiddle(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  const head = Math.max(0, Math.floor(max * 0.65));
  const tail = Math.max(0, max - head);
  return `${text.slice(0, head)}\n...[truncated ${text.length - max} chars]...\n${text.slice(text.length - tail)}`;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function findSecretLike(value) {
  const text = String(value || "");
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\bghp_[A-Za-z0-9_]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[A-Za-z0-9_./+=-]{32,}\b/g,
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({
    index: match.index,
    preview: `${match[0].slice(0, 8)}...`,
  })));
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
