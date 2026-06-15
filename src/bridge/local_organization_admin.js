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

function stableToken(value, length = 16) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url").slice(0, length);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,240}$/.test(value)) return null;
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
}

function optionalNullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeProjectRole(value, fallback = "member") {
  const role = String(value || fallback).trim().toLowerCase();
  return ["owner", "member"].includes(role) ? role : fallback;
}

function compareCreatedThenIdAsc(a, b) {
  const created = Number(a.created_at || 0) - Number(b.created_at || 0);
  if (created) return created;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function compareAddedThenIdAsc(a, b) {
  const added = Number(a.added_at || 0) - Number(b.added_at || 0);
  if (added) return added;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function compareModelThenIdAsc(a, b) {
  const model = String(a.model || "").localeCompare(String(b.model || ""));
  if (model) return model;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function localCompatibility(reason, extra = {}) {
  return {
    provider: "local",
    reason,
    actual_openai_admin_data: false,
    ...extra,
  };
}

const RATE_LIMIT_NUMERIC_FIELDS = Object.freeze([
  "batch_1_day_max_input_tokens",
  "max_audio_megabytes_per_1_minute",
  "max_images_per_1_minute",
  "max_requests_per_1_day",
  "max_requests_per_1_minute",
  "max_tokens_per_1_minute",
]);

const DEFAULT_RATE_LIMITS = Object.freeze([
  {
    model: "deepseek-v4-pro",
    max_requests_per_1_minute: 500,
    max_tokens_per_1_minute: 200000,
    max_requests_per_1_day: 10000,
  },
  {
    model: "gpt-4o-mini",
    max_requests_per_1_minute: 500,
    max_tokens_per_1_minute: 200000,
    max_requests_per_1_day: 10000,
  },
  {
    model: "gpt-4o",
    max_requests_per_1_minute: 500,
    max_tokens_per_1_minute: 30000,
    max_requests_per_1_day: 10000,
  },
  {
    model: "text-embedding-3-small",
    max_requests_per_1_minute: 1000,
    max_tokens_per_1_minute: 1000000,
    batch_1_day_max_input_tokens: 200000000,
  },
  {
    model: "gpt-image-1",
    max_requests_per_1_minute: 100,
    max_tokens_per_1_minute: 100000,
    max_images_per_1_minute: 100,
  },
]);

class LocalOrganizationAdminStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-organization-admin"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.projectsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.projectResourcesDir(), { recursive: true, mode: 0o700 });
  }

  projectsDir() {
    return path.join(this.dir, "projects");
  }

  projectResourcesDir() {
    return path.join(this.dir, "project_resources");
  }

  projectPath(projectId) {
    const clean = safeId(projectId);
    if (!clean) return null;
    return path.join(this.projectsDir(), `${clean}.json`);
  }

  projectResourceDir(projectId, resource) {
    const clean = safeId(projectId);
    if (!clean) return null;
    return path.join(this.projectResourcesDir(), clean, resource);
  }

  serviceAccountPath(projectId, serviceAccountId) {
    const clean = safeId(serviceAccountId);
    const dir = this.projectResourceDir(projectId, "service_accounts");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  apiKeyPath(projectId, apiKeyId) {
    const clean = safeId(apiKeyId);
    const dir = this.projectResourceDir(projectId, "api_keys");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  projectUserPath(projectId, userId) {
    const clean = safeId(userId);
    const dir = this.projectResourceDir(projectId, "users");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  rateLimitPath(projectId, rateLimitId) {
    const clean = safeId(rateLimitId);
    const dir = this.projectResourceDir(projectId, "rate_limits");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  createProject(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (!name) {
      throw organizationAdminError("name is required", {
        code: "missing_required_parameter",
        param: "name",
      });
    }
    const now = nowSeconds();
    const project = {
      id: `proj_${randomToken(14)}`,
      object: "organization.project",
      name,
      created_at: now,
      archived_at: null,
      status: "active",
      compatibility: localCompatibility("organization_project_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.projectPath(project.id), project);
    this.cleanup();
    return clone(project);
  }

  listProjects({ includeArchived = false } = {}) {
    return this.listJsonFiles(this.projectsDir())
      .filter((project) => includeArchived || project.status !== "archived")
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getProject(projectId) {
    return cloneOrNull(this.readJson(this.projectPath(projectId)));
  }

  updateProject(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    if (project.status === "archived") {
      throw organizationAdminError(`project is archived: ${projectId}`, {
        code: "project_archived",
        param: "project_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (name) project.name = name;
    project.compatibility = {
      ...(isPlainObject(project.compatibility) ? project.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.projectPath(project.id), project);
    return clone(project);
  }

  archiveProject(projectId) {
    const project = this.getRequiredProject(projectId);
    if (project.status !== "archived") {
      project.status = "archived";
      project.archived_at = nowSeconds();
      project.compatibility = {
        ...(isPlainObject(project.compatibility) ? project.compatibility : {}),
        last_lifecycle_action: "archive",
      };
      this.writeJson(this.projectPath(project.id), project);
    }
    return clone(project);
  }

  listProjectApiKeys(projectId) {
    this.getRequiredProject(projectId);
    return this.listJsonFiles(this.projectResourceDir(projectId, "api_keys"))
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getProjectApiKey(projectId, apiKeyId) {
    this.getRequiredProject(projectId);
    const apiKey = this.readJson(this.apiKeyPath(projectId, apiKeyId));
    if (!apiKey) {
      throw organizationAdminError(`project API key not found: ${apiKeyId}`, {
        status: 404,
        code: "project_api_key_not_found",
        param: "api_key_id",
      });
    }
    return clone(apiKey);
  }

  deleteProjectApiKey(projectId, apiKeyId) {
    this.getRequiredProject(projectId);
    const apiKey = this.readJson(this.apiKeyPath(projectId, apiKeyId));
    if (!apiKey) {
      throw organizationAdminError(`project API key not found: ${apiKeyId}`, {
        status: 404,
        code: "project_api_key_not_found",
        param: "api_key_id",
      });
    }
    if (apiKey.owner?.type === "service_account") {
      throw organizationAdminError("service account API keys are deleted by deleting the service account", {
        code: "service_account_api_key_delete_not_supported",
        param: "api_key_id",
      });
    }
    try { fs.unlinkSync(this.apiKeyPath(projectId, apiKeyId)); } catch {}
    return {
      object: "organization.project.api_key.deleted",
      id: apiKey.id,
      deleted: true,
    };
  }

  createServiceAccount(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (!name) {
      throw organizationAdminError("name is required", {
        code: "missing_required_parameter",
        param: "name",
      });
    }
    const now = nowSeconds();
    const serviceAccount = {
      object: "organization.project.service_account",
      id: `svc_acct_${randomToken(14)}`,
      name,
      role: normalizeProjectRole(request.role, "member"),
      created_at: now,
      compatibility: localCompatibility("project_service_account_protocol_compatibility", {
        project_id: project.id,
      }),
    };
    const apiKeyId = `key_${randomToken(14)}`;
    const apiKey = {
      object: "organization.project.api_key",
      redacted_value: `oc-local-${apiKeyId.slice(-8)}...redacted`,
      name: "Secret Key",
      created_at: now,
      last_used_at: null,
      id: apiKeyId,
      owner: {
        type: "service_account",
        service_account: clone(serviceAccount),
      },
      compatibility: localCompatibility("project_api_key_protocol_compatibility", {
        project_id: project.id,
        locally_generated_secret_persisted: false,
      }),
    };
    this.writeJson(this.serviceAccountPath(project.id, serviceAccount.id), serviceAccount);
    this.writeJson(this.apiKeyPath(project.id, apiKey.id), apiKey);
    this.cleanup();
    return {
      ...clone(serviceAccount),
      api_key: {
        object: "organization.project.service_account.api_key",
        value: `oc_local_key_${randomToken(24)}`,
        name: "Secret Key",
        created_at: now,
        id: apiKey.id,
        compatibility: localCompatibility("project_service_account_api_key_protocol_compatibility", {
          project_id: project.id,
          one_time_value: true,
          real_openai_api_key: false,
        }),
      },
    };
  }

  listProjectServiceAccounts(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    return this.listJsonFiles(this.projectResourceDir(projectId, "service_accounts"))
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getProjectServiceAccount(projectId, serviceAccountId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const serviceAccount = this.readJson(this.serviceAccountPath(projectId, serviceAccountId));
    if (!serviceAccount) {
      throw organizationAdminError(`project service account not found: ${serviceAccountId}`, {
        status: 404,
        code: "project_service_account_not_found",
        param: "service_account_id",
      });
    }
    return clone(serviceAccount);
  }

  updateProjectServiceAccount(projectId, serviceAccountId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const serviceAccount = this.readJson(this.serviceAccountPath(projectId, serviceAccountId));
    if (!serviceAccount) {
      throw organizationAdminError(`project service account not found: ${serviceAccountId}`, {
        status: 404,
        code: "project_service_account_not_found",
        param: "service_account_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (name) serviceAccount.name = name;
    if (request.role !== undefined) serviceAccount.role = normalizeProjectRole(request.role, serviceAccount.role || "member");
    serviceAccount.compatibility = {
      ...(isPlainObject(serviceAccount.compatibility) ? serviceAccount.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.serviceAccountPath(project.id, serviceAccount.id), serviceAccount);
    this.updateServiceAccountApiKeyOwners(project.id, serviceAccount);
    return clone(serviceAccount);
  }

  deleteProjectServiceAccount(projectId, serviceAccountId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const serviceAccount = this.readJson(this.serviceAccountPath(projectId, serviceAccountId));
    if (!serviceAccount) {
      throw organizationAdminError(`project service account not found: ${serviceAccountId}`, {
        status: 404,
        code: "project_service_account_not_found",
        param: "service_account_id",
      });
    }
    try { fs.unlinkSync(this.serviceAccountPath(project.id, serviceAccount.id)); } catch {}
    for (const apiKey of this.listJsonFiles(this.projectResourceDir(project.id, "api_keys"))) {
      if (apiKey.owner?.type === "service_account"
        && apiKey.owner?.service_account?.id === serviceAccount.id) {
        try { fs.unlinkSync(this.apiKeyPath(project.id, apiKey.id)); } catch {}
      }
    }
    return {
      object: "organization.project.service_account.deleted",
      id: serviceAccount.id,
      deleted: true,
    };
  }

  createProjectUser(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const request = isPlainObject(body) ? body : {};
    const roleText = optionalString(request.role);
    if (!roleText) {
      throw organizationAdminError("role is required", {
        code: "missing_required_parameter",
        param: "role",
      });
    }
    const role = normalizeProjectRole(roleText, "");
    if (!role) {
      throw organizationAdminError("role must be owner or member", {
        code: "invalid_project_role",
        param: "role",
      });
    }
    const email = optionalNullableString(request.email);
    const name = optionalNullableString(request.name);
    const requestedUserId = optionalString(request.user_id);
    const userId = this.localProjectUserId(requestedUserId, email);
    const existing = this.readJson(this.projectUserPath(project.id, userId));
    const now = nowSeconds();
    const user = {
      id: userId,
      object: "organization.project.user",
      added_at: existing?.added_at || now,
      role,
      email: email !== undefined ? email : existing?.email ?? null,
      name: name !== undefined ? name : existing?.name ?? null,
      compatibility: localCompatibility("project_user_protocol_compatibility", {
        project_id: project.id,
        locally_persisted: true,
      }),
    };
    this.writeJson(this.projectUserPath(project.id, user.id), user);
    this.cleanup();
    return clone(user);
  }

  listProjectUsers(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    return this.listJsonFiles(this.projectResourceDir(projectId, "users"))
      .sort(compareAddedThenIdAsc)
      .map(clone);
  }

  getProjectUser(projectId, userId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const user = this.readJson(this.projectUserPath(project.id, userId));
    if (!user) {
      throw organizationAdminError(`project user not found: ${userId}`, {
        status: 404,
        code: "project_user_not_found",
        param: "user_id",
      });
    }
    return clone(user);
  }

  updateProjectUser(projectId, userId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const user = this.readJson(this.projectUserPath(project.id, userId));
    if (!user) {
      throw organizationAdminError(`project user not found: ${userId}`, {
        status: 404,
        code: "project_user_not_found",
        param: "user_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    if (request.role !== undefined && request.role !== null) {
      const role = normalizeProjectRole(request.role, "");
      if (!role) {
        throw organizationAdminError("role must be owner or member", {
          code: "invalid_project_role",
          param: "role",
        });
      }
      user.role = role;
    }
    user.compatibility = {
      ...(isPlainObject(user.compatibility) ? user.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.projectUserPath(project.id, user.id), user);
    return clone(user);
  }

  deleteProjectUser(projectId, userId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const user = this.readJson(this.projectUserPath(project.id, userId));
    if (!user) {
      throw organizationAdminError(`project user not found: ${userId}`, {
        status: 404,
        code: "project_user_not_found",
        param: "user_id",
      });
    }
    try { fs.unlinkSync(this.projectUserPath(project.id, user.id)); } catch {}
    return {
      object: "organization.project.user.deleted",
      id: user.id,
      deleted: true,
    };
  }

  listProjectRateLimits(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    this.ensureDefaultProjectRateLimits(project.id);
    return this.listJsonFiles(this.projectResourceDir(projectId, "rate_limits"))
      .sort(compareModelThenIdAsc)
      .map(clone);
  }

  updateProjectRateLimit(projectId, rateLimitId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    this.ensureDefaultProjectRateLimits(project.id);
    const rateLimit = this.readJson(this.rateLimitPath(project.id, rateLimitId));
    if (!rateLimit) {
      throw organizationAdminError(`project rate limit not found: ${rateLimitId}`, {
        status: 404,
        code: "project_rate_limit_not_found",
        param: "rate_limit_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    for (const field of RATE_LIMIT_NUMERIC_FIELDS) {
      if (request[field] === undefined || request[field] === null) continue;
      const value = Number(request[field]);
      if (!Number.isFinite(value) || value < 0) {
        throw organizationAdminError(`${field} must be a non-negative number`, {
          code: "invalid_rate_limit_value",
          param: field,
        });
      }
      rateLimit[field] = Math.trunc(value);
    }
    rateLimit.compatibility = {
      ...(isPlainObject(rateLimit.compatibility) ? rateLimit.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.rateLimitPath(project.id, rateLimit.id), rateLimit);
    return clone(rateLimit);
  }

  updateServiceAccountApiKeyOwners(projectId, serviceAccount) {
    for (const apiKey of this.listJsonFiles(this.projectResourceDir(projectId, "api_keys"))) {
      if (apiKey.owner?.type !== "service_account") continue;
      if (apiKey.owner?.service_account?.id !== serviceAccount.id) continue;
      apiKey.owner.service_account = clone(serviceAccount);
      this.writeJson(this.apiKeyPath(projectId, apiKey.id), apiKey);
    }
  }

  localProjectUserId(userId, email) {
    const requested = safeId(userId);
    if (requested) return requested;
    if (email) return `user_${stableToken(String(email).toLowerCase(), 20)}`;
    return `user_${randomToken(14)}`;
  }

  ensureDefaultProjectRateLimits(projectId) {
    const existing = this.listJsonFiles(this.projectResourceDir(projectId, "rate_limits"));
    if (existing.length) return;
    const now = nowSeconds();
    for (const defaults of DEFAULT_RATE_LIMITS) {
      const rateLimit = {
        id: `rl_${stableToken(`${projectId}:${defaults.model}`, 20)}`,
        object: "project.rate_limit",
        model: defaults.model,
        max_requests_per_1_minute: defaults.max_requests_per_1_minute,
        max_tokens_per_1_minute: defaults.max_tokens_per_1_minute,
        compatibility: localCompatibility("project_rate_limit_protocol_compatibility", {
          project_id: projectId,
          locally_seeded: true,
          seeded_at: now,
        }),
      };
      for (const field of RATE_LIMIT_NUMERIC_FIELDS) {
        if (defaults[field] !== undefined) rateLimit[field] = defaults[field];
      }
      this.writeJson(this.rateLimitPath(projectId, rateLimit.id), rateLimit);
    }
  }

  getRequiredProject(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      throw organizationAdminError(`project not found: ${projectId}`, {
        status: 404,
        code: "project_not_found",
        param: "project_id",
      });
    }
    return project;
  }

  assertProjectActive(project) {
    if (project.status === "archived") {
      throw organizationAdminError(`project is archived: ${project.id}`, {
        code: "project_archived",
        param: "project_id",
      });
    }
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

  listJsonFiles(dir) {
    this.ensureDir();
    if (!dir) return [];
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
    for (const dir of [this.projectsDir()]) {
      const files = this.listCleanupEntries(dir);
      for (const entry of files.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
    for (const projectDir of this.listProjectResourceDirs()) {
      for (const resource of ["api_keys", "service_accounts", "users", "rate_limits"]) {
        const files = this.listCleanupEntries(path.join(projectDir, resource));
        for (const entry of files.slice(this.maxRecords)) {
          try { fs.unlinkSync(entry.filePath); } catch {}
        }
      }
    }
  }

  listProjectResourceDirs() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.projectResourcesDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.projectResourcesDir(), entry.name));
    } catch {
      return [];
    }
  }

  listCleanupEntries(dir) {
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const filePath = path.join(dir, name);
          return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  }
}

function organizationAdminError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 400;
  error.code = details.code || "invalid_request_error";
  error.type = details.type || "invalid_request_error";
  error.param = details.param || null;
  return error;
}

module.exports = {
  LocalOrganizationAdminStore,
};
