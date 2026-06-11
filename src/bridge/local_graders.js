"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  inputItemToChatMessages,
  stringifyContent,
} = require("./translator");

const PYTHON_GRADER_MAX_SOURCE_BYTES = 256 * 1024;
const PYTHON_GRADER_DEFAULT_TIMEOUT_MS = 120 * 1000;
const PYTHON_GRADER_DEFAULT_DISK_BYTES = 1024 * 1024 * 1024;
const PYTHON_GRADER_DEFAULT_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const PYTHON_GRADER_OUTPUT_LIMIT = 8192;
const SUPPORTED_GRADER_TYPES = Object.freeze(["string_check", "text_similarity", "score_model", "python", "multi"]);
const TEXT_SIMILARITY_METRICS = new Set([
  "fuzzy_match",
  "bleu",
  "gleu",
  "meteor",
  "cosine",
  "rouge_1",
  "rouge_2",
  "rouge_3",
  "rouge_4",
  "rouge_5",
  "rouge_l",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateGrader(grader, options = {}) {
  if (!isPlainObject(grader)) {
    throw graderError("grader must be a JSON object", {
      code: "invalid_grader",
      param: "grader",
    });
  }
  const type = String(grader.type || "string_check");
  if (type === "string_check") validateStringCheckGrader(grader, options);
  else if (type === "text_similarity") validateTextSimilarityGrader(grader, options);
  else if (type === "score_model") validateScoreModelGrader(grader, options);
  else if (type === "python") validatePythonGrader(grader, options);
  else if (type === "multi") validateMultiGrader(grader, options);
  else {
    throw graderError(`unsupported local grader type: ${type}`, {
      code: "unsupported_grader_type",
      param: "grader.type",
    });
  }
  return clone(grader);
}

function runGrader(grader, context = {}) {
  const started = Date.now();
  const result = evaluateGrader(grader, context);
  return graderRunResponse(grader, result, started);
}

async function runGraderAsync(grader, context = {}) {
  const started = Date.now();
  const result = await evaluateGraderAsync(grader, context);
  return graderRunResponse(grader, result, started);
}

function graderRunResponse(grader, result, started) {
  const reward = finiteNumber(result.reward ?? result.score, 0);
  const tokenUsage = normalizeTokenUsage(result.token_usage);
  const modelUsage = normalizeModelUsageMap(result.model_grader_token_usage_per_model);
  return {
    reward,
    metadata: {
      name: result.name || grader?.name || result.type || "grader",
      type: result.type || grader?.type || "string_check",
      errors: graderErrorFlags(result),
      execution_time: Math.max(0, (Date.now() - started) / 1000),
      scores: result.sub_rewards || {},
      token_usage: tokenUsage,
      sampled_model_name: result.sampled_model_name || null,
      compatibility: {
        provider: result.compatibility_provider || (tokenUsage.total_tokens > 0 ? "provider_chat" : "local"),
        supported_grader_types: SUPPORTED_GRADER_TYPES,
        reason: result.compatibility_reason || "local_grader_protocol_compatibility",
        ...(result.model_grader_output_text ? { model_grader_output_text: result.model_grader_output_text } : {}),
        ...(result.python_grader_details ? { python_grader: result.python_grader_details } : {}),
      },
    },
    sub_rewards: result.sub_rewards || {},
    model_grader_token_usage_per_model: modelUsage,
  };
}

function evaluateGrader(grader, context = {}) {
  if (!isPlainObject(grader)) {
    return errorGraderResult(grader, "invalid_grader", "grader must be a JSON object");
  }
  const type = String(grader.type || "string_check");
  try {
    if (type === "string_check") return evaluateStringCheck(grader, context);
    if (type === "text_similarity") return evaluateTextSimilarity(grader, context);
    if (type === "python") {
      return errorGraderResult(
        grader,
        "python_grader_runner_missing",
        "python graders require an async local python runner",
      );
    }
    if (type === "score_model") {
      return errorGraderResult(
        grader,
        "model_grader_runner_missing",
        "score_model graders require an async model grader runner",
      );
    }
    if (type === "multi") return evaluateMultiGrader(grader, context);
    return errorGraderResult(
      grader,
      "unsupported_eval_grader",
      `local grader compatibility supports ${SUPPORTED_GRADER_TYPES.join(", ")}, not ${type}`,
    );
  } catch (error) {
    return errorGraderResult(grader, error.code || "local_grader_error", error.message || "local grader failed", error.param || null);
  }
}

async function evaluateGraderAsync(grader, context = {}) {
  if (!isPlainObject(grader)) {
    return errorGraderResult(grader, "invalid_grader", "grader must be a JSON object");
  }
  const type = String(grader.type || "string_check");
  try {
    if (type === "python") return await evaluatePythonGrader(grader, context);
    if (type === "score_model") return await evaluateScoreModelGrader(grader, context);
    if (type === "multi") return await evaluateMultiGraderAsync(grader, context);
    return evaluateGrader(grader, context);
  } catch (error) {
    return errorGraderResult(grader, error.code || "local_grader_error", error.message || "local grader failed", error.param || null);
  }
}

function errorGraderResult(grader, code, message, param = null) {
  const type = isPlainObject(grader) ? String(grader.type || "string_check") : "invalid";
  return {
    id: isPlainObject(grader) ? grader.id || grader.name || type : "invalid_grader",
    name: isPlainObject(grader) ? grader.name || type : "invalid_grader",
    type,
    status: "errored",
    passed: false,
    score: 0,
    error: { code, message, param },
  };
}

function validateStringCheckGrader(grader) {
  if (!("input" in grader)) {
    throw graderError("string_check grader input is required", {
      code: "missing_required_parameter",
      param: "grader.input",
    });
  }
  if (!("reference" in grader)) {
    throw graderError("string_check grader reference is required", {
      code: "missing_required_parameter",
      param: "grader.reference",
    });
  }
}

function evaluateStringCheck(grader, context) {
  validateStringCheckGrader(grader);
  const operation = String(grader.operation || "eq").toLowerCase();
  const rawInput = renderTemplateValue(grader.input, context);
  const rawReference = renderTemplateValue(grader.reference ?? grader.expected ?? "", context);
  const input = stringifyContent(rawInput);
  const reference = stringifyContent(rawReference);
  const passed = compareStringCheck(input, reference, operation, grader);
  const score = passed ? 1 : 0;
  return {
    id: grader.id || grader.name || "string_check",
    name: grader.name || "string_check",
    type: "string_check",
    status: passed ? "passed" : "failed",
    passed,
    score,
    input,
    reference,
    operation,
  };
}

function compareStringCheck(input, reference, operation, grader = {}) {
  if (operation === "ilike") return input.toLowerCase().includes(reference.toLowerCase());
  const caseSensitive = grader.case_sensitive !== false && grader.ignore_case !== true;
  const left = caseSensitive ? input : input.toLowerCase();
  const right = caseSensitive ? reference : reference.toLowerCase();
  if (operation === "eq" || operation === "equals") return left === right;
  if (operation === "neq" || operation === "ne" || operation === "not_eq" || operation === "not_equals") return left !== right;
  if (operation === "like" || operation === "contains") return left.includes(right);
  if (operation === "not_contains") return !left.includes(right);
  if (operation === "starts_with") return left.startsWith(right);
  if (operation === "ends_with") return left.endsWith(right);
  if (operation === "regex") {
    try {
      return new RegExp(reference, caseSensitive ? "" : "i").test(input);
    } catch {
      return false;
    }
  }
  return false;
}

function validateTextSimilarityGrader(grader) {
  if (!("input" in grader)) {
    throw graderError("text_similarity grader input is required", {
      code: "missing_required_parameter",
      param: "grader.input",
    });
  }
  if (!("reference" in grader)) {
    throw graderError("text_similarity grader reference is required", {
      code: "missing_required_parameter",
      param: "grader.reference",
    });
  }
  const metric = String(grader.evaluation_metric || "fuzzy_match").toLowerCase();
  if (!TEXT_SIMILARITY_METRICS.has(metric)) {
    throw graderError(`unsupported text_similarity metric: ${metric}`, {
      code: "unsupported_grader_metric",
      param: "grader.evaluation_metric",
    });
  }
}

function evaluateTextSimilarity(grader, context) {
  validateTextSimilarityGrader(grader);
  const metric = String(grader.evaluation_metric || "fuzzy_match").toLowerCase();
  const input = stringifyContent(renderTemplateValue(grader.input, context));
  const reference = stringifyContent(renderTemplateValue(grader.reference, context));
  const score = textSimilarityScore(input, reference, metric);
  const threshold = finiteNumber(grader.pass_threshold, 0.5);
  const passed = score >= threshold;
  return {
    id: grader.id || grader.name || "text_similarity",
    name: grader.name || "text_similarity",
    type: "text_similarity",
    status: passed ? "passed" : "failed",
    passed,
    score,
    input,
    reference,
    evaluation_metric: metric,
    pass_threshold: threshold,
  };
}

function validateScoreModelGrader(grader) {
  if (!Array.isArray(grader.input) || !grader.input.length) {
    throw graderError("score_model grader input must be a non-empty message array", {
      code: "missing_required_parameter",
      param: "grader.input",
    });
  }
  if (grader.model == null || String(grader.model).trim() === "") {
    throw graderError("score_model grader model is required", {
      code: "missing_required_parameter",
      param: "grader.model",
    });
  }
  for (let index = 0; index < grader.input.length; index += 1) {
    const message = grader.input[index];
    if (!isPlainObject(message)) {
      throw graderError("score_model grader input messages must be objects", {
        code: "invalid_grader",
        param: `grader.input.${index}`,
      });
    }
    const role = String(message.role || "user");
    if (!["system", "developer", "user", "assistant"].includes(role)) {
      throw graderError("score_model grader input message role is invalid", {
        code: "invalid_grader",
        param: `grader.input.${index}.role`,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(message, "content")) {
      throw graderError("score_model grader input message content is required", {
        code: "missing_required_parameter",
        param: `grader.input.${index}.content`,
      });
    }
  }
  normalizeScoreModelRange(grader.range);
  if (grader.sampling_params != null && !isPlainObject(grader.sampling_params)) {
    throw graderError("score_model grader sampling_params must be an object", {
      code: "invalid_grader",
      param: "grader.sampling_params",
    });
  }
}

async function evaluateScoreModelGrader(grader, context) {
  validateScoreModelGrader(grader);
  if (typeof context.scoreModelRunner !== "function") {
    return errorGraderResult(
      grader,
      "model_grader_runner_missing",
      "score_model graders require a model grader runner",
    );
  }

  const range = normalizeScoreModelRange(grader.range);
  const messages = normalizeScoreModelMessages(renderTemplateValue(grader.input, context));
  const threshold = finiteNumber(grader.pass_threshold, 0.5);
  let runnerResult;
  try {
    runnerResult = await context.scoreModelRunner({
      grader: clone(grader),
      messages,
      model: stringifyContent(grader.model),
      range,
      sampling_params: isPlainObject(grader.sampling_params) ? clone(grader.sampling_params) : {},
    });
  } catch (error) {
    return {
      id: grader.id || grader.name || "score_model",
      name: grader.name || "score_model",
      type: "score_model",
      status: "errored",
      passed: false,
      score: 0,
      range,
      pass_threshold: threshold,
      token_usage: normalizeTokenUsage(error.token_usage),
      sampled_model_name: error.sampled_model_name || stringifyContent(grader.model),
      model_grader_token_usage_per_model: normalizeModelUsageMap(error.model_grader_token_usage_per_model),
      compatibility_provider: "provider_chat",
      compatibility_reason: "score_model_provider_error",
      error: {
        code: error.code || "model_grader_server_error",
        message: error.message || "score_model provider call failed",
        param: error.param || null,
      },
    };
  }

  const usage = normalizeTokenUsage(runnerResult?.token_usage);
  const sampledModelName = runnerResult?.sampled_model_name || runnerResult?.model || stringifyContent(grader.model);
  const rawScore = Number(runnerResult?.score);
  const parseFailed = !Number.isFinite(rawScore);
  const score = parseFailed ? 0 : clampToRange(rawScore, range);
  const passed = !parseFailed && score >= threshold;
  return {
    id: grader.id || grader.name || "score_model",
    name: grader.name || "score_model",
    type: "score_model",
    status: passed ? "passed" : "failed",
    passed,
    score,
    raw_score: parseFailed ? null : rawScore,
    range,
    pass_threshold: threshold,
    token_usage: usage,
    sampled_model_name: sampledModelName,
    model_grader_token_usage_per_model: usage.total_tokens > 0 ? { [sampledModelName]: usage } : {},
    compatibility_provider: "provider_chat",
    compatibility_reason: "score_model_chat_completion_compatibility",
    model_grader_output_text: runnerResult?.output_text || "",
    ...(parseFailed ? {
      error: {
        code: "model_grader_parse_error",
        message: "score_model grader output did not contain a numeric result; defaulted to 0",
        param: null,
      },
    } : {}),
  };
}

function normalizeScoreModelMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .flatMap((message) => inputItemToChatMessages(message))
    .filter((message) => isPlainObject(message) && message.content != null);
}

function normalizeScoreModelRange(range) {
  if (range == null) return [0, 1];
  if (!Array.isArray(range) || range.length !== 2) {
    throw graderError("score_model grader range must contain exactly two numbers", {
      code: "invalid_grader",
      param: "grader.range",
    });
  }
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw graderError("score_model grader range must be finite and ascending", {
      code: "invalid_grader",
      param: "grader.range",
    });
  }
  return [min, max];
}

function clampToRange(value, range) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const [min, max] = normalizeScoreModelRange(range);
  return Math.max(min, Math.min(max, number));
}

function validatePythonGrader(grader, options = {}) {
  const pythonOptions = normalizePythonGraderOptions(options.pythonGraderOptions || options);
  if (typeof grader.source !== "string" || !grader.source.trim()) {
    throw graderError("python grader source is required", {
      code: "missing_required_parameter",
      param: "grader.source",
    });
  }
  if (Buffer.byteLength(grader.source, "utf8") > pythonOptions.maxSourceBytes) {
    throw graderError(`python grader source exceeds local limit of ${pythonOptions.maxSourceBytes} bytes`, {
      code: "invalid_grader",
      param: "grader.source",
    });
  }
  if (grader.image_tag != null && typeof grader.image_tag !== "string") {
    throw graderError("python grader image_tag must be a string", {
      code: "invalid_grader",
      param: "grader.image_tag",
    });
  }
}

async function evaluatePythonGrader(grader, context = {}) {
  const pythonOptions = normalizePythonGraderOptions(context.pythonGraderOptions || {});
  validatePythonGrader(grader, { pythonGraderOptions: pythonOptions });
  if (pythonOptions.provider === "disabled") {
    return {
      id: grader.id || grader.name || "python",
      name: grader.name || "python",
      type: "python",
      status: "errored",
      passed: false,
      score: 0,
      error: {
        code: "python_grader_server_error",
        message: "local python grader provider is disabled",
        param: "grader.type",
        server_error_type: "disabled",
      },
      compatibility_provider: "disabled",
      compatibility_reason: "python_grader_disabled",
      python_grader_details: pythonGraderAuditDetails(grader, pythonOptions),
    };
  }

  const runner = typeof context.pythonGraderRunner === "function"
    ? context.pythonGraderRunner
    : runLocalPythonGrader;
  const sample = isPlainObject(context.sample) ? sampleFromObject(context.sample) : sampleFromObject({});
  const item = isPlainObject(context.item) ? clone(context.item) : {};
  const threshold = finiteNumber(grader.pass_threshold, 0.5);
  try {
    const result = await runner({
      grader: clone(grader),
      source: String(grader.source || ""),
      sample,
      item,
      image_tag: grader.image_tag || "2025-05-08",
      options: pythonOptions,
    });
    const score = clampScore(result.score);
    const passed = score >= threshold;
    return {
      id: grader.id || grader.name || "python",
      name: grader.name || "python",
      type: "python",
      status: passed ? "passed" : "failed",
      passed,
      score,
      pass_threshold: threshold,
      compatibility_provider: "local_python",
      compatibility_reason: "python_grader_local_sandbox_compatibility",
      python_grader_details: {
        ...pythonGraderAuditDetails(grader, pythonOptions),
        execution_ms: Number(result.execution_ms || 0),
        sandbox: result.sandbox || "python_subprocess_isolated_env",
      },
    };
  } catch (error) {
    return {
      id: grader.id || grader.name || "python",
      name: grader.name || "python",
      type: "python",
      status: "errored",
      passed: false,
      score: 0,
      pass_threshold: threshold,
      compatibility_provider: "local_python",
      compatibility_reason: "python_grader_local_runtime_error",
      python_grader_details: {
        ...pythonGraderAuditDetails(grader, pythonOptions),
        execution_ms: Number(error.execution_ms || 0),
        sandbox: "python_subprocess_isolated_env",
      },
      error: {
        code: error.code || "python_grader_runtime_error",
        message: error.message || "python grader failed",
        param: error.param || null,
        runtime_error_type: error.runtime_error_type || null,
        runtime_error_details: error.runtime_error_details || null,
        server_error_type: error.server_error_type || null,
      },
    };
  }
}

function pythonGraderAuditDetails(grader, options) {
  return {
    image_tag: grader.image_tag || "2025-05-08",
    source_bytes: Buffer.byteLength(String(grader.source || ""), "utf8"),
    source_sha256: crypto.createHash("sha256").update(String(grader.source || "")).digest("hex"),
    timeout_ms: options.timeoutMs,
    max_source_bytes: options.maxSourceBytes,
    disk_bytes: options.diskBytes,
    memory_bytes: options.memoryBytes,
    network: "blocked_by_local_runner",
  };
}

function normalizePythonGraderOptions(options = {}) {
  const stateDir = path.resolve(
    options.stateDir
    || process.env.CODEXCOMPAT_PYTHON_GRADER_STATE_DIR
    || path.join(os.tmpdir(), "open-codex-python-graders"),
  );
  return {
    provider: String(options.provider || process.env.CODEXCOMPAT_PYTHON_GRADER_PROVIDER || "local").toLowerCase(),
    pythonBin: String(options.pythonBin || process.env.CODEXCOMPAT_PYTHON_GRADER_BIN || "python3"),
    stateDir,
    timeoutMs: boundedNumber(options.timeoutMs, PYTHON_GRADER_DEFAULT_TIMEOUT_MS, 1000, PYTHON_GRADER_DEFAULT_TIMEOUT_MS),
    maxSourceBytes: boundedNumber(options.maxSourceBytes, PYTHON_GRADER_MAX_SOURCE_BYTES, 1, PYTHON_GRADER_MAX_SOURCE_BYTES),
    diskBytes: boundedNumber(options.diskBytes, PYTHON_GRADER_DEFAULT_DISK_BYTES, 1024 * 1024, PYTHON_GRADER_DEFAULT_DISK_BYTES),
    memoryBytes: boundedNumber(options.memoryBytes, PYTHON_GRADER_DEFAULT_MEMORY_BYTES, 64 * 1024 * 1024, PYTHON_GRADER_DEFAULT_MEMORY_BYTES),
  };
}

async function runLocalPythonGrader({ source, sample, item, image_tag: imageTag, options }) {
  const started = Date.now();
  fs.mkdirSync(options.stateDir, { recursive: true, mode: 0o700 });
  const workDir = fs.mkdtempSync(path.join(options.stateDir, "pygrader-"));
  const payload = JSON.stringify({
    source,
    sample,
    item,
    image_tag: imageTag,
    limits: {
      timeout_ms: options.timeoutMs,
      disk_bytes: options.diskBytes,
      memory_bytes: options.memoryBytes,
    },
  });
  try {
    const result = await spawnPythonGrader(options.pythonBin, payload, workDir, options.timeoutMs);
    if (!result.ok) {
      const error = new Error(result.message || "python grader runtime error");
      error.code = result.code || "python_grader_runtime_error";
      error.runtime_error_type = result.error_type || null;
      error.runtime_error_details = result.details || result.message || null;
      error.execution_ms = Date.now() - started;
      throw error;
    }
    return {
      score: result.score,
      execution_ms: Date.now() - started,
      sandbox: "python_subprocess_isolated_env",
    };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; audit metadata still keeps the run bounded.
    }
  }
}

