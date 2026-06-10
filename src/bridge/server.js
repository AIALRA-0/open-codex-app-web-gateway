"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { FileConversationStore, FileResponseStore } = require("./store");
const {
  createToolCallBudget,
  toolBudgetCompatibility,
} = require("./local_tool_budget");
const {
  injectInputFileMessages,
  inputFileCompatibility,
  prepareInputFileContext,
} = require("./input_files");
const {
  LOCAL_EMBEDDING_DIMENSIONS,
  annotateFileSearchResponse,
  attachFileSearchOutput,
  fileSearchCompatibility,
  fileSearchOutputItems,
  injectFileSearchMessages,
  localFileSearchToolTypes,
  LocalFileSearchStore,
  prepareFileSearchContext,
  semanticVector,
} = require("./local_file_search");
const {
  LocalUploadStore,
  OFFICIAL_UPLOAD_MAX_BYTES,
  OFFICIAL_UPLOAD_PART_MAX_BYTES,
} = require("./local_uploads");
const {
  attachShellOutput,
  injectShellMessages,
  localShellToolTypes,
  LocalContainerStore,
  prepareShellContext,
  shellCompatibility,
  shellOutputItems,
} = require("./local_shell");
const { LocalSkillStore } = require("./local_skills");
const {
  chatCompatibilityMetadata,
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  chatUsageCompatibilityMetadata,
  createResponseSkeleton,
  mapUsage,
  normalizeOutputTextLogprobs,
  prefixedId,
  responseTerminalStateFromFinishReasons,
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

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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
  const providerBaseUrl = trimTrailingSlash(process.env.CODEXCOMPAT_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL);
  const deepseekProvider = isDeepSeekProvider(overrides.providerBaseUrl || providerBaseUrl);
  const webSearchProvider = overrides.webSearchProvider || process.env.CODEXCOMPAT_WEB_SEARCH_PROVIDER || "wikipedia";
  const defaultWebSearchOpenPages = String(webSearchProvider).toLowerCase() === "wikipedia" ? 1 : 0;
  const compactionSecretFile = overrides.compactionSecretFile
    || process.env.CODEXCOMPAT_COMPACTION_SECRET_FILE
    || path.join(stateDir, "compaction.key");
  const fileSearchMaxFileBytes = overrides.fileSearchMaxFileBytes
    || numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES", 4 * 1024 * 1024, 1024, 64 * 1024 * 1024);
  const uploadMaxBytes = overrides.uploadMaxBytes
    || numberFromEnv("CODEXCOMPAT_UPLOAD_MAX_BYTES", fileSearchMaxFileBytes, 1024, OFFICIAL_UPLOAD_MAX_BYTES);
  const uploadMaxPartBytes = overrides.uploadMaxPartBytes || numberFromEnv(
    "CODEXCOMPAT_UPLOAD_MAX_PART_BYTES",
    Math.min(OFFICIAL_UPLOAD_PART_MAX_BYTES, uploadMaxBytes),
    1024,
    OFFICIAL_UPLOAD_PART_MAX_BYTES,
  );
  return {
    host: process.env.CODEXCOMPAT_HOST || "127.0.0.1",
    port: Number(process.env.CODEXCOMPAT_PORT || 12912),
    providerBaseUrl,
    chatCompletionsPath: normalizeRoute(process.env.CODEXCOMPAT_CHAT_COMPLETIONS_PATH || "/chat/completions"),
    modelsPath: normalizeRoute(process.env.CODEXCOMPAT_MODELS_PATH || "/models"),
    providerApiKey: process.env[apiKeyEnv] || process.env.CODEXCOMPAT_PROVIDER_API_KEY || "",
    providerApiKeyEnv: apiKeyEnv,
    defaultModel: process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro",
    embeddingsModel: process.env.CODEXCOMPAT_EMBEDDINGS_MODEL || "hashed-semantic-256",
    embeddingsDimensions: numberFromEnv("CODEXCOMPAT_EMBEDDINGS_DIMENSIONS", LOCAL_EMBEDDING_DIMENSIONS, 1, 3072),
    maxTokensField: process.env.CODEXCOMPAT_MAX_TOKENS_FIELD || "max_tokens",
    jsonSchemaMode: process.env.CODEXCOMPAT_JSON_SCHEMA_MODE || "json_object",
    stateDir,
    conversationStateDir: process.env.CODEXCOMPAT_CONVERSATION_STATE_DIR || path.join(stateDir, "local-conversations"),
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
    inputFilePdfExtractor: process.env.CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR || "pdftotext",
    inputFilePdfTimeoutMs: numberFromEnv("CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS", 10 * 1000, 1000, 120 * 1000),
    webSearchProvider,
    webSearchMaxResults: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS", 5, 1, 10),
    webSearchTimeoutMs: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    webSearchOpenPages: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES", defaultWebSearchOpenPages, 0, 5),
    webSearchPageMaxBytes: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES", 512 * 1024, 4096, 5 * 1024 * 1024),
    webSearchPageMaxTextChars: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS", 12000, 1000, 200000),
    webSearchFindInPage: parseBoolean(process.env.CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE, true),
    webSearchFindInPageMaxMatches: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES", 3, 1, 10),
    webSearchFindInPageContextChars: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS", 240, 40, 2000),
    webSearchStaticResults: process.env.CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS || "",
    webSearchWikipediaEndpoint: process.env.CODEXCOMPAT_WEB_SEARCH_WIKIPEDIA_ENDPOINT || "",
    webSearchUserAgent: process.env.CODEXCOMPAT_WEB_SEARCH_USER_AGENT || "open-codex-responses-bridge/0.2 (https://opencodexapp.aialra.online)",
    fileSearchProvider: process.env.CODEXCOMPAT_FILE_SEARCH_PROVIDER || "local",
    fileSearchStateDir: process.env.CODEXCOMPAT_FILE_SEARCH_STATE_DIR || path.join(stateDir, "local-file-search"),
    fileSearchMaxResults: numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS", 5, 1, 50),
    fileSearchMaxFileBytes,
    uploadStateDir: process.env.CODEXCOMPAT_UPLOAD_STATE_DIR || path.join(stateDir, "local-uploads"),
    uploadMaxBytes,
    uploadMaxPartBytes,
    shellProvider: process.env.CODEXCOMPAT_SHELL_PROVIDER || "local",
    shellStateDir: process.env.CODEXCOMPAT_SHELL_STATE_DIR || path.join(stateDir, "local-containers"),
    shellCommandTimeoutMs: numberFromEnv("CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS", 10 * 1000, 1000, 120 * 1000),
    shellMaxOutputBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES", 20 * 1024, 1024, 512 * 1024),
    shellMaxFileBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_FILE_BYTES", 16 * 1024 * 1024, 1024, 128 * 1024 * 1024),
    shellMaxCommandChars: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS", 4000, 32, 20000),
    shellMaxCommands: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMANDS", 1, 1, 5),
    shellMemoryLimit: process.env.CODEXCOMPAT_SHELL_MEMORY_LIMIT || "1g",
    skillStateDir: process.env.CODEXCOMPAT_SKILL_STATE_DIR || path.join(stateDir, "local-skills"),
    skillMaxUploadBytes: numberFromEnv("CODEXCOMPAT_SKILL_MAX_UPLOAD_BYTES", 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    skillMaxFileCount: numberFromEnv("CODEXCOMPAT_SKILL_MAX_FILE_COUNT", 500, 1, 500),
    deepseekReasoningEffortCompat: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT, true),
    deepseekThinkingMode: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_THINKING_MODE, false),
    deepseekDisableThinkingForToolChoice: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE, true),
    deepseekDisableThinkingForCompaction: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_COMPACTION, true),
    deepseekDisableThinkingForLocalWebSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH, true),
    deepseekDisableThinkingForLocalFileSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH, true),
    deepseekDisableThinkingForLocalShell: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL, true),
    deepseekDisableThinkingForInputFiles: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES, true),
    deepseekUserIdCompat: parseBoolean(
      process.env.CODEXCOMPAT_DEEPSEEK_USER_ID_COMPAT,
      deepseekProvider,
    ),
    forwardServiceTier: parseBoolean(process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER, !deepseekProvider),
    forwardChatNativeFields: parseBoolean(process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS, !deepseekProvider),
    forwardStreamOptions: parseBoolean(process.env.CODEXCOMPAT_FORWARD_STREAM_OPTIONS, true),
    streamIncludeUsage: parseBoolean(process.env.CODEXCOMPAT_STREAM_INCLUDE_USAGE, true),
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

function isDeepSeekProvider(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === "deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return /\bdeepseek\b/i.test(String(value || ""));
  }
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

