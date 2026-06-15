"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const USAGE_RESULT_BUILDERS = Object.freeze({
  completions: () => ({
    object: "organization.usage.completions.result",
    input_tokens: 0,
    output_tokens: 0,
    input_cached_tokens: 0,
    input_audio_tokens: 0,
    output_audio_tokens: 0,
    num_model_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
    batch: null,
    service_tier: null,
  }),
  embeddings: () => ({
    object: "organization.usage.embeddings.result",
    input_tokens: 0,
    num_model_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
  }),
  moderations: () => ({
    object: "organization.usage.moderations.result",
    input_tokens: 0,
    num_model_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
  }),
  images: () => ({
    object: "organization.usage.images.result",
    images: 0,
    num_model_requests: 0,
    size: null,
    source: null,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
  }),
  audio_speeches: () => ({
    object: "organization.usage.audio_speeches.result",
    characters: 0,
    num_model_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
  }),
  audio_transcriptions: () => ({
    object: "organization.usage.audio_transcriptions.result",
    seconds: 0,
    num_model_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
  }),
  vector_stores: () => ({
    object: "organization.usage.vector_stores.result",
    usage_bytes: 0,
    project_id: null,
  }),
  file_search_calls: () => ({
    object: "organization.usage.file_searches.result",
    num_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    vector_store_id: null,
  }),
  web_search_calls: () => ({
    object: "organization.usage.web_searches.result",
    num_model_requests: 0,
    num_requests: 0,
    project_id: null,
    user_id: null,
    api_key_id: null,
    model: null,
    context_level: null,
  }),
  code_interpreter_sessions: () => ({
    object: "organization.usage.code_interpreter_sessions.result",
    num_sessions: 0,
    project_id: null,
  }),
});

const USAGE_METRIC_FIELDS = Object.freeze({
  completions: ["input_tokens", "output_tokens", "input_cached_tokens", "input_audio_tokens", "output_audio_tokens", "num_model_requests"],
  embeddings: ["input_tokens", "num_model_requests"],
  moderations: ["input_tokens", "num_model_requests"],
  images: ["images", "num_model_requests"],
  audio_speeches: ["characters", "num_model_requests"],
  audio_transcriptions: ["seconds", "num_model_requests"],
  vector_stores: ["usage_bytes"],
  file_search_calls: ["num_requests"],
  web_search_calls: ["num_model_requests", "num_requests"],
  code_interpreter_sessions: ["num_sessions"],
});

const USAGE_GROUP_FIELDS = Object.freeze({
  completions: ["project_id", "user_id", "api_key_id", "model", "batch", "service_tier"],
  embeddings: ["project_id", "user_id", "api_key_id", "model"],
  moderations: ["project_id", "user_id", "api_key_id", "model"],
  images: ["project_id", "user_id", "api_key_id", "model", "size", "source"],
  audio_speeches: ["project_id", "user_id", "api_key_id", "model"],
  audio_transcriptions: ["project_id", "user_id", "api_key_id", "model"],
  vector_stores: ["project_id"],
  file_search_calls: ["project_id", "user_id", "api_key_id", "vector_store_id"],
  web_search_calls: ["project_id", "user_id", "api_key_id", "model", "context_level"],
  code_interpreter_sessions: ["project_id"],
});

const COST_GROUP_FIELDS = Object.freeze(["project_id", "line_item", "api_key_id"]);
const COST_LINE_ITEMS = Object.freeze({
  completions: "Completions",
  embeddings: "Embeddings",
  moderations: "Moderations",
  images: "Images",
  audio_speeches: "Audio speeches",
  audio_transcriptions: "Audio transcriptions",
  vector_stores: "Vector stores",
  file_search_calls: "File search calls",
  web_search_calls: "Web search calls",
  code_interpreter_sessions: "Code interpreter sessions",
});

const IMAGE_SOURCES = Object.freeze(["image.generation", "image.edit", "image.variation"]);
const IMAGE_SIZES = Object.freeze(["256x256", "512x512", "1024x1024", "1792x1792", "1024x1792"]);

