"use strict";

const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const MCP_TOOL_TYPES = new Set(["mcp"]);
const MCP_CONTEXT_ITEM_TYPES = new Set([
  "mcp_list_tools",
  "mcp_call",
  "mcp_approval_request",
  "mcp_approval_response",
]);
const MAX_PROMPT_TEXT = 4000;
const DEFAULT_MCP_TIMEOUT_MS = 5000;
const DEFAULT_MCP_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MCP_MAX_TOOLS = 128;
const DEFAULT_MCP_PROTOCOL_VERSION = "2025-03-26";
const DEFAULT_MCP_CLIENT_NAME = "open-codex-responses-bridge";
const DEFAULT_MCP_MAX_TOOL_OUTPUT_CHARS = 20000;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isMcpTool(tool) {
  return isPlainObject(tool) && MCP_TOOL_TYPES.has(tool.type);
}

function canUseLocalMcp(config = {}) {
  return String(config.mcpProvider || "local").toLowerCase() !== "disabled";
}

function localMcpToolTypes(tools = [], config = {}) {
  if (!canUseLocalMcp(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isMcpTool)
    .map((tool) => tool.type)));
}

async function prepareMcpContext(request = {}, config = {}, options = {}) {
  const tools = (request.tools || []).filter(isMcpTool);
  if (!tools.length || !canUseLocalMcp(config)) return null;

  const context = {
    provider: "local",
    status: "completed",
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    servers: [],
    list_tools_items: [],
    input_items: [
      ...extractMcpContextItems(options.previousResponse?.output),
      ...extractMcpContextItems(request.input),
    ],
    requested_tool_choice: normalizeMcpRequestedToolChoice(request.tool_choice),
    approval_request_items: [],
    call_items: [],
    execution_items: [],
    skipped_calls: [],
    warnings: [],
  };
  const labels = new Set();

  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index];
    const server = normalizeMcpServer(tool, index);
    Object.defineProperty(server, "_remote_tool_config", {
      value: tool,
      enumerable: false,
      writable: false,
    });
    if (labels.has(server.server_label)) {
      server.duplicate_label = true;
      context.warnings.push(`duplicate server_label: ${server.server_label}`);
    }
    labels.add(server.server_label);
    context.servers.push(server);

    if (!reserveToolCall(options.toolBudget, {
      type: "mcp_list_tools",
      tool_type: "mcp",
      server_label: server.server_label,
    })) {
      context.status = "skipped";
      context.skipped_calls.push({
        action: "list_tools",
        server_label: server.server_label,
        reason: "max_tool_calls_exhausted",
      });
      continue;
    }

    if (shouldImportRemoteTools(tool, server, config)) {
      const remoteImport = await importRemoteMcpTools(tool, server, config);
      server.remote_import_attempted = true;
      server.remote_import_status = remoteImport.status;
      server.remote_import_protocol_version = remoteImport.protocol_version || "";
      server.remote_import_remote_tool_count = remoteImport.remote_tool_count || 0;
      server.remote_import_session = remoteImport.session ? "established" : "";
      Object.defineProperty(server, "_remote_session_id", {
        value: remoteImport.session_id || null,
        enumerable: false,
        writable: true,
      });
      if (remoteImport.ok) {
        server.imported_tools = remoteImport.tools;
        server.import_source = "remote_tools_list";
        server.import_error = null;
      } else {
        server.imported_tools = [];
        server.import_source = "remote_tools_list_failed";
        server.import_error = {
          code: remoteImport.code || "mcp_remote_list_tools_failed",
          message: remoteImport.message || "remote MCP tools/list failed",
        };
        context.warnings.push(`${server.server_label} remote tools/list failed: ${server.import_error.code}`);
      }
    }

    context.list_tools_items.push({
      id: prefixedId("mcpl"),
      type: "mcp_list_tools",
      server_label: server.server_label,
      tools: server.imported_tools.map((toolDefinition) => clone(toolDefinition)),
      ...(server.import_error ? { error: server.import_error } : {}),
    });
  }

  if (context.warnings.length && context.status === "completed") context.status = "warning";
  return context;
}

function normalizeMcpServer(tool = {}, index = 0) {
  const label = safeLabel(tool.server_label || tool.connector_id || hostLabel(tool.server_url) || `mcp_${index + 1}`);
  const allowedToolNames = allowedTools(tool);
  const explicitToolDefinitions = explicitTools(tool);
  const importedTools = explicitToolDefinitions.length
    ? explicitToolDefinitions
    : tool.defer_loading
      ? []
      : allowedToolNames.map((name) => syntheticMcpToolDefinition(name, label));
  const hasLocation = !!(tool.server_url || tool.connector_id);
  return {
    server_label: label,
    server_description: stringifyOptional(tool.server_description),
    server_kind: tool.connector_id ? "connector" : "remote_mcp",
    server_url_host: hostLabel(tool.server_url),
    connector_id: stringifyOptional(tool.connector_id),
    has_authorization: tool.authorization != null || hasAuthorizationHeader(tool.headers),
    require_approval: normalizeRequireApproval(tool.require_approval),
    allowed_tools: allowedToolNames,
    defer_loading: !!tool.defer_loading,
    imported_tools: importedTools,
    import_source: explicitToolDefinitions.length
      ? "explicit_tool_definitions"
      : tool.defer_loading
        ? "deferred"
        : allowedToolNames.length
          ? "allowed_tools_synthetic"
          : "empty",
    explicit_tool_count: explicitToolDefinitions.length,
    import_error: hasLocation ? null : {
      code: "mcp_server_location_missing",
      message: "mcp tool requires server_url or connector_id for hosted execution",
    },
  };
}

