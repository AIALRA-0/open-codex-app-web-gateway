"use strict";

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

function organizationUsageKinds() {
  return Object.keys(USAGE_RESULT_BUILDERS);
}

function createOrganizationUsagePage(kind, url) {
  const builder = USAGE_RESULT_BUILDERS[kind];
  if (!builder) {
    throw usageError(`Unsupported organization usage resource: ${kind}`, {
      status: 404,
      code: "organization_usage_resource_not_found",
      param: "resource",
    });
  }
  const bucketWidth = validateBucketWidth(url.searchParams.get("bucket_width") || "1d", ["1m", "1h", "1d"]);
  const { startTime, endTime, limit } = parseTimeRange(url, {
    bucketWidth,
    limits: USAGE_LIMITS[bucketWidth],
  });
  return pageResponse({
    startTime,
    endTime,
    bucketSeconds: BUCKET_WIDTH_SECONDS[bucketWidth],
    limit,
    resultBuilder: builder,
    compatibilityReason: "organization_usage_protocol_compatibility",
  });
}

function createOrganizationCostsPage(url) {
  const bucketWidth = validateBucketWidth(url.searchParams.get("bucket_width") || "1d", ["1d"]);
  const { startTime, endTime, limit } = parseTimeRange(url, {
    bucketWidth,
    limits: COST_LIMITS,
  });
  return pageResponse({
    startTime,
    endTime,
    bucketSeconds: BUCKET_WIDTH_SECONDS[bucketWidth],
    limit,
    resultBuilder: () => ({
      object: "organization.costs.result",
      amount: {
        value: 0,
        currency: "usd",
      },
      line_item: null,
      project_id: null,
      api_key_id: null,
      quantity: null,
    }),
    compatibilityReason: "organization_costs_protocol_compatibility",
  });
}

function pageResponse({ startTime, endTime, bucketSeconds, limit, resultBuilder, compatibilityReason }) {
  const data = [];
  let cursor = startTime;
  for (let index = 0; index < limit; index += 1) {
    if (endTime != null && cursor >= endTime) break;
    const next = Math.min(cursor + bucketSeconds, endTime || cursor + bucketSeconds);
    data.push({
      object: "bucket",
      start_time: cursor,
      end_time: next,
      results: [resultBuilder()],
    });
    cursor = next;
  }
  return {
    object: "page",
    data,
    has_more: false,
    next_page: null,
    compatibility: {
      provider: "local",
      reason: compatibilityReason,
      source: "zero_value_local_summary",
      actual_openai_admin_data: false,
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
  const limit = parseLimit(url.searchParams.get("limit"), limits.fallback, limits.max);
  return { startTime, endTime, bucketWidth, limit };
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

function parseLimit(value, fallback, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
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
  organizationUsageKinds,
};