const BUCKET_WIDTH_SECONDS = Object.freeze({
  "1m": 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
});

const USAGE_LIMITS = Object.freeze({
  "1m": { fallback: 60, max: 1440 },
  "1h": { fallback: 24, max: 168 },
  "1d": { fallback: 7, max: 31 },
});

const COST_LIMITS = Object.freeze({
  fallback: 7,
  max: 180,
});

class LocalOrganizationUsageStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-organization-usage"));
    this.maxRecords = normalizePositiveInt(options.maxRecords, 5000, 1, 100000);
    fs.mkdirSync(this.eventsDir(), { recursive: true, mode: 0o700 });
  }

  eventsDir() {
    return path.join(this.dir, "events");
  }

  eventPath(eventId) {
    const clean = safeId(eventId);
    if (!clean) return null;
    return path.join(this.eventsDir(), `${clean}.json`);
  }

  record(event = {}) {
    const normalized = normalizeUsageEvent(event);
    if (!normalized) return null;
    fs.writeFileSync(this.eventPath(normalized.id), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    this.cleanup();
    return normalized;
  }

  listEvents() {
    return listJsonFiles(this.eventsDir())
      .filter((event) => USAGE_RESULT_BUILDERS[event.kind])
      .sort((left, right) => Number(left.created_at || 0) - Number(right.created_at || 0) || String(left.id).localeCompare(String(right.id)));
  }

  cleanup() {
    const files = fs.readdirSync(this.eventsDir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const filePath = path.join(this.eventsDir(), entry.name);
        let stat = null;
        try {
          stat = fs.statSync(filePath);
        } catch {
          return null;
        }
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .filter(Boolean)
      .sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));
    for (const item of files.slice(this.maxRecords)) {
      try { fs.unlinkSync(item.filePath); } catch {}
    }
  }
}

function organizationUsageKinds() {
  return Object.keys(USAGE_RESULT_BUILDERS);
}

function createOrganizationUsagePage(kind, url, options = {}) {
  const builder = USAGE_RESULT_BUILDERS[kind];
  if (!builder) {
    throw usageError(`Unsupported organization usage resource: ${kind}`, {
      status: 404,
      code: "organization_usage_resource_not_found",
      param: "resource",
    });
  }
  const bucketWidth = validateBucketWidth(url.searchParams.get("bucket_width") || "1d", ["1m", "1h", "1d"]);
  const query = parseUsageQuery(kind, url, {
    bucketWidth,
    limits: USAGE_LIMITS[bucketWidth],
  });
  const events = eventsFromOptions(options).filter((event) => event.kind === kind);
  return pageResponse({
    query,
    bucketSeconds: BUCKET_WIDTH_SECONDS[bucketWidth],
    resultBuilder: () => builder(),
    resultFactory: (bucketStart, bucketEnd) => usageResultsForBucket(kind, events, query, bucketStart, bucketEnd),
    compatibilityReason: "organization_usage_protocol_compatibility",
    source: events.length ? "local_usage_ledger" : "zero_value_local_summary",
  });
}

function createOrganizationCostsPage(url, options = {}) {
  const bucketWidth = validateBucketWidth(url.searchParams.get("bucket_width") || "1d", ["1d"]);
  const query = parseCostsQuery(url, {
    bucketWidth,
    limits: COST_LIMITS,
  });
  const events = eventsFromOptions(options);
  return pageResponse({
    query,
    bucketSeconds: BUCKET_WIDTH_SECONDS[bucketWidth],
    resultBuilder: costResult,
    resultFactory: (bucketStart, bucketEnd) => costResultsForBucket(events, query, bucketStart, bucketEnd),
    compatibilityReason: "organization_costs_protocol_compatibility",
    source: events.length ? "local_usage_ledger_zero_cost" : "zero_value_local_summary",
  });
}

