"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { FileResponseStore } = require("./store");
const {
  injectInputFileMessages,
  inputFileCompatibility,
  prepareInputFileContext,
} = require("./input_files");
const {
  annotateFileSearchResponse,
  attachFileSearchOutput,
  fileSearchCompatibility,
  fileSearchOutputItems,
  injectFileSearchMessages,
  localFileSearchToolTypes,
  LocalFileSearchStore,
  prepareFileSearchContext,
} = require("./local_file_search");
const {
  attachShellOutput,
  injectShellMessages,
  localShellToolTypes,
  LocalContainerStore,
  prepareShellContext,
  shellCompatibility,
  shellOutputItems,
} = require("./local_shell");
const {
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  createResponseSkeleton,
  mapUsage,
  normalizeOutputTextLogprobs,
  prefixedId,
  responsesToChatRequest,
  stringifyContent,
} = require("./translator");
const {
  annotateWebSearchResponse,
  attachWebSearchOutput,
  injectWebSearchMessages,
  localWebSearchToolTypes,
  prepareWebSearchContext,
  webSearchCompatibility,
  webSearchOutputItems,
} = require("./web_search");

const DEFAULT_PROVIDER_BASE_URL = "https://api.deepseek.com";

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function numberFromEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function loadConfig(overrides = {}) {
  const apiKeyEnv = process.env.CODEXCOMPAT_PROVIDER_API_KEY_ENV || "DEEPSEEK_API_KEY";
  const stateDir = overrides.stateDir || process.env.CODEXCOMPAT_STATE_DIR || path.join(process.cwd(), "state", "responses-bridge");
  const compactionSecretFile = overrides.compactionSecretFile
    || process.env.CODEXCOMPAT_COMPACTION_SECRET_FILE
    || path.join(stateDir, "compaction.key");
  return {
    host: process.env.CODEXCOMPAT_HOST || "127.0.0.1",
    port: Number(process.env.CODEXCOMPAT_PORT || 12912),
    providerBaseUrl: trimTrailingSlash(process.env.CODEXCOMPAT_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL),
    chatCompletionsPath: normalizeRoute(process.env.CODEXCOMPAT_CHAT_COMPLETIONS_PATH || "/chat/completions"),
    modelsPath: normalizeRoute(process.env.CODEXCOMPAT_MODELS_PATH || "/models"),
    providerApiKey: process.env[apiKeyEnv] || process.env.CODEXCOMPAT_PROVIDER_API_KEY || "",
    providerApiKeyEnv: apiKeyEnv,
    defaultModel: process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro",
    maxTokensField: process.env.CODEXCOMPAT_MAX_TOKENS_FIELD || "max_tokens",
    jsonSchemaMode: process.env.CODEXCOMPAT_JSON_SCHEMA_MODE || "json_object",
    stateDir,
    requestTimeoutMs: numberFromEnv("CODEXCOMPAT_REQUEST_TIMEOUT_MS", 10 * 60 * 1000, 5000, 60 * 60 * 1000),
    compactionMaxOutputTokens: numberFromEnv("CODEXCOMPAT_COMPACTION_MAX_OUTPUT_TOKENS", 512, 64, 4096),
    compactionSecret: process.env.CODEXCOMPAT_COMPACTION_SECRET || "",
    compactionSecretFile,
    inputFileProvider: process.env.CODEXCOMPAT_INPUT_FILE_PROVIDER || "local",
    inputFileMaxFiles: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_FILES", 8, 1, 32),
    inputFileMaxBytes: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_BYTES", 4 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    inputFileMaxTextChars: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS", 200000, 1024, 2 * 1024 * 1024),
    inputFileFetchUrls: parseBoolean(process.env.CODEXCOMPAT_INPUT_FILE_FETCH_URLS, true),
    inputFileFetchTimeoutMs: numberFromEnv("CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    webSearchProvider: process.env.CODEXCOMPAT_WEB_SEARCH_PROVIDER || "wikipedia",
    webSearchMaxResults: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS", 5, 1, 10),
    webSearchTimeoutMs: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    webSearchStaticResults: process.env.CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS || "",
    webSearchWikipediaEndpoint: process.env.CODEXCOMPAT_WEB_SEARCH_WIKIPEDIA_ENDPOINT || "",
    webSearchUserAgent: process.env.CODEXCOMPAT_WEB_SEARCH_USER_AGENT || "open-codex-responses-bridge/0.2",
    fileSearchProvider: process.env.CODEXCOMPAT_FILE_SEARCH_PROVIDER || "local",
    fileSearchStateDir: process.env.CODEXCOMPAT_FILE_SEARCH_STATE_DIR || path.join(stateDir, "local-file-search"),
    fileSearchMaxResults: numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS", 5, 1, 20),
    fileSearchMaxFileBytes: numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES", 4 * 1024 * 1024, 1024, 64 * 1024 * 1024),
    shellProvider: process.env.CODEXCOMPAT_SHELL_PROVIDER || "local",
    shellStateDir: process.env.CODEXCOMPAT_SHELL_STATE_DIR || path.join(stateDir, "local-containers"),
    shellCommandTimeoutMs: numberFromEnv("CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS", 10 * 1000, 1000, 120 * 1000),
    shellMaxOutputBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES", 20 * 1024, 1024, 512 * 1024),
    shellMaxFileBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_FILE_BYTES", 16 * 1024 * 1024, 1024, 128 * 1024 * 1024),
    shellMaxCommandChars: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS", 4000, 32, 20000),
    shellMaxCommands: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMANDS", 1, 1, 5),
    shellMemoryLimit: process.env.CODEXCOMPAT_SHELL_MEMORY_LIMIT || "1g",
    deepseekReasoningEffortCompat: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT, true),
    deepseekThinkingMode: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_THINKING_MODE, false),
    deepseekDisableThinkingForToolChoice: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE, true),
    deepseekDisableThinkingForCompaction: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_COMPACTION, true),
    deepseekDisableThinkingForLocalWebSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH, true),
    deepseekDisableThinkingForLocalFileSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH, true),
    deepseekDisableThinkingForLocalShell: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL, true),
    forwardReasoningSummary: parseBoolean(process.env.CODEXCOMPAT_FORWARD_REASONING_SUMMARY, false),
    ...overrides,
  };
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeRoute(value) {
  const route = String(value || "").trim();
  if (!route) return "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function log(...args) {
  console.log(new Date().toISOString(), "[responses-bridge]", ...args);
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function sendError(res, status, message, details = {}) {
  sendJson(res, status, {
    error: {
      message,
      type: details.type || "compatibility_bridge_error",
      param: details.param || null,
      code: details.code || null,
    },
  });
}

async function readBody(req, maxBytes = 16 * 1024 * 1024) {
  return (await readRawBody(req, maxBytes)).toString("utf8");
}

async function readRawBody(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function providerHeaders(config, incomingHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "accept": incomingHeaders.accept || "application/json",
  };
  if (config.providerApiKey) headers.authorization = `Bearer ${config.providerApiKey}`;
  return headers;
}

function translatorOptions(config, extra = {}) {
  return {
    ...config,
    ...extra,
    decodeCompaction: (encryptedContent) => decodeLocalCompaction(encryptedContent, config),
  };
}

async function fetchProvider(config, route, body, incomingHeaders = {}, options = {}) {
  if (!config.providerApiKey && !options.allowMissingKey) {
    const error = new Error(`${config.providerApiKeyEnv} is required for upstream provider calls`);
    error.status = 500;
    throw error;
  }

  const controller = options.controller || new AbortController();
  const timeout = setTimeout(() => {
    options.onTimeout?.();
    controller.abort();
  }, config.requestTimeoutMs);
  try {
    return await fetch(`${config.providerBaseUrl}${route}`, {
      method: "POST",
      headers: providerHeaders(config, incomingHeaders),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderGet(config, route, incomingHeaders = {}, options = {}) {
  if (!config.providerApiKey && !options.allowMissingKey) {
    const error = new Error(`${config.providerApiKeyEnv} is required for upstream provider calls`);
    error.status = 500;
    throw error;
  }

  const controller = options.controller || new AbortController();
  const timeout = setTimeout(() => {
    options.onTimeout?.();
    controller.abort();
  }, config.requestTimeoutMs);
  try {
    return await fetch(`${config.providerBaseUrl}${route}`, {
      method: "GET",
      headers: providerHeaders(config, incomingHeaders),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, containerStore) {
  const request = await readJson(req);
  const responseId = prefixedId("resp");
  const previousMessages = request.previous_response_id ? store.getMessages(request.previous_response_id) : [];
  const localHostedTools = [
    ...localWebSearchToolTypes(request.tools || [], config),
    ...localFileSearchToolTypes(request.tools || [], config),
    ...localShellToolTypes(request.tools || [], config),
  ];
  const { chat, compatibility } = responsesToChatRequest(
    request,
    previousMessages,
    translatorOptions(config, { localHostedTools }),
  );
  chat.model = chat.model || config.defaultModel;

  if (request.background) {
    handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, {
      ...compatibility,
      ...(localHostedTools.length ? { local_hosted_tools: { status: "pending", tool_types: localHostedTools } } : {}),
    }, fileSearchStore, containerStore);
    return;
  }

  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) {
    applyInputFilesToChat(chat, compatibility, localInputFiles);
  }
  const localShell = await prepareShellContext(request, config, containerStore);
  if (localShell) {
    applyLocalShellToChat(chat, compatibility, localShell, config);
  }
  const localWebSearch = await prepareWebSearchContext(request, config);
  if (localWebSearch) {
    applyLocalWebSearchToChat(chat, compatibility, localWebSearch, config);
  }
  const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore);
  if (localFileSearch) {
    applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config);
  }

  if (chat.stream) {
    await handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility, localWebSearch, localFileSearch, localShell);
    return;
  }

  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
  const upstreamText = await upstream.text();
  let upstreamJson = null;
  try {
    upstreamJson = JSON.parse(upstreamText);
  } catch {
    // Leave null and surface the provider payload below.
  }

  if (!upstream.ok) {
    sendJson(res, upstream.status, upstreamJson || { error: { message: upstreamText } });
    return;
  }

  const response = chatCompletionToResponse(upstreamJson, request, { responseId });
  attachShellOutput(response, localShell);
  attachWebSearchOutput(response, localWebSearch);
  attachFileSearchOutput(response, localFileSearch);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility,
    upstream_object: upstreamJson.object || null,
  };

  if (request.store !== false) {
    store.put(response.id, {
      response,
      input_items: normalizeStoredInputItems(request.input),
      messages: [
        ...chat.messages,
        ...chatCompletionToReplayMessages(upstreamJson),
      ],
    });
  }

  sendJson(res, 200, response);
}

function handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, compatibility, fileSearchStore, containerStore) {
  const backgroundRequest = {
    ...request,
    background: true,
    stream: false,
    store: true,
  };
  chat.stream = false;
  chat.store = true;

  const response = createResponseSkeleton(backgroundRequest, {
    id: responseId,
    model: chat.model,
    status: "in_progress",
  });
  const backgroundCompatibility = {
    ...compatibility,
    background: request.store === false ? "local_store_forced" : "local_async",
    ...(request.stream ? { stream: "disabled_for_background" } : {}),
  };
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: backgroundCompatibility,
  };

  store.put(response.id, {
    response,
    input_items: normalizeStoredInputItems(request.input),
    messages: chat.messages,
  });

  const controller = new AbortController();
  const job = { controller, created_at: Date.now(), deleted: false };
  backgroundJobs.set(response.id, job);
  runBackgroundResponse({
    config,
    store,
    backgroundJobs,
    job,
    request: backgroundRequest,
    chat,
    responseId: response.id,
    compatibility: backgroundCompatibility,
    incomingHeaders: req.headers,
    fileSearchStore,
    containerStore,
  });

  sendJson(res, 200, response);
}

