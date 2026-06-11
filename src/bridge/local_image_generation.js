"use strict";

const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const IMAGE_GENERATION_TOOL_TYPES = new Set(["image_generation"]);
const MAX_PROMPT_CHARS = 2000;
const MAX_REVISED_PROMPT_CHARS = 1000;
const PROVIDER_IMAGE_GENERATION_TYPES = new Set(["openai", "openai-compatible", "images"]);
const DEFAULT_IMAGE_GENERATION_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_IMAGE_GENERATION_PATH = "/images/generations";

function isImageGenerationTool(tool) {
  return !!tool && typeof tool === "object" && IMAGE_GENERATION_TOOL_TYPES.has(tool.type);
}

function canUseLocalImageGeneration(config = {}) {
  return String(config.imageGenerationProvider || "placeholder").toLowerCase() !== "disabled";
}

function localImageGenerationToolTypes(tools = [], config = {}) {
  if (!canUseLocalImageGeneration(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isImageGenerationTool)
    .map((tool) => tool.type)));
}

async function prepareImageGenerationContext(request = {}, config = {}, options = {}) {
  const tools = (request.tools || []).filter(isImageGenerationTool);
  if (!tools.length || !canUseLocalImageGeneration(config)) return null;

  const tool = tools[0];
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();
  const action = normalizeAction(tool.action);
  const prompt = extractImagePrompt(request) || "Generate an image.";
  const inputImages = extractInputImages(request.input);
  const priorImageCalls = extractPriorImageGenerationCalls(request.input);
  const partialImages = normalizePartialImageCount(tool.partial_images);
  const context = {
    provider,
    status: "completed",
    tool_types: Array.from(new Set(tools.map((item) => item.type))),
    calls: [],
    skipped_calls: [],
    prompt,
    action,
    partial_image_count: partialImages,
    requested: requestedImageOptions(tool),
    input_image_count: inputImages.length,
    prior_image_call_count: priorImageCalls.length,
    input_image_mask: !!tool.input_image_mask,
  };

  if (!reserveToolCall(options.toolBudget, {
    type: "image_generation_call",
    tool_type: tool.type || "image_generation",
    action,
  })) {
    context.status = "skipped";
    context.warning = "max_tool_calls was exhausted before local image generation compatibility could run.";
    context.skipped_calls.push({
      action,
      reason: "max_tool_calls_exhausted",
    });
    return context;
  }

  const call = {
    id: prefixedId("ig"),
    type: "image_generation_call",
    ...(await imageGenerationCallPayload({
      action,
      config,
      context,
      prompt,
      tool,
      signal: options.signal,
    })),
  };
  context.calls.push(call);
  context.status = call.status || "completed";
  if (call.status === "failed") context.error = call.error || "local image generation failed";
  return context;
}

function injectImageGenerationMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: imageGenerationPrompt(context),
  });
}

function attachImageGenerationOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...imageGenerationOutputItems(context),
    ...(response.output || []),
  ];
  return response;
}

function imageGenerationOutputItems(context) {
  return (context?.calls || []).map((call) => ({ ...call }));
}

function imageGenerationPartialImages(context) {
  const count = context?.partial_image_count || 0;
  const call = context?.calls?.find((item) => item?.status === "completed" && item.result);
  if (!call || count <= 0) return [];
  return Array.from({ length: count }, (_unused, index) => ({
    item_id: call.id,
    partial_image_index: index,
    partial_image_b64: call.result,
  }));
}

function imageGenerationCompatibility(context) {
  if (!context) return {};
  return {
    local_image_generation: {
      provider: context.provider || "placeholder",
      status: context.status || "completed",
      tool_types: context.tool_types || [],
      action: context.action || "auto",
      call_count: context.calls?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      partial_image_count: context.partial_image_count || 0,
      input_image_count: context.input_image_count || 0,
      prior_image_call_count: context.prior_image_call_count || 0,
      input_image_mask: !!context.input_image_mask,
      requested: context.requested || {},
      ...(context.model ? { model: context.model } : {}),
      ...(context.warning ? { warning: context.warning } : {}),
      ...(context.error ? { error: context.error } : {}),
      ...(String(context.provider || "placeholder").toLowerCase() === "placeholder"
        ? { placeholder: true }
        : {}),
    },
  };
}