function pageResponse({ query, bucketSeconds, resultBuilder, resultFactory, compatibilityReason, source }) {
  const data = [];
  let cursor = query.pageStartTime ?? query.startTime;
  for (let index = 0; index < query.limit; index += 1) {
    if (query.endTime != null && cursor >= query.endTime) break;
    const next = Math.min(cursor + bucketSeconds, query.endTime || cursor + bucketSeconds);
    const results = resultFactory ? resultFactory(cursor, next) : [resultBuilder()];
    data.push({
      object: "bucket",
      start_time: cursor,
      end_time: next,
      results: Array.isArray(results) && results.length ? results : [resultBuilder()],
    });
    cursor = next;
  }
  const hasMore = query.endTime != null && cursor < query.endTime;
  return {
    object: "page",
    data,
    has_more: hasMore,
    next_page: hasMore ? encodePageCursor(cursor) : null,
    compatibility: {
      provider: "local",
      reason: compatibilityReason,
      source,
      actual_openai_admin_data: false,
      stores_sensitive_request_payloads: false,
    },
  };
}

function usageResultsForBucket(kind, events, query, bucketStart, bucketEnd) {
  const matching = events.filter((event) => event.created_at >= bucketStart && event.created_at < bucketEnd)
    .filter((event) => usageEventMatchesFilters(kind, event, query.filters));
  if (!matching.length) return [USAGE_RESULT_BUILDERS[kind]()];
  return aggregateEvents(kind, matching, query.groupBy, USAGE_RESULT_BUILDERS[kind], USAGE_METRIC_FIELDS[kind]);
}

function costResultsForBucket(events, query, bucketStart, bucketEnd) {
  const matching = events.filter((event) => event.created_at >= bucketStart && event.created_at < bucketEnd)
    .filter((event) => costEventMatchesFilters(event, query.filters));
  if (!matching.length) return [costResult()];
  return aggregateCostEvents(matching, query.groupBy);
}

function aggregateEvents(kind, events, groupBy, builder, metricFields) {
  const groups = new Map();
  const fields = Array.isArray(groupBy) ? groupBy : [];
  for (const event of events) {
    const values = fields.map((field) => dimensionValue(event, field));
    const key = JSON.stringify(values);
    if (!groups.has(key)) {
      const result = builder();
      fields.forEach((field, index) => {
        if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = values[index];
      });
      groups.set(key, { key, result });
    }
    const result = groups.get(key).result;
    for (const field of metricFields || []) {
      result[field] = numberResult(result[field]) + numberResult(event[field]);
    }
  }
  return Array.from(groups.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => entry.result);
}

function aggregateCostEvents(events, groupBy) {
  const groups = new Map();
  const fields = Array.isArray(groupBy) ? groupBy : [];
  for (const event of events) {
    const values = fields.map((field) => field === "line_item" ? lineItemForKind(event.kind) : dimensionValue(event, field));
    const key = JSON.stringify(values);
    if (!groups.has(key)) {
      const result = costResult();
      fields.forEach((field, index) => {
        if (Object.prototype.hasOwnProperty.call(result, field)) result[field] = values[index];
      });
      groups.set(key, { key, result });
    }
    const result = groups.get(key).result;
    if (fields.includes("line_item")) {
      result.quantity = numberResult(result.quantity) + costQuantityForEvent(event);
    }
  }
  return Array.from(groups.values())
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => entry.result);
}

function costResult() {
  return {
    object: "organization.costs.result",
    amount: {
      value: 0,
      currency: "usd",
    },
    line_item: null,
    project_id: null,
    api_key_id: null,
    quantity: null,
  };
}

function parseUsageQuery(kind, url, { bucketWidth, limits }) {
  const time = parseTimeRange(url, { bucketWidth, limits });
  const allowedGroupFields = USAGE_GROUP_FIELDS[kind] || [];
  const groupBy = parseGroupBy(url, allowedGroupFields);
  const filters = {
    project_ids: queryArray(url, "project_ids"),
    user_ids: queryArray(url, "user_ids"),
    api_key_ids: queryArray(url, "api_key_ids"),
    models: queryArray(url, "models"),
    batch: parseOptionalBoolean(url.searchParams.get("batch")),
    sources: validateEnumFilter(queryArray(url, "sources"), IMAGE_SOURCES, "sources"),
    sizes: validateEnumFilter(queryArray(url, "sizes"), IMAGE_SIZES, "sizes"),
  };
  return { ...time, groupBy, filters };
}