async function runBackgroundResponse({ config, store, backgroundJobs, job, request, chat, responseId, compatibility, incomingHeaders, fileSearchStore, containerStore }) {
  try {
    const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore, { signal: job.controller.signal });
    let finalCompatibility = compatibility;
    if (localInputFiles) {
      finalCompatibility = applyInputFilesToChat(chat, { ...compatibility }, localInputFiles);
    }
    const localShell = await prepareShellContext(request, config, containerStore);
    if (localShell) {
      finalCompatibility = applyLocalShellToChat(chat, { ...finalCompatibility }, localShell, config);
    }
    const localWebSearch = await prepareWebSearchContext(request, config, { signal: job.controller.signal });
    if (localWebSearch) {
      finalCompatibility = applyLocalWebSearchToChat(chat, { ...finalCompatibility }, localWebSearch, config);
    }
    const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore);
    if (localFileSearch) {
      finalCompatibility = applyLocalFileSearchToChat(chat, { ...finalCompatibility }, localFileSearch, config);
    }

    const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, incomingHeaders, {
      controller: job.controller,
      onTimeout: () => {
        job.timed_out = true;
      },
    });
    const upstreamText = await upstream.text();
    const upstreamJson = parseJsonOrNull(upstreamText);
    if (job.deleted) return;
    if (job.controller.signal.aborted) {
      storeCancelledBackgroundResponse(store, responseId, "cancelled");
      return;
    }

    if (!upstream.ok) {
      storeFailedBackgroundResponse(store, responseId, upstreamText, upstream.status, upstreamJson);
      return;
    }

    const response = chatCompletionToResponse(upstreamJson, request, { responseId });
    attachShellOutput(response, localShell);
    attachWebSearchOutput(response, localWebSearch);
    attachFileSearchOutput(response, localFileSearch);
    response.background = true;
    response.metadata = {
      ...(response.metadata || {}),
      compatibility: finalCompatibility,
      upstream_object: upstreamJson?.object || null,
    };

    store.put(response.id, {
      response,
      input_items: normalizeStoredInputItems(request.input),
      messages: [
        ...chat.messages,
        ...chatCompletionToReplayMessages(upstreamJson),
      ],
    });
  } catch (error) {
    if (job.deleted) return;
    if (job.timed_out) {
      storeFailedBackgroundResponse(store, responseId, "upstream provider request timed out", 504);
      return;
    }
    if (job.controller.signal.aborted || error.name === "AbortError") {
      storeCancelledBackgroundResponse(store, responseId, "cancelled");
      return;
    }
    storeFailedBackgroundResponse(store, responseId, error.message, 500);
  } finally {
    backgroundJobs.delete(responseId);
  }
}

