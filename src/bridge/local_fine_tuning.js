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

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,240}$/.test(value)) return null;
  return value;
}

function nullableString(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function stringOrDefault(value, fallback) {
  const text = value === undefined || value === null ? "" : String(value);
  return text || fallback;
}

function normalizeMetadata(value) {
  if (value === null) return null;
  return isPlainObject(value) ? clone(value) : null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function normalizeFineTuningMethod(body = {}) {
  const request = isPlainObject(body) ? body : {};
  const method = isPlainObject(request.method) ? clone(request.method) : {};
  const type = String(method.type || "supervised");
  method.type = type;
  if (type === "dpo") {
    const dpo = isPlainObject(method.dpo) ? method.dpo : {};
    method.dpo = {
      ...dpo,
      hyperparameters: normalizeHyperparameters(dpo.hyperparameters, ["beta"]),
    };
    return method;
  }
  if (type === "reinforcement") {
    const reinforcement = isPlainObject(method.reinforcement) ? method.reinforcement : {};
    method.reinforcement = {
      ...reinforcement,
      hyperparameters: normalizeHyperparameters(reinforcement.hyperparameters, [
        "batch_size",
        "learning_rate_multiplier",
        "n_epochs",
        "eval_interval",
        "eval_samples",
        "compute_multiplier",
        "reasoning_effort",
      ]),
      grader: isPlainObject(reinforcement.grader) ? clone(reinforcement.grader) : null,
      response_format: reinforcement.response_format === undefined ? null : clone(reinforcement.response_format),
    };
    return method;
  }
  const supervised = isPlainObject(method.supervised) ? method.supervised : {};
  method.supervised = {
    ...supervised,
    hyperparameters: normalizeHyperparameters(
      isPlainObject(request.hyperparameters) ? request.hyperparameters : supervised.hyperparameters,
      ["batch_size", "learning_rate_multiplier", "n_epochs"],
    ),
  };
  return method;
}

function normalizeHyperparameters(value, keys) {
  const source = isPlainObject(value) ? value : {};
  const normalized = {};
  for (const key of keys) normalized[key] = source[key] === undefined ? "auto" : source[key];
  for (const [key, entry] of Object.entries(source)) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) normalized[key] = entry;
  }
  return normalized;
}

function topLevelHyperparameters(method) {
  if (method?.type === "supervised" && isPlainObject(method.supervised?.hyperparameters)) {
    return clone(method.supervised.hyperparameters);
  }
  return null;
}

function modelSegment(model) {
  return String(model || "model")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "model";
}

function suffixSegment(suffix) {
  return String(suffix || "compat")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "compat";
}

function createdList(items) {
  const data = Array.isArray(items) ? items.map(clone) : [];
  return {
    object: "list",
    data,
    first_id: data[0]?.id || null,
    last_id: data.at(-1)?.id || null,
    has_more: false,
  };
}

function checkpointBucket(checkpoint) {
  return crypto.createHash("sha256").update(String(checkpoint || "")).digest("hex");
}

class LocalFineTuningStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-fine-tuning"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.jobsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.permissionsDir(), { recursive: true, mode: 0o700 });
  }

  jobsDir() {
    return path.join(this.dir, "jobs");
  }

  permissionsDir() {
    return path.join(this.dir, "checkpoint_permissions");
  }

  jobPath(jobId) {
    const clean = safeId(jobId);
    if (!clean) return null;
    return path.join(this.jobsDir(), `${clean}.json`);
  }

  permissionsPath(checkpoint) {
    if (!checkpoint) return null;
    return path.join(this.permissionsDir(), `${checkpointBucket(checkpoint)}.json`);
  }

  createJob(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const now = nowSeconds();
    const id = `ftjob_${randomToken(18)}`;
    const model = stringOrDefault(request.model, "gpt-4o-mini");
    const suffix = nullableString(request.suffix ?? request.user_provided_suffix);
    const method = normalizeFineTuningMethod(request);
    const fineTunedModel = `ft:${modelSegment(model)}:local:${suffixSegment(suffix)}:${randomToken(6)}`;
    const job = {
      object: "fine_tuning.job",
      id,
      model,
      created_at: now,
      finished_at: now,
      fine_tuned_model: fineTunedModel,
      organization_id: null,
      result_files: normalizeArray(request.result_files),
      status: "succeeded",
      validation_file: nullableString(request.validation_file),
      training_file: nullableString(request.training_file),
      hyperparameters: topLevelHyperparameters(method),
      method,
      metadata: normalizeMetadata(request.metadata),
      error: {
        code: null,
        message: null,
        param: null,
      },
      seed: Number.isInteger(request.seed) ? request.seed : crypto.randomInt(0, 2 ** 31),
      trained_tokens: 0,
      estimated_finish: null,
      integrations: normalizeArray(request.integrations),
      user_provided_suffix: suffix,
      usage_metrics: null,
      shared_with_openai: false,
      compatibility: {
        provider: "local",
        reason: "fine_tuning_job_protocol_compatibility",
        training_runtime: "simulated",
        actual_model_training: false,
        upstream_provider_called: false,
      },
    };
    const checkpoint = {
      object: "fine_tuning.job.checkpoint",
      id: `ftckpt_${randomToken(18)}`,
      created_at: now,
      fine_tuned_model_checkpoint: `${fineTunedModel}:ckpt-step-1000`,
      metrics: {
        full_valid_loss: 0,
        full_valid_mean_token_accuracy: 1,
      },
      fine_tuning_job_id: id,
      step_number: 1000,
      compatibility: {
        provider: "local",
        reason: "fine_tuning_checkpoint_protocol_compatibility",
      },
    };
    const events = [
      this.buildEvent("created", now, "Fine-tuning job created locally", { status: "validating_files" }),
      this.buildEvent("running", now, "Fine-tuning job simulated locally", { status: "running" }),
      this.buildEvent("succeeded", now, `New fine-tuned model created: ${fineTunedModel}`, { status: "succeeded" }),
    ];
    this.writeJson(this.jobPath(id), { job, events, checkpoints: [checkpoint] });
    this.cleanup();
    return clone(job);
  }

  listJobs({ metadataFilter } = {}) {
    return this.listRecords(this.jobsDir())
      .map((record) => record.job)
      .filter(Boolean)
      .filter((job) => matchesMetadata(job.metadata, metadataFilter))
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getJob(jobId) {
    return cloneOrNull(this.readJson(this.jobPath(jobId))?.job || null);
  }

  transitionJob(jobId, action) {
    const record = this.readJson(this.jobPath(jobId));
    if (!record?.job) return null;
    const now = nowSeconds();
    const job = { ...record.job };
    const previousStatus = job.status;
    if (action === "cancel") {
      job.status = "cancelled";
      job.finished_at = now;
      job.fine_tuned_model = null;
      job.cancelled_at = job.cancelled_at || now;
    } else if (action === "pause") {
      job.status = "paused";
      job.finished_at = null;
      job.fine_tuned_model = null;
      job.paused_at = job.paused_at || now;
    } else if (action === "resume") {
      job.status = "queued";
      job.finished_at = null;
      job.fine_tuned_model = null;
      job.resumed_at = job.resumed_at || now;
    }
    job.compatibility = {
      ...(isPlainObject(job.compatibility) ? job.compatibility : {}),
      last_lifecycle_action: action,
      previous_status: previousStatus,
    };
    const events = Array.isArray(record.events) ? record.events : [];
    events.unshift(this.buildEvent(action, now, `Fine-tuning job ${action} requested locally`, {
      status: job.status,
      previous_status: previousStatus,
    }));
    this.writeJson(this.jobPath(jobId), {
      ...record,
      job,
      events,
    });
    return clone(job);
  }

  listEvents(jobId) {
    const record = this.readJson(this.jobPath(jobId));
    if (!record?.job) return null;
    return (Array.isArray(record.events) ? record.events : [])
      .slice()
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  listCheckpoints(jobId) {
    const record = this.readJson(this.jobPath(jobId));
    if (!record?.job) return null;
    return (Array.isArray(record.checkpoints) ? record.checkpoints : [])
      .slice()
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  createCheckpointPermissions(checkpoint, projectIds = []) {
    const record = this.readJson(this.permissionsPath(checkpoint)) || {
      checkpoint,
      permissions: [],
    };
    const permissions = Array.isArray(record.permissions) ? record.permissions : [];
    const created = [];
    const now = nowSeconds();
    for (const projectId of projectIds) {
      const existing = permissions.find((permission) => permission.project_id === projectId);
      if (existing) {
        created.push(existing);
        continue;
      }
      const permission = {
        object: "checkpoint.permission",
        id: `cp_${randomToken(18)}`,
        created_at: now,
        project_id: projectId,
        fine_tuned_model_checkpoint: checkpoint,
      };
      permissions.unshift(permission);
      created.push(permission);
    }
    this.writeJson(this.permissionsPath(checkpoint), { checkpoint, permissions });
    this.cleanup();
    return createdList(created);
  }

  listCheckpointPermissions(checkpoint, { projectId } = {}) {
    const record = this.readJson(this.permissionsPath(checkpoint)) || {};
    return (Array.isArray(record.permissions) ? record.permissions : [])
      .filter((permission) => !projectId || permission.project_id === projectId)
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  deleteCheckpointPermission(checkpoint, permissionId) {
    const record = this.readJson(this.permissionsPath(checkpoint));
    if (!record || !Array.isArray(record.permissions)) return null;
    const index = record.permissions.findIndex((permission) => permission.id === permissionId);
    if (index === -1) return null;
    const [permission] = record.permissions.splice(index, 1);
    this.writeJson(this.permissionsPath(checkpoint), record);
    return {
      object: "checkpoint.permission",
      id: permission.id,
      deleted: true,
    };
  }

  buildEvent(kind, createdAt, message, data = null) {
    return {
      object: "fine_tuning.job.event",
      id: `ft-event_${randomToken(18)}`,
      created_at: createdAt,
      level: "info",
      message,
      data,
      type: "message",
      compatibility: {
        provider: "local",
        kind,
      },
    };
  }

  readJson(filePath) {
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    if (!filePath) return;
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

  listRecords(dir) {
    this.ensureDir();
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.readJson(path.join(dir, name)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  cleanup() {
    this.ensureDir();
    for (const dir of [this.jobsDir(), this.permissionsDir()]) {
      const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const filePath = path.join(dir, name);
          return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of files.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
  }
}

function compareCreatedThenIdAsc(a, b) {
  const created = Number(a.created_at || 0) - Number(b.created_at || 0);
  if (created) return created;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function matchesMetadata(metadata, filter) {
  if (!filter) return true;
  if (filter.none === true) return metadata === null || (isPlainObject(metadata) && Object.keys(metadata).length === 0);
  const source = isPlainObject(metadata) ? metadata : {};
  for (const [key, value] of Object.entries(filter.values || {})) {
    if (String(source[key] ?? "") !== String(value)) return false;
  }
  return true;
}

module.exports = {
  LocalFineTuningStore,
};
