"use strict";

const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const COMPUTER_TOOL_TYPES = new Set(["computer", "computer_use_preview"]);
const COMPUTER_ACTION_TOOL_NAME = "local_computer_action";
const COMPUTER_ACTION_TYPES = new Set([
  "click",
  "double_click",
  "scroll",
  "type",
  "wait",
  "keypress",
  "drag",
  "move",
  "screenshot",
]);

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
    tool: normalizeComputerTool(tools[0]),
    requested_tool_choice: normalizeComputerRequestedToolChoice(request.tool_choice),
    calls: [],
    received_outputs: receivedOutputs,
    skipped_calls: [],
    include_output_image_url: Array.isArray(request.include)
      && request.include.includes("computer_call_output.output.image_url"),
  };

  if (receivedOutputs.length) return context;

  const tool = context.tool;
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
    environment: tool.environment,
    ...tool.display,
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

function injectComputerActionTool(chat, context) {
  if (!chat || !context) return;
  if (!context.received_outputs?.length || chat.stream) return;
  if (!Array.isArray(chat.tools)) chat.tools = [];
  const usedNames = new Set(chat.tools.map((tool) => tool?.function?.name).filter(Boolean));
  const toolName = uniqueComputerActionToolName(usedNames);
  chat.tools.push({
    type: "function",
    function: {
      name: toolName,
      description: "Request the next Responses computer_call action for the client to execute. Use only when another UI action is needed after the latest computer_call_output; otherwise answer normally.",
      parameters: computerActionToolParameters(),
    },
  });
  if (context.requested_tool_choice?.force) {
    chat.tool_choice = {
      type: "function",
      function: { name: toolName },
    };
    context.tool_choice_mapping = {
      source: "tool_choice",
      requested_type: context.requested_tool_choice.type,
      forwarded: true,
      target: "function",
      chat_name: toolName,
      reason: "computer_tool_choice_mapped",
    };
  } else if (chat.tool_choice === undefined) {
    chat.tool_choice = "auto";
  }
  context.chat_action_tool_name = toolName;
}

function executeComputerChatToolCalls(context, chatCompletion, config = {}, options = {}) {
  if (!context?.chat_action_tool_name) return { executed: false, output_items: [] };
  const choice = (chatCompletion?.choices || []).find((item) => {
    const calls = item?.message?.tool_calls;
    return Array.isArray(calls) && calls.some((call) => call?.function?.name === context.chat_action_tool_name);
  });
  if (!choice) return { executed: false, output_items: [] };

  const toolCalls = (choice.message?.tool_calls || [])
    .filter((call) => call?.function?.name === context.chat_action_tool_name);
  const outputItems = [];
  let executedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const toolCall of toolCalls) {
    const descriptor = {
      type: "computer_call",
      tool_type: context.tool?.type || "computer",
      action: "model_requested_action",
    };
    if (!reserveToolCall(options.toolBudget, descriptor)) {
      skippedCount += 1;
      if (!Array.isArray(context.skipped_calls)) context.skipped_calls = [];
      context.skipped_calls.push({
        action: "model_requested_action",
        reason: "max_tool_calls_exhausted",
      });
      continue;
    }

    const parsed = parseComputerActionArguments(toolCall.function?.arguments);
    if (!parsed.ok) {
      failedCount += 1;
      if (!Array.isArray(context.warnings)) context.warnings = [];
      context.warnings.push(parsed.error);
      continue;
    }

    const call = computerCallFromActionToolCall(toolCall, parsed, context);
    context.calls.push(call);
    outputItems.push(call);
    executedCount += 1;
  }

  context.status = outputItems.length ? "action_requested" : context.status || "received_output";
  context.model_action_tool_call_count = (context.model_action_tool_call_count || 0) + toolCalls.length;
  context.model_action_call_count = (context.model_action_call_count || 0) + executedCount;
  context.model_action_failed_count = (context.model_action_failed_count || 0) + failedCount;
  context.model_action_skipped_count = (context.model_action_skipped_count || 0) + skippedCount;

  return {
    executed: toolCalls.length > 0,
    output_items: outputItems,
    failed_count: failedCount,
    skipped_count: skippedCount,
  };
}

