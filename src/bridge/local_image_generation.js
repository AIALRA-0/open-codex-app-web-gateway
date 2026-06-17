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
const DEFAULT_IMAGE_GENERATION_EDIT_PATH = "/images/edits";
const DEFAULT_IMAGE_GENERATION_VARIATION_PATH = "/images/variations";
const DEFAULT_MAX_EDIT_IMAGE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_STORED_IMAGE_BYTES = 50 * 1024 * 1024;
const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 10000;
const MAX_IMAGES_GENERATION_N = 10;
const MAX_IMAGE_VARIATION_BYTES = 4 * 1024 * 1024;
const MAX_GPT_IMAGE_PROMPT_CHARS = 32000;
const MAX_DALL_E_2_PROMPT_CHARS = 1000;
const MAX_DALL_E_3_PROMPT_CHARS = 4000;
const IMAGE_API_BACKGROUND_VALUES = ["transparent", "opaque", "auto"];
const IMAGE_API_INPUT_FIDELITY_VALUES = ["high", "low"];
const IMAGE_API_MODERATION_VALUES = ["auto", "low"];
const IMAGE_API_OUTPUT_FORMAT_VALUES = ["png", "jpeg", "webp"];
const IMAGE_API_QUALITY_VALUES = ["auto", "high", "medium", "low", "hd", "standard"];
const IMAGE_API_RESPONSE_FORMAT_VALUES = ["url", "b64_json"];
const IMAGE_API_STYLE_VALUES = ["vivid", "natural"];
const IMAGE_API_VARIATION_SIZE_VALUES = ["256x256", "512x512", "1024x1024"];
const IMAGE_API_DALL_E_2_QUALITY_VALUES = ["standard"];
const IMAGE_API_DALL_E_3_QUALITY_VALUES = ["standard", "hd"];
const IMAGE_API_GPT_QUALITY_VALUES = ["auto", "high", "medium", "low"];
const IMAGE_API_DALL_E_2_SIZE_VALUES = ["256x256", "512x512", "1024x1024"];
const IMAGE_API_DALL_E_3_SIZE_VALUES = ["1024x1024", "1792x1024", "1024x1792"];
const IMAGE_API_EDIT_GPT_SIZE_VALUES = ["auto", "1024x1024", "1536x1024", "1024x1536"];
const MAX_IMAGES_EDIT_INPUT_IMAGES = 16;

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
  const priorImageCalls = mergeImageGenerationCalls(
    extractPriorImageGenerationCalls(request.input),
    extractPriorImageGenerationCalls(options.previousResponse?.output),
  );
  const priorStoredImageCalls = countStoredImageGenerationCalls(priorImageCalls, options.imageGenerationStore);
  const mode = imageGenerationModeFor(action, inputImages, priorImageCalls, tool, { imageStore: options.imageGenerationStore });
  const editInput = mode === "edit"
    ? await resolveImageEditInput({
      config,
      fileStore: options.fileSearchStore,
      imageStore: options.imageGenerationStore,
      inputImages,
      priorImageCalls,
      signal: options.signal,
      tool,
      fetch: options.fetch,
    })
    : emptyImageEditInput();
  const partialImages = normalizePartialImageCount(tool.partial_images);
  const context = {
    provider,
    status: "completed",
    tool_types: Array.from(new Set(tools.map((item) => item.type))),
    calls: [],
    skipped_calls: [],
    prompt,
    action,
    mode,
    partial_image_count: partialImages,
    requested: requestedImageOptions(tool),
    input_image_count: inputImages.length,
    prior_image_call_count: priorImageCalls.length,
    prior_stored_image_call_count: priorStoredImageCalls,
    input_image_mask: !!tool.input_image_mask,
    resolved_image_count: editInput.images.length,
    resolved_stored_image_call_count: editInput.images.filter((image) => image.source === "image_generation_call.id").length,
    input_image_mask_resolved: !!editInput.mask,
    image_resolution_error_count: editInput.errors.length,
    image_resolution_errors: editInput.errors.map((error) => imageResolutionErrorSummary(error)),
    stored_image_call_count: 0,
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
      editInput,
      prompt,
      tool,
      signal: options.signal,
    })),
  };
  context.calls.push(call);
  context.status = call.status || "completed";
  if (call.status === "failed") context.error = call.error || "local image generation failed";
  const stored = persistImageGenerationCall(call, context, tool, config, options.imageGenerationStore);
  if (stored.stored) context.stored_image_call_count += 1;
  if (stored.error) context.image_store_warning = stored.error;
  return context;
}

function injectImageGenerationMessages(chat, context) {
  if (!context) return;
  sanitizeImageGenerationInputsForChat(chat, context);
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

function sanitizeImageGenerationInputsForChat(chat, context) {
  if (context?.mode !== "edit") return;
  for (const message of chat.messages || []) {
    if (!Array.isArray(message.content)) continue;
    message.content = message.content.map((part) => {
      if (!isPlainObject(part) || part.type !== "image_url") return part;
      return {
        type: "text",
        text: "[image input consumed by local image_generation edit]",
      };
    });
  }
}

function imageGenerationCompatibility(context) {
  if (!context) return {};
  return {
    local_image_generation: {
      provider: context.provider || "placeholder",
      status: context.status || "completed",
      tool_types: context.tool_types || [],
      action: context.action || "auto",
      mode: context.mode || context.action || "auto",
      call_count: context.calls?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      partial_image_count: context.partial_image_count || 0,
      input_image_count: context.input_image_count || 0,
      prior_image_call_count: context.prior_image_call_count || 0,
      prior_stored_image_call_count: context.prior_stored_image_call_count || 0,
      resolved_stored_image_call_count: context.resolved_stored_image_call_count || 0,
      stored_image_call_count: context.stored_image_call_count || 0,
      input_image_mask: !!context.input_image_mask,
      resolved_image_count: context.resolved_image_count || 0,
      input_image_mask_resolved: !!context.input_image_mask_resolved,
      image_resolution_error_count: context.image_resolution_error_count || 0,
      requested: context.requested || {},
      ...(context.model ? { model: context.model } : {}),
      ...(context.warning ? { warning: context.warning } : {}),
      ...(context.image_store_warning ? { image_store_warning: context.image_store_warning } : {}),
      ...(context.error ? { error: context.error } : {}),
      ...(context.image_resolution_errors?.length
        ? { image_resolution_errors: context.image_resolution_errors }
        : {}),
      ...(String(context.provider || "placeholder").toLowerCase() === "placeholder"
        ? { placeholder: true }
        : {}),
    },
  };
}

async function createImagesGenerationResponse(request = {}, config = {}, options = {}) {
  const normalized = normalizeImagesGenerationRequest(request, config);
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();

  if (!canUseLocalImageGeneration(config)) {
    throw imageApiError("local image generation is disabled", {
      status: 400,
      code: "image_generation_disabled",
      param: "provider",
    });
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(provider)) {
    const response = await requestImagesGenerationProvider({
      config,
      normalized,
      signal: options.signal,
    });
    return normalizeImagesGenerationProviderResponse(response);
  }

  return placeholderImagesGenerationResponse(normalized, config);
}

async function createImagesGenerationEventStream(request = {}, config = {}, options = {}) {
  const normalized = normalizeImagesGenerationRequest(request, config);
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();

  if (!canUseLocalImageGeneration(config)) {
    throw imageApiError("local image generation is disabled", {
      status: 400,
      code: "image_generation_disabled",
      param: "provider",
    });
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(provider)) {
    return await requestImagesGenerationProviderStream({
      config,
      normalized,
      signal: options.signal,
    });
  }

  return imagesGenerationStreamEvents(placeholderImagesGenerationResponse(normalized, config), normalized);
}

async function createImagesEditResponse(request = {}, config = {}, options = {}) {
  const normalized = await normalizeImagesEditRequest(request, config, options);
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();

  if (!canUseLocalImageGeneration(config)) {
    throw imageApiError("local image generation is disabled", {
      status: 400,
      code: "image_generation_disabled",
      param: "provider",
    });
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(provider)) {
    const response = await requestImagesEditProvider({
      config,
      normalized,
      signal: options.signal,
    });
    return normalizeImagesGenerationProviderResponse(response);
  }

  return placeholderImagesEditResponse(normalized, config);
}

async function createImagesEditEventStream(request = {}, config = {}, options = {}) {
  const normalized = await normalizeImagesEditRequest(request, config, options);
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();

  if (!canUseLocalImageGeneration(config)) {
    throw imageApiError("local image generation is disabled", {
      status: 400,
      code: "image_generation_disabled",
      param: "provider",
    });
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(provider)) {
    return await requestImagesEditProviderStream({
      config,
      normalized,
      signal: options.signal,
    });
  }

  return imagesEditStreamEvents(placeholderImagesEditResponse(normalized, config), normalized);
}

async function createImagesVariationResponse(request = {}, config = {}, options = {}) {
  const normalized = await normalizeImagesVariationRequest(request, config, options);
  const provider = String(config.imageGenerationProvider || "placeholder").toLowerCase();

  if (!canUseLocalImageGeneration(config)) {
    throw imageApiError("local image generation is disabled", {
      status: 400,
      code: "image_generation_disabled",
      param: "provider",
    });
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(provider)) {
    const response = await requestImagesVariationProvider({
      config,
      normalized,
      signal: options.signal,
    });
    return normalizeImagesGenerationProviderResponse(response);
  }

  return placeholderImagesVariationResponse(normalized, config);
}

function imagesGenerationStreamEvents(response = {}, request = {}) {
  const first = Array.isArray(response.data) ? response.data.find((item) => item?.b64_json) : null;
  const b64 = first?.b64_json || "";
  const partialCount = normalizePartialImageCount(request.partial_images);
  const events = [];
  if (b64) {
    for (let index = 0; index < partialCount; index += 1) {
      events.push({
        event: "image_generation.partial_image",
        data: {
          type: "image_generation.partial_image",
          b64_json: b64,
          partial_image_index: index,
        },
      });
    }
    events.push({
      event: "image_generation.completed",
      data: {
        type: "image_generation.completed",
        b64_json: b64,
        ...(response.usage ? { usage: response.usage } : {}),
      },
    });
  }
  return events;
}

function imagesEditStreamEvents(response = {}, request = {}) {
  const first = Array.isArray(response.data) ? response.data.find((item) => item?.b64_json) : null;
  const b64 = first?.b64_json || "";
  const partialCount = normalizePartialImageCount(request.partial_images);
  const events = [];
  if (b64) {
    for (let index = 0; index < partialCount; index += 1) {
      events.push({
        event: "image_edit.partial_image",
        data: {
          type: "image_edit.partial_image",
          b64_json: b64,
          partial_image_index: index,
        },
      });
    }
    events.push({
      event: "image_edit.completed",
      data: {
        type: "image_edit.completed",
        b64_json: b64,
        ...(response.usage ? { usage: response.usage } : {}),
      },
    });
  }
  return events;
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
    `Resolved mode: ${context.mode || context.action || "auto"}.`,
    `Input images in request: ${context.input_image_count || 0}. Prior image_generation_call references: ${context.prior_image_call_count || 0}.`,
  ];
  if (context.mode === "edit") {
    sections.push(`Resolved edit images: ${context.resolved_image_count || 0}. Mask resolved: ${context.input_image_mask_resolved ? "yes" : "no"}.`);
  }
  if (context.image_resolution_errors?.length) {
    sections.push([
      "Image input resolution warnings:",
      ...context.image_resolution_errors.map((error) => `- ${error.source || "input"}: ${error.error || "failed"}`),
    ].join("\n"));
  }

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

function imageGenerationModeFor(action, inputImages = [], priorImageCalls = [], tool = {}, options = {}) {
  if (action === "generate") return "generate";
  if (action === "edit") return "edit";
  if (tool.input_image_mask) return "edit";
  if (inputImages.length) return "edit";
  if (priorImageCalls.some((call) => call.file_id || imageDataCandidate(call) || storedImageGenerationRecord(call.id, options.imageStore))) return "edit";
  return "generate";
}

function normalizePartialImageCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(parsed)));
}

