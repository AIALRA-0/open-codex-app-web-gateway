"use strict";

const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const TOOL_SEARCH_TOOL_TYPES = new Set(["tool_search"]);
const DEFAULT_SEARCH_TOOL_NAME = "local_tool_search";
const DEFAULT_MAX_LOADED_TOOLS = 10;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canUseLocalToolSearch(config = {}) {
  return String(config.toolSearchProvider || "local").toLowerCase() !== "disabled";
}

function isToolSearchTool(tool) {
  return isPlainObject(tool) && TOOL_SEARCH_TOOL_TYPES.has(tool.type);
}

function localToolSearchToolTypes(tools = [], config = {}) {
  if (!canUseLocalToolSearch(config)) return [];
  if (!(tools || []).some(isToolSearchTool)) return [];
  const types = ["tool_search"];
  if ((tools || []).some((tool) => isPlainObject(tool) && tool.type === "namespace")) types.push("namespace");
  return types;
}

function prepareToolSearchContext(request = {}, config = {}, options = {}) {
  const searchTools = (request.tools || []).filter(isToolSearchTool);
  const inputItems = [
    ...(Array.isArray(options.previousResponse?.output) ? options.previousResponse.output : []),
    ...flattenInputItems(request.input),
  ];
  const inputTools = loadedToolsFromItems(inputItems);
  if ((!searchTools.length && !inputTools.tools.length) || !canUseLocalToolSearch(config)) return null;

  const context = {
    provider: "local",
    status: "completed",
    tool_types: [
      ...(searchTools.length ? ["tool_search"] : []),
      ...(inputTools.tool_search_output_count ? ["tool_search_output"] : []),
      ...(inputTools.additional_tools_count ? ["additional_tools"] : []),
      ...(options.mcpToolSearchEntries?.length ? ["mcp"] : []),
    ],
    execution: searchTools.length
      ? normalizeExecution(searchTools[0].execution)
      : inputTools.execution || "client",
    requested_tool_choice: normalizeToolSearchToolChoice(request.tool_choice),
    search_tool_definition: clone(searchTools[0] || {}),
    namespaces: [],
    searchable_mcp_servers: normalizeMcpToolSearchEntries(options.mcpToolSearchEntries),
    deferred_tools: [],
    immediate_namespace_tools: [],
    loaded_tools: [],
    input_tool_search_output_count: inputTools.tool_search_output_count,
    input_additional_tools_count: inputTools.additional_tools_count,
    input_loaded_tool_count: inputTools.tools.length,
    chat_tool_map: {},
    output_items: [],
    execution_items: [],
    warnings: [],
  };

  for (const tool of request.tools || []) {
    if (!isPlainObject(tool)) continue;
    if (tool.type === "function") {
      const definition = normalizeFunctionTool(tool);
      if (!definition) continue;
      if (tool.defer_loading) context.deferred_tools.push(definition);
      continue;
    }

    if (tool.type === "namespace") {
      const namespace = normalizeNamespace(tool);
      if (!namespace) continue;
      context.namespaces.push(namespace.summary);
      for (const definition of namespace.tools) {
        if (definition.defer_loading) context.deferred_tools.push(definition);
        else context.immediate_namespace_tools.push(definition);
      }
    }
  }

  context.loaded_tools.push(...inputTools.tools);

  preloadForcedToolChoice(context);
  if (
    !context.deferred_tools.length
    && !context.immediate_namespace_tools.length
    && !context.loaded_tools.length
    && !context.searchable_mcp_servers.length
  ) {
    context.status = "empty";
  }
  return context;
}

function normalizeExecution(value) {
  return value === "client" ? "client" : "server";
}

function normalizeToolSearchToolChoice(toolChoice) {
  if (toolChoice == null) return null;
  if (typeof toolChoice === "string") {
    const value = stringifyContent(toolChoice);
    if (["auto", "none", "required"].includes(value)) return { type: value, value };
    return { type: "unsupported", value, reason: "unsupported_string_tool_choice" };
  }
  if (!isPlainObject(toolChoice)) return { type: "unsupported", value: stringifyContent(toolChoice), reason: "unsupported_tool_choice" };
  if (toolChoice.type === "tool_search") return { type: "tool_search" };
  if (toolChoice.type === "function") {
    const name = stringifyContent(toolChoice.name || toolChoice.function?.name || "");
    const namespace = stringifyContent(toolChoice.namespace || toolChoice.function?.namespace || "");
    return name
      ? { type: "function", name, ...(namespace ? { namespace } : {}) }
      : { type: "unsupported", value: clone(toolChoice), reason: "missing_function_name" };
  }
  return { type: "unsupported", value: clone(toolChoice), reason: "unsupported_object_tool_choice" };
}

