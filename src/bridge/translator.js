"use strict";

const crypto = require("node:crypto");

const DEFAULT_TEXT = Object.freeze({ format: { type: "text" } });
const DEFAULT_REASONING = Object.freeze({ effort: null, summary: null });

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function prefixedId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringifyContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeContentParts(content, role = "user") {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyContent(content);

  const parts = [];
  const textFallback = [];

  for (const part of content) {
    if (!isPlainObject(part)) {
      textFallback.push(stringifyContent(part));
      continue;
    }

    if (part.type === "input_text" || part.type === "output_text" || part.type === "text") {
      const text = stringifyContent(part.text ?? part.content ?? "");
      if (role === "user") parts.push({ type: "text", text });
      else textFallback.push(text);
      continue;
    }

    if (part.type === "input_image" || part.type === "image_url") {
      const url = part.image_url?.url || part.image_url || part.url;
      if (role === "user" && url) {
        parts.push({ type: "image_url", image_url: { url } });
      } else {
        textFallback.push(`[image:${url || part.file_id || "inline"}]`);
      }
      continue;
    }

    if (part.type === "input_file") {
      const fileHint = part.file_url || part.file_id || part.filename || "attached-file";
      const text = part.text ? `\n${part.text}` : "";
      textFallback.push(`[file:${fileHint}]${text}`);
      continue;
    }

    if (part.type === "refusal" || part.type === "output_refusal") {
      textFallback.push(stringifyContent(part.refusal ?? part.text ?? ""));
      continue;
    }

    textFallback.push(`[${part.type || "content"}:${JSON.stringify(part)}]`);
  }

  if (parts.length > 0) {
    if (textFallback.length > 0) parts.unshift({ type: "text", text: textFallback.join("\n") });
    return parts;
  }

  return textFallback.join("\n");
}

function normalizeChatRole(role, options = {}) {
  if (role === "developer") return options.developerRole || "system";
  if (role === "system") return "system";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  return "user";
}

function inputItemToChatMessages(item, options = {}) {
  if (typeof item === "string") return [{ role: "user", content: item }];
  if (!isPlainObject(item)) return [{ role: "user", content: stringifyContent(item) }];

  if (item.type === "message" || item.role) {
    const role = normalizeChatRole(item.role, options);
    const message = {
      role,
      content: normalizeContentParts(item.content, role),
    };
    if (item.name) message.name = item.name;
    if (item.tool_call_id) message.tool_call_id = item.tool_call_id;
    if (item.reasoning_content) message.reasoning_content = item.reasoning_content;
    if (Array.isArray(item.tool_calls)) message.tool_calls = item.tool_calls;
    return [message];
  }

  if (item.type === "function_call") {
    return [{
      role: "assistant",
      content: null,
      tool_calls: [{
        id: item.call_id || item.id || prefixedId("call"),
        type: "function",
        function: {
          name: item.name,
          arguments: stringifyContent(item.arguments),
        },
      }],
      ...(item.reasoning_content ? { reasoning_content: item.reasoning_content } : {}),
    }];
  }

  if (item.type === "function_call_output") {
    return [{
      role: "tool",
      tool_call_id: item.call_id,
      content: stringifyContent(item.output ?? item.content ?? ""),
    }];
  }

  if (item.type === "reasoning") {
    const text = reasoningItemToText(item);
    if (!text) return [];
    return [{ role: "assistant", content: "", reasoning_content: text }];
  }

  if (item.type === "compaction") {
    const summary = decodeCompactionItem(item, options);
    return [{
      role: options.compactionRole || "system",
      content: summary
        ? `Compacted conversation context:\n${summary}`
        : "A compacted conversation context item was provided, but this bridge could not decode its opaque content. Continue using any other visible input items.",
    }];
  }

  return [{ role: "user", content: `[${item.type || "item"}:${JSON.stringify(item)}]` }];
}

function decodeCompactionItem(item, options = {}) {
  if (!isPlainObject(item)) return "";
  if (typeof item.summary === "string") return item.summary;
  if (typeof options.decodeCompaction === "function") {
    try {
      return stringifyContent(options.decodeCompaction(item.encrypted_content || ""));
    } catch {
      return "";
    }
  }
  return "";
}

