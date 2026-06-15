"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { stringifyContent } = require("./translator");

const SPREADSHEET_ROW_LIMIT = 1000;

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
      office_extracted_count: context.files?.filter((file) => String(file.extraction_method || "").startsWith("ooxml_")).length || 0,
      spreadsheet_extracted_count: context.files?.filter((file) => isSpreadsheetExtractionMethod(file.extraction_method)).length || 0,
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
  const fallbackContent = fileStore?.getFileContent?.(part.file_id);
  const buffer = fileStore?.getFileContentBuffer?.(part.file_id)
    || (fallbackContent != null
      ? Buffer.from(fallbackContent, "utf8")
      : null);
  if (!file || buffer == null) {
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
    media_type: part.media_type || file.mime_type || file.metadata?.mime_type || guessMediaType(file.filename),
    buffer,
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
    const { buffer, truncated } = await readResponseLimited(response, config.inputFileMaxBytes || 4 * 1024 * 1024);
    return fileRecordToInputFile({
      source: "file_url",
      file_url: String(url),
      filename: part.filename || filenameFromUrl(String(url)),
      media_type: part.media_type || response.headers.get("content-type") || guessMediaType(String(url)),
      buffer,
      config,
      truncated,
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

function fileRecordToInputFile({ source, file_id, file_url, filename, media_type, buffer, config, truncated = false }) {
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
    truncated: Boolean(truncated || extracted.truncated),
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
  if (isOfficeFile(media, extension)) {
    return extractOfficeText(buffer, extension, media, config);
  }
  if (isDelimitedSpreadsheetFile(media, extension)) {
    return extractDelimitedSpreadsheetText(buffer, extension, media, config);
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

function extractOfficeText(buffer, extension, mediaType, config = {}) {
  const kind = officeKind(extension, mediaType);
  if (!kind) {
    return {
      content: "",
      truncated: false,
      error: "local Office extraction is not configured for this file type",
    };
  }

  let zip;
  try {
    zip = readZipEntries(buffer, {
      maxEntries: 2000,
      maxInflatedBytes: Math.min(
        Math.max(Number(config.inputFileMaxTextChars || 200000) * 8, 1024 * 1024),
        16 * 1024 * 1024,
      ),
    });
  } catch (error) {
    return {
      content: "",
      truncated: false,
      error: `local Office extraction failed: ${error.message}`,
    };
  }

  let text = "";
  let spreadsheetTruncated = false;
  try {
    if (kind === "docx") text = extractDocxText(zip);
    else if (kind === "xlsx") {
      const spreadsheet = extractXlsxText(zip, config);
      text = spreadsheet.content;
      spreadsheetTruncated = spreadsheet.truncated;
    }
    else if (kind === "pptx") text = extractPptxText(zip);
  } catch (error) {
    return {
      content: "",
      truncated: false,
      error: `local Office extraction failed: ${error.message}`,
    };
  }

  text = text.replace(/\u0000/g, "").trim();
  const maxChars = config.inputFileMaxTextChars || 200000;
  const truncated = spreadsheetTruncated || text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
  if (!text) {
    return {
      content: "",
      truncated: false,
      error: `local Office extraction returned no extractable text for ${kind}`,
    };
  }
  return { content: text, truncated, method: `ooxml_${kind}` };
}

function extractDocxText(zip) {
  const names = zip.names()
    .filter((name) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/i.test(name))
    .sort((a, b) => docxPartRank(a) - docxPartRank(b) || a.localeCompare(b));
  return names
    .map((name) => extractTextNodes(zip.text(name), "t").join(" "))
    .filter(Boolean)
    .join("\n\n");
}

function docxPartRank(name) {
  if (/^word\/document\.xml$/i.test(name)) return 0;
  if (/^word\/header/i.test(name)) return 1;
  if (/^word\/footer/i.test(name)) return 2;
  return 3;
}

function extractPptxText(zip) {
  return zip.names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalCompare)
    .map((name, index) => {
      const text = extractTextNodes(zip.text(name), "t").join(" ");
      return text ? `Slide ${index + 1}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractXlsxText(zip, config = {}) {
  const sharedStrings = parseSharedStrings(zip.has("xl/sharedStrings.xml") ? zip.text("xl/sharedStrings.xml") : "");
  const sheets = zip.names()
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(naturalCompare)
    .map((name, index) => {
      const rows = extractWorksheetRows(zip.text(name), sharedStrings, SPREADSHEET_ROW_LIMIT + 1);
      return {
        name: `Sheet ${index + 1}`,
        rows: rows.slice(0, SPREADSHEET_ROW_LIMIT),
        truncatedRows: rows.length > SPREADSHEET_ROW_LIMIT,
      };
    })
    .filter((sheet) => sheet.rows.length);
  return formatSpreadsheetSheets(sheets, "xlsx", config);
}

function parseSharedStrings(xml) {
  return extractXmlBlocks(xml, "si").map((block) => extractTextNodes(block, "t").join(""));
}

function extractWorksheetRows(xml, sharedStrings, maxRows = SPREADSHEET_ROW_LIMIT) {
  const rows = [];
  for (const row of extractXmlBlocks(xml, "row")) {
    const cells = [];
    const cellPattern = /<(?:(?:[A-Za-z_][\w.-]*):)?c\b([^>]*)>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*):)?c>/gi;
    let match;
    while ((match = cellPattern.exec(row)) !== null) {
      const attrs = match[1] || "";
      const body = match[2] || "";
      const type = xmlAttr(attrs, "t");
      let value = "";
      if (type === "s") {
        const index = Number(extractTextNodes(body, "v")[0]);
        value = Number.isInteger(index) ? sharedStrings[index] || "" : "";
      } else if (type === "inlineStr") {
        value = extractTextNodes(body, "t").join("");
      } else {
        value = extractTextNodes(body, "v")[0] || extractTextNodes(body, "t").join("");
      }
      cells.push(value);
    }
    if (cells.some((cell) => String(cell || "").trim())) rows.push(cells);
    if (rows.length >= maxRows) break;
  }
  return rows;
}

function extractDelimitedSpreadsheetText(buffer, extension, mediaType, config = {}) {
  const delimiter = spreadsheetDelimiter(extension, mediaType);
  const format = delimiter === "\t" ? "tsv" : "csv";
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\u0000/g, "");
  const rows = parseDelimitedRows(text, delimiter, SPREADSHEET_ROW_LIMIT + 1)
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  const spreadsheet = formatSpreadsheetSheets([{
    name: "Sheet 1",
    rows: rows.slice(0, SPREADSHEET_ROW_LIMIT),
    truncatedRows: rows.length > SPREADSHEET_ROW_LIMIT,
  }], format, config);
  return {
    content: spreadsheet.content,
    truncated: spreadsheet.truncated,
    method: `spreadsheet_${format}`,
    ...(spreadsheet.content ? {} : { error: "local spreadsheet extraction returned no rows" }),
  };
}

function parseDelimitedRows(text, delimiter, maxRows) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      if (rows.length >= maxRows) return rows;
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.slice(0, maxRows);
}

function formatSpreadsheetSheets(sheets, format, config = {}) {
  const sections = [];
  let rowTruncated = false;
  for (const [index, sheet] of sheets.entries()) {
    const rows = sheet.rows || [];
    if (!rows.length) continue;
    rowTruncated = rowTruncated || Boolean(sheet.truncatedRows);
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const header = rows[0] || [];
    const title = sheet.name || `Sheet ${index + 1}`;
    sections.push([
      `${title}:`,
      "local_spreadsheet_augmentation: true",
      `format: ${format}`,
      `row_limit: ${SPREADSHEET_ROW_LIMIT}`,
      `rows_parsed: ${rows.length}`,
      `columns_detected: ${columnCount}`,
      header.length ? `header_row_1: ${header.map(formatSpreadsheetCell).join(" | ")}` : "header_row_1: none",
      sheet.truncatedRows ? "truncated_rows: true" : null,
      "rows:",
      ...rows.map((row, rowIndex) => `${rowIndex + 1}: ${row.map(formatSpreadsheetCell).join("\t")}`),
    ].filter(Boolean).join("\n"));
  }

  let content = sections.join("\n\n");
  const maxChars = config.inputFileMaxTextChars || 200000;
  const charTruncated = content.length > maxChars;
  if (charTruncated) content = content.slice(0, maxChars);
  return {
    content,
    truncated: rowTruncated || charTruncated,
  };
}

function formatSpreadsheetCell(value) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function readZipEntries(buffer, options = {}) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) throw new Error("not a ZIP archive");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount > (options.maxEntries || 2000)) throw new Error(`ZIP entry count exceeds ${options.maxEntries || 2000}`);
  if (centralOffset + centralSize > buffer.length) throw new Error("ZIP central directory is out of bounds");

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("invalid ZIP central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error("ZIP entry name is out of bounds");
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (!name.endsWith("/")) {
      entries.set(name, {
        name,
        method,
        compressedSize,
        uncompressedSize,
        localOffset,
        read: () => readZipEntryBuffer(buffer, {
          name,
          method,
          compressedSize,
          uncompressedSize,
          localOffset,
        }, options),
      });
    }
    offset = nameEnd + extraLength + commentLength;
  }

  return {
    has: (name) => entries.has(name),
    names: () => Array.from(entries.keys()),
    text: (name) => {
      const entry = entries.get(name);
      if (!entry) return "";
      return entry.read().toString("utf8");
    },
  };
}

function readZipEntryBuffer(buffer, entry, options = {}) {
  if (entry.uncompressedSize > (options.maxInflatedBytes || 16 * 1024 * 1024)) {
    throw new Error(`ZIP entry ${entry.name} exceeds local extraction limit`);
  }
  if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`invalid ZIP local header for ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new Error(`ZIP entry ${entry.name} data is out of bounds`);
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) {
    const inflated = zlib.inflateRawSync(compressed);
    if (inflated.length > (options.maxInflatedBytes || 16 * 1024 * 1024)) {
      throw new Error(`ZIP entry ${entry.name} exceeds local extraction limit`);
    }
    return inflated;
  }
  throw new Error(`ZIP entry ${entry.name} uses unsupported compression method ${entry.method}`);
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function extractXmlBlocks(xml, localName) {
  const escaped = escapeRegExp(localName);
  const pattern = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}>`, "gi");
  const values = [];
  let match;
  while ((match = pattern.exec(xml || "")) !== null) values.push(match[1] || "");
  return values;
}

function extractTextNodes(xml, localName) {
  return extractXmlBlocks(xml, localName)
    .map((value) => decodeXmlEntities(value.replace(/<[^>]+>/g, "")))
    .filter((value) => value.length > 0);
}

function xmlAttr(attrs, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=(["'])(.*?)\\1`, "i");
  return decodeXmlEntities(attrs.match(pattern)?.[2] || "");
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (match, code) => safeCodePoint(Number(code), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => safeCodePoint(parseInt(code, 16), match));
}

function safeCodePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  return String.fromCodePoint(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function isPdfFile(mediaType, extension, buffer) {
  return mediaType.split(";")[0].trim() === "application/pdf"
    || extension === ".pdf"
    || buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isOfficeFile(mediaType, extension) {
  return !!officeKind(extension, mediaType);
}

function officeKind(extension, mediaType = "") {
  const media = String(mediaType || "").split(";")[0].trim().toLowerCase();
  if (extension === ".docx" || media === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (extension === ".xlsx" || media === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (extension === ".pptx" || media === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  return "";
}

function isDelimitedSpreadsheetFile(mediaType, extension) {
  const media = String(mediaType || "").split(";")[0].trim().toLowerCase();
  return [".csv", ".tsv", ".iif"].includes(extension)
    || ["text/csv", "application/csv", "text/tsv", "text/tab-separated-values", "text/x-iif", "application/x-iif"].includes(media);
}

function spreadsheetDelimiter(extension, mediaType = "") {
  const media = String(mediaType || "").split(";")[0].trim().toLowerCase();
  return extension === ".tsv" || extension === ".iif" || media === "text/tsv" || media === "text/tab-separated-values"
    ? "\t"
    : ",";
}

function isSpreadsheetExtractionMethod(method) {
  return ["ooxml_xlsx", "spreadsheet_csv", "spreadsheet_tsv"].includes(String(method || ""));
}

function isTextLike(mediaType, extension, buffer) {
  if (mediaType.startsWith("text/")) return true;
  if ([
    "application/json",
    "application/javascript",
    "application/typescript",
    "application/xml",
    "application/csv",
    "application/x-ndjson",
    "application/x-yaml",
    "application/x-iif",
    "application/yaml",
    "application/toml",
  ].includes(mediaType)) return true;
  if ([
    ".txt", ".md", ".markdown", ".json", ".jsonl", ".ndjson", ".js", ".mjs", ".cjs",
    ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".csv", ".tsv", ".py", ".rb",
    ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
    ".sh", ".bash", ".zsh", ".sql", ".yaml", ".yml", ".toml", ".ini", ".log", ".iif",
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
    const inputFile = normalizeInputFilePart(value);
    if (inputFile) parts.push(inputFile);
    if (Array.isArray(value.content)) visit(value.content);
  };
  visit(input);
  return parts;
}

function normalizeInputFilePart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.type !== "input_file" && value.type !== "file") return null;
  const source = value.file && typeof value.file === "object" && !Array.isArray(value.file)
    ? value.file
    : value;
  const inputFile = {
    type: "input_file",
  };
  const fileId = source.file_id || source.id || value.file_id || value.id;
  const fileData = source.file_data ?? source.data ?? source.content_base64 ?? value.file_data ?? value.data ?? value.content_base64;
  const fileUrl = source.file_url || source.url || value.file_url || value.url;
  const filename = source.filename || source.name || value.filename || value.name;
  const mediaType = source.media_type || source.mime_type || value.media_type || value.mime_type;
  if (fileId != null) inputFile.file_id = stringifyContent(fileId);
  if (fileData != null) inputFile.file_data = stringifyContent(fileData);
  if (fileUrl != null) inputFile.file_url = stringifyContent(fileUrl);
  if (filename != null) inputFile.filename = stringifyContent(filename);
  if (mediaType != null) inputFile.media_type = stringifyContent(mediaType);
  return inputFile;
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
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return extension ? "text/plain" : "";
}

module.exports = {
  hasInputFiles,
  injectInputFileMessages,
  inputFileCompatibility,
  prepareInputFileContext,
};
