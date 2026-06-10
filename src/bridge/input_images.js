"use strict";

function prepareInputImageContext(request = {}, config = {}, fileStore) {
  if (String(config.inputImageProvider || "local").toLowerCase() === "disabled") return null;
  const maxImages = Math.max(1, Math.min(Number(config.inputImageMaxImages || 32), 1500));
  const state = {
    provider: "local",
    images: [],
    resolved: 0,
    total: 0,
    maxImages,
    maxBytes: Number(config.inputImageMaxBytes || config.inputFileMaxBytes || 4 * 1024 * 1024),
  };
  const input = rewriteInput(request.input, (part) => resolveImagePart(part, fileStore, state));
  if (!state.total) return null;

  const failed = state.images.filter((image) => image.status !== "completed");
  const resolved = state.images.filter((image) => image.status === "completed");
  return {
    provider: "local",
    status: failed.length && resolved.length ? "partial" : failed.length ? "failed" : "completed",
    images: state.images,
    request: {
      ...request,
      input,
    },
  };
}

function inputImageCompatibility(context) {
  if (!context) return {};
  return {
    local_input_images: {
      provider: context.provider || "local",
      status: context.status || "completed",
      image_count: context.images?.length || 0,
      resolved_count: context.images?.filter((image) => image.status === "completed").length || 0,
      failed_count: context.images?.filter((image) => image.status !== "completed").length || 0,
      total_bytes: context.images
        ?.filter((image) => image.status === "completed")
        .reduce((sum, image) => sum + (Number(image.bytes) || 0), 0) || 0,
      files: (context.images || []).map((image) => ({
        file_id: image.file_id,
        filename: image.filename,
        media_type: image.media_type,
        bytes: image.bytes || 0,
        status: image.status,
        ...(image.error ? { error: image.error } : {}),
      })),
    },
  };
}

function rewriteInput(input, resolvePart) {
  if (Array.isArray(input)) return input.map((item) => rewriteInputItem(item, resolvePart));
  return rewriteInputItem(input, resolvePart);
}

function rewriteInputItem(item, resolvePart) {
  if (!isPlainObject(item)) return item;
  if (isInputImagePart(item)) return resolvePart(item);
  if (!Array.isArray(item.content)) return clone(item);
  return {
    ...item,
    content: item.content.map((part) => isInputImagePart(part) ? resolvePart(part) : clone(part)),
  };
}

function resolveImagePart(part, fileStore, state) {
  if (!shouldResolveImageFile(part)) return clone(part);
  state.total += 1;
  if (state.images.length >= state.maxImages) {
    state.images.push({
      file_id: part.file_id,
      filename: part.filename || part.file_id,
      status: "failed",
      error: `input_image file_id resolution exceeded local limit of ${state.maxImages} images`,
    });
    return clone(part);
  }

  const resolved = resolveFileImage(part, fileStore, state.maxBytes);
  state.images.push(withoutDataUrl(resolved));
  if (resolved.status !== "completed") return clone(part);
  return {
    ...clone(part),
    image_url: resolved.image_url,
    media_type: resolved.media_type,
    filename: resolved.filename,
  };
}

function resolveFileImage(part, fileStore, maxBytes) {
  const file = fileStore?.getFile?.(part.file_id);
  const buffer = fileStore?.getFileContentBuffer?.(part.file_id);
  const filename = part.filename || file?.filename || part.file_id;
  const mediaType = normalizeImageMediaType(
    part.media_type
      || part.mime_type
      || file?.mime_type
      || file?.metadata?.mime_type
      || guessImageMediaType(filename),
  );

  if (!file || !buffer) {
    return {
      file_id: part.file_id,
      filename,
      media_type: mediaType,
      status: "failed",
      error: `file not found: ${part.file_id}`,
    };
  }
  if (!mediaType) {
    return {
      file_id: part.file_id,
      filename,
      bytes: buffer.length,
      status: "failed",
      error: "input_image file_id requires an image media type",
    };
  }
  if (buffer.length > maxBytes) {
    return {
      file_id: part.file_id,
      filename,
      media_type: mediaType,
      bytes: buffer.length,
      status: "failed",
      error: `input_image exceeds local limit of ${maxBytes} bytes`,
    };
  }

  return {
    file_id: part.file_id,
    filename,
    media_type: mediaType,
    bytes: buffer.length,
    status: "completed",
    image_url: `data:${mediaType};base64,${buffer.toString("base64")}`,
  };
}

function shouldResolveImageFile(part) {
  if (!isInputImagePart(part) || !part.file_id) return false;
  if (typeof part.url === "string" && part.url) return false;
  if (typeof part.image_url === "string" && part.image_url) return false;
  if (isPlainObject(part.image_url) && typeof part.image_url.url === "string" && part.image_url.url) return false;
  return part.file_data == null && part.data == null && part.image_data == null;
}

function isInputImagePart(part) {
  return isPlainObject(part) && (part.type === "input_image" || part.type === "image_url");
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

function withoutDataUrl(image) {
  const copy = { ...image };
  delete copy.image_url;
  return copy;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  inputImageCompatibility,
  prepareInputImageContext,
};