function reasoningItemToText(item) {
  if (!isPlainObject(item)) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (typeof item.encrypted_content === "string") return item.encrypted_content;
  if (Array.isArray(item.summary)) {
    return item.summary
      .map((part) => stringifyContent(part?.text ?? part?.summary_text ?? part))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function responseInputToChatMessages(input, options = {}) {
  if (input == null) return [];
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return inputItemToChatMessages(input, options);
  return input.flatMap((item) => inputItemToChatMessages(item, options));
}

function mapResponsesTools(tools = [], options = {}) {
  const mapped = [];
  const unsupported = [];
  const localHostedTools = new Set(options.localHostedTools || []);

  for (const tool of tools || []) {
    if (!isPlainObject(tool)) continue;
    if (tool.type === "function") {
      mapped.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.parameters || { type: "object", properties: {} },
          ...(tool.strict != null ? { strict: tool.strict } : {}),
        },
      });
    } else if (localHostedTools.has(tool.type)) {
      continue;
    } else {
      unsupported.push(tool.type || "unknown");
    }
  }

  return { mapped, unsupported };
}

function mapToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (!isPlainObject(toolChoice)) return undefined;
  if (toolChoice.type === "function") {
    const name = toolChoice.name || toolChoice.function?.name;
    if (name) return { type: "function", function: { name } };
  }
  return toolChoice;
}

function mapTextFormat(text, options = {}) {
  const format = text?.format || text;
  if (!isPlainObject(format)) return undefined;
  if (format.type === "json_object") return { type: "json_object" };
  if (format.type === "json_schema") {
    if (options.jsonSchemaMode === "json_object") return { type: "json_object" };
    if (options.jsonSchemaMode === "off") return undefined;
    return {
      type: "json_schema",
      json_schema: {
        name: format.name,
        description: format.description,
        strict: format.strict,
        schema: format.schema,
      },
    };
  }
  return undefined;
}

function mapReasoning(reasoning, options = {}) {
  if (!isPlainObject(reasoning)) return {};
  const mapped = {};
  if (reasoning.effort) mapped.reasoning_effort = normalizeReasoningEffort(reasoning.effort, options);
  if (reasoning.summary && options.forwardReasoningSummary) mapped.reasoning_summary = reasoning.summary;
  return mapped;
}

function normalizeReasoningEffort(effort, options = {}) {
  if (!options.deepseekReasoningEffortCompat) return effort;
  if (effort === "xhigh") return "max";
  if (effort === "minimal" || effort === "low" || effort === "medium") return "high";
  return effort;
}

function makeCompatibilityMessage(unsupportedTools) {
  if (!unsupportedTools.length) return null;
  const unique = Array.from(new Set(unsupportedTools)).join(", ");
  return {
    role: "system",
    content: [
      "Compatibility notice: this upstream provider only exposes Chat Completions function tools.",
      `The client requested Responses hosted tool types that cannot be invoked upstream: ${unique}.`,
      "Use available function tools or explain the unavailable capability instead of inventing hosted tool results.",
    ].join("\n"),
  };
}

