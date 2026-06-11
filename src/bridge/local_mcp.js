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
    input_items: extractMcpContextItems(request.input),
    skipped_calls: [],
    warnings: [],
  };
  const labels = new Set();

  tools.forEach((tool, index) => {
    const server = normalizeMcpServer(tool, index);
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
      return;
    }

    context.list_tools_items.push({
      id: prefixedId("mcpl"),
      type: "mcp_list_tools",
      server_label: server.server_label,
      tools: server.imported_tools.map((toolDefinition) => clone(toolDefinition)),
      ...(server.import_error ? { error: server.import_error } : {}),
    });
  });

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
    import_error: hasLocation ? null : {
      code: "mcp_server_location_missing",
      message: "mcp tool requires server_url or connector_id for hosted execution",
    },
  };
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
  return (context?.list_tools_items || []).map(clone);
}

function mcpCompatibility(context) {
  if (!context) return {};
  const servers = context.servers || [];
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
      input_item_count: context.input_items?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      boundary: "local_protocol_context_only",
      ...(context.warnings?.length ? { warnings: context.warnings.slice(0, 5) } : {}),
    },
  };
}

function mcpPrompt(context) {
  const sections = [
    "Local Responses MCP compatibility is active.",
    "The bridge preserves MCP tool definitions and MCP context item shapes for Chat-only providers. It does not execute remote MCP or connector calls in this local mode.",
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
  injectMcpMessages,
  localMcpToolTypes,
  mcpCompatibility,
  mcpOutputItems,
  prepareMcpContext,
};