function spawnPythonGrader(pythonBin, payload, workDir, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(pythonBin, ["-I", "-c", PYTHON_GRADER_RUNNER], {
      cwd: workDir,
      env: {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish(() => {
        const error = new Error(`python grader timed out after ${timeoutMs}ms`);
        error.code = "python_grader_runtime_error";
        error.runtime_error_type = "TimeoutError";
        error.runtime_error_details = `timeout_ms=${timeoutMs}`;
        reject(error);
      });
    }, timeoutMs);

    child.on("error", (error) => {
      finish(() => {
        const wrapped = new Error(error.message || "failed to start python grader");
        wrapped.code = "python_grader_server_error";
        wrapped.server_error_type = error.code || "spawn_error";
        reject(wrapped);
      });
    });
    child.stdout.on("data", (chunk) => {
      stdout = capString(stdout + chunk.toString("utf8"), PYTHON_GRADER_OUTPUT_LIMIT * 2);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capString(stderr + chunk.toString("utf8"), PYTHON_GRADER_OUTPUT_LIMIT * 2);
    });
    child.on("close", (code, signal) => {
      finish(() => {
        if (code !== 0) {
          const error = new Error(`python grader exited with code ${code}${signal ? ` signal ${signal}` : ""}`);
          error.code = "python_grader_runtime_error";
          error.runtime_error_type = signal || `Exit${code}`;
          error.runtime_error_details = capString(stderr || stdout, PYTHON_GRADER_OUTPUT_LIMIT);
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim() || "{}"));
        } catch (error) {
          const wrapped = new Error("python grader did not return valid runner JSON");
          wrapped.code = "python_grader_server_error";
          wrapped.server_error_type = "invalid_runner_json";
          wrapped.runtime_error_details = capString(`${stdout}\n${stderr}`.trim(), PYTHON_GRADER_OUTPUT_LIMIT);
          reject(wrapped);
        }
      });
    });

    child.stdin.end(payload);
  });
}