function storeFailedBackgroundResponse(store, responseId, message, status, upstreamJson = null) {
  return updateStoredResponse(store, responseId, (response) => ({
    ...response,
    status: "failed",
    completed_at: nowSeconds(),
    error: {
      message: stringifyContent(upstreamJson?.error?.message || message || "background response failed"),
      type: upstreamJson?.error?.type || "upstream_provider_error",
      code: upstreamJson?.error?.code || status || 500,
      param: upstreamJson?.error?.param || null,
    },
  }));
}

function storeCancelledBackgroundResponse(store, responseId, reason) {
  return updateStoredResponse(store, responseId, (response) => ({
    ...response,
    status: "cancelled",
    completed_at: nowSeconds(),
    error: null,
    metadata: {
      ...(response.metadata || {}),
      compatibility_cancel: reason || "cancelled",
    },
  }));
}

function updateStoredResponse(store, responseId, updater) {
  const record = store.get(responseId);
  if (!record?.response) return null;
  if (record.response.status !== "in_progress") return record.response;
  const response = updater(clone(record.response));
  store.put(responseId, {
    ...record,
    response,
  });
  return response;
}

function applyLocalWebSearchToChat(chat, compatibility, localWebSearch, config) {
  injectWebSearchMessages(chat, localWebSearch);
  Object.assign(compatibility, webSearchCompatibility(localWebSearch));
  if (config.deepseekDisableThinkingForLocalWebSearch && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_web_search = {
      ...(compatibility.local_web_search || {}),
      deepseek_thinking: "disabled_for_local_web_search",
    };
  }
  return compatibility;
}

function applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config) {
  injectFileSearchMessages(chat, localFileSearch);
  Object.assign(compatibility, fileSearchCompatibility(localFileSearch));
  if (config.deepseekDisableThinkingForLocalFileSearch && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_file_search = {
      ...(compatibility.local_file_search || {}),
      deepseek_thinking: "disabled_for_local_file_search",
    };
  }
  return compatibility;
}

function applyLocalShellToChat(chat, compatibility, localShell, config) {
  injectShellMessages(chat, localShell);
  Object.assign(compatibility, shellCompatibility(localShell));
  if (config.deepseekDisableThinkingForLocalShell && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_shell = {
      ...(compatibility.local_shell || {}),
      deepseek_thinking: "disabled_for_local_shell",
    };
  }
  return compatibility;
}

function applyInputFilesToChat(chat, compatibility, localInputFiles) {
  injectInputFileMessages(chat, localInputFiles);
  Object.assign(compatibility, inputFileCompatibility(localInputFiles));
  return compatibility;
}

async function handleResponseInputTokens(req, res, config, store, fileSearchStore) {
  const request = await readJson(req);
  const previousMessages = request.previous_response_id ? store.getMessages(request.previous_response_id) : [];
  const { chat } = responsesToChatRequest(request, previousMessages, translatorOptions(config));
  chat.model = chat.model || config.defaultModel;
  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) injectInputFileMessages(chat, localInputFiles);
  chat.stream = false;
  delete chat.store;
  chat[config.maxTokensField || "max_tokens"] = 1;

  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
  const upstreamText = await upstream.text();
  const upstreamJson = parseJsonOrNull(upstreamText);

  if (!upstream.ok) {
    sendJson(res, upstream.status, upstreamJson || { error: { message: upstreamText } });
    return;
  }

  const inputTokens = upstreamJson?.usage?.prompt_tokens ?? upstreamJson?.usage?.input_tokens;
  if (!Number.isFinite(inputTokens)) {
    sendError(res, 502, "upstream provider did not return input token usage", {
      type: "upstream_provider_error",
      code: "missing_usage",
    });
    return;
  }

  sendJson(res, 200, {
    object: "response.input_tokens",
    input_tokens: inputTokens,
  });
}

async function handleResponseCompact(req, res, config, store, fileSearchStore) {
  const request = await readJson(req);
  const previousMessages = request.previous_response_id ? store.getMessages(request.previous_response_id) : [];
  const { chat } = responsesToChatRequest(request, previousMessages, translatorOptions(config));
  chat.model = chat.model || config.defaultModel;
  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) injectInputFileMessages(chat, localInputFiles);

  const upstream = await fetchProvider(config, config.chatCompletionsPath, makeCompactionChatRequest(request, chat, config), req.headers);
  const upstreamText = await upstream.text();
  const upstreamJson = parseJsonOrNull(upstreamText);

  if (!upstream.ok) {
    sendJson(res, upstream.status, upstreamJson || { error: { message: upstreamText } });
    return;
  }

  const summary = extractChatCompletionText(upstreamJson).trim();
  if (!summary) {
    sendError(res, 502, "upstream provider did not return compaction content", {
      type: "upstream_provider_error",
      code: "missing_compaction",
    });
    return;
  }

  const response = createCompactionResource(request, upstreamJson, summary, config);
  if (request.store !== false) {
    store.put(response.id, {
      response,
      input_items: normalizeStoredInputItems(request.input),
      messages: [compactionSummaryMessage(summary)],
      compaction_summary: summary,
    });
  }

  sendJson(res, 200, response);
}

async function handleFileCreate(req, res, config, fileSearchStore) {
  const upload = await readFileCreateRequest(req, config);
  if (!upload.content) {
    sendError(res, 400, "file content is required", { code: "missing_file" });
    return;
  }
  const file = fileSearchStore.createFile(upload);
  sendJson(res, 200, file);
}

