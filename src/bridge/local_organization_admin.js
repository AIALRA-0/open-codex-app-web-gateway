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

function normalizeOrganizationRole(value, fallback = "reader") {
  const role = String(value || fallback).trim().toLowerCase();
  return ["owner", "reader"].includes(role) ? role : fallback;
}

function compareCreatedThenIdAsc(a, b) {
  const created = Number(a.created_at || 0) - Number(b.created_at || 0);
  if (created) return created;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function compareEffectiveThenIdAsc(a, b) {
  const effective = Number(a.effective_at || 0) - Number(b.effective_at || 0);
  if (effective) return effective;
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

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => optionalString(value))
    .filter(Boolean)));
}

function intersects(values, filterValues) {
  if (!filterValues?.length) return true;
  const valueSet = new Set(values);
  return filterValues.some((value) => valueSet.has(value));
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

const ORGANIZATION_DATA_RETENTION_TYPES = Object.freeze([
  "zero_data_retention",
  "modified_abuse_monitoring",
  "enhanced_zero_data_retention",
  "enhanced_modified_abuse_monitoring",
]);

const PROJECT_DATA_RETENTION_TYPES = Object.freeze([
  "organization_default",
  "none",
  ...ORGANIZATION_DATA_RETENTION_TYPES,
]);

const MODEL_PERMISSION_MODES = Object.freeze(["allow_list", "deny_list"]);

const HOSTED_TOOL_PERMISSION_TYPES = Object.freeze([
  "code_interpreter",
  "file_search",
  "image_generation",
  "mcp",
  "web_search",
]);

class LocalOrganizationAdminStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-organization-admin"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.projectsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.projectResourcesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationUsersDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationInvitesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationRolesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationGroupsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationUserRolesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationGroupResourcesDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationAdminApiKeysDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.organizationSpendAlertsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.auditLogsDir(), { recursive: true, mode: 0o700 });
  }

  projectsDir() {
    return path.join(this.dir, "projects");
  }

  organizationUsersDir() {
    return path.join(this.dir, "organization_users");
  }

  organizationInvitesDir() {
    return path.join(this.dir, "organization_invites");
  }

  organizationRolesDir() {
    return path.join(this.dir, "organization_roles");
  }

  organizationGroupsDir() {
    return path.join(this.dir, "organization_groups");
  }

  organizationUserRolesDir() {
    return path.join(this.dir, "organization_user_roles");
  }

  organizationGroupResourcesDir() {
    return path.join(this.dir, "organization_group_resources");
  }

  organizationAdminApiKeysDir() {
    return path.join(this.dir, "organization_admin_api_keys");
  }

  organizationDataRetentionPath() {
    return path.join(this.dir, "organization_data_retention.json");
  }

  organizationSpendAlertsDir() {
    return path.join(this.dir, "organization_spend_alerts");
  }

  auditLogsDir() {
    return path.join(this.dir, "audit_logs");
  }

  projectResourcesDir() {
    return path.join(this.dir, "project_resources");
  }

  projectPath(projectId) {
    const clean = safeId(projectId);
    if (!clean) return null;
    return path.join(this.projectsDir(), `${clean}.json`);
  }

  organizationUserPath(userId) {
    const clean = safeId(userId);
    if (!clean) return null;
    return path.join(this.organizationUsersDir(), `${clean}.json`);
  }

  organizationInvitePath(inviteId) {
    const clean = safeId(inviteId);
    if (!clean) return null;
    return path.join(this.organizationInvitesDir(), `${clean}.json`);
  }

  organizationRolePath(roleId) {
    const clean = safeId(roleId);
    if (!clean) return null;
    return path.join(this.organizationRolesDir(), `${clean}.json`);
  }

  organizationGroupPath(groupId) {
    const clean = safeId(groupId);
    if (!clean) return null;
    return path.join(this.organizationGroupsDir(), `${clean}.json`);
  }

  organizationUserRoleDir(userId) {
    const clean = safeId(userId);
    if (!clean) return null;
    return path.join(this.organizationUserRolesDir(), clean);
  }

  organizationUserRolePath(userId, roleId) {
    const clean = safeId(roleId);
    const dir = this.organizationUserRoleDir(userId);
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  organizationGroupResourceDir(groupId, resource) {
    const clean = safeId(groupId);
    if (!clean) return null;
    return path.join(this.organizationGroupResourcesDir(), clean, resource);
  }

  organizationGroupUserPath(groupId, userId) {
    const clean = safeId(userId);
    const dir = this.organizationGroupResourceDir(groupId, "users");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  organizationGroupRolePath(groupId, roleId) {
    const clean = safeId(roleId);
    const dir = this.organizationGroupResourceDir(groupId, "roles");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  organizationAdminApiKeyPath(apiKeyId) {
    const clean = safeId(apiKeyId);
    if (!clean) return null;
    return path.join(this.organizationAdminApiKeysDir(), `${clean}.json`);
  }

  organizationSpendAlertPath(alertId) {
    const clean = safeId(alertId);
    if (!clean) return null;
    return path.join(this.organizationSpendAlertsDir(), `${clean}.json`);
  }

  auditLogPath(auditLogId) {
    const clean = safeId(auditLogId);
    if (!clean) return null;
    return path.join(this.auditLogsDir(), `${clean}.json`);
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

  projectGroupPath(projectId, groupId) {
    const clean = safeId(groupId);
    const dir = this.projectResourceDir(projectId, "groups");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  projectSpendAlertPath(projectId, alertId) {
    const clean = safeId(alertId);
    const dir = this.projectResourceDir(projectId, "spend_alerts");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  projectDataRetentionPath(projectId) {
    const dir = this.projectResourceDir(projectId, "data_retention");
    if (!dir) return null;
    return path.join(dir, "settings.json");
  }

  projectModelPermissionsPath(projectId) {
    const dir = this.projectResourceDir(projectId, "model_permissions");
    if (!dir) return null;
    return path.join(dir, "settings.json");
  }

  projectHostedToolPermissionsPath(projectId) {
    const dir = this.projectResourceDir(projectId, "hosted_tool_permissions");
    if (!dir) return null;
    return path.join(dir, "settings.json");
  }

  rateLimitPath(projectId, rateLimitId) {
    const clean = safeId(rateLimitId);
    const dir = this.projectResourceDir(projectId, "rate_limits");
    if (!clean || !dir) return null;
    return path.join(dir, `${clean}.json`);
  }

  recordAuditLog(type, details = {}, options = {}) {
    const eventType = optionalString(type);
    if (!eventType) return null;
    const eventDetails = isPlainObject(details) ? clone(details) : {};
    const projectIds = uniqueStrings([
      options.projectId,
      options.projectIds,
      eventDetails.project_id,
      eventType.startsWith("project.") && eventDetails.id ? eventDetails.id : null,
    ]);
    const resourceIds = uniqueStrings([
      options.resourceId,
      options.resourceIds,
      eventDetails.id,
      eventDetails.project_id,
    ]);
    const now = nowSeconds();
    const auditLog = {
      id: `audit_log_${randomToken(14)}`,
      type: eventType,
      effective_at: Number.isFinite(Number(options.effectiveAt)) ? Math.trunc(Number(options.effectiveAt)) : now,
      actor: isPlainObject(options.actor) ? clone(options.actor) : this.localAuditActor(),
      [eventType]: eventDetails,
      compatibility: localCompatibility("organization_audit_log_protocol_compatibility", {
        locally_persisted: true,
        source: "local_organization_admin_store",
      }),
      _filter_project_ids: projectIds,
      _filter_resource_ids: resourceIds,
      _filter_actor_ids: uniqueStrings(options.actorIds),
      _filter_actor_emails: uniqueStrings(options.actorEmails).map((email) => email.toLowerCase()),
    };
    this.writeJson(this.auditLogPath(auditLog.id), auditLog);
    this.cleanup();
    return this.auditLogProjection(auditLog);
  }

  listAuditLogs(filters = {}) {
    const filter = isPlainObject(filters) ? filters : {};
    const effectiveAt = isPlainObject(filter.effectiveAt) ? filter.effectiveAt : {};
    const projectIds = uniqueStrings(filter.projectIds);
    const eventTypes = uniqueStrings(filter.eventTypes);
    const actorIds = uniqueStrings(filter.actorIds);
    const actorEmails = uniqueStrings(filter.actorEmails).map((email) => email.toLowerCase());
    const resourceIds = uniqueStrings(filter.resourceIds);
    return this.listJsonFiles(this.auditLogsDir())
      .filter((log) => this.auditLogMatchesEffectiveAt(log, effectiveAt))
      .filter((log) => !eventTypes.length || eventTypes.includes(log.type))
      .filter((log) => intersects(this.auditLogProjectIds(log), projectIds))
      .filter((log) => intersects(this.auditLogActorIds(log), actorIds))
      .filter((log) => intersects(this.auditLogActorEmails(log), actorEmails))
      .filter((log) => intersects(this.auditLogResourceIds(log), resourceIds))
      .sort(compareEffectiveThenIdAsc)
      .map((log) => this.auditLogProjection(log));
  }

  createOrganizationAdminApiKey(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (!name) {
      throw organizationAdminError("name is required", {
        code: "missing_required_parameter",
        param: "name",
      });
    }
    const now = nowSeconds();
    const apiKey = {
      object: "organization.admin_api_key",
      id: `key_${randomToken(14)}`,
      name,
      redacted_value: null,
      created_at: now,
      last_used_at: null,
      owner: this.localOrganizationAdminApiKeyOwner(now),
      compatibility: localCompatibility("organization_admin_api_key_protocol_compatibility", {
        locally_persisted: true,
        locally_generated_secret_persisted: false,
      }),
    };
    apiKey.redacted_value = `oc-local-admin-${apiKey.id.slice(-8)}...redacted`;
    this.writeJson(this.organizationAdminApiKeyPath(apiKey.id), apiKey);
    this.recordAuditLog("api_key.created", {
      id: apiKey.id,
      data: {
        name: apiKey.name,
        scopes: ["api.organization.admin"],
      },
    }, {
      resourceId: apiKey.id,
    });
    this.cleanup();
    return {
      ...this.organizationAdminApiKeyProjection(apiKey),
      value: `oc_local_admin_key_${randomToken(24)}`,
    };
  }

  listOrganizationAdminApiKeys() {
    return this.listJsonFiles(this.organizationAdminApiKeysDir())
      .sort(compareCreatedThenIdAsc)
      .map((apiKey) => this.organizationAdminApiKeyProjection(apiKey));
  }

  getOrganizationAdminApiKey(apiKeyId) {
    const apiKey = this.readJson(this.organizationAdminApiKeyPath(apiKeyId));
    if (!apiKey) {
      throw organizationAdminError(`organization admin API key not found: ${apiKeyId}`, {
        status: 404,
        code: "organization_admin_api_key_not_found",
        param: "key_id",
      });
    }
    return this.organizationAdminApiKeyProjection(apiKey);
  }

  deleteOrganizationAdminApiKey(apiKeyId) {
    const apiKey = this.readJson(this.organizationAdminApiKeyPath(apiKeyId));
    if (!apiKey) {
      throw organizationAdminError(`organization admin API key not found: ${apiKeyId}`, {
        status: 404,
        code: "organization_admin_api_key_not_found",
        param: "key_id",
      });
    }
    try { fs.unlinkSync(this.organizationAdminApiKeyPath(apiKey.id)); } catch {}
    this.recordAuditLog("api_key.deleted", {
      id: apiKey.id,
      data: {
        name: apiKey.name ?? null,
        scopes: ["api.organization.admin"],
      },
    }, {
      resourceId: apiKey.id,
    });
    return {
      object: "organization.admin_api_key.deleted",
      id: apiKey.id,
      deleted: true,
    };
  }

  getOrganizationDataRetention() {
    const existing = this.readJson(this.organizationDataRetentionPath());
    if (existing) return this.dataRetentionProjection(existing, "organization");
    return this.dataRetentionProjection({
      object: "organization.data_retention",
      type: "modified_abuse_monitoring",
      compatibility: localCompatibility("organization_data_retention_protocol_compatibility", {
        locally_persisted: false,
        locally_defaulted: true,
      }),
    }, "organization");
  }

  updateOrganizationDataRetention(body = {}) {
    const type = this.normalizeDataRetentionType(body, ORGANIZATION_DATA_RETENTION_TYPES, {
      code: "invalid_organization_data_retention_type",
    });
    const record = {
      object: "organization.data_retention",
      type,
      updated_at: nowSeconds(),
      compatibility: localCompatibility("organization_data_retention_protocol_compatibility", {
        locally_persisted: true,
        last_lifecycle_action: "update",
      }),
    };
    this.writeJson(this.organizationDataRetentionPath(), record);
    this.recordAuditLog("data_retention.updated", {
      id: "organization_data_retention",
      data: {
        type,
      },
    }, {
      resourceId: "organization_data_retention",
    });
    return this.dataRetentionProjection(record, "organization");
  }

  createOrganizationSpendAlert(body = {}) {
    const alert = this.spendAlertFromRequest(body, {
      object: "organization.spend_alert",
      compatibilityReason: "organization_spend_alert_protocol_compatibility",
    });
    this.writeJson(this.organizationSpendAlertPath(alert.id), alert);
    this.recordAuditLog("spend_alert.created", {
      id: alert.id,
      data: this.spendAlertAuditData(alert),
    }, {
      resourceId: alert.id,
    });
    this.cleanup();
    return this.spendAlertProjection(alert);
  }

  updateOrganizationSpendAlert(alertId, body = {}) {
    const existing = this.readJson(this.organizationSpendAlertPath(alertId));
    if (!existing) {
      throw organizationAdminError(`organization spend alert not found: ${alertId}`, {
        status: 404,
        code: "organization_spend_alert_not_found",
        param: "alert_id",
      });
    }
    const alert = this.spendAlertFromRequest(body, {
      id: existing.id,
      object: "organization.spend_alert",
      compatibilityReason: "organization_spend_alert_protocol_compatibility",
      createdAt: existing.created_at,
      lastLifecycleAction: "update",
    });
    this.writeJson(this.organizationSpendAlertPath(alert.id), alert);
    this.recordAuditLog("spend_alert.updated", {
      id: alert.id,
      changes_requested: this.spendAlertAuditData(alert),
    }, {
      resourceId: alert.id,
    });
    return this.spendAlertProjection(alert);
  }

  listOrganizationSpendAlerts() {
    return this.listJsonFiles(this.organizationSpendAlertsDir())
      .sort(compareCreatedThenIdAsc)
      .map((alert) => this.spendAlertProjection(alert));
  }

  deleteOrganizationSpendAlert(alertId) {
    const alert = this.readJson(this.organizationSpendAlertPath(alertId));
    if (!alert) {
      throw organizationAdminError(`organization spend alert not found: ${alertId}`, {
        status: 404,
        code: "organization_spend_alert_not_found",
        param: "alert_id",
      });
    }
    try { fs.unlinkSync(this.organizationSpendAlertPath(alert.id)); } catch {}
    this.recordAuditLog("spend_alert.deleted", {
      id: alert.id,
      data: this.spendAlertAuditData(alert),
    }, {
      resourceId: alert.id,
    });
    return {
      object: "organization.spend_alert.deleted",
      id: alert.id,
      deleted: true,
    };
  }

  createOrganizationRole(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.role_name);
    if (!name) {
      throw organizationAdminError("role_name is required", {
        code: "missing_required_parameter",
        param: "role_name",
      });
    }
    const permissions = this.normalizeRolePermissions(request.permissions);
    const now = nowSeconds();
    const role = {
      id: `role_${randomToken(14)}`,
      object: "role",
      name,
      description: optionalNullableString(request.description) ?? null,
      permissions,
      predefined_role: false,
      resource_type: "api.organization",
      created_at: now,
      updated_at: now,
      compatibility: localCompatibility("organization_role_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationRolePath(role.id), role);
    this.recordAuditLog("role.created", {
      id: role.id,
      role_name: role.name,
      permissions: role.permissions,
      resource_type: role.resource_type,
    }, {
      resourceId: role.id,
    });
    this.cleanup();
    return this.organizationRoleProjection(role);
  }

  listOrganizationRoles() {
    return this.listJsonFiles(this.organizationRolesDir())
      .sort(compareCreatedThenIdAsc)
      .map((role) => this.organizationRoleProjection(role));
  }

  getOrganizationRole(roleId) {
    const role = this.getRequiredOrganizationRole(roleId);
    return this.organizationRoleProjection(role);
  }

  updateOrganizationRole(roleId, body = {}) {
    const role = this.getRequiredOrganizationRole(roleId);
    if (role.predefined_role) {
      throw organizationAdminError("predefined organization roles cannot be updated", {
        code: "predefined_role_update_not_supported",
        param: "role_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.role_name);
    if (name) role.name = name;
    if (request.description !== undefined) role.description = optionalNullableString(request.description);
    if (request.permissions !== undefined && request.permissions !== null) {
      role.permissions = this.normalizeRolePermissions(request.permissions);
    }
    role.updated_at = nowSeconds();
    role.compatibility = {
      ...(isPlainObject(role.compatibility) ? role.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.organizationRolePath(role.id), role);
    this.recordAuditLog("role.updated", {
      id: role.id,
      changes_requested: {
        ...(name ? { role_name: name } : {}),
        ...(request.description !== undefined ? { description: role.description } : {}),
        ...(request.permissions !== undefined ? { permissions: role.permissions } : {}),
      },
    }, {
      resourceId: role.id,
    });
    return this.organizationRoleProjection(role);
  }

  deleteOrganizationRole(roleId) {
    const role = this.getRequiredOrganizationRole(roleId);
    if (role.predefined_role) {
      throw organizationAdminError("predefined organization roles cannot be deleted", {
        code: "predefined_role_delete_not_supported",
        param: "role_id",
      });
    }
    try { fs.unlinkSync(this.organizationRolePath(role.id)); } catch {}
    for (const userRoleDir of this.listOrganizationUserRoleDirs()) {
      try { fs.unlinkSync(path.join(userRoleDir, `${role.id}.json`)); } catch {}
    }
    for (const groupDir of this.listOrganizationGroupResourceDirs()) {
      try { fs.unlinkSync(path.join(groupDir, "roles", `${role.id}.json`)); } catch {}
    }
    this.recordAuditLog("role.deleted", {
      id: role.id,
    }, {
      resourceId: role.id,
    });
    return {
      object: "role.deleted",
      id: role.id,
      deleted: true,
    };
  }

  createOrganizationGroup(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (!name) {
      throw organizationAdminError("name is required", {
        code: "missing_required_parameter",
        param: "name",
      });
    }
    const now = nowSeconds();
    const group = {
      id: `group_${randomToken(14)}`,
      object: "group",
      name,
      created_at: now,
      group_type: "group",
      is_scim_managed: false,
      compatibility: localCompatibility("organization_group_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationGroupPath(group.id), group);
    this.recordAuditLog("group.created", {
      id: group.id,
      data: {
        group_name: group.name,
      },
    }, {
      resourceId: group.id,
    });
    this.cleanup();
    return clone(group);
  }

  listOrganizationGroups() {
    return this.listJsonFiles(this.organizationGroupsDir())
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getOrganizationGroup(groupId) {
    return clone(this.getRequiredOrganizationGroup(groupId));
  }

  updateOrganizationGroup(groupId, body = {}) {
    const group = this.getRequiredOrganizationGroup(groupId);
    if (group.is_scim_managed) {
      throw organizationAdminError("SCIM-managed groups cannot be updated locally", {
        code: "scim_managed_group_update_not_supported",
        param: "group_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    const name = optionalString(request.name);
    if (!name) {
      throw organizationAdminError("name is required", {
        code: "missing_required_parameter",
        param: "name",
      });
    }
    group.name = name;
    group.compatibility = {
      ...(isPlainObject(group.compatibility) ? group.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.organizationGroupPath(group.id), group);
    this.recordAuditLog("group.updated", {
      id: group.id,
      changes_requested: {
        group_name: group.name,
      },
    }, {
      resourceId: group.id,
    });
    return clone(group);
  }

  deleteOrganizationGroup(groupId) {
    const group = this.getRequiredOrganizationGroup(groupId);
    if (group.is_scim_managed) {
      throw organizationAdminError("SCIM-managed groups cannot be deleted locally", {
        code: "scim_managed_group_delete_not_supported",
        param: "group_id",
      });
    }
    try { fs.unlinkSync(this.organizationGroupPath(group.id)); } catch {}
    this.removeDir(path.join(this.organizationGroupResourcesDir(), group.id));
    for (const project of this.listProjects({ includeArchived: true })) {
      try { fs.unlinkSync(this.projectGroupPath(project.id, group.id)); } catch {}
    }
    this.recordAuditLog("group.deleted", {
      id: group.id,
    }, {
      resourceId: group.id,
    });
    return {
      object: "group.deleted",
      id: group.id,
      deleted: true,
    };
  }

  addOrganizationGroupUser(groupId, body = {}) {
    const group = this.getRequiredOrganizationGroup(groupId);
    const request = isPlainObject(body) ? body : {};
    const userId = optionalString(request.user_id);
    if (!userId) {
      throw organizationAdminError("user_id is required", {
        code: "missing_required_parameter",
        param: "user_id",
      });
    }
    const user = this.getRequiredOrganizationUser(userId);
    const membership = {
      id: user.id,
      group_id: group.id,
      user_id: user.id,
      created_at: nowSeconds(),
      compatibility: localCompatibility("organization_group_user_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationGroupUserPath(group.id, user.id), membership);
    this.recordAuditLog("group.updated", {
      id: group.id,
      changes_requested: {
        added_user_id: user.id,
      },
    }, {
      resourceIds: [group.id, user.id],
    });
    this.cleanup();
    return {
      object: "group.user",
      group_id: group.id,
      user_id: user.id,
    };
  }

  listOrganizationGroupUsers(groupId) {
    this.getRequiredOrganizationGroup(groupId);
    return this.listJsonFiles(this.organizationGroupResourceDir(groupId, "users"))
      .sort(compareCreatedThenIdAsc)
      .map((membership) => this.organizationGroupUserProjection(membership.user_id || membership.id));
  }

  getOrganizationGroupUser(groupId, userId) {
    this.getRequiredOrganizationGroup(groupId);
    const membership = this.readJson(this.organizationGroupUserPath(groupId, userId));
    if (!membership) {
      throw organizationAdminError(`organization group user not found: ${userId}`, {
        status: 404,
        code: "organization_group_user_not_found",
        param: "user_id",
      });
    }
    return this.organizationGroupUserDetail(membership.user_id || membership.id);
  }

  deleteOrganizationGroupUser(groupId, userId) {
    this.getRequiredOrganizationGroup(groupId);
    const membership = this.readJson(this.organizationGroupUserPath(groupId, userId));
    if (!membership) {
      throw organizationAdminError(`organization group user not found: ${userId}`, {
        status: 404,
        code: "organization_group_user_not_found",
        param: "user_id",
      });
    }
    try { fs.unlinkSync(this.organizationGroupUserPath(groupId, userId)); } catch {}
    this.recordAuditLog("group.updated", {
      id: groupId,
      changes_requested: {
        removed_user_id: userId,
      },
    }, {
      resourceIds: [groupId, userId],
    });
    return {
      object: "group.user.deleted",
      deleted: true,
    };
  }

  assignOrganizationUserRole(userId, body = {}) {
    const user = this.getRequiredOrganizationUser(userId);
    const role = this.getRequiredOrganizationRole(this.requiredRoleId(body));
    const assignment = {
      id: role.id,
      role_id: role.id,
      principal_id: user.id,
      principal_type: "user",
      created_at: nowSeconds(),
      compatibility: localCompatibility("organization_user_role_assignment_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationUserRolePath(user.id, role.id), assignment);
    this.recordAuditLog("role.assignment.created", {
      id: `assignment_${stableToken(`${user.id}:${role.id}`, 20)}`,
      principal_id: user.id,
      principal_type: "user",
      resource_id: role.id,
      resource_type: role.resource_type || "api.organization",
    }, {
      resourceIds: [role.id, user.id],
    });
    this.cleanup();
    return {
      object: "user.role",
      role: this.organizationRoleProjection(role),
      user: this.organizationUserProjection(user),
    };
  }

  listOrganizationUserRoles(userId) {
    this.getRequiredOrganizationUser(userId);
    return this.listJsonFiles(this.organizationUserRoleDir(userId))
      .sort(compareCreatedThenIdAsc)
      .map((assignment) => this.organizationRoleAssignmentProjection(assignment));
  }

  getOrganizationUserRole(userId, roleId) {
    this.getRequiredOrganizationUser(userId);
    const assignment = this.readJson(this.organizationUserRolePath(userId, roleId));
    if (!assignment) {
      throw organizationAdminError(`organization user role not found: ${roleId}`, {
        status: 404,
        code: "organization_user_role_not_found",
        param: "role_id",
      });
    }
    return this.organizationRoleAssignmentProjection(assignment);
  }

  deleteOrganizationUserRole(userId, roleId) {
    this.getRequiredOrganizationUser(userId);
    const assignment = this.readJson(this.organizationUserRolePath(userId, roleId));
    if (!assignment) {
      throw organizationAdminError(`organization user role not found: ${roleId}`, {
        status: 404,
        code: "organization_user_role_not_found",
        param: "role_id",
      });
    }
    try { fs.unlinkSync(this.organizationUserRolePath(userId, roleId)); } catch {}
    this.recordAuditLog("role.assignment.deleted", {
      id: `assignment_${stableToken(`${userId}:${roleId}`, 20)}`,
      principal_id: userId,
      principal_type: "user",
      resource_id: roleId,
      resource_type: "api.organization",
    }, {
      resourceIds: [roleId, userId],
    });
    return {
      object: "user.role.deleted",
      deleted: true,
    };
  }

  assignOrganizationGroupRole(groupId, body = {}) {
    const group = this.getRequiredOrganizationGroup(groupId);
    const role = this.getRequiredOrganizationRole(this.requiredRoleId(body));
    const assignment = {
      id: role.id,
      role_id: role.id,
      principal_id: group.id,
      principal_type: "group",
      created_at: nowSeconds(),
      compatibility: localCompatibility("organization_group_role_assignment_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationGroupRolePath(group.id, role.id), assignment);
    this.recordAuditLog("role.assignment.created", {
      id: `assignment_${stableToken(`${group.id}:${role.id}`, 20)}`,
      principal_id: group.id,
      principal_type: "group",
      resource_id: role.id,
      resource_type: role.resource_type || "api.organization",
    }, {
      resourceIds: [role.id, group.id],
    });
    this.cleanup();
    return {
      object: "group.role",
      role: this.organizationRoleProjection(role),
      group: this.organizationGroupRoleSummary(group),
    };
  }

  listOrganizationGroupRoles(groupId) {
    this.getRequiredOrganizationGroup(groupId);
    return this.listJsonFiles(this.organizationGroupResourceDir(groupId, "roles"))
      .sort(compareCreatedThenIdAsc)
      .map((assignment) => this.organizationRoleAssignmentProjection(assignment));
  }

  getOrganizationGroupRole(groupId, roleId) {
    this.getRequiredOrganizationGroup(groupId);
    const assignment = this.readJson(this.organizationGroupRolePath(groupId, roleId));
    if (!assignment) {
      throw organizationAdminError(`organization group role not found: ${roleId}`, {
        status: 404,
        code: "organization_group_role_not_found",
        param: "role_id",
      });
    }
    return this.organizationRoleAssignmentProjection(assignment);
  }

  deleteOrganizationGroupRole(groupId, roleId) {
    this.getRequiredOrganizationGroup(groupId);
    const assignment = this.readJson(this.organizationGroupRolePath(groupId, roleId));
    if (!assignment) {
      throw organizationAdminError(`organization group role not found: ${roleId}`, {
        status: 404,
        code: "organization_group_role_not_found",
        param: "role_id",
      });
    }
    try { fs.unlinkSync(this.organizationGroupRolePath(groupId, roleId)); } catch {}
    this.recordAuditLog("role.assignment.deleted", {
      id: `assignment_${stableToken(`${groupId}:${roleId}`, 20)}`,
      principal_id: groupId,
      principal_type: "group",
      resource_id: roleId,
      resource_type: "api.organization",
    }, {
      resourceIds: [roleId, groupId],
    });
    return {
      object: "group.role.deleted",
      deleted: true,
    };
  }

  createInvite(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const email = optionalString(request.email);
    if (!email) {
      throw organizationAdminError("email is required", {
        code: "missing_required_parameter",
        param: "email",
      });
    }
    const roleText = optionalString(request.role);
    if (!roleText) {
      throw organizationAdminError("role is required", {
        code: "missing_required_parameter",
        param: "role",
      });
    }
    const role = normalizeOrganizationRole(roleText, "");
    if (!role) {
      throw organizationAdminError("role must be owner or reader", {
        code: "invalid_organization_role",
        param: "role",
      });
    }
    const projects = this.normalizeInviteProjects(request.projects);
    const now = nowSeconds();
    const invite = {
      id: `invite_${randomToken(14)}`,
      object: "organization.invite",
      email,
      role,
      status: "pending",
      created_at: now,
      expires_at: now + 7 * 24 * 60 * 60,
      accepted_at: null,
      projects,
      compatibility: localCompatibility("organization_invite_protocol_compatibility", {
        locally_persisted: true,
        default_project_membership_emulated: request.projects === undefined,
      }),
    };
    this.writeJson(this.organizationInvitePath(invite.id), invite);
    this.recordAuditLog("invite.sent", {
      id: invite.id,
      data: {
        email: invite.email,
        role: invite.role,
      },
    }, {
      resourceId: invite.id,
      projectIds: invite.projects.map((project) => project.id),
    });
    this.cleanup();
    return clone(invite);
  }

  listInvites() {
    return this.listJsonFiles(this.organizationInvitesDir())
      .sort(compareCreatedThenIdAsc)
      .map(clone);
  }

  getInvite(inviteId) {
    const invite = this.readJson(this.organizationInvitePath(inviteId));
    if (!invite) {
      throw organizationAdminError(`organization invite not found: ${inviteId}`, {
        status: 404,
        code: "organization_invite_not_found",
        param: "invite_id",
      });
    }
    return clone(invite);
  }

  deleteInvite(inviteId) {
    const invite = this.getInvite(inviteId);
    if (invite.status === "accepted") {
      throw organizationAdminError("accepted organization invites cannot be deleted", {
        code: "organization_invite_accepted",
        param: "invite_id",
      });
    }
    try { fs.unlinkSync(this.organizationInvitePath(invite.id)); } catch {}
    this.recordAuditLog("invite.deleted", {
      id: invite.id,
    }, {
      resourceId: invite.id,
      projectIds: invite.projects?.map((project) => project.id) || [],
    });
    return {
      object: "organization.invite.deleted",
      id: invite.id,
      deleted: true,
    };
  }

  listOrganizationUsers({ emails = [] } = {}) {
    const filterEmails = new Set(emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean));
    return this.listJsonFiles(this.organizationUsersDir())
      .filter((user) => !filterEmails.size || filterEmails.has(String(user.email || "").toLowerCase()))
      .sort(compareAddedThenIdAsc)
      .map((user) => this.organizationUserProjection(user));
  }

  getOrganizationUser(userId) {
    const user = this.readJson(this.organizationUserPath(userId));
    if (!user) {
      throw organizationAdminError(`organization user not found: ${userId}`, {
        status: 404,
        code: "organization_user_not_found",
        param: "user_id",
      });
    }
    return this.organizationUserProjection(user);
  }

  updateOrganizationUser(userId, body = {}) {
    const user = this.readJson(this.organizationUserPath(userId));
    if (!user) {
      throw organizationAdminError(`organization user not found: ${userId}`, {
        status: 404,
        code: "organization_user_not_found",
        param: "user_id",
      });
    }
    const request = isPlainObject(body) ? body : {};
    if (request.role !== undefined && request.role !== null) {
      const role = normalizeOrganizationRole(request.role, "");
      if (!role) {
        throw organizationAdminError("role must be owner or reader", {
          code: "invalid_organization_role",
          param: "role",
        });
      }
      user.role = role;
    }
    if (request.role_id !== undefined) user.role_id = optionalNullableString(request.role_id);
    if (request.developer_persona !== undefined) {
      user.developer_persona = optionalNullableString(request.developer_persona);
    }
    if (request.technical_level !== undefined) {
      user.technical_level = optionalNullableString(request.technical_level);
    }
    user.compatibility = {
      ...(isPlainObject(user.compatibility) ? user.compatibility : {}),
      last_lifecycle_action: "update",
    };
    this.writeJson(this.organizationUserPath(user.id), user);
    this.recordAuditLog("user.updated", {
      id: user.id,
      changes_requested: {
        ...(request.role !== undefined ? { role: user.role } : {}),
        ...(request.role_id !== undefined ? { role_id: user.role_id ?? null } : {}),
        ...(request.developer_persona !== undefined ? { developer_persona: user.developer_persona ?? null } : {}),
        ...(request.technical_level !== undefined ? { technical_level: user.technical_level ?? null } : {}),
      },
    }, {
      resourceId: user.id,
      actorEmails: [user.email],
    });
    return this.organizationUserProjection(user);
  }

  deleteOrganizationUser(userId) {
    const user = this.readJson(this.organizationUserPath(userId));
    if (!user) {
      throw organizationAdminError(`organization user not found: ${userId}`, {
        status: 404,
        code: "organization_user_not_found",
        param: "user_id",
      });
    }
    try { fs.unlinkSync(this.organizationUserPath(user.id)); } catch {}
    this.removeDir(this.organizationUserRoleDir(user.id));
    for (const groupDir of this.listOrganizationGroupResourceDirs()) {
      try { fs.unlinkSync(path.join(groupDir, "users", `${user.id}.json`)); } catch {}
    }
    for (const project of this.listProjects({ includeArchived: true })) {
      try { fs.unlinkSync(this.projectUserPath(project.id, user.id)); } catch {}
    }
    this.recordAuditLog("user.deleted", {
      id: user.id,
    }, {
      resourceId: user.id,
      actorEmails: [user.email],
    });
    return {
      object: "organization.user.deleted",
      id: user.id,
      deleted: true,
    };
  }

  ensureOrganizationUser(fields = {}) {
    const userId = this.localOrganizationUserId(fields.userId, fields.email);
    const existing = this.readJson(this.organizationUserPath(userId));
    const now = nowSeconds();
    const email = fields.email !== undefined ? optionalNullableString(fields.email) : existing?.email ?? null;
    const name = fields.name !== undefined ? optionalNullableString(fields.name) : existing?.name ?? null;
    const user = {
      id: userId,
      object: "organization.user",
      added_at: existing?.added_at || now,
      created: existing?.created || now,
      api_key_last_used_at: existing?.api_key_last_used_at ?? null,
      developer_persona: existing?.developer_persona ?? null,
      email,
      is_default: existing?.is_default ?? false,
      is_scale_tier_authorized_purchaser: existing?.is_scale_tier_authorized_purchaser ?? null,
      is_scim_managed: existing?.is_scim_managed ?? false,
      is_service_account: existing?.is_service_account ?? false,
      name,
      role: existing?.role || normalizeOrganizationRole(fields.role, "reader"),
      technical_level: existing?.technical_level ?? null,
      ...(existing?.role_id ? { role_id: existing.role_id } : {}),
      compatibility: localCompatibility("organization_user_protocol_compatibility", {
        locally_persisted: true,
      }),
    };
    this.writeJson(this.organizationUserPath(user.id), user);
    if (!existing) {
      this.recordAuditLog("user.added", {
        id: user.id,
        data: {
          role: user.role,
        },
      }, {
        resourceId: user.id,
        actorEmails: [user.email],
      });
    }
    return this.organizationUserProjection(user);
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
    this.recordAuditLog("project.created", {
      id: project.id,
      data: {
        name,
        title: name,
      },
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
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
    this.recordAuditLog("project.updated", {
      id: project.id,
      changes_requested: {
        ...(name ? { title: name, name } : {}),
      },
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
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
      this.recordAuditLog("project.archived", {
        id: project.id,
      }, {
        projectId: project.id,
        resourceId: project.id,
      });
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
    this.recordAuditLog("api_key.deleted", {
      id: apiKey.id,
    }, {
      projectId,
      resourceId: apiKey.id,
    });
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
    this.recordAuditLog("service_account.created", {
      id: serviceAccount.id,
      project_id: project.id,
      data: {
        role: serviceAccount.role,
      },
    }, {
      projectId: project.id,
      resourceId: serviceAccount.id,
    });
    this.recordAuditLog("api_key.created", {
      id: apiKey.id,
      project_id: project.id,
      data: {
        scopes: ["api.model.request"],
      },
    }, {
      projectId: project.id,
      resourceId: apiKey.id,
    });
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
    this.recordAuditLog("service_account.updated", {
      id: serviceAccount.id,
      project_id: project.id,
      changes_requested: {
        ...(name ? { name } : {}),
        ...(request.role !== undefined ? { role: serviceAccount.role } : {}),
      },
    }, {
      projectId: project.id,
      resourceId: serviceAccount.id,
    });
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
        this.recordAuditLog("api_key.deleted", {
          id: apiKey.id,
          project_id: project.id,
        }, {
          projectId: project.id,
          resourceId: apiKey.id,
        });
      }
    }
    this.recordAuditLog("service_account.deleted", {
      id: serviceAccount.id,
      project_id: project.id,
    }, {
      projectId: project.id,
      resourceId: serviceAccount.id,
    });
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
    this.ensureOrganizationUser({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: "reader",
    });
    this.recordAuditLog("user.added", {
      id: user.id,
      project_id: project.id,
      data: {
        role: user.role,
      },
    }, {
      projectId: project.id,
      resourceId: user.id,
      actorEmails: [user.email],
    });
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
    this.recordAuditLog("user.updated", {
      id: user.id,
      project_id: project.id,
      changes_requested: {
        ...(request.role !== undefined ? { role: user.role } : {}),
      },
    }, {
      projectId: project.id,
      resourceId: user.id,
      actorEmails: [user.email],
    });
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
    this.recordAuditLog("user.deleted", {
      id: user.id,
      project_id: project.id,
    }, {
      projectId: project.id,
      resourceId: user.id,
      actorEmails: [user.email],
    });
    return {
      object: "organization.project.user.deleted",
      id: user.id,
      deleted: true,
    };
  }

  createProjectGroup(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const request = isPlainObject(body) ? body : {};
    const groupId = optionalString(request.group_id);
    if (!groupId) {
      throw organizationAdminError("group_id is required", {
        code: "missing_required_parameter",
        param: "group_id",
      });
    }
    const role = optionalString(request.role);
    if (!role) {
      throw organizationAdminError("role is required", {
        code: "missing_required_parameter",
        param: "role",
      });
    }
    const group = this.getRequiredOrganizationGroup(groupId);
    const existing = this.readJson(this.projectGroupPath(project.id, group.id));
    const membership = {
      object: "project.group",
      project_id: project.id,
      group_id: group.id,
      group_name: group.name,
      group_type: group.group_type || "group",
      created_at: existing?.created_at || nowSeconds(),
      role,
      compatibility: localCompatibility("project_group_protocol_compatibility", {
        locally_persisted: true,
        project_id: project.id,
        role_id_or_name: role,
      }),
    };
    this.writeJson(this.projectGroupPath(project.id, group.id), membership);
    this.recordAuditLog("project.group.created", {
      id: `project_group_${stableToken(`${project.id}:${group.id}`, 20)}`,
      project_id: project.id,
      data: {
        group_id: group.id,
        group_name: group.name,
        role,
      },
    }, {
      projectId: project.id,
      resourceIds: [project.id, group.id],
    });
    this.cleanup();
    return this.projectGroupProjection(membership);
  }

  listProjectGroups(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    return this.listJsonFiles(this.projectResourceDir(project.id, "groups"))
      .sort(compareCreatedThenIdAsc)
      .map((membership) => this.projectGroupProjection(membership));
  }

  getProjectGroup(projectId, groupId, options = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const groupType = optionalString(options.groupType);
    const membership = this.readJson(this.projectGroupPath(project.id, groupId));
    if (!membership) {
      throw organizationAdminError(`project group not found: ${groupId}`, {
        status: 404,
        code: "project_group_not_found",
        param: "group_id",
      });
    }
    if (groupType && membership.group_type !== groupType) {
      throw organizationAdminError(`project group not found for group_type: ${groupType}`, {
        status: 404,
        code: "project_group_not_found",
        param: "group_type",
      });
    }
    return this.projectGroupProjection(membership);
  }

  deleteProjectGroup(projectId, groupId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const membership = this.readJson(this.projectGroupPath(project.id, groupId));
    if (!membership) {
      throw organizationAdminError(`project group not found: ${groupId}`, {
        status: 404,
        code: "project_group_not_found",
        param: "group_id",
      });
    }
    try { fs.unlinkSync(this.projectGroupPath(project.id, groupId)); } catch {}
    this.recordAuditLog("project.group.deleted", {
      id: `project_group_${stableToken(`${project.id}:${groupId}`, 20)}`,
      project_id: project.id,
      data: {
        group_id: membership.group_id || groupId,
        group_name: membership.group_name ?? null,
      },
    }, {
      projectId: project.id,
      resourceIds: [project.id, groupId],
    });
    return {
      object: "project.group.deleted",
      deleted: true,
    };
  }

  getProjectDataRetention(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const existing = this.readJson(this.projectDataRetentionPath(project.id));
    if (existing) return this.dataRetentionProjection(existing, "project");
    return this.dataRetentionProjection({
      object: "project.data_retention",
      type: "organization_default",
      project_id: project.id,
      compatibility: localCompatibility("project_data_retention_protocol_compatibility", {
        locally_persisted: false,
        locally_defaulted: true,
        project_id: project.id,
      }),
    }, "project");
  }

  updateProjectDataRetention(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const type = this.normalizeDataRetentionType(body, PROJECT_DATA_RETENTION_TYPES, {
      code: "invalid_project_data_retention_type",
    });
    const record = {
      object: "project.data_retention",
      type,
      project_id: project.id,
      updated_at: nowSeconds(),
      compatibility: localCompatibility("project_data_retention_protocol_compatibility", {
        locally_persisted: true,
        last_lifecycle_action: "update",
        project_id: project.id,
      }),
    };
    this.writeJson(this.projectDataRetentionPath(project.id), record);
    this.recordAuditLog("data_retention.updated", {
      id: `project_data_retention_${stableToken(project.id, 20)}`,
      project_id: project.id,
      data: {
        type,
      },
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
    return this.dataRetentionProjection(record, "project");
  }

  getProjectModelPermissions(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const existing = this.readJson(this.projectModelPermissionsPath(project.id));
    if (existing) return this.projectModelPermissionsProjection(existing);
    return this.projectModelPermissionsProjection({
      object: "project.model_permissions",
      mode: "deny_list",
      model_ids: [],
      project_id: project.id,
      compatibility: localCompatibility("project_model_permissions_protocol_compatibility", {
        locally_persisted: false,
        locally_defaulted: true,
        project_id: project.id,
      }),
    });
  }

  updateProjectModelPermissions(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const request = isPlainObject(body) ? body : {};
    const mode = optionalString(request.mode);
    if (!mode) {
      throw organizationAdminError("mode is required", {
        code: "missing_required_parameter",
        param: "mode",
      });
    }
    if (!MODEL_PERMISSION_MODES.includes(mode)) {
      throw organizationAdminError("mode must be allow_list or deny_list", {
        code: "invalid_project_model_permissions_mode",
        param: "mode",
      });
    }
    if (!Array.isArray(request.model_ids)) {
      throw organizationAdminError("model_ids must be an array", {
        code: "invalid_project_model_permissions_model_ids",
        param: "model_ids",
      });
    }
    const modelIds = uniqueStrings(request.model_ids);
    const record = {
      object: "project.model_permissions",
      mode,
      model_ids: modelIds,
      project_id: project.id,
      updated_at: nowSeconds(),
      compatibility: localCompatibility("project_model_permissions_protocol_compatibility", {
        locally_persisted: true,
        last_lifecycle_action: "update",
        project_id: project.id,
      }),
    };
    this.writeJson(this.projectModelPermissionsPath(project.id), record);
    this.recordAuditLog("model_permissions.updated", {
      id: `project_model_permissions_${stableToken(project.id, 20)}`,
      project_id: project.id,
      data: {
        mode,
        model_ids: modelIds,
      },
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
    return this.projectModelPermissionsProjection(record);
  }

  deleteProjectModelPermissions(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    try { fs.unlinkSync(this.projectModelPermissionsPath(project.id)); } catch {}
    this.recordAuditLog("model_permissions.deleted", {
      id: `project_model_permissions_${stableToken(project.id, 20)}`,
      project_id: project.id,
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
    return {
      object: "project.model_permissions.deleted",
      deleted: true,
    };
  }

  getProjectHostedToolPermissions(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const existing = this.readJson(this.projectHostedToolPermissionsPath(project.id));
    if (existing) return this.projectHostedToolPermissionsProjection(existing);
    return this.projectHostedToolPermissionsProjection({
      project_id: project.id,
      permissions: this.defaultHostedToolPermissions(),
      compatibility: localCompatibility("project_hosted_tool_permissions_protocol_compatibility", {
        locally_persisted: false,
        locally_defaulted: true,
        project_id: project.id,
      }),
    });
  }

  updateProjectHostedToolPermissions(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const existing = this.readJson(this.projectHostedToolPermissionsPath(project.id));
    const permissions = isPlainObject(existing?.permissions)
      ? this.normalizeHostedToolPermissions(existing.permissions, { partial: true, base: this.defaultHostedToolPermissions() })
      : this.defaultHostedToolPermissions();
    const updates = this.normalizeHostedToolPermissions(body, { partial: true });
    for (const tool of HOSTED_TOOL_PERMISSION_TYPES) {
      if (updates[tool]) permissions[tool] = updates[tool];
    }
    const record = {
      project_id: project.id,
      permissions,
      updated_at: nowSeconds(),
      compatibility: localCompatibility("project_hosted_tool_permissions_protocol_compatibility", {
        locally_persisted: true,
        last_lifecycle_action: "update",
        project_id: project.id,
      }),
    };
    this.writeJson(this.projectHostedToolPermissionsPath(project.id), record);
    this.recordAuditLog("hosted_tool_permissions.updated", {
      id: `project_hosted_tool_permissions_${stableToken(project.id, 20)}`,
      project_id: project.id,
      data: {
        permissions,
      },
    }, {
      projectId: project.id,
      resourceId: project.id,
    });
    return this.projectHostedToolPermissionsProjection(record);
  }

  createProjectSpendAlert(projectId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const alert = this.spendAlertFromRequest(body, {
      object: "project.spend_alert",
      projectId: project.id,
      compatibilityReason: "project_spend_alert_protocol_compatibility",
    });
    this.writeJson(this.projectSpendAlertPath(project.id, alert.id), alert);
    this.recordAuditLog("spend_alert.created", {
      id: alert.id,
      project_id: project.id,
      data: this.spendAlertAuditData(alert),
    }, {
      projectId: project.id,
      resourceId: alert.id,
    });
    this.cleanup();
    return this.spendAlertProjection(alert);
  }

  updateProjectSpendAlert(projectId, alertId, body = {}) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const existing = this.readJson(this.projectSpendAlertPath(project.id, alertId));
    if (!existing) {
      throw organizationAdminError(`project spend alert not found: ${alertId}`, {
        status: 404,
        code: "project_spend_alert_not_found",
        param: "alert_id",
      });
    }
    const alert = this.spendAlertFromRequest(body, {
      id: existing.id,
      object: "project.spend_alert",
      projectId: project.id,
      compatibilityReason: "project_spend_alert_protocol_compatibility",
      createdAt: existing.created_at,
      lastLifecycleAction: "update",
    });
    this.writeJson(this.projectSpendAlertPath(project.id, alert.id), alert);
    this.recordAuditLog("spend_alert.updated", {
      id: alert.id,
      project_id: project.id,
      changes_requested: this.spendAlertAuditData(alert),
    }, {
      projectId: project.id,
      resourceId: alert.id,
    });
    return this.spendAlertProjection(alert);
  }

  listProjectSpendAlerts(projectId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    return this.listJsonFiles(this.projectResourceDir(project.id, "spend_alerts"))
      .sort(compareCreatedThenIdAsc)
      .map((alert) => this.spendAlertProjection(alert));
  }

  deleteProjectSpendAlert(projectId, alertId) {
    const project = this.getRequiredProject(projectId);
    this.assertProjectActive(project);
    const alert = this.readJson(this.projectSpendAlertPath(project.id, alertId));
    if (!alert) {
      throw organizationAdminError(`project spend alert not found: ${alertId}`, {
        status: 404,
        code: "project_spend_alert_not_found",
        param: "alert_id",
      });
    }
    try { fs.unlinkSync(this.projectSpendAlertPath(project.id, alert.id)); } catch {}
    this.recordAuditLog("spend_alert.deleted", {
      id: alert.id,
      project_id: project.id,
      data: this.spendAlertAuditData(alert),
    }, {
      projectId: project.id,
      resourceId: alert.id,
    });
    return {
      object: "project.spend_alert.deleted",
      id: alert.id,
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
    this.recordAuditLog("rate_limit.updated", {
      id: rateLimit.id,
      project_id: project.id,
      changes_requested: RATE_LIMIT_NUMERIC_FIELDS.reduce((changes, field) => {
        if (request[field] !== undefined && request[field] !== null) changes[field] = rateLimit[field];
        return changes;
      }, {}),
    }, {
      projectId: project.id,
      resourceId: rateLimit.id,
    });
    return clone(rateLimit);
  }

  normalizeDataRetentionType(body = {}, allowedTypes = [], options = {}) {
    const request = isPlainObject(body) ? body : {};
    const type = optionalString(request.retention_type);
    if (!type) {
      throw organizationAdminError("retention_type is required", {
        code: "missing_required_parameter",
        param: "retention_type",
      });
    }
    if (!allowedTypes.includes(type)) {
      throw organizationAdminError(`retention_type must be one of: ${allowedTypes.join(", ")}`, {
        code: options.code || "invalid_data_retention_type",
        param: "retention_type",
      });
    }
    return type;
  }

  dataRetentionProjection(record, scope) {
    return {
      object: scope === "project" ? "project.data_retention" : "organization.data_retention",
      type: record.type,
      compatibility: isPlainObject(record.compatibility) ? clone(record.compatibility) : undefined,
    };
  }

  projectModelPermissionsProjection(record) {
    return {
      object: "project.model_permissions",
      mode: MODEL_PERMISSION_MODES.includes(record.mode) ? record.mode : "deny_list",
      model_ids: uniqueStrings(record.model_ids),
      compatibility: isPlainObject(record.compatibility) ? clone(record.compatibility) : undefined,
    };
  }

  defaultHostedToolPermissions() {
    return HOSTED_TOOL_PERMISSION_TYPES.reduce((permissions, tool) => {
      permissions[tool] = { enabled: true };
      return permissions;
    }, {});
  }

  normalizeHostedToolPermissions(value = {}, options = {}) {
    const request = isPlainObject(value) ? value : {};
    const base = isPlainObject(options.base) ? clone(options.base) : {};
    const normalized = {};
    for (const tool of HOSTED_TOOL_PERMISSION_TYPES) {
      if (request[tool] === undefined) {
        if (!options.partial) normalized[tool] = { enabled: true };
        else if (base[tool]) normalized[tool] = this.normalizeHostedToolPermission(tool, base[tool]);
        continue;
      }
      if (request[tool] === null) {
        normalized[tool] = { enabled: true };
        continue;
      }
      normalized[tool] = this.normalizeHostedToolPermission(tool, request[tool]);
    }
    return normalized;
  }

  normalizeHostedToolPermission(tool, value) {
    if (!isPlainObject(value)) {
      throw organizationAdminError(`${tool} must be an object or null`, {
        code: "invalid_hosted_tool_permission",
        param: tool,
      });
    }
    if (typeof value.enabled !== "boolean") {
      throw organizationAdminError(`${tool}.enabled must be a boolean`, {
        code: "invalid_hosted_tool_permission",
        param: `${tool}.enabled`,
      });
    }
    return { enabled: value.enabled };
  }

  projectHostedToolPermissionsProjection(record) {
    const permissions = this.normalizeHostedToolPermissions(record.permissions, {
      partial: true,
      base: this.defaultHostedToolPermissions(),
    });
    return {
      ...permissions,
      compatibility: isPlainObject(record.compatibility) ? clone(record.compatibility) : undefined,
    };
  }

  updateServiceAccountApiKeyOwners(projectId, serviceAccount) {
    for (const apiKey of this.listJsonFiles(this.projectResourceDir(projectId, "api_keys"))) {
      if (apiKey.owner?.type !== "service_account") continue;
      if (apiKey.owner?.service_account?.id !== serviceAccount.id) continue;
      apiKey.owner.service_account = clone(serviceAccount);
      this.writeJson(this.apiKeyPath(projectId, apiKey.id), apiKey);
    }
  }

  getRequiredOrganizationRole(roleId) {
    const role = this.readJson(this.organizationRolePath(roleId));
    if (!role) {
      throw organizationAdminError(`organization role not found: ${roleId}`, {
        status: 404,
        code: "organization_role_not_found",
        param: "role_id",
      });
    }
    return role;
  }

  getRequiredOrganizationGroup(groupId) {
    const group = this.readJson(this.organizationGroupPath(groupId));
    if (!group) {
      throw organizationAdminError(`organization group not found: ${groupId}`, {
        status: 404,
        code: "organization_group_not_found",
        param: "group_id",
      });
    }
    return group;
  }

  getRequiredOrganizationUser(userId) {
    const user = this.readJson(this.organizationUserPath(userId));
    if (!user) {
      throw organizationAdminError(`organization user not found: ${userId}`, {
        status: 404,
        code: "organization_user_not_found",
        param: "user_id",
      });
    }
    return user;
  }

  normalizeRolePermissions(value) {
    if (!Array.isArray(value)) {
      throw organizationAdminError("permissions must be an array", {
        code: "invalid_role_permissions",
        param: "permissions",
      });
    }
    const permissions = Array.from(new Set(value.map((permission) => optionalString(permission)).filter(Boolean)));
    if (!permissions.length) {
      throw organizationAdminError("permissions must contain at least one permission", {
        code: "invalid_role_permissions",
        param: "permissions",
      });
    }
    return permissions;
  }

  requiredRoleId(body = {}) {
    const request = isPlainObject(body) ? body : {};
    const roleId = optionalString(request.role_id);
    if (!roleId) {
      throw organizationAdminError("role_id is required", {
        code: "missing_required_parameter",
        param: "role_id",
      });
    }
    return roleId;
  }

  organizationRoleProjection(role) {
    return {
      id: role.id,
      object: "role",
      name: role.name,
      description: role.description ?? null,
      permissions: Array.isArray(role.permissions) ? [...role.permissions] : [],
      predefined_role: role.predefined_role === true,
      resource_type: role.resource_type || "api.organization",
      compatibility: isPlainObject(role.compatibility) ? clone(role.compatibility) : undefined,
    };
  }

  organizationRoleAssignmentProjection(assignment) {
    const role = this.getRequiredOrganizationRole(assignment.role_id || assignment.id);
    return {
      id: role.id,
      assignment_sources: [{
        principal_id: assignment.principal_id,
        principal_type: assignment.principal_type,
      }],
      created_at: assignment.created_at ?? role.created_at ?? null,
      created_by: null,
      created_by_user_obj: null,
      description: role.description ?? null,
      metadata: null,
      name: role.name,
      permissions: Array.isArray(role.permissions) ? [...role.permissions] : [],
      predefined_role: role.predefined_role === true,
      resource_type: role.resource_type || "api.organization",
      updated_at: role.updated_at ?? null,
    };
  }

  organizationGroupUserProjection(userId) {
    const user = this.getRequiredOrganizationUser(userId);
    return {
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? "",
    };
  }

  organizationGroupUserDetail(userId) {
    const user = this.getRequiredOrganizationUser(userId);
    return {
      id: user.id,
      email: user.email ?? null,
      is_service_account: user.is_service_account ?? false,
      name: user.name ?? "",
      picture: user.user?.picture ?? null,
      user_type: "user",
    };
  }

  organizationGroupRoleSummary(group) {
    return {
      id: group.id,
      object: "group",
      name: group.name,
      created_at: group.created_at,
      scim_managed: group.is_scim_managed === true,
    };
  }

  projectGroupProjection(membership) {
    return {
      object: "project.group",
      project_id: membership.project_id,
      group_id: membership.group_id,
      group_name: membership.group_name ?? membership.group_id,
      group_type: membership.group_type || "group",
      created_at: membership.created_at ?? null,
      compatibility: isPlainObject(membership.compatibility) ? clone(membership.compatibility) : undefined,
    };
  }

  spendAlertFromRequest(body = {}, options = {}) {
    const request = isPlainObject(body) ? body : {};
    const thresholdAmount = this.requiredSpendAlertThresholdAmount(request.threshold_amount);
    const currency = optionalString(request.currency);
    if (!currency) {
      throw organizationAdminError("currency is required", {
        code: "missing_required_parameter",
        param: "currency",
      });
    }
    if (currency !== "USD") {
      throw organizationAdminError("currency must be USD", {
        code: "invalid_spend_alert_currency",
        param: "currency",
      });
    }
    const interval = optionalString(request.interval);
    if (!interval) {
      throw organizationAdminError("interval is required", {
        code: "missing_required_parameter",
        param: "interval",
      });
    }
    if (interval !== "month") {
      throw organizationAdminError("interval must be month", {
        code: "invalid_spend_alert_interval",
        param: "interval",
      });
    }
    const notificationChannel = this.normalizeSpendAlertNotificationChannel(request.notification_channel);
    return {
      id: options.id || `alert_${randomToken(14)}`,
      object: options.object,
      threshold_amount: thresholdAmount,
      currency,
      interval,
      notification_channel: notificationChannel,
      created_at: options.createdAt || nowSeconds(),
      ...(options.projectId ? { project_id: options.projectId } : {}),
      compatibility: localCompatibility(options.compatibilityReason || "spend_alert_protocol_compatibility", {
        locally_persisted: true,
        ...(options.projectId ? { project_id: options.projectId } : {}),
        ...(options.lastLifecycleAction ? { last_lifecycle_action: options.lastLifecycleAction } : {}),
      }),
    };
  }

  requiredSpendAlertThresholdAmount(value) {
    if (value === undefined || value === null || value === "") {
      throw organizationAdminError("threshold_amount is required", {
        code: "missing_required_parameter",
        param: "threshold_amount",
      });
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw organizationAdminError("threshold_amount must be a non-negative number of cents", {
        code: "invalid_spend_alert_threshold_amount",
        param: "threshold_amount",
      });
    }
    return Math.trunc(number);
  }

  normalizeSpendAlertNotificationChannel(value) {
    if (value === undefined || value === null) {
      throw organizationAdminError("notification_channel is required", {
        code: "missing_required_parameter",
        param: "notification_channel",
      });
    }
    if (!isPlainObject(value)) {
      throw organizationAdminError("notification_channel must be an object", {
        code: "invalid_spend_alert_notification_channel",
        param: "notification_channel",
      });
    }
    const type = optionalString(value.type);
    if (!type) {
      throw organizationAdminError("notification_channel.type is required", {
        code: "missing_required_parameter",
        param: "notification_channel.type",
      });
    }
    if (type !== "email") {
      throw organizationAdminError("notification_channel.type must be email", {
        code: "invalid_spend_alert_notification_channel",
        param: "notification_channel.type",
      });
    }
    if (!Array.isArray(value.recipients)) {
      throw organizationAdminError("notification_channel.recipients must be an array", {
        code: "invalid_spend_alert_notification_channel",
        param: "notification_channel.recipients",
      });
    }
    const recipients = uniqueStrings(value.recipients);
    if (!recipients.length) {
      throw organizationAdminError("notification_channel.recipients must contain at least one recipient", {
        code: "invalid_spend_alert_notification_channel",
        param: "notification_channel.recipients",
      });
    }
    const channel = {
      type: "email",
      recipients,
    };
    if (value.subject_prefix !== undefined) {
      channel.subject_prefix = optionalNullableString(value.subject_prefix);
    }
    return channel;
  }

  spendAlertProjection(alert) {
    return {
      id: alert.id,
      object: alert.object,
      threshold_amount: alert.threshold_amount,
      currency: alert.currency,
      interval: alert.interval,
      notification_channel: clone(alert.notification_channel),
      compatibility: isPlainObject(alert.compatibility) ? clone(alert.compatibility) : undefined,
    };
  }

  spendAlertAuditData(alert) {
    return {
      threshold_amount: alert.threshold_amount,
      currency: alert.currency,
      interval: alert.interval,
      notification_channel: {
        type: alert.notification_channel?.type ?? null,
        recipients: Array.isArray(alert.notification_channel?.recipients)
          ? [...alert.notification_channel.recipients]
          : [],
        ...(Object.prototype.hasOwnProperty.call(alert.notification_channel || {}, "subject_prefix")
          ? { subject_prefix: alert.notification_channel.subject_prefix ?? null }
          : {}),
      },
    };
  }

  localOrganizationAdminApiKeyOwner(createdAt = nowSeconds()) {
    return {
      type: "user",
      object: "organization.user",
      id: "user_local_organization_admin",
      name: "Local Organization Admin",
      created_at: createdAt,
      role: "owner",
    };
  }

  organizationAdminApiKeyProjection(apiKey) {
    return {
      id: apiKey.id,
      object: "organization.admin_api_key",
      name: apiKey.name ?? null,
      redacted_value: apiKey.redacted_value ?? `oc-local-admin-${String(apiKey.id || "").slice(-8)}...redacted`,
      created_at: apiKey.created_at ?? null,
      last_used_at: apiKey.last_used_at ?? null,
      owner: isPlainObject(apiKey.owner)
        ? clone(apiKey.owner)
        : this.localOrganizationAdminApiKeyOwner(apiKey.created_at),
      compatibility: isPlainObject(apiKey.compatibility) ? clone(apiKey.compatibility) : undefined,
    };
  }

  localAuditActor() {
    return {
      type: "api_key",
      api_key: {
        id: "local-organization-admin",
        type: "service_account",
        service_account: {
          id: "svc_acct_local_bridge",
        },
      },
    };
  }

  auditLogProjection(log) {
    const value = clone(log);
    for (const key of Object.keys(value)) {
      if (key.startsWith("_filter_")) delete value[key];
    }
    return value;
  }

  auditLogMatchesEffectiveAt(log, filter = {}) {
    const value = Number(log.effective_at || 0);
    if (Number.isFinite(Number(filter.gt)) && !(value > Number(filter.gt))) return false;
    if (Number.isFinite(Number(filter.gte)) && !(value >= Number(filter.gte))) return false;
    if (Number.isFinite(Number(filter.lt)) && !(value < Number(filter.lt))) return false;
    if (Number.isFinite(Number(filter.lte)) && !(value <= Number(filter.lte))) return false;
    return true;
  }

  auditLogProjectIds(log) {
    const details = isPlainObject(log?.[log.type]) ? log[log.type] : {};
    return uniqueStrings([
      log._filter_project_ids,
      details.project_id,
      String(log.type || "").startsWith("project.") ? details.id : null,
    ]);
  }

  auditLogResourceIds(log) {
    const details = isPlainObject(log?.[log.type]) ? log[log.type] : {};
    return uniqueStrings([
      log._filter_resource_ids,
      details.id,
      details.project_id,
    ]);
  }

  auditLogActorIds(log) {
    const actor = isPlainObject(log.actor) ? log.actor : {};
    return uniqueStrings([
      log._filter_actor_ids,
      actor.api_key?.id,
      actor.api_key?.user?.id,
      actor.api_key?.service_account?.id,
      actor.session?.user?.id,
    ]);
  }

  auditLogActorEmails(log) {
    const actor = isPlainObject(log.actor) ? log.actor : {};
    return uniqueStrings([
      log._filter_actor_emails,
      actor.api_key?.user?.email,
      actor.session?.user?.email,
    ]).map((email) => email.toLowerCase());
  }

  normalizeInviteProjects(projects) {
    if (projects === undefined) return [];
    if (!Array.isArray(projects)) {
      throw organizationAdminError("projects must be an array", {
        code: "invalid_invite_projects",
        param: "projects",
      });
    }
    return projects.map((project, index) => {
      if (!isPlainObject(project)) {
        throw organizationAdminError("invite project entries must be objects", {
          code: "invalid_invite_projects",
          param: `projects.${index}`,
        });
      }
      const id = optionalString(project.id);
      if (!id) {
        throw organizationAdminError("invite project id is required", {
          code: "missing_required_parameter",
          param: `projects.${index}.id`,
        });
      }
      const role = normalizeProjectRole(project.role, "");
      if (!role) {
        throw organizationAdminError("invite project role must be owner or member", {
          code: "invalid_project_role",
          param: `projects.${index}.role`,
        });
      }
      return { id, role };
    });
  }

  localOrganizationUserId(userId, email) {
    const requested = safeId(userId);
    if (requested) return requested;
    if (email) return `user_${stableToken(String(email).toLowerCase(), 20)}`;
    return `user_${randomToken(14)}`;
  }

  localProjectUserId(userId, email) {
    const requested = safeId(userId);
    if (requested) return requested;
    if (email) return `user_${stableToken(String(email).toLowerCase(), 20)}`;
    return `user_${randomToken(14)}`;
  }

  organizationUserProjection(user) {
    const value = clone(user);
    value.projects = {
      object: "list",
      data: this.organizationUserProjects(value.id),
    };
    value.user = {
      id: value.id,
      object: "user",
      banned: false,
      banned_at: null,
      email: value.email ?? null,
      enabled: true,
      name: value.name ?? null,
      picture: null,
    };
    return value;
  }

  organizationUserProjects(userId) {
    const projects = [];
    for (const project of this.listProjects({ includeArchived: true })) {
      const projectUser = this.readJson(this.projectUserPath(project.id, userId));
      if (!projectUser) continue;
      projects.push({
        id: project.id,
        name: project.name ?? null,
        role: projectUser.role ?? null,
      });
    }
    return projects.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
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
    for (const dir of [
      this.projectsDir(),
      this.organizationUsersDir(),
      this.organizationInvitesDir(),
      this.organizationRolesDir(),
      this.organizationGroupsDir(),
      this.organizationAdminApiKeysDir(),
      this.organizationSpendAlertsDir(),
      this.auditLogsDir(),
    ]) {
      const files = this.listCleanupEntries(dir);
      for (const entry of files.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
    for (const userRoleDir of this.listOrganizationUserRoleDirs()) {
      const files = this.listCleanupEntries(userRoleDir);
      for (const entry of files.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
    for (const groupDir of this.listOrganizationGroupResourceDirs()) {
      for (const resource of ["roles", "users"]) {
        const files = this.listCleanupEntries(path.join(groupDir, resource));
        for (const entry of files.slice(this.maxRecords)) {
          try { fs.unlinkSync(entry.filePath); } catch {}
        }
      }
    }
    for (const projectDir of this.listProjectResourceDirs()) {
      for (const resource of [
        "api_keys",
        "service_accounts",
        "users",
        "groups",
        "spend_alerts",
        "data_retention",
        "model_permissions",
        "hosted_tool_permissions",
        "rate_limits",
      ]) {
        const files = this.listCleanupEntries(path.join(projectDir, resource));
        for (const entry of files.slice(this.maxRecords)) {
          try { fs.unlinkSync(entry.filePath); } catch {}
        }
      }
    }
  }

  listOrganizationUserRoleDirs() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.organizationUserRolesDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.organizationUserRolesDir(), entry.name));
    } catch {
      return [];
    }
  }

  listOrganizationGroupResourceDirs() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.organizationGroupResourcesDir(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(this.organizationGroupResourcesDir(), entry.name));
    } catch {
      return [];
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

  removeDir(dir) {
    if (!dir) return;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
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
