"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stringifyContent } = require("./translator");

function hasInputFiles(input) {
  return collectInputFileParts(input).length > 0;
}

async function prepareInputFileContext(request = {}, config = {}, fileStore, options = {}) {
  const parts = collectInputFileParts(request.input);
  if (!parts.length || String(config.inputFileProvider || "local").toLowerCase() === "disabled") return null;

  const context = {
    provider: "local",
    status: "completed",
    files: [],
  };

  const maxFiles = Math.max(1, Math.min(Number(config.inputFileMaxFiles || 8), 32));
  for (const part of parts.slice(0, maxFiles)) {
    context.files.push(await resolveInputFile(part, config, fileStore, options));
  }

  const resolved = context.files.filter((file) => file.status === "completed");
  const failed = context.files.filter((file) => file.status !== "completed");
  context.status = failed.length && resolved.length ? "partial" : failed.length ? "failed" : "completed";
  return context;
}

function injectInputFileMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: inputFilePrompt(context),
  });
}

function inputFileCompatibility(context) {
  if (!context) return {};
  return {
    local_input_files: {
      provider: context.provider || "local",
      status: context.status || "completed",
      file_count: context.files?.length || 0,
      resolved_count: context.files?.filter((file) => file.status === "completed").length || 0,
      failed_count: context.files?.filter((file) => file.status !== "completed").length || 0,
      truncated_count: context.files?.filter((file) => file.truncated).length || 0,
      pdf_extracted_count: context.files?.filter((file) => file.extraction_method === "pdftotext").length || 0,
    },
  };
}

function inputFilePrompt(context) {
  const files = context.files || [];
  if (!files.length) {
    return "Local Responses input_file compatibility found no file inputs.";
  }

  const sections = files.map((file, index) => {
    const header = [
      `[${index + 1}] ${file.filename || "input-file"}`,
      `source: ${file.source}`,
      file.file_id ? `file_id: ${file.file_id}` : null,
      file.file_url ? `file_url: ${file.file_url}` : null,
      file.media_type ? `media_type: ${file.media_type}` : null,
      file.extraction_method ? `extraction_method: ${file.extraction_method}` : null,
      `bytes: ${file.bytes || 0}`,
      `status: ${file.status}`,
      file.truncated ? "truncated: true" : null,
      file.error ? `error: ${file.error}` : null,
    ].filter(Boolean).join("\n");

    if (file.status !== "completed") return header;
    return `${header}\ncontent:\n${file.content || ""}`;
  });

  return [
    "Local Responses input_file compatibility extracted file inputs follow.",
    "Use this extracted content as if it was provided through Responses input_file items.",
    "For binary or unsupported files, do not invent contents beyond the metadata shown here.",
    ...sections,
  ].join("\n\n");
}

async function resolveInputFile(part, config = {}, fileStore, options = {}) {
  if (part.file_id) return resolveFileId(part, config, fileStore);
  if (part.file_data) return resolveFileData(part, config);
  if (part.file_url) return resolveFileUrl(part, config, options);
  return {
    source: "unknown",
    filename: part.filename || "input-file",
    status: "failed",
    error: "input_file requires file_id, file_data, or file_url",
  };
}

function resolveFileId(part, config = {}, fileStore) {
  const file = fileStore?.getFile?.(part.file_id);
  const content = fileStore?.getFileContent?.(part.file_id);
  if (!file || content == null) {
    return {
      source: "file_id",
      file_id: part.file_id,
      filename: part.filename || part.file_id,
      status: "failed",
      error: `file not found: ${part.file_id}`,
    };
  }
  return fileRecordToInputFile({
    source: "file_id",
    file_id: part.file_id,
    filename: part.filename || file.filename,
    media_type: part.media_type || file.mime_type || guessMediaType(file.filename),
    buffer: Buffer.from(content, "utf8"),
    config,
  });
}