function handleFilesList(res, fileSearchStore, url) {
  sendJson(res, 200, fileSearchStore.listFiles({
    purpose: url.searchParams.get("purpose") || undefined,
    url,
  }));
}

function handleFileGet(res, fileSearchStore, fileId) {
  const file = fileSearchStore.getFile(fileId);
  if (!file) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleFileContent(res, fileSearchStore, fileId) {
  const content = fileSearchStore.getFileContent(fileId);
  if (content == null) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(content);
}

function handleFileDelete(res, fileSearchStore, fileId) {
  const deleted = fileSearchStore.deleteFile(fileId);
  if (!deleted) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleVectorStoreCreate(req, res, fileSearchStore) {
  const body = await readJson(req);
  sendJson(res, 200, fileSearchStore.createVectorStore(body));
}

function handleVectorStoresList(res, fileSearchStore, url) {
  sendJson(res, 200, fileSearchStore.listVectorStores({ url }));
}

function handleVectorStoreGet(res, fileSearchStore, storeId) {
  const store = fileSearchStore.getVectorStore(storeId);
  if (!store) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, store);
}

function handleVectorStoreDelete(res, fileSearchStore, storeId) {
  const deleted = fileSearchStore.deleteVectorStore(storeId);
  if (!deleted) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleVectorStoreFileCreate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const attached = fileSearchStore.attachFile(storeId, body);
  if (!attached) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

function handleVectorStoreFilesList(res, fileSearchStore, storeId, url) {
  const page = fileSearchStore.listVectorStoreFiles(storeId, { url });
  if (!page) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleVectorStoreFileGet(res, fileSearchStore, storeId, fileId) {
  const attached = fileSearchStore.getVectorStoreFile(storeId, fileId);
  if (!attached) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

function handleVectorStoreFileDelete(res, fileSearchStore, storeId, fileId) {
  const deleted = fileSearchStore.deleteVectorStoreFile(storeId, fileId);
  if (!deleted) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleVectorStoreSearch(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const page = fileSearchStore.searchVectorStore(storeId, body);
  if (!page) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

async function handleContainerCreate(req, res, containerStore) {
  const body = await readJson(req);
  sendJson(res, 200, containerStore.createContainer(body));
}

function handleContainersList(res, containerStore, url) {
  sendJson(res, 200, containerStore.listContainers({
    name: url.searchParams.get("name") || undefined,
    url,
  }));
}

function handleContainerGet(res, containerStore, containerId) {
  const container = containerStore.getContainer(containerId);
  if (!container) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, container);
}

function handleContainerDelete(res, containerStore, containerId) {
  const deleted = containerStore.deleteContainer(containerId);
  if (!deleted) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleContainerFileCreate(req, res, config, containerStore, containerId) {
  const upload = await readContainerFileCreateRequest(req, config);
  const file = containerStore.createContainerFile(containerId, upload);
  if (!file) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleContainerFilesList(res, containerStore, containerId, url) {
  const page = containerStore.listContainerFiles(containerId, { url });
  if (!page) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleContainerFileGet(res, containerStore, containerId, fileId) {
  const file = containerStore.getContainerFile(containerId, fileId);
  if (!file) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleContainerFileContent(res, containerStore, containerId, fileId) {
  const file = containerStore.getContainerFile(containerId, fileId);
  const content = file ? containerStore.getContainerFileContent(containerId, fileId) : null;
  if (content == null) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    "x-container-file-path": file.path,
  });
  res.end(content);
}

function handleContainerFileDelete(res, containerStore, containerId, fileId) {
  const deleted = containerStore.deleteContainerFile(containerId, fileId);
  if (!deleted) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function readContainerFileCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    const body = await readJson(req);
    return {
      filename: body.filename || body.path || "upload.txt",
      path: body.path,
      content: body.content || "",
    };
  }

  const body = await readRawBody(req, config.shellMaxFileBytes);
  return {
    filename: req.headers["x-filename"] || "upload.txt",
    path: req.headers["x-path"] || req.headers["x-filename"] || "upload.txt",
    content: body,
  };
}

async function readFileCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    const body = await readJson(req);
    return {
      filename: body.filename || "upload.txt",
      purpose: body.purpose || "assistants",
      content: body.content || "",
      metadata: body.metadata || {},
    };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartForm(await readRawBody(req, config.fileSearchMaxFileBytes + 1024 * 1024), contentType);
    const file = form.files[0];
    return {
      filename: file?.filename || form.fields.filename || "upload.txt",
      purpose: form.fields.purpose || "assistants",
      content: file?.content || form.fields.content || "",
      metadata: parseJsonOrNull(form.fields.metadata) || {},
    };
  }

  const body = await readBody(req, config.fileSearchMaxFileBytes);
  return {
    filename: req.headers["x-filename"] || "upload.txt",
    purpose: req.headers["x-purpose"] || "assistants",
    content: body,
  };
}

function parseMultipartForm(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    const error = new Error("multipart boundary is required");
    error.status = 400;
    throw error;
  }

  const body = buffer.toString("utf8");
  const parts = body.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  const files = [];
  for (const rawPart of parts) {
    const part = rawPart.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const separator = part.indexOf("\r\n\r\n");
    const fallbackSeparator = part.indexOf("\n\n");
    const index = separator !== -1 ? separator : fallbackSeparator;
    if (index === -1) continue;
    const rawHeaders = part.slice(0, index);
    const content = part.slice(index + (separator !== -1 ? 4 : 2)).replace(/\r?\n$/, "");
    const disposition = rawHeaders.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line)) || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    if (filename != null) files.push({ name, filename, content });
    else fields[name] = content;
  }
  return { fields, files };
}

function makeCompactionChatRequest(request, chat, config) {
  const maxTokensField = config.maxTokensField || "max_tokens";
  const compactChat = {
    model: chat.model || request.model || config.defaultModel,
    stream: false,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You compact long-running agent conversations for continuation.",
          "Write a concise but complete state summary preserving durable facts, user requirements, unresolved tasks, tool results, file paths, constraints, and next actions.",
          "Do not invent facts. Prefer bullet-like plain text. Include exact IDs, filenames, commands, and code words when present.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Compact this conversation state for a future turn:\n\n${serializeChatMessages(chat.messages)}`,
      },
    ],
  };
  compactChat[maxTokensField] = request.max_output_tokens || config.compactionMaxOutputTokens;
  if (config.deepseekDisableThinkingForCompaction && !config.deepseekThinkingMode) {
    compactChat.thinking = { type: "disabled" };
  }
  return compactChat;
}

