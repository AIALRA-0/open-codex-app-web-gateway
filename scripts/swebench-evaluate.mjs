#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const predictionReportPath = args.get("prediction-report");
const predictionReport = predictionReportPath ? readJson(path.resolve(String(predictionReportPath))) : null;
const outputDir = path.resolve(String(
  args.get("output-dir") ||
  process.env.CODEXCOMPAT_SWEBENCH_OUTPUT_DIR ||
  "/srv/aialra/data/opencodexapp/eval/swebench",
));
const outputPath = path.resolve(String(args.get("output") || path.join(outputDir, `score-report-${stamp}.json`)));
const summaryMdPath = path.resolve(String(args.get("summary-md") || path.join(outputDir, `score-summary-${stamp}.md`)));
const reportDir = path.resolve(String(args.get("report-dir") || path.join(outputDir, "harness")));
const predictionsPath = path.resolve(String(
  args.get("predictions") ||
  predictionReport?.artifacts?.predictions_path ||
  "",
));
const datasetJsonl = args.get("dataset-jsonl") || predictionReport?.dataset?.jsonl_path || "";
const datasetName = String(args.get("dataset-name") || datasetJsonl || predictionReport?.dataset?.name || "SWE-bench/SWE-bench_Verified");
const datasetLabel = String(args.get("dataset-label") || predictionReport?.dataset?.name || datasetName);
const split = String(args.get("split") || predictionReport?.dataset?.split || "test");
const runId = String(args.get("run-id") || `opencodexapp-score-${stamp}`);
const python = String(args.get("python") || process.env.PYTHON || "python3");
const maxWorkers = parsePositiveInt(args.get("max-workers"), 1);
const timeoutSeconds = parsePositiveInt(args.get("timeout-seconds"), 1800);
const commandTimeoutMs = parsePositiveInt(args.get("command-timeout-ms"), (timeoutSeconds + 300) * 1000);
const maxInstances = parsePositiveInt(args.get("max-instances"), 5);
const minFreeGb = parseNonNegativeNumber(args.get("min-free-gb"), 120);
const cacheLevel = String(args.get("cache-level") || "env");
const clean = !args.has("no-clean");
const dryRun = args.has("dry-run");
const allowLargeRun = args.has("allow-large-run");
const skipDiskCheck = args.has("skip-disk-check");
const skipEnvCheck = args.has("skip-env-check");
const instanceIds = parseInstanceIds(args.values("instance-id"), predictionReport?.dataset?.selected_instance_ids || []);

if (!predictionsPath) usage("Missing --predictions <path> or --prediction-report <path> with artifacts.predictions_path.");
if (!fs.existsSync(predictionsPath)) usage(`Predictions file does not exist: ${predictionsPath}`);
if (datasetJsonl && !fs.existsSync(path.resolve(String(datasetJsonl)))) {
  usage(`Local dataset JSONL does not exist: ${datasetJsonl}`);
}

fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(summaryMdPath), { recursive: true, mode: 0o700 });
fs.mkdirSync(reportDir, { recursive: true, mode: 0o700 });

const startedAt = new Date().toISOString();
const predictions = readPredictions(predictionsPath);
const secretFindings = predictions.flatMap((prediction) => findSecretLike(prediction.model_patch || "").map((finding) => ({
  instance_id: prediction.instance_id,
  ...finding,
})));
const selectedInstanceIds = instanceIds.length ? instanceIds : predictions.map((prediction) => prediction.instance_id).filter(Boolean);
const preflight = buildPreflight({ predictions, secretFindings, selectedInstanceIds });
const command = buildHarnessCommand({
  cacheLevel,
  clean,
  datasetName,
  instanceIds: selectedInstanceIds,
  maxWorkers,
  predictionsPath,
  python,
  reportDir,
  runId,
  split,
  timeoutSeconds,
});

let harness = {
  status: dryRun ? "dry_run" : "not_started",
  command: command.shell,
  exit_code: null,
  stdout_preview: "",
  stderr_preview: "",
  error: null,
};

