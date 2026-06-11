"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,180}$/.test(value)) return null;
  return value;
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function prefixedId(prefix) {
  return `${prefix}_${randomToken(16)}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

class LocalEvalStore {
  constructor(config = {}) {
    this.dir = path.resolve(config.evalStateDir || path.join(config.stateDir || process.cwd(), "local-evals"));
    this.maxRecords = config.evalMaxRecords || 5000;
  }

  createEval(body = {}) {
    const now = nowSeconds();
    const evalObject = {
      id: prefixedId("eval"),
      object: "eval",
      data_source_config: clone(body.data_source_config || { type: "custom" }),
      testing_criteria: normalizeTestingCriteria(body.testing_criteria || []),
      name: normalizeName(body.name, "Local Eval"),
      created_at: now,
      updated_at: now,
      metadata: isPlainObject(body.metadata) ? clone(body.metadata) : {},
    };
    this.writeJson(this.evalJsonPath(evalObject.id), { eval: evalObject });
    this.cleanup();
    return clone(evalObject);
  }

  listEvals() {
    return this.listEvalRecords()
      .map((record) => record.eval)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(clone);
  }

  getEval(evalId) {
    return cloneOrNull(this.readJson(this.evalJsonPath(evalId))?.eval || null);
  }

  updateEval(evalId, body = {}) {
    const record = this.readJson(this.evalJsonPath(evalId));
    const evalObject = record?.eval;
    if (!evalObject) return null;
    const updated = { ...evalObject, updated_at: nowSeconds() };
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      updated.name = normalizeName(body.name, updated.name || "Local Eval");
    }
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? clone(body.metadata) : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "data_source_config")) {
      updated.data_source_config = isPlainObject(body.data_source_config)
        ? clone(body.data_source_config)
        : { type: "custom" };
    }
    if (Object.prototype.hasOwnProperty.call(body, "testing_criteria")) {
      updated.testing_criteria = normalizeTestingCriteria(body.testing_criteria || []);
    }
    this.writeJson(this.evalJsonPath(evalId), { ...record, eval: updated });
    return clone(updated);
  }

  deleteEval(evalId) {
    const evalObject = this.getEval(evalId);
    if (!evalObject) return null;
    this.deletePath(this.evalDir(evalId));
    return {
      id: evalId,
      object: "eval.deleted",
      deleted: true,
    };
  }

  createRun(evalId, run, outputItems = []) {
    const evalObject = this.getEval(evalId);
    if (!evalObject) return null;
    const normalizedRun = {
      id: run.id || prefixedId("evalrun"),
      object: "eval.run",
      eval_id: evalId,
      ...clone(run),
    };
    this.writeJson(this.runJsonPath(evalId, normalizedRun.id), { run: normalizedRun });
    this.replaceOutputItems(evalId, normalizedRun.id, outputItems);
    this.cleanupRuns(evalId);
    return clone(normalizedRun);
  }

  updateRun(evalId, runId, updater) {
    const record = this.readJson(this.runJsonPath(evalId, runId));
    const run = record?.run;
    if (!run) return null;
    const updated = typeof updater === "function" ? updater(clone(run)) : { ...run, ...clone(updater || {}) };
    this.writeJson(this.runJsonPath(evalId, runId), { ...record, run: updated });
    return clone(updated);
  }

  listRuns(evalId) {
    if (!this.getEval(evalId)) return null;
    return this.listRunRecords(evalId)
      .map((record) => record.run)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(clone);
  }

  getRun(evalId, runId) {
    if (!this.getEval(evalId)) return null;
    return cloneOrNull(this.readJson(this.runJsonPath(evalId, runId))?.run || null);
  }

  cancelRun(evalId, runId) {
    const run = this.getRun(evalId, runId);
    if (!run) return null;
    if (!["completed", "failed", "cancelled", "canceled"].includes(String(run.status || ""))) {
      const now = nowSeconds();
      run.status = "cancelled";
      run.cancelled_at = now;
      run.completed_at = null;
      run.error = {
        code: "eval_run_cancelled",
        message: "local eval run was cancelled",
      };
      this.writeJson(this.runJsonPath(evalId, runId), { run });
    }
    return this.getRun(evalId, runId);
  }

  replaceOutputItems(evalId, runId, outputItems = []) {
    const dir = this.outputItemsDir(evalId, runId);
    this.deletePath(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const item of outputItems) {
      const id = item?.id || prefixedId("evalout");
      this.writeJson(this.outputItemJsonPath(evalId, runId, id), {
        output_item: {
          id,
          object: "eval.run.output_item",
          eval_id: evalId,
          run_id: runId,
          ...clone(item),
        },
      });
    }
  }

  listOutputItems(evalId, runId) {
    if (!this.getRun(evalId, runId)) return null;
    return this.listJson(this.outputItemsDir(evalId, runId))
      .map((record) => record.output_item)
      .filter(Boolean)
      .sort((a, b) => {
        const created = Number(a.created_at || 0) - Number(b.created_at || 0);
        if (created) return created;
        const line = Number(a.metadata?.line || 0) - Number(b.metadata?.line || 0);
        if (line) return line;
        return String(a.id || "").localeCompare(String(b.id || ""));
      })
      .map(clone);
  }

  getOutputItem(evalId, runId, outputItemId) {
    if (!this.getRun(evalId, runId)) return null;
    return cloneOrNull(this.readJson(this.outputItemJsonPath(evalId, runId, outputItemId))?.output_item || null);
  }

  evalsDir() {
    return path.join(this.dir, "evals");
  }

  evalDir(evalId) {
    return path.join(this.evalsDir(), safeId(evalId) || "__invalid__");
  }

  evalJsonPath(evalId) {
    return path.join(this.evalDir(evalId), "eval.json");
  }

  runsDir(evalId) {
    return path.join(this.evalDir(evalId), "runs");
  }

  runDir(evalId, runId) {
    return path.join(this.runsDir(evalId), safeId(runId) || "__invalid__");
  }

  runJsonPath(evalId, runId) {
    return path.join(this.runDir(evalId, runId), "run.json");
  }

  outputItemsDir(evalId, runId) {
    return path.join(this.runDir(evalId, runId), "output_items");
  }

  outputItemJsonPath(evalId, runId, outputItemId) {
    return path.join(this.outputItemsDir(evalId, runId), `${safeId(outputItemId) || "__invalid__"}.json`);
  }

  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  }

  listJson(dir) {
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.readJson(path.join(dir, name)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  listEvalRecords() {
    try {
      return fs.readdirSync(this.evalsDir())
        .map((name) => this.readJson(path.join(this.evalsDir(), name, "eval.json")))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  listRunRecords(evalId) {
    try {
      return fs.readdirSync(this.runsDir(evalId))
        .map((name) => this.readJson(path.join(this.runsDir(evalId), name, "run.json")))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  deletePath(targetPath) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {
      // Best-effort delete.
    }
  }

  cleanup() {
    fs.mkdirSync(this.evalsDir(), { recursive: true, mode: 0o700 });
    const entries = fs.readdirSync(this.evalsDir())
      .map((name) => {
        const filePath = path.join(this.evalsDir(), name);
        try {
          const stat = fs.statSync(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(this.maxRecords)) this.deletePath(entry.filePath);
  }

  cleanupRuns(evalId) {
    const dir = this.runsDir(evalId);
    try {
      const entries = fs.readdirSync(dir)
        .map((name) => {
          const filePath = path.join(dir, name);
          try {
            const stat = fs.statSync(filePath);
            return { filePath, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of entries.slice(this.maxRecords)) this.deletePath(entry.filePath);
    } catch {
      // No runs yet.
    }
  }
}

function normalizeTestingCriteria(criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  return list.map((criterion, index) => {
    const value = isPlainObject(criterion) ? clone(criterion) : { type: "string_check", input: String(criterion ?? "") };
    if (!value.type) value.type = "string_check";
    if (!value.name) value.name = `${value.type || "criterion"} ${index + 1}`;
    if (!value.id) value.id = `${sanitizeIdPrefix(value.name)}-${randomToken(8)}`;
    return value;
  });
}

function normalizeName(value, fallback) {
  const name = String(value ?? "").trim();
  return name || fallback;
}

function sanitizeIdPrefix(value) {
  const prefix = String(value || "criterion")
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return prefix || "criterion";
}

function cloneOrNull(value) {
  return value == null ? null : clone(value);
}

module.exports = { LocalEvalStore };