function normalizeFunctionTool(tool, namespace = null, namespaceDescription = "") {
  if (!isPlainObject(tool) || tool.type !== "function" || !tool.name) return null;
  const name = stringifyContent(tool.name);
  const ns = namespace ? stringifyContent(namespace) : "";
  const path = ns ? `${ns}.${name}` : name;
  const normalized = {
    type: "function",
    name,
    namespace: ns || null,
    namespace_description: namespaceDescription || "",
    path,
    description: stringifyContent(tool.description || ""),
    parameters: isPlainObject(tool.parameters) ? clone(tool.parameters) : { type: "object", properties: {} },
    strict: tool.strict,
    defer_loading: !!tool.defer_loading,
  };
  normalized.response_tool = responseFunctionTool(normalized);
  return normalized;
}

function normalizeNamespace(tool) {
  if (!isPlainObject(tool) || !tool.name) return null;
  const name = stringifyContent(tool.name);
  const description = stringifyContent(tool.description || "");
  const childTools = Array.isArray(tool.tools) ? tool.tools : [];
  const tools = childTools
    .map((child) => normalizeFunctionTool(child, name, description))
    .filter(Boolean);
  return {
    summary: {
      type: "namespace",
      name,
      description,
      tool_count: tools.length,
      deferred_tool_count: tools.filter((child) => child.defer_loading).length,
    },
    tools,
  };
}

function normalizeMcpToolSearchEntries(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(isPlainObject)
    .map((entry) => ({
      type: "mcp_server",
      server_label: stringifyContent(entry.server_label || "").trim(),
      description: stringifyContent(entry.description || "").trim(),
      server_url_host: stringifyContent(entry.server_url_host || "").trim(),
      allowed_tools: stringArray(entry.allowed_tools).slice(0, 100),
    }))
    .filter((entry) => entry.server_label);
}

function responseFunctionTool(definition) {
  const tool = {
    type: "function",
    name: definition.name,
    description: definition.description || "",
    defer_loading: !!definition.defer_loading,
    parameters: clone(definition.parameters || { type: "object", properties: {} }),
  };
  if (definition.strict != null) tool.strict = definition.strict;
  return tool;
}

function loadedToolsFromItems(items = []) {
  const result = {
    tools: [],
    tool_search_output_count: 0,
    additional_tools_count: 0,
    execution: null,
  };
  for (const item of items || []) {
    if (!isPlainObject(item)) continue;
    if (item.type === "tool_search_output" && Array.isArray(item.tools)) {
      result.tool_search_output_count += 1;
      if (!result.execution && item.execution) result.execution = normalizeExecution(item.execution);
      result.tools.push(...normalizeLoadedTools(item.tools));
    } else if (item.type === "additional_tools" && Array.isArray(item.tools)) {
      result.additional_tools_count += 1;
      result.tools.push(...normalizeLoadedTools(item.tools));
    }
  }
  result.tools = uniqueToolsByPath(result.tools);
  return result;
}

function normalizeLoadedTools(tools = []) {
  const loaded = [];
  for (const tool of tools || []) {
    if (!isPlainObject(tool)) continue;
    if (tool.type === "function") {
      const normalized = normalizeFunctionTool(tool);
      if (normalized) loaded.push(normalized);
    } else if (tool.type === "namespace") {
      const namespace = normalizeNamespace(tool);
      if (namespace) loaded.push(...namespace.tools);
    }
  }
  return loaded;
}

function flattenInputItems(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input.flatMap(flattenInputItems);
  return [input];
}

function preloadForcedToolChoice(context) {
  const requested = context.requested_tool_choice;
  if (requested?.type !== "function") return;
  const match = findToolByRequestedName(context.deferred_tools, requested);
  if (!match) return;
  context.loaded_tools.push(match);
  context.forced_preload_count = (context.forced_preload_count || 0) + 1;
}

function findToolByRequestedName(tools = [], requested = {}) {
  return tools.find((tool) => {
    if (requested.namespace && requested.namespace !== tool.namespace) return false;
    return tool.name === requested.name || tool.path === requested.name;
  }) || null;
}