if (!dryRun) {
  const fatal = preflight.problems.filter((problem) => problem.level === "error");
  if (fatal.length) {
    harness.status = "preflight_failed";
    harness.error = fatal.map((problem) => problem.message).join("; ");
  } else {
    const completed = spawnSync(command.argv[0], command.argv.slice(1), {
      cwd: reportDir,
      encoding: "utf8",
      timeout: commandTimeoutMs,
      maxBuffer: 25 * 1024 * 1024,
    });
    harness = {
      status: completed.status === 0 ? "completed" : "failed",
      command: command.shell,
      exit_code: completed.status,
      stdout_preview: truncate(completed.stdout || "", 8000),
      stderr_preview: truncate(completed.stderr || "", 8000),
      error: completed.error?.message || null,
      signal: completed.signal || null,
    };
  }
}

const parsedResults = parseHarnessArtifacts(reportDir, runId);
const scoreSummary = summarizeScores(parsedResults);
const report = {
  kind: "swebench_score_report",
  dry_run: dryRun,
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  dataset: {
    label: datasetLabel,
    name_or_path: datasetName,
    split,
    local_jsonl_path: datasetJsonl ? path.resolve(String(datasetJsonl)) : null,
  },
  artifacts: {
    prediction_report_path: predictionReportPath ? path.resolve(String(predictionReportPath)) : null,
    predictions_path: predictionsPath,
    harness_report_dir: reportDir,
    output_path: outputPath,
    summary_md_path: summaryMdPath,
  },
  harness,
  preflight,
  predictions: summarizePredictions(predictions),
  scoring: scoreSummary,
  parsed_artifacts: parsedResults.artifacts,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
fs.writeFileSync(summaryMdPath, renderMarkdown(report), { mode: 0o600 });
console.log(serialized);

const ok = dryRun || (harness.status === "completed" && preflight.problems.every((problem) => problem.level !== "error"));
process.exit(ok ? 0 : 1);

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
    "  node scripts/swebench-evaluate.mjs --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json --dry-run",
    "  node scripts/swebench-evaluate.mjs --predictions /srv/aialra/data/opencodexapp/eval/swebench/predictions.jsonl --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl",
    "",
    "This wrapper invokes the official SWE-bench Docker harness only when --dry-run is omitted.",
  ].join("\n"));
  process.exit(2);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseInstanceIds(values, defaults) {
  const parsed = values
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length ? [...new Set(parsed)] : [...new Set(defaults.filter(Boolean))];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readPredictions(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((record) => ({
      instance_id: String(record.instance_id || ""),
      model_name_or_path: String(record.model_name_or_path || ""),
      model_patch: typeof record.model_patch === "string" ? record.model_patch : "",
    }));
}

function buildPreflight({ predictions: predictionRows, secretFindings, selectedInstanceIds }) {
  const problems = [];
  const predictionIds = new Set(predictionRows.map((prediction) => prediction.instance_id).filter(Boolean));
  const missingIds = selectedInstanceIds.filter((instanceId) => !predictionIds.has(instanceId));
  if (!predictionRows.length) problems.push({ level: "error", message: "Predictions file is empty." });
  if (missingIds.length) problems.push({ level: "error", message: `Selected instance IDs missing from predictions: ${missingIds.join(", ")}` });
  if (secretFindings.length) problems.push({ level: "error", message: `Prediction patches contain ${secretFindings.length} secret-like value(s); refusing to invoke harness.` });
  if (!allowLargeRun && selectedInstanceIds.length > maxInstances) {
    problems.push({ level: "error", message: `Selected ${selectedInstanceIds.length} instances, above --max-instances ${maxInstances}. Use --allow-large-run only after confirming disk budget.` });
  }

  const environment = {
    python: checkCommand([python, "--version"]),
    swebench_import: checkCommand([python, "-c", "import swebench; print('swebench-ok')"]),
    docker: checkCommand(["docker", "--version"]),
    disk: checkDisk(reportDir),
  };

  if (!skipEnvCheck && !environment.python.ok) problems.push({ level: "error", message: `Python command failed: ${environment.python.error || environment.python.stderr_preview}` });
  if (!skipEnvCheck && !environment.swebench_import.ok) problems.push({ level: "error", message: "Python cannot import swebench. Install the official SWE-bench harness before live scoring." });
  if (!skipEnvCheck && !environment.docker.ok) problems.push({ level: "error", message: "Docker command is unavailable; SWE-bench scoring requires Docker." });
  if (!skipDiskCheck && environment.disk.free_gb != null && environment.disk.free_gb < minFreeGb) {
    problems.push({ level: "error", message: `Free disk ${environment.disk.free_gb}GB is below --min-free-gb ${minFreeGb}GB.` });
  }
  if (!skipDiskCheck && environment.disk.free_gb == null) {
    problems.push({ level: "warning", message: "Unable to determine free disk for harness report directory." });
  }

  return {
    ok: problems.every((problem) => problem.level !== "error"),
    max_instances: maxInstances,
    min_free_gb: minFreeGb,
    allow_large_run: allowLargeRun,
    skip_env_check: skipEnvCheck,
    skip_disk_check: skipDiskCheck,
    selected_instance_count: selectedInstanceIds.length,
    problems,
    environment,
  };
}

function checkCommand(command) {
  const completed = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: completed.status === 0,
    command: command.join(" "),
    exit_code: completed.status,
    stdout_preview: truncate(completed.stdout || "", 500),
    stderr_preview: truncate(completed.stderr || "", 500),
    error: completed.error?.message || null,
  };
}