function shouldImportRemoteTools(tool, server, config = {}) {
  return config.mcpRemoteListTools !== false
    && server.server_kind === "remote_mcp"
    && !!tool.server_url
    && !tool.connector_id
    && !server.defer_loading
    && !server.explicit_tool_count;
}

async function importRemoteMcpTools(tool, server, config = {}) {
  const session = {
    id: null,
  };
  try {
    const initialize = await sendMcpJsonRpc(tool, config, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: config.mcpProtocolVersion || DEFAULT_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: config.mcpClientName || DEFAULT_MCP_CLIENT_NAME,
          version: "0.2.0",
        },
      },
    }, session);
    if (initialize.error) throw jsonRpcError("mcp_initialize_failed", initialize.error);

    await sendMcpNotification(tool, config, {
      method: "notifications/initialized",
    }, session);

    const allowed = new Set(server.allowed_tools || []);
    const tools = [];
    let seenToolCount = 0;
    let cursor = null;
    let pages = 0;
    const maxTools = boundedNumber(config.mcpMaxTools, DEFAULT_MCP_MAX_TOOLS, 1, 1000);
    do {
      const response = await sendMcpJsonRpc(tool, config, {
        id: 2 + pages,
        method: "tools/list",
        ...(cursor ? { params: { cursor } } : {}),
      }, session);
      if (response.error) throw jsonRpcError("mcp_tools_list_failed", response.error);
      const result = isPlainObject(response.result) ? response.result : {};
      const pageTools = Array.isArray(result.tools) ? result.tools : [];
      for (const item of pageTools) {
        seenToolCount += 1;
        const normalized = normalizeRemoteToolDefinition(item);
        if (!normalized) continue;
        if (!normalized.name) continue;
        if (allowed.size && !allowed.has(normalized.name)) continue;
        tools.push(normalized);
        if (tools.length >= maxTools) break;
      }
      cursor = stringifyOptional(result.nextCursor || result.next_cursor);
      pages += 1;
    } while (cursor && tools.length < maxTools && pages < 20);

    return {
      ok: true,
      status: "completed",
      tools,
      remote_tool_count: seenToolCount,
      protocol_version: stringifyOptional(initialize.result?.protocolVersion),
      session: !!session.id,
      session_id: session.id || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      code: error.code || (error.name === "AbortError" ? "mcp_remote_timeout" : "mcp_remote_list_tools_failed"),
      message: safeErrorMessage(error),
      session: !!session.id,
    };
  }
}

async function sendMcpJsonRpc(tool, config, request, session) {
  const response = await fetchMcpEndpoint(tool, config, request, session);
  const payload = await readMcpResponsePayload(response, config, request.id);
  const message = findJsonRpcResponse(payload, request.id);
  if (!message) {
    const error = new Error(`MCP server did not return JSON-RPC response for id ${request.id}`);
    error.code = "mcp_remote_missing_jsonrpc_response";
    throw error;
  }
  return message;
}

async function sendMcpNotification(tool, config, notification, session) {
  const response = await fetchMcpEndpoint(tool, config, {
    jsonrpc: "2.0",
    ...notification,
  }, session);
  if (!response.ok) {
    const error = new Error(`MCP notification failed with HTTP ${response.status}`);
    error.code = "mcp_remote_notification_failed";
    throw error;
  }
}

async function fetchMcpEndpoint(tool, config, message, session) {
  const url = remoteMcpUrl(tool.server_url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedNumber(config.mcpTimeoutMs, DEFAULT_MCP_TIMEOUT_MS, 500, 60000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: remoteMcpHeaders(tool, session?.id),
      body: JSON.stringify(message.jsonrpc ? message : { jsonrpc: "2.0", ...message }),
      signal: controller.signal,
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (session && sessionId) session.id = sessionId;
    if (!response.ok) {
      const error = new Error(`MCP server returned HTTP ${response.status}`);
      error.code = "mcp_remote_http_error";
      throw error;
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function remoteMcpUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    const error = new Error("MCP server_url is not a valid URL");
    error.code = "mcp_remote_invalid_server_url";
    throw error;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    const error = new Error("MCP server_url must use http or https");
    error.code = "mcp_remote_invalid_server_url";
    throw error;
  }
  return url.toString();
}

function remoteMcpHeaders(tool, sessionId = null) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
  };
  if (isPlainObject(tool.headers)) {
    for (const [key, value] of Object.entries(tool.headers)) {
      const normalized = key.toLowerCase();
      if (["host", "content-length", "connection"].includes(normalized)) continue;
      if (value == null) continue;
      headers[key] = String(value);
    }
  }
  if (tool.authorization != null) {
    if (hasAuthorizationHeader(tool.headers)) {
      const error = new Error("MCP tool cannot include both authorization and headers.Authorization");
      error.code = "mcp_authorization_conflict";
      throw error;
    }
    headers.authorization = authorizationHeaderValue(tool.authorization);
  }
  if (sessionId) headers["mcp-session-id"] = sessionId;
  return headers;
}

function authorizationHeaderValue(value) {
  const text = stringifyOptional(value).trim();
  if (!text) return "";
  return /^bearer\s+/i.test(text) ? text : `Bearer ${text}`;
}

async function readMcpResponsePayload(response, config, requestId) {
  const contentType = response.headers.get("content-type") || "";
  const text = await readBoundedResponseText(response, boundedNumber(config.mcpMaxResponseBytes, DEFAULT_MCP_MAX_RESPONSE_BYTES, 4096, 8 * DEFAULT_MCP_MAX_RESPONSE_BYTES));
  if (!text.trim()) {
    const error = new Error(`MCP server returned an empty response for id ${requestId}`);
    error.code = "mcp_remote_empty_response";
    throw error;
  }
  if (/text\/event-stream/i.test(contentType)) {
    return parseSseJsonMessages(text);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    error.code = "mcp_remote_invalid_json";
    throw error;
  }
}