async function handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, containerStore, conversationStore, skillStore) {
  const request = await readJson(req);
  const responseId = prefixedId("resp");
  const toolBudget = createToolCallBudget(request.max_tool_calls);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(request.previous_response_id ? store.getMessages(request.previous_response_id) : []),
  ];
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
  applyCompactionReplayToChat(chat, compatibility, request, config);

  if (request.background) {
    handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, {
      ...compatibility,
      ...(conversation ? { local_conversation: { id: conversation.id, replayed_item_count: conversation.items.length } } : {}),
      ...(localHostedTools.length ? { local_hosted_tools: { status: "pending", tool_types: localHostedTools } } : {}),
    }, fileSearchStore, containerStore, conversationStore, conversation, toolBudget, skillStore);
    return;
  }

  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) {
    applyInputFilesToChat(chat, compatibility, localInputFiles, config);
  }
  const localShell = await prepareShellContext(request, config, containerStore, { toolBudget, skillStore });
  if (localShell) {
    applyLocalShellToChat(chat, compatibility, localShell, config);
  }
  const localWebSearch = await prepareWebSearchContext(request, config, { toolBudget });
  if (localWebSearch) {
    applyLocalWebSearchToChat(chat, compatibility, localWebSearch, config);
  }
  const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore, { toolBudget });
  if (localFileSearch) {
    applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config);
  }
  Object.assign(compatibility, toolBudgetCompatibility(toolBudget));

  if (chat.stream) {
    await handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, {
      ...compatibility,
      ...(conversation ? { local_conversation: { id: conversation.id, replayed_item_count: conversation.items.length } } : {}),
    }, localWebSearch, localFileSearch, localShell, conversationStore, conversation);
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
  attachConversationToResponse(response, conversation);
  attachShellOutput(response, localShell);
  attachWebSearchOutput(response, localWebSearch);
  attachFileSearchOutput(response, localFileSearch);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(response.metadata?.compatibility, compatibility),
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
  appendResponseToConversation(conversationStore, conversation, request, response);

  sendJson(res, 200, response);
}

function handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, compatibility, fileSearchStore, containerStore, conversationStore, conversation, toolBudget, skillStore) {
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
  attachConversationToResponse(response, conversation);
  const backgroundCompatibility = {
    ...compatibility,
    ...toolBudgetCompatibility(toolBudget),
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
    conversationStore,
    conversation,
    toolBudget,
    skillStore,
  });

  sendJson(res, 200, response);
}

async function runBackgroundResponse({ config, store, backgroundJobs, job, request, chat, responseId, compatibility, incomingHeaders, fileSearchStore, containerStore, conversationStore, conversation, toolBudget, skillStore }) {
  try {
    const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore, { signal: job.controller.signal });
    let finalCompatibility = compatibility;
    if (localInputFiles) {
      finalCompatibility = applyInputFilesToChat(chat, { ...compatibility }, localInputFiles, config);
    }
    const localShell = await prepareShellContext(request, config, containerStore, { toolBudget, skillStore });
    if (localShell) {
      finalCompatibility = applyLocalShellToChat(chat, { ...finalCompatibility }, localShell, config);
    }
    const localWebSearch = await prepareWebSearchContext(request, config, { signal: job.controller.signal, toolBudget });
    if (localWebSearch) {
      finalCompatibility = applyLocalWebSearchToChat(chat, { ...finalCompatibility }, localWebSearch, config);
    }
    const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore, { toolBudget });
    if (localFileSearch) {
      finalCompatibility = applyLocalFileSearchToChat(chat, { ...finalCompatibility }, localFileSearch, config);
    }
    Object.assign(finalCompatibility, toolBudgetCompatibility(toolBudget));

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
    attachConversationToResponse(response, conversation);
    attachShellOutput(response, localShell);
    attachWebSearchOutput(response, localWebSearch);
    attachFileSearchOutput(response, localFileSearch);
    response.background = true;
    response.metadata = {
      ...(response.metadata || {}),
      compatibility: mergeCompatibility(response.metadata?.compatibility, finalCompatibility),
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
    appendResponseToConversation(conversationStore, conversation, request, response);
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

function reconcileStaleBackgroundResponses(store) {
  if (typeof store?.list !== "function" || typeof store?.put !== "function") return 0;
  let reconciled = 0;
  for (const record of store.list()) {
    const response = record?.response;
    if (!response || response.status !== "in_progress" || response.background !== true) continue;
    const responseId = response.id || record.id;
    if (!responseId) continue;
    store.put(responseId, {
      ...record,
      response: {
        ...response,
        status: "failed",
        completed_at: nowSeconds(),
        error: {
          message: "background response was interrupted by bridge restart",
          type: "compatibility_bridge_error",
          code: "background_job_interrupted_by_restart",
          param: null,
        },
        metadata: {
          ...(response.metadata || {}),
          compatibility: mergeCompatibility(response.metadata?.compatibility, {
            background_restart: "marked_failed_on_startup",
          }),
        },
      },
    });
    reconciled += 1;
  }
  return reconciled;
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

function applyInputFilesToChat(chat, compatibility, localInputFiles, config = {}) {
  injectInputFileMessages(chat, localInputFiles);
  Object.assign(compatibility, inputFileCompatibility(localInputFiles));
  if (config.deepseekDisableThinkingForInputFiles && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_input_files = {
      ...(compatibility.local_input_files || {}),
      deepseek_thinking: "disabled_for_input_files",
    };
  }
  return compatibility;
}

function applyCompactionReplayToChat(chat, compatibility, request, config) {
  if (!hasCompactionInput(request.input)) return compatibility;
  if (config.deepseekDisableThinkingForCompaction && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_compaction = {
      ...(compatibility.local_compaction || {}),
      deepseek_thinking: "disabled_for_compaction_replay",
    };
  }
  return compatibility;
}

function hasCompactionInput(value) {
  if (Array.isArray(value)) return value.some(hasCompactionInput);
  if (!value || typeof value !== "object") return false;
  if (value.type === "compaction") return true;
  return hasCompactionInput(value.content) || hasCompactionInput(value.input);
}

function mergeCompatibility(existing, next, extra = {}) {
  const current = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  return {
    ...current,
    ...(next || {}),
    ...extra,
  };
}

function conversationIdFromRequest(request = {}) {
  if (typeof request.conversation === "string") return request.conversation;
  if (isPlainObject(request.conversation) && typeof request.conversation.id === "string") return request.conversation.id;
  if (typeof request.conversation_id === "string") return request.conversation_id;
  return "";
}

function prepareConversationContext(request, conversationStore, config) {
  const id = conversationIdFromRequest(request);
  if (!id) return null;
  const items = conversationStore?.listItems(id);
  if (!items) return { id, missing: true, items: [], messages: [] };
  const replayRequest = {
    model: request.model || config.defaultModel,
    input: items,
    stream: false,
  };
  const { chat } = responsesToChatRequest(replayRequest, [], translatorOptions(config));
  return { id, items, messages: chat.messages };
}

function attachConversationToResponse(response, conversation) {
  if (!conversation?.id) return response;
  response.conversation = conversation.id;
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(response.metadata?.compatibility, {
      local_conversation: {
        id: conversation.id,
        replayed_item_count: conversation.items?.length || 0,
      },
    }),
  };
  return response;
}

function appendResponseToConversation(conversationStore, conversation, request, response) {
  if (!conversationStore || !conversation?.id || !response) return;
  const items = [
    ...conversationInputItems(request.input),
    ...conversationOutputItems(response.output),
  ];
  if (!items.length) return;
  conversationStore.appendItems(conversation.id, items);
}

function conversationInputItems(input) {
  return normalizeStoredInputItems(input).map((item) => {
    const cloned = clone(item);
    delete cloned.id;
    delete cloned.object;
    return cloned;
  });
}

function conversationOutputItems(output) {
  if (!Array.isArray(output)) return [];
  return output
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const cloned = clone(item);
      if (cloned.id) cloned.response_item_id = cloned.id;
      delete cloned.id;
      delete cloned.object;
      return cloned;
    });
}

async function handleResponseInputTokens(req, res, config, store, fileSearchStore, conversationStore) {
  const request = await readJson(req);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(request.previous_response_id ? store.getMessages(request.previous_response_id) : []),
  ];
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