function createCompactionResource(request, upstreamJson, summary, config) {
  return {
    id: prefixedId("resp"),
    object: "response.compaction",
    created_at: upstreamJson?.created || nowSeconds(),
    output: [
      ...normalizeStoredInputItems(request.input),
      {
        id: prefixedId("cmp"),
        type: "compaction",
        encrypted_content: encryptLocalCompaction(summary, config),
      },
    ],
    usage: mapUsage(upstreamJson?.usage),
  };
}

function compactionSummaryMessage(summary) {
  return {
    role: "system",
    content: `Compacted conversation context:\n${summary}`,
  };
}

function serializeChatMessages(messages) {
  return (messages || [])
    .map((message, index) => {
      const lines = [`[${index + 1}] role=${message.role || "unknown"}`];
      if (message.name) lines.push(`name=${message.name}`);
      if (message.tool_call_id) lines.push(`tool_call_id=${message.tool_call_id}`);
      if (message.content != null) lines.push(`content=${stringifyContent(message.content)}`);
      if (message.reasoning_content) lines.push(`reasoning=${stringifyContent(message.reasoning_content)}`);
      if (message.tool_calls) lines.push(`tool_calls=${JSON.stringify(message.tool_calls)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function extractChatCompletionText(chat) {
  return (chat?.choices || [])
    .map((choice) => choice.message?.content || "")
    .map((content) => Array.isArray(content) ? content.map((part) => stringifyContent(part.text ?? part.content ?? part)).join("") : stringifyContent(content))
    .join("\n")
    .trim();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function encryptLocalCompaction(summary, config) {
  const key = getCompactionKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("open-codex-compaction-v1"));
  const plaintext = Buffer.from(JSON.stringify({
    summary,
    created_at: nowSeconds(),
    source: "open-codex-responses-bridge",
  }));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `occomp1.${base64url(iv)}.${base64url(tag)}.${base64url(encrypted)}`;
}

function decodeLocalCompaction(encryptedContent, config) {
  const value = String(encryptedContent || "");
  if (!value.startsWith("occomp1.")) return "";
  const parts = value.split(".");
  if (parts.length !== 4) return "";
  try {
    const [, iv, tag, encrypted] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getCompactionKey(config), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from("open-codex-compaction-v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    return typeof payload.summary === "string" ? payload.summary : "";
  } catch {
    return "";
  }
}

function getCompactionKey(config) {
  if (config.compactionSecret) return crypto.createHash("sha256").update(String(config.compactionSecret)).digest();
  const filePath = path.resolve(config.compactionSecretFile || path.join(config.stateDir, "compaction.key"));
  try {
    const existing = Buffer.from(fs.readFileSync(filePath, "utf8").trim(), "base64");
    if (existing.length === 32) return existing;
  } catch {
    // Generate below when the key file is absent or unreadable.
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${key.toString("base64")}\n`, { mode: 0o600 });
  return key;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

async function handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility, localWebSearch = null, localFileSearch = null, localShell = null) {
  const response = createResponseSkeleton(request, { id: responseId, model: chat.model });
  const state = createStreamState(response, compatibility);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });

  writeSse(res, "response.created", sequence(state, { type: "response.created", response: clone(response) }));
  writeSse(res, "response.in_progress", sequence(state, { type: "response.in_progress", response: clone(response) }));
  emitShellStreamItems(res, state, localShell);
  emitWebSearchStreamItems(res, state, localWebSearch);
  emitFileSearchStreamItems(res, state, localFileSearch);

  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
  if (!upstream.ok) {
    const text = await upstream.text();
    emitError(res, state, text, upstream.status);
    res.end();
    return;
  }

  try {
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") break;
      const events = applyChatStreamChunk(state, payload);
      for (const event of events) writeSse(res, event.type, sequence(state, event));
    }

    annotateWebSearchResponse(response, localWebSearch);
    annotateFileSearchResponse(response, localFileSearch);
    syncStreamTextFromResponse(state);
    const doneEvents = finishStreamState(state);
    for (const event of doneEvents) writeSse(res, event.type, sequence(state, event));
    response.status = "completed";
    response.completed_at = Math.floor(Date.now() / 1000);
    response.usage = state.usage;
    response.metadata = {
      ...(response.metadata || {}),
      compatibility,
      upstream_object: "chat.completion.chunk",
    };
    writeSse(res, "response.completed", sequence(state, { type: "response.completed", response: clone(response) }));

    if (request.store !== false) {
      store.put(response.id, {
        response,
        input_items: normalizeStoredInputItems(request.input),
        messages: [
          ...chat.messages,
          ...streamStateToReplayMessages(state),
        ],
      });
    }
  } catch (error) {
    emitError(res, state, error.message, 500);
  } finally {
    res.end();
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emitError(res, state, message, status) {
  writeSse(res, "error", sequence(state, {
    type: "error",
    code: status || 500,
    message: stringifyContent(message),
  }));
}

function createStreamState(response, compatibility) {
  return {
    response,
    compatibility,
    sequenceNumber: 0,
    messageItem: null,
    text: "",
    reasoningItem: null,
    reasoningText: "",
    outputTextLogprobs: [],
    toolCalls: new Map(),
    outputDone: new Set(),
    usage: null,
  };
}

function sequence(state, event) {
  state.sequenceNumber += 1;
  return { sequence_number: state.sequenceNumber, ...event };
}

function emitWebSearchStreamItems(res, state, context) {
  for (const item of webSearchOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitFileSearchStreamItems(res, state, context) {
  for (const item of fileSearchOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitShellStreamItems(res, state, context) {
  for (const item of shellOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function syncStreamTextFromResponse(state) {
  const message = state.response.output.find((item) => item.type === "message");
  const textPart = message?.content?.find((part) => part.type === "output_text");
  if (typeof textPart?.text === "string") state.text = textPart.text;
  if (state.outputTextLogprobs.length && textPart) textPart.logprobs = clone(state.outputTextLogprobs);
}

function ensureMessageItem(state) {
  if (state.messageItem) return [];
  const item = {
    id: prefixedId("msg"),
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  state.messageItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureTextPart(state) {
  const events = ensureMessageItem(state);
  if (state.messageItem.content.length) return events;
  const part = { type: "output_text", text: "", annotations: [] };
  state.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: state.messageItem.id,
    output_index: state.response.output.indexOf(state.messageItem),
    content_index: 0,
    part: clone(part),
  });
  return events;
}

function ensureReasoningItem(state) {
  if (state.reasoningItem) return [];
  const item = {
    id: prefixedId("rs"),
    type: "reasoning",
    status: "in_progress",
    summary: [{ type: "summary_text", text: "" }],
  };
  state.reasoningItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureToolCallItem(state, index, deltaToolCall) {
  if (state.toolCalls.has(index)) return [];
  const callId = deltaToolCall.id || prefixedId("call");
  const item = {
    id: prefixedId("fc"),
    type: "function_call",
    call_id: callId,
    name: deltaToolCall.function?.name || "",
    arguments: "",
    status: "in_progress",
  };
  state.toolCalls.set(index, item);
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function applyChatStreamChunk(state, chunk) {
  const events = [];
  if (chunk.usage) state.usage = require("./translator").mapUsage(chunk.usage);

  for (const choice of chunk.choices || []) {
    const delta = choice.delta || {};

    if (delta.reasoning_content) {
      events.push(...ensureReasoningItem(state));
      const item = state.reasoningItem;
      const outputIndex = state.response.output.indexOf(item);
      item.summary[0].text += delta.reasoning_content;
      state.reasoningText += delta.reasoning_content;
      events.push({
        type: "response.reasoning_summary_text.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        delta: delta.reasoning_content,
      });
    }

    if (delta.content) {
      events.push(...ensureTextPart(state));
      const item = state.messageItem;
      const outputIndex = state.response.output.indexOf(item);
      item.content[0].text += delta.content;
      state.text += delta.content;
      events.push({
        type: "response.output_text.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        content_index: 0,
        delta: delta.content,
      });
    }

    const logprobs = normalizeOutputTextLogprobs(choice.logprobs);
    if (Array.isArray(logprobs) && logprobs.length) {
      events.push(...ensureTextPart(state));
      const item = state.messageItem;
      state.outputTextLogprobs.push(...logprobs);
      item.content[0].logprobs = clone(state.outputTextLogprobs);
    } else if (logprobs && !Array.isArray(logprobs)) {
      events.push(...ensureTextPart(state));
      const item = state.messageItem;
      item.content[0].logprobs = logprobs;
    }

    for (const deltaToolCall of delta.tool_calls || []) {
      const index = deltaToolCall.index || 0;
      events.push(...ensureToolCallItem(state, index, deltaToolCall));
      const item = state.toolCalls.get(index);
      const outputIndex = state.response.output.indexOf(item);
      if (deltaToolCall.id) item.call_id = deltaToolCall.id;
      if (deltaToolCall.function?.name) item.name += deltaToolCall.function.name;
      if (deltaToolCall.function?.arguments) {
        item.arguments += deltaToolCall.function.arguments;
        events.push({
          type: "response.function_call_arguments.delta",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          delta: deltaToolCall.function.arguments,
        });
      }
    }
  }

  return events;
}

function finishStreamState(state) {
  const events = [];
  for (const item of state.response.output) {
    const outputIndex = state.response.output.indexOf(item);
    if (item.type === "message") {
      item.status = "completed";
      if (item.content[0] && !state.outputDone.has(`${item.id}:text`)) {
        events.push({
          type: "response.output_text.done",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          content_index: 0,
          text: item.content[0].text,
        });
        events.push({
          type: "response.content_part.done",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          content_index: 0,
          part: clone(item.content[0]),
        });
      }
    } else if (item.type === "reasoning") {
      item.status = "completed";
      events.push({
        type: "response.reasoning_summary_text.done",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        text: item.summary[0]?.text || "",
      });
    } else if (item.type === "function_call") {
      item.status = "completed";
      events.push({
        type: "response.function_call_arguments.done",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      });
    }

    events.push({
      type: "response.output_item.done",
      response_id: state.response.id,
      output_index: outputIndex,
      item: clone(item),
    });
  }

  return events;
}

function streamStateToReplayMessages(state) {
  const messages = [];
  const assistant = { role: "assistant", content: state.text || null };
  if (state.reasoningText) assistant.reasoning_content = state.reasoningText;
  const toolCalls = Array.from(state.toolCalls.values()).map((item) => ({
    id: item.call_id,
    type: "function",
    function: { name: item.name, arguments: item.arguments },
  }));
  if (toolCalls.length) assistant.tool_calls = toolCalls;
  if (assistant.content !== null || assistant.tool_calls || assistant.reasoning_content) messages.push(assistant);
  return messages;
}

async function* iterateSseJson(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        if (data === "[DONE]") yield data;
        else yield JSON.parse(data);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function handleChatPassthrough(req, res, config, store) {
  const body = await readJson(req);
  const upstream = await fetchProvider(config, config.chatCompletionsPath, body, req.headers);
  const headers = proxyResponseHeaders(upstream);
  if (body.store === true && !body.stream && isJsonResponse(upstream)) {
    const text = await upstream.text();
    const json = parseJsonOrNull(text);
    if (upstream.ok && json?.id) {
      store.put(json.id, {
        chat_completion: json,
        chat_messages: normalizeStoredChatMessages(body.messages, json),
        chat_request: sanitizeChatRequest(body),
      });
    }
    res.writeHead(upstream.status, headers);
    res.end(text);
    return;
  }

  res.writeHead(upstream.status, headers);
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

function isJsonResponse(upstream) {
  return (upstream.headers.get("content-type") || "").includes("application/json");
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function proxyResponseHeaders(upstream) {
  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
  const headers = {
    "content-type": contentType,
    "cache-control": "no-store",
  };
  if (contentType.includes("text/event-stream")) {
    headers.connection = "keep-alive";
    headers["x-accel-buffering"] = "no";
  }
  return headers;
}

function sanitizeChatRequest(request) {
  const stored = clone(request || {});
  delete stored.stream;
  return stored;
}

function normalizeStoredChatMessages(messages, completion) {
  const data = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    data.push(addStoredChatMessageId(message, data.length, "input"));
  }

  for (const choice of completion?.choices || []) {
    if (choice.message) {
      data.push(addStoredChatMessageId({
        ...choice.message,
        finish_reason: choice.finish_reason || null,
        index: choice.index,
      }, data.length, "output"));
    }
  }

  return data;
}

function addStoredChatMessageId(message, index, direction) {
  const stored = message && typeof message === "object" && !Array.isArray(message)
    ? clone(message)
    : { role: "user", content: stringifyContent(message) };
  if (!stored.id) stored.id = `chatmsg_${String(index).padStart(6, "0")}`;
  if (!stored.object) stored.object = "chat.completion.message";
  stored.direction = direction;
  return stored;
}

async function handleModels(req, res, config) {
  if (config.providerApiKey) {
    try {
      const upstream = await fetchProviderGet(config, config.modelsPath, req.headers);
      if (upstream.ok) {
        const text = await upstream.text();
        res.writeHead(200, {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(text);
        return;
      }
    } catch {
      // Fall through to local model catalog.
    }
  }

  sendJson(res, 200, {
    object: "list",
    data: [localModelObject(config.defaultModel)],
  });
}

async function handleModelGet(req, res, config, modelId) {
  if (config.providerApiKey) {
    const direct = await tryFetchModel(config, req.headers, modelId);
    if (direct) {
      sendJson(res, 200, direct);
      return;
    }

    const listed = await tryFindListedModel(config, req.headers, modelId);
    if (listed) {
      sendJson(res, 200, listed);
      return;
    }
  }

  if (modelId === config.defaultModel) {
    sendJson(res, 200, localModelObject(modelId));
    return;
  }

  sendError(res, 404, `model not found: ${modelId}`, {
    type: "invalid_request_error",
    code: "model_not_found",
    param: "model",
  });
}

async function tryFetchModel(config, headers, modelId) {
  try {
    const route = `${config.modelsPath.replace(/\/+$/, "")}/${encodeURIComponent(modelId)}`;
    const upstream = await fetchProviderGet(config, route, headers);
    if (!upstream.ok || !isJsonResponse(upstream)) return null;
    const text = await upstream.text();
    const json = parseJsonOrNull(text);
    return normalizeModelObject(json);
  } catch {
    return null;
  }
}

async function tryFindListedModel(config, headers, modelId) {
  try {
    const upstream = await fetchProviderGet(config, config.modelsPath, headers);
    if (!upstream.ok || !isJsonResponse(upstream)) return null;
    const body = parseJsonOrNull(await upstream.text());
    const found = Array.isArray(body?.data)
      ? body.data.find((model) => model?.id === modelId)
      : null;
    return normalizeModelObject(found);
  } catch {
    return null;
  }
}

function normalizeModelObject(model) {
  if (!model?.id) return null;
  const created = Number(model.created);
  return {
    ...model,
    id: model.id,
    object: model.object || "model",
    created: Number.isFinite(created) ? created : 0,
    owned_by: model.owned_by || model.owned_by_organization || "upstream-provider",
  };
}

function localModelObject(modelId) {
  return {
    id: modelId,
    object: "model",
    created: 0,
    owned_by: "compatibility-bridge",
  };
}

function handleResponseGet(res, store, responseId) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  sendJson(res, 200, record.response);
}

function handleResponseDelete(res, store, responseId, backgroundJobs) {
  const job = backgroundJobs?.get(responseId);
  if (job) {
    job.deleted = true;
    job.controller.abort();
    backgroundJobs.delete(responseId);
  }

  const deleted = store.delete(responseId);
  if (!deleted) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  sendJson(res, 200, {
    id: responseId,
    object: "response.deleted",
    deleted: true,
  });
}

function handleResponseCancel(res, store, responseId, backgroundJobs) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  if (record.response.status === "in_progress") {
    const job = backgroundJobs?.get(responseId);
    if (job) {
      job.controller.abort();
      backgroundJobs.delete(responseId);
    }
    const response = storeCancelledBackgroundResponse(store, responseId, job ? "background job aborted" : "background job marked cancelled");
    sendJson(res, 200, response || store.get(responseId)?.response || record.response);
    return;
  }

  const response = clone(record.response);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility_cancel: "local store only contains terminal responses; completed responses are returned as a no-op",
  };
  sendJson(res, 200, response);
}

function handleResponseInputItems(res, store, responseId, url) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  const items = Array.isArray(record.input_items)
    ? record.input_items
    : normalizeStoredInputItems(record.request?.input);
  sendJson(res, 200, paginateInputItems(items, url));
}

function handleChatCompletionGet(res, store, completionId) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  sendJson(res, 200, record.chat_completion);
}

function handleChatCompletionsList(res, store, url) {
  const model = url.searchParams.get("model");
  const metadataFilters = metadataFiltersFromUrl(url);
  const completions = store.list()
    .filter((record) => record?.chat_completion)
    .map((record) => normalizeListedChatCompletion(record))
    .filter((completion) => !model || completion.model === model)
    .filter((completion) => matchesMetadataFilters(completion.metadata || {}, metadataFilters));
  sendJson(res, 200, paginateList(completions, url));
}

function normalizeListedChatCompletion(record) {
  const completion = clone(record.chat_completion);
  if (!completion.model && record.chat_request?.model) completion.model = record.chat_request.model;
  const requestMetadata = record.chat_request?.metadata;
  if (!completion.metadata && requestMetadata && typeof requestMetadata === "object" && !Array.isArray(requestMetadata)) {
    completion.metadata = clone(requestMetadata);
  }
  if (!completion.metadata) completion.metadata = {};
  return completion;
}

function metadataFiltersFromUrl(url) {
  const filters = [];
  for (const [key, value] of url.searchParams.entries()) {
    const bracket = key.match(/^metadata\[([^\]]+)\]$/);
    if (bracket) filters.push([bracket[1], value]);
  }
  return filters;
}

function matchesMetadataFilters(metadata, filters) {
  if (!filters.length) return true;
  return filters.every(([key, expected]) => String(metadata?.[key] ?? "") === expected);
}

function handleChatCompletionMessages(res, store, completionId, url) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const messages = Array.isArray(record.chat_messages) ? record.chat_messages : [];
  sendJson(res, 200, paginateList(messages, url));
}

function normalizeStoredInputItems(input) {
  if (input == null) return [];
  if (typeof input === "string") {
    return [{
      id: "in_000000",
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: input }],
    }];
  }

  const items = Array.isArray(input) ? input : [input];
  return items.map((item, index) => normalizeStoredInputItem(item, index));
}

function normalizeStoredInputItem(item, index) {
  const id = `in_${String(index).padStart(6, "0")}`;
  if (typeof item === "string") {
    return {
      id,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: item }],
    };
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return {
      id,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: stringifyContent(item) }],
    };
  }

  const stored = clone(item);
  if (!stored.id) stored.id = id;
  if (!stored.type && stored.role) stored.type = "message";
  return stored;
}