function injectToolSearchMessages(chat, context) {
  if (!chat || !context || context.status === "empty") return;
  chat.messages.push({
    role: "system",
    content: toolSearchPrompt(context),
  });
}

function injectToolSearchChatTools(chat, context, config = {}) {
  if (!chat || !context || context.status === "empty") return;
  if (!Array.isArray(chat.tools)) chat.tools = [];
  const usedNames = new Set((chat.tools || []).map((tool) => tool?.function?.name).filter(Boolean));

  for (const definition of [...context.immediate_namespace_tools, ...context.loaded_tools]) {
    addFunctionTool(chat, context, definition, usedNames);
  }

  if (context.deferred_tools.length || context.searchable_mcp_servers.length) {
    const searchName = uniqueFunctionName(DEFAULT_SEARCH_TOOL_NAME, usedNames);
    usedNames.add(searchName);
    context.chat_search_tool_name = searchName;
    chat.tools.push({
      type: "function",
      function: {
        name: searchName,
        description: context.search_tool_definition.description
          || "Search deferred Responses tools and load the relevant function schemas before calling them.",
        parameters: context.execution === "client" && isPlainObject(context.search_tool_definition.parameters)
          ? clone(context.search_tool_definition.parameters)
          : hostedSearchParameters(),
      },
    });
  }

  applyToolSearchToolChoice(chat, context);
}

function addFunctionTool(chat, context, definition, usedNames) {
  const existing = Object.entries(context.chat_tool_map || {})
    .find(([, mapping]) => mapping.path === definition.path);
  if (existing) return existing[0];
  const chatName = chatFunctionName(definition, usedNames);
  usedNames.add(chatName);
  chat.tools.push({
    type: "function",
    function: {
      name: chatName,
      description: functionDescription(definition),
      parameters: clone(definition.parameters || { type: "object", properties: {} }),
      ...(definition.strict != null ? { strict: definition.strict } : {}),
    },
  });
  context.chat_tool_map[chatName] = {
    name: definition.name,
    namespace: definition.namespace,
    path: definition.path,
    response_tool: clone(definition.response_tool),
  };
  context.loaded_chat_tool_count = Object.keys(context.chat_tool_map).length;
  return chatName;
}

function hostedSearchParameters() {
  return {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural language description of the deferred tool or namespace needed for the task.",
      },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Optional namespace names, MCP server labels, function names, or namespace.function paths to load.",
      },
      server_labels: {
        type: "array",
        items: { type: "string" },
        description: "Optional exact MCP server labels to load.",
      },
      tool_names: {
        type: "array",
        items: { type: "string" },
        description: "Optional exact function names to load.",
      },
    },
    additionalProperties: false,
  };
}

function applyToolSearchToolChoice(chat, context) {
  const requested = context.requested_tool_choice;
  if (!requested) return;
  if (requested.type === "tool_search" && context.chat_search_tool_name) {
    chat.tool_choice = { type: "function", function: { name: context.chat_search_tool_name } };
    context.tool_choice_mapping = {
      source: "tool_choice",
      requested_type: "tool_search",
      forwarded: true,
      target: "function",
      chat_name: context.chat_search_tool_name,
      reason: "tool_search_choice_mapped",
    };
    return;
  }
  if (requested.type === "function") {
    const match = Object.entries(context.chat_tool_map || {})
      .find(([, mapping]) => mapping.name === requested.name || mapping.path === requested.name);
    if (match) {
      chat.tool_choice = { type: "function", function: { name: match[0] } };
      context.tool_choice_mapping = {
        source: "tool_choice",
        requested_type: "function",
        requested_name: requested.name,
        ...(requested.namespace ? { requested_namespace: requested.namespace } : {}),
        forwarded: true,
        target: "function",
        chat_name: match[0],
        reason: "deferred_function_tool_choice_mapped",
      };
    }
    return;
  }
  if (["auto", "none", "required"].includes(requested.type) && chat.tool_choice === undefined) {
    chat.tool_choice = requested.type;
    context.tool_choice_mapping = {
      source: "tool_choice",
      value: requested.type,
      forwarded: true,
      target: "tool_choice",
      reason: "tool_search_tool_choice_passthrough",
    };
  }
}

