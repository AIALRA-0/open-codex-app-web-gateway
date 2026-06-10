#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const suite = String(args.get("suite") || "micro");
const caseFilter = args.get("case");
const baseUrl = trimTrailingSlash(args.get("base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912");
const model = String(args.get("model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro");
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 180000);
const maxOutputTokens = parsePositiveInt(args.get("max-output-tokens"), 4096);
const outputRoot = path.resolve(String(args.get("output-dir") || process.env.CODEXCOMPAT_CODE_BENCH_OUTPUT_DIR || "output/code-benchmark"));
const outputPath = args.get("output");
const keepWorkdirs = !!args.get("keep-workdirs");
const verbose = !!args.get("verbose");

const suites = { micro: buildMicroSuite() };
const selected = caseFilter
  ? suites[suite]?.filter((task) => task.id === caseFilter)
  : suites[suite];
if (!selected) {
  console.error(`Unknown suite: ${suite}`);
  console.error(`Available suites: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}
if (!selected.length) {
  console.error(`No cases selected for suite=${suite} case=${caseFilter}`);
  process.exit(2);
}

fs.mkdirSync(outputRoot, { recursive: true });
const runDir = fs.mkdtempSync(path.join(outputRoot, `${suite}-${Date.now()}-`));
const startedAt = new Date().toISOString();
const results = [];

for (const task of selected) {
  if (verbose) console.error(`running ${task.id}`);
  results.push(await runTask(task));
}

const report = makeReport({
  suite,
  model,
  baseUrl,
  runDir,
  startedAt,
  results,
});
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
}
fs.writeFileSync(path.join(runDir, "report.json"), serialized, { mode: 0o600 });
console.log(serialized);
process.exit(report.summary.passed === report.summary.total ? 0 : 1);

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(key, true);
    } else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildMicroSuite() {
  return [
    {
      id: "slugify-url-safe",
      issue: [
        "Fix slugify(value) so it creates URL-safe slugs.",
        "Requirements:",
        "- convert input to string, trim whitespace, and lowercase",
        "- remove diacritics such as Creme -> creme",
        "- replace every run of non ASCII letters or digits with a single hyphen",
        "- trim leading and trailing hyphens",
        "- return an empty string for empty or punctuation-only input",
      ].join("\n"),
      files: {
        "slugify.js": `function slugify(value) {
  return String(value).trim().toLowerCase().replace(/\\s+/g, "-");
}

module.exports = { slugify };
`,
        "test.js": `const assert = require("node:assert/strict");
const { slugify } = require("./slugify");

assert.equal(slugify(" Hello, World! "), "hello-world");
assert.equal(slugify("A&B testing++"), "a-b-testing");
assert.equal(slugify("already---slug"), "already-slug");
assert.equal(slugify("Crème brûlée"), "creme-brulee");
assert.equal(slugify("!!!"), "");
console.log("slugify tests passed");
`,
      },
      testCommand: ["node", "test.js"],
      editableFiles: ["slugify.js"],
    },
    {
      id: "merge-ranges",
      issue: [
        "Fix mergeRanges(ranges).",
        "It receives an array of [start, end] integer ranges in any order.",
        "Return a new array sorted by start where overlapping or touching ranges are merged.",
        "Do not mutate the caller's input array.",
      ].join("\n"),
      files: {
        "ranges.js": `function mergeRanges(ranges) {
  return ranges;
}

module.exports = { mergeRanges };
`,
        "test.js": `const assert = require("node:assert/strict");
const { mergeRanges } = require("./ranges");

const input = [[5, 7], [1, 3], [2, 6], [10, 10]];
assert.deepEqual(mergeRanges(input), [[1, 7], [10, 10]]);
assert.deepEqual(input, [[5, 7], [1, 3], [2, 6], [10, 10]]);
assert.deepEqual(mergeRanges([[1, 2], [3, 4], [8, 9]]), [[1, 4], [8, 9]]);
assert.deepEqual(mergeRanges([]), []);
assert.deepEqual(mergeRanges([[4, 4]]), [[4, 4]]);
console.log("range tests passed");
`,
      },
      testCommand: ["node", "test.js"],
      editableFiles: ["ranges.js"],
    },
    {
      id: "parse-duration",
      issue: [
        "Fix parseDuration(input).",
        "It should parse compact duration strings containing days, hours, minutes, and seconds.",
        "Accepted units are d, h, m, and s. Whitespace is optional.",
        "Return total seconds as an integer. Reject unknown text by returning NaN.",
      ].join("\n"),
      files: {
        "duration.js": `function parseDuration(input) {
  const match = String(input).match(/(\\d+)s/);
  return match ? Number(match[1]) : 0;
}

module.exports = { parseDuration };
`,
        "test.js": `const assert = require("node:assert/strict");
const { parseDuration } = require("./duration");

assert.equal(parseDuration("45s"), 45);
assert.equal(parseDuration("2m"), 120);
assert.equal(parseDuration("1h 2m 3s"), 3723);
assert.equal(parseDuration("1d2h"), 93600);
assert.ok(Number.isNaN(parseDuration("tomorrow")));
console.log("duration tests passed");
`,
      },
      testCommand: ["node", "test.js"],
      editableFiles: ["duration.js"],
    },
  ];
}

async function runTask(task) {
  const started = performance.now();
  const workdir = path.join(runDir, task.id);
  fs.mkdirSync(workdir, { recursive: true });
  writeTaskFiles(workdir, task.files);
  const before = runCommand(["node", "test.js"], workdir);
  const generation = await generatePatch(task);
  const patchResult = applyGeneratedFiles(workdir, task, generation.files || {});
  const after = patchResult.ok ? runCommand(task.testCommand, workdir) : null;
  if (!keepWorkdirs) {
    fs.rmSync(workdir, { recursive: true, force: true });
  }

  return {
    id: task.id,
    ok: !!(generation.ok && patchResult.ok && after?.status === 0),
    elapsed_ms: Math.round(performance.now() - started),
    workdir: keepWorkdirs ? workdir : null,
    generation,
    patch: patchResult,
    tests: {
      before_status: before.status,
      after_status: after?.status ?? null,
      after_stdout: truncate(after?.stdout || ""),
      after_stderr: truncate(after?.stderr || ""),
    },
  };
}

function writeTaskFiles(workdir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workdir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

async function generatePatch(task) {
  const request = {
    model,
    input: makePrompt(task),
    max_output_tokens: maxOutputTokens,
    temperature: 0,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "code_benchmark_patch",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["files"],
          properties: {
            files: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
        },
      },
    },
  };

  const started = performance.now();
  const response = await postJson(`${baseUrl}/v1/responses`, request);
  const body = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      elapsed_ms: elapsedMs,
      error: truncate(body),
      files: {},
    };
  }

  const json = parseJsonOrNull(body);
  const text = outputText(json);
  const parsed = parseJsonish(text);
  return {
    ok: !!parsed?.files && typeof parsed.files === "object",
    status: response.status,
    elapsed_ms: elapsedMs,
    usage: responseUsage(json),
    output_text: truncate(text),
    files: parsed?.files && typeof parsed.files === "object" ? parsed.files : {},
    parse_error: parsed?.files ? null : "model output did not contain files object",
  };
}

function makePrompt(task) {
  const fileBlocks = Object.entries(task.files)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join("\n\n");
  return [
    "You are fixing a small JavaScript repository.",
    "Return only JSON that matches the requested schema.",
    "The JSON must contain a files object mapping each edited file path to the complete replacement file content.",
    `Only edit these files: ${task.editableFiles.join(", ")}.`,
    "Do not include Markdown fences, explanations, or tests unless an editable file is a test file.",
    "",
    "Issue:",
    task.issue,
    "",
    "Repository files:",
    fileBlocks,
  ].join("\n");
}

function applyGeneratedFiles(workdir, task, files) {
  const changed = [];
  const rejected = [];
  for (const [relativePath, content] of Object.entries(files)) {
    if (!task.editableFiles.includes(relativePath)) {
      rejected.push(relativePath);
      continue;
    }
    if (typeof content !== "string") {
      rejected.push(relativePath);
      continue;
    }
    const filePath = path.join(workdir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    changed.push(relativePath);
  }
  return {
    ok: changed.length > 0 && rejected.length === 0,
    changed,
    rejected,
  };
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

function runCommand(command, cwd) {
  const completed = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    status: completed.status,
    stdout: completed.stdout || "",
    stderr: completed.stderr || "",
    error: completed.error?.message || null,
  };
}

function makeReport({ suite, model, baseUrl, runDir, startedAt, results }) {
  const passed = results.filter((result) => result.ok).length;
  const latencies = results.map((result) => result.elapsed_ms).sort((a, b) => a - b);
  const usage = sumUsage(results.map((result) => result.generation?.usage).filter(Boolean));
  return {
    suite,
    model,
    base_url: baseUrl,
    run_dir: runDir,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: {
      passed,
      total: results.length,
      pass_rate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
      latency_ms_avg: average(latencies),
      latency_ms_p95: percentile(latencies, 0.95),
      usage,
    },
    results,
  };
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

function sumUsage(values) {
  return values.reduce((sum, value) => ({
    input_tokens: sum.input_tokens + (value?.input_tokens || 0),
    output_tokens: sum.output_tokens + (value?.output_tokens || 0),
    total_tokens: sum.total_tokens + (value?.total_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
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

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}

function truncate(value, max = 1200) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