function responsesToChatRequest(request, previousMessages = [], options = {}) {
  const messages = [];
  if (request.instructions) {
    messages.push({ role: options.instructionsRole || "system", content: stringifyContent(request.instructions) });
  }

  const structuredOutputMessage = makeStructuredOutputMessage(request.text, options);
  if (structuredOutputMessage) messages.push(structuredOutputMessage);

  for (const message of previousMessages || []) {
    if (isPlainObject(message)) messages.push(message);
  }

  messages.push(...responseInputToChatMessages(request.input, options));

  const { mapped: tools, unsupported } = mapResponsesTools(request.tools || [], options);
  const compatibilityMessage = makeCompatibilityMessage(unsupported);
  if (compatibilityMessage) messages.unshift(compatibilityMessage);

  const chat = {
    model: request.model || options.defaultModel,
    messages,
    stream: !!request.stream,
  };

  copyIfPresent(request, chat, "temperature");
  copyIfPresent(request, chat, "top_p");
  copyIfPresent(request, chat, "frequency_penalty");
  copyIfPresent(request, chat, "presence_penalty");
  copyIfPresent(request, chat, "seed");
  copyIfPresent(request, chat, "user");
  copyIfPresent(request, chat, "metadata");
  copyIfPresent(request, chat, "store");
  copyIfPresent(request, chat, "parallel_tool_calls");
  copyIfPresent(request, chat, "top_logprobs");
  copyIfPresent(request, chat, "stop");

  const serviceTierCompatibility = mapServiceTier(request, chat, options);
  const streamOptionsCompatibility = mapStreamOptions(request, chat, options);
  const deepseekUserIdCompatibility = mapDeepSeekUserId(request, chat, options);

  const logprobsRequested = shouldRequestChatLogprobs(request);
  if (logprobsRequested !== undefined) chat.logprobs = logprobsRequested;

  const maxTokensCompatibility = mapMaxTokens(request, chat, options);

  const toolChoice = mapToolChoice(request.tool_choice);
  if (tools.length) {
    chat.tools = tools;
    if (toolChoice !== undefined) chat.tool_choice = toolChoice;
  }

  const responseFormat = mapTextFormat(request.text, options);
  if (responseFormat) chat.response_format = responseFormat;

  Object.assign(chat, mapReasoning(request.reasoning, options));
  const disableThinkingForToolChoice = !!(
    options.deepseekDisableThinkingForToolChoice
    && tools.length
    && toolChoice !== undefined
    && !options.deepseekThinkingMode
  );
  if (disableThinkingForToolChoice) chat.thinking = { type: "disabled" };
  if (options.deepseekThinkingMode && request.reasoning?.effort) chat.thinking = { type: "enabled" };

  return {
    chat,
    compatibility: {
      unsupported_tools: unsupported,
      ...(toolChoice !== undefined && !tools.length && hasLocalHostedToolRequest(request.tools, options)
        ? { local_tool_choice: "handled_by_bridge" }
        : {}),
      ...(disableThinkingForToolChoice ? { deepseek_thinking: "disabled_for_tool_choice" } : {}),
      ...(logprobsRequested ? { logprobs: "chat_logprobs" } : {}),
      ...(serviceTierCompatibility ? { service_tier: serviceTierCompatibility } : {}),
      ...(streamOptionsCompatibility ? { stream_options: streamOptionsCompatibility } : {}),
      ...(deepseekUserIdCompatibility ? { deepseek_user_id: deepseekUserIdCompatibility } : {}),
      ...(maxTokensCompatibility ? { max_completion_tokens: maxTokensCompatibility } : {}),
    },
  };
}

function mapMaxTokens(request, chat, options = {}) {
  const maxTokensField = options.maxTokensField || "max_tokens";
  if (request.max_output_tokens != null) {
    chat[maxTokensField] = request.max_output_tokens;
    if (
      request.max_completion_tokens != null
      && request.max_completion_tokens !== request.max_output_tokens
    ) {
      return {
        source: "max_completion_tokens",
        value: request.max_completion_tokens,
        forwarded: false,
        reason: "max_output_tokens_precedence",
      };
    }
    return null;
  }

  if (request.max_completion_tokens == null) return null;
  chat[maxTokensField] = request.max_completion_tokens;
  return {
    source: "max_completion_tokens",
    target: maxTokensField,
    value: request.max_completion_tokens,
    forwarded: true,
    reason: "chat_alias",
  };
}

function mapStreamOptions(request, chat, options = {}) {
  if (request.stream_options !== undefined && !request.stream) {
    return {
      source: "stream_options",
      forwarded: false,
      reason: "stream_required",
    };
  }
  if (!request.stream) return null;

  if (options.forwardStreamOptions === false) {
    return {
      source: "stream_options",
      forwarded: false,
      reason: "provider_unsupported",
    };
  }

  let compatibility = null;
  if (request.stream_options !== undefined) {
    chat.stream_options = isPlainObject(request.stream_options)
      ? { ...request.stream_options }
      : request.stream_options;
  }

  if (options.streamIncludeUsage !== false) {
    if (!isPlainObject(chat.stream_options)) chat.stream_options = {};
    if (chat.stream_options.include_usage === undefined) {
      chat.stream_options.include_usage = true;
      compatibility = {
        source: "stream_options.include_usage",
        value: true,
        forwarded: true,
        reason: "enabled_by_bridge",
      };
    }
  }

  return compatibility;
}

function mapServiceTier(request, chat, options = {}) {
  if (request.service_tier === undefined) return null;
  if (options.forwardServiceTier === false) {
    return {
      source: "service_tier",
      value: request.service_tier,
      forwarded: false,
      reason: "provider_unsupported",
    };
  }
  chat.service_tier = request.service_tier;
  return null;
}

