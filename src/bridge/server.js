"use strict";

const http = require("node:http");
const path = require("node:path");
const { FileResponseStore } = require("./store");
const {
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  createResponseSkeleton,
  prefixedId,
  responsesToChatRequest,
  stringifyContent,
} = require("./translator");

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
    stateDir: process.env.CODEXCOMPAT_STATE_DIR || path.join(process.cwd(), "state", "responses-bridge"),
    requestTimeoutMs: numberFromEnv("CODEXCOMPAT_REQUEST_TIMEOUT_MS", 10 * 60 * 1000, 5000, 60 * 60 * 1000),
    deepseekReasoningEffortCompat: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT, true),
    deepseekThinkingMode: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_THINKING_MODE, false),
    deepseekDisableThinkingForToolChoice: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE, true),
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
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
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

async function fetchProvider(config, route, body, incomingHeaders = {}, options = {}) {
  if (!config.providerApiKey && !options.allowMissingKey) {
    const error = new Error(`${config.providerApiKeyEnv} is required for upstream provider calls`);
    error.status = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
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

async function handleResponses(req, res, config, store) {
  const request = await readJson(req);
  const responseId = prefixedId("resp");
  const previousMessages = request.previous_response_id ? store.getMessages(request.previous_response_id) : [];
  const { chat, compatibility } = responsesToChatRequest(request, previousMessages, config);
  chat.model = chat.model || config.defaultModel;

  if (chat.stream) {
    await handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility);
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

async function handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility) {
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
    toolCalls: new Map(),
    outputDone: new Set(),
    usage: null,
  };
}

function sequence(state, event) {
  state.sequenceNumber += 1;
  return { sequence_number: state.sequenceNumber, ...event };
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

async function handleChatPassthrough(req, res, config) {
  const body = await readJson(req);
  const upstream = await fetchProvider(config, config.chatCompletionsPath, body, req.headers);
  res.writeHead(upstream.status, proxyResponseHeaders(upstream));
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
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

async function handleModels(req, res, config) {
  if (config.providerApiKey) {
    try {
      const upstream = await fetch(`${config.providerBaseUrl}${config.modelsPath}`, {
        headers: providerHeaders(config, req.headers),
      });
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
    data: [{
      id: config.defaultModel,
      object: "model",
      created: 0,
      owned_by: "compatibility-bridge",
    }],
  });
}

function handleResponseGet(res, store, responseId) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  sendJson(res, 200, record.response);
}

function handleResponseDelete(res, store, responseId) {
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

function handleResponseCancel(res, store, responseId) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
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

function handleUnsupportedResponseEndpoint(res, name) {
  sendError(res, 501, `${name} requires native Responses API semantics and is not emulated by this chat provider bridge yet`, {
    type: "unsupported_compatibility_feature",
    code: "unsupported_endpoint",
  });
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

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses(req, res, config, store);
        return;
      }

      if (url.pathname === "/v1/responses/compact") {
        handleUnsupportedResponseEndpoint(res, "response compaction");
        return;
      }

      if (url.pathname === "/v1/responses/input_tokens") {
        handleUnsupportedResponseEndpoint(res, "response input token estimation");
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
          handleResponseDelete(res, store, responseId);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleResponseCancel(res, store, responseId);
          return;
        }
        if (action === "input_items" && req.method === "GET") {
          handleResponseInputItems(res, store, responseId, url);
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await handleChatPassthrough(req, res, config);
        return;
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