async function handleResponseCompact(req, res, config, store, fileSearchStore, conversationStore) {
  const request = await readJson(req);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(request.previous_response_id ? store.getMessages(request.previous_response_id) : []),
  ];
  const { chat, compatibility } = responsesToChatRequest(request, previousMessages, translatorOptions(config));
  chat.model = chat.model || config.defaultModel;
  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) applyInputFilesToChat(chat, compatibility, localInputFiles, config);

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
  attachConversationToResponse(response, conversation);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(response.metadata?.compatibility, compatibility),
    upstream_object: upstreamJson?.object || null,
  };
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
  const file = fileSearchStore.getFile(fileId);
  const fallbackContent = fileSearchStore.getFileContent(fileId);
  const content = fileSearchStore.getFileContentBuffer?.(fileId)
    || (fallbackContent != null
      ? Buffer.from(fallbackContent, "utf8")
      : null);
  if (!file || content == null) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": file.mime_type || file.metadata?.mime_type || "application/octet-stream",
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

async function handleUploadCreate(req, res, uploadStore) {
  const body = await readJson(req);
  sendJson(res, 200, uploadStore.createUpload(body));
}

async function handleUploadPartCreate(req, res, config, uploadStore, uploadId) {
  const content = await readUploadPartRequest(req, config);
  sendJson(res, 200, uploadStore.addPart(uploadId, content));
}

async function handleUploadComplete(req, res, uploadStore, fileSearchStore, uploadId) {
  const body = await readJson(req);
  sendJson(res, 200, uploadStore.completeUpload(uploadId, body, fileSearchStore));
}