function mapDeepSeekUserId(request, chat, options = {}) {
  if (!options.deepseekUserIdCompat) return null;
  const candidates = [
    ["user_id", request.user_id],
    ["safety_identifier", request.safety_identifier],
    ["prompt_cache_key", request.prompt_cache_key],
    ["user", request.user],
  ];
  const found = candidates.find(([, value]) => value != null && value !== "");
  if (!found) return null;

  const [source, value] = found;
  const { userId, normalized } = normalizeDeepSeekUserId(value);
  chat.user_id = userId;
  delete chat.user;
  return { source, normalized };
}

function normalizeDeepSeekUserId(value) {
  const raw = stringifyContent(value);
  if (/^[A-Za-z0-9_-]{1,512}$/.test(raw)) {
    return { userId: raw, normalized: "direct" };
  }
  return {
    userId: `sha256_${crypto.createHash("sha256").update(raw).digest("hex")}`,
    normalized: "sha256",
  };
}

function shouldRequestChatLogprobs(request = {}) {
  if (request.top_logprobs != null) return true;
  if ((request.include || []).some((item) => item === "message.output_text.logprobs")) return true;
  if (request.logprobs !== undefined) return !!request.logprobs;
  return undefined;
}

function hasLocalHostedToolRequest(tools = [], options = {}) {
  const localHostedTools = new Set(options.localHostedTools || []);
  return (tools || []).some((tool) => isPlainObject(tool) && localHostedTools.has(tool.type));
}

function makeStructuredOutputMessage(text, options = {}) {
  const format = text?.format || text;
  if (!isPlainObject(format) || format.type !== "json_schema" || options.jsonSchemaMode !== "json_object") return null;
  return {
    role: "system",
    content: [
      "Structured output compatibility: return only valid JSON matching this JSON Schema.",
      JSON.stringify({
        name: format.name,
        strict: format.strict,
        schema: format.schema,
      }),
    ].join("\n"),
  };
}

function copyIfPresent(source, target, key) {
  if (source[key] !== undefined) target[key] = source[key];
}

function mapUsage(usage) {
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const reasoningTokens =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens ??
    0;
  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_cache_hit_tokens ??
    0;

  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: reasoningTokens },
    total_tokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
}

function createResponseSkeleton(request = {}, overrides = {}) {
  const createdAt = overrides.created_at || nowSeconds();
  return {
    id: overrides.id || prefixedId("resp"),
    object: "response",
    created_at: createdAt,
    status: overrides.status || "in_progress",
    completed_at: overrides.completed_at ?? null,
    background: request.background ?? false,
    error: overrides.error ?? null,
    incomplete_details: overrides.incomplete_details ?? null,
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    max_tool_calls: request.max_tool_calls ?? null,
    model: request.model || overrides.model || null,
    output: [],
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: request.reasoning || { ...DEFAULT_REASONING },
    service_tier: request.service_tier ?? "default",
    store: request.store ?? true,
    temperature: request.temperature ?? 1,
    text: request.text || clone(DEFAULT_TEXT),
    tool_choice: request.tool_choice ?? "auto",
    tools: request.tools || [],
    top_logprobs: request.top_logprobs ?? 0,
    top_p: request.top_p ?? 1,
    truncation: request.truncation ?? "disabled",
    usage: null,
    user: request.user ?? null,
    metadata: request.metadata || {},
  };
}

function chatCompletionToResponse(chat, request = {}, options = {}) {
  const response = createResponseSkeleton(request, {
    id: options.responseId || prefixedId("resp"),
    created_at: chat.created || nowSeconds(),
    model: chat.model || request.model,
  });

  const choices = Array.isArray(chat.choices) && chat.choices.length ? chat.choices : [{}];
  for (const choice of choices) {
    const message = choice.message || {};
    appendReasoningOutput(response, message.reasoning_content);
    appendMessageOutput(response, message, choice.logprobs);
    appendToolCallOutputs(response, message.tool_calls || []);
    appendLegacyFunctionCallOutput(response, message.function_call, legacyFunctionCallId(chat, choice));
  }

  const compatibilityMetadata = chatCompatibilityMetadata(chat);
  Object.assign(compatibilityMetadata, chatChoicesCompatibilityMetadata(chat.choices));
  Object.assign(compatibilityMetadata, chatUsageCompatibilityMetadata(chat.usage));
  const refusalLogprobs = chatRefusalLogprobs(choices);
  if (refusalLogprobs.length) compatibilityMetadata.chat_refusal_logprobs = refusalLogprobs;
  attachResponseCompatibilityMetadata(response, compatibilityMetadata);

  const finishReasons = choices.map((choice) => choice.finish_reason).filter(Boolean);
  const terminal = responseTerminalStateFromFinishReasons(finishReasons);
  response.status = terminal.status;
  response.completed_at = terminal.completed_at;
  response.incomplete_details = terminal.incomplete_details;
  response.error = terminal.error;
  response.usage = mapUsage(chat.usage);
  if (chat.service_tier != null) response.service_tier = chat.service_tier;

  return response;
}