function imageGenerationPrompt(context) {
  if (context.warning || context.status === "failed") {
    return [
      "Local Responses image_generation compatibility was requested but did not complete image generation.",
      context.warning || context.error || "local image generation failed",
      "Do not claim that a new image was produced unless an image_generation_call appears in the response output.",
    ].join("\n");
  }

  const calls = context.calls || [];
  const sections = [
    "Local Responses image_generation compatibility is active.",
    "The bridge has already produced Responses image_generation_call output for the client; do not include base64 image data in natural-language text.",
    `Requested action: ${context.action || "auto"}.`,
    `Input images in request: ${context.input_image_count || 0}. Prior image_generation_call references: ${context.prior_image_call_count || 0}.`,
  ];

  if (calls.length) {
    sections.push([
      "Generated image call items:",
      ...calls.map((call) => [
        `- id: ${call.id}`,
        `  status: ${call.status || "completed"}`,
        `  revised_prompt: ${truncateForPrompt(call.revised_prompt || context.prompt || "", 500)}`,
      ].join("\n")),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

function normalizeAction(value) {
  const action = String(value || "auto").toLowerCase();
  if (["auto", "generate", "edit"].includes(action)) return action;
  return "auto";
}

function normalizePartialImageCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(parsed)));
}

function requestedImageOptions(tool = {}) {
  const keys = [
    "action",
    "background",
    "input_fidelity",
    "moderation",
    "output_compression",
    "output_format",
    "partial_images",
    "quality",
    "size",
  ];
  const options = {};
  for (const key of keys) {
    if (tool[key] !== undefined) options[key] = stringifyContent(tool[key]);
  }
  return options;
}

async function imageGenerationCallPayload({ action, config, context, prompt, signal, tool }) {
  if (PROVIDER_IMAGE_GENERATION_TYPES.has(context.provider)) {
    try {
      const generated = await generateWithImageProvider({ config, prompt, signal, tool });
      context.model = generated.model || config.imageGenerationModel || "";
      return {
        status: "completed",
        revised_prompt: generated.revised_prompt || revisedPromptFor(prompt, action),
        result: generated.b64_json,
      };
    } catch (error) {
      context.error = error.message || "image provider request failed";
      return {
        status: "failed",
        revised_prompt: revisedPromptFor(prompt, action),
        error: context.error,
      };
    }
  }

  return {
    status: "completed",
    revised_prompt: revisedPromptFor(prompt, action),
    result: makePlaceholderImageBase64(prompt, tool, config),
  };
}

async function generateWithImageProvider({ config = {}, prompt, signal, tool = {} }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw new Error(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`);
  }

  const body = imageGenerationProviderBody({ config, prompt, tool });
  const controller = new AbortController();
  const timeoutMs = config.imageGenerationTimeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(imageGenerationProviderUrl(config), {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      const message = stringifyContent(json?.error?.message || text || `image provider returned HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      error.code = json?.error?.code;
      error.type = json?.error?.type;
      throw error;
    }

    const first = Array.isArray(json?.data) ? json.data[0] : null;
    const b64 = first?.b64_json || first?.image_b64 || first?.result;
    if (!b64) {
      throw new Error("image provider did not return data[0].b64_json");
    }
    return {
      b64_json: stringifyContent(b64),
      revised_prompt: stringifyOptional(first?.revised_prompt),
      model: stringifyOptional(json?.model || body.model),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("image provider request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  }
}

function imageGenerationProviderBody({ config = {}, prompt, tool = {} }) {
  const body = {
    model: config.imageGenerationModel || "gpt-image-2",
    prompt,
    n: 1,
  };
  copyImageProviderOption(tool, body, "background");
  copyImageProviderOption(tool, body, "moderation");
  copyImageProviderOption(tool, body, "output_compression");
  copyImageProviderOption(tool, body, "output_format");
  copyImageProviderOption(tool, body, "quality");
  copyImageProviderOption(tool, body, "size");
  if (config.imageGenerationResponseFormat) {
    body.response_format = config.imageGenerationResponseFormat;
  }
  if (config.imageGenerationUser) body.user = stringifyContent(config.imageGenerationUser);
  return body;
}

function copyImageProviderOption(source, target, key) {
  if (source?.[key] !== undefined) target[key] = source[key];
}

function imageGenerationProviderUrl(config = {}) {
  const base = trimTrailingSlash(config.imageGenerationBaseUrl || DEFAULT_IMAGE_GENERATION_BASE_URL);
  const route = normalizeRoute(config.imageGenerationPath || DEFAULT_IMAGE_GENERATION_PATH);
  return `${base}${route}`;
}

function normalizeRoute(value) {
  const route = String(value || "").trim();
  if (!route) return "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringifyOptional(value) {
  if (value == null) return "";
  return stringifyContent(value);
}

function extractImagePrompt(request = {}) {
  const chunks = [];
  if (request.instructions) chunks.push(stringifyContent(request.instructions));
  collectText(request.input, chunks);
  const prompt = chunks
    .map((chunk) => stringifyContent(chunk).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return truncateForPrompt(prompt, MAX_PROMPT_CHARS);
}

function collectText(value, chunks) {
  if (value == null) return;
  if (typeof value === "string") {
    chunks.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    chunks.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, chunks);
    return;
  }
  if (!isPlainObject(value)) return;

  if (["input_text", "text", "output_text"].includes(value.type)) {
    collectText(value.text ?? value.content, chunks);
    return;
  }
  if (value.type === "input_image" || value.type === "image_url") {
    if (value.detail) chunks.push(`[image detail: ${stringifyContent(value.detail)}]`);
    return;
  }
  if (value.type === "image_generation_call") {
    if (value.id) chunks.push(`[prior image_generation_call: ${stringifyContent(value.id)}]`);
    return;
  }
  if (value.type === "input_file") {
    if (value.text) collectText(value.text, chunks);
    else if (value.filename || value.file_id || value.file_url) {
      chunks.push(`[file: ${stringifyContent(value.filename || value.file_id || value.file_url)}]`);
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, "content")) collectText(value.content, chunks);
  if (Object.prototype.hasOwnProperty.call(value, "input")) collectText(value.input, chunks);
  if (typeof value.text === "string") collectText(value.text, chunks);
}

function extractInputImages(input) {
  const images = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainObject(value)) return;
    if (value.type === "input_image" || value.type === "image_url") images.push(value);
    if (Array.isArray(value.content)) visit(value.content);
    if (Array.isArray(value.input)) visit(value.input);
  };
  visit(input);
  return images;
}

function extractPriorImageGenerationCalls(input) {
  const calls = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlainObject(value)) return;
    if (value.type === "image_generation_call") {
      calls.push(value);
      return;
    }
    if (Array.isArray(value.content)) visit(value.content);
    if (Array.isArray(value.input)) visit(value.input);
  };
  visit(input);
  return calls;
}

