#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const codexHome = process.env.CODEXAPP_HOME || "/home/aialra/.codex";
const dbPath = process.env.CODEXAPP_STATE_DB || path.join(codexHome, "state_5.sqlite");
const hostStatePath = process.env.CODEXAPP_HOST_STATE || "/srv/aialra/apps/codexapp/state/host-state.json";
const srvRoot = process.env.CODEXAPP_SRV_PROJECT_ROOT || "/srv";
const currentProjectRoot = process.env.CODEXAPP_CURRENT_PROJECT_ROOT || "/srv/aialra/codexapp-current";
const opencodeProjectRoot = process.env.CODEXAPP_OPENCODE_PROJECT_ROOT || "/srv/aialra/apps/opencode-turn-engine";
const turnHarnessRoot = process.env.CODEXAPP_TURN_HARNESS_ROOT || "/srv/aialra/turn-harness-target";
const realBenchmarkRunRoot = process.env.CODEXAPP_REAL_BENCH_RUN_ROOT || path.join(turnHarnessRoot, "real-bench-runs");
const deepwikiProjectRoot = process.env.CODEXAPP_DEEPWIKI_PROJECT_ROOT || "/srv/aialra/apps/deeeeeepwiki";
const vscodeRoot = process.env.CODEXAPP_VSCODE_PROJECT_ROOT || "/srv/aialra/codex-vscode-history";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  } catch (error) {
    try { if (fd !== null) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w", 0o600);
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
    try {
      const dirFd = fs.openSync(path.dirname(file), "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
  } catch (error) {
    try { if (fd !== null) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function unique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))];
}

function runSql(sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

const canonicalProjectRoots = unique([
  currentProjectRoot,
  opencodeProjectRoot,
  deepwikiProjectRoot,
  vscodeRoot,
  srvRoot,
]).sort((a, b) => b.length - a.length);

const projectRootAliases = [
  { root: turnHarnessRoot, project: opencodeProjectRoot },
].sort((a, b) => b.root.length - a.root.length);

function isUnderRoot(cwd, root) {
  return typeof cwd === "string" && typeof root === "string" && root.length > 0
    && (cwd === root || cwd.startsWith(`${root}/`));
}

function isRealBenchmarkThread(row) {
  const text = `${row?.title || ""}\n${row?.preview || ""}\n${row?.first_user_message || ""}`;
  return isUnderRoot(row?.cwd, realBenchmarkRunRoot)
    || /You are fixing a real benchmark issue|Benchmark instance:/i.test(text);
}

function projectFor(cwd) {
  for (const alias of projectRootAliases) {
    if (isUnderRoot(cwd, alias.root)) return alias.project;
  }
  for (const root of canonicalProjectRoots) {
    if (isUnderRoot(cwd, root)) return root;
  }
  return vscodeRoot;
}

function rewriteRolloutCwd(rolloutPath, cwd) {
  if (typeof rolloutPath !== "string" || rolloutPath.length === 0 || !fs.existsSync(rolloutPath)) {
    return false;
  }

  const firstChunk = Buffer.alloc(64 * 1024);
  let firstLine = "";
  try {
    const fd = fs.openSync(rolloutPath, "r");
    try {
      const bytes = fs.readSync(fd, firstChunk, 0, firstChunk.length, 0);
      const newline = firstChunk.subarray(0, bytes).indexOf(10);
      firstLine = firstChunk.toString("utf8", 0, newline >= 0 ? newline : bytes);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }

  try {
    const event = JSON.parse(firstLine);
    if (
      event &&
      event.type === "session_meta" &&
      event.payload &&
      typeof event.payload.cwd === "string" &&
      event.payload.cwd === cwd
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const text = fs.readFileSync(rolloutPath, "utf8");
  let changed = false;
  let seenSessionMeta = false;
  const lines = text.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    if (!line || seenSessionMeta) return line;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return line;
    }

    if (
      event &&
      event.type === "session_meta" &&
      event.payload &&
      typeof event.payload.cwd === "string"
    ) {
      seenSessionMeta = true;
      if (event.payload.cwd !== cwd) {
        event.payload.cwd = cwd;
        changed = true;
        return JSON.stringify(event);
      }
    }

    return line;
  });

  if (!changed) return false;
  writeText(rolloutPath, rewritten.join("\n"));
  return true;
}

fs.mkdirSync(path.dirname(hostStatePath), { recursive: true });
fs.mkdirSync(currentProjectRoot, { recursive: true });
fs.mkdirSync(vscodeRoot, { recursive: true });

const originalCwdPath = path.join(path.dirname(hostStatePath), "imported-vscode-original-cwds.json");
const originalCwds = readJson(originalCwdPath, {});
const nonSrvRows = runSql(`
  SELECT id, cwd
  FROM threads
  WHERE archived = 0
    AND NOT (cwd = '${srvRoot.replaceAll("'", "''")}' OR cwd LIKE '${srvRoot.replaceAll("'", "''")}/%')
`);
let changedOriginalCwds = false;
for (const row of nonSrvRows) {
  if (!row || typeof row.id !== "string" || typeof row.cwd !== "string") continue;
  if (!originalCwds[row.id]) {
    originalCwds[row.id] = row.cwd;
    changedOriginalCwds = true;
  }
}
if (changedOriginalCwds) {
  writeJson(originalCwdPath, originalCwds);
}

execFileSync("sqlite3", [dbPath, `
  PRAGMA busy_timeout=10000;
  UPDATE threads
  SET cwd = '${sqlString(vscodeRoot)}'
  WHERE archived = 0
    AND NOT (cwd = '${sqlString(srvRoot)}' OR cwd LIKE '${sqlString(srvRoot)}/%');
`]);

const benchmarkRows = runSql(`
  SELECT id
  FROM threads
  WHERE archived = 0
    AND (
      cwd = '${sqlString(realBenchmarkRunRoot)}'
      OR cwd LIKE '${sqlString(realBenchmarkRunRoot)}/%'
      OR title LIKE 'You are fixing a real benchmark issue%'
      OR preview LIKE 'You are fixing a real benchmark issue%'
      OR first_user_message LIKE 'You are fixing a real benchmark issue%'
      OR title LIKE '%Benchmark instance:%'
      OR preview LIKE '%Benchmark instance:%'
      OR first_user_message LIKE '%Benchmark instance:%'
    )
`);
if (benchmarkRows.length > 0) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const idsSql = benchmarkRows.map((row) => `'${sqlString(row.id)}'`).join(",");
  execFileSync("sqlite3", [dbPath, `
    PRAGMA busy_timeout=10000;
    UPDATE threads
    SET archived = 1,
        archived_at = ${nowSeconds},
        updated_at = MAX(COALESCE(updated_at, 0), ${nowSeconds}),
        updated_at_ms = MAX(COALESCE(updated_at_ms, 0), ${nowMs})
    WHERE id IN (${idsSql});
  `]);
}

const rows = runSql(`
  SELECT
    id,
    cwd,
    title,
    preview,
    first_user_message,
    rollout_path,
    COALESCE(updated_at_ms, updated_at * 1000, created_at * 1000) AS updated_at_ms
  FROM threads
  WHERE archived = 0
  ORDER BY COALESCE(updated_at_ms, updated_at * 1000, created_at * 1000) DESC, id DESC
`);

const hostState = readJson(hostStatePath, {});
const assignments = { ...(hostState["thread-project-assignments"] || {}) };
const hints = { ...(hostState["thread-workspace-root-hints"] || {}) };
const orders = {};
const activeThreadIds = new Set();
let rewrittenRolloutCwds = 0;

for (const row of rows) {
  if (!row || typeof row.id !== "string") continue;
  if (isRealBenchmarkThread(row)) continue;
  const root = projectFor(row.cwd);
  if (typeof row.cwd === "string" && rewriteRolloutCwd(row.rollout_path, row.cwd)) {
    rewrittenRolloutCwds += 1;
  }
  activeThreadIds.add(row.id);
  assignments[row.id] = root;
  hints[row.id] = root;
  if (!orders[root]) orders[root] = [];
  orders[root].push(row.id);
}

for (const id of Object.keys(assignments)) {
  if (!activeThreadIds.has(id)) delete assignments[id];
}
for (const id of Object.keys(hints)) {
  if (!activeThreadIds.has(id)) delete hints[id];
}

const workspaceRoots = unique([...canonicalProjectRoots, ...(hostState["electron-saved-workspace-roots"] || [])]);
const labels = {
  ...(hostState["electron-workspace-root-labels"] || {}),
  [currentProjectRoot]: "CodexApp Current",
  [opencodeProjectRoot]: "OpenCode",
  [deepwikiProjectRoot]: "DeepWiki",
  [srvRoot]: "/srv",
  [vscodeRoot]: "vscode",
};

hostState["thread-project-assignments"] = assignments;
hostState["thread-workspace-root-hints"] = hints;
hostState["sidebar-project-thread-orders"] = {
  ...(hostState["sidebar-project-thread-orders"] || {}),
  ...orders,
};
hostState["projectless-thread-ids"] = unique(hostState["projectless-thread-ids"] || []).filter((id) => !activeThreadIds.has(id));
hostState["project-order"] = unique([...canonicalProjectRoots, ...(hostState["project-order"] || [])]);
hostState["electron-saved-workspace-roots"] = workspaceRoots;
hostState["active-workspace-roots"] = unique([currentProjectRoot, opencodeProjectRoot, srvRoot, vscodeRoot, ...(hostState["active-workspace-roots"] || [])]);
hostState["electron-workspace-root-labels"] = labels;

writeJson(hostStatePath, hostState);

const counts = Object.fromEntries(Object.entries(orders).map(([root, ids]) => [root, ids.length]));
console.log(JSON.stringify({ groupedThreads: rows.length, counts, rewrittenRolloutCwds, archivedBenchmarkThreads: benchmarkRows.length }, null, 2));
