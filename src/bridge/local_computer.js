"use strict";

const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const COMPUTER_TOOL_TYPES = new Set(["computer", "computer_use_preview"]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isComputerTool(tool) {
  return !!tool && typeof tool === "object" && COMPUTER_TOOL_TYPES.has(tool.type);
}

function canUseLocalComputer(config = {}) {
  return String(config.computerProvider || "local").toLowerCase() !== "disabled";
}

function localComputerToolTypes(tools = [], config = {}) {
  if (!canUseLocalComputer(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isComputerTool)
    .map((tool) => tool.type)));
}

async function prepareComputerContext(request = {}, config = {}, options = {}) {
  const tools = (request.tools || []).filter(isComputerTool);
  if (!tools.length || !canUseLocalComputer(config)) return null;

  const receivedOutputs = extractComputerCallOutputs(request.input);
  const context = {
    provider: "local",
    status: receivedOutputs.length ? "received_output" : "completed",
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    calls: [],
    received_outputs: receivedOutputs,
    skipped_calls: [],
    include_output_image_url: Array.isArray(request.include)
      && request.include.includes("computer_call_output.output.image_url"),
  };

  if (receivedOutputs.length) return context;

  const tool = tools[0];
  if (!reserveToolCall(options.toolBudget, {
    type: "computer_call",
    tool_type: tool.type || "computer",
    action: "screenshot",
  })) {
    context.status = "skipped";
    context.warning = "max_tool_calls was exhausted before local computer compatibility could request a screenshot.";
    context.skipped_calls.push({
      action: "screenshot",
      reason: "max_tool_calls_exhausted",
    });
    return context;
  }

  const action = { type: "screenshot" };
  const call = {
    id: prefixedId("cu"),
    type: "computer_call",
    call_id: prefixedId("call"),
    status: "completed",
    action: { ...action },
    actions: [{ ...action }],
    pending_safety_checks: [],
    tool_type: tool.type,
    environment: normalizeComputerEnvironment(tool),
    ...computerDisplayShape(tool),
  };
  context.calls.push(call);
  return context;
}

function injectComputerMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: computerPrompt(context),
  });
}

function attachComputerOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...computerOutputItems(context),
    ...(response.output || []),
  ];
  return response;
}

function computerOutputItems(context) {
  return [...(context?.calls || [])];
}

function computerCompatibility(context) {
  if (!context) return {};
  return {
    local_computer: {
      provider: context.provider || "local",
      status: context.status || "completed",
      tool_types: context.tool_types || [],
      call_count: context.calls?.length || 0,
      requested_action_count: countComputerActions(context.calls),
      returned_output_count: context.received_outputs?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      include_output_image_url: !!context.include_output_image_url,
      ...(context.warning ? { warning: context.warning } : {}),
    },
  };
}

function computerPrompt(context) {
  if (context.warning) {
    return [
      "Local Responses computer compatibility was requested but did not request a computer action.",
      context.warning,
      "Do not invent browser, desktop, screenshot, or UI state. Ask for more context or answer from visible input only.",
    ].join("\n");
  }

  const sections = [
    "Local Responses computer compatibility is active.",
    "The bridge can preserve the Responses computer action-loop shape for Chat-only providers, but it does not execute UI actions itself.",
    "Use only explicit computer_call_output evidence returned by the client. Do not invent browser, desktop, screenshot, or UI state.",
  ];

  if (context.calls?.length) {
    sections.push([
      "Requested computer calls:",
      ...context.calls.map((call) => [
        `- call_id: ${call.call_id}`,
        `  tool_type: ${call.tool_type || "computer"}`,
        `  environment: ${stringifyContent(call.environment || "unknown")}`,
        `  actions: ${call.actions?.map((action) => action.type).join(", ") || call.action?.type || "unknown"}`,
        call.display_width ? `  display_width: ${call.display_width}` : null,
        call.display_height ? `  display_height: ${call.display_height}` : null,
      ].filter(Boolean).join("\n")),
      "Clients should execute these action(s), then send computer_call_output in a follow-up Responses request.",
    ].join("\n"));
  }

  if (context.received_outputs?.length) {
    sections.push([
      "Received computer_call_output items:",
      ...context.received_outputs.map((output) => [
        `- call_id: ${output.call_id || "unknown"}`,
        output.output_type ? `  output_type: ${output.output_type}` : null,
        output.image_url ? `  image_url: ${output.image_url}` : null,
        output.detail ? `  detail: ${output.detail}` : null,
        output.text ? `  text: ${truncateForPrompt(output.text, 2000)}` : null,
        Number.isFinite(output.acknowledged_safety_checks_count)
          ? `  acknowledged_safety_checks_count: ${output.acknowledged_safety_checks_count}`
          : null,
      ].filter(Boolean).join("\n")),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function extractComputerCallOutputs(input) {
  const outputs = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainObject(value)) return;
    if (value.type === "computer_call_output") {
      outputs.push(normalizeComputerCallOutput(value));
      return;
    }
    if (Array.isArray(value.input)) visit(value.input);
    if (Array.isArray(value.content)) visit(value.content);
  };
  visit(input);
  return outputs;
}

function normalizeComputerCallOutput(item) {
  const output = isPlainObject(item.output) ? item.output : {};
  return {
    id: stringifyOptional(item.id),
    call_id: stringifyOptional(item.call_id || item.computer_call_id),
    status: stringifyOptional(item.status),
    output_type: stringifyOptional(output.type || item.output_type),
    image_url: computerOutputImageUrl(output),
    detail: stringifyOptional(output.detail || item.detail),
    text: computerOutputText(item),
    acknowledged_safety_checks_count: Array.isArray(item.acknowledged_safety_checks)
      ? item.acknowledged_safety_checks.length
      : undefined,
  };
}

function computerOutputImageUrl(output = {}) {
  if (!isPlainObject(output)) return "";
  if (typeof output.image_url === "string") return output.image_url;
  if (typeof output.image_url?.url === "string") return output.image_url.url;
  if (typeof output.url === "string") return output.url;
  return "";
}

function computerOutputText(item = {}) {
  const output = isPlainObject(item.output) ? item.output : item.output;
  if (typeof item.output_text === "string") return item.output_text;
  if (typeof item.content === "string") return item.content;
  if (typeof output === "string") return output;
  if (!isPlainObject(output)) return "";
  if (typeof output.text === "string") return output.text;
  if (typeof output.content === "string") return output.content;
  return "";
}

function normalizeComputerEnvironment(tool = {}) {
  const environment = tool.environment || tool.computer?.environment || "browser";
  if (typeof environment === "string") return environment;
  if (isPlainObject(environment)) return environment.type || environment.name || environment.os || "browser";
  return "browser";
}

function computerDisplayShape(tool = {}) {
  const shape = {};
  const width = positiveInteger(tool.display_width || tool.width || tool.computer?.display_width);
  const height = positiveInteger(tool.display_height || tool.height || tool.computer?.display_height);
  if (width) shape.display_width = width;
  if (height) shape.display_height = height;
  return shape;
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function countComputerActions(calls = []) {
  return (calls || []).reduce((sum, call) => (
    sum + (Array.isArray(call.actions) ? call.actions.length : (call.action ? 1 : 0))
  ), 0);
}

function stringifyOptional(value) {
  if (value == null || value === "") return null;
  return stringifyContent(value);
}

function truncateForPrompt(value, maxChars) {
  const text = stringifyContent(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

module.exports = {
  attachComputerOutput,
  computerCompatibility,
  computerOutputItems,
  injectComputerMessages,
  localComputerToolTypes,
  prepareComputerContext,
};