async function readBoundedResponseText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      const error = new Error("MCP response exceeded byte limit");
      error.code = "mcp_remote_response_too_large";
      throw error;
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      const error = new Error("MCP response exceeded byte limit");
      error.code = "mcp_remote_response_too_large";
      throw error;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseSseJsonMessages(text) {
  const messages = [];
  for (const frame of text.split(/\n\n/)) {
    if (!frame.trim()) continue;
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) messages.push(...parsed);
    else messages.push(parsed);
  }
  return messages;
}

function findJsonRpcResponse(payload, id) {
  const values = Array.isArray(payload) ? payload : [payload];
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = findJsonRpcResponse(value, id);
      if (nested) return nested;
      continue;
    }
    if (isPlainObject(value) && value.id === id) return value;
  }
  return null;
}

function jsonRpcError(code, error) {
  const thrown = new Error(error?.message || code);
  thrown.code = code;
  thrown.remote_error = isPlainObject(error) ? clone(error) : error;
  return thrown;
}

function normalizeRemoteToolDefinition(definition = {}) {
  if (!isPlainObject(definition)) return null;
  const schema = isPlainObject(definition.inputSchema)
    ? definition.inputSchema
    : isPlainObject(definition.input_schema)
      ? definition.input_schema
      : isPlainObject(definition.parameters)
        ? definition.parameters
        : { type: "object", additionalProperties: true };
  return {
    annotations: definition.annotations ?? null,
    description: stringifyOptional(definition.description),
    input_schema: clone(schema),
    name: stringifyOptional(definition.name),
  };
}

function injectMcpChatTools(chat, context, config = {}, options = {}) {
  if (!chat || !context || config.mcpRemoteToolCalls === false) return;
  if (options.toolBudget && options.toolBudget.used >= options.toolBudget.limit) return;
  const tools = [];
  const map = new Map();
  const usedNames = new Set((chat.tools || [])
    .map((tool) => tool?.function?.name)
    .filter(Boolean));
  for (const server of context.servers || []) {
    if (server.server_kind !== "remote_mcp" || server.remote_import_status !== "completed") continue;
    if (!server._remote_tool_config?.server_url) continue;
    for (const tool of server.imported_tools || []) {
      const approvalMode = mcpApprovalModeForTool(server.require_approval, tool.name);
      const functionName = mcpChatFunctionName(server.server_label, tool.name, usedNames);
      usedNames.add(functionName);
      map.set(functionName, {
        server_label: server.server_label,
        tool_name: tool.name,
        server,
        approval_required: approvalMode !== "auto",
      });
      tools.push({
        type: "function",
        function: {
          name: functionName,
          description: [
            `Call MCP tool ${tool.name} on server ${server.server_label}.`,
            tool.description || "",
          ].filter(Boolean).join(" "),
          parameters: isPlainObject(tool.input_schema)
            ? clone(tool.input_schema)
            : { type: "object", additionalProperties: true },
        },
      });
    }
  }
  if (!tools.length) return;
  if (!Array.isArray(chat.tools)) chat.tools = [];
  chat.tools.push(...tools);
  context.chat_tool_map = map;
  context.remote_call_tool_count = tools.length;
  applyMcpChatToolChoice(chat, context);
}

function normalizeMcpRequestedToolChoice(toolChoice) {
  if (toolChoice == null) return null;
  if (typeof toolChoice === "string") {
    const value = stringifyOptional(toolChoice);
    if (["auto", "none", "required"].includes(value)) {
      return { type: value, value };
    }
    return { type: "unsupported", value, reason: "unsupported_string_tool_choice" };
  }
  if (!isPlainObject(toolChoice)) {
    return { type: "unsupported", value: stringifyOptional(toolChoice), reason: "unsupported_tool_choice" };
  }

  if (toolChoice.type === "function") {
    const name = stringifyOptional(toolChoice.name || toolChoice.function?.name);
    return name
      ? { type: "function", name }
      : { type: "unsupported", value: clone(toolChoice), reason: "missing_function_name" };
  }

  if (toolChoice.type === "mcp") {
    const name = stringifyOptional(toolChoice.name || toolChoice.tool_name);
    const serverLabel = stringifyOptional(toolChoice.server_label || toolChoice.serverLabel);
    return name
      ? { type: "mcp", name, ...(serverLabel ? { server_label: serverLabel } : {}) }
      : { type: "unsupported", value: clone(toolChoice), reason: "missing_mcp_tool_name" };
  }

  return { type: "unsupported", value: clone(toolChoice), reason: "unsupported_object_tool_choice" };
}