function chatCompatibilityMetadata(chat) {
  if (!isPlainObject(chat)) return {};
  const metadata = {};
  const fieldMap = {
    id: "chat_completion_id",
    object: "chat_object",
    created: "chat_created",
    model: "chat_model",
    system_fingerprint: "chat_system_fingerprint",
    request_id: "chat_request_id",
    input_user: "chat_input_user",
    seed: "chat_seed",
    tool_choice: "chat_tool_choice",
    response_format: "chat_response_format",
    temperature: "chat_temperature",
    top_p: "chat_top_p",
    presence_penalty: "chat_presence_penalty",
    frequency_penalty: "chat_frequency_penalty",
    metadata: "chat_metadata",
    tools: "chat_tools",
  };
  for (const [source, target] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(chat, source) && chat[source] !== undefined) {
      metadata[target] = clone(chat[source]);
    }
  }
  return metadata;
}

function chatUsageCompatibilityMetadata(usage) {
  if (usage === undefined) return {};
  return { chat_usage: clone(usage) };
}

function chatChoicesCompatibilityMetadata(choices) {
  if (!Array.isArray(choices) || !choices.length) return {};
  return {
    chat_choices: choices.map((choice, ordinal) => {
      const entry = { choice_index: choice?.index ?? ordinal };
      if (choice && Object.prototype.hasOwnProperty.call(choice, "finish_reason")) {
        entry.finish_reason = choice.finish_reason;
      }
      return entry;
    }),
  };
}

function attachResponseCompatibilityMetadata(response, compatibilityMetadata) {
  if (!Object.keys(compatibilityMetadata).length) return;
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: {
      ...(isPlainObject(response.metadata?.compatibility) ? response.metadata.compatibility : {}),
      ...compatibilityMetadata,
    },
  };
}

function responseTerminalStateFromFinishReasons(finishReasons = []) {
  const reasons = new Set(asArray(finishReasons).filter(Boolean).map(String));

  if (reasons.has("insufficient_system_resource")) {
    return {
      status: "failed",
      completed_at: null,
      incomplete_details: null,
      error: {
        code: "server_error",
        message: "Upstream chat completion ended with finish_reason=\"insufficient_system_resource\".",
      },
    };
  }

  if (reasons.has("content_filter")) {
    return {
      status: "incomplete",
      completed_at: null,
      incomplete_details: { reason: "content_filter" },
      error: null,
    };
  }

  if (reasons.has("length") || reasons.has("max_tokens") || reasons.has("max_output_tokens")) {
    return {
      status: "incomplete",
      completed_at: null,
      incomplete_details: { reason: "max_output_tokens" },
      error: null,
    };
  }

  return {
    status: "completed",
    completed_at: nowSeconds(),
    incomplete_details: null,
    error: null,
  };
}

function appendReasoningOutput(response, reasoningContent) {
  if (!reasoningContent) return;
  response.output.push({
    id: prefixedId("rs"),
    type: "reasoning",
    status: "completed",
    summary: [{ type: "summary_text", text: stringifyContent(reasoningContent) }],
  });
}