function revisedPromptFor(prompt, action) {
  const prefix = action === "edit"
    ? "Edit the supplied image using this instruction:"
    : "Generate an image from this prompt:";
  return truncateForPrompt(`${prefix} ${prompt}`.trim(), MAX_REVISED_PROMPT_CHARS);
}

function truncateForPrompt(value, maxChars) {
  const text = stringifyContent(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function makePlaceholderImageBase64(prompt, tool = {}, config = {}) {
  const size = placeholderSize(config);
  const seed = crypto
    .createHash("sha256")
    .update(prompt)
    .update("\n")
    .update(JSON.stringify(requestedImageOptions(tool)))
    .digest();
  return encodePng(size, size, (x, y) => placeholderPixel(seed, x, y, size));
}

function placeholderSize(config = {}) {
  const value = Number(config.imageGenerationPlaceholderSize || 96);
  if (!Number.isFinite(value)) return 96;
  return Math.max(16, Math.min(512, Math.trunc(value)));
}

function placeholderPixel(seed, x, y, size) {
  const border = x < 3 || y < 3 || x >= size - 3 || y >= size - 3;
  const diagonal = Math.abs(x - y) < 2 || Math.abs((size - x) - y) < 2;
  const checker = ((Math.floor(x / 12) + Math.floor(y / 12)) % 2) === 0;
  const r = (seed[0] + x * 3 + y) % 256;
  const g = (seed[1] + x + y * 3) % 256;
  const b = (seed[2] + x * 2 + y * 2) % 256;
  if (border) return [32, 36, 44, 255];
  if (diagonal) return [255 - r, 255 - g, 255 - b, 255];
  if (checker) return [r, Math.floor((g + 255) / 2), b, 255];
  return [Math.floor((r + 255) / 2), g, Math.floor((b + 255) / 2), 255];
}

function encodePng(width, height, pixelAt) {
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((width * bytesPerPixel + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * bytesPerPixel + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(x, y);
      const offset = rowStart + 1 + x * bytesPerPixel;
      raw[offset] = pixel[0];
      raw[offset + 1] = pixel[1];
      raw[offset + 2] = pixel[2];
      raw[offset + 3] = pixel[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

let crcTable = null;

function crc32(buffer) {
  if (!crcTable) crcTable = makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  attachImageGenerationOutput,
  imageGenerationCompatibility,
  imageGenerationOutputItems,
  imageGenerationPartialImages,
  injectImageGenerationMessages,
  isImageGenerationTool,
  localImageGenerationToolTypes,
  prepareImageGenerationContext,
};
