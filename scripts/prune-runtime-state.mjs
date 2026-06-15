#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.get("root") || process.cwd()));
const apply = !!args.get("apply");
const maxAgeHoursOverride = parsePositiveNumber(args.get("max-age-hours"), null);
const maxFilesOverride = parsePositiveInt(args.get("max-files"), null);
const maxBytesOverride = parseByteSize(args.get("max-bytes"), null);
const nowMs = Date.now();

const targets = runtimeTargets({ root, maxAgeHoursOverride, maxFilesOverride, maxBytesOverride });
const reports = targets.map((target) => pruneTarget(target, { apply, nowMs }));
const summary = summarize(reports);
const report = {
  ok: true,
  dry_run: !apply,
  root,
  started_at: new Date(nowMs).toISOString(),
  finished_at: new Date().toISOString(),
  summary,
  targets: reports,
};

console.log(`${JSON.stringify(report, null, 2)}\n`);

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
  if (value == null || value === true || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parsePositiveNumber(value, fallback) {
  if (value == null || value === true || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseByteSize(value, fallback) {
  if (value == null || value === true || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  const unit = String(match[2] || "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Math.trunc(amount * multiplier);
}

function runtimeTargets({ root, maxAgeHoursOverride, maxFilesOverride, maxBytesOverride }) {
  const stateDir = path.join(root, "state", "responses-bridge");
  const outputDir = path.join(root, "output");
  const common = (target) => ({
    ...target,
    maxAgeHours: maxAgeHoursOverride ?? target.maxAgeHours,
    maxFiles: maxFilesOverride ?? target.maxFiles,
    maxBytes: maxBytesOverride ?? target.maxBytes,
  });
  return [
    common({
      id: "ui-smoke-screenshots",
      path: path.join(outputDir, "playwright"),
      mode: "children",
      include: (entry) => entry.isFile(),
      maxAgeHours: 168,
      maxFiles: 50,
      maxBytes: 256 * 1024 * 1024,
    }),
    common({
      id: "playwright-cli-artifacts",
      path: path.join(root, ".playwright-cli"),
      mode: "children",
      include: (entry) => entry.isFile(),
      maxAgeHours: 72,
      maxFiles: 50,
      maxBytes: 256 * 1024 * 1024,
    }),
    common({
      id: "code-benchmark-workdirs",
      path: path.join(outputDir, "code-benchmark"),
      mode: "children",
      include: (entry) => entry.isDirectory(),
      maxAgeHours: 168,
      maxFiles: 20,
      maxBytes: 512 * 1024 * 1024,
    }),
    common({
      id: "response-records",
      path: stateDir,
      mode: "children",
      include: (entry) => entry.isFile() && entry.name.endsWith(".json"),
      maxAgeHours: 336,
      maxFiles: 5000,
      maxBytes: 512 * 1024 * 1024,
    }),
    common({
      id: "local-container-workdirs",
      path: path.join(stateDir, "local-containers"),
      mode: "children",
      include: (entry) => entry.isDirectory(),
      maxAgeHours: 168,
      maxFiles: 200,
      maxBytes: 1024 * 1024 * 1024,
    }),
    common({
      id: "local-chatkit-sessions",
      path: path.join(stateDir, "local-chatkit", "sessions"),
      mode: "children",
      include: (entry) => entry.isFile() && entry.name.endsWith(".json"),
      maxAgeHours: 336,
      maxFiles: 5000,
      maxBytes: 64 * 1024 * 1024,
    }),
    common({
      id: "local-chatkit-threads",
      path: path.join(stateDir, "local-chatkit", "threads"),
      mode: "children",
      include: (entry) => entry.isDirectory(),
      maxAgeHours: 336,
      maxFiles: 5000,
      maxBytes: 256 * 1024 * 1024,
    }),
    common({
      id: "local-realtime-sessions",
      path: path.join(stateDir, "local-realtime", "sessions"),
      mode: "children",
      include: (entry) => entry.isFile() && entry.name.endsWith(".json"),
      maxAgeHours: 336,
      maxFiles: 5000,
      maxBytes: 64 * 1024 * 1024,
    }),
    common({
      id: "local-realtime-client-secrets",
      path: path.join(stateDir, "local-realtime", "client_secrets"),
      mode: "children",
      include: (entry) => entry.isFile() && entry.name.endsWith(".json"),
      maxAgeHours: 72,
      maxFiles: 5000,
      maxBytes: 64 * 1024 * 1024,
    }),
    common({
      id: "local-realtime-calls",
      path: path.join(stateDir, "local-realtime", "calls"),
      mode: "children",
      include: (entry) => entry.isFile() && entry.name.endsWith(".json"),
      maxAgeHours: 168,
      maxFiles: 5000,
      maxBytes: 64 * 1024 * 1024,
    }),
  ];
}

function pruneTarget(target, { apply, nowMs }) {
  const safePath = path.resolve(target.path);
  if (!isPathInside(root, safePath)) {
    return {
      id: target.id,
      path: safePath,
      ok: false,
      error: "target is outside root",
      scanned: 0,
      selected: 0,
      deleted: 0,
      bytes_selected: 0,
      bytes_deleted: 0,
      candidates: [],
    };
  }

  const candidates = listCandidates(target, safePath, nowMs)
    .sort((a, b) => b.mtime_ms - a.mtime_ms || a.path.localeCompare(b.path));
  const selected = selectPruneCandidates(candidates, target);
  const deleted = [];
  const errors = [];

  if (apply) {
    for (const item of selected) {
      try {
        fs.rmSync(item.path, { recursive: true, force: true });
        deleted.push(item);
      } catch (error) {
        errors.push({ path: item.path, error: error.message });
      }
    }
  }

  return {
    id: target.id,
    path: safePath,
    ok: errors.length === 0,
    max_age_hours: target.maxAgeHours,
    max_files: target.maxFiles,
    max_bytes: target.maxBytes,
    scanned: candidates.length,
    selected: selected.length,
    deleted: deleted.length,
    bytes_scanned: sumBytes(candidates),
    bytes_selected: sumBytes(selected),
    bytes_deleted: sumBytes(deleted),
    candidates: selected.map((item) => ({
      path: path.relative(root, item.path),
      type: item.type,
      bytes: item.bytes,
      age_hours: Number(item.age_hours.toFixed(3)),
      reasons: item.reasons,
    })),
    ...(errors.length ? { errors } : {}),
  };
}

function listCandidates(target, safePath, nowMs) {
  let entries = [];
  try {
    entries = fs.readdirSync(safePath, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!target.include(entry)) continue;
    const entryPath = path.join(safePath, entry.name);
    const resolved = path.resolve(entryPath);
    if (!isPathInside(safePath, resolved)) continue;
    let stat;
    try {
      stat = fs.lstatSync(resolved);
    } catch {
      continue;
    }
    const type = stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file";
    const bytes = stat.isDirectory() ? directoryBytes(resolved) : stat.size;
    candidates.push({
      path: resolved,
      type,
      bytes,
      mtime_ms: stat.mtimeMs,
      age_hours: Math.max(0, (nowMs - stat.mtimeMs) / (60 * 60 * 1000)),
      reasons: [],
    });
  }
  return candidates;
}

function selectPruneCandidates(candidates, target) {
  const selected = new Map();
  const byOldest = [...candidates].sort((a, b) => a.mtime_ms - b.mtime_ms || a.path.localeCompare(b.path));
  for (const item of byOldest) {
    if (target.maxAgeHours != null && item.age_hours > target.maxAgeHours) {
      markSelected(selected, item, "max_age");
    }
  }

  if (target.maxFiles != null && candidates.length > target.maxFiles) {
    for (const item of byOldest.slice(0, candidates.length - target.maxFiles)) {
      markSelected(selected, item, "max_files");
    }
  }

  if (target.maxBytes != null) {
    let remainingBytes = sumBytes(candidates) - sumBytes(Array.from(selected.values()));
    for (const item of byOldest) {
      if (remainingBytes <= target.maxBytes) break;
      if (!selected.has(item.path)) {
        markSelected(selected, item, "max_bytes");
        remainingBytes -= item.bytes;
      }
    }
  }

  return Array.from(selected.values()).sort((a, b) => a.mtime_ms - b.mtime_ms || a.path.localeCompare(b.path));
}

function markSelected(selected, item, reason) {
  const existing = selected.get(item.path);
  if (existing) {
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    return;
  }
  selected.set(item.path, {
    ...item,
    reasons: [reason],
  });
}

function directoryBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      let stat;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        continue;
      }
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        stack.push(entryPath);
      } else {
        total += stat.size;
      }
    }
  }
  return total;
}

function summarize(reports) {
  return {
    targets: reports.length,
    scanned: reports.reduce((sum, report) => sum + report.scanned, 0),
    selected: reports.reduce((sum, report) => sum + report.selected, 0),
    deleted: reports.reduce((sum, report) => sum + report.deleted, 0),
    bytes_selected: reports.reduce((sum, report) => sum + report.bytes_selected, 0),
    bytes_deleted: reports.reduce((sum, report) => sum + report.bytes_deleted, 0),
    errors: reports.reduce((sum, report) => sum + (report.errors?.length || 0), 0),
  };
}

function sumBytes(items) {
  return items.reduce((sum, item) => sum + (item.bytes || 0), 0);
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