function checkDisk(targetDir) {
  const completed = spawnSync("df", ["-Pk", targetDir], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  if (completed.status !== 0) {
    return {
      ok: false,
      free_gb: null,
      stderr_preview: truncate(completed.stderr || "", 500),
      error: completed.error?.message || null,
    };
  }
  const lines = (completed.stdout || "").trim().split(/\r?\n/);
  const fields = lines[1]?.trim().split(/\s+/);
  const availableKb = Number(fields?.[3]);
  const freeGb = Number.isFinite(availableKb) ? Number((availableKb / 1024 / 1024).toFixed(2)) : null;
  return {
    ok: freeGb != null,
    free_gb: freeGb,
    stdout_preview: truncate(completed.stdout || "", 500),
  };
}

function buildHarnessCommand({ cacheLevel: commandCacheLevel, clean: commandClean, datasetName: commandDatasetName, instanceIds, maxWorkers: commandMaxWorkers, predictionsPath: commandPredictionsPath, python: commandPython, reportDir: commandReportDir, runId: commandRunId, split: commandSplit, timeoutSeconds: commandTimeoutSeconds }) {
  const argv = [
    commandPython,
    "-m", "swebench.harness.run_evaluation",
    "--dataset_name", commandDatasetName,
    "--split", commandSplit,
    "--predictions_path", commandPredictionsPath,
    "--max_workers", String(commandMaxWorkers),
    "--run_id", commandRunId,
    "--cache_level", commandCacheLevel,
    "--clean", String(commandClean ? "True" : "False"),
    "--timeout", String(commandTimeoutSeconds),
    "--report_dir", commandReportDir,
  ];
  if (instanceIds.length) argv.push("--instance_ids", ...instanceIds);
  return {
    argv,
    shell: argv.map(shellQuote).join(" "),
  };
}

function parseHarnessArtifacts(rootDir, commandRunId) {
  const files = findFiles(rootDir, 5);
  const artifacts = {
    results_json: null,
    instance_results_jsonl: null,
    run_logs_count: 0,
  };
  const preferred = (filePath) => filePath.includes(commandRunId);
  const resultFiles = files.filter((filePath) => path.basename(filePath) === "results.json");
  const instanceFiles = files.filter((filePath) => path.basename(filePath) === "instance_results.jsonl");
  artifacts.results_json = (resultFiles.find(preferred) || resultFiles[0] || null);
  artifacts.instance_results_jsonl = (instanceFiles.find(preferred) || instanceFiles[0] || null);
  artifacts.run_logs_count = files.filter((filePath) => filePath.includes("run_logs")).length;

  return {
    artifacts,
    results_json: artifacts.results_json ? readJsonSafe(artifacts.results_json) : null,
    instance_results: artifacts.instance_results_jsonl ? readJsonlSafe(artifacts.instance_results_jsonl) : [],
  };
}

function findFiles(rootDir, maxDepth, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(filePath, maxDepth, depth + 1));
    if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { parse_error: error?.message || String(error) };
  }
}

function readJsonlSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function summarizeScores(parsed) {
  const rows = parsed.instance_results || [];
  const resultsJson = parsed.results_json || {};
  const resolvedRows = rows.filter((row) => row.resolved === true);
  const unresolvedRows = rows.filter((row) => row.resolved === false);
  const erroredRows = rows.filter((row) => row.error || row.exception || row.resolved == null);
  const submitted = numberFrom(resultsJson.instances_submitted, resultsJson.submitted, rows.length);
  const resolved = numberFrom(resultsJson.instances_resolved, resultsJson.resolved, resolvedRows.length);
  const completed = numberFrom(resultsJson.instances_completed, resultsJson.completed, rows.length ? rows.length - erroredRows.length : null);
  const total = numberFrom(resultsJson.total_instances, resultsJson.total, rows.length);
  return {
    total_instances: total,
    instances_submitted: submitted,
    instances_completed: completed,
    instances_resolved: resolved,
    instances_unresolved: numberFrom(resultsJson.instances_unresolved, resultsJson.unresolved, unresolvedRows.length),
    instances_with_errors: numberFrom(resultsJson.instances_with_errors, resultsJson.errors, erroredRows.length),
    resolution_rate: submitted ? Number((resolved / submitted).toFixed(4)) : numberFrom(resultsJson.resolution_rate, 0),
    source: parsed.artifacts.results_json || parsed.artifacts.instance_results_jsonl ? "harness_artifacts" : "not_available",
  };
}

function numberFrom(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function summarizePredictions(predictionRows) {
  const patches = predictionRows.map((prediction) => prediction.model_patch || "");
  return {
    total: predictionRows.length,
    empty_patches: patches.filter((patch) => !patch.trim()).length,
    diff_like_patches: patches.filter(looksLikeDiff).length,
    model_names: [...new Set(predictionRows.map((prediction) => prediction.model_name_or_path).filter(Boolean))],
    patch_sha256: predictionRows.map((prediction) => ({
      instance_id: prediction.instance_id,
      sha256: sha256(prediction.model_patch || ""),
      chars: (prediction.model_patch || "").length,
    })),
  };
}

function renderMarkdown(report) {
  const lines = [
    "# SWE-bench Score Summary",
    "",
    `- Status: ${report.harness.status}`,
    `- Dry run: ${report.dry_run}`,
    `- Dataset: ${report.dataset.label}`,
    `- Dataset path/name: ${report.dataset.name_or_path}`,
    `- Split: ${report.dataset.split}`,
    `- Predictions: ${report.artifacts.predictions_path}`,
    `- Harness report dir: ${report.artifacts.harness_report_dir}`,
    `- Command: \`${report.harness.command}\``,
    "",
    "## Preflight",
    "",
    `- OK: ${report.preflight.ok}`,
    `- Selected instances: ${report.preflight.selected_instance_count}`,
    `- Free disk GB: ${report.preflight.environment.disk.free_gb ?? "unknown"}`,
    `- Python: ${report.preflight.environment.python.ok}`,
    `- SWE-bench import: ${report.preflight.environment.swebench_import.ok}`,
    `- Docker: ${report.preflight.environment.docker.ok}`,
    "",
    "## Predictions",
    "",
    `- Total: ${report.predictions.total}`,
    `- Empty patches: ${report.predictions.empty_patches}`,
    `- Diff-like patches: ${report.predictions.diff_like_patches}`,
    `- Models: ${report.predictions.model_names.join(", ") || "unknown"}`,
    "",
    "## Scoring",
    "",
    `- Source: ${report.scoring.source}`,
    `- Submitted: ${report.scoring.instances_submitted}`,
    `- Completed: ${report.scoring.instances_completed}`,
    `- Resolved: ${report.scoring.instances_resolved}`,
    `- Resolution rate: ${report.scoring.resolution_rate}`,
  ];
  if (report.preflight.problems.length) {
    lines.push("", "## Problems", "");
    for (const problem of report.preflight.problems) {
      lines.push(`- ${problem.level}: ${problem.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function looksLikeDiff(value) {
  const text = String(value || "");
  return /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text));
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function truncate(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