function applyMcpChatToolChoice(chat, context) {
  const requested = context.requested_tool_choice;
  const existing = normalizeMcpExistingChatToolChoice(chat.tool_choice);

  if (requested?.type === "function" || requested?.type === "mcp") {
    const resolved = resolveMcpChatToolChoice(context.chat_tool_map, requested);
    context.tool_choice_mapping = {
      source: "tool_choice",
      requested_type: requested.type,
      requested_name: requested.name,
      ...(requested.server_label ? { requested_server_label: requested.server_label } : {}),
      match_count: resolved.matches.length,
      forwarded: resolved.matches.length === 1,
      ...(resolved.matches.length === 1
        ? {
          target: "function",
          chat_name: resolved.matches[0].functionName,
          reason: "mcp_tool_choice_mapped",
        }
        : {
          reason: resolved.matches.length ? "ambiguous_mcp_tool_choice" : "mcp_tool_choice_not_found",
        }),
    };
    if (resolved.matches.length === 1) {
      chat.tool_choice = {
        type: "function",
        function: { name: resolved.matches[0].functionName },
      };
      return;
    }
  } else if (requested && ["auto", "none", "required"].includes(requested.type)) {
    if (chat.tool_choice === undefined) chat.tool_choice = requested.type;
    context.tool_choice_mapping = {
      source: "tool_choice",
      value: requested.type,
      target: "tool_choice",
      forwarded: chat.tool_choice === requested.type,
      reason: chat.tool_choice === requested.type ? "mcp_tool_choice_passthrough" : "chat_tool_choice_already_set",
    };
    return;
  } else if (requested?.type === "unsupported") {
    context.tool_choice_mapping = {
      source: "tool_choice",
      forwarded: false,
      reason: requested.reason,
    };
  }

  if (existing?.type === "function") {
    const resolved = resolveMcpChatToolChoice(context.chat_tool_map, existing);
    if (resolved.matches.length === 1) {
      chat.tool_choice = {
        type: "function",
        function: { name: resolved.matches[0].functionName },
      };
      context.tool_choice_mapping = {
        source: "chat_tool_choice",
        requested_type: "function",
        requested_name: existing.name,
        match_count: 1,
        forwarded: true,
        target: "function",
        chat_name: resolved.matches[0].functionName,
        reason: "mcp_chat_tool_choice_mapped",
      };
      return;
    }
  }

  if (chat.tool_choice === undefined) chat.tool_choice = "auto";
}

function normalizeMcpExistingChatToolChoice(toolChoice) {
  if (!isPlainObject(toolChoice) || toolChoice.type !== "function") return null;
  const name = stringifyOptional(toolChoice.name || toolChoice.function?.name);
  return name ? { type: "function", name } : null;
}

function resolveMcpChatToolChoice(chatToolMap, requested) {
  const matches = [];
  if (!chatToolMap || !requested?.name) return { matches };
  for (const [functionName, mapping] of chatToolMap.entries()) {
    if (mapping.tool_name !== requested.name) continue;
    if (requested.server_label && mapping.server_label !== requested.server_label) continue;
    matches.push({ functionName, mapping });
  }
  return { matches };
}

function canAutoCallMcpTool(requireApproval, toolName) {
  return mcpApprovalModeForTool(requireApproval, toolName) === "auto";
}

function mcpApprovalModeForTool(requireApproval, toolName) {
  if (requireApproval === "never") return "auto";
  if (requireApproval === "always" || requireApproval === "default") return "approval_required";
  if (!isPlainObject(requireApproval)) return "approval_required";
  const never = requireApproval.never || requireApproval.never_require_approval;
  const always = requireApproval.always || requireApproval.always_require_approval;
  if (toolNameMatchesApproval(always, toolName)) return "approval_required";
  if (never === true || never === "all" || never === "*") return "auto";
  return toolNameMatchesApproval(never, toolName) ? "auto" : "approval_required";
}

function toolNameMatchesApproval(value, toolName) {
  if (!value) return false;
  if (Array.isArray(value)) return value.map(stringifyOptional).includes(toolName);
  if (typeof value === "string") return value === toolName || value === "*" || value === "all";
  if (!isPlainObject(value)) return false;
  const names = [
    ...(Array.isArray(value.tool_names) ? value.tool_names : []),
    ...(Array.isArray(value.tools) ? value.tools : []),
    ...(Array.isArray(value.names) ? value.names : []),
  ].map(stringifyOptional);
  return names.includes(toolName) || names.includes("*");
}