function capString(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? text.slice(text.length - maxLength) : text;
}

function textSimilarityScore(input, reference, metric) {
  const normalizedInput = normalizeText(input);
  const normalizedReference = normalizeText(reference);
  if (!normalizedInput && !normalizedReference) return 1;
  if (!normalizedInput || !normalizedReference) return 0;
  if (metric === "fuzzy_match") return normalizedLevenshteinSimilarity(normalizedInput, normalizedReference);
  if (metric === "cosine") return cosineSimilarity(tokens(normalizedInput), tokens(normalizedReference));
  if (metric === "meteor") return meteorScore(tokens(normalizedInput), tokens(normalizedReference));
  if (metric === "bleu") return bleuLikeScore(tokens(normalizedInput), tokens(normalizedReference), 4);
  if (metric === "gleu") return Math.min(
    bleuLikeScore(tokens(normalizedInput), tokens(normalizedReference), 4),
    rougeNScore(tokens(normalizedInput), tokens(normalizedReference), 4),
  );
  if (metric === "rouge_l") return rougeLScore(tokens(normalizedInput), tokens(normalizedReference));
  const rougeMatch = metric.match(/^rouge_([1-5])$/);
  if (rougeMatch) return rougeNScore(tokens(normalizedInput), tokens(normalizedReference), Number(rougeMatch[1]));
  return normalizedLevenshteinSimilarity(normalizedInput, normalizedReference);
}