function parseCostsQuery(url, { bucketWidth, limits }) {
  const time = parseTimeRange(url, { bucketWidth, limits });
  return {
    ...time,
    groupBy: parseGroupBy(url, COST_GROUP_FIELDS),
    filters: {
      project_ids: queryArray(url, "project_ids"),
      api_key_ids: queryArray(url, "api_key_ids"),
    },
  };
}

function parseTimeRange(url, { bucketWidth, limits }) {
  const startTime = parseUnixTime(url.searchParams.get("start_time"), "start_time", true);
  const endTime = parseUnixTime(url.searchParams.get("end_time"), "end_time", false);
  if (endTime != null && endTime <= startTime) {
    throw usageError("end_time must be greater than start_time", {
      code: "invalid_time_range",
      param: "end_time",
    });
  }
  const pageStartTime = parsePageCursor(url.searchParams.get("page"), startTime, endTime);
  const limit = parseLimit(url.searchParams.get("limit"), limits.fallback, limits.max);
  return { startTime, pageStartTime, endTime, bucketWidth, limit };
}

function parseGroupBy(url, allowed) {
  const values = uniqueStrings(queryArray(url, "group_by"));
  const invalid = values.find((value) => !allowed.includes(value));
  if (invalid) {
    throw usageError(`group_by does not support ${invalid}`, {
      code: "invalid_group_by",
      param: "group_by",
    });
  }
  return values;
}

function queryArray(url, name) {
  const values = [
    ...url.searchParams.getAll(name),
    ...url.searchParams.getAll(`${name}[]`),
  ];
  return uniqueStrings(values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean));
}

function validateEnumFilter(values, allowed, param) {
  const invalid = (values || []).find((value) => !allowed.includes(value));
  if (invalid) {
    throw usageError(`${param} does not support ${invalid}`, {
      code: "invalid_usage_filter",
      param,
    });
  }
  return values;
}

function validateBucketWidth(value, allowed) {
  const normalized = String(value || "").trim();
  if (!allowed.includes(normalized)) {
    throw usageError(`bucket_width must be one of: ${allowed.join(", ")}`, {
      code: "invalid_bucket_width",
      param: "bucket_width",
    });
  }
  return normalized;
}

function parseOptionalBoolean(value) {
  if (value == null || value === "") return null;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw usageError("batch must be a boolean", {
    code: "invalid_usage_filter",
    param: "batch",
  });
}

function parseUnixTime(value, param, required) {
  if (value == null || value === "") {
    if (!required) return null;
    throw usageError(`${param} is required`, {
      code: "missing_required_parameter",
      param,
    });
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw usageError(`${param} must be a non-negative Unix timestamp`, {
      code: "invalid_time_parameter",
      param,
    });
  }
  return Math.trunc(parsed);
}

function parsePageCursor(value, startTime, endTime) {
  if (value == null || value === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const cursor = Number(parsed.start_time);
    if (!Number.isFinite(cursor) || cursor < startTime || (endTime != null && cursor > endTime)) {
      throw new Error("invalid cursor");
    }
    return Math.trunc(cursor);
  } catch {
    throw usageError("page cursor is invalid", {
      code: "invalid_page",
      param: "page",
    });
  }
}

function encodePageCursor(startTime) {
  return Buffer.from(JSON.stringify({ start_time: Math.trunc(Number(startTime || 0)) }), "utf8").toString("base64url");
}

function parseLimit(value, fallback, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}