async function executeToolSearchChatToolCalls(context, chatCompletion, config = {}, options = {}) {
  if (!context?.chat_search_tool_name) return { executed: false, output_items: [], messages: [] };
  const choice = (chatCompletion?.choices || []).find((item) => {
    const calls = item?.message?.tool_calls;
    return Array.isArray(calls) && calls.some((call) => call?.function?.name === context.chat_search_tool_name);
  });
  if (!choice) return { executed: false, output_items: [], messages: [] };

  const searchToolCalls = (choice.message?.tool_calls || [])
    .filter((call) => call?.function?.name === context.chat_search_tool_name);
  if (!searchToolCalls.length) return { executed: false, output_items: [], messages: [] };

  const assistantMessage = {
    role: "assistant",
    content: choice.message?.content ?? null,
    tool_calls: searchToolCalls.map((call) => clone(call)),
  };
  const outputItems = [];
  const toolMessages = [];
  let loadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let mcpLoadedServerCount = 0;
  let mcpLoadedToolCount = 0;
  let mcpFailedServerCount = 0;
  let clientRequested = false;

  const usedNames = new Set((options.chat?.tools || [])
    .map((tool) => tool?.function?.name)
    .filter(Boolean));

  for (const toolCall of searchToolCalls) {
    const callId = toolCall.id || prefixedId("call");
    const rawArguments = stringifyContent(toolCall.function?.arguments || "{}") || "{}";
    let parsedArguments = {};
    let error = null;
    try {
      parsedArguments = parseArguments(rawArguments);
    } catch (parseError) {
      failedCount += 1;
      error = {
        code: "tool_search_invalid_arguments",
        message: parseError.message,
      };
    }

    if (!error && !reserveToolCall(options.toolBudget, { type: "tool_search_call", tool_type: "tool_search" })) {
      skippedCount += 1;
      error = {
        code: "max_tool_calls_exhausted",
        message: "max_tool_calls was exhausted before the tool_search call could run.",
      };
    }

    const callItem = {
      id: prefixedId("tsc"),
      type: "tool_search_call",
      execution: context.execution,
      call_id: context.execution === "client" ? callId : null,
      status: error ? "failed" : "completed",
      arguments: error ? safeArguments(parsedArguments, rawArguments) : publicSearchArguments(parsedArguments),
      ...(error ? { error } : {}),
    };
    outputItems.push(callItem);

    if (context.execution === "client") {
      clientRequested = true;
      continue;
    }

    const selected = error ? [] : selectDeferredTools(context, parsedArguments, config);
    const mcpLoad = !error && typeof options.loadMcpTools === "function"
      ? await options.loadMcpTools(parsedArguments)
      : null;
    const mcpOutputItems = Array.isArray(mcpLoad?.output_items) ? mcpLoad.output_items : [];
    const shouldEmitToolSearchOutput = !!error
      || selected.length > 0
      || mcpOutputItems.length === 0
      || (context.deferred_tools || []).length > 0;
    const outputItem = shouldEmitToolSearchOutput ? {
      id: prefixedId("tso"),
      type: "tool_search_output",
      execution: "server",
      call_id: null,
      status: error ? "failed" : "completed",
      tools: toolsForOutput(selected),
      ...(error ? { error } : {}),
    } : null;
    if (outputItem) outputItems.push(outputItem);
    outputItems.push(...mcpOutputItems.map(clone));
    for (const definition of selected) {
      addFunctionTool(options.chat, context, definition, usedNames);
    }
    loadedCount += selected.length;
    mcpLoadedServerCount += mcpLoad?.loaded_server_count || 0;
    mcpLoadedToolCount += mcpLoad?.loaded_tool_count || 0;
    mcpFailedServerCount += mcpLoad?.failed_server_count || 0;
    toolMessages.push({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify({
        status: error ? "failed" : "completed",
        loaded_tool_count: selected.length,
        tools: toolsForPrompt(selected),
        mcp_loaded_server_count: mcpLoad?.loaded_server_count || 0,
        mcp_loaded_tool_count: mcpLoad?.loaded_tool_count || 0,
        ...(mcpLoad?.failed_server_count ? { mcp_failed_server_count: mcpLoad.failed_server_count } : {}),
        ...(mcpLoad?.prompt_tools?.length ? { mcp_tools: mcpLoad.prompt_tools } : {}),
        ...(error ? { error } : {}),
      }),
    });
  }

  context.search_call_count = (context.search_call_count || 0) + searchToolCalls.length;
  context.loaded_tool_count = (context.loaded_tool_count || 0) + loadedCount;
  context.skipped_count = (context.skipped_count || 0) + skippedCount;
  context.failed_count = (context.failed_count || 0) + failedCount;
  context.mcp_list_tools_loaded_count = (context.mcp_list_tools_loaded_count || 0) + mcpLoadedServerCount;
  context.mcp_loaded_tool_count = (context.mcp_loaded_tool_count || 0) + mcpLoadedToolCount;
  context.mcp_list_tools_failed_count = (context.mcp_list_tools_failed_count || 0) + mcpFailedServerCount;
  context.output_items.push(...outputItems.map(clone));
  context.execution_items.push(...outputItems.map(clone));

  return {
    executed: true,
    client_requested: clientRequested,
    mcp_loaded_server_count: mcpLoadedServerCount,
    mcp_loaded_tool_count: mcpLoadedToolCount,
    mcp_failed_server_count: mcpFailedServerCount,
    output_items: outputItems,
    messages: clientRequested ? [] : [assistantMessage, ...toolMessages],
  };
}