function mcpChatFunctionName(serverLabel, toolName, usedNames) {
  const base = `mcp_${safeFunctionNamePart(serverLabel)}_${safeFunctionNamePart(toolName)}`;
  const hash = shortHash(`${serverLabel}:${toolName}`);
  let candidate = `${base.slice(0, Math.max(1, 63 - hash.length))}_${hash}`.slice(0, 64);
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, Math.max(1, 64 - hash.length - suffix.length - 1))}_${hash}${suffix}`;
    index += 1;
  }
  return candidate;
}

function safeFunctionNamePart(value) {
  return (stringifyOptional(value) || "tool")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 30) || "tool";
}

function shortHash(value) {
  let hash = 2166136261;
  const text = stringifyOptional(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

async function executeMcpChatToolCalls(context, chatCompletion, config = {}, options = {}) {
  if (!context?.chat_tool_map || config.mcpRemoteToolCalls === false) {
    return { executed: false, output_items: [], messages: [] };
  }
  const choice = (chatCompletion?.choices || []).find((item) => {
    const calls = item?.message?.tool_calls;
    return Array.isArray(calls) && calls.some((call) => context.chat_tool_map.has(call?.function?.name));
  });
  if (!choice) return { executed: false, output_items: [], messages: [] };

  const mcpToolCalls = (choice.message?.tool_calls || [])
    .filter((call) => context.chat_tool_map.has(call?.function?.name));
  if (!mcpToolCalls.length) return { executed: false, output_items: [], messages: [] };

  const assistantMessage = {
    role: "assistant",
    content: choice.message?.content ?? null,
    tool_calls: mcpToolCalls.map((call) => clone(call)),
  };
  const outputItems = [];
  const toolMessages = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const toolCall of mcpToolCalls) {
    const mapping = context.chat_tool_map.get(toolCall.function.name);
    const rawArguments = stringifyOptional(toolCall.function?.arguments || "{}") || "{}";
    const callId = toolCall.id || prefixedId("call");
    let parsedArguments = null;
    let callOutput = "";
    let callError = null;

    if (!reserveToolCall(options.toolBudget, {
      type: mapping.approval_required ? "mcp_approval_request" : "mcp_call",
      tool_type: "mcp",
      server_label: mapping.server_label,
      name: mapping.tool_name,
    })) {
      skippedCount += 1;
      callError = {
        code: "max_tool_calls_exhausted",
        message: "max_tool_calls was exhausted before the MCP tool call could run.",
      };
    } else if (mapping.approval_required) {
      const outputItem = {
        id: prefixedId("mcpr"),
        type: "mcp_approval_request",
        arguments: rawArguments,
        name: mapping.tool_name,
        server_label: mapping.server_label,
      };
      outputItems.push(outputItem);
      if (!Array.isArray(context.approval_request_items)) context.approval_request_items = [];
      if (!Array.isArray(context.execution_items)) context.execution_items = [];
      context.approval_request_items.push(clone(outputItem));
      context.execution_items.push(clone(outputItem));
      context.remote_approval_request_count = (context.remote_approval_request_count || 0) + 1;
      continue;
    } else {
      try {
        parsedArguments = parseToolArguments(rawArguments);
        const result = await callRemoteMcpTool(mapping.server, mapping.tool_name, parsedArguments, config);
        callOutput = result.output;
        callError = result.error;
        if (callError) failedCount += 1;
        else successCount += 1;
      } catch (error) {
        failedCount += 1;
        callError = {
          code: error.code || "mcp_remote_call_failed",
          message: safeErrorMessage(error),
        };
      }
    }

    const outputItem = {
      id: prefixedId("mcp"),
      type: "mcp_call",
      approval_request_id: null,
      arguments: rawArguments,
      error: callError,
      name: mapping.tool_name,
      output: callOutput,
      server_label: mapping.server_label,
    };
    outputItems.push(outputItem);
    if (!Array.isArray(context.execution_items)) context.execution_items = [];
    context.execution_items.push(clone(outputItem));
    toolMessages.push({
      role: "tool",
      tool_call_id: callId,
      content: callError
        ? JSON.stringify({ error: callError, output: callOutput || null })
        : callOutput,
    });
  }

  if (!Array.isArray(context.call_items)) context.call_items = [];
  context.call_items.push(...outputItems.filter((item) => item.type === "mcp_call").map(clone));
  const callOutputCount = outputItems.filter((item) => item.type === "mcp_call").length;
  context.remote_call_attempt_count = (context.remote_call_attempt_count || 0) + callOutputCount;
  context.remote_call_success_count = (context.remote_call_success_count || 0) + successCount;
  context.remote_call_failed_count = (context.remote_call_failed_count || 0) + failedCount;
  context.remote_call_skipped_count = (context.remote_call_skipped_count || 0) + skippedCount;

  return {
    executed: true,
    approval_requested: outputItems.some((item) => item.type === "mcp_approval_request"),
    output_items: outputItems,
    messages: [assistantMessage, ...toolMessages],
    success_count: successCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
  };
}

async function executeApprovedMcpApprovalResponses(context, config = {}, options = {}) {
  if (!context || config.mcpRemoteToolCalls === false) return { executed: false, handled: false, output_items: [], messages: [] };
  const responses = (context.input_items || []).filter((item) => item.type === "mcp_approval_response");
  if (!responses.length) return { executed: false, handled: false, output_items: [], messages: [] };

  const requestsById = new Map((context.input_items || [])
    .filter((item) => item.type === "mcp_approval_request" && item.id)
    .map((item) => [item.id, item]));
  const outputItems = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let approvedCount = 0;
  let deniedCount = 0;
  let missingCount = 0;

  for (const approvalResponse of responses) {
    const approvalRequest = requestsById.get(approvalResponse.approval_request_id);
    if (!approvalRequest) {
      missingCount += 1;
      continue;
    }
    if (approvalResponse.approve !== true) {
      deniedCount += 1;
      continue;
    }

    approvedCount += 1;
    const server = findMcpServer(context, approvalRequest.server_label);
    const rawArguments = stringifyOptional(approvalRequest.arguments || "{}") || "{}";
    let callOutput = "";
    let callError = null;

    if (!server?._remote_tool_config?.server_url) {
      failedCount += 1;
      callError = {
        code: "mcp_approval_server_unavailable",
        message: "The approved MCP server is not available in this request.",
      };
    } else if (!reserveToolCall(options.toolBudget, {
      type: "mcp_call",
      tool_type: "mcp",
      server_label: approvalRequest.server_label,
      name: approvalRequest.name,
    })) {
      skippedCount += 1;
      callError = {
        code: "max_tool_calls_exhausted",
        message: "max_tool_calls was exhausted before the approved MCP tool call could run.",
      };
    } else {
      try {
        const parsedArguments = parseToolArguments(rawArguments);
        const result = await callRemoteMcpTool(server, approvalRequest.name, parsedArguments, config);
        callOutput = result.output;
        callError = result.error;
        if (callError) failedCount += 1;
        else successCount += 1;
      } catch (error) {
        failedCount += 1;
        callError = {
          code: error.code || "mcp_remote_call_failed",
          message: safeErrorMessage(error),
        };
      }
    }

    outputItems.push({
      id: prefixedId("mcp"),
      type: "mcp_call",
      approval_request_id: approvalRequest.id,
      arguments: rawArguments,
      error: callError,
      name: approvalRequest.name,
      output: callOutput,
      server_label: approvalRequest.server_label,
    });
  }

  if (outputItems.length) {
    if (!Array.isArray(context.call_items)) context.call_items = [];
    if (!Array.isArray(context.execution_items)) context.execution_items = [];
    context.call_items.push(...outputItems.map(clone));
    context.execution_items.push(...outputItems.map(clone));
  }
  context.remote_approval_response_count = (context.remote_approval_response_count || 0) + responses.length;
  context.remote_approval_approved_count = (context.remote_approval_approved_count || 0) + approvedCount;
  context.remote_approval_denied_count = (context.remote_approval_denied_count || 0) + deniedCount;
  context.remote_approval_missing_count = (context.remote_approval_missing_count || 0) + missingCount;
  context.remote_call_attempt_count = (context.remote_call_attempt_count || 0) + outputItems.length;
  context.remote_call_success_count = (context.remote_call_success_count || 0) + successCount;
  context.remote_call_failed_count = (context.remote_call_failed_count || 0) + failedCount;
  context.remote_call_skipped_count = (context.remote_call_skipped_count || 0) + skippedCount;

  return {
    executed: outputItems.length > 0,
    handled: true,
    output_items: outputItems,
    messages: [],
    success_count: successCount,
    failed_count: failedCount,
    skipped_count: skippedCount,
  };
}

function findMcpServer(context, serverLabel) {
  return (context.servers || []).find((server) => server.server_label === serverLabel);
}

function suppressMcpChatToolCalls(chatCompletion, context) {
  if (!chatCompletion || !context?.chat_tool_map) return chatCompletion;
  const cloned = clone(chatCompletion);
  for (const choice of cloned.choices || []) {
    const calls = choice.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    const remaining = calls.filter((call) => !context.chat_tool_map.has(call?.function?.name));
    if (remaining.length) {
      choice.message.tool_calls = remaining;
    } else {
      delete choice.message.tool_calls;
      if (choice.message.content === undefined) choice.message.content = null;
      if (choice.finish_reason === "tool_calls") choice.finish_reason = "stop";
    }
  }
  return cloned;
}

function parseToolArguments(rawArguments) {
  const text = stringifyOptional(rawArguments || "{}") || "{}";
  const parsed = JSON.parse(text);
  if (isPlainObject(parsed)) return parsed;
  const error = new Error("MCP tool arguments must be a JSON object");
  error.code = "mcp_invalid_tool_arguments";
  throw error;
}

async function callRemoteMcpTool(server, toolName, parsedArguments, config = {}) {
  const tool = server._remote_tool_config;
  if (!tool?.server_url) {
    const error = new Error("MCP server is missing a remote server_url");
    error.code = "mcp_remote_server_url_missing";
    throw error;
  }
  const session = { id: server._remote_session_id || null };
  const response = await sendMcpJsonRpc(tool, config, {
    id: Date.now(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: parsedArguments,
    },
  }, session);
  if (session.id && session.id !== server._remote_session_id) {
    server._remote_session_id = session.id;
  }
  if (response.error) {
    return {
      output: "",
      error: normalizeMcpCallError("mcp_remote_protocol_error", response.error, tool),
    };
  }
  const result = isPlainObject(response.result) ? response.result : {};
  const output = truncateToolOutput(redactMcpSensitiveText(mcpToolResultOutput(result), tool), config);
  return {
    output,
    error: result.isError ? {
      code: "mcp_tool_error",
      message: output || "MCP tool returned isError=true",
    } : null,
  };
}

function normalizeMcpCallError(code, error, tool = null) {
  if (isPlainObject(error)) {
    return {
      code: error.code != null ? stringifyOptional(error.code) : code,
      message: redactMcpSensitiveText(safeErrorMessage(error.message || code), tool),
      ...(error.data !== undefined ? { data: redactMcpErrorData(error.data, tool) } : {}),
    };
  }
  return { code, message: redactMcpSensitiveText(safeErrorMessage(error || code), tool) };
}

function redactMcpErrorData(value, tool = null) {
  return redactMcpSensitiveText(stringifyContent(value), tool).slice(0, 2000);
}

function redactMcpSensitiveText(value, tool = null) {
  let text = stringifyContent(value);
  const candidates = [];
  if (tool?.authorization != null) {
    const raw = stringifyOptional(tool.authorization).trim();
    if (raw) {
      candidates.push(raw, authorizationHeaderValue(raw));
    }
  }
  if (isPlainObject(tool?.headers)) {
    for (const [key, headerValue] of Object.entries(tool.headers)) {
      if (key.toLowerCase() !== "authorization" || headerValue == null) continue;
      const raw = stringifyOptional(headerValue).trim();
      if (raw) candidates.push(raw);
    }
  }
  for (const candidate of candidates) {
    if (!candidate || candidate.length < 4) continue;
    text = text.split(candidate).join("[redacted]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

function mcpToolResultOutput(result = {}) {
  if (result.structuredContent !== undefined) return stringifyContent(result.structuredContent);
  if (result.structured_content !== undefined) return stringifyContent(result.structured_content);
  if (Array.isArray(result.content)) {
    return result.content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && part.text != null) return stringifyOptional(part.text);
      if (part?.text != null) return stringifyOptional(part.text);
      return stringifyContent(part);
    }).filter(Boolean).join("\n");
  }
  if (result.content != null) return stringifyContent(result.content);
  return stringifyContent(result);
}

function truncateToolOutput(value, config = {}) {
  const limit = boundedNumber(config.mcpMaxToolOutputChars, DEFAULT_MCP_MAX_TOOL_OUTPUT_CHARS, 1024, 1000000);
  const text = stringifyContent(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function safeErrorMessage(error) {
  const message = String(error?.message || error || "remote MCP tools/list failed");
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]").slice(0, 500);
}

function explicitTools(tool = {}) {
  const values = Array.isArray(tool.tools) ? tool.tools : Array.isArray(tool.tool_definitions) ? tool.tool_definitions : [];
  return values
    .filter(isPlainObject)
    .map((definition) => ({
      annotations: definition.annotations ?? null,
      description: stringifyOptional(definition.description),
      input_schema: isPlainObject(definition.input_schema)
        ? clone(definition.input_schema)
        : isPlainObject(definition.parameters)
          ? clone(definition.parameters)
          : { type: "object", additionalProperties: true },
      name: stringifyOptional(definition.name) || "tool",
    }));
}

function syntheticMcpToolDefinition(name, label) {
  return {
    annotations: null,
    description: `Local compatibility placeholder for MCP tool ${name} from ${label}.`,
    input_schema: {
      type: "object",
      additionalProperties: true,
    },
    name,
  };
}

function allowedTools(tool = {}) {
  const allowed = tool.allowed_tools;
  if (Array.isArray(allowed)) return allowed.map(stringifyOptional).filter(Boolean);
  if (Array.isArray(allowed?.tool_names)) return allowed.tool_names.map(stringifyOptional).filter(Boolean);
  if (Array.isArray(allowed?.tools)) return allowed.tools.map(stringifyOptional).filter(Boolean);
  return explicitTools(tool).map((definition) => definition.name).filter(Boolean);
}

function normalizeRequireApproval(value) {
  if (value == null) return "default";
  if (typeof value === "string") return value;
  if (isPlainObject(value)) return clone(value);
  return stringifyContent(value);
}

function hasAuthorizationHeader(headers) {
  if (!isPlainObject(headers)) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function hostLabel(url) {
  if (!url || typeof url !== "string") return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function safeLabel(value) {
  const raw = stringifyOptional(value) || "mcp";
  return raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "mcp";
}

function injectMcpMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: mcpPrompt(context),
  });
}

function attachMcpOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...mcpOutputItems(context),
    ...(response.output || []),
  ];
  return response;
}

function mcpOutputItems(context) {
  const executionItems = Array.isArray(context?.execution_items) && context.execution_items.length
    ? context.execution_items
    : [
      ...(context?.approval_request_items || []),
      ...(context?.call_items || []),
    ];
  return [
    ...(context?.list_tools_items || []),
    ...executionItems,
  ].map(clone);
}

function mcpCompatibility(context) {
  if (!context) return {};
  const servers = context.servers || [];
  const remoteImportAttempts = servers.filter((server) => server.remote_import_attempted);
  return {
    local_mcp: {
      provider: context.provider || "local",
      status: context.status || "completed",
      tool_types: context.tool_types || [],
      server_count: servers.length,
      remote_server_count: servers.filter((server) => server.server_kind === "remote_mcp").length,
      connector_count: servers.filter((server) => server.server_kind === "connector").length,
      imported_tool_count: servers.reduce((sum, server) => sum + (server.imported_tools?.length || 0), 0),
      deferred_count: servers.filter((server) => server.defer_loading).length,
      authorization_redacted_count: servers.filter((server) => server.has_authorization).length,
      remote_import_attempt_count: remoteImportAttempts.length,
      remote_import_success_count: remoteImportAttempts.filter((server) => server.remote_import_status === "completed").length,
      remote_import_failed_count: remoteImportAttempts.filter((server) => server.remote_import_status === "failed").length,
      remote_call_tool_count: context.remote_call_tool_count || 0,
      remote_approval_request_count: context.remote_approval_request_count || 0,
      remote_approval_response_count: context.remote_approval_response_count || 0,
      remote_approval_approved_count: context.remote_approval_approved_count || 0,
      remote_approval_denied_count: context.remote_approval_denied_count || 0,
      remote_approval_missing_count: context.remote_approval_missing_count || 0,
      remote_call_attempt_count: context.remote_call_attempt_count || 0,
      remote_call_success_count: context.remote_call_success_count || 0,
      remote_call_failed_count: context.remote_call_failed_count || 0,
      remote_call_skipped_count: context.remote_call_skipped_count || 0,
      input_item_count: context.input_items?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      ...(context.tool_choice_mapping ? { tool_choice: clone(context.tool_choice_mapping) } : {}),
      boundary: context.remote_call_attempt_count
        ? "remote_list_tools_and_call_execution"
        : context.remote_approval_request_count
        ? "remote_list_tools_with_approval_request"
        : context.remote_approval_response_count
        ? "remote_list_tools_with_approval_response"
        : remoteImportAttempts.length
        ? "remote_list_tools_without_call_execution"
        : "local_protocol_context_only",
      ...(context.warnings?.length ? { warnings: context.warnings.slice(0, 5) } : {}),
    },
  };
}

function mcpPrompt(context) {
  const sections = [
    "Local Responses MCP compatibility is active.",
    "The bridge preserves MCP tool definitions and MCP context item shapes for Chat-only providers. It can import remote MCP tool lists when configured, execute auto-approved remote MCP tool calls in non-streaming, streaming, and active background requests, and create or consume local MCP approval items for approval-required remote calls. It does not yet execute hosted connector calls.",
    "Never infer private connector data. Use only visible MCP context items, user input, and other provided evidence.",
  ];

  if (context.servers?.length) {
    sections.push([
      "Configured MCP servers/connectors:",
      ...context.servers.map((server) => [
        `- server_label: ${server.server_label}`,
        `  kind: ${server.server_kind}`,
        server.server_description ? `  description: ${truncateForPrompt(server.server_description, 512)}` : null,
        server.server_url_host ? `  server_url_host: ${server.server_url_host}` : null,
        server.connector_id ? `  connector_id: ${server.connector_id}` : null,
        `  require_approval: ${stringifyContent(server.require_approval)}`,
        server.defer_loading ? "  defer_loading: true" : null,
        server.allowed_tools?.length ? `  allowed_tools: ${server.allowed_tools.join(", ")}` : null,
        server.imported_tools?.length ? `  imported_tools: ${server.imported_tools.map((tool) => tool.name).join(", ")}` : null,
        server.remote_import_attempted ? `  remote_import: ${server.remote_import_status || "unknown"}` : null,
        server.remote_import_attempted && server.remote_import_remote_tool_count ? `  remote_tool_count: ${server.remote_import_remote_tool_count}` : null,
        server.remote_import_protocol_version ? `  remote_protocol_version: ${server.remote_import_protocol_version}` : null,
        server.remote_import_session ? `  remote_session: ${server.remote_import_session}` : null,
        server.has_authorization ? "  authorization: provided but redacted by bridge" : null,
        server.import_error ? `  import_error: ${server.import_error.code}` : null,
      ].filter(Boolean).join("\n")),
    ].join("\n"));
  }

  if (context.list_tools_items?.length) {
    sections.push([
      "MCP list_tools output items prepared by the bridge:",
      ...context.list_tools_items.map((item) => [
        `- id: ${item.id}`,
        `  server_label: ${item.server_label}`,
        `  tools: ${(item.tools || []).map((tool) => tool.name).join(", ") || "(none)"}`,
        item.error ? `  error: ${item.error.code}` : null,
      ].filter(Boolean).join("\n")),
    ].join("\n"));
  }

  if (context.call_items?.length) {
    sections.push([
      "MCP call output items produced by the bridge:",
      ...context.call_items.map((item) => [
        `- id: ${item.id}`,
        `  server_label: ${item.server_label}`,
        `  name: ${item.name}`,
        item.error ? `  error: ${item.error.code}` : `  output: ${truncateForPrompt(item.output || "", 512)}`,
      ].filter(Boolean).join("\n")),
    ].join("\n"));
  }

  if (context.approval_request_items?.length) {
    sections.push([
      "MCP approval requests produced by the bridge:",
      ...context.approval_request_items.map((item) => [
        `- id: ${item.id}`,
        `  server_label: ${item.server_label}`,
        `  name: ${item.name}`,
        `  arguments: ${truncateForPrompt(item.arguments || "", 512)}`,
      ].join("\n")),
    ].join("\n"));
  }

  if (context.input_items?.length) {
    sections.push([
      "MCP context items supplied by the client:",
      ...context.input_items.map((item) => `- ${mcpInputItemSummary(item)}`),
    ].join("\n"));
  }

  if (context.skipped_calls?.length) {
    sections.push([
      "Skipped MCP compatibility actions:",
      ...context.skipped_calls.map((item) => `- ${item.action} for ${item.server_label}: ${item.reason}`),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function extractMcpContextItems(input) {
  const items = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainObject(value)) return;
    if (MCP_CONTEXT_ITEM_TYPES.has(value.type)) {
      items.push(normalizeMcpContextItem(value));
      return;
    }
    if (Array.isArray(value.input)) visit(value.input);
    if (Array.isArray(value.content)) visit(value.content);
  };
  visit(input);
  return items;
}

function normalizeMcpContextItem(item) {
  if (item.type === "mcp_list_tools") {
    return {
      id: stringifyOptional(item.id),
      type: item.type,
      server_label: stringifyOptional(item.server_label),
      tools: Array.isArray(item.tools) ? item.tools.map((tool) => ({
        name: stringifyOptional(tool?.name),
        description: stringifyOptional(tool?.description),
      })) : [],
    };
  }
  if (item.type === "mcp_call") {
    return {
      id: stringifyOptional(item.id),
      type: item.type,
      server_label: stringifyOptional(item.server_label),
      name: stringifyOptional(item.name),
      arguments: stringifyOptional(item.arguments),
      output: stringifyOptional(item.output),
      error: item.error == null ? null : clone(item.error),
      approval_request_id: stringifyOptional(item.approval_request_id),
    };
  }
  if (item.type === "mcp_approval_request") {
    return {
      id: stringifyOptional(item.id),
      type: item.type,
      server_label: stringifyOptional(item.server_label),
      name: stringifyOptional(item.name),
      arguments: stringifyOptional(item.arguments),
    };
  }
  return {
    id: stringifyOptional(item.id),
    type: item.type,
    approval_request_id: stringifyOptional(item.approval_request_id),
    approve: item.approve === true,
  };
}

function mcpInputItemSummary(item) {
  if (item.type === "mcp_list_tools") {
    return `mcp_list_tools server_label=${item.server_label || "unknown"} tools=${(item.tools || []).map((tool) => tool.name).filter(Boolean).join(", ") || "(none)"}`;
  }
  if (item.type === "mcp_call") {
    return [
      `mcp_call server_label=${item.server_label || "unknown"}`,
      `name=${item.name || "unknown"}`,
      `arguments=${truncateForPrompt(item.arguments || "", 512) || "{}"}`,
      item.error ? `error=${truncateForPrompt(stringifyContent(item.error), 512)}` : `output=${truncateForPrompt(item.output || "", 512)}`,
    ].join(" ");
  }
  if (item.type === "mcp_approval_request") {
    return `mcp_approval_request id=${item.id || "unknown"} server_label=${item.server_label || "unknown"} name=${item.name || "unknown"} arguments=${truncateForPrompt(item.arguments || "", 512)}`;
  }
  return `mcp_approval_response approval_request_id=${item.approval_request_id || "unknown"} approve=${item.approve}`;
}

function stringifyOptional(value) {
  if (value == null) return "";
  return stringifyContent(value);
}

function truncateForPrompt(value, maxLength = MAX_PROMPT_TEXT) {
  const text = stringifyContent(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

module.exports = {
  attachMcpOutput,
  executeApprovedMcpApprovalResponses,
  executeMcpChatToolCalls,
  injectMcpMessages,
  injectMcpChatTools,
  localMcpToolTypes,
  mcpCompatibility,
  mcpOutputItems,
  prepareMcpContext,
  suppressMcpChatToolCalls,
};