function usageEventMatchesFilters(kind, event, filters = {}) {
  return matchesListFilter(event.project_id, filters.project_ids)
    && matchesListFilter(event.user_id, filters.user_ids)
    && matchesListFilter(event.api_key_id, filters.api_key_ids)
    && matchesListFilter(event.model, filters.models)
    && (filters.batch == null || !!event.batch === filters.batch)
    && (kind !== "images" || (
      matchesListFilter(event.source, filters.sources)
      && matchesListFilter(event.size, filters.sizes)
    ));
}

function costEventMatchesFilters(event, filters = {}) {
  return matchesListFilter(event.project_id, filters.project_ids)
    && matchesListFilter(event.api_key_id, filters.api_key_ids);
}

function matchesListFilter(value, values = []) {
  if (!values || !values.length) return true;
  return values.includes(value);
}

function dimensionValue(event, field) {
  if (field === "batch") return typeof event.batch === "boolean" ? event.batch : null;
  return event[field] ?? null;
}

function lineItemForKind(kind) {
  return COST_LINE_ITEMS[kind] || kind || null;
}

function costQuantityForEvent(event) {
  if (!event || !event.kind) return 0;
  if (event.kind === "completions") return numberResult(event.input_tokens) + numberResult(event.output_tokens);
  if (event.kind === "embeddings") return numberResult(event.input_tokens);
  if (event.kind === "moderations") return numberResult(event.input_tokens);
  if (event.kind === "images") return numberResult(event.images);
  if (event.kind === "audio_speeches") return numberResult(event.characters);
  if (event.kind === "audio_transcriptions") return numberResult(event.seconds);
  if (event.kind === "vector_stores") return numberResult(event.usage_bytes);
  if (event.kind === "file_search_calls") return numberResult(event.num_requests);
  if (event.kind === "web_search_calls") return numberResult(event.num_requests);
  if (event.kind === "code_interpreter_sessions") return numberResult(event.num_sessions);
  return 0;
}

function normalizeUsageEvent(event = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const kind = String(event.kind || "").trim();
  const builder = USAGE_RESULT_BUILDERS[kind];
  if (!builder) return null;
  const fallback = builder();
  const now = nowSeconds();
  const createdAt = numberResult(event.created_at || event.created || now);
  const normalized = {
    object: "organization.usage.local_event",
    id: safeId(event.id) || `usage_${Math.trunc(createdAt)}_${randomToken(10)}`,
    kind,
    created_at: Math.trunc(createdAt || now),
    endpoint: sanitizeDimension(event.endpoint),
    project_id: sanitizeDimension(event.project_id),
    user_id: sanitizeDimension(event.user_id),
    api_key_id: sanitizeDimension(event.api_key_id),
    model: sanitizeDimension(event.model),
    batch: typeof event.batch === "boolean" ? event.batch : null,
    service_tier: sanitizeDimension(event.service_tier),
    size: sanitizeDimension(event.size),
    source: sanitizeDimension(event.source),
    context_level: sanitizeDimension(event.context_level),
    vector_store_id: sanitizeDimension(event.vector_store_id),
  };
  for (const field of USAGE_METRIC_FIELDS[kind] || []) {
    normalized[field] = numberResult(event[field] ?? fallback[field]);
  }
  normalized.line_item = lineItemForKind(kind);
  return normalized;
}

function eventsFromOptions(options = {}) {
  if (Array.isArray(options.events)) return options.events.map(normalizeUsageEvent).filter(Boolean);
  if (options.store && typeof options.store.listEvents === "function") return options.store.listEvents();
  return [];
}

function listJsonFiles(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function sanitizeDimension(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(/[\r\n\t]/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 256);
}

function numberResult(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(6));
}

function normalizePositiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function safeId(value) {
  const raw = String(value || "");
  return /^[A-Za-z0-9_.:-]+$/.test(raw) ? raw.slice(0, 160) : "";
}

function randomToken(bytes = 12) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function usageError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 400;
  error.code = details.code || "invalid_request_error";
  error.type = details.type || "invalid_request_error";
  error.param = details.param || null;
  return error;
}

module.exports = {
  createOrganizationCostsPage,
  createOrganizationUsagePage,
  LocalOrganizationUsageStore,
  organizationUsageKinds,
};