function validateMultiGrader(grader, options = {}) {
  if (!isPlainObject(grader.graders) || !Object.keys(grader.graders).length) {
    throw graderError("multi grader requires a non-empty graders object", {
      code: "missing_required_parameter",
      param: "grader.graders",
    });
  }
  for (const [name, subGrader] of Object.entries(grader.graders)) {
    if (subGrader?.type === "multi") {
      throw graderError("nested multi graders are not supported", {
        code: "invalid_grader",
        param: `grader.graders.${name}.type`,
      });
    }
    validateGrader(subGrader, { ...options, nested: true });
  }
  if (grader.calculate_output != null && typeof grader.calculate_output !== "string") {
    throw graderError("multi grader calculate_output must be a string", {
      code: "invalid_grader",
      param: "grader.calculate_output",
    });
  }
}

function evaluateMultiGrader(grader, context) {
  validateMultiGrader(grader, { pythonGraderOptions: context?.pythonGraderOptions });
  const subResults = {};
  const variables = {};
  let hasError = false;
  for (const [name, subGrader] of Object.entries(grader.graders)) {
    const result = evaluateGrader({ name, ...subGrader }, context);
    subResults[name] = result;
    variables[name] = clampScore(result.score);
    if (result.status === "errored") hasError = true;
  }
  let score = 0;
  let formulaError = null;
  try {
    score = grader.calculate_output
      ? evaluateFormula(grader.calculate_output, variables)
      : average(Object.values(variables));
  } catch (error) {
    formulaError = error;
    hasError = true;
  }
  score = clampScore(score);
  const threshold = finiteNumber(grader.pass_threshold, 0.5);
  const passed = !hasError && score >= threshold;
  return {
    id: grader.id || grader.name || "multi",
    name: grader.name || "multi",
    type: "multi",
    status: hasError ? "errored" : passed ? "passed" : "failed",
    passed,
    score: hasError ? 0 : score,
    pass_threshold: threshold,
    calculate_output: grader.calculate_output || null,
    sub_results: subResults,
    sub_rewards: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, hasError ? 0 : value])),
    ...(formulaError ? {
      error: {
        code: formulaError.code || "formula_parse_error",
        message: formulaError.message,
        param: "grader.calculate_output",
      },
    } : {}),
  };
}