function suppressComputerChatToolCalls(chatCompletion, context) {
  if (!chatCompletion || !context?.chat_action_tool_name) return chatCompletion;
  const cloned = clone(chatCompletion);
  for (const choice of cloned.choices || []) {
    const calls = choice?.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    const remaining = calls.filter((call) => call?.function?.name !== context.chat_action_tool_name);
    if (remaining.length) choice.message.tool_calls = remaining;
    else delete choice.message.tool_calls;
  }
  return cloned;
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
      model_action_tool_call_count: context.model_action_tool_call_count || 0,
      model_action_call_count: context.model_action_call_count || 0,
      model_action_failed_count: context.model_action_failed_count || 0,
      model_action_skipped_count: context.model_action_skipped_count || 0,
      include_output_image_url: !!context.include_output_image_url,
      ...(context.chat_action_tool_name ? { chat_action_tool_name: context.chat_action_tool_name } : {}),
      ...(context.tool_choice_mapping ? { tool_choice: clone(context.tool_choice_mapping) } : {}),
      ...(context.warnings?.length ? { warnings: context.warnings.slice(0, 5) } : {}),
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

    sections.push([
      "If another UI action is required, call the provided function tool with one next Computer use action.",
      `Supported action types: ${Array.from(COMPUTER_ACTION_TYPES).join(", ")}.`,
      "If no further action is needed, answer normally without calling the function tool.",
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function normalizeComputerTool(tool = {}) {
  return {
    type: tool.type || "computer",
    environment: normalizeComputerEnvironment(tool),
    display: computerDisplayShape(tool),
  };
}

function normalizeComputerRequestedToolChoice(toolChoice) {
  if (toolChoice == null) return null;
  if (typeof toolChoice === "string") {
    const value = stringifyOptional(toolChoice);
    return {
      type: value || "unknown",
      force: value === "required",
    };
  }
  if (!isPlainObject(toolChoice)) return null;
  const type = stringifyOptional(toolChoice.type);
  return {
    type: type || "unknown",
    force: COMPUTER_TOOL_TYPES.has(type),
  };
}

function uniqueComputerActionToolName(usedNames) {
  let candidate = COMPUTER_ACTION_TOOL_NAME;
  let index = 2;
  while (usedNames.has(candidate)) {
    candidate = `${COMPUTER_ACTION_TOOL_NAME}_${index}`;
    index += 1;
  }
  return candidate;
}

function computerActionToolParameters() {
  const actionSchema = {
    type: "object",
    properties: {
      type: { type: "string", enum: Array.from(COMPUTER_ACTION_TYPES) },
      x: { type: "number" },
      y: { type: "number" },
      button: { type: "string" },
      scroll_x: { type: "number" },
      scroll_y: { type: "number" },
      text: { type: "string" },
      keys: { type: "array", items: { type: "string" } },
      path: {
        type: "array",
        items: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["x", "y"],
          additionalProperties: false,
        },
      },
    },
    required: ["type"],
    additionalProperties: true,
  };

  return {
    type: "object",
    properties: {
      action: actionSchema,
      actions: {
        type: "array",
        items: actionSchema,
        minItems: 1,
        maxItems: 8,
      },
      pending_safety_checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
          },
          additionalProperties: true,
        },
      },
    },
    additionalProperties: true,
  };
}

function parseComputerActionArguments(rawArguments) {
  const raw = stringifyOptional(rawArguments || "{}") || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `invalid computer action arguments: ${error.message}` };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: "computer action arguments must be an object" };

  const rawActions = Array.isArray(parsed.actions)
    ? parsed.actions
    : isPlainObject(parsed.action)
      ? [parsed.action]
      : typeof parsed.type === "string"
        ? [parsed]
        : [];
  const actions = rawActions
    .map(normalizeComputerAction)
    .filter(Boolean)
    .slice(0, 8);
  if (!actions.length) return { ok: false, error: "computer action arguments did not include a supported action" };
  return {
    ok: true,
    arguments: raw,
    actions,
    pending_safety_checks: normalizePendingSafetyChecks(parsed.pending_safety_checks),
  };
}

function normalizeComputerAction(action) {
  if (!isPlainObject(action)) return null;
  const type = stringifyOptional(action.type)?.toLowerCase();
  if (!COMPUTER_ACTION_TYPES.has(type)) return null;
  return {
    ...clone(action),
    type,
  };
}

function normalizePendingSafetyChecks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((item) => clone(item))
    .slice(0, 8);
}

function computerCallFromActionToolCall(toolCall, parsed, context) {
  const firstAction = parsed.actions[0];
  return {
    id: prefixedId("cu"),
    type: "computer_call",
    call_id: toolCall.id || prefixedId("call"),
    status: "completed",
    action: clone(firstAction),
    actions: parsed.actions.map(clone),
    pending_safety_checks: parsed.pending_safety_checks.map(clone),
    tool_type: context.tool?.type || "computer",
    environment: context.tool?.environment || "browser",
    ...(context.tool?.display || {}),
  };
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  attachComputerOutput,
  computerCompatibility,
  computerOutputItems,
  executeComputerChatToolCalls,
  injectComputerActionTool,
  injectComputerMessages,
  localComputerToolTypes,
  prepareComputerContext,
  suppressComputerChatToolCalls,
};