function appendMessageOutput(response, message, choiceLogprobs = null) {
  const hasText = message.content != null && message.content !== "";
  const hasRefusal = message.refusal != null && message.refusal !== "";
  if (!hasText && !hasRefusal && Array.isArray(message.tool_calls) && message.tool_calls.length) return;
  if (!hasText && !hasRefusal) return;

  const content = [];
  if (hasText) {
    const logprobs = normalizeChatTextLogprobs(choiceLogprobs ?? message.logprobs);
    content.push({
      type: "output_text",
      text: normalizeAssistantText(message.content),
      annotations: Array.isArray(message.annotations) ? message.annotations : [],
      ...(logprobs !== undefined ? { logprobs } : {}),
    });
  }
  if (hasRefusal) {
    content.push({ type: "refusal", refusal: stringifyContent(message.refusal) });
  }

  response.output.push({
    id: prefixedId("msg"),
    type: "message",
    status: "completed",
    role: "assistant",
    content,
  });
}

function chatRefusalLogprobs(choices) {
  return choices
    .map((choice) => ({
      choice_index: choice.index ?? 0,
      logprobs: normalizeOutputTextLogprobs(choice.logprobs?.refusal),
    }))
    .filter((entry) => Array.isArray(entry.logprobs) && entry.logprobs.length);
}

function normalizeChatTextLogprobs(logprobs) {
  if (Array.isArray(logprobs)) return normalizeOutputTextLogprobs(logprobs);
  if (Array.isArray(logprobs?.content) || Array.isArray(logprobs?.output_text)) {
    return normalizeOutputTextLogprobs(logprobs);
  }
  return undefined;
}

function normalizeOutputTextLogprobs(logprobs) {
  if (logprobs == null) return undefined;
  if (Array.isArray(logprobs)) return clone(logprobs);
  if (Array.isArray(logprobs.content)) return clone(logprobs.content);
  if (Array.isArray(logprobs.output_text)) return clone(logprobs.output_text);
  return clone(logprobs);
}

function normalizeAssistantText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return part?.text ?? part?.content ?? JSON.stringify(part);
      })
      .join("");
  }
  return stringifyContent(content);
}

function appendToolCallOutputs(response, toolCalls) {
  for (const toolCall of toolCalls || []) {
    if (!toolCall || toolCall.type !== "function") continue;
    response.output.push({
      id: prefixedId("fc"),
      type: "function_call",
      call_id: toolCall.id || prefixedId("call"),
      name: toolCall.function?.name,
      arguments: stringifyContent(toolCall.function?.arguments ?? ""),
      status: "completed",
    });
  }
}

function appendLegacyFunctionCallOutput(response, functionCall, callId) {
  if (!isPlainObject(functionCall) || !functionCall.name) return;
  response.output.push({
    id: prefixedId("fc"),
    type: "function_call",
    call_id: callId,
    name: functionCall.name,
    arguments: stringifyContent(functionCall.arguments ?? ""),
    status: "completed",
  });
}

function legacyFunctionCallId(chat, choice = {}) {
  const raw = stringifyContent(chat?.id || "compat");
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "compat";
  return `call_${safe}_${choice.index ?? 0}`;
}

function chatCompletionToReplayMessages(chat) {
  const choices = Array.isArray(chat?.choices) ? chat.choices : [];
  return choices.flatMap((choice) => {
    const message = choice.message || {};
    if (!message || Object.keys(message).length === 0) return [];

    const replay = {
      role: "assistant",
      content: message.content ?? null,
    };
    if (message.tool_calls) {
      replay.tool_calls = message.tool_calls;
    } else if (isPlainObject(message.function_call) && message.function_call.name) {
      replay.tool_calls = [{
        id: legacyFunctionCallId(chat, choice),
        type: "function",
        function: {
          name: message.function_call.name,
          arguments: stringifyContent(message.function_call.arguments ?? ""),
        },
      }];
    }
    if (message.reasoning_content) replay.reasoning_content = message.reasoning_content;
    if (message.refusal) replay.refusal = message.refusal;
    return [replay];
  });
}

function responseOutputToReplayMessages(response) {
  return asArray(response.output).flatMap((item) => inputItemToChatMessages(item));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  chatCompatibilityMetadata,
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  chatUsageCompatibilityMetadata,
  createResponseSkeleton,
  inputItemToChatMessages,
  mapResponsesTools,
  mapTextFormat,
  mapToolChoice,
  mapUsage,
  normalizeOutputTextLogprobs,
  normalizeReasoningEffort,
  prefixedId,
  responseTerminalStateFromFinishReasons,
  responseInputToChatMessages,
  responseOutputToReplayMessages,
  responsesToChatRequest,
  stringifyContent,
};
