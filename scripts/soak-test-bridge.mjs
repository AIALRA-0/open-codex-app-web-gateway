#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.get("base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912");
const model = String(args.get("model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro");
const iterations = parsePositiveInt(args.get("iterations"), 5);
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 180000);
const maxOutputTokens = parsePositiveInt(args.get("max-output-tokens"), 128);
const stateDir = path.resolve(String(
  args.get("state-dir")
  || process.env.CODEXCOMPAT_STATE_DIR
  || path.join(process.cwd(), "state", "responses-bridge"),
));
const cleanup = args.get("cleanup") !== "false";
const outputPath = args.get("output");
const markerPrefix = String(args.get("marker-prefix") || `soak-${Date.now().toString(36)}`);

const startedAt = new Date().toISOString();
const stateBefore = dirStats(stateDir);
const results = [];
const storedIds = [];

for (let index = 0; index < iterations; index += 1) {
  const marker = `${markerPrefix}-${index}`;
  const result = await runTurn({ marker, index });
  results.push(result);
  if (result.response_id) storedIds.push(result.response_id);
}

const stateAfterCreate = dirStats(stateDir);
const cleanupResults = cleanup ? await cleanupResponses(storedIds) : [];
const stateAfterCleanup = dirStats(stateDir);
const report = makeReport({
  model,
  baseUrl,
  iterations,
  stateDir,
  startedAt,
  results,
  cleanupResults,
  stateBefore,
  stateAfterCreate,
  stateAfterCleanup,
});

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
}
console.log(serialized);
process.exit(report.summary.successful_turns === report.summary.total_turns && report.summary.cleanup_failures === 0 ? 0 : 1);

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

async function runTurn({ marker, index }) {
  const started = performance.now();
  const request = {
    model,
    input: `Reply with exactly this marker and no extra text: ${marker}`,
    max_output_tokens: maxOutputTokens,
    store: true,
  };

  try {
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    const elapsedMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return {
        index,
        ok: false,
        marker,
        status: response.status,
        elapsed_ms: elapsedMs,
        error: truncate(body),
      };
    }

    const json = JSON.parse(body);
    const text = outputText(json);
    const inputItems = await getJson(`${baseUrl}/v1/responses/${json.id}/input_items?limit=1`);
    return {
      index,
      ok: text.includes(marker) && inputItems.ok,
      marker,
      status: response.status,
      response_id: json.id,
      elapsed_ms: elapsedMs,
      output_text: truncate(text, 300),
      usage: responseUsage(json),
      input_items_status: inputItems.status,
    };
  } catch (error) {
    return {
      index,
      ok: false,
      marker,
      elapsed_ms: Math.round(performance.now() - started),
      error: error.message,
    };
  }
}

async function cleanupResponses(ids) {
  const results = [];
  for (const id of ids) {
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}/v1/responses/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      results.push({
        id,
        ok: response.ok,
        status: response.status,
        elapsed_ms: Math.round(performance.now() - started),
        body: response.ok ? undefined : truncate(body),
      });
    } catch (error) {
      results.push({
        id,
        ok: false,
        elapsed_ms: Math.round(performance.now() - started),
        error: error.message,
      });
    }
  }
  return results;
}

async function postJson(url, body) {
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    json: parseJsonish(body),
  };
}

function dirStats(dir) {
  const stats = { dir, exists: false, files: 0, bytes: 0 };
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      stats.files += 1;
      stats.bytes += stat.size;
    }
    stats.exists = true;
  } catch {
    // Missing state directory is a valid pre-start condition.
  }
  return stats;
}

function makeReport({ model, baseUrl, iterations, stateDir, startedAt, results, cleanupResults, stateBefore, stateAfterCreate, stateAfterCleanup }) {
  const successful = results.filter((result) => result.ok).length;
  const cleanupFailures = cleanupResults.filter((result) => !result.ok).length;
  const latencies = results.map((result) => result.elapsed_ms).sort((a, b) => a - b);
  return {
    suite: "bridge-soak",
    model,
    base_url: baseUrl,
    iterations,
    state_dir: stateDir,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: {
      successful_turns: successful,
      total_turns: results.length,
      success_rate: results.length ? Number((successful / results.length).toFixed(4)) : 0,
      cleanup_failures: cleanupFailures,
      latency_ms_avg: average(latencies),
      latency_ms_p95: percentile(latencies, 0.95),
      usage: sumUsage(results.map((result) => result.usage).filter(Boolean)),
      state_files_delta_after_create: stateAfterCreate.files - stateBefore.files,
      state_bytes_delta_after_create: stateAfterCreate.bytes - stateBefore.bytes,
      state_files_delta_after_cleanup: stateAfterCleanup.files - stateBefore.files,
      state_bytes_delta_after_cleanup: stateAfterCleanup.bytes - stateBefore.bytes,
    },
    state: {
      before: stateBefore,
      after_create: stateAfterCreate,
      after_cleanup: stateAfterCleanup,
    },
    results,
    cleanup_results: cleanupResults,
  };
}

function outputText(response) {
  return (response.output || [])
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

function parseJsonish(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
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

function truncate(value, max = 1000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