function handleUploadCancel(res, uploadStore, uploadId) {
  sendJson(res, 200, uploadStore.cancelUpload(uploadId));
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

async function handleVectorStoreUpdate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const store = fileSearchStore.updateVectorStore(storeId, body);
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

async function handleVectorStoreFileBatchCreate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const batch = fileSearchStore.createVectorStoreFileBatch(storeId, body);
  if (!batch) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchGet(res, fileSearchStore, storeId, batchId) {
  const batch = fileSearchStore.getVectorStoreFileBatch(storeId, batchId);
  if (!batch) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchCancel(res, fileSearchStore, storeId, batchId) {
  const batch = fileSearchStore.cancelVectorStoreFileBatch(storeId, batchId);
  if (!batch) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchFilesList(res, fileSearchStore, storeId, batchId, url) {
  const page = fileSearchStore.listVectorStoreFileBatchFiles(storeId, batchId, { url });
  if (!page) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, page);
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

async function handleVectorStoreFileUpdate(req, res, fileSearchStore, storeId, fileId) {
  const body = await readJson(req);
  const attached = fileSearchStore.updateVectorStoreFile(storeId, fileId, body);
  if (!attached) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

function handleVectorStoreFileContent(res, fileSearchStore, storeId, fileId) {
  const content = fileSearchStore.getVectorStoreFileContent(storeId, fileId);
  if (!content) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, content);
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

async function handleSkillCreate(req, res, config, skillStore) {
  const upload = await readSkillCreateRequest(req, config);
  sendJson(res, 200, skillStore.createSkill(upload));
}

function handleSkillsList(res, skillStore, url) {
  sendJson(res, 200, skillStore.listSkills({ url }));
}

function handleSkillGet(res, skillStore, skillId) {
  const skill = skillStore.getSkill(skillId);
  if (!skill) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, skill);
}

async function handleSkillUpdate(req, res, skillStore, skillId) {
  const body = await readJson(req);
  const skill = skillStore.updateSkill(skillId, body);
  if (!skill) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, skill);
}

function handleSkillDelete(res, skillStore, skillId) {
  const deleted = skillStore.deleteSkill(skillId);
  if (!deleted) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleSkillVersionCreate(req, res, config, skillStore, skillId) {
  const upload = await readSkillCreateRequest(req, config);
  const version = skillStore.createSkillVersion(skillId, upload);
  if (!version) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, version);
}

function handleSkillVersionsList(res, skillStore, skillId, url) {
  const page = skillStore.listSkillVersions(skillId, { url });
  if (!page) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleSkillVersionGet(res, skillStore, skillId, version) {
  const resource = skillStore.getSkillVersion(skillId, version);
  if (!resource) {
    sendError(res, 404, `skill version not found: ${version}`, { code: "skill_version_not_found" });
    return;
  }
  sendJson(res, 200, resource);
}

function handleSkillVersionDelete(res, skillStore, skillId, version) {
  const deleted = skillStore.deleteSkillVersion(skillId, version);
  if (!deleted) {
    sendError(res, 404, `skill version not found: ${version}`, { code: "skill_version_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

function handleSkillContent(res, skillStore, skillId, version) {
  const content = skillStore.getSkillContentZip(skillId, version);
  if (!content) {
    sendError(res, 404, `skill content not found: ${skillId}`, { code: "skill_content_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "application/zip",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${content.skill.name}-v${content.version.version}.zip"`,
    "x-skill-id": content.skill.id,
    "x-skill-version": String(content.version.version),
  });
  res.end(content.content);
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

async function readSkillCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    return readJson(req);
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, config.skillMaxUploadBytes), contentType);
    return {
      name: form.fields.name,
      description: form.fields.description,
      metadata: parseJsonOrNull(form.fields.metadata) || {},
      files: form.files.map((file, index) => ({
        path: file.filename || file.name || (index === 0 ? "SKILL.md" : `file-${index}.txt`),
        content: file.content,
      })),
    };
  }

  const body = await readRawBody(req, config.skillMaxUploadBytes);
  return {
    name: req.headers["x-skill-name"],
    description: req.headers["x-skill-description"],
    files: [{
      path: req.headers["x-filename"] || "SKILL.md",
      content: body,
    }],
  };
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
    const content = typeof body.content_base64 === "string"
      ? decodeBase64Payload(body.content_base64)
      : body.content || "";
    return {
      filename: body.filename || "upload.txt",
      purpose: body.purpose || "assistants",
      content,
      metadata: body.metadata || {},
      mime_type: body.mime_type || body.mimeType,
    };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, config.fileSearchMaxFileBytes + 1024 * 1024), contentType);
    const file = form.files.find((item) => item.name === "file") || form.files[0];
    return {
      filename: file?.filename || form.fields.filename || "upload.txt",
      purpose: form.fields.purpose || "assistants",
      content: file?.content || form.fields.content || "",
      metadata: parseJsonOrNull(form.fields.metadata) || {},
      mime_type: form.fields.mime_type || file?.content_type,
    };
  }

  const body = await readRawBody(req, config.fileSearchMaxFileBytes);
  return {
    filename: req.headers["x-filename"] || "upload.txt",
    purpose: req.headers["x-purpose"] || "assistants",
    content: body,
    mime_type: req.headers["content-type"],
  };
}

async function readUploadPartRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  const maxPartBytes = config.uploadMaxPartBytes || OFFICIAL_UPLOAD_PART_MAX_BYTES;
  const maxBodyBytes = Math.ceil(maxPartBytes * 4 / 3) + 1024 * 1024;
  if (contentType.includes("application/json")) {
    const raw = await readRawBody(req, maxBodyBytes);
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    if (typeof body.data_base64 === "string") return decodeBase64Payload(body.data_base64);
    if (typeof body.data === "string") return Buffer.from(body.data, "utf8");
    if (typeof body.content === "string") return Buffer.from(body.content, "utf8");
    return Buffer.alloc(0);
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, maxBodyBytes), contentType);
    const file = form.files.find((item) => item.name === "data") || form.files[0];
    if (file) return file.content;
    if (typeof form.fields.data === "string") return Buffer.from(form.fields.data, "utf8");
    return Buffer.alloc(0);
  }

  return readRawBody(req, maxPartBytes);
}

function decodeBase64Payload(value) {
  const raw = String(value || "");
  const dataUrl = raw.match(/^data:[^,]*;base64,(.*)$/s);
  return Buffer.from(dataUrl ? dataUrl[1] : raw, "base64");
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

function parseMultipartFormBinary(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    const error = new Error("multipart boundary is required");
    error.status = 400;
    throw error;
  }

  const marker = Buffer.from(`--${boundary}`);
  const crlfMarker = Buffer.from(`\r\n--${boundary}`);
  const lfMarker = Buffer.from(`\n--${boundary}`);
  const fields = {};
  const files = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    let start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    start += marker.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    else if (buffer[start] === 10) start += 1;

    let next = buffer.indexOf(crlfMarker, start);
    if (next === -1) next = buffer.indexOf(lfMarker, start);
    if (next === -1) break;
    const part = buffer.subarray(start, next);
    cursor = next + 1;

    let separator = part.indexOf(Buffer.from("\r\n\r\n"));
    let separatorLength = 4;
    if (separator === -1) {
      separator = part.indexOf(Buffer.from("\n\n"));
      separatorLength = 2;
    }
    if (separator === -1) continue;

    const rawHeaders = part.subarray(0, separator).toString("utf8");
    const content = part.subarray(separator + separatorLength);
    const disposition = rawHeaders.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line)) || "";
    const partContentType = rawHeaders.split(/\r?\n/).find((line) => /^content-type:/i.test(line)) || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentTypeHeader = partContentType.replace(/^content-type:\s*/i, "").trim();
    if (!name) continue;
    if (filename != null) files.push({ name, filename, content, content_type: contentTypeHeader || undefined });
    else fields[name] = content.toString("utf8");
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

async function handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility, localWebSearch = null, localFileSearch = null, localShell = null, conversationStore = null, conversation = null) {
  const response = createResponseSkeleton(request, { id: responseId, model: chat.model });
  attachConversationToResponse(response, conversation);
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
    const terminal = responseTerminalStateFromFinishReasons(state.finishReasons);
    response.status = terminal.status;
    response.completed_at = terminal.completed_at;
    response.incomplete_details = terminal.incomplete_details;
    response.error = terminal.error;
    response.service_tier = state.serviceTier;
    response.usage = state.usage;
    const refusalLogprobs = streamRefusalLogprobs(state);
    response.metadata = {
      ...(response.metadata || {}),
      compatibility: mergeCompatibility(
        compatibility,
        {
          ...state.chatCompatibility,
          ...streamChoiceCompatibilityMetadata(state),
          ...chatUsageCompatibilityMetadata(state.chatUsage),
        },
        refusalLogprobs.length ? { chat_refusal_logprobs: refusalLogprobs } : {},
      ),
      upstream_object: "chat.completion.chunk",
    };
    const terminalEvent = terminalEventForResponseStatus(response.status);
    writeSse(res, terminalEvent, sequence(state, { type: terminalEvent, response: clone(response) }));

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
    appendResponseToConversation(conversationStore, conversation, request, response);
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
    choices: new Map(),
    finishReasons: [],
    outputDone: new Set(),
    serviceTier: response.service_tier,
    chatCompatibility: {},
    chatUsage: undefined,
    usage: null,
  };
}

function getChoiceStreamState(state, choiceIndex = 0) {
  const index = choiceIndex ?? 0;
  if (!state.choices.has(index)) {
    state.choices.set(index, {
      index,
      finishReason: null,
      hasFinishReason: false,
      messageItem: null,
      text: "",
      reasoningItem: null,
      reasoningText: "",
      outputTextLogprobs: [],
      outputTextAnnotations: [],
      outputRefusalLogprobs: [],
      refusalText: "",
      toolCalls: new Map(),
    });
  }
  return state.choices.get(index);
}

function terminalEventForResponseStatus(status) {
  if (status === "failed") return "response.failed";
  if (status === "incomplete") return "response.incomplete";
  return "response.completed";
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
  for (const choiceState of state.choices.values()) {
    const textPart = choiceState.messageItem?.content?.find((part) => part.type === "output_text");
    if (typeof textPart?.text === "string") choiceState.text = textPart.text;
    if (choiceState.outputTextLogprobs.length && textPart) {
      textPart.logprobs = clone(choiceState.outputTextLogprobs);
    }
    if (choiceState.outputTextAnnotations.length && textPart) {
      textPart.annotations = clone(choiceState.outputTextAnnotations);
    }
  }
}

function ensureMessageItem(state, choiceState) {
  if (choiceState.messageItem) return [];
  const item = {
    id: prefixedId("msg"),
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  choiceState.messageItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureTextPart(state, choiceState) {
  const events = ensureMessageItem(state, choiceState);
  if (choiceState.messageItem.content.some((part) => part.type === "output_text")) return events;
  const part = { type: "output_text", text: "", annotations: [] };
  choiceState.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: choiceState.messageItem.id,
    output_index: state.response.output.indexOf(choiceState.messageItem),
    content_index: 0,
    part: clone(part),
  });
  return events;
}

function ensureRefusalPart(state, choiceState) {
  const events = ensureMessageItem(state, choiceState);
  if (choiceState.messageItem.content.some((part) => part.type === "refusal")) return events;
  const part = { type: "refusal", refusal: "" };
  choiceState.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: choiceState.messageItem.id,
    output_index: state.response.output.indexOf(choiceState.messageItem),
    content_index: choiceState.messageItem.content.indexOf(part),
    part: clone(part),
  });
  return events;
}

function ensureReasoningItem(state, choiceState) {
  if (choiceState.reasoningItem) return [];
  const item = {
    id: prefixedId("rs"),
    type: "reasoning",
    status: "in_progress",
    summary: [{ type: "summary_text", text: "" }],
  };
  choiceState.reasoningItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureToolCallItem(state, choiceState, index, deltaToolCall) {
  if (choiceState.toolCalls.has(index)) return [];
  const callId = deltaToolCall.id || prefixedId("call");
  const item = {
    id: prefixedId("fc"),
    type: "function_call",
    call_id: callId,
    name: "",
    arguments: "",
    status: "in_progress",
  };
  choiceState.toolCalls.set(index, item);
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
  if (chunk.usage) {
    state.chatUsage = chunk.usage;
    state.usage = mapUsage(chunk.usage);
  }
  if (chunk.service_tier != null) state.serviceTier = chunk.service_tier;
  Object.assign(state.chatCompatibility, chatCompatibilityMetadata(chunk));

  for (const choice of chunk.choices || []) {
    const choiceState = getChoiceStreamState(state, choice.index);
    if (Object.prototype.hasOwnProperty.call(choice, "finish_reason")) {
      choiceState.finishReason = choice.finish_reason;
      choiceState.hasFinishReason = true;
    }
    if (choice.finish_reason) state.finishReasons.push(choice.finish_reason);
    const delta = choice.delta || {};

    if (delta.reasoning_content) {
      events.push(...ensureReasoningItem(state, choiceState));
      const item = choiceState.reasoningItem;
      const outputIndex = state.response.output.indexOf(item);
      item.summary[0].text += delta.reasoning_content;
      choiceState.reasoningText += delta.reasoning_content;
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
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const outputIndex = state.response.output.indexOf(item);
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      item.content[contentIndex].text += delta.content;
      choiceState.text += delta.content;
      events.push({
        type: "response.output_text.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: delta.content,
      });
    }

    const annotations = [
      ...normalizeStreamAnnotations(delta.annotations),
      ...normalizeStreamAnnotations(choice.annotations),
    ];
    if (annotations.length) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      choiceState.outputTextAnnotations.push(...annotations);
      item.content[contentIndex].annotations = clone(choiceState.outputTextAnnotations);
    }

    const logprobs = normalizeStreamTextLogprobs(choice.logprobs);
    if (Array.isArray(logprobs) && logprobs.length) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      choiceState.outputTextLogprobs.push(...logprobs);
      item.content[contentIndex].logprobs = clone(choiceState.outputTextLogprobs);
    } else if (logprobs && !Array.isArray(logprobs)) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      item.content[contentIndex].logprobs = logprobs;
    }

    if (delta.refusal) {
      events.push(...ensureRefusalPart(state, choiceState));
      const item = choiceState.messageItem;
      const outputIndex = state.response.output.indexOf(item);
      const contentIndex = item.content.findIndex((part) => part.type === "refusal");
      item.content[contentIndex].refusal += delta.refusal;
      choiceState.refusalText += delta.refusal;
      events.push({
        type: "response.refusal.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: delta.refusal,
      });
    }

    const refusalLogprobs = normalizeOutputTextLogprobs(choice.logprobs?.refusal);
    if (Array.isArray(refusalLogprobs) && refusalLogprobs.length) {
      choiceState.outputRefusalLogprobs.push(...refusalLogprobs);
    }

    for (const deltaToolCall of delta.tool_calls || []) {
      const index = deltaToolCall.index || 0;
      events.push(...ensureToolCallItem(state, choiceState, index, deltaToolCall));
      const item = choiceState.toolCalls.get(index);
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
      for (const [contentIndex, part] of item.content.entries()) {
        const doneKey = `${item.id}:${contentIndex}:${part.type}`;
        if (state.outputDone.has(doneKey)) continue;
        if (part.type === "output_text") {
          events.push({
            type: "response.output_text.done",
            response_id: state.response.id,
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            text: part.text,
          });
        } else if (part.type === "refusal") {
          events.push({
            type: "response.refusal.done",
            response_id: state.response.id,
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            refusal: part.refusal,
          });
        }
        events.push({
          type: "response.content_part.done",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part: clone(part),
        });
        state.outputDone.add(doneKey);
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

function normalizeStreamTextLogprobs(logprobs) {
  if (Array.isArray(logprobs)) return normalizeOutputTextLogprobs(logprobs);
  if (Array.isArray(logprobs?.content) || Array.isArray(logprobs?.output_text)) {
    return normalizeOutputTextLogprobs(logprobs);
  }
  return undefined;
}

function normalizeStreamAnnotations(annotations) {
  if (annotations == null) return [];
  const values = Array.isArray(annotations) ? annotations : [annotations];
  return values.filter((annotation) => annotation != null).map((annotation) => clone(annotation));
}

function streamStateToReplayMessages(state) {
  const messages = [];
  for (const choiceState of sortedChoiceStates(state)) {
    const assistant = { role: "assistant", content: choiceState.text || null };
    if (choiceState.reasoningText) assistant.reasoning_content = choiceState.reasoningText;
    if (choiceState.refusalText) assistant.refusal = choiceState.refusalText;
    const toolCalls = Array.from(choiceState.toolCalls.values()).map((item) => ({
      id: item.call_id,
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }));
    if (toolCalls.length) assistant.tool_calls = toolCalls;
    if (assistant.content !== null || assistant.tool_calls || assistant.reasoning_content || assistant.refusal) {
      messages.push(assistant);
    }
  }
  return messages;
}

function sortedChoiceStates(state) {
  return Array.from(state.choices.values()).sort((a, b) => {
    const aIndex = Number(a.index);
    const bIndex = Number(b.index);
    if (Number.isFinite(aIndex) && Number.isFinite(bIndex)) return aIndex - bIndex;
    return String(a.index).localeCompare(String(b.index));
  });
}

function streamRefusalLogprobs(state) {
  return sortedChoiceStates(state)
    .filter((choiceState) => choiceState.outputRefusalLogprobs.length)
    .map((choiceState) => ({
      choice_index: choiceState.index,
      logprobs: clone(choiceState.outputRefusalLogprobs),
    }));
}

function streamChoiceCompatibilityMetadata(state) {
  const choices = sortedChoiceStates(state);
  if (!choices.length) return {};
  return {
    chat_choices: choices.map((choiceState) => ({
      choice_index: choiceState.index,
      ...(choiceState.hasFinishReason ? { finish_reason: choiceState.finishReason } : {}),
    })),
  };
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
  if (body.store === true && body.stream && upstream.ok && isEventStreamResponse(upstream)) {
    await handleStoredChatStreamPassthrough(res, upstream, headers, body, store);
    return;
  }

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

async function handleStoredChatStreamPassthrough(res, upstream, headers, request, store) {
  const accumulator = createChatStreamAccumulator(request);
  res.writeHead(upstream.status, headers);

  try {
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") {
        res.write("data: [DONE]\n\n");
        break;
      }
      applyChatCompletionStreamChunk(accumulator, payload);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    const completion = finalizeChatStreamCompletion(accumulator);
    if (completion?.id) {
      store.put(completion.id, {
        chat_completion: completion,
        chat_messages: normalizeStoredChatMessages(request.messages, completion),
        chat_request: sanitizeChatRequest(request),
      });
    }
  } finally {
    res.end();
  }
}

function isJsonResponse(upstream) {
  return (upstream.headers.get("content-type") || "").includes("application/json");
}

function isEventStreamResponse(upstream) {
  return (upstream.headers.get("content-type") || "").includes("text/event-stream");
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleLegacyCompletions(req, res, config) {
  const request = await readJson(req);
  const prompts = normalizeCompletionPrompts(request.prompt);
  if (request.stream) {
    await handleStreamingLegacyCompletions(req, res, config, request, prompts);
    return;
  }

  const completionId = legacyCompletionId();
  let created = nowSeconds();
  const choices = [];
  const usage = emptyCompletionUsage();
  let model = request.model || config.defaultModel;
  let systemFingerprint = null;
  let sawUsage = false;

  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const prompt = prompts[promptIndex];
    const chat = legacyCompletionToChatRequest(request, prompt, config);
    const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
    const text = await upstream.text();
    const upstreamJson = parseJsonOrNull(text);
    if (!upstream.ok) {
      sendJson(res, upstream.status, upstreamJson || { error: { message: text } });
      return;
    }

    model = upstreamJson?.model || model;
    if (upstreamJson?.created && promptIndex === 0) created = upstreamJson.created;
    systemFingerprint = upstreamJson?.system_fingerprint || systemFingerprint;
    const choiceBase = promptIndex * normalizedCompletionChoiceCount(request.n);
    for (const [choiceOffset, choice] of (upstreamJson?.choices || []).entries()) {
      choices.push(chatChoiceToLegacyCompletionChoice(choice, {
        prompt,
        request,
        indexBase: choiceBase,
        fallbackIndex: choiceOffset,
      }));
    }
    if (addCompletionUsage(usage, upstreamJson?.usage)) sawUsage = true;
  }

  const response = {
    id: completionId,
    object: "text_completion",
    created,
    model,
    choices,
    ...(systemFingerprint ? { system_fingerprint: systemFingerprint } : {}),
    ...(sawUsage ? { usage } : {}),
  };
  sendJson(res, 200, response);
}

async function handleStreamingLegacyCompletions(req, res, config, request, prompts) {
  const completionId = legacyCompletionId();
  const created = nowSeconds();
  let headersWritten = false;
  const echoedChoices = new Set();

  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const prompt = prompts[promptIndex];
    const chat = legacyCompletionToChatRequest(request, prompt, config);
    const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
    if (!upstream.ok) {
      const text = await upstream.text();
      const upstreamJson = parseJsonOrNull(text);
      if (!headersWritten) {
        sendJson(res, upstream.status, upstreamJson || { error: { message: text } });
      } else {
        writeLegacyCompletionSse(res, upstreamJson || {
          error: {
            message: text || `upstream provider returned HTTP ${upstream.status}`,
            type: "upstream_provider_error",
            code: upstream.status,
          },
        });
        res.end();
      }
      return;
    }

    if (!headersWritten) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      });
      headersWritten = true;
    }

    const choiceBase = promptIndex * normalizedCompletionChoiceCount(request.n);
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") break;
      const chunk = chatStreamChunkToLegacyCompletionChunk(payload, {
        completionId,
        created,
        model: request.model || config.defaultModel,
        prompt,
        request,
        indexBase: choiceBase,
        echoedChoices,
      });
      writeLegacyCompletionSse(res, chunk);
    }
  }

  if (!headersWritten) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function legacyCompletionId() {
  return `cmpl-${crypto.randomBytes(16).toString("hex")}`;
}

function normalizeCompletionPrompts(prompt) {
  if (prompt == null) return [""];
  if (!Array.isArray(prompt)) return [stringifyContent(prompt)];
  if (!prompt.length) return [""];
  if (prompt.every((part) => Number.isInteger(part))) {
    return [prompt.map((part) => String(part)).join(" ")];
  }
  return prompt.map((part) => normalizeSingleCompletionPrompt(part));
}

function normalizeSingleCompletionPrompt(prompt) {
  if (!Array.isArray(prompt)) return stringifyContent(prompt);
  if (prompt.every((part) => Number.isInteger(part))) {
    return prompt.map((part) => String(part)).join(" ");
  }
  return prompt.map((part) => stringifyContent(part)).join("");
}

function legacyCompletionToChatRequest(request, prompt, config) {
  const chat = {
    model: request.model || config.defaultModel,
    messages: [{ role: "user", content: completionPromptForChat(prompt, request) }],
  };

  const maxTokensField = config.maxTokensField || "max_tokens";
  if (request.max_tokens != null) chat[maxTokensField] = request.max_tokens;
  for (const field of ["temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "seed", "n"]) {
    copyDefinedField(chat, request, field);
  }
  if (request.logit_bias !== undefined && config.forwardChatNativeFields !== false) {
    chat.logit_bias = clone(request.logit_bias);
  }
  if (request.logprobs != null) {
    chat.logprobs = true;
    const topLogprobs = Number(request.logprobs);
    if (Number.isFinite(topLogprobs) && topLogprobs > 0) {
      chat.top_logprobs = Math.min(20, Math.trunc(topLogprobs));
    }
  }
  mapLegacyCompletionUser(request, chat, config);
  if (request.stream) {
    chat.stream = true;
    if (config.forwardStreamOptions !== false) {
      if (request.stream_options !== undefined) {
        chat.stream_options = isPlainObject(request.stream_options)
          ? clone(request.stream_options)
          : request.stream_options;
      }
      if (config.streamIncludeUsage !== false) {
        if (!isPlainObject(chat.stream_options)) chat.stream_options = {};
        if (chat.stream_options.include_usage === undefined) chat.stream_options.include_usage = true;
      }
    }
  }

  return chat;
}

function copyDefinedField(target, source, field) {
  if (source[field] !== undefined) target[field] = clone(source[field]);
}

function completionPromptForChat(prompt, request) {
  if (request.suffix == null || request.suffix === "") return prompt;
  return [
    "Complete the prefix so it fits immediately before the suffix. Return only the missing continuation.",
    "",
    "Prefix:",
    prompt,
    "",
    "Suffix:",
    stringifyContent(request.suffix),
  ].join("\n");
}

function mapLegacyCompletionUser(request, chat, config) {
  if (request.user == null || request.user === "") return;
  if (!config.deepseekUserIdCompat) {
    chat.user = stringifyContent(request.user);
    return;
  }
  chat.user_id = normalizeProviderUserId(request.user);
}

function normalizeProviderUserId(value) {
  const raw = stringifyContent(value);
  if (/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return raw;
  return `sha256_${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

function normalizedCompletionChoiceCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

function chatChoiceToLegacyCompletionChoice(choice, { prompt, request, indexBase, fallbackIndex }) {
  const completionText = chatChoiceText(choice);
  const text = request.echo ? `${prompt}${completionText}` : completionText;
  return {
    text,
    index: indexBase + numericChoiceIndex(choice, fallbackIndex),
    logprobs: chatLogprobsToLegacyCompletionLogprobs(choice?.logprobs),
    finish_reason: choice?.finish_reason ?? null,
  };
}

function chatStreamChunkToLegacyCompletionChunk(payload, options) {
  const chunk = {
    id: options.completionId,
    object: "text_completion",
    created: payload?.created || options.created,
    model: payload?.model || options.model,
    choices: (payload?.choices || []).map((choice, fallbackIndex) => {
      const index = options.indexBase + numericChoiceIndex(choice, fallbackIndex);
      let text = chatStreamChoiceText(choice);
      if (options.request.echo && !options.echoedChoices.has(index)) {
        text = `${options.prompt}${text}`;
        options.echoedChoices.add(index);
      }
      return {
        text,
        index,
        logprobs: chatLogprobsToLegacyCompletionLogprobs(choice?.logprobs),
        finish_reason: choice?.finish_reason ?? null,
      };
    }),
  };
  if (payload?.system_fingerprint) chunk.system_fingerprint = payload.system_fingerprint;
  const usage = completionUsage(payload?.usage);
  if (usage) chunk.usage = usage;
  return chunk;
}

function numericChoiceIndex(choice, fallbackIndex) {
  const parsed = Number(choice?.index);
  if (Number.isFinite(parsed)) return Math.trunc(parsed);
  return fallbackIndex;
}

function chatChoiceText(choice) {
  if (choice?.text != null) return stringifyContent(choice.text);
  return chatContentToText(choice?.message?.content);
}

function chatStreamChoiceText(choice) {
  if (choice?.text != null) return stringifyContent(choice.text);
  return chatContentToText(choice?.delta?.content ?? choice?.message?.content ?? "");
}

function chatContentToText(content) {
  if (!Array.isArray(content)) return stringifyContent(content);
  return content
    .map((part) => stringifyContent(part?.text ?? part?.content ?? part))
    .join("");
}

function chatLogprobsToLegacyCompletionLogprobs(logprobs) {
  const content = Array.isArray(logprobs?.content) ? logprobs.content : [];
  if (!content.length) return null;
  let offset = 0;
  return {
    tokens: content.map((item) => stringifyContent(item?.token ?? "")),
    token_logprobs: content.map((item) => Number.isFinite(item?.logprob) ? item.logprob : null),
    top_logprobs: content.map((item) => {
      if (!Array.isArray(item?.top_logprobs)) return null;
      return Object.fromEntries(item.top_logprobs.map((top) => [
        stringifyContent(top?.token ?? ""),
        Number.isFinite(top?.logprob) ? top.logprob : null,
      ]));
    }),
    text_offset: content.map((item) => {
      const current = offset;
      offset += stringifyContent(item?.token ?? "").length;
      return current;
    }),
  };
}

function emptyCompletionUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addCompletionUsage(total, usage) {
  const mapped = completionUsage(usage);
  if (!mapped) return false;
  total.prompt_tokens += mapped.prompt_tokens;
  total.completion_tokens += mapped.completion_tokens;
  total.total_tokens += mapped.total_tokens;
  return true;
}

function completionUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  const totalTokens = usage.total_tokens ?? (
    Number(promptTokens || 0) + Number(completionTokens || 0)
  );
  if (![promptTokens, completionTokens, totalTokens].some((value) => Number.isFinite(Number(value)))) return null;
  return {
    prompt_tokens: Number(promptTokens || 0),
    completion_tokens: Number(completionTokens || 0),
    total_tokens: Number(totalTokens || 0),
  };
}

function writeLegacyCompletionSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createChatStreamAccumulator(request = {}) {
  return {
    id: null,
    created: null,
    model: request.model || null,
    system_fingerprint: null,
    service_tier: null,
    usage: null,
    choices: new Map(),
    request,
  };
}

function applyChatCompletionStreamChunk(accumulator, chunk) {
  if (!isPlainObject(chunk)) return;
  if (chunk.id) accumulator.id = accumulator.id || chunk.id;
  if (Number.isFinite(Number(chunk.created))) accumulator.created = accumulator.created || Number(chunk.created);
  if (chunk.model) accumulator.model = chunk.model;
  if (chunk.system_fingerprint !== undefined) accumulator.system_fingerprint = chunk.system_fingerprint;
  if (chunk.service_tier !== undefined) accumulator.service_tier = chunk.service_tier;
  if (chunk.usage) accumulator.usage = clone(chunk.usage);

  for (const choice of chunk.choices || []) {
    const index = numericChoiceIndex(choice, accumulator.choices.size);
    const state = chatStreamChoiceState(accumulator, index);
    if (choice.finish_reason !== undefined) state.finish_reason = choice.finish_reason;
    mergeChatStreamLogprobs(state, choice.logprobs);
    mergeChatStreamDelta(state, choice.delta || {});
    if (choice.message) mergeChatStreamDelta(state, choice.message);
  }
}

function chatStreamChoiceState(accumulator, index) {
  if (!accumulator.choices.has(index)) {
    accumulator.choices.set(index, {
      index,
      role: "assistant",
      content: "",
      refusal: "",
      annotations: [],
      tool_calls: [],
      function_call: null,
      audio: null,
      logprobs: null,
      finish_reason: null,
    });
  }
  return accumulator.choices.get(index);
}

function mergeChatStreamDelta(state, delta) {
  if (!isPlainObject(delta)) return;
  if (delta.role) state.role = delta.role;
  if (delta.content !== undefined && delta.content !== null) {
    state.content += chatContentToText(delta.content);
  }
  if (delta.refusal !== undefined && delta.refusal !== null) {
    state.refusal += chatContentToText(delta.refusal);
  }
  if (Array.isArray(delta.annotations)) {
    state.annotations.push(...clone(delta.annotations));
  }
  if (Array.isArray(delta.tool_calls)) {
    mergeChatStreamToolCalls(state, delta.tool_calls);
  }
  if (isPlainObject(delta.function_call)) {
    state.function_call = mergeChatStreamFunctionCall(state.function_call, delta.function_call);
  }
  if (delta.audio !== undefined) {
    state.audio = mergeChatStreamObject(state.audio, delta.audio);
  }
}

function mergeChatStreamToolCalls(state, deltas) {
  for (const delta of deltas) {
    if (!isPlainObject(delta)) continue;
    const index = Number.isFinite(Number(delta.index)) ? Number(delta.index) : state.tool_calls.length;
    const current = state.tool_calls[index] || { function: {} };
    if (delta.id) current.id = delta.id;
    if (delta.type) current.type = delta.type;
    if (isPlainObject(delta.function)) {
      current.function = mergeChatStreamFunctionCall(current.function, delta.function);
    }
    state.tool_calls[index] = current;
  }
}

function mergeChatStreamFunctionCall(current, delta) {
  const merged = current ? { ...current } : {};
  if (delta.name !== undefined) merged.name = delta.name;
  if (delta.arguments !== undefined) {
    merged.arguments = `${merged.arguments || ""}${stringifyContent(delta.arguments)}`;
  }
  return merged;
}

function mergeChatStreamObject(current, delta) {
  if (!isPlainObject(delta)) return clone(delta);
  const merged = isPlainObject(current) ? clone(current) : {};
  for (const [key, value] of Object.entries(delta)) {
    if (value === undefined) continue;
    if (typeof value === "string" && typeof merged[key] === "string") merged[key] += value;
    else merged[key] = clone(value);
  }
  return merged;
}

function mergeChatStreamLogprobs(state, logprobs) {
  if (!isPlainObject(logprobs)) return;
  if (!state.logprobs) state.logprobs = {};
  for (const key of ["content", "refusal"]) {
    if (Array.isArray(logprobs[key])) {
      if (!Array.isArray(state.logprobs[key])) state.logprobs[key] = [];
      state.logprobs[key].push(...clone(logprobs[key]));
    }
  }
}

function finalizeChatStreamCompletion(accumulator) {
  if (!accumulator.id) return null;
  const completion = {
    id: accumulator.id,
    object: "chat.completion",
    created: accumulator.created || nowSeconds(),
    model: accumulator.model || accumulator.request?.model || "unknown",
    choices: Array.from(accumulator.choices.values())
      .sort((a, b) => a.index - b.index)
      .map(finalizeChatStreamChoice),
  };
  if (accumulator.system_fingerprint !== null) completion.system_fingerprint = accumulator.system_fingerprint;
  if (accumulator.service_tier !== null) completion.service_tier = accumulator.service_tier;
  if (accumulator.usage) completion.usage = clone(accumulator.usage);
  attachStoredChatRequestFields(completion, accumulator.request);
  return completion;
}

function finalizeChatStreamChoice(state) {
  const message = {
    role: state.role || "assistant",
    content: state.content || (state.tool_calls.length || state.function_call ? null : ""),
  };
  if (state.refusal) message.refusal = state.refusal;
  if (state.annotations.length) message.annotations = clone(state.annotations);
  const toolCalls = state.tool_calls.filter(Boolean).map(normalizeStreamToolCall);
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (state.function_call) message.function_call = clone(state.function_call);
  if (state.audio) message.audio = clone(state.audio);
  return {
    index: state.index,
    message,
    logprobs: state.logprobs || null,
    finish_reason: state.finish_reason ?? null,
  };
}

function normalizeStreamToolCall(toolCall) {
  return {
    id: toolCall.id || prefixedId("call"),
    type: toolCall.type || "function",
    function: {
      name: toolCall.function?.name || "",
      arguments: toolCall.function?.arguments || "",
    },
  };
}

function attachStoredChatRequestFields(completion, request = {}) {
  const fields = [
    "metadata",
    "tool_choice",
    "seed",
    "top_p",
    "temperature",
    "presence_penalty",
    "frequency_penalty",
    "response_format",
    "tools",
    "user",
  ];
  for (const field of fields) {
    if (request[field] !== undefined && completion[field] === undefined) {
      completion[field] = clone(request[field]);
    }
  }
  if (!completion.metadata && isPlainObject(request.metadata)) completion.metadata = clone(request.metadata);
  if (!completion.metadata) completion.metadata = {};
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

async function handleEmbeddings(req, res, config) {
  const request = await readJson(req);
  let inputs = [];
  try {
    inputs = normalizeEmbeddingInputs(request.input);
  } catch (error) {
    sendError(res, error.status || 400, error.message, {
      type: "invalid_request_error",
      code: error.code || "invalid_embedding_input",
      param: "input",
    });
    return;
  }

  const dimensions = normalizeRequestedEmbeddingDimensions(request.dimensions, config);
  if (!dimensions.ok) {
    sendError(res, 400, dimensions.error, {
      type: "invalid_request_error",
      code: "invalid_embedding_dimensions",
      param: "dimensions",
    });
    return;
  }

  const encodingFormat = request.encoding_format || "float";
  if (!["float", "base64"].includes(encodingFormat)) {
    sendError(res, 400, "encoding_format must be float or base64", {
      type: "invalid_request_error",
      code: "invalid_embedding_encoding_format",
      param: "encoding_format",
    });
    return;
  }

  const model = request.model || config.embeddingsModel || `hashed-semantic-${dimensions.value}`;
  const data = inputs.map((input, index) => {
    const vector = normalizedEmbeddingVector(input.text, dimensions.value);
    return {
      object: "embedding",
      embedding: encodingFormat === "base64" ? embeddingVectorToBase64(vector) : vector,
      index,
    };
  });
  const promptTokens = inputs.reduce((sum, input) => sum + input.tokens, 0);

  sendJson(res, 200, {
    object: "list",
    data,
    model,
    usage: {
      prompt_tokens: promptTokens,
      total_tokens: promptTokens,
    },
    compatibility: {
      provider: "local",
      model: "hashed-semantic",
      dimensions: dimensions.value,
      encoding_format: encodingFormat,
      reason: "chat_provider_embedding_compatibility",
    },
  });
}

function normalizeEmbeddingInputs(input) {
  if (input === undefined || input === null) {
    const error = new Error("input is required");
    error.status = 400;
    throw error;
  }

  if (Array.isArray(input)) {
    if (!input.length) {
      const error = new Error("input array must not be empty");
      error.status = 400;
      throw error;
    }
    if (input.every((item) => Number.isInteger(item))) {
      return [embeddingInputFromTokenIds(input)];
    }
    return input.map((item) => Array.isArray(item) && item.every((token) => Number.isInteger(token))
      ? embeddingInputFromTokenIds(item)
      : embeddingInputFromText(item));
  }

  return [embeddingInputFromText(input)];
}

function embeddingInputFromTokenIds(tokens) {
  return {
    text: tokens.map((token) => String(token)).join(" "),
    tokens: tokens.length,
  };
}

function embeddingInputFromText(value) {
  const text = stringifyContent(value);
  return {
    text,
    tokens: estimateEmbeddingTokens(text),
  };
}

function estimateEmbeddingTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.max(words, Math.ceil(normalized.length / 4)));
}

function normalizeRequestedEmbeddingDimensions(value, config) {
  const fallback = Number(config.embeddingsDimensions || LOCAL_EMBEDDING_DIMENSIONS);
  if (value == null) return { ok: true, value: fallback };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3072 || Math.trunc(parsed) !== parsed) {
    return { ok: false, error: "dimensions must be an integer between 1 and 3072" };
  }
  return { ok: true, value: parsed };
}

function normalizedEmbeddingVector(text, dimensions) {
  const vector = semanticVector(text, dimensions);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector.map(() => 0);
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function embeddingVectorToBase64(vector) {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer.toString("base64");
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

async function handleChatCompletionUpdate(req, res, store, completionId) {
  const body = await readJson(req);
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const keys = Object.keys(isPlainObject(body) ? body : {});
  const unsupported = keys.filter((key) => key !== "metadata");
  if (!keys.includes("metadata") || unsupported.length || !isPlainObject(body.metadata)) {
    sendError(res, 400, "only metadata updates are supported for stored chat completions", {
      type: "invalid_request_error",
      param: unsupported[0] || "metadata",
      code: "unsupported_chat_completion_update",
    });
    return;
  }

  const metadata = clone(body.metadata);
  const updatedRecord = {
    ...record,
    chat_completion: {
      ...record.chat_completion,
      metadata,
    },
    chat_request: {
      ...(record.chat_request || {}),
      metadata,
    },
  };
  store.put(completionId, updatedRecord);
  sendJson(res, 200, updatedRecord.chat_completion);
}

function handleChatCompletionDelete(res, store, completionId) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const deleted = store.delete(completionId);
  if (!deleted) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  sendJson(res, 200, {
    id: completionId,
    object: "chat.completion.deleted",
    deleted: true,
  });
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

async function handleConversationCreate(req, res, conversationStore) {
  const body = await readJson(req);
  sendJson(res, 200, conversationStore.create(body));
}

function handleConversationGet(res, conversationStore, conversationId) {
  const record = conversationStore.get(conversationId);
  if (!record) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, {
    id: record.id,
    object: "conversation",
    created_at: record.created_at,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
  });
}

async function handleConversationUpdate(req, res, conversationStore, conversationId) {
  const body = await readJson(req);
  const keys = Object.keys(isPlainObject(body) ? body : {});
  const unsupported = keys.filter((key) => key !== "metadata");
  if (unsupported.length || (keys.length && !isPlainObject(body.metadata))) {
    sendError(res, 400, "only metadata updates are supported for conversations", {
      type: "invalid_request_error",
      param: unsupported[0] || "metadata",
      code: "unsupported_conversation_update",
    });
    return;
  }
  const conversation = conversationStore.update(conversationId, body);
  if (!conversation) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, conversation);
}

function handleConversationDelete(res, conversationStore, conversationId) {
  const deleted = conversationStore.delete(conversationId);
  if (!deleted) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleConversationItemsCreate(req, res, conversationStore, conversationId) {
  const body = await readJson(req);
  const inputItems = Object.prototype.hasOwnProperty.call(body, "items")
    ? body.items
    : Object.prototype.hasOwnProperty.call(body, "item")
      ? body.item
      : body;
  const items = conversationStore.appendItems(conversationId, inputItems);
  if (!items) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, Array.isArray(inputItems) ? paginateList(items, new URL("http://local/?limit=100")) : items[0]);
}

function handleConversationItemsList(res, conversationStore, conversationId, url) {
  const items = conversationStore.listItems(conversationId);
  if (!items) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, paginateList(items, url));
}

function handleConversationItemGet(res, conversationStore, conversationId, itemId) {
  const item = conversationStore.getItem(conversationId, itemId);
  if (!item) {
    sendError(res, 404, `conversation item not found: ${itemId}`, { code: "conversation_item_not_found" });
    return;
  }
  sendJson(res, 200, item);
}

function handleConversationItemDelete(res, conversationStore, conversationId, itemId) {
  const deleted = conversationStore.deleteItem(conversationId, itemId);
  if (!deleted) {
    sendError(res, 404, `conversation item not found: ${itemId}`, { code: "conversation_item_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
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
  const conversationStore = config.conversationStore || new FileConversationStore({ dir: config.conversationStateDir });
  const fileSearchStore = config.fileSearchStore || new LocalFileSearchStore(config);
  const uploadStore = config.uploadStore || new LocalUploadStore(config);
  const containerStore = config.containerStore || new LocalContainerStore(config);
  const skillStore = config.skillStore || new LocalSkillStore(config);
  const backgroundJobs = new Map();
  const reconciledBackgroundJobs = reconcileStaleBackgroundResponses(store);
  if (reconciledBackgroundJobs) {
    log("reconciled stale background responses after startup", { count: reconciledBackgroundJobs });
  }

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

      if (req.method === "POST" && url.pathname === "/v1/embeddings") {
        await handleEmbeddings(req, res, config);
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

      if (url.pathname === "/v1/skills") {
        if (req.method === "GET") {
          handleSkillsList(res, skillStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleSkillCreate(req, res, config, skillStore);
          return;
        }
      }

      const skillVersionsRoute = url.pathname.match(/^\/v1\/skills\/([^/]+)\/versions(?:\/([^/]+)(?:\/(content))?)?$/);
      if (skillVersionsRoute) {
        const skillId = decodeURIComponent(skillVersionsRoute[1]);
        const version = skillVersionsRoute[2] ? decodeURIComponent(skillVersionsRoute[2]) : "";
        const action = skillVersionsRoute[3] || "";
        if (!version && req.method === "GET") {
          handleSkillVersionsList(res, skillStore, skillId, url);
          return;
        }
        if (!version && req.method === "POST") {
          await handleSkillVersionCreate(req, res, config, skillStore, skillId);
          return;
        }
        if (version && action === "content" && req.method === "GET") {
          handleSkillContent(res, skillStore, skillId, version);
          return;
        }
        if (version && !action && req.method === "GET") {
          handleSkillVersionGet(res, skillStore, skillId, version);
          return;
        }
        if (version && !action && req.method === "DELETE") {
          handleSkillVersionDelete(res, skillStore, skillId, version);
          return;
        }
      }

      const skillRoute = url.pathname.match(/^\/v1\/skills\/([^/]+)(?:\/(content))?$/);
      if (skillRoute) {
        const skillId = decodeURIComponent(skillRoute[1]);
        const action = skillRoute[2] || "";
        if (action === "content" && req.method === "GET") {
          handleSkillContent(res, skillStore, skillId, "default");
          return;
        }
        if (!action && req.method === "GET") {
          handleSkillGet(res, skillStore, skillId);
          return;
        }
        if (!action && req.method === "POST") {
          await handleSkillUpdate(req, res, skillStore, skillId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleSkillDelete(res, skillStore, skillId);
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

      if (url.pathname === "/v1/uploads" && req.method === "POST") {
        await handleUploadCreate(req, res, uploadStore);
        return;
      }

      const uploadRoute = url.pathname.match(/^\/v1\/uploads\/([^/]+)\/(parts|complete|cancel)$/);
      if (uploadRoute) {
        const uploadId = decodeURIComponent(uploadRoute[1]);
        const action = uploadRoute[2];
        if (action === "parts" && req.method === "POST") {
          await handleUploadPartCreate(req, res, config, uploadStore, uploadId);
          return;
        }
        if (action === "complete" && req.method === "POST") {
          await handleUploadComplete(req, res, uploadStore, fileSearchStore, uploadId);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleUploadCancel(res, uploadStore, uploadId);
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

      const vectorStoreFileBatchesRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/file_batches(?:\/([^/]+)(?:\/(files|cancel))?)?$/);
      if (vectorStoreFileBatchesRoute) {
        const storeId = decodeURIComponent(vectorStoreFileBatchesRoute[1]);
        const batchId = vectorStoreFileBatchesRoute[2] ? decodeURIComponent(vectorStoreFileBatchesRoute[2]) : "";
        const action = vectorStoreFileBatchesRoute[3] || "";
        if (!batchId && req.method === "POST") {
          await handleVectorStoreFileBatchCreate(req, res, fileSearchStore, storeId);
          return;
        }
        if (batchId && !action && req.method === "GET") {
          handleVectorStoreFileBatchGet(res, fileSearchStore, storeId, batchId);
          return;
        }
        if (batchId && action === "files" && req.method === "GET") {
          handleVectorStoreFileBatchFilesList(res, fileSearchStore, storeId, batchId, url);
          return;
        }
        if (batchId && action === "cancel" && req.method === "POST") {
          handleVectorStoreFileBatchCancel(res, fileSearchStore, storeId, batchId);
          return;
        }
      }

      const vectorStoreFilesRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/files(?:\/([^/]+)(?:\/(content))?)?$/);
      if (vectorStoreFilesRoute) {
        const storeId = decodeURIComponent(vectorStoreFilesRoute[1]);
        const fileId = vectorStoreFilesRoute[2] ? decodeURIComponent(vectorStoreFilesRoute[2]) : "";
        const action = vectorStoreFilesRoute[3] || "";
        if (!fileId && req.method === "GET") {
          handleVectorStoreFilesList(res, fileSearchStore, storeId, url);
          return;
        }
        if (!fileId && req.method === "POST") {
          await handleVectorStoreFileCreate(req, res, fileSearchStore, storeId);
          return;
        }
        if (fileId && !action && req.method === "GET") {
          handleVectorStoreFileGet(res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && !action && req.method === "POST") {
          await handleVectorStoreFileUpdate(req, res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && !action && req.method === "DELETE") {
          handleVectorStoreFileDelete(res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && action === "content" && req.method === "GET") {
          handleVectorStoreFileContent(res, fileSearchStore, storeId, fileId);
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
        if (req.method === "POST") {
          await handleVectorStoreUpdate(req, res, fileSearchStore, storeId);
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

      if (url.pathname === "/v1/conversations") {
        if (req.method === "POST") {
          await handleConversationCreate(req, res, conversationStore);
          return;
        }
      }

      const conversationItemsRoute = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/items(?:\/([^/]+))?$/);
      if (conversationItemsRoute) {
        const conversationId = decodeURIComponent(conversationItemsRoute[1]);
        const itemId = conversationItemsRoute[2] ? decodeURIComponent(conversationItemsRoute[2]) : "";
        if (!itemId && req.method === "GET") {
          handleConversationItemsList(res, conversationStore, conversationId, url);
          return;
        }
        if (!itemId && req.method === "POST") {
          await handleConversationItemsCreate(req, res, conversationStore, conversationId);
          return;
        }
        if (itemId && req.method === "GET") {
          handleConversationItemGet(res, conversationStore, conversationId, itemId);
          return;
        }
        if (itemId && req.method === "DELETE") {
          handleConversationItemDelete(res, conversationStore, conversationId, itemId);
          return;
        }
      }

      const conversationRoute = url.pathname.match(/^\/v1\/conversations\/([^/]+)$/);
      if (conversationRoute) {
        const conversationId = decodeURIComponent(conversationRoute[1]);
        if (req.method === "GET") {
          handleConversationGet(res, conversationStore, conversationId);
          return;
        }
        if (req.method === "POST") {
          await handleConversationUpdate(req, res, conversationStore, conversationId);
          return;
        }
        if (req.method === "DELETE") {
          handleConversationDelete(res, conversationStore, conversationId);
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, containerStore, conversationStore, skillStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        await handleResponseCompact(req, res, config, store, fileSearchStore, conversationStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/input_tokens") {
        await handleResponseInputTokens(req, res, config, store, fileSearchStore, conversationStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/completions") {
        await handleLegacyCompletions(req, res, config);
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
        if (!action && req.method === "POST") {
          await handleChatCompletionUpdate(req, res, store, completionId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleChatCompletionDelete(res, store, completionId);
          return;
        }
        if (action === "messages" && req.method === "GET") {
          handleChatCompletionMessages(res, store, completionId, url);
          return;
        }
      }

      sendError(res, 404, "not found");
    } catch (error) {
      sendError(res, error.status || 500, error.message || "internal server error", {
        code: error.code,
        param: error.param,
        type: error.type,
      });
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