function paginateInputItems(items, url) {
  return paginateList(items, url);
}

function paginateList(items, url) {
  const order = String(url.searchParams.get("order") || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const limit = parseLimit(url.searchParams.get("limit"), 20, 100);
  let data = items.map((item) => clone(item));
  if (order === "desc") data.reverse();

  if (after) {
    const index = data.findIndex((item) => item.id === after);
    data = index === -1 ? [] : data.slice(index + 1);
  }

  if (before) {
    const index = data.findIndex((item) => item.id === before);
    data = index === -1 ? [] : data.slice(0, index);
  }

  const page = data.slice(0, limit);
  return {
    object: "list",
    data: page,
    first_id: page[0]?.id || null,
    last_id: page.at(-1)?.id || null,
    has_more: data.length > page.length,
  };
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function createServer(config = loadConfig()) {
  const store = config.store || new FileResponseStore({ dir: config.stateDir });
  const fileSearchStore = config.fileSearchStore || new LocalFileSearchStore(config);
  const containerStore = config.containerStore || new LocalContainerStore(config);
  const backgroundJobs = new Map();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
        sendJson(res, 200, {
          ok: true,
          service: "open-codex-responses-bridge",
          provider_base_url: config.providerBaseUrl,
          default_model: config.defaultModel,
          has_provider_key: !!config.providerApiKey,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        await handleModels(req, res, config);
        return;
      }

      if (url.pathname === "/v1/containers") {
        if (req.method === "GET") {
          handleContainersList(res, containerStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleContainerCreate(req, res, containerStore);
          return;
        }
      }

      const containerFilesRoute = url.pathname.match(/^\/v1\/containers\/([^/]+)\/files(?:\/([^/]+)(?:\/(content))?)?$/);
      if (containerFilesRoute) {
        const containerId = decodeURIComponent(containerFilesRoute[1]);
        const fileId = containerFilesRoute[2] ? decodeURIComponent(containerFilesRoute[2]) : "";
        const action = containerFilesRoute[3] || "";
        if (!fileId && req.method === "GET") {
          handleContainerFilesList(res, containerStore, containerId, url);
          return;
        }
        if (!fileId && req.method === "POST") {
          await handleContainerFileCreate(req, res, config, containerStore, containerId);
          return;
        }
        if (fileId && !action && req.method === "GET") {
          handleContainerFileGet(res, containerStore, containerId, fileId);
          return;
        }
        if (fileId && !action && req.method === "DELETE") {
          handleContainerFileDelete(res, containerStore, containerId, fileId);
          return;
        }
        if (fileId && action === "content" && req.method === "GET") {
          handleContainerFileContent(res, containerStore, containerId, fileId);
          return;
        }
      }

      const containerRoute = url.pathname.match(/^\/v1\/containers\/([^/]+)$/);
      if (containerRoute) {
        const containerId = decodeURIComponent(containerRoute[1]);
        if (req.method === "GET") {
          handleContainerGet(res, containerStore, containerId);
          return;
        }
        if (req.method === "DELETE") {
          handleContainerDelete(res, containerStore, containerId);
          return;
        }
      }

      if (url.pathname === "/v1/files") {
        if (req.method === "GET") {
          handleFilesList(res, fileSearchStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleFileCreate(req, res, config, fileSearchStore);
          return;
        }
      }

      const fileRoute = url.pathname.match(/^\/v1\/files\/([^/]+)(?:\/(content))?$/);
      if (fileRoute) {
        const fileId = decodeURIComponent(fileRoute[1]);
        const action = fileRoute[2] || "";
        if (!action && req.method === "GET") {
          handleFileGet(res, fileSearchStore, fileId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleFileDelete(res, fileSearchStore, fileId);
          return;
        }
        if (action === "content" && req.method === "GET") {
          handleFileContent(res, fileSearchStore, fileId);
          return;
        }
      }

      if (url.pathname === "/v1/vector_stores") {
        if (req.method === "GET") {
          handleVectorStoresList(res, fileSearchStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleVectorStoreCreate(req, res, fileSearchStore);
          return;
        }
      }

      const vectorStoreSearchRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/search$/);
      if (vectorStoreSearchRoute && req.method === "POST") {
        await handleVectorStoreSearch(req, res, fileSearchStore, decodeURIComponent(vectorStoreSearchRoute[1]));
        return;
      }

      const vectorStoreFilesRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/files(?:\/([^/]+))?$/);
      if (vectorStoreFilesRoute) {
        const storeId = decodeURIComponent(vectorStoreFilesRoute[1]);
        const fileId = vectorStoreFilesRoute[2] ? decodeURIComponent(vectorStoreFilesRoute[2]) : "";
        if (!fileId && req.method === "GET") {
          handleVectorStoreFilesList(res, fileSearchStore, storeId, url);
          return;
        }
        if (!fileId && req.method === "POST") {
          await handleVectorStoreFileCreate(req, res, fileSearchStore, storeId);
          return;
        }
        if (fileId && req.method === "GET") {
          handleVectorStoreFileGet(res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && req.method === "DELETE") {
          handleVectorStoreFileDelete(res, fileSearchStore, storeId, fileId);
          return;
        }
      }

      const vectorStoreRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)$/);
      if (vectorStoreRoute) {
        const storeId = decodeURIComponent(vectorStoreRoute[1]);
        if (req.method === "GET") {
          handleVectorStoreGet(res, fileSearchStore, storeId);
          return;
        }
        if (req.method === "DELETE") {
          handleVectorStoreDelete(res, fileSearchStore, storeId);
          return;
        }
      }

      const modelRoute = url.pathname.match(/^\/v1\/models\/([^/]+)$/);
      if (modelRoute && req.method === "GET") {
        await handleModelGet(req, res, config, decodeURIComponent(modelRoute[1]));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, containerStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        await handleResponseCompact(req, res, config, store, fileSearchStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/input_tokens") {
        await handleResponseInputTokens(req, res, config, store, fileSearchStore);
        return;
      }

      const responseRoute = url.pathname.match(/^\/v1\/responses\/([^/]+)(?:\/([^/]+))?$/);
      if (responseRoute) {
        const responseId = decodeURIComponent(responseRoute[1]);
        const action = responseRoute[2] || "";
        if (!action && req.method === "GET") {
          handleResponseGet(res, store, responseId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleResponseDelete(res, store, responseId, backgroundJobs);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleResponseCancel(res, store, responseId, backgroundJobs);
          return;
        }
        if (action === "input_items" && req.method === "GET") {
          handleResponseInputItems(res, store, responseId, url);
          return;
        }
      }

      if (url.pathname === "/v1/chat/completions") {
        if (req.method === "GET") {
          handleChatCompletionsList(res, store, url);
          return;
        }
        if (req.method === "POST") {
          await handleChatPassthrough(req, res, config, store);
          return;
        }
      }

      const chatRoute = url.pathname.match(/^\/v1\/chat\/completions\/([^/]+)(?:\/([^/]+))?$/);
      if (chatRoute) {
        const completionId = decodeURIComponent(chatRoute[1]);
        const action = chatRoute[2] || "";
        if (!action && req.method === "GET") {
          handleChatCompletionGet(res, store, completionId);
          return;
        }
        if (action === "messages" && req.method === "GET") {
          handleChatCompletionMessages(res, store, completionId, url);
          return;
        }
      }

      sendError(res, 404, "not found");
    } catch (error) {
      sendError(res, error.status || 500, error.message || "internal server error");
    }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

if (require.main === module) {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    log(`listening on http://${config.host}:${config.port}`, {
      provider_base_url: config.providerBaseUrl,
      default_model: config.defaultModel,
      provider_api_key_env: config.providerApiKeyEnv,
      has_provider_key: !!config.providerApiKey,
    });
  });
}

module.exports = {
  createServer,
  iterateSseJson,
  loadConfig,
};