function resolveFileData(part, config = {}) {
  const parsed = parseFileData(part.file_data);
  if (!parsed) {
    return {
      source: "file_data",
      filename: part.filename || "inline-file",
      status: "failed",
      error: "file_data is not valid base64",
    };
  }
  return fileRecordToInputFile({
    source: "file_data",
    filename: part.filename || "inline-file",
    media_type: part.media_type || parsed.media_type || guessMediaType(part.filename),
    buffer: parsed.buffer,
    config,
  });
}

async function resolveFileUrl(part, config = {}, options = {}) {
  if (!config.inputFileFetchUrls) {
    return {
      source: "file_url",
      file_url: part.file_url,
      filename: part.filename || filenameFromUrl(part.file_url),
      status: "failed",
      error: "file_url fetching is disabled",
    };
  }

  let url;
  try {
    url = new URL(part.file_url);
  } catch {
    return {
      source: "file_url",
      file_url: part.file_url,
      filename: part.filename || "remote-file",
      status: "failed",
      error: "file_url is invalid",
    };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return {
      source: "file_url",
      file_url: part.file_url,
      filename: part.filename || filenameFromUrl(part.file_url),
      status: "failed",
      error: "file_url must use http or https",
    };
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.inputFileFetchTimeoutMs || 10000);
  try {
    const response = await (options.fetch || globalThis.fetch)(url, {
      headers: { "accept": "*/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await readResponseLimited(response, config.inputFileMaxBytes || 4 * 1024 * 1024));
    return fileRecordToInputFile({
      source: "file_url",
      file_url: String(url),
      filename: part.filename || filenameFromUrl(String(url)),
      media_type: part.media_type || response.headers.get("content-type") || guessMediaType(String(url)),
      buffer,
      config,
    });
  } catch (error) {
    return {
      source: "file_url",
      file_url: String(url),
      filename: part.filename || filenameFromUrl(String(url)),
      status: "failed",
      error: error.name === "AbortError" ? "file_url fetch timed out" : error.message,
    };
  } finally {
    options.signal?.removeEventListener?.("abort", abortFromParent);
    clearTimeout(timeout);
  }
}

async function readResponseLimited(response, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const error = new Error(`file_url exceeds local limit of ${maxBytes} bytes`);
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function fileRecordToInputFile({ source, file_id, file_url, filename, media_type, buffer, config }) {
  const maxBytes = config.inputFileMaxBytes || 4 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return {
      source,
      file_id,
      file_url,
      filename,
      media_type,
      bytes: buffer.length,
      status: "failed",
      error: `input_file exceeds local limit of ${maxBytes} bytes`,
    };
  }

  const extracted = extractText(buffer, filename, media_type, config);
  return {
    source,
    file_id,
    file_url,
    filename: filename || "input-file",
    media_type: media_type || guessMediaType(filename),
    bytes: buffer.length,
    status: extracted.content ? "completed" : "failed",
    content: extracted.content,
    truncated: extracted.truncated,
    ...(extracted.method ? { extraction_method: extracted.method } : {}),
    ...(extracted.error ? { error: extracted.error } : {}),
  };
}

function extractText(buffer, filename, mediaType, config = {}) {
  const media = String(mediaType || "").toLowerCase();
  const extension = path.extname(String(filename || "")).toLowerCase();
  if (isPdfFile(media, extension, buffer)) {
    return extractPdfText(buffer, config);
  }
  if (!isTextLike(media, extension, buffer)) {
    return {
      content: "",
      truncated: false,
      error: `local extraction for ${extension || media || "binary file"} is not implemented`,
    };
  }

  let text = buffer.toString("utf8").replace(/\u0000/g, "");
  const maxChars = config.inputFileMaxTextChars || 200000;
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  return { content: text, truncated, method: "utf8_text" };
}

function extractPdfText(buffer, config = {}) {
  const extractor = String(config.inputFilePdfExtractor || "pdftotext").toLowerCase();
  if (extractor === "disabled" || extractor === "none") {
    return {
      content: "",
      truncated: false,
      error: "local PDF extraction is disabled",
    };
  }
  if (extractor !== "pdftotext") {
    return {
      content: "",
      truncated: false,
      error: `unsupported local PDF extractor: ${extractor}`,
    };
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-codex-input-pdf-"));
  const inputPath = path.join(workDir, "input.pdf");
  try {
    fs.writeFileSync(inputPath, buffer, { mode: 0o600 });
    const result = childProcess.spawnSync("pdftotext", [
      "-enc", "UTF-8",
      "-layout",
      "-q",
      inputPath,
      "-",
    ], {
      encoding: "utf8",
      maxBuffer: Math.max(1024, Number(config.inputFileMaxTextChars || 200000) * 4),
      timeout: Math.max(1000, Number(config.inputFilePdfTimeoutMs || 10000)),
      windowsHide: true,
    });

    if (result.error) {
      return {
        content: "",
        truncated: false,
        error: result.error.code === "ENOENT"
          ? "pdftotext is not installed"
          : `pdftotext failed: ${result.error.message}`,
      };
    }
    if (result.status !== 0) {
      return {
        content: "",
        truncated: false,
        error: `pdftotext exited with status ${result.status}${result.stderr ? `: ${String(result.stderr).trim()}` : ""}`,
      };
    }

    let text = String(result.stdout || "").replace(/\u0000/g, "").trim();
    const maxChars = config.inputFileMaxTextChars || 200000;
    const truncated = text.length > maxChars;
    if (truncated) text = text.slice(0, maxChars);
    if (!text) {
      return {
        content: "",
        truncated: false,
        error: "pdftotext returned no extractable text",
      };
    }
    return { content: text, truncated, method: "pdftotext" };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of temporary PDF extraction files.
    }
  }
}

function isPdfFile(mediaType, extension, buffer) {
  return mediaType.split(";")[0].trim() === "application/pdf"
    || extension === ".pdf"
    || buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isTextLike(mediaType, extension, buffer) {
  if (mediaType.startsWith("text/")) return true;
  if ([
    "application/json",
    "application/javascript",
    "application/typescript",
    "application/xml",
    "application/x-ndjson",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
  ].includes(mediaType)) return true;
  if ([
    ".txt", ".md", ".markdown", ".json", ".jsonl", ".ndjson", ".js", ".mjs", ".cjs",
    ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".csv", ".tsv", ".py", ".rb",
    ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
    ".sh", ".bash", ".zsh", ".sql", ".yaml", ".yml", ".toml", ".ini", ".log",
  ].includes(extension)) return true;
  return printableRatio(buffer.subarray(0, Math.min(buffer.length, 4096))) > 0.8;
}

function printableRatio(buffer) {
  if (!buffer.length) return 1;
  let printable = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) printable += 1;
  }
  return printable / buffer.length;
}

function parseFileData(value) {
  const text = stringifyContent(value).trim();
  const dataUrl = text.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
  const mediaType = dataUrl?.[1] || "";
  const body = (dataUrl ? dataUrl[2] : text).replace(/\s+/g, "");
  if (!body || body.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  const buffer = Buffer.from(body, "base64");
  if (buffer.toString("base64").replace(/=+$/, "") !== body.replace(/=+$/, "")) return null;
  return {
    media_type: mediaType,
    buffer,
  };
}

function collectInputFileParts(input) {
  const parts = [];
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    if (value.type === "input_file") parts.push(value);
    if (Array.isArray(value.content)) visit(value.content);
  };
  visit(input);
  return parts;
}

function filenameFromUrl(value) {
  try {
    const url = new URL(value);
    return path.basename(decodeURIComponent(url.pathname)) || "remote-file";
  } catch {
    return "remote-file";
  }
}

function guessMediaType(filename = "") {
  const extension = path.extname(String(filename || "")).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".csv") return "text/csv";
  if (extension === ".tsv") return "text/tsv";
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".xml") return "text/xml";
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "text/javascript";
  if (extension === ".ts" || extension === ".tsx") return "text/x-typescript";
  if (extension === ".py") return "text/x-python";
  if (extension === ".pdf") return "application/pdf";
  return extension ? "text/plain" : "";
}

module.exports = {
  hasInputFiles,
  injectInputFileMessages,
  inputFileCompatibility,
  prepareInputFileContext,
};