function parseArguments(rawArguments) {
  const parsed = JSON.parse(rawArguments || "{}");
  if (isPlainObject(parsed)) return parsed;
  throw new Error("tool_search arguments must be a JSON object");
}

function publicSearchArguments(args) {
  const paths = stringArray(args.paths || args.path || args.tool_names || args.tool_name);
  const serverLabels = stringArray(args.server_labels || args.server_label);
  const query = stringifyContent(args.query || args.goal || args.description || "").trim();
  return {
    ...(paths.length ? { paths } : {}),
    ...(serverLabels.length ? { server_labels: serverLabels } : {}),
    ...(query ? { query } : {}),
  };
}

function safeArguments(parsedArguments, rawArguments) {
  if (isPlainObject(parsedArguments) && Object.keys(parsedArguments).length) return publicSearchArguments(parsedArguments);
  return { raw: truncate(stringifyContent(rawArguments), 1000) };
}

function selectDeferredTools(context, args = {}, config = {}) {
  const maxTools = boundedNumber(config.toolSearchMaxLoadedTools, DEFAULT_MAX_LOADED_TOOLS, 1, 100);
  const available = uniqueToolsByPath(context.deferred_tools || []);
  if (!available.length) return [];

  const requested = [
    ...stringArray(args.paths || args.path),
    ...stringArray(args.tool_names || args.tool_name || args.names || args.name),
  ].map((item) => item.toLowerCase());

  const exact = [];
  if (requested.length) {
    for (const tool of available) {
      const keys = [tool.path, tool.name, tool.namespace].filter(Boolean).map((item) => item.toLowerCase());
      if (requested.some((value) => keys.includes(value))) exact.push(tool);
    }
  }
  if (exact.length) return uniqueToolsByPath(exact).slice(0, maxTools);

  const query = stringifyContent(args.query || args.goal || args.description || requested.join(" ")).toLowerCase();
  const tokens = query.split(/[^a-z0-9_/-]+/).filter((token) => token.length >= 2);
  const scored = available
    .map((tool) => ({ tool, score: scoreTool(tool, tokens, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.tool);

  if (scored.length) return uniqueToolsByPath(scored).slice(0, maxTools);
  return available.length === 1 ? available.slice(0, 1) : [];
}

function scoreTool(tool, tokens, query) {
  const haystack = [
    tool.path,
    tool.name,
    tool.namespace || "",
    tool.description || "",
    tool.namespace_description || "",
  ].join(" ").toLowerCase();
  let score = query && haystack.includes(query) ? 5 : 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function uniqueToolsByPath(tools = []) {
  const seen = new Set();
  const result = [];
  for (const tool of tools || []) {
    if (!tool?.path || seen.has(tool.path)) continue;
    seen.add(tool.path);
    result.push(tool);
  }
  return result;
}

function toolsForOutput(definitions = []) {
  const namespaceGroups = new Map();
  const topLevel = [];
  for (const definition of definitions || []) {
    if (!definition.namespace) {
      topLevel.push(clone(definition.response_tool));
      continue;
    }
    if (!namespaceGroups.has(definition.namespace)) {
      namespaceGroups.set(definition.namespace, {
        type: "namespace",
        name: definition.namespace,
        description: definition.namespace_description || "",
        tools: [],
      });
    }
    namespaceGroups.get(definition.namespace).tools.push(clone(definition.response_tool));
  }
  return [...namespaceGroups.values(), ...topLevel];
}

function toolsForPrompt(definitions = []) {
  return definitions.map((definition) => ({
    name: definition.name,
    ...(definition.namespace ? { namespace: definition.namespace, path: definition.path } : {}),
    description: definition.description || "",
    parameters: definition.parameters || { type: "object", properties: {} },
  }));
}

function suppressToolSearchChatToolCalls(chatCompletion, context) {
  if (!chatCompletion || !context?.chat_search_tool_name) return chatCompletion;
  const cloned = clone(chatCompletion);
  for (const choice of cloned.choices || []) {
    const calls = choice.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    const remaining = calls.filter((call) => call?.function?.name !== context.chat_search_tool_name);
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

function promoteToolSearchTextToolCalls(chatCompletion, context) {
  if (!chatCompletion || !context?.chat_tool_map || !Object.keys(context.chat_tool_map).length) {
    return chatCompletion;
  }
  let cloned = null;
  let promoted = 0;
  let suppressed = 0;

  for (let index = 0; index < (chatCompletion.choices || []).length; index += 1) {
    const choice = chatCompletion.choices[index];
    const message = choice?.message;
    if (!message || (Array.isArray(message.tool_calls) && message.tool_calls.length)) continue;
    const calls = toolSearchTextToolCallsFromContent(message.content, context);
    if (!calls.length) continue;
    if (!cloned) cloned = clone(chatCompletion);
    const targetChoice = cloned.choices[index];
    targetChoice.message.tool_calls = calls;
    targetChoice.message.content = null;
    if (targetChoice.finish_reason === "stop" || targetChoice.finish_reason == null) {
      targetChoice.finish_reason = "tool_calls";
    }
    promoted += calls.length;
    suppressed += 1;
  }

  if (promoted) {
    context.text_tool_call_count = (context.text_tool_call_count || 0) + promoted;
    context.text_suppressed_count = (context.text_suppressed_count || 0) + suppressed;
  }
  return cloned || chatCompletion;
}

function toolSearchTextToolCallsFromContent(content, context) {
  const text = chatContentText(content);
  if (!text || !/DSML|tool_calls|invoke/i.test(text)) return [];
  const calls = [];
  const invokePattern = /<[^>]*invoke\b([^>]*)>([\s\S]*?)<\/[^>]*invoke>/gi;
  for (const match of text.matchAll(invokePattern)) {
    const attrs = match[1] || "";
    const invokeName = decodeTextToolCallValue(attributeValue(attrs, "name")).trim();
    if (!invokeName) continue;
    const params = textToolSearchParameters(match[2] || "");
    const functionName = [
      invokeName,
      params.method && invokeName ? `${invokeName}.${params.method}` : "",
      params.namespace && params.method ? `${params.namespace}.${params.method}` : "",
      params.path,
      params.name,
      params.tool_name,
      params.function,
      params.method,
    ].map((candidate) => findToolSearchChatFunctionName(context, candidate)).find(Boolean);
    if (!functionName) continue;
    calls.push({
      id: prefixedId("call"),
      type: "function",
      function: {
        name: functionName,
        arguments: textToolSearchArgumentsFromParams(params),
      },
    });
  }
  return calls;
}

function findToolSearchChatFunctionName(context, emittedName) {
  const rawName = stringifyContent(emittedName || "").trim();
  if (!rawName || !context?.chat_tool_map) return "";
  if (context.chat_tool_map[rawName]) return rawName;
  const matches = [];
  for (const [chatName, mapping] of Object.entries(context.chat_tool_map || {})) {
    const names = [
      mapping.path,
      mapping.namespace && mapping.name ? `${mapping.namespace}.${mapping.name}` : "",
      mapping.name,
    ].filter(Boolean);
    if (names.includes(rawName)) matches.push(chatName);
  }
  return matches.length === 1 ? matches[0] : "";
}

function textToolSearchParameters(text) {
  const params = {};
  const parameterPattern = /<[^>]*parameter\b([^>]*)>([\s\S]*?)<\/[^>]*parameter>/gi;
  for (const match of text.matchAll(parameterPattern)) {
    const attrs = match[1] || "";
    const key = decodeTextToolCallValue(attributeValue(attrs, "name")).trim();
    if (!key) continue;
    const stringFlag = decodeTextToolCallValue(attributeValue(attrs, "string")).trim().toLowerCase();
    const rawValue = decodeTextToolCallValue(match[2]).trim();
    params[key] = stringFlag === "false" ? parseJsonLenient(rawValue, rawValue) : rawValue;
  }
  return params;
}

function textToolSearchArgumentsFromParams(params = {}) {
  if (isPlainObject(params.params)) return JSON.stringify(params.params);
  if (typeof params.params === "string") {
    const parsed = parseJsonLenient(params.params, null);
    if (isPlainObject(parsed)) return JSON.stringify(parsed);
  }
  if (isPlainObject(params.input)) return JSON.stringify(params.input);
  if (typeof params.input === "string") {
    const parsed = parseJsonLenient(params.input, null);
    if (isPlainObject(parsed)) return JSON.stringify(parsed);
  }
  if (isPlainObject(params.arguments)) return JSON.stringify(params.arguments);
  if (typeof params.arguments === "string") {
    const parsed = parseJsonLenient(params.arguments, null);
    if (isPlainObject(parsed)) return JSON.stringify(parsed);
  }
  const ignored = new Set([
    "arguments",
    "function",
    "input",
    "method",
    "name",
    "namespace",
    "params",
    "path",
    "tool_call_id",
    "tool_name",
  ]);
  const args = {};
  for (const [key, value] of Object.entries(params)) {
    if (ignored.has(key)) continue;
    args[key] = value;
  }
  return JSON.stringify(args);
}

function parseJsonLenient(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function attributeValue(attributes, name) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attributes || "");
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function chatContentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (isPlainObject(part)) return stringifyContent(part.text ?? part.content ?? part.output_text ?? "");
      return stringifyContent(part);
    }).filter(Boolean).join("\n");
  }
  return stringifyContent(content);
}

function decodeTextToolCallValue(value) {
  return stringifyContent(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function remapToolSearchChatToolCalls(chatCompletion, context) {
  if (!chatCompletion || !context?.chat_tool_map) return chatCompletion;
  const cloned = clone(chatCompletion);
  for (const choice of cloned.choices || []) {
    const calls = choice.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const mapping = context.chat_tool_map[call?.function?.name];
      if (!mapping) continue;
      call.function.name = mapping.name;
      if (mapping.namespace) call.function.namespace = mapping.namespace;
    }
  }
  return cloned;
}

function remapToolSearchResponseOutput(response, context) {
  if (!response || !context?.chat_tool_map) return response;
  let remapped = 0;
  for (const item of response.output || []) {
    if (item?.type !== "function_call") continue;
    const mapping = context.chat_tool_map[item.name];
    if (!mapping) continue;
    const nextName = mapping.name || item.name;
    const hadNamespace = Object.prototype.hasOwnProperty.call(item, "namespace");
    const changed = item.name !== nextName
      || (mapping.namespace ? item.namespace !== mapping.namespace : hadNamespace);
    item.name = nextName;
    if (mapping.namespace) {
      item.namespace = mapping.namespace;
    } else {
      delete item.namespace;
    }
    if (changed) remapped += 1;
  }
  if (remapped) context.stream_remapped_tool_call_count = (context.stream_remapped_tool_call_count || 0) + remapped;
  return response;
}

function attachToolSearchOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...toolSearchOutputItems(context),
    ...(response.output || []),
  ];
  return response;
}

function toolSearchOutputItems(context) {
  return (context?.output_items || []).map(clone);
}

function toolSearchCompatibility(context) {
  if (!context) return {};
  return {
    local_tool_search: {
      provider: context.provider || "local",
      status: context.status || "completed",
      execution: context.execution || "server",
      tool_types: context.tool_types || [],
      namespace_count: context.namespaces?.length || 0,
      deferred_tool_count: context.deferred_tools?.length || 0,
      searchable_mcp_server_count: context.searchable_mcp_servers?.length || 0,
      immediate_namespace_tool_count: context.immediate_namespace_tools?.length || 0,
      loaded_input_tool_count: context.input_loaded_tool_count || context.loaded_tools?.length || 0,
      input_tool_search_output_count: context.input_tool_search_output_count || 0,
      input_additional_tools_count: context.input_additional_tools_count || 0,
      forced_preload_count: context.forced_preload_count || 0,
      search_call_count: context.search_call_count || 0,
      loaded_tool_count: context.loaded_tool_count || 0,
      mcp_list_tools_loaded_count: context.mcp_list_tools_loaded_count || 0,
      mcp_loaded_tool_count: context.mcp_loaded_tool_count || 0,
      mcp_list_tools_failed_count: context.mcp_list_tools_failed_count || 0,
      loaded_chat_tool_count: Object.keys(context.chat_tool_map || {}).length,
      stream_remapped_tool_call_count: context.stream_remapped_tool_call_count || 0,
      text_tool_call_count: context.text_tool_call_count || 0,
      text_suppressed_count: context.text_suppressed_count || 0,
      skipped_count: context.skipped_count || 0,
      failed_count: context.failed_count || 0,
      ...(context.chat_search_tool_name ? { chat_search_tool_name: context.chat_search_tool_name } : {}),
      ...(context.tool_choice_mapping ? { tool_choice: clone(context.tool_choice_mapping) } : {}),
      boundary: context.search_call_count
        ? context.mcp_list_tools_loaded_count
          ? "deferred_mcp_tool_search_and_load"
          : "deferred_tool_search_and_load"
        : context.input_tool_search_output_count
          ? "loaded_from_tool_search_output_input"
          : context.input_additional_tools_count
            ? "loaded_from_additional_tools_input"
            : context.loaded_tools?.length
              ? "loaded_from_input_tools"
          : context.deferred_tools?.length || context.searchable_mcp_servers?.length
            ? "deferred_tools_hidden_until_search"
            : "no_deferred_tools",
      ...(context.warnings?.length ? { warnings: context.warnings.slice(0, 5) } : {}),
    },
  };
}

function toolSearchPrompt(context) {
  const lines = [
    "Local Responses tool_search compatibility is active.",
    "Deferred tool schemas are hidden from this Chat-only provider until a tool search loads them. Use the local tool search function only when a deferred tool is needed.",
  ];
  if (context.namespaces?.length) {
    lines.push("Searchable namespaces:");
    for (const namespace of context.namespaces) {
      lines.push(`- ${namespace.name}: ${truncate(namespace.description || "No description.", 400)} deferred_tools=${namespace.deferred_tool_count}`);
    }
  }
  if (context.searchable_mcp_servers?.length) {
    lines.push("Searchable MCP servers:");
    for (const server of context.searchable_mcp_servers) {
      lines.push([
        `- ${server.server_label}: ${truncate(server.description || server.server_url_host || "No description.", 400)}`,
        server.allowed_tools?.length ? `allowed_tools=${server.allowed_tools.join(", ")}` : null,
      ].filter(Boolean).join(" "));
    }
  }
  const direct = (context.deferred_tools || []).filter((tool) => !tool.namespace);
  if (direct.length) {
    lines.push("Searchable deferred functions:");
    for (const tool of direct) lines.push(`- ${tool.name}: ${truncate(tool.description || "No description.", 400)}`);
  }
  const loaded = Object.values(context.chat_tool_map || {});
  if (loaded.length) {
    lines.push("Loaded callable tools:");
    for (const tool of loaded) lines.push(`- ${tool.path}`);
  }
  return lines.join("\n");
}

function functionDescription(definition) {
  return [
    definition.namespace ? `Responses namespace ${definition.namespace}; original function ${definition.name}.` : "",
    definition.description || "",
  ].filter(Boolean).join(" ");
}

function chatFunctionName(definition, usedNames) {
  const preferred = safeFunctionName(definition.name);
  if (preferred && !usedNames.has(preferred)) return preferred;
  const scoped = safeFunctionName([definition.namespace, definition.name].filter(Boolean).join("_"));
  return uniqueFunctionName(scoped || definition.name || "tool", usedNames);
}

function uniqueFunctionName(value, usedNames) {
  const base = safeFunctionName(value) || "tool";
  if (!usedNames.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const suffix = `_${index}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    if (!usedNames.has(candidate)) return candidate;
  }
  return `${base.slice(0, 55)}_${Date.now().toString(36)}`;
}

function safeFunctionName(value) {
  return stringifyContent(value || "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 64);
}

function stringArray(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => stringifyContent(item).trim()).filter(Boolean);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function truncate(value, max) {
  const text = stringifyContent(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

module.exports = {
  attachToolSearchOutput,
  executeToolSearchChatToolCalls,
  injectToolSearchChatTools,
  injectToolSearchMessages,
  localToolSearchToolTypes,
  prepareToolSearchContext,
  promoteToolSearchTextToolCalls,
  remapToolSearchChatToolCalls,
  remapToolSearchResponseOutput,
  suppressToolSearchChatToolCalls,
  toolSearchCompatibility,
  toolSearchOutputItems,
};
