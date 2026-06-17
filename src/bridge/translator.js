"use strict";

const crypto = require("node:crypto");

const DEFAULT_TEXT = Object.freeze({ format: { type: "text" } });
const DEFAULT_REASONING = Object.freeze({ effort: null, summary: null });
const STORED_CHAT_PASSTHROUGH_FIELDS = Object.freeze(["metadata", "store"]);
const CHAT_NATIVE_PASSTHROUGH_FIELDS = Object.freeze([
  "logit_bias",
  "modalities",
  "audio",
  "prediction",
  "n",
  "parallel_tool_calls",
  "prompt_cache_key",
  "prompt_cache_retention",
  "safety_identifier",
  "moderation",
  "verbosity",
  "web_search_options",
  "functions",
  "function_call",
]);
const CHAT_FUNCTION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

function normalizeContentParts(content, role = "user", options = {}) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyContent(content);

  const parts = [];
  const textFallback = [];
  const imageInputMode = normalizeChatImageInputModeOption(options);
  const audioInputMode = normalizeChatAudioInputModeOption(options);
  const fileInputMode = normalizeChatFileInputModeOption(options);
  const nativeTextParts = role === "user"
    && imageInputMode !== "text"
    && audioInputMode !== "text"
    && fileInputMode !== "text";

  for (const part of content) {
    if (!isPlainObject(part)) {
      textFallback.push(stringifyContent(part));
      continue;
    }

    if (
      part.type === "input_text"
      || part.type === "output_text"
      || part.type === "text"
      || part.type === "summary_text"
      || part.type === "reasoning_text"
    ) {
      const text = stringifyContent(part.text ?? part.content ?? "");
      if (nativeTextParts) parts.push({ type: "text", text });
      else textFallback.push(text);
      continue;
    }

    if (part.type === "input_image" || part.type === "image_url" || part.type === "computer_screenshot") {
      const image = normalizeInputImageContentPart(part);
      if (role === "user" && image && imageInputMode !== "text") {
        parts.push(image);
      } else {
        textFallback.push(inputImageFallbackText(part, image));
      }
      continue;
    }

    if (part.type === "input_audio" || part.type === "audio") {
      const audio = normalizeInputAudioContentPart(part);
      if (role === "user" && audio && audioInputMode !== "text") {
        parts.push(audio);
      } else {
        textFallback.push(inputAudioFallbackText(part, audio));
      }
      continue;
    }

    if (part.type === "input_file" || part.type === "file") {
      textFallback.push(inputFileFallbackText(part));
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

function normalizeChatImageInputModeOption(options = {}) {
  const value = options.chatImageInputMode ?? options.imageInputMode;
  const normalized = String(value || "vision").trim().toLowerCase();
  return normalized === "text" ? "text" : "vision";
}

function normalizeChatAudioInputModeOption(options = {}) {
  const value = options.chatAudioInputMode ?? options.audioInputMode;
  const normalized = String(value || "audio").trim().toLowerCase();
  return normalized === "text" ? "text" : "audio";
}

function normalizeChatFileInputModeOption(options = {}) {
  const value = options.chatFileInputMode ?? options.fileInputMode;
  const normalized = String(value || "file").trim().toLowerCase();
  return normalized === "text" ? "text" : "file";
}

function normalizeInputImageContentPart(part) {
  if (!isPlainObject(part)) return null;
  const imageUrlObject = isPlainObject(part.image_url) ? part.image_url : null;
  const source = imageUrlObject || part;
  const directImageUrl = imageUrlObject ? undefined : part.image_url;
  const url = source.url ?? directImageUrl ?? part.url ?? inputImageDataUrl(part);
  if (url == null || url === "") return null;
  const imageUrl = {
    url: stringifyContent(url),
  };
  const detail = part.detail ?? source.detail;
  if (detail != null) imageUrl.detail = normalizeInputImageDetailForChat(detail);
  return {
    type: "image_url",
    image_url: imageUrl,
  };
}

function normalizeInputImageDetailForChat(detail) {
  const value = stringifyContent(detail);
  return value === "original" ? "high" : value;
}

function inputImageDataUrl(part) {
  const source = isPlainObject(part.file_data) || isPlainObject(part.data) || isPlainObject(part.image_data)
    ? part.file_data || part.data || part.image_data
    : null;
  const data = source?.data ?? source?.file_data ?? part.file_data ?? part.data ?? part.image_data;
  if (data == null) return "";
  const text = stringifyContent(data);
  if (!text || text.startsWith("data:")) return text;
  const mediaType = stringifyContent(
    source?.media_type
      || source?.mime_type
      || part.media_type
      || part.mime_type
      || "image/png",
  );
  return `data:${mediaType};base64,${text}`;
}

function inputImageFallbackText(part, image) {
  const imageUrlObject = isPlainObject(part.image_url) ? part.image_url : null;
  const source = imageUrlObject || part;
  const directImageUrl = imageUrlObject ? undefined : part.image_url;
  const rawUrl = source.url || directImageUrl || part.url || image?.image_url?.url || "";
  const url = part.file_id
    || part.filename
    || (String(rawUrl).startsWith("data:") ? "inline-data" : rawUrl)
    || "inline";
  const detail = part.detail ?? source.detail ?? image?.image_url?.detail;
  const mediaType = part.media_type || part.mime_type || source.media_type || source.mime_type || "";
  const lines = [`[image:${stringifyContent(url)}]`];
  if (mediaType) lines.push(`media_type: ${stringifyContent(mediaType)}`);
  if (detail) lines.push(`detail: ${stringifyContent(detail)}`);
  return lines.join("\n");
}

function normalizeInputAudioContentPart(part) {
  if (!isPlainObject(part)) return null;
  const source = isPlainObject(part.input_audio) ? part.input_audio : part;
  const data = source.data ?? source.audio_data ?? source.file_data;
  if (data == null) return null;
  const inputAudio = {
    data: stringifyContent(data),
  };
  if (source.format != null) inputAudio.format = stringifyContent(source.format);
  for (const [key, value] of Object.entries(source)) {
    if (["data", "audio_data", "file_data", "format"].includes(key) || value === undefined) continue;
    inputAudio[key] = clone(value);
  }
  return {
    type: "input_audio",
    input_audio: inputAudio,
  };
}

function inputAudioFallbackText(part, audio) {
  const source = isPlainObject(part.input_audio) ? part.input_audio : part;
  const format = audio?.input_audio?.format || source.format || "unknown-format";
  const hint = source.file_id || source.filename || source.url || "inline";
  const transcript = source.transcript || part.transcript || "";
  return `[audio:${stringifyContent(format)}:${stringifyContent(hint)}]${transcript ? `\n${stringifyContent(transcript)}` : ""}`;
}

function inputFileFallbackText(part) {
  const source = isPlainObject(part.file) ? part.file : part;
  const fileData = source.file_data ?? source.data ?? source.content_base64 ?? part.file_data ?? part.data;
  const rawUrl = source.file_url || source.url || part.file_url || part.url || "";
  const hint = source.file_id
    || source.id
    || part.file_id
    || part.id
    || source.filename
    || source.name
    || part.filename
    || part.name
    || (fileData != null ? "inline-data" : rawUrl)
    || "attached-file";
  const mediaType = source.media_type || source.mime_type || part.media_type || part.mime_type || "";
  const filename = source.filename || source.name || part.filename || part.name || "";
  const text = source.text ?? part.text ?? "";
  const lines = [`[file:${stringifyContent(hint)}]`];
  if (filename && filename !== hint) lines.push(`filename: ${stringifyContent(filename)}`);
  if (mediaType) lines.push(`media_type: ${stringifyContent(mediaType)}`);
  if (rawUrl && rawUrl !== hint && fileData == null) lines.push(`file_url: ${stringifyContent(rawUrl)}`);
  if (text) lines.push(stringifyContent(text));
  return lines.join("\n");
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

  if (item.type === "tool_search_call" || item.type === "tool_search_output" || item.type === "additional_tools") {
    return [];
  }
  if (isLocalMcpContextItem(item) && new Set(options.localHostedTools || []).has("mcp")) {
    return [];
  }

  if (item.type === "message" || item.role) {
    const role = normalizeChatRole(item.role, options);
    const message = {
      role,
      content: normalizeContentParts(item.content, role, options),
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

  if (item.type === "custom_tool_call") {
    if (shouldReplayCustomToolsNatively(options)) {
      return [{
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id || item.id || prefixedId("call"),
          type: "custom",
          custom: {
            name: stringifyContent(item.name || ""),
            input: stringifyContent(item.input ?? ""),
          },
        }],
      }];
    }
    return [{
      role: "assistant",
      content: customToolCallToText(item),
    }];
  }

  if (item.type === "function_call_output") {
    return [{
      role: "tool",
      tool_call_id: item.call_id,
      content: stringifyContent(item.output ?? item.content ?? ""),
    }];
  }

  if (item.type === "custom_tool_call_output") {
    if (shouldReplayCustomToolsNatively(options)) {
      return [{
        role: "tool",
        tool_call_id: item.call_id,
        content: toolCallOutputToText(item.output ?? item.content ?? "", options),
      }];
    }
    return [{
      role: options.customToolOutputRole || "user",
      content: customToolCallOutputToText(item, options),
    }];
  }

  if (isResponsesToolContextItem(item)) {
    return [{
      role: options.responsesToolContextRole || "system",
      content: responsesToolContextItemToText(item, options),
    }];
  }

  if (item.type === "computer_call_output") {
    return [{
      role: options.computerOutputRole || "user",
      content: computerCallOutputToText(item),
    }];
  }

  if (item.type === "reasoning") {
    const text = reasoningItemToText(item, options);
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

const RESPONSES_TOOL_CONTEXT_TYPES = new Set([
  "file_search_call",
  "web_search_call",
  "image_generation_call",
  "code_interpreter_call",
  "computer_call",
  "shell_call",
  "shell_call_output",
  "local_shell_call",
  "local_shell_call_output",
  "apply_patch_call",
  "apply_patch_call_output",
  "mcp_list_tools",
  "mcp_call",
  "mcp_approval_request",
  "mcp_approval_response",
]);

function isResponsesToolContextItem(item) {
  return isPlainObject(item) && RESPONSES_TOOL_CONTEXT_TYPES.has(item.type);
}

function responsesToolContextItemToText(item, options = {}) {
  const lines = [`Prior Responses tool context (${item.type || "unknown"}):`];
  appendContextField(lines, "id", item.id);
  appendContextField(lines, "call_id", item.call_id);
  appendContextField(lines, "status", item.status);
  appendContextField(lines, "server_label", item.server_label);
  appendContextField(lines, "name", item.name);
  appendContextField(lines, "container_id", item.container_id);

  if (item.type === "file_search_call") appendFileSearchContext(lines, item);
  else if (item.type === "web_search_call") appendWebSearchContext(lines, item);
  else if (item.type === "image_generation_call") appendImageGenerationContext(lines, item);
  else if (item.type === "code_interpreter_call") appendCodeInterpreterContext(lines, item);
  else if (item.type === "computer_call") appendComputerCallContext(lines, item);
  else if (item.type === "shell_call" || item.type === "local_shell_call") appendShellCallContext(lines, item);
  else if (item.type === "shell_call_output" || item.type === "local_shell_call_output") appendShellOutputContext(lines, item);
  else if (item.type === "apply_patch_call") appendApplyPatchCallContext(lines, item);
  else if (item.type === "apply_patch_call_output") appendContextField(lines, "output", item.output, 2000);
  else if (item.type === "mcp_call") appendMcpCallContext(lines, item);
  else if (item.type === "mcp_list_tools") appendMcpListToolsContext(lines, item);
  else if (item.type === "mcp_approval_request" || item.type === "mcp_approval_response") appendMcpApprovalContext(lines, item);

  appendContextExtras(lines, item, options);
  return lines.join("\n");
}

function appendFileSearchContext(lines, item) {
  appendContextField(lines, "queries", Array.isArray(item.queries) ? item.queries.join("; ") : item.queries, 1000);
  if (Array.isArray(item.results)) {
    lines.push(`results_count: ${item.results.length}`);
    item.results.slice(0, 5).forEach((result, index) => {
      if (!isPlainObject(result)) return;
      const label = result.filename || result.file_id || `result_${index + 1}`;
      lines.push(`result_${index + 1}: ${truncateText(label, 160)}`);
      appendContextField(lines, `result_${index + 1}_score`, result.score);
      appendContextField(lines, `result_${index + 1}_text`, result.text, 1000);
    });
  }
}

function appendWebSearchContext(lines, item) {
  appendContextField(lines, "action", item.action, 1200);
  if (Array.isArray(item.results)) {
    lines.push(`results_count: ${item.results.length}`);
    item.results.slice(0, 5).forEach((result, index) => {
      if (!isPlainObject(result)) return;
      const title = result.title || result.url || `result_${index + 1}`;
      lines.push(`result_${index + 1}: ${truncateText(title, 160)}`);
      appendContextField(lines, `result_${index + 1}_url`, result.url, 500);
      appendContextField(lines, `result_${index + 1}_snippet`, result.snippet || result.text, 1000);
    });
  }
}

function appendImageGenerationContext(lines, item) {
  if (typeof item.result === "string" && item.result.length > 0) {
    lines.push(`result: base64_image(${item.result.length} chars)`);
  } else {
    appendContextField(lines, "result", item.result);
  }
  appendContextField(lines, "partial_image_count", Array.isArray(item.partial_images) ? item.partial_images.length : undefined);
}

function appendCodeInterpreterContext(lines, item) {
  appendContextField(lines, "code", item.code, 2000);
  if (Array.isArray(item.outputs)) {
    lines.push(`outputs_count: ${item.outputs.length}`);
    item.outputs.slice(0, 5).forEach((output, index) => {
      if (!isPlainObject(output)) return;
      appendContextField(lines, `output_${index + 1}_type`, output.type);
      if (output.type === "logs") appendContextField(lines, `output_${index + 1}_logs`, output.logs, 2000);
      else if (output.type === "image") {
        const image = output.image || output.image_url || output.file_id || output;
        appendContextField(lines, `output_${index + 1}_image`, image, 600);
      } else appendContextField(lines, `output_${index + 1}`, output, 1000);
    });
  }
}

function appendComputerCallContext(lines, item) {
  appendContextField(lines, "action", item.action || item.actions, 1200);
  if (Array.isArray(item.pending_safety_checks)) {
    lines.push(`pending_safety_checks_count: ${item.pending_safety_checks.length}`);
    const checks = safetyChecksToText(item.pending_safety_checks);
    if (checks) appendContextField(lines, "pending_safety_checks", checks, 1200);
  }
}

function appendShellCallContext(lines, item) {
  appendContextField(lines, "action", item.action, 2000);
  appendContextField(lines, "environment", item.environment, 600);
}

function appendShellOutputContext(lines, item) {
  if (Array.isArray(item.output)) {
    lines.push(`output_chunks: ${item.output.length}`);
    item.output.slice(0, 5).forEach((chunk, index) => {
      if (!isPlainObject(chunk)) return;
      appendContextField(lines, `chunk_${index + 1}_stdout`, chunk.stdout, 2000);
      appendContextField(lines, `chunk_${index + 1}_stderr`, chunk.stderr, 2000);
      appendContextField(lines, `chunk_${index + 1}_outcome`, chunk.outcome, 600);
    });
  } else {
    appendContextField(lines, "output", item.output, 2000);
  }
  appendContextField(lines, "max_output_length", item.max_output_length);
}

function appendApplyPatchCallContext(lines, item) {
  appendContextField(lines, "operation", item.operation, 2000);
}

function appendMcpCallContext(lines, item) {
  appendContextField(lines, "arguments", item.arguments, 2000);
  appendContextField(lines, "output", item.output, 2000);
  appendContextField(lines, "error", item.error, 2000);
  appendContextField(lines, "approval_request_id", item.approval_request_id);
}

function appendMcpListToolsContext(lines, item) {
  if (Array.isArray(item.tools)) {
    lines.push(`tools_count: ${item.tools.length}`);
    item.tools.slice(0, 10).forEach((tool, index) => {
      if (!isPlainObject(tool)) return;
      const name = tool.name || tool.function?.name || `tool_${index + 1}`;
      lines.push(`tool_${index + 1}: ${truncateText(name, 160)}`);
      appendContextField(lines, `tool_${index + 1}_description`, tool.description || tool.function?.description, 500);
    });
  }
}

function appendMcpApprovalContext(lines, item) {
  appendContextField(lines, "approval_request_id", item.approval_request_id || item.id);
  appendContextField(lines, "approve", item.approve);
  appendContextField(lines, "reason", item.reason, 1000);
  appendContextField(lines, "arguments", item.arguments, 2000);
}

function appendContextExtras(lines, item, options = {}) {
  const known = new Set([
    "type", "id", "call_id", "status", "server_label", "name", "container_id",
    "queries", "results", "action", "actions", "result", "partial_images", "code",
    "outputs", "pending_safety_checks", "environment", "output", "max_output_length",
    "operation", "arguments", "error", "approval_request_id", "tools", "approve", "reason",
  ]);
  const extras = Object.fromEntries(Object.entries(item).filter(([key, value]) => !known.has(key) && value !== undefined));
  if (Object.keys(extras).length && options.includeResponsesToolContextExtras !== false) {
    appendContextField(lines, "extra", extras, 1200);
  }
}

function appendContextField(lines, label, value, maxChars = 500) {
  if (value === undefined || value === null || value === "") return;
  lines.push(`${label}: ${truncateText(value, maxChars)}`);
}

function shouldReplayCustomToolsNatively(options = {}) {
  if (options.customToolReplayMode === "text") return false;
  if (options.customToolReplayMode === "native") return true;
  return options.forwardChatCustomTools !== false;
}

function customToolCallToText(item) {
  const lines = ["Custom tool call:"];
  if (item.call_id) lines.push(`call_id: ${stringifyContent(item.call_id)}`);
  if (item.namespace) lines.push(`namespace: ${stringifyContent(item.namespace)}`);
  if (item.name) lines.push(`name: ${stringifyContent(item.name)}`);
  lines.push("input:");
  lines.push(stringifyContent(item.input ?? ""));
  return lines.join("\n");
}

function customToolCallOutputToText(item, options = {}) {
  const lines = ["Custom tool call output:"];
  if (item.call_id) lines.push(`call_id: ${stringifyContent(item.call_id)}`);
  if (item.status) lines.push(`status: ${stringifyContent(item.status)}`);
  lines.push("output:");
  lines.push(toolCallOutputToText(item.output ?? item.content ?? "", options));
  return lines.join("\n");
}

function toolCallOutputToText(output, options = {}) {
  if (Array.isArray(output)) {
    return normalizeContentParts(output, "user", {
      ...options,
      chatImageInputMode: "text",
      chatAudioInputMode: "text",
      chatFileInputMode: "text",
    });
  }
  return stringifyContent(output);
}

function isLocalMcpContextItem(item) {
  return item?.type === "mcp_list_tools"
    || item?.type === "mcp_call"
    || item?.type === "mcp_approval_request"
    || item?.type === "mcp_approval_response";
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

function reasoningItemToText(item, options = {}) {
  if (!isPlainObject(item)) return "";
  const decrypted = decodeReasoningItem(item, options);
  if (decrypted) return decrypted;
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.summary)) {
    return item.summary
      .map((part) => stringifyContent(part?.text ?? part?.summary_text ?? part))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof item.encrypted_content === "string" && typeof options.decodeReasoning !== "function") {
    return item.encrypted_content;
  }
  return "";
}

function computerCallOutputToText(item) {
  if (!isPlainObject(item)) return "";
  const output = isPlainObject(item.output) ? item.output : {};
  const imageUrl = computerOutputImageUrl(output);
  const lines = ["Computer call output:"];
  if (item.call_id) lines.push(`call_id: ${stringifyContent(item.call_id)}`);
  if (item.status) lines.push(`status: ${stringifyContent(item.status)}`);
  if (output.type || item.output_type) lines.push(`output_type: ${stringifyContent(output.type || item.output_type)}`);
  if (imageUrl) lines.push(`image_url: ${imageUrl}`);
  if (output.detail || item.detail) lines.push(`detail: ${stringifyContent(output.detail || item.detail)}`);
  const text = computerOutputText(item);
  if (text) lines.push(`text: ${text}`);
  const acknowledgedSafetyChecks = Array.isArray(item.acknowledged_safety_checks)
    ? item.acknowledged_safety_checks
    : output.acknowledged_safety_checks;
  if (Array.isArray(acknowledgedSafetyChecks)) {
    lines.push(`acknowledged_safety_checks_count: ${acknowledgedSafetyChecks.length}`);
    const summary = safetyChecksToText(acknowledgedSafetyChecks);
    if (summary) lines.push(`acknowledged_safety_checks: ${summary}`);
  }
  return lines.join("\n");
}

function computerOutputImageUrl(output) {
  if (!isPlainObject(output)) return "";
  if (typeof output.image_url === "string") return output.image_url;
  if (typeof output.image_url?.url === "string") return output.image_url.url;
  if (typeof output.url === "string") return output.url;
  return "";
}

function computerOutputText(item) {
  if (typeof item.output_text === "string") return item.output_text;
  if (typeof item.content === "string") return item.content;
  const output = item.output;
  if (typeof output === "string") return output;
  if (!isPlainObject(output)) return "";
  if (typeof output.text === "string") return output.text;
  if (typeof output.content === "string") return output.content;
  return "";
}

function safetyChecksToText(checks = []) {
  return checks
    .filter(isPlainObject)
    .slice(0, 8)
    .map((check) => {
      const parts = [];
      if (check.id != null) parts.push(`id=${truncateText(check.id, 120)}`);
      if (check.type != null) parts.push(`type=${truncateText(check.type, 80)}`);
      if (check.code != null) parts.push(`code=${truncateText(check.code, 120)}`);
      if (check.message != null) parts.push(`message=${truncateText(check.message, 240)}`);
      return parts.length ? parts.join(", ") : truncateText(check, 500);
    })
    .filter(Boolean)
    .join("; ");
}

function truncateText(value, maxChars) {
  const text = stringifyContent(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function decodeReasoningItem(item, options = {}) {
  if (!isPlainObject(item) || typeof options.decodeReasoning !== "function") return "";
  try {
    return stringifyContent(options.decodeReasoning(item.encrypted_content || ""));
  } catch {
    return "";
  }
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
  const usedFunctionNames = new Set();
  const functionToolNameMap = {
    chat_to_responses: {},
    responses_to_chat: {},
  };
  const localHostedTools = new Set(options.localHostedTools || []);
  const deferFunctionTools = localHostedTools.has("tool_search")
    && (tools || []).some((tool) => isPlainObject(tool) && tool.type === "tool_search");

  for (const tool of tools || []) {
    if (!isPlainObject(tool)) continue;
    if (tool.type === "function") {
      if (deferFunctionTools && tool.defer_loading) continue;
      const chatName = chatFunctionNameForResponsesTool(tool.name, usedFunctionNames);
      if (chatName !== tool.name) {
        functionToolNameMap.chat_to_responses[chatName] = tool.name;
        if (!functionToolNameMap.responses_to_chat[tool.name]) {
          functionToolNameMap.responses_to_chat[tool.name] = chatName;
        }
      }
      mapped.push({
        type: "function",
        function: {
          name: chatName,
          description: tool.description || "",
          parameters: tool.parameters || { type: "object", properties: {} },
          ...(tool.strict != null ? { strict: tool.strict } : {}),
        },
      });
    } else if (tool.type === "custom" && options.forwardChatCustomTools !== false) {
      if (deferFunctionTools && tool.defer_loading) continue;
      mapped.push({
        type: "custom",
        custom: {
          name: stringifyContent(tool.name || ""),
          ...(tool.description != null ? { description: stringifyContent(tool.description) } : {}),
          ...(tool.format != null ? { format: mapResponsesCustomToolFormatForChat(tool.format) } : {}),
        },
      });
    } else if (localHostedTools.has(tool.type)) {
      continue;
    } else {
      unsupported.push(tool.type || "unknown");
    }
  }

  const hasNameMap = Object.keys(functionToolNameMap.chat_to_responses).length > 0;
  return { mapped, unsupported, functionToolNameMap: hasNameMap ? functionToolNameMap : null };
}

function mapResponsesCustomToolFormatForChat(format) {
  if (!isPlainObject(format)) return format;
  if (format.type === "grammar") {
    return {
      type: "grammar",
      grammar: {
        definition: stringifyContent(format.definition ?? ""),
        syntax: stringifyContent(format.syntax ?? ""),
      },
    };
  }
  if (format.type === "text") return { type: "text" };
  return clone(format);
}

function chatFunctionNameForResponsesTool(name, usedNames) {
  const raw = stringifyContent(name);
  if (CHAT_FUNCTION_NAME_RE.test(raw) && !usedNames.has(raw)) {
    usedNames.add(raw);
    return raw;
  }
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const prefix = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50) || "tool";
  let candidate = `${prefix}_${hash}`.slice(0, 64);
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const marker = `_${suffix++}`;
    candidate = `${prefix.slice(0, 64 - marker.length)}${marker}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function mapToolChoice(toolChoice, options = {}) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (!isPlainObject(toolChoice)) return undefined;
  if (toolChoice.type === "function") {
    const name = toolChoice.name || toolChoice.function?.name;
    if (name) {
      const mappedName = options.functionToolNameMap?.responses_to_chat?.[name] || name;
      return { type: "function", function: { name: mappedName } };
    }
  }
  if (toolChoice.type === "custom") {
    const name = toolChoice.name || toolChoice.custom?.name;
    if (name && options.forwardChatCustomTools !== false) {
      return { type: "custom", custom: { name: stringifyContent(name) } };
    }
    return undefined;
  }
  if (toolChoice.type === "allowed_tools") {
    const allowedTools = mapResponsesAllowedToolsChoice(toolChoice, options);
    return allowedTools || undefined;
  }
  return toolChoice;
}

function mapResponsesAllowedToolsChoice(toolChoice, options = {}) {
  if (!Array.isArray(toolChoice.tools)) return null;
  const tools = [];
  for (const tool of toolChoice.tools) {
    if (!isPlainObject(tool)) continue;
    if (tool.type === "function" && tool.name) {
      const mappedName = options.functionToolNameMap?.responses_to_chat?.[tool.name] || tool.name;
      tools.push({ type: "function", function: { name: mappedName } });
    } else if (tool.type === "custom" && tool.name && options.forwardChatCustomTools !== false) {
      tools.push({ type: "custom", custom: { name: stringifyContent(tool.name) } });
    }
  }
  if (!tools.length) return null;
  return {
    type: "allowed_tools",
    allowed_tools: {
      mode: toolChoice.mode,
      tools,
    },
  };
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
  if (reasoning.effort) {
    const effort = normalizeReasoningEffort(reasoning.effort, options);
    if (effort) mapped.reasoning_effort = effort;
  }
  const summary = reasoningSummaryRequest(reasoning);
  if (summary && options.forwardReasoningSummary) mapped.reasoning_summary = summary.value;
  return mapped;
}

function reasoningSummaryRequest(reasoning) {
  if (!isPlainObject(reasoning)) return null;
  if (reasoning.summary != null) {
    return {
      source: "reasoning.summary",
      value: reasoning.summary,
      ...(reasoning.generate_summary != null ? { deprecated_generate_summary: "ignored_by_summary" } : {}),
    };
  }
  if (reasoning.generate_summary != null) {
    return {
      source: "reasoning.generate_summary",
      value: reasoning.generate_summary,
      deprecated: true,
    };
  }
  return null;
}

function normalizeReasoningEffort(effort, options = {}) {
  if (!options.deepseekReasoningEffortCompat) return effort;
  if (effort === "none") return undefined;
  if (effort === "xhigh") return "max";
  if (effort === "minimal" || effort === "low" || effort === "medium") return "high";
  return effort;
}

function mapReasoningEffortCompatibility(reasoning, options = {}) {
  if (!isPlainObject(reasoning) || !reasoning.effort || !options.deepseekReasoningEffortCompat) return null;
  const mapped = normalizeReasoningEffort(reasoning.effort, options);
  if (mapped === reasoning.effort) return null;
  return {
    source: "reasoning.effort",
    target: "reasoning_effort",
    value: reasoning.effort,
    mapped_value: mapped || null,
    forwarded: !!mapped,
    reason: reasoning.effort === "none"
      ? "deepseek_thinking_disabled"
      : "deepseek_effort_compat",
  };
}

function shouldDisableDeepSeekThinkingForReasoningNone(reasoning, options = {}) {
  return !!(
    options.deepseekReasoningEffortCompat
    && isPlainObject(reasoning)
    && reasoning.effort === "none"
  );
}

function mapReasoningSummaryCompatibility(reasoning, options = {}) {
  const summary = reasoningSummaryRequest(reasoning);
  if (!summary) return null;
  if (options.forwardReasoningSummary) {
    return {
      ...summary,
      target: "reasoning_summary",
      forwarded: true,
      reason: "provider_reasoning_summary_passthrough",
    };
  }
  return {
    ...summary,
    forwarded: false,
    reason: "provider_unsupported",
  };
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
  const promptCompatibility = applyPromptTemplate(request.prompt, messages, options);
  if (request.instructions) {
    messages.push({ role: options.instructionsRole || "system", content: stringifyContent(request.instructions) });
  }

  const structuredOutputMessage = makeStructuredOutputMessage(request.text, options);
  if (structuredOutputMessage) messages.push(structuredOutputMessage);

  for (const message of previousMessages || []) {
    if (isPlainObject(message)) messages.push(message);
  }

  messages.push(...responseInputToChatMessages(request.input, options));

  let { mapped: tools, unsupported, functionToolNameMap } = mapResponsesTools(request.tools || [], options);
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
  copyIfPresent(request, chat, "top_logprobs");
  copyIfPresent(request, chat, "stop");

  const storedChatFieldsCompatibility = mapStoredChatFields(request, chat, options);
  const serviceTierCompatibility = mapServiceTier(request, chat, options);
  const streamOptionsCompatibility = mapStreamOptions(request, chat, options);
  const deepseekUserIdCompatibility = mapDeepSeekUserId(request, chat, options);
  const chatImageInputCompatibility = mapChatImageInputCompatibility(request, options);
  const chatAudioInputCompatibility = mapChatAudioInputCompatibility(request, options);

  const logprobsRequested = shouldRequestChatLogprobs(request);
  if (logprobsRequested !== undefined) chat.logprobs = logprobsRequested;

  const maxTokensCompatibility = mapMaxTokens(request, chat, options);
  const verbosityCompatibility = mapVerbosity(request, chat, options);
  const contextManagementCompatibility = mapContextManagement(request);
  let toolChoice = mapToolChoice(request.tool_choice, { ...options, functionToolNameMap });
  const legacyFunctionsCompatibility = mapLegacyChatFunctions(request, tools, toolChoice, options);
  if (legacyFunctionsCompatibility?.tools) tools = legacyFunctionsCompatibility.tools;
  if (Object.prototype.hasOwnProperty.call(legacyFunctionsCompatibility || {}, "toolChoice")) {
    toolChoice = legacyFunctionsCompatibility.toolChoice;
  }
  const parallelToolCallsCompatibility = mapParallelToolCalls(request, chat, tools, options);
  const chatNativeFieldsCompatibility = mapChatNativeFields(request, chat, {
    ...options,
    mappedNativeFields: [
      ...(deepseekUserIdCompatibility?.source ? [deepseekUserIdCompatibility.source] : []),
      ...(legacyFunctionsCompatibility?.mappedFields || []),
      ...(parallelToolCallsCompatibility ? ["parallel_tool_calls"] : []),
    ],
  });

  if (tools.length) {
    chat.tools = tools;
    if (toolChoice !== undefined) chat.tool_choice = toolChoice;
  }

  const responseFormat = mapTextFormat(request.text, options);
  if (responseFormat) chat.response_format = responseFormat;

  Object.assign(chat, mapReasoning(request.reasoning, options));
  const reasoningEffortCompatibility = mapReasoningEffortCompatibility(request.reasoning, options);
  const reasoningSummaryCompatibility = mapReasoningSummaryCompatibility(request.reasoning, options);
  const disableThinkingForReasoningNone = shouldDisableDeepSeekThinkingForReasoningNone(request.reasoning, options);
  const disableThinkingForToolChoice = !!(
    options.deepseekDisableThinkingForToolChoice
    && tools.length
    && toolChoice !== undefined
    && !options.deepseekThinkingMode
  );
  if (disableThinkingForReasoningNone || disableThinkingForToolChoice) chat.thinking = { type: "disabled" };
  if (options.deepseekThinkingMode && request.reasoning?.effort && !disableThinkingForReasoningNone) chat.thinking = { type: "enabled" };

  return {
    chat,
    compatibility: {
      unsupported_tools: unsupported,
      ...(functionToolNameMap ? { response_function_tool_names: functionToolNameMap } : {}),
      ...(toolChoice !== undefined && !tools.length && hasLocalHostedToolRequest(request.tools, options)
        ? { local_tool_choice: "handled_by_bridge" }
        : {}),
      ...(disableThinkingForReasoningNone
        ? { deepseek_thinking: "disabled_for_reasoning_none" }
        : disableThinkingForToolChoice
          ? { deepseek_thinking: "disabled_for_tool_choice" }
          : {}),
      ...(reasoningEffortCompatibility ? { reasoning_effort: reasoningEffortCompatibility } : {}),
      ...(reasoningSummaryCompatibility ? { reasoning_summary: reasoningSummaryCompatibility } : {}),
      ...(logprobsRequested ? { logprobs: "chat_logprobs" } : {}),
      ...(storedChatFieldsCompatibility ? { stored_chat_fields: storedChatFieldsCompatibility } : {}),
      ...(serviceTierCompatibility ? { service_tier: serviceTierCompatibility } : {}),
      ...(streamOptionsCompatibility ? { stream_options: streamOptionsCompatibility } : {}),
      ...(deepseekUserIdCompatibility ? { deepseek_user_id: deepseekUserIdCompatibility } : {}),
      ...(chatImageInputCompatibility ? { chat_image_inputs: chatImageInputCompatibility } : {}),
      ...(chatAudioInputCompatibility ? { chat_audio_inputs: chatAudioInputCompatibility } : {}),
      ...(promptCompatibility ? { prompt_template: promptCompatibility } : {}),
      ...(maxTokensCompatibility || {}),
      ...(verbosityCompatibility ? { verbosity: verbosityCompatibility } : {}),
      ...(contextManagementCompatibility ? { context_management: contextManagementCompatibility } : {}),
      ...(legacyFunctionsCompatibility?.compatibility ? { legacy_functions: legacyFunctionsCompatibility.compatibility } : {}),
      ...(parallelToolCallsCompatibility ? { parallel_tool_calls: parallelToolCallsCompatibility } : {}),
      ...(chatNativeFieldsCompatibility ? { chat_native_fields: chatNativeFieldsCompatibility } : {}),
    },
  };
}

function mapLegacyChatFunctions(request = {}, tools = [], toolChoice, options = {}) {
  if (options.forwardChatNativeFields !== false) return null;
  const hasFunctions = Object.prototype.hasOwnProperty.call(request, "functions") && request.functions !== undefined;
  const hasFunctionCall = Object.prototype.hasOwnProperty.call(request, "function_call") && request.function_call !== undefined;
  if (!hasFunctions && !hasFunctionCall) return null;

  const nextTools = Array.isArray(tools) ? [...tools] : [];
  let nextToolChoice = toolChoice;
  const mappedFields = [];
  const compatibility = {};

  if (hasFunctions) {
    const converted = legacyFunctionsToChatTools(request.functions);
    nextTools.push(...converted.tools);
    mappedFields.push("functions");
    compatibility.functions = {
      source: "functions",
      target: "tools",
      forwarded: false,
      mapped: Array.isArray(request.functions),
      function_count: Array.isArray(request.functions) ? request.functions.length : 0,
      mapped_count: converted.tools.length,
      ...(converted.filteredCount ? { filtered_count: converted.filteredCount } : {}),
      reason: Array.isArray(request.functions)
        ? converted.filteredCount
          ? "legacy_functions_partially_mapped"
          : "legacy_functions_mapped"
        : "invalid_legacy_functions_filtered",
    };
  }

  if (hasFunctionCall) {
    const mapped = legacyFunctionCallToToolChoice(request.function_call);
    const canUseMappedChoice = mapped !== undefined && nextToolChoice === undefined && (mapped === "none" || nextTools.length > 0);
    mappedFields.push("function_call");
    if (canUseMappedChoice) {
      nextToolChoice = mapped;
      compatibility.function_call = {
        source: "function_call",
        target: "tool_choice",
        forwarded: false,
        mapped: true,
        value: legacyFunctionCallCompatibilityValue(request.function_call),
        reason: "legacy_function_call_mapped",
      };
    } else {
      compatibility.function_call = {
        source: "function_call",
        target: "tool_choice",
        forwarded: false,
        mapped: false,
        value: legacyFunctionCallCompatibilityValue(request.function_call),
        reason: nextToolChoice !== undefined
          ? "tool_choice_precedence"
          : mapped === undefined
            ? "invalid_legacy_function_call_filtered"
            : "no_mapped_tools",
      };
    }
  }

  return {
    tools: nextTools,
    toolChoice: nextToolChoice,
    mappedFields,
    compatibility,
  };
}

function legacyFunctionsToChatTools(functions) {
  if (!Array.isArray(functions)) return { tools: [], filteredCount: 0 };
  const tools = [];
  let filteredCount = 0;
  for (const fn of functions) {
    if (!isPlainObject(fn)) {
      filteredCount += 1;
      continue;
    }
    tools.push({ type: "function", function: clone(fn) });
  }
  return { tools, filteredCount };
}

function legacyFunctionCallToToolChoice(functionCall) {
  if (typeof functionCall === "string") {
    return ["auto", "none"].includes(functionCall) ? functionCall : undefined;
  }
  if (isPlainObject(functionCall) && functionCall.name) {
    return {
      type: "function",
      function: { name: stringifyContent(functionCall.name) },
    };
  }
  return undefined;
}

function legacyFunctionCallCompatibilityValue(functionCall) {
  if (isPlainObject(functionCall)) {
    return functionCall.name ? { name: stringifyContent(functionCall.name) } : {};
  }
  return stringifyContent(functionCall);
}

function mapParallelToolCalls(request = {}, chat = {}, tools = [], options = {}) {
  if (
    request.parallel_tool_calls !== false
    || options.forwardChatNativeFields !== false
    || !Array.isArray(tools)
    || tools.length === 0
  ) {
    return null;
  }
  chat.messages = [
    { role: "system", content: parallelToolCallsInstruction() },
    ...(Array.isArray(chat.messages) ? chat.messages : []),
  ];
  return {
    source: "parallel_tool_calls",
    value: false,
    forwarded: false,
    reason: "provider_unsupported_prompt_instruction",
    prompt_instruction: "injected",
  };
}

function parallelToolCallsInstruction() {
  return "Parallel tool-call compatibility: when you call tools, call at most one tool in this assistant turn. Do not emit multiple tool calls in the same response.";
}

function mapContextManagement(request = {}) {
  if (Object.prototype.hasOwnProperty.call(request, "context_management") && request.context_management != null) {
    const entries = Array.isArray(request.context_management) ? request.context_management : [];
    const types = Array.from(new Set(entries
      .map((entry) => isPlainObject(entry) ? stringifyContent(entry.type || "") : "")
      .filter(Boolean))).sort();
    return {
      source: "context_management",
      forwarded: false,
      reason: "chat_completions_no_equivalent",
      value_type: "array",
      entry_count: entries.length,
      ...(types.length ? { types } : {}),
      compact_threshold_count: entries.filter((entry) => (
        isPlainObject(entry)
        && Object.prototype.hasOwnProperty.call(entry, "compact_threshold")
        && entry.compact_threshold != null
      )).length,
      ...(Object.prototype.hasOwnProperty.call(request, "context") ? { legacy_context_alias_present: true } : {}),
    };
  }
  if (!Object.prototype.hasOwnProperty.call(request, "context")) return null;
  const value = request.context;
  const valueType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  return {
    source: "context",
    alias_for: "context_management",
    forwarded: false,
    reason: "chat_completions_no_equivalent",
    value_type: valueType,
    ...(isPlainObject(value) ? { keys: Object.keys(value).sort() } : {}),
  };
}

function mapChatImageInputCompatibility(request, options = {}) {
  const imagePartCount = countInputImageParts(request?.input);
  if (!imagePartCount) return null;
  const mode = normalizeChatImageInputModeOption(options);
  const originalDetailCount = countInputImageDetails(request?.input, "original");
  return {
    provider: mode === "text" ? "text_fallback" : "chat_content_parts",
    mode,
    image_part_count: imagePartCount,
    ...(originalDetailCount ? {
      original_detail_count: originalDetailCount,
      original_detail_handling: mode === "text" ? "preserved_in_text_marker" : "mapped_to_high",
    } : {}),
    reason: mode === "text"
      ? "provider_without_chat_vision_content_parts"
      : "provider_accepts_chat_vision_content_parts",
  };
}

function countInputImageParts(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countInputImageParts(item), 0);
  if (!isPlainObject(value)) return 0;
  let count = value.type === "input_image" || value.type === "image_url" ? 1 : 0;
  if (Array.isArray(value.content)) count += countInputImageParts(value.content);
  return count;
}

function countInputImageDetails(value, detail) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countInputImageDetails(item, detail), 0);
  if (!isPlainObject(value)) return 0;
  let count = 0;
  if (value.type === "input_image" || value.type === "image_url") {
    const source = isPlainObject(value.image_url) ? value.image_url : value;
    if (value.detail === detail || source.detail === detail) count += 1;
  }
  if (Array.isArray(value.content)) count += countInputImageDetails(value.content, detail);
  return count;
}

function mapChatAudioInputCompatibility(request, options = {}) {
  const audioPartCount = countInputAudioParts(request?.input);
  if (!audioPartCount) return null;
  const mode = normalizeChatAudioInputModeOption(options);
  return {
    provider: mode === "text" ? "text_fallback" : "chat_content_parts",
    mode,
    audio_part_count: audioPartCount,
    reason: mode === "text"
      ? "provider_without_chat_audio_content_parts"
      : "provider_accepts_chat_audio_content_parts",
  };
}

function countInputAudioParts(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countInputAudioParts(item), 0);
  if (!isPlainObject(value)) return 0;
  let count = value.type === "input_audio" || value.type === "audio" ? 1 : 0;
  if (Array.isArray(value.content)) count += countInputAudioParts(value.content);
  return count;
}

function mapStoredChatFields(request, chat, options = {}) {
  const present = STORED_CHAT_PASSTHROUGH_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(request, field)
    && request[field] !== undefined
  ));
  if (!present.length) return null;

  const forwarded = [];
  const filtered = [];
  const forward = options.forwardStoredChatFields !== false;
  for (const field of present) {
    if (forward) {
      chat[field] = clone(request[field]);
      forwarded.push(field);
    } else {
      filtered.push(field);
    }
  }

  return {
    ...(forwarded.length ? { forwarded } : {}),
    ...(filtered.length ? { filtered } : {}),
    reason: forward ? "stored_chat_passthrough" : "provider_unsupported_local_semantics",
  };
}

function applyPromptTemplate(prompt, messages, options = {}) {
  const reference = normalizePromptReference(prompt);
  if (!reference) return null;

  const template = findLocalPromptTemplate(reference, options);
  if (!template) {
    messages.push(promptReferenceCompatibilityMessage(reference));
    return {
      status: "reference_preserved",
      id: reference.id || null,
      version: reference.version || null,
      variable_keys: Object.keys(reference.variables),
      reason: "hosted_prompt_template_unavailable",
    };
  }

  const renderedTemplate = renderPromptTemplate(template, reference.variables);
  const promptMessages = promptTemplateToChatMessages(renderedTemplate, options);
  messages.push(...promptMessages);
  return {
    status: "expanded_locally",
    id: reference.id || renderedTemplate.id || null,
    version: reference.version || renderedTemplate.version || null,
    variable_keys: Object.keys(reference.variables),
    message_count: promptMessages.length,
    source: reference.inlineTemplate ? "inline_template" : "configured_template",
  };
}

function normalizePromptReference(prompt) {
  if (prompt == null) return null;
  if (typeof prompt === "string") {
    return { id: prompt, version: null, variables: {}, inlineTemplate: null };
  }
  if (!isPlainObject(prompt)) {
    return { id: null, version: null, variables: {}, inlineTemplate: { instructions: stringifyContent(prompt) } };
  }
  const variables = isPlainObject(prompt.variables) ? prompt.variables : {};
  const inlineTemplate = prompt.template || prompt.local_template || (
    ["messages", "instructions", "input", "content", "text"].some((key) => Object.prototype.hasOwnProperty.call(prompt, key))
      ? {
        ...(Object.prototype.hasOwnProperty.call(prompt, "messages") ? { messages: prompt.messages } : {}),
        ...(Object.prototype.hasOwnProperty.call(prompt, "instructions") ? { instructions: prompt.instructions } : {}),
        ...(Object.prototype.hasOwnProperty.call(prompt, "input") ? { input: prompt.input } : {}),
        ...(Object.prototype.hasOwnProperty.call(prompt, "content") ? { content: prompt.content } : {}),
        ...(Object.prototype.hasOwnProperty.call(prompt, "text") ? { text: prompt.text } : {}),
      }
      : null
  );
  return {
    id: stringifyOptional(prompt.id ?? prompt.prompt_id ?? prompt.name),
    version: stringifyOptional(prompt.version),
    variables,
    inlineTemplate,
  };
}

function stringifyOptional(value) {
  if (value == null || value === "") return null;
  return stringifyContent(value);
}

function findLocalPromptTemplate(reference, options = {}) {
  if (reference.inlineTemplate) return reference.inlineTemplate;
  if (!reference.id) return null;
  const templates = isPlainObject(options.localPromptTemplates) ? options.localPromptTemplates : {};
  if (reference.version && Object.prototype.hasOwnProperty.call(templates, `${reference.id}@${reference.version}`)) {
    return templates[`${reference.id}@${reference.version}`];
  }
  return Object.prototype.hasOwnProperty.call(templates, reference.id) ? templates[reference.id] : null;
}

function promptReferenceCompatibilityMessage(reference) {
  return {
    role: "system",
    content: [
      "Responses prompt template compatibility:",
      "A hosted prompt template reference was supplied, but this Chat-only bridge cannot fetch OpenAI-hosted prompt templates.",
      `prompt_id: ${reference.id || "unknown"}`,
      ...(reference.version ? [`version: ${reference.version}`] : []),
      `variable_keys: ${Object.keys(reference.variables).join(", ") || "none"}`,
      "Continue using the visible instructions and input in this request.",
    ].join("\n"),
  };
}

function renderPromptTemplate(template, variables = {}) {
  if (typeof template === "string") return renderTemplateString(template, variables);
  if (Array.isArray(template)) return template.map((item) => renderPromptTemplate(item, variables));
  if (!isPlainObject(template)) return template;
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [key, renderPromptTemplate(value, variables)]),
  );
}

function renderTemplateString(value, variables = {}) {
  return String(value).replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? stringifyContent(variables[key]) : match
  ));
}

function promptTemplateToChatMessages(template, options = {}) {
  if (typeof template === "string") {
    return [{ role: options.instructionsRole || "system", content: template }];
  }
  if (Array.isArray(template)) return responseInputToChatMessages(template, options);
  if (!isPlainObject(template)) {
    return [{ role: options.instructionsRole || "system", content: stringifyContent(template) }];
  }

  const messages = [];
  if (template.instructions != null) {
    messages.push({ role: options.instructionsRole || "system", content: stringifyContent(template.instructions) });
  }
  if (template.content != null || template.text != null) {
    messages.push({ role: options.instructionsRole || "system", content: stringifyContent(template.content ?? template.text) });
  }
  if (template.messages != null) {
    messages.push(...responseInputToChatMessages(template.messages, options));
  }
  if (template.input != null) {
    messages.push(...responseInputToChatMessages(template.input, options));
  }
  return messages;
}

function mapMaxTokens(request, chat, options = {}) {
  const maxTokensField = options.maxTokensField || "max_tokens";
  const compatibility = {};
  if (request.max_output_tokens != null) {
    chat[maxTokensField] = request.max_output_tokens;
    if (
      request.max_completion_tokens != null
      && request.max_completion_tokens !== request.max_output_tokens
    ) {
      compatibility.max_completion_tokens = {
        source: "max_completion_tokens",
        value: request.max_completion_tokens,
        forwarded: false,
        reason: "max_output_tokens_precedence",
      };
    }
    if (
      request.max_tokens != null
      && request.max_tokens !== request.max_output_tokens
    ) {
      compatibility.max_tokens = {
        source: "max_tokens",
        value: request.max_tokens,
        forwarded: false,
        reason: "max_output_tokens_precedence",
      };
    }
    return Object.keys(compatibility).length ? compatibility : null;
  }

  if (request.max_completion_tokens != null) {
    chat[maxTokensField] = request.max_completion_tokens;
    compatibility.max_completion_tokens = {
      source: "max_completion_tokens",
      target: maxTokensField,
      value: request.max_completion_tokens,
      forwarded: true,
      reason: "chat_alias",
    };
    if (
      request.max_tokens != null
      && request.max_tokens !== request.max_completion_tokens
    ) {
      compatibility.max_tokens = {
        source: "max_tokens",
        value: request.max_tokens,
        forwarded: false,
        reason: "max_completion_tokens_precedence",
      };
    }
    return compatibility;
  }

  if (request.max_tokens == null) return null;
  chat[maxTokensField] = request.max_tokens;
  return {
    max_tokens: {
      source: "max_tokens",
      target: maxTokensField,
      value: request.max_tokens,
      forwarded: true,
      reason: "chat_alias",
    },
  };
}

function mapChatNativeFields(request, chat, options = {}) {
  const present = CHAT_NATIVE_PASSTHROUGH_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(request, field)
    && request[field] !== undefined
  ));
  if (!present.length) return null;

  const forwarded = [];
  const filtered = [];
  const mapped = [];
  const forward = options.forwardChatNativeFields !== false;
  const mappedNativeFields = new Set(Array.isArray(options.mappedNativeFields) ? options.mappedNativeFields : []);
  for (const field of present) {
    if (!forward && field === "verbosity" && verbosityInstruction(request[field])) continue;
    if (!forward && mappedNativeFields.has(field)) {
      mapped.push(field);
      continue;
    }
    if (forward) {
      chat[field] = clone(request[field]);
      forwarded.push(field);
    } else {
      filtered.push(field);
    }
  }

  if (!forwarded.length && !mapped.length && !filtered.length) return null;

  return {
    ...(forwarded.length ? { forwarded } : {}),
    ...(mapped.length ? { mapped } : {}),
    ...(filtered.length ? { filtered } : {}),
    reason: forward
      ? "chat_native_passthrough"
      : filtered.length
        ? "provider_unsupported"
        : "provider_unsupported_mapped",
  };
}

function mapVerbosity(request, chat, options = {}) {
  if (request.verbosity === undefined || options.forwardChatNativeFields !== false) return null;
  const instruction = verbosityInstruction(request.verbosity);
  if (!instruction) return null;
  chat.messages = [
    { role: "system", content: instruction },
    ...(Array.isArray(chat.messages) ? chat.messages : []),
  ];
  return {
    source: "verbosity",
    value: stringifyContent(request.verbosity),
    forwarded: false,
    reason: "provider_unsupported_prompt_instruction",
    prompt_instruction: "injected",
  };
}

function verbosityInstruction(value) {
  const normalized = stringifyContent(value).trim().toLowerCase();
  if (normalized === "low") {
    return "Verbosity compatibility: answer concisely. Prefer the shortest complete response that satisfies the user.";
  }
  if (normalized === "medium") {
    return "Verbosity compatibility: use balanced detail. Give enough context to be useful without unnecessary expansion.";
  }
  if (normalized === "high") {
    return "Verbosity compatibility: answer with thorough detail. Include relevant context, caveats, and examples when useful.";
  }
  return null;
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

  const filtered = filterStreamOptionsForProvider(chat.stream_options, options);
  if (filtered.compatibility) {
    if (filtered.streamOptions === undefined) delete chat.stream_options;
    else chat.stream_options = filtered.streamOptions;
    return {
      ...filtered.compatibility,
      ...(compatibility ? { include_usage: compatibility } : {}),
    };
  }

  return compatibility;
}

function filterStreamOptionsForProvider(streamOptions, options = {}) {
  const allowed = normalizeStreamOptionFields(options.streamOptionFields);
  if (!allowed || !isPlainObject(streamOptions)) {
    return {
      streamOptions: isPlainObject(streamOptions) ? clone(streamOptions) : streamOptions,
      compatibility: null,
    };
  }

  const filtered = [];
  const forwarded = [];
  const next = {};
  for (const [key, value] of Object.entries(streamOptions)) {
    if (allowed.has(key)) {
      next[key] = value === undefined ? undefined : clone(value);
      forwarded.push(key);
    } else {
      filtered.push(key);
    }
  }

  return {
    streamOptions: Object.keys(next).length ? next : undefined,
    compatibility: filtered.length
      ? {
        source: "stream_options",
        ...(forwarded.length ? { forwarded } : {}),
        filtered,
        reason: "provider_stream_option_filter",
      }
      : null,
  };
}

function normalizeStreamOptionFields(value) {
  if (value == null || value === "*" || value === "all") return null;
  const fields = Array.isArray(value)
    ? value
    : String(value).split(",");
  const normalized = fields
    .map((field) => String(field || "").trim())
    .filter((field) => field && field !== "*" && field !== "all");
  if (normalized.some((field) => field.toLowerCase() === "none")) return new Set();
  return new Set(normalized);
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
      "Structured output compatibility: return only valid json. Do not include markdown or prose outside the JSON value. Match this JSON Schema as closely as possible.",
      JSON.stringify({
        name: format.name,
        description: format.description,
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
    tools: sanitizeResponseTools(request.tools || []),
    top_logprobs: request.top_logprobs ?? 0,
    top_p: request.top_p ?? 1,
    truncation: request.truncation ?? "disabled",
    usage: null,
    user: request.user ?? null,
    metadata: request.metadata || {},
  };
}

function sanitizeResponseTools(tools = []) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    if (!isPlainObject(tool)) return tool;
    const sanitized = clone(tool);
    if (sanitized.type === "mcp") {
      delete sanitized.authorization;
      if (isPlainObject(sanitized.headers)) {
        for (const key of Object.keys(sanitized.headers)) {
          if (key.toLowerCase() === "authorization") delete sanitized.headers[key];
        }
        if (!Object.keys(sanitized.headers).length) delete sanitized.headers;
      }
    }
    return sanitized;
  });
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
    appendToolCallOutputs(response, message.tool_calls || [], options);
    appendLegacyFunctionCallOutput(response, message.function_call, legacyFunctionCallId(chat, choice), options);
  }

  const compatibilityMetadata = chatCompatibilityMetadata(chat);
  Object.assign(compatibilityMetadata, chatChoicesCompatibilityMetadata(chat.choices));
  Object.assign(compatibilityMetadata, chatUsageCompatibilityMetadata(chat.usage));
  Object.assign(compatibilityMetadata, chatAudioCompatibilityMetadata(choices));
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
  if (chat.moderation !== undefined) response.moderation = clone(chat.moderation);

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
    moderation: "chat_moderation",
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

function chatAudioCompatibilityMetadata(choices) {
  const audio = asArray(choices)
    .map((choice) => choice?.message?.audio)
    .filter(isPlainObject);
  if (!audio.length) return {};
  return { chat_audio: audio.map(clone) };
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
  const audioPart = normalizeChatAudioPart(message.audio);
  const hasAudio = !!audioPart;
  if (!hasText && !hasRefusal && !hasAudio && Array.isArray(message.tool_calls) && message.tool_calls.length) return;
  if (!hasText && !hasRefusal && !hasAudio) return;

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
  if (hasAudio) {
    content.push(audioPart);
  }

  response.output.push({
    id: prefixedId("msg"),
    type: "message",
    status: "completed",
    role: "assistant",
    content,
  });
}

function normalizeChatAudioPart(audio) {
  if (!isPlainObject(audio)) return null;
  const part = {
    type: "output_audio",
  };
  if (audio.data != null) part.data = stringifyContent(audio.data);
  if (audio.transcript != null) part.transcript = stringifyContent(audio.transcript);
  if (audio.id != null) part.id = stringifyContent(audio.id);
  if (audio.expires_at != null) part.expires_at = audio.expires_at;
  if (audio.format != null) part.format = stringifyContent(audio.format);
  if (audio.voice != null) part.voice = stringifyContent(audio.voice);
  const extra = Object.fromEntries(
    Object.entries(audio)
      .filter(([key, value]) => !["data", "transcript", "id", "expires_at", "format", "voice"].includes(key) && value !== undefined)
      .map(([key, value]) => [key, clone(value)]),
  );
  if (Object.keys(extra).length) part.audio = extra;
  return part;
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

function appendToolCallOutputs(response, toolCalls, options = {}) {
  for (const toolCall of toolCalls || []) {
    if (!toolCall || !isPlainObject(toolCall)) continue;
    if (toolCall.type === "function") {
      response.output.push({
        id: prefixedId("fc"),
        type: "function_call",
        call_id: toolCall.id || prefixedId("call"),
        name: remapChatFunctionName(toolCall.function?.name, options),
        ...(toolCall.function?.namespace ? { namespace: toolCall.function.namespace } : {}),
        arguments: stringifyContent(toolCall.function?.arguments ?? ""),
        status: "completed",
      });
      continue;
    }
    if (toolCall.type === "custom") {
      response.output.push({
        id: prefixedId("ctc"),
        type: "custom_tool_call",
        call_id: toolCall.id || prefixedId("call"),
        name: stringifyContent(toolCall.custom?.name || ""),
        ...(toolCall.custom?.namespace ? { namespace: stringifyContent(toolCall.custom.namespace) } : {}),
        input: stringifyContent(toolCall.custom?.input ?? ""),
        status: "completed",
      });
    }
  }
}

function appendLegacyFunctionCallOutput(response, functionCall, callId, options = {}) {
  if (!isPlainObject(functionCall) || !functionCall.name) return;
  response.output.push({
    id: prefixedId("fc"),
    type: "function_call",
    call_id: callId,
    name: remapChatFunctionName(functionCall.name, options),
    ...(functionCall.namespace ? { namespace: functionCall.namespace } : {}),
    arguments: stringifyContent(functionCall.arguments ?? ""),
    status: "completed",
  });
}

function remapChatFunctionName(name, options = {}) {
  if (typeof name !== "string") return name;
  return options?.responseFunctionToolNameMap?.chat_to_responses?.[name]
    || options?.response_function_tool_names?.chat_to_responses?.[name]
    || name;
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
      replay.tool_calls = sanitizeReplayToolCalls(message.tool_calls);
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
    if (isPlainObject(message.audio)) replay.audio = clone(message.audio);
    return [replay];
  });
}

function sanitizeReplayToolCalls(toolCalls = []) {
  return asArray(toolCalls)
    .filter((toolCall) => isPlainObject(toolCall))
    .map((toolCall) => {
      if (toolCall.type === "custom") {
        return {
          id: toolCall.id || prefixedId("call"),
          type: "custom",
          custom: {
            name: stringifyContent(toolCall.custom?.name || ""),
            input: stringifyContent(toolCall.custom?.input ?? ""),
          },
        };
      }
      if (toolCall.type !== "function") return clone(toolCall);
      return {
        id: toolCall.id || prefixedId("call"),
        type: "function",
        function: {
          name: stringifyContent(toolCall.function?.name || ""),
          arguments: stringifyContent(toolCall.function?.arguments ?? ""),
        },
      };
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
  filterStreamOptionsForProvider,
  inputItemToChatMessages,
  mapResponsesTools,
  mapTextFormat,
  mapToolChoice,
  mapUsage,
  normalizeChatAudioPart,
  normalizeContentParts,
  normalizeOutputTextLogprobs,
  normalizeReasoningEffort,
  prefixedId,
  responseTerminalStateFromFinishReasons,
  responseInputToChatMessages,
  responseOutputToReplayMessages,
  responsesToChatRequest,
  stringifyContent,
};