async function evaluateMultiGraderAsync(grader, context) {
  validateMultiGrader(grader, { pythonGraderOptions: context?.pythonGraderOptions });
  const subResults = {};
  const variables = {};
  let hasError = false;
  let tokenUsage = emptyTokenUsage();
  let modelUsage = {};
  let sampledModelName = null;
  for (const [name, subGrader] of Object.entries(grader.graders)) {
    const result = await evaluateGraderAsync({ name, ...subGrader }, context);
    subResults[name] = result;
    variables[name] = finiteNumber(result.score, 0);
    if (result.status === "errored") hasError = true;
    tokenUsage = addTokenUsage(tokenUsage, result.token_usage);
    modelUsage = addModelUsageMap(modelUsage, result.model_grader_token_usage_per_model);
    sampledModelName = sampledModelName || result.sampled_model_name || null;
  }
  let score = 0;
  let formulaError = null;
  try {
    score = grader.calculate_output
      ? evaluateFormula(grader.calculate_output, variables)
      : average(Object.values(variables));
  } catch (error) {
    formulaError = error;
    hasError = true;
  }
  score = clampScore(score);
  const threshold = finiteNumber(grader.pass_threshold, 0.5);
  const passed = !hasError && score >= threshold;
  return {
    id: grader.id || grader.name || "multi",
    name: grader.name || "multi",
    type: "multi",
    status: hasError ? "errored" : passed ? "passed" : "failed",
    passed,
    score: hasError ? 0 : score,
    pass_threshold: threshold,
    calculate_output: grader.calculate_output || null,
    sub_results: subResults,
    sub_rewards: Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, hasError ? 0 : value])),
    token_usage: tokenUsage,
    sampled_model_name: sampledModelName,
    model_grader_token_usage_per_model: modelUsage,
    compatibility_provider: tokenUsage.total_tokens > 0 ? "hybrid" : "local",
    compatibility_reason: tokenUsage.total_tokens > 0
      ? "multi_grader_mixed_local_and_provider_compatibility"
      : "local_grader_protocol_compatibility",
    ...(formulaError ? {
      error: {
        code: formulaError.code || "formula_parse_error",
        message: formulaError.message,
        param: "grader.calculate_output",
      },
    } : {}),
  };
}