function normalizeImageApiPartialImageCount(value, param = "partial_images") {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw imageApiError(`${param} must be an integer between 0 and 3`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  return parsed;
}

function normalizeImageApiEnum(value, param, allowedValues) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw imageApiError(`${param} must be a string`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  const normalized = value.trim().toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw imageApiError(`${param} must be one of: ${allowedValues.join(", ")}`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  return normalized;
}

function normalizeImageApiOptionalInteger(value, param, { min, max }) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw imageApiError(`${param} must be an integer between ${min} and ${max}`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  return parsed;
}

function normalizeImageApiOptionalString(value, param) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw imageApiError(`${param} must be a string`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  return value.trim();
}

function normalizeImageApiModel(value, fallback) {
  if (value === undefined || value === null || value === "") return stringifyContent(fallback);
  if (typeof value !== "string" || !value.trim()) {
    throw imageApiError("model must be a string", {
      code: "invalid_request_parameter",
      param: "model",
    });
  }
  return value.trim();
}

function normalizeImageApiJsonBoolean(value, param = "stream") {
  if (value === undefined || value === null) return false;
  if (value === true || value === false) return value;
  throw imageApiError(`${param} must be a boolean`, {
    code: "invalid_request_parameter",
    param,
  });
}

function normalizeImageApiFormBoolean(value, param = "stream") {
  if (value === undefined || value === null || value === "") return false;
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  throw imageApiError(`${param} must be a boolean`, {
    code: "invalid_request_parameter",
    param,
  });
}

function normalizeImagesGenerationOptions(request = {}) {
  const options = {};
  appendNormalizedOption(options, "background", normalizeImageApiEnum(
    request.background,
    "background",
    IMAGE_API_BACKGROUND_VALUES,
  ));
  appendNormalizedOption(options, "moderation", normalizeImageApiEnum(
    request.moderation,
    "moderation",
    IMAGE_API_MODERATION_VALUES,
  ));
  appendNormalizedOption(options, "output_compression", normalizeImageApiOptionalInteger(
    request.output_compression,
    "output_compression",
    { min: 0, max: 100 },
  ));
  appendNormalizedOption(options, "output_format", normalizeImageApiEnum(
    request.output_format,
    "output_format",
    IMAGE_API_OUTPUT_FORMAT_VALUES,
  ));
  appendNormalizedOption(options, "quality", normalizeImageApiEnum(
    request.quality,
    "quality",
    IMAGE_API_QUALITY_VALUES,
  ));
  appendNormalizedOption(options, "response_format", normalizeImageApiEnum(
    request.response_format,
    "response_format",
    IMAGE_API_RESPONSE_FORMAT_VALUES,
  ));
  appendNormalizedOption(options, "size", normalizeImageApiOptionalString(request.size, "size"));
  appendNormalizedOption(options, "style", normalizeImageApiEnum(
    request.style,
    "style",
    IMAGE_API_STYLE_VALUES,
  ));
  appendNormalizedOption(options, "user", normalizeImageApiOptionalString(request.user, "user"));
  return options;
}

function normalizeImagesEditOptions(request = {}) {
  const options = {};
  appendNormalizedOption(options, "background", normalizeImageApiEnum(
    request.background,
    "background",
    IMAGE_API_BACKGROUND_VALUES,
  ));
  appendNormalizedOption(options, "input_fidelity", normalizeImageApiEnum(
    request.input_fidelity,
    "input_fidelity",
    IMAGE_API_INPUT_FIDELITY_VALUES,
  ));
  appendNormalizedOption(options, "moderation", normalizeImageApiEnum(
    request.moderation,
    "moderation",
    IMAGE_API_MODERATION_VALUES,
  ));
  appendNormalizedOption(options, "output_compression", normalizeImageApiOptionalInteger(
    request.output_compression,
    "output_compression",
    { min: 0, max: 100 },
  ));
  appendNormalizedOption(options, "output_format", normalizeImageApiEnum(
    request.output_format,
    "output_format",
    IMAGE_API_OUTPUT_FORMAT_VALUES,
  ));
  appendNormalizedOption(options, "quality", normalizeImageApiEnum(
    request.quality,
    "quality",
    IMAGE_API_QUALITY_VALUES,
  ));
  appendNormalizedOption(options, "response_format", normalizeImageApiEnum(
    request.response_format,
    "response_format",
    IMAGE_API_RESPONSE_FORMAT_VALUES,
  ));
  appendNormalizedOption(options, "size", normalizeImageApiOptionalString(request.size, "size"));
  appendNormalizedOption(options, "user", normalizeImageApiOptionalString(request.user, "user"));
  return options;
}

function validateImagesGenerationModelConstraints({ model, n, options = {}, partialImagesRequested = false, prompt, stream = false }) {
  const maxPrompt = imageGenerationPromptLimit(model);
  if (prompt.length > maxPrompt) {
    throw imageApiError(`prompt must be at most ${maxPrompt} characters for ${imageGenerationPromptLimitLabel(model)}`, {
      code: "invalid_request_parameter",
      param: "prompt",
    });
  }
  if (isDallE3ImageModel(model) && n !== 1) {
    throw imageApiError("n must be 1 for dall-e-3", {
      code: "invalid_request_parameter",
      param: "n",
    });
  }
  validateImagesGenerationModelOptionConstraints({ model, options, partialImagesRequested, stream });
}

function imageGenerationPromptLimit(model) {
  const normalized = normalizeImageModelName(model);
  if (normalized === "dall-e-2") return MAX_DALL_E_2_PROMPT_CHARS;
  if (normalized === "dall-e-3") return MAX_DALL_E_3_PROMPT_CHARS;
  return MAX_GPT_IMAGE_PROMPT_CHARS;
}

function imageGenerationPromptLimitLabel(model) {
  const normalized = normalizeImageModelName(model);
  if (normalized === "dall-e-2" || normalized === "dall-e-3") return normalized;
  return "GPT image models";
}

function isDallE3ImageModel(model) {
  return normalizeImageModelName(model) === "dall-e-3";
}

function isDallE2ImageModel(model) {
  return normalizeImageModelName(model) === "dall-e-2";
}

function isDallEImageModel(model) {
  const normalized = normalizeImageModelName(model);
  return normalized === "dall-e-2" || normalized === "dall-e-3";
}

function isKnownGptImageModel(model) {
  const normalized = normalizeImageModelName(model);
  return normalized.startsWith("gpt-image-")
    || normalized === "chatgpt-image-latest";
}

function normalizeImageModelName(model) {
  return String(model || "").trim().toLowerCase();
}

function validateImagesGenerationModelOptionConstraints({ model, options = {}, partialImagesRequested = false, stream = false }) {
  if (isDallEImageModel(model)) {
    for (const key of ["background", "moderation", "output_compression", "output_format"]) {
      if (options[key] !== undefined) {
        throw unsupportedImageModelOption(key, "GPT image models");
      }
    }
    if (stream) throw unsupportedImageModelOption("stream", "GPT image models");
    if (partialImagesRequested) throw unsupportedImageModelOption("partial_images", "GPT image models");
  }

  if (isKnownGptImageModel(model)) {
    if (options.response_format !== undefined) {
      throw imageApiError("response_format is not supported for GPT image models", {
        code: "invalid_request_parameter",
        param: "response_format",
      });
    }
    validateImageOptionValue("quality", options.quality, IMAGE_API_GPT_QUALITY_VALUES, "GPT image models");
    if (options.style !== undefined) throw unsupportedImageModelOption("style", "dall-e-3");
  }

  if (isDallE2ImageModel(model)) {
    validateImageOptionValue("quality", options.quality, IMAGE_API_DALL_E_2_QUALITY_VALUES, "dall-e-2");
    validateImageOptionValue("size", options.size, IMAGE_API_DALL_E_2_SIZE_VALUES, "dall-e-2");
    if (options.style !== undefined) throw unsupportedImageModelOption("style", "dall-e-3");
  }

  if (isDallE3ImageModel(model)) {
    validateImageOptionValue("quality", options.quality, IMAGE_API_DALL_E_3_QUALITY_VALUES, "dall-e-3");
    validateImageOptionValue("size", options.size, IMAGE_API_DALL_E_3_SIZE_VALUES, "dall-e-3");
  }

  if (options.background === "transparent"
    && options.output_format !== undefined
    && !["png", "webp"].includes(options.output_format)) {
    throw imageApiError("background transparent requires output_format png or webp", {
      code: "invalid_request_parameter",
      param: "background",
    });
  }
}

function validateImagesEditModelConstraints({
  editInput = null,
  jsonRequest = false,
  model,
  options = {},
  partialImagesRequested = false,
  prompt,
  request = {},
}) {
  const maxPrompt = isDallE2ImageModel(model)
    ? MAX_DALL_E_2_PROMPT_CHARS
    : MAX_GPT_IMAGE_PROMPT_CHARS;
  if (prompt.length > maxPrompt) {
    throw imageApiError(`prompt must be at most ${maxPrompt} characters for ${isDallE2ImageModel(model) ? "dall-e-2" : "GPT image models"}`, {
      code: "invalid_request_parameter",
      param: "prompt",
    });
  }

  validateImagesEditJsonReferences(request);

  if (jsonRequest && isDallE2ImageModel(model)) {
    throw imageApiError("JSON image edit requests only support GPT image models", {
      code: "invalid_request_parameter",
      param: "model",
    });
  }

  if (isDallE2ImageModel(model)) {
    for (const key of ["background", "input_fidelity", "moderation", "output_compression", "output_format"]) {
      if (options[key] !== undefined) {
        throw unsupportedImageModelOption(key, "GPT image models");
      }
    }
    if (partialImagesRequested) throw unsupportedImageModelOption("partial_images", "GPT image models");
  }

  if (isKnownGptImageModel(model)) {
    if (options.response_format !== undefined) {
      throw imageApiError("response_format is not supported for GPT image models", {
        code: "invalid_request_parameter",
        param: "response_format",
      });
    }
    validateImageOptionValue("quality", options.quality, IMAGE_API_GPT_QUALITY_VALUES, "GPT image models");
    if (!isGptImage2Model(model)) {
      validateImageOptionValue("size", options.size, IMAGE_API_EDIT_GPT_SIZE_VALUES, "GPT image edit models");
    }
  }

  if (options.background === "transparent"
    && options.output_format !== undefined
    && !["png", "webp"].includes(options.output_format)) {
    throw imageApiError("background transparent requires output_format png or webp", {
      code: "invalid_request_parameter",
      param: "background",
    });
  }

  if (editInput) validateImagesEditInputModelConstraints({ editInput, model });
}

function validateImagesVariationModelConstraints(model) {
  if (isDallE2ImageModel(model)) return;
  if (isDallEImageModel(model) || isKnownGptImageModel(model)) {
    throw imageApiError("model must be dall-e-2 for image variations", {
      code: "invalid_request_parameter",
      param: "model",
    });
  }
}

function validateImagesEditJsonReferences(request = {}) {
  if (request.images !== undefined) {
    if (!Array.isArray(request.images)) {
      throw imageApiError("images must be an array", {
        code: "invalid_request_parameter",
        param: "images",
      });
    }
    if (request.images.length < 1 || request.images.length > MAX_IMAGES_EDIT_INPUT_IMAGES) {
      throw imageApiError("images must contain between 1 and 16 items", {
        code: "invalid_request_parameter",
        param: "images",
      });
    }
    request.images.forEach((item, index) => validateImageEditRefParam(item, `images.${index}`));
  }
  if (isPlainObject(request.mask)) validateImageEditRefParam(request.mask, "mask");
}

function validateImageEditRefParam(value, param) {
  if (!isPlainObject(value)) {
    throw imageApiError(`${param} must be an object`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  const hasImageUrl = value.image_url !== undefined && value.image_url !== null && value.image_url !== "";
  const hasFileId = value.file_id !== undefined && value.file_id !== null && value.file_id !== "";
  if (hasImageUrl === hasFileId) {
    throw imageApiError(`${param} must provide exactly one of image_url or file_id`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  if (hasImageUrl && typeof value.image_url !== "string") {
    throw imageApiError(`${param}.image_url must be a string`, {
      code: "invalid_request_parameter",
      param: `${param}.image_url`,
    });
  }
  if (hasFileId && typeof value.file_id !== "string") {
    throw imageApiError(`${param}.file_id must be a string`, {
      code: "invalid_request_parameter",
      param: `${param}.file_id`,
    });
  }
}

function validateImagesEditInputModelConstraints({ editInput = {}, model }) {
  const imageCount = editInput.images?.length || 0;
  if (imageCount > MAX_IMAGES_EDIT_INPUT_IMAGES) {
    throw imageApiError("image edit accepts at most 16 input images", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }

  if (!isDallE2ImageModel(model)) return;

  if (imageCount !== 1) {
    throw imageApiError("dall-e-2 image edits require exactly one input image", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
  validateDallE2EditImageInput(editInput.images[0], "image");
  if (editInput.mask) validateDallE2EditImageInput(editInput.mask, "mask");
  if (editInput.mask) {
    const imageDimensions = pngDimensions(editInput.images[0].buffer);
    const maskDimensions = pngDimensions(editInput.mask.buffer);
    if (imageDimensions
      && maskDimensions
      && (imageDimensions.width !== maskDimensions.width || imageDimensions.height !== maskDimensions.height)) {
      throw imageApiError("mask must have the same dimensions as image for dall-e-2 image edits", {
        code: "invalid_request_parameter",
        param: "mask",
      });
    }
  }
}

function validateDallE2EditImageInput(image = {}, param) {
  if (image.media_type !== "image/png") {
    throw imageApiError(`${param} must be a PNG file for dall-e-2 image edits`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  if (!Buffer.isBuffer(image.buffer) || !image.buffer.length || !pngDimensions(image.buffer)) {
    throw imageApiError(`${param} must be a valid PNG file for dall-e-2 image edits`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  if (image.buffer.length > MAX_IMAGE_VARIATION_BYTES) {
    throw imageApiError(`${param} must be less than 4MB for dall-e-2 image edits`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  const dimensions = pngDimensions(image.buffer);
  if (param === "image" && dimensions.width !== dimensions.height) {
    throw imageApiError("image must be square for dall-e-2 image edits", {
      code: "invalid_request_parameter",
      param,
    });
  }
}

function unsupportedImageModelOption(param, modelLabel) {
  return imageApiError(`${param} is only supported for ${modelLabel}`, {
    code: "invalid_request_parameter",
    param,
  });
}

function validateImageOptionValue(param, value, allowedValues, modelLabel) {
  if (value === undefined) return;
  if (!allowedValues.includes(value)) {
    throw imageApiError(`${param} must be one of: ${allowedValues.join(", ")} for ${modelLabel}`, {
      code: "invalid_request_parameter",
      param,
    });
  }
}

function isGptImage2Model(model) {
  const normalized = normalizeImageModelName(model);
  return normalized === "gpt-image-2" || normalized.startsWith("gpt-image-2-");
}

function normalizeImagesVariationOptions(request = {}) {
  const options = {};
  appendNormalizedOption(options, "response_format", normalizeImageApiEnum(
    request.response_format,
    "response_format",
    IMAGE_API_RESPONSE_FORMAT_VALUES,
  ));
  appendNormalizedOption(options, "size", normalizeImageApiEnum(
    request.size,
    "size",
    IMAGE_API_VARIATION_SIZE_VALUES,
  ));
  appendNormalizedOption(options, "user", normalizeImageApiOptionalString(request.user, "user"));
  return options;
}

function appendNormalizedOption(options, key, value) {
  if (value !== undefined) options[key] = value;
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

async function imageGenerationCallPayload({ action, config, context, editInput, prompt, signal, tool }) {
  if (context.mode === "edit" && !editInput?.images?.length) {
    context.error = imageEditInputError(editInput);
    return {
      status: "failed",
      revised_prompt: revisedPromptFor(prompt, action),
      error: context.error,
    };
  }
  if (context.mode === "edit" && editInput?.mask_required && !editInput.mask) {
    context.error = imageEditMaskError(editInput);
    return {
      status: "failed",
      revised_prompt: revisedPromptFor(prompt, action),
      error: context.error,
    };
  }

  if (PROVIDER_IMAGE_GENERATION_TYPES.has(context.provider)) {
    try {
      const generated = context.mode === "edit"
        ? await editWithImageProvider({ config, editInput, prompt, signal, tool })
        : await generateWithImageProvider({ config, prompt, signal, tool });
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
  return requestImageProvider({
    config,
    signal,
    url: imageGenerationProviderUrl(config),
    fetchOptions: {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    fallbackModel: body.model,
  });
}

async function editWithImageProvider({ config = {}, editInput, prompt, signal, tool = {} }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw new Error(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`);
  }
  if (!editInput?.images?.length) throw new Error(imageEditInputError(editInput));

  const form = imageGenerationProviderEditForm({ config, editInput, prompt, tool });
  return requestImageProvider({
    config,
    signal,
    url: imageGenerationEditProviderUrl(config),
    fetchOptions: {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
      },
      body: form,
    },
    fallbackModel: config.imageGenerationModel || "gpt-image-2",
  });
}

async function requestImageProvider({ config = {}, fallbackModel, fetchOptions, signal, url }) {
  const controller = new AbortController();
  const timeoutMs = config.imageGenerationTimeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
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
      model: stringifyOptional(json?.model || fallbackModel),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("image provider request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  }
}

async function requestImagesGenerationProvider({ config = {}, normalized = {}, signal }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw imageApiError(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`, {
      status: 401,
      code: "missing_image_generation_api_key",
    });
  }

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
      body: JSON.stringify(imagesGenerationProviderBody({ config, normalized })),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      const message = stringifyContent(json?.error?.message || text || `image provider returned HTTP ${response.status}`);
      throw imageApiError(message, {
        status: response.status,
        code: json?.error?.code || "image_provider_error",
        type: json?.error?.type || "image_provider_error",
      });
    }
    return isPlainObject(json) ? json : {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw imageApiError("image provider request timed out", {
        status: 504,
        code: "image_provider_timeout",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  }
}

async function requestImagesGenerationProviderStream({ config = {}, normalized = {}, signal }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw imageApiError(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`, {
      status: 401,
      code: "missing_image_generation_api_key",
    });
  }

  const body = imagesGenerationProviderBody({ config, normalized });
  body.stream = true;
  if (normalized.partial_images_requested) body.partial_images = normalized.partial_images;

  return await requestImageProviderStream({
    config,
    expectedPrefix: "image_generation",
    fallbackEvents: (json) => imagesGenerationStreamEvents(normalizeImagesGenerationProviderResponse(json), normalized),
    fetchOptions: {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "accept": "text/event-stream, application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    signal,
    url: imageGenerationProviderUrl(config),
  });
}

async function requestImagesEditProvider({ config = {}, normalized = {}, signal }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw imageApiError(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`, {
      status: 401,
      code: "missing_image_generation_api_key",
    });
  }

  const controller = new AbortController();
  const timeoutMs = config.imageGenerationTimeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(imageGenerationEditProviderUrl(config), {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
      },
      body: imagesEditProviderForm({ config, normalized }),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      const message = stringifyContent(json?.error?.message || text || `image provider returned HTTP ${response.status}`);
      throw imageApiError(message, {
        status: response.status,
        code: json?.error?.code || "image_provider_error",
        type: json?.error?.type || "image_provider_error",
      });
    }
    return isPlainObject(json) ? json : {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw imageApiError("image provider request timed out", {
        status: 504,
        code: "image_provider_timeout",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  }
}

async function requestImagesEditProviderStream({ config = {}, normalized = {}, signal }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw imageApiError(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`, {
      status: 401,
      code: "missing_image_generation_api_key",
    });
  }

  const form = imagesEditProviderForm({ config, normalized });
  appendFormValue(form, "stream", true);
  if (normalized.partial_images_requested) appendFormValue(form, "partial_images", normalized.partial_images);

  return await requestImageProviderStream({
    config,
    expectedPrefix: "image_edit",
    fallbackEvents: (json) => imagesEditStreamEvents(normalizeImagesGenerationProviderResponse(json), normalized),
    fetchOptions: {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "accept": "text/event-stream, application/json",
      },
      body: form,
    },
    signal,
    url: imageGenerationEditProviderUrl(config),
  });
}

async function requestImagesVariationProvider({ config = {}, normalized = {}, signal }) {
  const apiKey = config.imageGenerationApiKey || "";
  if (!apiKey) {
    throw imageApiError(`${config.imageGenerationApiKeyEnv || "OPENAI_API_KEY"} is required for image generation provider calls`, {
      status: 401,
      code: "missing_image_generation_api_key",
    });
  }

  const controller = new AbortController();
  const timeoutMs = config.imageGenerationTimeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(imageGenerationVariationProviderUrl(config), {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
      },
      body: imagesVariationProviderForm({ config, normalized }),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      const message = stringifyContent(json?.error?.message || text || `image provider returned HTTP ${response.status}`);
      throw imageApiError(message, {
        status: response.status,
        code: json?.error?.code || "image_provider_error",
        type: json?.error?.type || "image_provider_error",
      });
    }
    return isPlainObject(json) ? json : {};
  } catch (error) {
    if (error?.name === "AbortError") {
      throw imageApiError("image provider request timed out", {
        status: 504,
        code: "image_provider_timeout",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  }
}

async function requestImageProviderStream({ config = {}, expectedPrefix, fallbackEvents, fetchOptions, signal, url }) {
  const controller = new AbortController();
  const timeoutMs = config.imageGenerationTimeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener?.("abort", abortFromCaller);
  };

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const text = await response.text();
      cleanup();
      const json = parseJson(text);
      const message = stringifyContent(json?.error?.message || text || `image provider returned HTTP ${response.status}`);
      throw imageApiError(message, {
        status: response.status,
        code: json?.error?.code || "image_provider_error",
        type: json?.error?.type || "image_provider_error",
      });
    }

    if (!/text\/event-stream/i.test(contentType)) {
      const text = await response.text();
      cleanup();
      const json = parseJson(text);
      if (!isPlainObject(json)) {
        throw imageApiError("streaming image provider did not return SSE or JSON", {
          status: 502,
          code: "invalid_image_provider_response",
          type: "image_provider_error",
        });
      }
      return fallbackEvents(json);
    }

    return relayImageProviderStream(response.body, expectedPrefix, cleanup);
  } catch (error) {
    cleanup();
    if (error?.name === "AbortError") {
      throw imageApiError("image provider request timed out", {
        status: 504,
        code: "image_provider_timeout",
      });
    }
    throw error;
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

function imagesGenerationProviderBody({ config = {}, normalized = {} }) {
  const body = {
    model: normalized.model || config.imageGenerationModel || "gpt-image-2",
    prompt: normalized.prompt,
    n: normalized.n,
  };
  for (const key of [
    "background",
    "moderation",
    "output_compression",
    "output_format",
    "quality",
    "response_format",
    "size",
    "style",
    "user",
  ]) {
    if (normalized.options[key] !== undefined) body[key] = normalized.options[key];
  }
  if (body.response_format === undefined && config.imageGenerationResponseFormat) {
    body.response_format = config.imageGenerationResponseFormat;
  }
  if (body.user === undefined && config.imageGenerationUser) body.user = stringifyContent(config.imageGenerationUser);
  return body;
}

function imageGenerationProviderEditForm({ config = {}, editInput = {}, prompt, tool = {} }) {
  const form = new FormData();
  appendFormValue(form, "model", config.imageGenerationModel || "gpt-image-2");
  appendFormValue(form, "prompt", prompt);
  appendFormValue(form, "n", 1);
  appendImageProviderFormOption(tool, form, "background");
  appendImageProviderFormOption(tool, form, "input_fidelity");
  appendImageProviderFormOption(tool, form, "moderation");
  appendImageProviderFormOption(tool, form, "output_compression");
  appendImageProviderFormOption(tool, form, "output_format");
  appendImageProviderFormOption(tool, form, "quality");
  appendImageProviderFormOption(tool, form, "size");
  if (config.imageGenerationResponseFormat) {
    appendFormValue(form, "response_format", config.imageGenerationResponseFormat);
  }
  if (config.imageGenerationUser) appendFormValue(form, "user", config.imageGenerationUser);
  for (const image of editInput.images || []) appendImageBlob(form, "image[]", image);
  if (editInput.mask) appendImageBlob(form, "mask", editInput.mask);
  return form;
}

function imagesEditProviderForm({ config = {}, normalized = {} }) {
  const form = new FormData();
  appendFormValue(form, "model", normalized.model || config.imageGenerationModel || "gpt-image-2");
  appendFormValue(form, "prompt", normalized.prompt);
  appendFormValue(form, "n", normalized.n || 1);
  for (const key of [
    "background",
    "input_fidelity",
    "moderation",
    "output_compression",
    "output_format",
    "quality",
    "response_format",
    "size",
    "user",
  ]) {
    if (normalized.options?.[key] !== undefined) appendFormValue(form, key, normalized.options[key]);
  }
  if (normalized.options?.response_format === undefined && config.imageGenerationResponseFormat) {
    appendFormValue(form, "response_format", config.imageGenerationResponseFormat);
  }
  if (normalized.options?.user === undefined && config.imageGenerationUser) appendFormValue(form, "user", config.imageGenerationUser);
  for (const image of normalized.editInput?.images || []) appendImageBlob(form, "image", image);
  if (normalized.editInput?.mask) appendImageBlob(form, "mask", normalized.editInput.mask);
  return form;
}

function imagesVariationProviderForm({ config = {}, normalized = {} }) {
  const form = new FormData();
  appendFormValue(form, "model", normalized.model || config.imageGenerationVariationModel || "dall-e-2");
  appendFormValue(form, "n", normalized.n || 1);
  for (const key of ["response_format", "size", "user"]) {
    if (normalized.options?.[key] !== undefined) appendFormValue(form, key, normalized.options[key]);
  }
  if (normalized.options?.response_format === undefined && config.imageGenerationResponseFormat) {
    appendFormValue(form, "response_format", config.imageGenerationResponseFormat);
  }
  if (normalized.options?.user === undefined && config.imageGenerationUser) appendFormValue(form, "user", config.imageGenerationUser);
  appendImageBlob(form, "image", normalized.image);
  return form;
}

function copyImageProviderOption(source, target, key) {
  if (source?.[key] !== undefined) target[key] = source[key];
}

function appendImageProviderFormOption(source, form, key) {
  if (source?.[key] !== undefined) appendFormValue(form, key, source[key]);
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, stringifyContent(value));
}

function appendImageBlob(form, key, image) {
  const mediaType = normalizeImageMediaType(image.media_type) || "application/octet-stream";
  form.append(key, new Blob([image.buffer], { type: mediaType }), image.filename || `${key}.png`);
}

function imageGenerationProviderUrl(config = {}) {
  const base = trimTrailingSlash(config.imageGenerationBaseUrl || DEFAULT_IMAGE_GENERATION_BASE_URL);
  const route = normalizeRoute(config.imageGenerationPath || DEFAULT_IMAGE_GENERATION_PATH);
  return `${base}${route}`;
}

function imageGenerationEditProviderUrl(config = {}) {
  const base = trimTrailingSlash(config.imageGenerationBaseUrl || DEFAULT_IMAGE_GENERATION_BASE_URL);
  const route = normalizeRoute(config.imageGenerationEditPath || DEFAULT_IMAGE_GENERATION_EDIT_PATH);
  return `${base}${route}`;
}

function imageGenerationVariationProviderUrl(config = {}) {
  const base = trimTrailingSlash(config.imageGenerationBaseUrl || DEFAULT_IMAGE_GENERATION_BASE_URL);
  const route = normalizeRoute(config.imageGenerationVariationPath || DEFAULT_IMAGE_GENERATION_VARIATION_PATH);
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

async function* relayImageProviderStream(stream, expectedPrefix, cleanup) {
  let sawEvent = false;
  try {
    for await (const frame of iterateImageProviderSse(stream)) {
      if (!frame || frame.data === "[DONE]") continue;
      const event = normalizeImageProviderStreamEvent(frame, expectedPrefix);
      if (!event) continue;
      sawEvent = true;
      yield event;
    }
    if (!sawEvent) {
      throw imageApiError("streaming image provider did not return image events", {
        status: 502,
        code: "invalid_image_provider_response",
        type: "image_provider_error",
      });
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw imageApiError("image provider request timed out", {
        status: 504,
        code: "image_provider_timeout",
      });
    }
    throw error;
  } finally {
    cleanup?.();
  }
}

async function* iterateImageProviderSse(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream || []) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = sseBoundaryIndex(buffer);
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const parsed = parseImageProviderSseFrame(frame);
      if (parsed) yield parsed;
      boundary = sseBoundaryIndex(buffer);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseImageProviderSseFrame(buffer);
    if (parsed) yield parsed;
  }
}

function sseBoundaryIndex(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseImageProviderSseFrame(frame) {
  const lines = String(frame || "").split(/\r?\n/);
  let event = "";
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  const dataText = dataLines.join("\n").trim();
  if (!dataText || dataText === "[DONE]") return { event, data: "[DONE]" };
  const data = parseJson(dataText);
  if (!isPlainObject(data)) return null;
  return { event, data };
}

function normalizeImageProviderStreamEvent(frame = {}, expectedPrefix) {
  const data = isPlainObject(frame.data) ? cloneJson(frame.data) : null;
  if (!data) return null;
  const type = stringifyContent(data.type || frame.event || "");
  if (!type.startsWith(`${expectedPrefix}.`)) return null;
  data.type = type;
  return {
    event: frame.event || type,
    data,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeImagesGenerationRequest(request = {}, config = {}) {
  if (!isPlainObject(request)) {
    throw imageApiError("image generation request body must be a JSON object", {
      code: "invalid_request_body",
    });
  }
  if (typeof request.prompt !== "string" || !request.prompt.trim()) {
    throw imageApiError("prompt is required", {
      code: "missing_required_parameter",
      param: "prompt",
    });
  }

  const n = normalizeImagesGenerationN(request.n);
  const partialImages = normalizeImageApiPartialImageCount(request.partial_images);
  const prompt = request.prompt.trim();
  const model = normalizeImageApiModel(request.model, config.imageGenerationModel || "gpt-image-2");
  const options = normalizeImagesGenerationOptions(request);
  const stream = normalizeImageApiJsonBoolean(request.stream);
  validateImagesGenerationModelConstraints({
    model,
    n,
    options,
    partialImagesRequested: request.partial_images !== undefined,
    prompt,
    stream,
  });

  return {
    model,
    prompt,
    n,
    options,
    stream,
    partial_images: partialImages,
    partial_images_requested: request.partial_images !== undefined,
    tool: {
      action: "generate",
      ...options,
      partial_images: partialImages,
      n,
    },
  };
}

async function normalizeImagesEditRequest(request = {}, config = {}, options = {}) {
  if (!isPlainObject(request)) {
    throw imageApiError("image edit request body must be an object", {
      code: "invalid_request_body",
    });
  }
  if (typeof request.prompt !== "string" || !request.prompt.trim()) {
    throw imageApiError("prompt is required", {
      code: "missing_required_parameter",
      param: "prompt",
    });
  }

  const n = normalizeImagesGenerationN(request.n);
  const partialImages = normalizeImageApiPartialImageCount(request.partial_images);
  const prompt = request.prompt.trim();
  const model = normalizeImageApiModel(request.model, config.imageGenerationModel || "gpt-image-2");
  const requestOptions = normalizeImagesEditOptions(request);
  const stream = normalizeImageApiFormBoolean(request.stream);
  const jsonRequest = isDirectJsonEditRequest(request);

  validateImagesEditModelConstraints({
    jsonRequest,
    model,
    options: requestOptions,
    partialImagesRequested: request.partial_images !== undefined,
    prompt,
    request,
  });

  const editInput = await resolveDirectImagesEditInput({ request, config, options });
  if (!editInput.images.length) {
    throw imageApiError(imageEditInputError(editInput).replace("image_generation action edit", "image edit"), {
      code: "missing_required_parameter",
      param: "image",
    });
  }
  if (editInput.mask_required && !editInput.mask) {
    throw imageApiError(imageEditMaskError(editInput).replace("image_generation input_image_mask", "image edit mask"), {
      code: "invalid_request_parameter",
      param: "mask",
    });
  }
  validateImagesEditModelConstraints({
    editInput,
    jsonRequest,
    model,
    options: requestOptions,
    partialImagesRequested: request.partial_images !== undefined,
    prompt,
    request,
  });

  return {
    model,
    prompt,
    n,
    options: requestOptions,
    stream,
    partial_images: partialImages,
    partial_images_requested: request.partial_images !== undefined,
    editInput,
    tool: {
      action: "edit",
      ...requestOptions,
      partial_images: partialImages,
      n,
    },
  };
}

async function normalizeImagesVariationRequest(request = {}, config = {}, options = {}) {
  if (!isPlainObject(request)) {
    throw imageApiError("image variation request body must be an object", {
      code: "invalid_request_body",
    });
  }

  const n = normalizeImagesGenerationN(request.n);
  const model = normalizeImageApiModel(request.model, config.imageGenerationVariationModel || "dall-e-2");
  validateImagesVariationModelConstraints(model);
  const requestOptions = normalizeImagesVariationOptions(request);

  const variationInputRequest = { ...request };
  delete variationInputRequest.mask;
  delete variationInputRequest.mask_file;
  const editInput = await resolveDirectImagesEditInput({
    request: variationInputRequest,
    config,
    options,
  });
  if (!editInput.images.length) {
    const message = editInput.errors?.length
      ? imageEditInputError(editInput).replace("image_generation edit", "image variation")
      : "image variation requires an image";
    throw imageApiError(message, {
      code: "missing_required_parameter",
      param: "image",
    });
  }
  validateImageVariationInput(editInput.images[0]);

  return {
    model,
    n,
    options: requestOptions,
    image: editInput.images[0],
    editInput,
    tool: {
      action: "variation",
      ...requestOptions,
      n,
    },
  };
}

function normalizeImagesGenerationN(value) {
  if (value === undefined || value === null || value === "") return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_IMAGES_GENERATION_N) {
    throw imageApiError("n must be an integer between 1 and 10", {
      code: "invalid_request_parameter",
      param: "n",
    });
  }
  return parsed;
}

function placeholderImagesGenerationResponse(normalized = {}, config = {}) {
  return {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: normalized.n }, (_unused, index) => ({
      b64_json: makePlaceholderImageBase64(`${normalized.prompt}\n[image ${index + 1}/${normalized.n}]`, normalized.tool, config),
      revised_prompt: revisedPromptFor(normalized.prompt, "generate"),
    })),
  };
}

function placeholderImagesEditResponse(normalized = {}, config = {}) {
  const imageCount = normalized.editInput?.images?.length || 0;
  const hasMask = !!normalized.editInput?.mask;
  return {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: normalized.n }, (_unused, index) => ({
      b64_json: makePlaceholderImageBase64([
        normalized.prompt,
        `[edit image ${index + 1}/${normalized.n}]`,
        `[input images: ${imageCount}; mask: ${hasMask ? "yes" : "no"}]`,
      ].join("\n"), normalized.tool, config),
      revised_prompt: revisedPromptFor(normalized.prompt, "edit"),
    })),
  };
}

function placeholderImagesVariationResponse(normalized = {}, config = {}) {
  const image = normalized.image || {};
  return {
    created: Math.floor(Date.now() / 1000),
    data: Array.from({ length: normalized.n }, (_unused, index) => ({
      b64_json: makePlaceholderImageBase64([
        "Create a variation of the supplied image.",
        `[variation image ${index + 1}/${normalized.n}]`,
        `[source: ${image.filename || image.source || "image"}; bytes: ${image.bytes || 0}]`,
      ].join("\n"), normalized.tool, config),
      revised_prompt: "Create a variation of the supplied image.",
    })),
  };
}

function normalizeImagesGenerationProviderResponse(json = {}) {
  const providerData = Array.isArray(json.data) ? json.data : [];
  if (!providerData.length) {
    throw imageApiError("image provider did not return data", {
      status: 502,
      code: "invalid_image_provider_response",
    });
  }

  const data = providerData.map((item, index) => {
    const b64 = item?.b64_json || item?.image_b64 || item?.result || "";
    const url = item?.url || "";
    if (!b64 && !url) {
      throw imageApiError(`image provider data[${index}] did not include b64_json or url`, {
        status: 502,
        code: "invalid_image_provider_response",
      });
    }
    return {
      ...(b64 ? { b64_json: stringifyContent(b64) } : {}),
      ...(url ? { url: stringifyContent(url) } : {}),
      ...(item?.revised_prompt ? { revised_prompt: stringifyContent(item.revised_prompt) } : {}),
    };
  });

  return {
    created: Number.isFinite(Number(json.created)) ? Number(json.created) : Math.floor(Date.now() / 1000),
    data,
    ...(isPlainObject(json.usage) ? { usage: cloneJson(json.usage) } : {}),
  };
}

function imageApiError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 400;
  error.code = details.code || "invalid_request_error";
  error.type = details.type || "invalid_request_error";
  error.param = details.param || null;
  return error;
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function stringifyOptional(value) {
  if (value == null) return "";
  return stringifyContent(value);
}

function emptyImageEditInput() {
  return { images: [], mask: null, mask_required: false, mask_error: null, errors: [] };
}

async function resolveDirectImagesEditInput({ request = {}, config = {}, options = {} }) {
  const maxBytes = Number(config.imageGenerationMaxInputImageBytes || DEFAULT_MAX_EDIT_IMAGE_BYTES);
  const resolveOptions = {
    config,
    fetch: options.fetch,
    fileStore: options.fileSearchStore || options.fileStore,
    imageStore: options.imageGenerationStore,
    maxBytes,
    signal: options.signal,
  };
  const editInput = emptyImageEditInput();

  for (const [index, file] of directEditImageFiles(request).entries()) {
    const image = directEditableFile(file, "image", index, maxBytes);
    if (image.status === "completed") editInput.images.push(image);
    else editInput.errors.push(image);
  }

  for (const [index, part] of directEditImageParts(request).entries()) {
    const image = await resolveEditableImagePart(part, resolveOptions, "image");
    if (image.status === "completed") editInput.images.push(image);
    else editInput.errors.push(image);
  }

  const maskFile = directEditMaskFile(request);
  if (maskFile) {
    editInput.mask_required = true;
    const mask = directEditableFile(maskFile, "mask", 0, maxBytes);
    if (mask.status === "completed") editInput.mask = mask;
    else {
      editInput.mask_error = mask;
      editInput.errors.push(mask);
    }
  } else if (directEditMaskRequested(request)) {
    editInput.mask_required = true;
    const mask = await resolveEditableImagePart(normalizeDirectEditPart(request.mask, "mask", 0), resolveOptions, "mask");
    if (mask.status === "completed") editInput.mask = mask;
    else {
      editInput.mask_error = mask;
      editInput.errors.push(mask);
    }
  }

  return editInput;
}

function directEditImageFiles(request = {}) {
  const files = Array.isArray(request.image_files) ? request.image_files : [];
  return files.filter(Boolean);
}

function directEditMaskFile(request = {}) {
  return request.mask_file || null;
}

function isDirectJsonEditRequest(request = {}) {
  return directEditImageFiles(request).length === 0
    && (request.images !== undefined || request.image !== undefined || request.image_url !== undefined);
}

function directEditImageParts(request = {}) {
  const parts = [];
  const add = (value) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    parts.push(value);
  };
  add(request.images);
  add(request.image);
  if (request.image_url !== undefined) {
    add({
      image_url: request.image_url,
      filename: request.filename,
      media_type: request.media_type || request.mime_type,
    });
  }
  return parts.map((part, index) => normalizeDirectEditPart(part, "image", index));
}

function directEditMaskRequested(request = {}) {
  return Object.prototype.hasOwnProperty.call(request, "mask")
    && request.mask !== undefined
    && request.mask !== null
    && request.mask !== "";
}

function normalizeDirectEditPart(part, role, index) {
  if (typeof part === "string") {
    const value = part.trim();
    if (/^file[-_]/i.test(value)) {
      return { file_id: value, filename: `${role}-${index + 1}.png` };
    }
    return { image_url: value, filename: `${role}-${index + 1}.png` };
  }
  if (isPlainObject(part)) {
    if (part.type === "image_url" && part.url && !part.image_url) {
      return { ...part, image_url: part.url };
    }
    return part;
  }
  return part;
}

function directEditableFile(file = {}, role, index, maxBytes) {
  const content = Buffer.isBuffer(file.buffer)
    ? file.buffer
    : Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content || "");
  return completedEditableImage({
    source: `multipart.${role}`,
    filename: file.filename || file.name || `${role}-${index + 1}.png`,
    media_type: file.media_type || file.mime_type || file.content_type,
    buffer: content,
    maxBytes,
  });
}

async function resolveImageEditInput({
  config = {},
  fetch,
  fileStore,
  imageStore,
  inputImages = [],
  priorImageCalls = [],
  signal,
  tool = {},
}) {
  const options = {
    config,
    fetch,
    fileStore,
    imageStore,
    maxBytes: Number(config.imageGenerationMaxInputImageBytes || DEFAULT_MAX_EDIT_IMAGE_BYTES),
    signal,
  };
  const editInput = emptyImageEditInput();
  for (const part of [...inputImages, ...priorImageCalls]) {
    const image = await resolveEditableImagePart(part, options, "image");
    if (image.status === "completed") editInput.images.push(image);
    else editInput.errors.push(image);
  }

  if (tool.input_image_mask) {
    editInput.mask_required = true;
    const mask = await resolveEditableImagePart(tool.input_image_mask, options, "mask");
    if (mask.status === "completed") editInput.mask = mask;
    else {
      editInput.mask_error = mask;
      editInput.errors.push(mask);
    }
  }

  return editInput;
}

async function resolveEditableImagePart(part, options = {}, role = "image") {
  if (!isPlainObject(part)) {
    return failedEditableImage({
      source: role,
      filename: `${role}.png`,
      error: `${role} input must be an object`,
    });
  }
  if (part.file_id) return resolveEditableImageFileId(part, options, role);

  const candidate = imageDataCandidate(part);
  if (!candidate) {
    if (part.type === "image_generation_call" && part.id) {
      return resolveEditableStoredImageGenerationCall(part, options, role);
    }
    return failedEditableImage({
      source: role,
      filename: filenameForImagePart(part, role),
      error: `${role} input requires file_id, data URL, base64 data, or http(s) image_url`,
    });
  }

  if (isRemoteImageUrl(candidate.value)) {
    return resolveEditableImageUrl(part, candidate, options, role);
  }

  const parsed = parseInlineImageData(candidate.value, imageMediaTypeHint(part));
  if (!parsed) {
    return failedEditableImage({
      source: candidate.source,
      filename: filenameForImagePart(part, role),
      error: `${role} inline image data is not valid base64`,
    });
  }

  return completedEditableImage({
    source: candidate.source,
    file_id: part.file_id,
    filename: filenameForImagePart(part, role, parsed.media_type),
    media_type: parsed.media_type || imageMediaTypeHint(part),
    buffer: parsed.buffer,
    maxBytes: options.maxBytes,
  });
}

function resolveEditableImageFileId(part, options = {}, role = "image") {
  const file = options.fileStore?.getFile?.(part.file_id);
  const buffer = options.fileStore?.getFileContentBuffer?.(part.file_id);
  const filename = filenameForImagePart(part, role, imageMediaTypeHint(part) || file?.mime_type || file?.metadata?.mime_type, file?.filename);
  const mediaType = imageMediaTypeHint(part)
    || normalizeImageMediaType(file?.mime_type || file?.metadata?.mime_type)
    || guessImageMediaType(filename)
    || sniffImageMediaType(buffer);

  if (!file || !buffer) {
    return failedEditableImage({
      source: "file_id",
      file_id: part.file_id,
      filename,
      media_type: mediaType,
      error: `file not found: ${part.file_id}`,
    });
  }

  return completedEditableImage({
    source: "file_id",
    file_id: part.file_id,
    filename,
    media_type: mediaType,
    buffer,
    maxBytes: options.maxBytes,
  });
}

function resolveEditableStoredImageGenerationCall(part, options = {}, role = "image") {
  const record = storedImageGenerationRecord(part.id, options.imageStore);
  if (!record) {
    return failedEditableImage({
      source: "image_generation_call.id",
      call_id: part.id,
      filename: filenameForImagePart(part, role),
      error: `image_generation_call not found: ${part.id}`,
    });
  }

  const content = record.content_base64 || record.result_b64 || record.b64_json || record.result;
  const parsed = parseInlineImageData(content, imageMediaTypeHint(part) || record.media_type);
  if (!parsed) {
    return failedEditableImage({
      source: "image_generation_call.id",
      call_id: part.id,
      filename: storedImageGenerationFilename(part, record, role),
      media_type: imageMediaTypeHint(part) || record.media_type,
      error: `stored image_generation_call has invalid image data: ${part.id}`,
    });
  }

  return completedEditableImage({
    source: "image_generation_call.id",
    call_id: part.id,
    filename: storedImageGenerationFilename(part, record, role),
    media_type: parsed.media_type || imageMediaTypeHint(part) || record.media_type,
    buffer: parsed.buffer,
    maxBytes: options.maxBytes,
  });
}

async function resolveEditableImageUrl(part, candidate, options = {}, role = "image") {
  let url;
  try {
    url = new URL(candidate.value);
  } catch {
    return failedEditableImage({
      source: candidate.source,
      filename: filenameForImagePart(part, role),
      error: `${role} image_url is invalid`,
    });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return failedEditableImage({
      source: candidate.source,
      filename: filenameForImagePart(part, role),
      error: `${role} image_url must use http or https`,
    });
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), Number(options.config?.imageGenerationInputFetchTimeoutMs || DEFAULT_REMOTE_IMAGE_TIMEOUT_MS));
  try {
    const response = await (options.fetch || globalThis.fetch)(String(url), {
      headers: { "accept": "image/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      throw new Error(`image_url exceeds local limit of ${options.maxBytes} bytes`);
    }
    const { buffer, truncated } = await readResponseLimited(response, options.maxBytes);
    if (truncated) throw new Error(`image_url exceeds local limit of ${options.maxBytes} bytes`);
    return completedEditableImage({
      source: candidate.source,
      filename: filenameForImagePart(part, role, response.headers.get("content-type"), filenameFromUrl(String(url))),
      media_type: imageMediaTypeHint(part)
        || normalizeImageMediaType(response.headers.get("content-type"))
        || guessImageMediaType(String(url))
        || sniffImageMediaType(buffer),
      buffer,
      maxBytes: options.maxBytes,
    });
  } catch (error) {
    return failedEditableImage({
      source: candidate.source,
      filename: filenameForImagePart(part, role, imageMediaTypeHint(part), filenameFromUrl(String(url))),
      error: error.name === "AbortError" ? `${role} image_url fetch timed out` : error.message,
    });
  } finally {
    options.signal?.removeEventListener?.("abort", abortFromParent);
    clearTimeout(timeout);
  }
}

function completedEditableImage({ source, file_id, call_id, filename, media_type, buffer, maxBytes }) {
  const mediaType = normalizeImageMediaType(media_type) || sniffImageMediaType(buffer);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return failedEditableImage({ source, file_id, call_id, filename, media_type: mediaType, error: "image input is empty" });
  }
  if (buffer.length > maxBytes) {
    return failedEditableImage({
      source,
      file_id,
      call_id,
      filename,
      media_type: mediaType,
      bytes: buffer.length,
      error: `image input exceeds local limit of ${maxBytes} bytes`,
    });
  }
  if (!mediaType) {
    return failedEditableImage({
      source,
      file_id,
      call_id,
      filename,
      bytes: buffer.length,
      error: "image input requires an image media type",
    });
  }
  return {
    source,
    file_id,
    ...(call_id ? { call_id } : {}),
    filename: safeImageFilename(filename, mediaType, "image"),
    media_type: mediaType,
    bytes: buffer.length,
    status: "completed",
    buffer,
  };
}

function validateImageVariationInput(image = {}) {
  if (image.media_type !== "image/png") {
    throw imageApiError("image must be a PNG file for image variations", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
  if (!Buffer.isBuffer(image.buffer) || !image.buffer.length) {
    throw imageApiError("image must be a valid PNG file for image variations", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
  if (image.buffer.length > MAX_IMAGE_VARIATION_BYTES) {
    throw imageApiError("image must be less than 4MB for image variations", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
  const dimensions = pngDimensions(image.buffer);
  if (!dimensions) {
    throw imageApiError("image must be a valid PNG file for image variations", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
  if (dimensions.width !== dimensions.height) {
    throw imageApiError("image must be square for image variations", {
      code: "invalid_request_parameter",
      param: "image",
    });
  }
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function failedEditableImage({ source, file_id, call_id, filename, media_type, bytes, error }) {
  return {
    source,
    ...(file_id ? { file_id } : {}),
    ...(call_id ? { call_id } : {}),
    filename,
    ...(media_type ? { media_type: normalizeImageMediaType(media_type) || stringifyContent(media_type) } : {}),
    ...(bytes ? { bytes } : {}),
    status: "failed",
    error,
  };
}

function imageDataCandidate(part) {
  if (part.type === "image_generation_call" && part.result) {
    return { source: "image_generation_call.result", value: part.result };
  }
  const imageUrl = isPlainObject(part.image_url) ? part.image_url.url : part.image_url;
  if (typeof imageUrl === "string" && imageUrl) return { source: "image_url", value: imageUrl };
  if (typeof part.url === "string" && part.url) return { source: "url", value: part.url };
  for (const key of ["file_data", "data", "image_data", "b64_json", "result"]) {
    if (typeof part[key] === "string" && part[key]) return { source: key, value: part[key] };
  }
  return null;
}

function parseInlineImageData(value, mediaHint = "") {
  const text = String(value || "").trim();
  const match = text.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is);
  if (match) {
    const buffer = decodeBase64(match[2]);
    if (!buffer) return null;
    return {
      buffer,
      media_type: normalizeImageMediaType(match[1]) || normalizeImageMediaType(mediaHint) || sniffImageMediaType(buffer),
    };
  }

  const buffer = decodeBase64(text);
  if (!buffer) return null;
  return {
    buffer,
    media_type: normalizeImageMediaType(mediaHint) || sniffImageMediaType(buffer),
  };
}

function decodeBase64(value) {
  const normalized = String(value || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const buffer = Buffer.from(padded, "base64");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function isRemoteImageUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function readResponseLimited(response, maxBytes) {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer: buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer,
      truncated: buffer.length > maxBytes,
    };
  }
  const chunks = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    if (size + buffer.length > maxBytes) {
      const remaining = Math.max(0, maxBytes - size);
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining));
        size += remaining;
      }
      truncated = true;
      break;
    }
    size += buffer.length;
    chunks.push(buffer);
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function imageMediaTypeHint(part) {
  return normalizeImageMediaType(part?.media_type || part?.mime_type || part?.type_hint || "");
}

function normalizeImageMediaType(value) {
  const mediaType = String(value || "").split(";")[0].trim().toLowerCase();
  if (!mediaType.startsWith("image/")) return "";
  if (mediaType === "image/jpg") return "image/jpeg";
  return mediaType;
}

function guessImageMediaType(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "";
}

function sniffImageMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

function filenameForImagePart(part, role, mediaType = "", fallback = "") {
  const fromImageUrl = isPlainObject(part?.image_url) ? part.image_url.url : part?.image_url;
  return safeImageFilename(
    part?.filename || part?.name || fallback || filenameFromUrl(fromImageUrl || part?.url) || part?.file_id || `${role}.png`,
    mediaType || imageMediaTypeHint(part) || guessImageMediaType(fallback || fromImageUrl || part?.url),
    role,
  );
}

function filenameFromUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname || "");
    return pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function safeImageFilename(filename, mediaType = "", fallback = "image") {
  const ext = imageExtension(mediaType);
  let name = String(filename || "").split(/[\\/]/).pop().trim();
  if (!name) name = `${fallback}${ext || ".png"}`;
  name = name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 160);
  if (!pathHasExtension(name) && ext) name += ext;
  return name || `${fallback}${ext || ".png"}`;
}

function pathHasExtension(filename) {
  return /\.[A-Za-z0-9]{1,8}$/.test(String(filename || ""));
}

function imageExtension(mediaType) {
  const normalized = normalizeImageMediaType(mediaType);
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return "";
}

function imageEditInputError(editInput) {
  if (!editInput?.errors?.length) {
    return "image_generation action edit requires at least one input image in context";
  }
  const first = editInput.errors.find((error) => error.error)?.error;
  return `image_generation edit requires at least one resolved input image${first ? ` (${first})` : ""}`;
}

function imageEditMaskError(editInput) {
  const detail = editInput?.mask_error?.error;
  return `image_generation input_image_mask could not be resolved${detail ? ` (${detail})` : ""}`;
}

function imageResolutionErrorSummary(error) {
  return {
    source: error.source || "input",
    ...(error.file_id ? { file_id: error.file_id } : {}),
    ...(error.call_id ? { call_id: error.call_id } : {}),
    ...(error.filename ? { filename: error.filename } : {}),
    ...(error.media_type ? { media_type: error.media_type } : {}),
    ...(error.bytes ? { bytes: error.bytes } : {}),
    error: error.error || "failed",
  };
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

function mergeImageGenerationCalls(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      if (!isPlainObject(item)) continue;
      const id = item.id ? stringifyContent(item.id) : "";
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      merged.push(item);
    }
  }
  return merged;
}

function storedImageGenerationRecord(id, imageStore) {
  if (!id || typeof imageStore?.get !== "function") return null;
  const record = imageStore.get(id);
  if (!isPlainObject(record)) return null;
  const content = record.content_base64 || record.result_b64 || record.b64_json || record.result;
  if (record.status && record.status !== "completed") return null;
  if (typeof content !== "string" || !content.trim()) return null;
  return record;
}

function countStoredImageGenerationCalls(calls = [], imageStore) {
  return calls.filter((call) => call?.id && storedImageGenerationRecord(call.id, imageStore)).length;
}

function persistImageGenerationCall(call, context, tool = {}, config = {}, imageStore) {
  if (!call?.id || call.status !== "completed" || !call.result || typeof imageStore?.put !== "function") {
    return { stored: false };
  }
  const parsed = parseInlineImageData(call.result, imageOutputMediaType(tool) || "image/png");
  if (!parsed) return { stored: false, error: "completed image_generation_call result is not valid base64" };
  const maxBytes = Number(config.imageGenerationMaxStoredImageBytes || DEFAULT_MAX_STORED_IMAGE_BYTES);
  if (Number.isFinite(maxBytes) && parsed.buffer.length > maxBytes) {
    return { stored: false, error: `completed image_generation_call result exceeds local store limit of ${maxBytes} bytes` };
  }

  const mediaType = parsed.media_type || imageOutputMediaType(tool) || sniffImageMediaType(parsed.buffer) || "image/png";
  const filename = safeImageFilename(`${call.id}${imageExtension(mediaType) || ".png"}`, mediaType, call.id);
  try {
    imageStore.put(call.id, {
      status: call.status,
      provider: context.provider || "placeholder",
      action: context.action || "auto",
      mode: context.mode || "generate",
      model: context.model || config.imageGenerationModel || "",
      revised_prompt: call.revised_prompt || "",
      media_type: mediaType,
      filename,
      bytes: parsed.buffer.length,
      content_base64: parsed.buffer.toString("base64"),
      created_at_unix: Math.floor(Date.now() / 1000),
    });
    return { stored: true, bytes: parsed.buffer.length, media_type: mediaType };
  } catch (error) {
    return { stored: false, error: error.message || "failed to store image_generation_call result" };
  }
}

function imageOutputMediaType(tool = {}) {
  const format = String(tool.output_format || "").trim().toLowerCase();
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "png") return "image/png";
  return "";
}

function storedImageGenerationFilename(part, record, role) {
  const mediaType = imageMediaTypeHint(part) || record?.media_type || "";
  return safeImageFilename(
    part?.filename || part?.name || record?.filename || `${part?.id || role}${imageExtension(mediaType) || ".png"}`,
    mediaType,
    role,
  );
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
  createImagesEditEventStream,
  createImagesEditResponse,
  createImagesGenerationEventStream,
  createImagesGenerationResponse,
  createImagesVariationResponse,
  imageGenerationCompatibility,
  imageGenerationOutputItems,
  imageGenerationPartialImages,
  imagesEditStreamEvents,
  imagesGenerationStreamEvents,
  injectImageGenerationMessages,
  isImageGenerationTool,
  localImageGenerationToolTypes,
  prepareImageGenerationContext,
};