function renderTemplateValue(value, context) {
  if (typeof value === "string") return renderTemplateString(value, context);
  if (Array.isArray(value)) return value.map((item) => renderTemplateValue(item, context));
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = renderTemplateValue(item, context);
    return output;
  }
  return value;
}

function renderTemplateString(template, context) {
  return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr) => {
    const value = valueAtPath(context, String(expr).trim());
    if (value == null) return "";
    return typeof value === "string" ? value : stringifyContent(value);
  });
}

function valueAtPath(context, expression) {
  const pathParts = expression
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let value = context;
  for (const part of pathParts) {
    if (value == null) return undefined;
    value = value[part];
  }
  return value;
}

function normalizeRunSample(modelSample, sample = null) {
  if (isPlainObject(sample)) return sampleFromObject(sample);
  if (isPlainObject(modelSample)) return sampleFromObject(modelSample);
  if (modelSample == null) return { output_text: "" };
  return { output_text: stringifyContent(modelSample) };
}

function sampleFromObject(value) {
  const sample = clone(value);
  if (sample.output_text == null) sample.output_text = stringifyContent(value.output ?? value.text ?? value.content ?? "");
  return sample;
}

function graderErrorFlags(result = {}) {
  const hasError = result.status === "errored";
  const code = result.error?.code || "";
  const pythonRuntimeDetails = result.error?.runtime_error_details
    || result.error?.message
    || null;
  return {
    formula_parse_error: hasError && code === "formula_parse_error",
    sample_parse_error: false,
    truncated_observation_error: false,
    unresponsive_reward_error: false,
    invalid_variable_error: hasError && code === "invalid_variable",
    other_error: hasError && ![
      "formula_parse_error",
      "invalid_variable",
      "model_grader_server_error",
      "model_grader_parse_error",
      "python_grader_server_error",
      "python_grader_runtime_error",
    ].includes(code),
    python_grader_server_error: code === "python_grader_server_error",
    python_grader_server_error_type: result.error?.server_error_type || null,
    python_grader_runtime_error: code === "python_grader_runtime_error",
    python_grader_runtime_error_details: code === "python_grader_runtime_error" ? pythonRuntimeDetails : null,
    model_grader_server_error: code === "model_grader_server_error",
    model_grader_refusal_error: false,
    model_grader_parse_error: code === "model_grader_parse_error",
    model_grader_server_error_details: null,
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return String(value || "").match(/[\p{L}\p{N}_]+/gu) || [];
}

function ngrams(items, n) {
  if (!items.length || items.length < n) return [];
  const output = [];
  for (let index = 0; index <= items.length - n; index += 1) output.push(items.slice(index, index + n).join("\u0001"));
  return output;
}

function overlapCount(left, right) {
  const counts = new Map();
  for (const item of right) counts.set(item, (counts.get(item) || 0) + 1);
  let overlap = 0;
  for (const item of left) {
    const count = counts.get(item) || 0;
    if (!count) continue;
    overlap += 1;
    counts.set(item, count - 1);
  }
  return overlap;
}

function rougeNScore(inputTokens, referenceTokens, n) {
  const inputNgrams = ngrams(inputTokens, n);
  const referenceNgrams = ngrams(referenceTokens, n);
  if (!inputNgrams.length && !referenceNgrams.length) return 1;
  if (!inputNgrams.length || !referenceNgrams.length) return 0;
  return clampScore(overlapCount(inputNgrams, referenceNgrams) / referenceNgrams.length);
}

function rougeLScore(inputTokens, referenceTokens) {
  if (!inputTokens.length && !referenceTokens.length) return 1;
  if (!inputTokens.length || !referenceTokens.length) return 0;
  return clampScore(lcsLength(inputTokens, referenceTokens) / referenceTokens.length);
}

function bleuLikeScore(inputTokens, referenceTokens, maxN) {
  if (!inputTokens.length && !referenceTokens.length) return 1;
  if (!inputTokens.length || !referenceTokens.length) return 0;
  const precisions = [];
  for (let n = 1; n <= maxN; n += 1) {
    const inputNgrams = ngrams(inputTokens, n);
    const referenceNgrams = ngrams(referenceTokens, n);
    if (!inputNgrams.length) break;
    precisions.push((overlapCount(inputNgrams, referenceNgrams) + 1) / (inputNgrams.length + 1));
  }
  const geoMean = Math.exp(average(precisions.map((value) => Math.log(value || 1e-9))));
  const brevityPenalty = inputTokens.length > referenceTokens.length
    ? 1
    : Math.exp(1 - referenceTokens.length / Math.max(inputTokens.length, 1));
  return clampScore(geoMean * brevityPenalty);
}

function meteorScore(inputTokens, referenceTokens) {
  if (!inputTokens.length && !referenceTokens.length) return 1;
  if (!inputTokens.length || !referenceTokens.length) return 0;
  const overlap = overlapCount(inputTokens, referenceTokens);
  const precision = overlap / inputTokens.length;
  const recall = overlap / referenceTokens.length;
  if (!precision || !recall) return 0;
  return clampScore((10 * precision * recall) / (recall + 9 * precision));
}

function cosineSimilarity(inputTokens, referenceTokens) {
  const input = termFrequency(inputTokens);
  const reference = termFrequency(referenceTokens);
  const keys = new Set([...input.keys(), ...reference.keys()]);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const key of keys) {
    const left = input.get(key) || 0;
    const right = reference.get(key) || 0;
    dot += left * right;
    leftNorm += left * left;
    rightNorm += right * right;
  }
  if (!leftNorm && !rightNorm) return 1;
  if (!leftNorm || !rightNorm) return 0;
  return clampScore(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function termFrequency(items) {
  const output = new Map();
  for (const item of items) output.set(item, (output.get(item) || 0) + 1);
  return output;
}

function normalizedLevenshteinSimilarity(left, right) {
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) return 1;
  return clampScore(1 - levenshteinDistance(left, right) / maxLength);
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      );
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column];
  }
  return previous[right.length];
}

function lcsLength(left, right) {
  const previous = Array.from({ length: right.length + 1 }, () => 0);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = left[row - 1] === right[column - 1]
        ? previous[column - 1] + 1
        : Math.max(previous[column], current[column - 1]);
    }
    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
      current[column] = 0;
    }
  }
  return previous[right.length];
}

function evaluateFormula(expression, variables) {
  const parser = new FormulaParser(expression, variables);
  const value = parser.parse();
  if (!Number.isFinite(value)) {
    throw graderError("multi grader formula did not produce a finite number", {
      code: "formula_parse_error",
      param: "grader.calculate_output",
    });
  }
  return value;
}

class FormulaParser {
  constructor(expression, variables) {
    this.tokens = formulaTokens(expression);
    this.variables = variables;
    this.index = 0;
  }

  parse() {
    const value = this.expression();
    if (this.peek()) this.fail(`unexpected token: ${this.peek().value}`);
    return value;
  }

  expression() {
    let value = this.term();
    while (this.match("+") || this.match("-")) {
      const operator = this.previous().value;
      const right = this.term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  term() {
    let value = this.power();
    while (this.match("*") || this.match("/")) {
      const operator = this.previous().value;
      const right = this.power();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  power() {
    let value = this.unary();
    while (this.match("^")) value = value ** this.unary();
    return value;
  }

  unary() {
    if (this.match("+")) return this.unary();
    if (this.match("-")) return -this.unary();
    return this.primary();
  }

  primary() {
    const token = this.peek();
    if (!token) this.fail("unexpected end of formula");
    if (this.match("number")) return this.previous().number;
    if (this.match("identifier")) {
      const name = this.previous().value;
      if (this.match("(")) {
        const args = [];
        if (!this.check(")")) {
          do {
            args.push(this.expression());
          } while (this.match(","));
        }
        this.consume(")", "expected closing parenthesis");
        return formulaFunction(name, args);
      }
      if (!Object.prototype.hasOwnProperty.call(this.variables, name)) {
        const error = graderError(`unknown formula variable: ${name}`, {
          code: "invalid_variable",
          param: "grader.calculate_output",
        });
        throw error;
      }
      return Number(this.variables[name]);
    }
    if (this.match("(")) {
      const value = this.expression();
      this.consume(")", "expected closing parenthesis");
      return value;
    }
    this.fail(`unexpected token: ${token.value}`);
  }

  match(typeOrValue) {
    if (!this.check(typeOrValue)) return false;
    this.index += 1;
    return true;
  }

  consume(value, message) {
    if (this.match(value)) return;
    this.fail(message);
  }

  check(typeOrValue) {
    const token = this.peek();
    if (!token) return false;
    return token.type === typeOrValue || token.value === typeOrValue;
  }

  previous() {
    return this.tokens[this.index - 1];
  }

  peek() {
    return this.tokens[this.index] || null;
  }

  fail(message) {
    throw graderError(message, {
      code: "formula_parse_error",
      param: "grader.calculate_output",
    });
  }
}

function formulaTokens(expression) {
  const tokensOut = [];
  const text = String(expression || "");
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = text.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokensOut.push({ type: "number", value: number[0], number: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokensOut.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    if ("+-*/^(),".includes(char)) {
      tokensOut.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    throw graderError(`invalid formula character: ${char}`, {
      code: "formula_parse_error",
      param: "grader.calculate_output",
    });
  }
  return tokensOut;
}

function formulaFunction(name, args) {
  const functions = {
    min: (...values) => Math.min(...values),
    max: (...values) => Math.max(...values),
    abs: (value) => Math.abs(value),
    floor: (value) => Math.floor(value),
    ceil: (value) => Math.ceil(value),
    exp: (value) => Math.exp(value),
    sqrt: (value) => Math.sqrt(value),
    log: (value) => Math.log(value),
  };
  const fn = functions[name];
  if (!fn) {
    throw graderError(`unsupported formula function: ${name}`, {
      code: "formula_parse_error",
      param: "grader.calculate_output",
    });
  }
  return fn(...args);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function emptyTokenUsage() {
  return {
    prompt_tokens: 0,
    total_tokens: 0,
    completion_tokens: 0,
    cached_tokens: 0,
  };
}

function normalizeTokenUsage(usage) {
  if (!isPlainObject(usage)) return emptyTokenUsage();
  return {
    prompt_tokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
    total_tokens: Number(usage.total_tokens || 0),
    completion_tokens: Number(usage.completion_tokens || usage.output_tokens || 0),
    cached_tokens: Number(
      usage.cached_tokens
      || usage.prompt_tokens_details?.cached_tokens
      || usage.input_tokens_details?.cached_tokens
      || usage.prompt_cache_hit_tokens
      || 0,
    ),
  };
}

function addTokenUsage(left, right) {
  const a = normalizeTokenUsage(left);
  const b = normalizeTokenUsage(right);
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    cached_tokens: a.cached_tokens + b.cached_tokens,
  };
}

function normalizeModelUsageMap(map) {
  if (!isPlainObject(map)) return {};
  const output = {};
  for (const [model, usage] of Object.entries(map)) {
    output[model] = normalizeTokenUsage(usage);
  }
  return output;
}

function addModelUsageMap(left, right) {
  const output = normalizeModelUsageMap(left);
  for (const [model, usage] of Object.entries(normalizeModelUsageMap(right))) {
    output[model] = addTokenUsage(output[model], usage);
  }
  return output;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function graderError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 400;
  error.code = details.code || "invalid_grader";
  error.type = details.type || "invalid_request_error";
  error.param = details.param || null;
  return error;
}

const PYTHON_GRADER_RUNNER = String.raw`
import builtins
import contextlib
import inspect
import io
import json
import math
import os
import sys
import traceback

try:
    import resource
except Exception:
    resource = None

BLOCKED_IMPORT_ROOTS = {
    "_socket",
    "aiohttp",
    "ftplib",
    "http",
    "httpx",
    "requests",
    "socket",
    "subprocess",
    "telnetlib",
    "urllib",
    "websocket",
}
BLOCKED_AUDIT_PREFIXES = ("socket.", "subprocess.")
BLOCKED_AUDIT_EVENTS = {"os.fork", "os.forkpty", "os.posix_spawn", "os.system", "pty.spawn"}
CAPTURE_LIMIT = 8192

def _cap(value):
    text = str(value or "")
    return text[-CAPTURE_LIMIT:]

def _emit(payload):
    sys.__stdout__.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.__stdout__.flush()

def _install_limits(limits):
    if resource is None:
        return
    try:
        cpu_seconds = max(1, int(math.ceil(float(limits.get("timeout_ms", 120000)) / 1000.0)))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    except Exception:
        pass
    try:
        disk_bytes = int(limits.get("disk_bytes", 1073741824))
        resource.setrlimit(resource.RLIMIT_FSIZE, (disk_bytes, disk_bytes))
    except Exception:
        pass
    try:
        memory_bytes = int(limits.get("memory_bytes", 2147483648))
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except Exception:
        pass

_real_import = builtins.__import__

def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = str(name or "").split(".", 1)[0]
    if root in BLOCKED_IMPORT_ROOTS:
        raise RuntimeError("blocked import: " + root)
    return _real_import(name, globals, locals, fromlist, level)

def _audit(event, args):
    if event in BLOCKED_AUDIT_EVENTS or any(str(event).startswith(prefix) for prefix in BLOCKED_AUDIT_PREFIXES):
        raise RuntimeError("blocked operation: " + str(event))

try:
    sys.addaudithook(_audit)
except Exception:
    pass
builtins.__import__ = _guarded_import

try:
    payload = json.load(sys.stdin)
    _install_limits(payload.get("limits") or {})
    os.chdir(os.getcwd())
    source = payload.get("source") or ""
    sample = payload.get("sample") if isinstance(payload.get("sample"), dict) else {}
    item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
    namespace = {
        "__builtins__": builtins.__dict__,
        "__name__": "__open_codex_python_grader__",
    }
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    with contextlib.redirect_stdout(stdout_capture), contextlib.redirect_stderr(stderr_capture):
        exec(compile(source, "<python_grader>", "exec"), namespace, namespace)
        grade = namespace.get("grade")
        if not callable(grade):
            raise TypeError("python grader source must define callable grade(sample, item)")
        signature = inspect.signature(grade)
        if len(signature.parameters) != 2:
            raise TypeError("grade must take exactly two arguments")
        value = grade(sample, item)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise TypeError("grade must return a finite float")
    score = max(0.0, min(1.0, float(value)))
    _emit({
        "ok": True,
        "score": score,
        "stdout": _cap(stdout_capture.getvalue()),
        "stderr": _cap(stderr_capture.getvalue()),
    })
except BaseException as exc:
    _emit({
        "ok": False,
        "code": "python_grader_runtime_error",
        "error_type": type(exc).__name__,
        "message": str(exc) or type(exc).__name__,
        "details": _cap(traceback.format_exc()),
    })
`;

module.exports = {
  SUPPORTED_GRADER_TYPES,
  evaluateGrader,
  evaluateGraderAsync,
  normalizeRunSample,
  renderTemplateValue,
  runGrader,
  runGraderAsync,
  validateGrader,
};
