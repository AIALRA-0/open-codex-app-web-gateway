#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const suite = String(args.get("suite") || "protocol-smoke");
const baseUrl = trimTrailingSlash(args.get("base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912");
const model = String(args.get("model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro");
const repeat = parsePositiveInt(args.get("repeat"), 1);
const outputPath = args.get("output");
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 10 * 60 * 1000);
const caseFilter = args.get("case");
const verbose = !!args.get("verbose");
let cachedCrcTable = null;

const suites = buildSuites(model);
const selected = caseFilter
  ? suites[suite]?.filter((testCase) => testCase.id === caseFilter)
  : suites[suite];
if (!selected) {
  console.error(`Unknown suite: ${suite}`);
  console.error(`Available suites: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}
if (!selected.length) {
  console.error(`No cases selected for suite=${suite} case=${caseFilter}`);
  process.exit(2);
}

const startedAt = new Date().toISOString();
const results = [];
for (let iteration = 1; iteration <= repeat; iteration += 1) {
  for (const testCase of selected) {
    if (verbose) console.error(`running ${testCase.id} iteration ${iteration}`);
    const result = await withTimeout(
      runCase(testCase, { iteration }),
      timeoutMs,
      `case timed out after ${timeoutMs} ms: ${testCase.id}`,
      { id: testCase.id, mode: testCase.mode || "responses", iteration },
    );
    if (verbose) console.error(`finished ${testCase.id} ok=${result.ok} elapsed_ms=${result.elapsed_ms}`);
    results.push(result);
  }
}

const report = makeReport({ suite, model, baseUrl, repeat, startedAt, results });
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
console.log(serialized);
process.exit(report.summary.passed === report.summary.total ? 0 : 1);

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(key, true);
    } else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function tinyPdfBase64(text) {
  const escaped = String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii").toString("base64");
}

function tinyZipBase64(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(String(content), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, end]).toString("base64");
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = (value >>> 8) ^ crcTable()[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function crcTable() {
  if (cachedCrcTable) return cachedCrcTable;
  cachedCrcTable = Array.from({ length: 256 }, (_unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  return cachedCrcTable;
}

function tinyDocxBase64(text) {
  return tinyZipBase64({
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

function tinyXlsxBase64(rows) {
  const shared = rows.flat().map((value) => `<si><t>${xmlEscape(value)}</t></si>`).join("");
  let index = 0;
  const rowXml = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${
    row.map((_value, columnIndex) => `<c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="s"><v>${index++}</v></c>`).join("")
  }</row>`).join("");
  return tinyZipBase64({
    "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
  });
}

function tinyPptxBase64(text) {
  return tinyZipBase64({
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  });
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function vectorChunkFixture(marker) {
  return Array.from({ length: 230 }, (_unused, index) => (
    index === 135 ? marker : `vectorword${index}`
  )).join(" ");
}

function buildSuites(defaultModel) {
  const protocolSmoke = [
    {
      id: "responses-text",
      mode: "responses",
      request: {
        model: defaultModel,
        input: "Return the exact string ok-text.",
        max_output_tokens: 64,
        store: false,
      },
      check: ({ text }) => /ok-text/i.test(text),
    },
    {
      id: "responses-json-schema",
      mode: "responses",
      request: {
        model: defaultModel,
        input: "Return JSON with ok true.",
        text: {
          format: {
            type: "json_schema",
            name: "smoke",
            strict: true,
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 128,
        store: false,
      },
      check: ({ text }) => jsonHas(text, "ok", true),
    },
  ];

  return {
    "protocol-smoke": protocolSmoke,
    "bridge-regression": [
      ...protocolSmoke,
      {
        id: "models-retrieve",
        mode: "model-get",
        model: defaultModel,
        check: ({ json }) => json?.object === "model" && json.id === defaultModel,
      },
      {
        id: "embeddings-local",
        mode: "embeddings",
        request: {
          model: "text-embedding-3-small",
          input: ["bridge embedding alpha", "bridge embedding vehicle repair"],
          dimensions: 32,
          encoding_format: "float",
        },
        check: ({ json }) => json?.object === "list"
          && json.model === "text-embedding-3-small"
          && json.data?.length === 2
          && json.data.every((item, index) => item.object === "embedding"
            && item.index === index
            && Array.isArray(item.embedding)
            && item.embedding.length === 32)
          && json.data[0].embedding.some((value) => value !== 0)
          && json.usage?.total_tokens > 0
          && json.compatibility?.provider === "local",
      },
      {
        id: "moderations-local",
        mode: "moderations",
        request: {
          model: "omni-moderation-latest",
          input: ["A calm compatibility check.", "I want to kill them."],
        },
        check: ({ json }) => json?.id?.startsWith("modr_")
          && json.model === "omni-moderation-latest"
          && json.results?.length === 2
          && json.results[0].flagged === false
          && json.results[1].flagged === true
          && json.results[1].categories?.violence === true
          && json.results[1].categories?.["harassment/threatening"] === true
          && json.results[1].category_applied_input_types?.violence?.includes("text")
          && json.compatibility?.provider === "local",
      },
      {
        id: "responses-inline-moderation",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Return the exact string inline-moderation-ok.",
          moderation: { input: true, output: true },
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json, text }) => /inline-moderation-ok/i.test(text)
          && json?.moderation?.input?.results?.length === 1
          && json?.moderation?.output?.results?.length === 1
          && json.moderation.input.compatibility?.provider === "local"
          && json.moderation.output.compatibility?.provider === "local"
          && json.metadata?.compatibility?.local_moderation?.input?.flagged === false
          && json.metadata?.compatibility?.local_moderation?.output?.flagged === false,
      },
      {
        id: "responses-prompt-template-local",
        mode: "responses",
        request: {
          model: defaultModel,
          prompt: {
            id: "pmpt_eval_inline",
            variables: { answer: "prompt-template-ok" },
            template: {
              instructions: "Return exactly this text and nothing else: {{answer}}",
            },
          },
          input: "Follow the reusable prompt template.",
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /prompt-template-ok/i.test(text)
          && json.metadata?.compatibility?.prompt_template?.status === "expanded_locally"
          && json.metadata?.compatibility?.prompt_template?.source === "inline_template",
      },
      {
        id: "responses-reasoning-none",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Return the exact string reasoning-none-ok.",
          reasoning: { effort: "none" },
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json, text }) => /reasoning-none-ok/i.test(text)
          && json.metadata?.compatibility?.deepseek_thinking === "disabled_for_reasoning_none"
          && json.metadata?.compatibility?.reasoning_effort?.forwarded === false
          && json.metadata?.compatibility?.reasoning_effort?.reason === "deepseek_thinking_disabled",
      },
      {
        id: "batch-embeddings-local",
        mode: "batch-local",
        endpoint: "/v1/embeddings",
        usage: "embeddings",
        requests: [
          {
            custom_id: "batch-embedding-a",
            body: { model: "text-embedding-3-small", input: "batch embedding alpha", dimensions: 12 },
          },
          {
            custom_id: "batch-embedding-b",
            body: { model: "text-embedding-3-small", input: ["batch vehicle", "batch maintenance"], dimensions: 12 },
          },
        ],
        check: ({ batch, outputLines, errorText }) => batch?.object === "batch"
          && batch.status === "completed"
          && batch.request_counts?.total === 2
          && batch.request_counts?.completed === 2
          && batch.request_counts?.failed === 0
          && !batch.error_file_id
          && !errorText
          && outputLines.length === 2
          && outputLines.every((line) => line.response?.status_code === 200 && !line.error)
          && outputLines[0].response?.body?.data?.[0]?.embedding?.length === 12
          && outputLines[1].response?.body?.data?.length === 2,
      },
      {
        id: "batch-moderations-local",
        mode: "batch-local",
        endpoint: "/v1/moderations",
        requests: [
          {
            custom_id: "batch-moderation-safe",
            body: { input: "A calm compatibility batch check." },
          },
          {
            custom_id: "batch-moderation-threat",
            body: { model: "omni-moderation-latest", input: "I will kill you." },
          },
        ],
        check: ({ batch, outputLines, errorText }) => batch?.object === "batch"
          && batch.status === "completed"
          && batch.request_counts?.total === 2
          && batch.request_counts?.completed === 2
          && batch.request_counts?.failed === 0
          && !batch.error_file_id
          && !errorText
          && outputLines.length === 2
          && outputLines.every((line) => line.response?.status_code === 200 && !line.error)
          && outputLines[0].response?.body?.results?.[0]?.flagged === false
          && outputLines[1].response?.body?.results?.[0]?.flagged === true
          && outputLines[1].response?.body?.results?.[0]?.categories?.violence === true,
      },
      {
        id: "batch-chat-completions",
        mode: "batch-local",
        endpoint: "/v1/chat/completions",
        usage: "chat",
        requests: [
          {
            custom_id: "batch-chat-one",
            body: {
              model: defaultModel,
              messages: [{ role: "user", content: "Return the exact string batch-chat-one." }],
              max_tokens: 64,
              store: false,
            },
          },
          {
            custom_id: "batch-chat-two",
            body: {
              model: defaultModel,
              messages: [{ role: "user", content: "Return the exact string batch-chat-two." }],
              max_tokens: 64,
              store: false,
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => batch?.object === "batch"
          && batch.status === "completed"
          && batch.endpoint === "/v1/chat/completions"
          && batch.request_counts?.total === 2
          && batch.request_counts?.completed === 2
          && batch.request_counts?.failed === 0
          && !batch.error_file_id
          && !errorText
          && outputLines.length === 2
          && outputLines.every((line) => line.response?.status_code === 200 && !line.error)
          && outputLines.every((line) => line.response?.body?.object === "chat.completion")
          && /batch-chat-one/i.test(chatOutputText(outputLines[0].response?.body))
          && /batch-chat-two/i.test(chatOutputText(outputLines[1].response?.body)),
      },
      {
        id: "batch-completions-legacy",
        mode: "batch-local",
        endpoint: "/v1/completions",
        usage: "completions",
        requests: [
          {
            custom_id: "batch-completion-one",
            body: {
              model: defaultModel,
              prompt: "Return the exact string batch-completion-one.",
              max_tokens: 64,
              temperature: 0,
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => batch?.object === "batch"
          && batch.status === "completed"
          && batch.endpoint === "/v1/completions"
          && batch.request_counts?.total === 1
          && batch.request_counts?.completed === 1
          && batch.request_counts?.failed === 0
          && !batch.error_file_id
          && !errorText
          && outputLines.length === 1
          && outputLines[0].response?.status_code === 200
          && outputLines[0].response?.body?.object === "text_completion"
          && /batch-completion-one/i.test(completionOutputText(outputLines[0].response?.body)),
      },
      {
        id: "chat-passthrough",
        mode: "chat",
        request: {
          model: defaultModel,
          messages: [{ role: "user", content: "Return the exact string chat-ok." }],
          max_tokens: 64,
        },
        check: ({ text }) => /chat-ok/i.test(text),
      },
      {
        id: "completions-legacy",
        mode: "completions",
        request: {
          model: defaultModel,
          prompt: "Return the exact string completion-ok.",
          max_tokens: 64,
          temperature: 0,
        },
        check: ({ json, text }) => json?.object === "text_completion" && /completion-ok/i.test(text),
      },
      {
        id: "chat-lifecycle",
        mode: "chat-lifecycle",
        updateMetadata: { suite: "chat-life-updated", audit: "bridge-regression" },
        request: {
          model: defaultModel,
          store: true,
          metadata: { suite: "chat-life-initial" },
          messages: [{ role: "user", content: "Return the exact string chat-life-ok." }],
          max_tokens: 96,
        },
        check: ({ json, text, fetched, updated, messages, list, oldList, deleted, afterDelete, postDeleteList }) => /chat-life-ok/i.test(text)
          && fetched?.id
          && updated?.metadata?.suite === "chat-life-updated"
          && updated?.metadata?.audit === "bridge-regression"
          && updated?.metadata?.completion_id === json.id
          && messages?.object === "list"
          && messages.data?.some((message) => message.role === "user")
          && messages.data?.some((message) => message.role === "assistant")
          && list?.object === "list"
          && list.data?.some((completion) => completion.id === json.id)
          && oldList?.object === "list"
          && !oldList.data?.some((completion) => completion.id === json.id)
          && deleted?.object === "chat.completion.deleted"
          && deleted?.id === json.id
          && deleted?.deleted === true
          && afterDelete?.status === 404
          && postDeleteList?.object === "list"
          && !postDeleteList.data?.some((completion) => completion.id === json.id),
      },
      {
        id: "chat-stream-lifecycle",
        mode: "chat-stream-lifecycle",
        updateMetadata: { suite: "chat-stream-life-updated", audit: "bridge-regression" },
        request: {
          model: defaultModel,
          store: true,
          stream: true,
          stream_options: { include_usage: true },
          metadata: { suite: "chat-stream-life-initial" },
          messages: [{ role: "user", content: "Stream the exact string chat-stream-life-ok." }],
          max_tokens: 128,
          temperature: 0,
          thinking: { type: "disabled" },
        },
        check: ({ id, text, fetched, updated, messages, list, oldList, deleted, afterDelete, postDeleteList }) => /chat-stream-life-ok/i.test(text)
          && fetched?.object === "chat.completion"
          && /chat-stream-life-ok/i.test(chatOutputText(fetched))
          && (fetched?.usage?.total_tokens || 0) > 0
          && updated?.metadata?.suite === "chat-stream-life-updated"
          && updated?.metadata?.audit === "bridge-regression"
          && updated?.metadata?.completion_id === id
          && messages?.object === "list"
          && messages.data?.some((message) => message.direction === "input" && message.role === "user")
          && messages.data?.some((message) => message.direction === "output" && message.role === "assistant")
          && list?.object === "list"
          && list.data?.some((completion) => completion.id === id)
          && oldList?.object === "list"
          && !oldList.data?.some((completion) => completion.id === id)
          && deleted?.object === "chat.completion.deleted"
          && deleted?.id === id
          && deleted?.deleted === true
          && afterDelete?.status === 404
          && postDeleteList?.object === "list"
          && !postDeleteList.data?.some((completion) => completion.id === id),
      },
      {
        id: "responses-input-tokens",
        mode: "responses-input-tokens",
        request: {
          model: defaultModel,
          input: "Count this bridge token probe.",
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json }) => json?.object === "response.input_tokens"
          && Number.isInteger(json.input_tokens)
          && json.input_tokens > 0,
      },
      {
        id: "responses-input-file",
        mode: "responses-input-file",
        file: {
          filename: "bridge-input-file.txt",
          purpose: "user_data",
          content: "Bridge input file fixture. The exact answer is input-file-ok.",
        },
        request: ({ fileId }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: "Using the input file content, return exactly this text and nothing else: input-file-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text }) => /input-file-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0,
      },
      {
        id: "responses-upload-input-file",
        mode: "responses-upload-input-file",
        upload: {
          filename: "bridge-upload-input-file.txt",
          purpose: "user_data",
          mime_type: "text/plain",
          content: "Bridge Uploads API fixture. The exact answer is upload-input-ok.",
        },
        request: ({ fileId }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: "Using the uploaded file content, return exactly this text and nothing else: upload-input-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, upload, fileId }) => /upload-input-ok/i.test(text)
          && upload?.status === "completed"
          && upload?.file?.id === fileId
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0,
      },
      {
        id: "responses-upload-input-file-pdf",
        mode: "responses-upload-input-file",
        upload: {
          filename: "bridge-upload-input-file.pdf",
          purpose: "user_data",
          mime_type: "application/pdf",
          content_base64: tinyPdfBase64("Bridge Uploads PDF fixture. The exact answer is upload-pdf-ok."),
        },
        request: ({ fileId }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: "Using the uploaded PDF content, return exactly this text and nothing else: upload-pdf-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, upload, fileId }) => /upload-pdf-ok/i.test(text)
          && upload?.status === "completed"
          && upload?.file?.id === fileId
          && upload?.file?.metadata?.mime_type === "application/pdf"
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0
          && json.metadata?.compatibility?.local_input_files?.pdf_extracted_count === 1,
      },
      {
        id: "responses-input-file-url",
        mode: "responses-input-file-url",
        fileUrl: {
          filename: "bridge-input-url.txt",
          contentType: "text/plain",
          content: "Bridge URL input file fixture. The exact answer is url-input-ok.",
        },
        request: ({ fileUrl }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "bridge-input-url.txt",
                file_url: fileUrl,
              },
              { type: "input_text", text: "Using the URL input file content, return exactly this text and nothing else: url-input-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text }) => /url-input-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0,
      },
      {
        id: "responses-input-file-pdf",
        mode: "responses",
        request: {
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "bridge-input-file.pdf",
                file_data: `data:application/pdf;base64,${tinyPdfBase64("Bridge PDF input fixture. The exact answer is pdf-input-ok.")}`,
              },
              { type: "input_text", text: "Using the PDF input file, return exactly this text and nothing else: pdf-input-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /pdf-input-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0
          && json.metadata?.compatibility?.local_input_files?.pdf_extracted_count === 1,
      },
      {
        id: "responses-input-file-office",
        mode: "responses",
        request: {
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "bridge-input-file.docx",
                file_data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${tinyDocxBase64("Bridge DOCX input fixture. The exact answer is office-input-ok.")}`,
              },
              {
                type: "input_file",
                filename: "bridge-input-file.xlsx",
                file_data: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${tinyXlsxBase64([["Bridge XLSX input fixture", "office-input-ok"]])}`,
              },
              {
                type: "input_file",
                filename: "bridge-input-file.pptx",
                file_data: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${tinyPptxBase64("Bridge PPTX input fixture. The exact answer is office-input-ok.")}`,
              },
              { type: "input_text", text: "Using the Office input files, return exactly this text and nothing else: office-input-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /office-input-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 3
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0
          && json.metadata?.compatibility?.local_input_files?.office_extracted_count === 3,
      },
      {
        id: "responses-input-file-spreadsheet",
        mode: "responses",
        request: {
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "bridge-input-spreadsheet.csv",
                file_data: `data:text/csv;base64,${Buffer.from("Name,Score,Answer\nAda,95,spreadsheet-input-ok\nGrace,88,other\n", "utf8").toString("base64")}`,
              },
              { type: "input_text", text: "Using the spreadsheet input file, return exactly this text and nothing else: spreadsheet-input-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /spreadsheet-input-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0
          && json.metadata?.compatibility?.local_input_files?.spreadsheet_extracted_count === 1,
      },
      {
        id: "responses-logprobs",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Return exactly this text and nothing else: logprobs-ok",
          include: ["message.output_text.logprobs"],
          top_logprobs: 2,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /logprobs-ok/i.test(text)
          && json.metadata?.compatibility?.logprobs === "chat_logprobs"
          && (json.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs) && part.logprobs.length > 0)),
      },
      {
        id: "responses-stop-sequence",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Return exactly: stop-ok<cut-here>after-cut",
          stop: ["<cut-here>"],
          temperature: 0,
          max_output_tokens: 256,
          store: false,
        },
        check: ({ text }) => /stop-ok/i.test(text)
          && !/cut-here/i.test(text)
          && !/after-cut/i.test(text),
      },
      {
        id: "responses-background",
        mode: "responses-background",
        request: {
          model: defaultModel,
          input: "Return the exact string background-ok.",
          background: true,
          max_output_tokens: 128,
        },
        check: ({ created, final, text, history }) => created?.status === "in_progress"
          && final?.status === "completed"
          && history.includes("in_progress")
          && /background-ok/i.test(text),
      },
      {
        id: "responses-lifecycle",
        mode: "responses-lifecycle",
        updateMetadata: { suite: "responses-life-updated", audit: "bridge-regression" },
        request: {
          model: defaultModel,
          input: [{
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Return the exact string responses-life-ok." }],
          }],
          metadata: { suite: "responses-life-initial" },
          max_output_tokens: 96,
          store: true,
        },
        check: ({ created, text, fetched, updated, inputItems, cancelled, deleted, afterDelete }) => /responses-life-ok/i.test(text)
          && fetched?.id === created.id
          && updated?.metadata?.suite === "responses-life-updated"
          && updated?.metadata?.audit === "bridge-regression"
          && updated?.metadata?.response_id === created.id
          && updated?.metadata?.compatibility
          && updated?.metadata?.upstream_object === "chat.completion"
          && inputItems?.object === "list"
          && inputItems.data?.length >= 1
          && cancelled?.id === created.id
          && /terminal responses/.test(cancelled?.metadata?.compatibility_cancel || "")
          && deleted?.object === "response.deleted"
          && deleted?.id === created.id
          && deleted?.deleted === true
          && afterDelete?.status === 404,
      },
      {
        id: "responses-conversation-lifecycle",
        mode: "responses-conversation",
        conversation: {
          metadata: { suite: "bridge-regression", feature: "conversation" },
          items: [{
            type: "message",
            role: "user",
            content: "Remember the exact conversation marker conversation-ok.",
          }],
        },
        request: ({ conversationId }) => ({
          model: defaultModel,
          conversation: conversationId,
          input: "Using the conversation history, return exactly this text and nothing else: conversation-ok",
          max_output_tokens: 128,
          store: false,
        }),
        inputTokens: ({ conversationId }) => ({
          model: defaultModel,
          conversation: conversationId,
          input: "Count this conversation marker probe: conversation-ok",
          max_output_tokens: 16,
          store: false,
        }),
        compact: ({ conversationId }) => ({
          model: defaultModel,
          conversation: conversationId,
          input: "Compact this conversation while preserving the exact marker conversation-ok.",
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ conversation, response, text, items, inputTokens, compact, deleted, afterDelete }) => conversation?.object === "conversation"
          && inputTokens?.object === "response.input_tokens"
          && inputTokens.input_tokens > 0
          && compact?.object === "response.compaction"
          && compact?.conversation === conversation.id
          && compact?.metadata?.compatibility?.local_conversation?.id === conversation.id
          && response?.conversation === conversation.id
          && response?.metadata?.compatibility?.local_conversation?.id === conversation.id
          && /conversation-ok/i.test(text)
          && items?.object === "list"
          && items.data?.length >= 3
          && items.data?.some((item) => item.role === "assistant")
          && deleted?.object === "conversation.deleted"
          && deleted?.deleted === true
          && afterDelete?.status === 404,
      },
      {
        id: "conversation-image-include",
        mode: "conversation-items-local",
        include: "message.input_image.image_url",
        conversation: {
          items: [{
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Local image include regression." },
              {
                type: "input_image",
                image_url: {
                  url: "https://example.test/local-include-image.png",
                  detail: "low",
                },
              },
            ],
          }],
        },
        check: ({ conversation, hiddenItems, includedItems, hiddenItem, includedItem, deleted }) => {
          const hiddenImage = hiddenItems?.data?.[0]?.content?.[1] || {};
          const includedImage = includedItems?.data?.[0]?.content?.[1] || {};
          return conversation?.object === "conversation"
            && hiddenItems?.object === "list"
            && hiddenImage.type === "input_image"
            && hiddenImage.detail === "low"
            && hiddenImage.image_url === undefined
            && includedImage.image_url?.url === "https://example.test/local-include-image.png"
            && includedImage.image_url?.detail === "low"
            && hiddenItem?.content?.[1]?.image_url === undefined
            && includedItem?.content?.[1]?.image_url?.url === "https://example.test/local-include-image.png"
            && deleted?.object === "conversation.deleted"
            && deleted.deleted === true;
        },
      },
      {
        id: "conversation-computer-output-include",
        mode: "conversation-items-local",
        include: "computer_call_output.output.image_url",
        conversation: {
          items: [{
            type: "computer_call_output",
            call_id: "call_eval_screen",
            output: {
              type: "input_image",
              image_url: {
                url: "https://example.test/local-computer-screen.png",
                detail: "high",
              },
            },
          }],
        },
        check: ({ conversation, hiddenItems, includedItems, hiddenItem, includedItem, deleted }) => {
          const hiddenOutput = hiddenItems?.data?.[0]?.output || {};
          const includedOutput = includedItems?.data?.[0]?.output || {};
          return conversation?.object === "conversation"
            && hiddenItems?.object === "list"
            && hiddenOutput.type === "input_image"
            && hiddenOutput.detail === "high"
            && hiddenOutput.image_url === undefined
            && includedOutput.image_url?.url === "https://example.test/local-computer-screen.png"
            && includedOutput.image_url?.detail === "high"
            && hiddenItem?.output?.image_url === undefined
            && includedItem?.output?.image_url?.url === "https://example.test/local-computer-screen.png"
            && deleted?.object === "conversation.deleted"
            && deleted.deleted === true;
        },
      },
      {
        id: "responses-web-search",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Use web search for OpenAI. Then return the exact string web-search-ok [1].",
          tools: [{ type: "web_search_preview" }],
          include: ["web_search_call.action.sources"],
          max_output_tokens: 128,
          store: true,
        },
        retrieveResponseInclude: "web_search_call.action.sources",
        check: ({ json, text, hiddenResponse, includedResponse }) => {
          const calls = (json.output || []).filter((item) => item.type === "web_search_call");
          const searchCall = calls.find((item) => item.action?.type === "search");
          const openPageCall = calls.find((item) => item.action?.type === "open_page");
          const findInPageCall = calls.find((item) => item.action?.type === "find_in_page");
          const hiddenCalls = (hiddenResponse?.output || []).filter((item) => item.type === "web_search_call");
          const includedCalls = (includedResponse?.output || []).filter((item) => item.type === "web_search_call");
          const hiddenSearchCall = hiddenCalls.find((item) => item.action?.type === "search");
          const includedSearchCall = includedCalls.find((item) => item.action?.type === "search");
          const actionSources = searchCall?.action?.sources || [];
          const includedSources = includedSearchCall?.action?.sources || [];
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          const openAttemptCount = (json.metadata?.compatibility?.local_web_search?.opened_count || 0)
            + (json.metadata?.compatibility?.local_web_search?.open_failed_count || 0);
          const findAttemptCount = (json.metadata?.compatibility?.local_web_search?.find_in_page_count || 0)
            + (json.metadata?.compatibility?.local_web_search?.find_in_page_failed_count || 0);
          const openedCount = json.metadata?.compatibility?.local_web_search?.opened_count || 0;
          return !!searchCall
            && searchCall.status === "completed"
            && actionSources.some((source) => source.type === "url" && /^https?:\/\//.test(source.url || ""))
            && hiddenSearchCall?.action?.sources === undefined
            && !hiddenCalls.some((call) => Array.isArray(call.action?.sources))
            && includedSources.some((source) => source.type === "url" && /^https?:\/\//.test(source.url || ""))
            && !!openPageCall
            && ["completed", "failed"].includes(openPageCall.status)
            && (openedCount === 0 || (!!findInPageCall && findInPageCall.status === "completed" && findAttemptCount >= 1))
            && annotations.some((annotation) => annotation.type === "url_citation" && /^https?:\/\//.test(annotation.url || ""))
            && openAttemptCount >= 1
            && /web-search-ok/i.test(text);
        },
      },
      {
        id: "responses-max-tool-calls",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Use web search for OpenAI. Then return the exact string web-budget-ok [1].",
          tools: [{ type: "web_search_preview" }],
          max_tool_calls: 1,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => {
          const calls = (json.output || []).filter((item) => item.type === "web_search_call");
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          const budget = json.metadata?.compatibility?.local_tool_budget || {};
          const webSearch = json.metadata?.compatibility?.local_web_search || {};
          return calls.length === 1
            && calls[0].action?.type === "search"
            && budget.max_tool_calls === 1
            && budget.used === 1
            && budget.skipped >= 1
            && webSearch.open_skipped_count >= 1
            && !calls.some((call) => call.action?.type === "open_page")
            && annotations.some((annotation) => annotation.type === "url_citation")
            && /web-budget-ok/i.test(text);
        },
      },
      {
        id: "responses-computer",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Use the local computer compatibility bridge to request a screenshot. Do not invent browser state before computer_call_output is returned.",
          tools: [{
            type: "computer",
            environment: "browser",
            display_width: 1024,
            display_height: 768,
          }],
          tool_choice: { type: "computer" },
          max_tool_calls: 1,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json }) => {
          const call = (json.output || []).find((item) => item.type === "computer_call");
          const computer = json.metadata?.compatibility?.local_computer || {};
          const budget = json.metadata?.compatibility?.local_tool_budget || {};
          return !!call
            && call.status === "completed"
            && call.action?.type === "screenshot"
            && call.actions?.some((action) => action.type === "screenshot")
            && computer.call_count === 1
            && computer.requested_action_count === 1
            && computer.deepseek_thinking === "disabled_for_local_computer"
            && budget.used === 1;
        },
      },
      {
        id: "responses-shell",
        mode: "responses-shell",
        container: { name: "bridge-shell-eval" },
        request: ({ containerId }) => ({
          model: defaultModel,
          input: "Execute: printf shell-ok > /mnt/data/shell.txt && cat /mnt/data/shell.txt",
          tools: [{
            type: "shell",
            environment: { type: "container_reference", container_id: containerId },
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, containerId, artifactText }) => {
          const shellCall = (json.output || []).find((item) => item.type === "shell_call");
          const shellOutput = (json.output || []).find((item) => item.type === "shell_call_output");
          return !!shellCall
            && shellCall.status === "completed"
            && shellCall.container_id === containerId
            && !!shellOutput
            && shellOutput.status === "completed"
            && shellOutput.outcome?.exit_code === 0
            && /shell-ok/i.test(shellOutput.output?.[0]?.stdout || "")
            && /shell-ok/i.test(artifactText || "")
            && /shell-ok/i.test(text);
        },
      },
      {
        id: "responses-code-interpreter",
        mode: "responses-shell",
        container: { name: "bridge-code-interpreter-eval" },
        request: ({ containerId }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              "```python",
              "from pathlib import Path",
              "Path('/mnt/data/shell.txt').write_text('code-interpreter-ok')",
              "print('code-interpreter-ok')",
              "```",
              "After the tool evidence, return exactly code-interpreter-ok.",
            ].join("\n"),
          }],
          tools: [{
            type: "code_interpreter",
            container: { type: "container_reference", container_id: containerId },
          }],
          include: ["code_interpreter_call.outputs"],
          max_output_tokens: 128,
          store: true,
        }),
        retrieveResponseInclude: "code_interpreter_call.outputs",
        check: ({ json, text, containerId, artifactText, hiddenResponse, includedResponse }) => {
          const codeCall = (json.output || []).find((item) => item.type === "code_interpreter_call");
          const hiddenCodeCall = (hiddenResponse?.output || []).find((item) => item.type === "code_interpreter_call");
          const includedCodeCall = (includedResponse?.output || []).find((item) => item.type === "code_interpreter_call");
          const localShell = json.metadata?.compatibility?.local_shell || {};
          return !!codeCall
            && codeCall.status === "completed"
            && codeCall.container_id === containerId
            && /code-interpreter-ok/i.test(codeCall.outputs?.[0]?.logs || "")
            && hiddenCodeCall?.outputs === undefined
            && /code-interpreter-ok/i.test(includedCodeCall?.outputs?.[0]?.logs || "")
            && !(json.output || []).some((item) => item.type === "shell_call" || item.type === "shell_call_output")
            && localShell.include_code_interpreter_outputs === true
            && localShell.deepseek_thinking === "disabled_for_local_shell"
            && /code-interpreter-ok/i.test(artifactText || "")
            && /code-interpreter-ok/i.test(text);
        },
      },
      {
        id: "responses-shell-skill",
        mode: "responses-shell",
        skill: {
          files: [{
            path: "SKILL.md",
            content: [
              "---",
              "name: live-skill",
              "description: Live bridge skill mount regression fixture.",
              "---",
              "skill-live-ok",
            ].join("\n"),
          }],
        },
        container: { name: "bridge-shell-skill-eval" },
        request: ({ containerId, skillId }) => ({
          model: defaultModel,
          input: [
            {
              role: "user",
              content: "Execute: grep skill-live-ok /mnt/data/.skills/live-skill/v1/SKILL.md > /mnt/data/shell.txt && cat /mnt/data/shell.txt",
            },
            {
              role: "user",
              content: "After the command output, return exactly skill-live-ok.",
            },
          ],
          tools: [{
            type: "shell",
            environment: {
              type: "container_reference",
              container_id: containerId,
              skills: [{ type: "skill_reference", skill_id: skillId }],
            },
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, containerId, skillId, artifactText }) => {
          const shellCall = (json.output || []).find((item) => item.type === "shell_call");
          const shellOutput = (json.output || []).find((item) => item.type === "shell_call_output");
          const mountedSkills = json.metadata?.compatibility?.local_shell?.mounted_skills || [];
          return !!shellCall
            && shellCall.status === "completed"
            && shellCall.container_id === containerId
            && !!shellOutput
            && shellOutput.status === "completed"
            && shellOutput.outcome?.exit_code === 0
            && mountedSkills.some((skill) => skill.skill_id === skillId && skill.version === 1)
            && /skill-live-ok/i.test(shellOutput.output?.[0]?.stdout || "")
            && /skill-live-ok/i.test(artifactText || "")
            && /skill-live-ok/i.test(text);
        },
      },
      {
        id: "responses-file-search",
        mode: "responses-file-search",
        file: {
          filename: "bridge-file-search.txt",
          purpose: "assistants",
          content: "Bridge file search fixture. The exact file search answer is file-search-ok. A second retrieval marker is file-search-extra-ok. When asked for the exact answer, return file-search-ok [1].",
        },
        vectorStore: { name: "bridge-file-search-eval" },
        vectorFile: { attributes: { suite: "bridge-regression" } },
        request: ({ vectorStoreId }) => ({
          model: defaultModel,
          input: "File search for file-search-ok and file-search-extra-ok. Using the file search result, return exactly this text and nothing else: file-search-ok [1]",
          tools: [{
            type: "file_search",
            vector_store_ids: [vectorStoreId],
            max_num_results: 3,
            filters: { type: "eq", key: "suite", value: "bridge-regression" },
            ranking_options: {
              ranker: "default_2024_08_21",
              score_threshold: 0.8,
            },
          }],
          include: ["file_search_call.results"],
          max_output_tokens: 128,
          store: true,
        }),
        retrieveResponseInclude: "file_search_call.results",
        check: ({ json, text, fileId, vectorStoreId, hiddenResponse, includedResponse }) => {
          const call = (json.output || []).find((item) => item.type === "file_search_call");
          const hiddenCall = (hiddenResponse?.output || []).find((item) => item.type === "file_search_call");
          const includedCall = (includedResponse?.output || []).find((item) => item.type === "file_search_call");
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          return !!call
            && call.status === "completed"
            && call.vector_store_ids?.includes(vectorStoreId)
            && call.queries?.includes("file-search-ok")
            && call.queries?.includes("file-search-extra-ok")
            && call.ranking_options?.score_threshold === 0.8
            && call.results?.some((result) => result.file_id === fileId && result.matched_queries?.includes("file-search-extra-ok"))
            && hiddenCall?.results === undefined
            && includedCall?.results?.some((result) => result.file_id === fileId && result.matched_queries?.includes("file-search-extra-ok"))
            && annotations.some((annotation) => annotation.type === "file_citation" && annotation.file_id === fileId)
            && /file-search-ok/i.test(text);
        },
      },
      {
        id: "responses-file-search-batch",
        mode: "responses-file-search",
        file: {
          filename: "bridge-file-search-batch.txt",
          purpose: "assistants",
          content: "Bridge file batch search fixture. The exact batch search answer is file-batch-ok. When asked for the exact answer, return file-batch-ok [1].",
        },
        vectorStore: { name: "bridge-file-search-batch-eval" },
        vectorFileBatch: ({ fileId }) => ({
          files: [{
            file_id: fileId,
            attributes: { suite: "bridge-regression-batch" },
          }],
        }),
        request: ({ vectorStoreId }) => ({
          model: defaultModel,
          input: "File search for file-batch-ok. Using the file search result, return exactly this text and nothing else: file-batch-ok [1]",
          tools: [{
            type: "file_search",
            vector_store_ids: [vectorStoreId],
            max_num_results: 3,
            filters: { type: "eq", key: "suite", value: "bridge-regression-batch" },
          }],
          include: ["file_search_call.results"],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, fileId, vectorStoreId, fileBatch }) => {
          const call = (json.output || []).find((item) => item.type === "file_search_call");
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          return fileBatch?.object === "vector_store.file_batch"
            && fileBatch.status === "completed"
            && fileBatch.file_counts?.completed === 1
            && !!call
            && call.status === "completed"
            && call.vector_store_ids?.includes(vectorStoreId)
            && call.results?.some((result) => result.file_id === fileId)
            && annotations.some((annotation) => annotation.type === "file_citation" && annotation.file_id === fileId)
            && /file-batch-ok/i.test(text);
        },
      },
      {
        id: "vector-store-lifecycle",
        mode: "vector-store-lifecycle",
        file: {
          filename: "bridge-vector-lifecycle.txt",
          purpose: "assistants",
          content: `${vectorChunkFixture("vector-lifecycle-ok")} A car maintenance note says technicians service sedans.`,
        },
        vectorFile: {
          chunking_strategy: {
            type: "static",
            static: { max_chunk_size_tokens: 100, chunk_overlap_tokens: 50 },
          },
        },
        check: ({ store, updatedStore, refreshedStore, attached, updatedFile, content, search, semanticSearch }) => store?.object === "vector_store"
          && updatedStore?.name === "bridge-vector-lifecycle-updated"
          && updatedStore?.metadata?.suite === "vector-lifecycle"
          && updatedStore?.expires_after?.days === 7
          && Number.isInteger(updatedStore?.expires_at)
          && refreshedStore?.last_active_at >= updatedStore?.last_active_at
          && refreshedStore?.expires_at >= updatedStore?.expires_at
          && attached?.object === "vector_store.file"
          && attached?.chunking_strategy?.static?.max_chunk_size_tokens === 100
          && updatedFile?.attributes?.suite === "vector-lifecycle-updated"
          && updatedFile?.attributes?.region === "emea"
          && content?.chunking_strategy?.static?.chunk_overlap_tokens === 50
          && content?.chunks?.some((chunk) => chunk.chunk_index === 1 && chunk.token_count === 100)
          && content?.content?.some((part) => /vector-lifecycle-ok/i.test(part.text || ""))
          && search?.search_queries?.includes("vectorword150")
          && search?.filters?.type === "and"
          && search?.ranking_options?.score_threshold === 0.8
          && search?.data?.some((result) => result.file_id === attached.id && Number.isInteger(result.chunk_index))
          && semanticSearch?.ranking_options?.hybrid_search?.local_mode === "hashed_semantic"
          && semanticSearch?.data?.some((result) => result.file_id === attached.id
            && result.text_score === 0
            && result.embedding_score >= 0.1
            && result.score_details?.local_embedding_dimensions === 256),
      },
      {
        id: "responses-compact-continuation",
        mode: "responses-compact",
        request: {
          model: defaultModel,
          input: [
            {
              role: "user",
              content: "For a compaction regression, remember the exact code word atlas-77.",
            },
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "I will preserve atlas-77 for the next turn." }],
            },
          ],
          max_output_tokens: 256,
          store: false,
        },
        followUp: ({ compactionOutput }) => ({
          model: defaultModel,
          input: [
            ...compactionOutput,
            {
              role: "user",
              content: "Using only the compacted context, return the exact code word.",
            },
          ],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json }) => json?.object === "response.compaction"
          && json.output?.some((item) => item.type === "compaction" && /^occomp1\./.test(item.encrypted_content || "")),
        followCheck: ({ text }) => /atlas-77/i.test(text),
      },
      {
        id: "responses-stream-events",
        mode: "responses-stream",
        request: {
          model: defaultModel,
          input: "Stream the exact string stream-ok.",
          stream: true,
          max_output_tokens: 256,
          store: false,
        },
        check: ({ text, events, json }) => {
          const types = new Set(events.map((event) => event.event));
          return /stream-ok/i.test(text)
            && types.has("response.created")
            && types.has("response.output_text.delta")
            && types.has("response.completed")
            && json?.metadata?.compatibility?.stream_options?.reason === "enabled_by_bridge"
            && (json.usage?.total_tokens || 0) > 0;
        },
      },
      {
        id: "responses-function-tool",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Call record_result with ok=true and label=\"tool-ok\". Do not answer in prose.",
          tools: [{
            type: "function",
            name: "record_result",
            description: "Record a benchmark result.",
            parameters: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                label: { type: "string" },
              },
              required: ["ok", "label"],
              additionalProperties: false,
            },
          }],
          tool_choice: { type: "function", name: "record_result" },
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json }) => {
          const call = (json.output || []).find((item) => item.type === "function_call");
          if (!call || call.name !== "record_result") return false;
          const parsed = parseJsonish(call.arguments);
          return parsed?.ok === true && parsed?.label === "tool-ok";
        },
      },
      {
        id: "responses-previous-response-replay",
        mode: "responses-sequence",
        steps: [
          {
            request: {
              model: defaultModel,
              input: "Remember the token orchid-42. Reply only stored.",
              max_output_tokens: 64,
              store: true,
            },
            check: ({ ok }) => ok,
          },
          {
            request: ({ previousResponseId }) => ({
              model: defaultModel,
              previous_response_id: previousResponseId,
              input: "What token did I ask you to remember? Reply with only the token.",
              max_output_tokens: 256,
              store: false,
            }),
            check: ({ text }) => /orchid-42/i.test(text),
          },
        ],
      },
    ],
  };
}

async function runCase(testCase, context) {
  const started = performance.now();
  try {
    if (testCase.mode === "responses-sequence") {
      return await runSequenceCase(testCase, context, started);
    }
    if (testCase.mode === "responses-stream") {
      return await runStreamingResponsesCase(testCase, context, started);
    }
    if (testCase.mode === "chat-lifecycle") {
      return await runChatLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "chat-stream-lifecycle") {
      return await runChatStreamLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "responses-input-tokens") {
      return await runInputTokensCase(testCase, context, started);
    }
    if (testCase.mode === "responses-input-file") {
      return await runInputFileCase(testCase, context, started);
    }
    if (testCase.mode === "responses-upload-input-file") {
      return await runUploadInputFileCase(testCase, context, started);
    }
    if (testCase.mode === "responses-input-file-url") {
      return await runInputFileUrlCase(testCase, context, started);
    }
    if (testCase.mode === "responses-background") {
      return await runBackgroundCase(testCase, context, started);
    }
    if (testCase.mode === "responses-lifecycle") {
      return await runResponsesLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "responses-conversation") {
      return await runConversationCase(testCase, context, started);
    }
    if (testCase.mode === "conversation-items-local") {
      return await runConversationItemsLocalCase(testCase, context, started);
    }
    if (testCase.mode === "responses-shell") {
      return await runShellCase(testCase, context, started);
    }
    if (testCase.mode === "responses-file-search") {
      return await runFileSearchCase(testCase, context, started);
    }
    if (testCase.mode === "vector-store-lifecycle") {
      return await runVectorStoreLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "responses-compact") {
      return await runCompactionCase(testCase, context, started);
    }
    if (testCase.mode === "model-get") {
      return await runModelGetCase(testCase, context, started);
    }
    if (testCase.mode === "batch-local" || testCase.mode === "batch-embeddings") {
      return await runBatchLocalCase(testCase, context, started);
    }
    if (testCase.mode === "chat") {
      return await runJsonCase(testCase, context, started, "/v1/chat/completions", chatOutputText, chatUsage);
    }
    if (testCase.mode === "embeddings") {
      return await runJsonCase(testCase, context, started, "/v1/embeddings", embeddingOutputText, embeddingUsage);
    }
    if (testCase.mode === "moderations") {
      return await runJsonCase(testCase, context, started, "/v1/moderations", moderationOutputText, moderationUsage);
    }
    if (testCase.mode === "completions") {
      return await runJsonCase(testCase, context, started, "/v1/completions", completionOutputText, completionUsage);
    }
    return await runJsonCase(testCase, context, started, "/v1/responses", responseOutputText, responseUsage);
  } catch (error) {
    return finishResult(testCase, context, started, {
      ok: false,
      error: error.message,
    });
  }
}

async function withTimeout(promise, ms, message, fallback) {
  let timeout = null;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } catch (error) {
    return {
      ...fallback,
      elapsed_ms: ms,
      ok: false,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runJsonCase(testCase, context, started, path, textSelector, usageSelector) {
  const request = resolveRequest(testCase.request, {});
  let responseId = null;
  try {
    const response = await postJson(`${baseUrl}${path}`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    if (path === "/v1/responses" && testCase.retrieveResponseInclude && request.store !== false) {
      responseId = json.id || null;
    }
    let hiddenResponse = { ok: false, status: 0, json: null };
    let includedResponse = { ok: false, status: 0, json: null };
    if (testCase.retrieveResponseInclude && json.id) {
      hiddenResponse = await getJson(`${baseUrl}/v1/responses/${json.id}`);
      const include = encodeURIComponent(testCase.retrieveResponseInclude);
      includedResponse = await getJson(`${baseUrl}/v1/responses/${json.id}?include[]=${include}`);
    }
    const text = textSelector(json);
    const ok = !!testCase.check({
      json,
      text,
      ok: response.ok,
      hiddenResponse: hiddenResponse.json,
      includedResponse: includedResponse.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      ...(testCase.retrieveResponseInclude ? {
        hidden_response_status: hiddenResponse.status,
        included_response_status: includedResponse.status,
      } : {}),
      usage: usageSelector(json),
      output_text: truncate(text),
    });
  } finally {
    if (responseId) await deleteJson(`${baseUrl}/v1/responses/${responseId}`);
  }
}

async function runStreamingResponsesCase(testCase, context, started) {
  const response = await postJson(`${baseUrl}/v1/responses`, testCase.request);
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const events = parseSseEvents(body);
  const text = events
    .filter((event) => event.event === "response.output_text.delta")
    .map((event) => event.data?.delta || "")
    .join("");
  const completed = events.findLast((event) => event.event === "response.completed")?.data?.response;
  const ok = !!testCase.check({ text, events, json: completed });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: responseUsage(completed || {}),
    output_text: truncate(text),
    event_count: events.length,
  });
}

async function runChatLifecycleCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/chat/completions`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const created = JSON.parse(createdBody);
  const fetched = await getJson(`${baseUrl}/v1/chat/completions/${created.id}`);
  let updated = { status: 0, ok: false, json: null, body: "" };
  const updatedMetadata = testCase.updateMetadata
    ? { ...testCase.updateMetadata, completion_id: created.id }
    : null;
  if (testCase.updateMetadata) {
    const updatedResponse = await postJson(`${baseUrl}/v1/chat/completions/${created.id}`, {
      metadata: updatedMetadata,
    });
    const updatedBody = await updatedResponse.text();
    updated = {
      status: updatedResponse.status,
      ok: updatedResponse.ok,
      json: parseJsonish(updatedBody),
      body: updatedBody,
    };
  }
  const messages = await getJson(`${baseUrl}/v1/chat/completions/${created.id}/messages?limit=20`);
  const listUrl = updatedMetadata?.completion_id
    ? `${baseUrl}/v1/chat/completions?metadata[completion_id]=${encodeURIComponent(updatedMetadata.completion_id)}&order=desc&limit=50`
    : `${baseUrl}/v1/chat/completions?order=desc&limit=50`;
  const list = await getJson(listUrl);
  const oldList = await getJson(`${baseUrl}/v1/chat/completions?metadata[suite]=chat-life-initial&order=desc&limit=50`);
  const deletion = await deleteJson(`${baseUrl}/v1/chat/completions/${created.id}`);
  const afterDelete = await getJson(`${baseUrl}/v1/chat/completions/${created.id}`);
  const postDeleteList = await getJson(listUrl);
  const text = chatOutputText(created);
  const ok = !!testCase.check({
    json: created,
    text,
    fetched: fetched.json,
    updated: updated.json,
    messages: messages.json,
    list: list.json,
    oldList: oldList.json,
    deleted: parseJsonish(deletion.body),
    afterDelete,
    postDeleteList: postDeleteList.json,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: createdResponse.status,
    usage: chatUsage(created),
    output_text: truncate(text),
    fetched_status: fetched.status,
    update_status: updated.status,
    messages_status: messages.status,
    list_status: list.status,
    old_list_status: oldList.status,
    delete_status: deletion.status,
    post_delete_get_status: afterDelete.status,
    post_delete_list_status: postDeleteList.status,
    message_count: Array.isArray(messages.json?.data) ? messages.json.data.length : 0,
    list_count: Array.isArray(list.json?.data) ? list.json.data.length : 0,
  });
}

async function runChatStreamLifecycleCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/chat/completions`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const events = parseSseEvents(createdBody);
  const chunks = events
    .map((event) => event.data)
    .filter((data) => data?.object === "chat.completion.chunk");
  const id = chunks.find((chunk) => chunk.id)?.id;
  const text = chunks
    .flatMap((chunk) => chunk.choices || [])
    .map((choice) => choice.delta?.content || "")
    .join("");

  if (!id) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: "stream did not include a chat completion id",
      output_text: truncate(text),
      event_count: events.length,
    });
  }

  const fetched = await getJson(`${baseUrl}/v1/chat/completions/${id}`);
  let updated = { status: 0, ok: false, json: null, body: "" };
  const updatedMetadata = testCase.updateMetadata
    ? { ...testCase.updateMetadata, completion_id: id }
    : null;
  if (testCase.updateMetadata) {
    const updatedResponse = await postJson(`${baseUrl}/v1/chat/completions/${id}`, {
      metadata: updatedMetadata,
    });
    const updatedBody = await updatedResponse.text();
    updated = {
      status: updatedResponse.status,
      ok: updatedResponse.ok,
      json: parseJsonish(updatedBody),
      body: updatedBody,
    };
  }
  const messages = await getJson(`${baseUrl}/v1/chat/completions/${id}/messages?limit=20`);
  const listUrl = updatedMetadata?.completion_id
    ? `${baseUrl}/v1/chat/completions?metadata[completion_id]=${encodeURIComponent(updatedMetadata.completion_id)}&order=desc&limit=50`
    : `${baseUrl}/v1/chat/completions?order=desc&limit=50`;
  const list = await getJson(listUrl);
  const oldList = await getJson(`${baseUrl}/v1/chat/completions?metadata[suite]=chat-stream-life-initial&order=desc&limit=50`);
  const deletion = await deleteJson(`${baseUrl}/v1/chat/completions/${id}`);
  const afterDelete = await getJson(`${baseUrl}/v1/chat/completions/${id}`);
  const postDeleteList = await getJson(listUrl);

  const ok = !!testCase.check({
    id,
    text,
    events,
    chunks,
    fetched: fetched.json,
    updated: updated.json,
    messages: messages.json,
    list: list.json,
    oldList: oldList.json,
    deleted: parseJsonish(deletion.body),
    afterDelete,
    postDeleteList: postDeleteList.json,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: createdResponse.status,
    usage: chatUsage(fetched.json),
    output_text: truncate(text),
    fetched_status: fetched.status,
    update_status: updated.status,
    messages_status: messages.status,
    list_status: list.status,
    old_list_status: oldList.status,
    delete_status: deletion.status,
    post_delete_get_status: afterDelete.status,
    post_delete_list_status: postDeleteList.status,
    message_count: Array.isArray(messages.json?.data) ? messages.json.data.length : 0,
    list_count: Array.isArray(list.json?.data) ? list.json.data.length : 0,
    event_count: events.length,
  });
}

async function runModelGetCase(testCase, context, started) {
  const modelId = encodeURIComponent(testCase.model || model);
  const response = await getJson(`${baseUrl}/v1/models/${modelId}`);
  const ok = response.ok && !!testCase.check({ json: response.json, ok: response.ok });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    model_id: response.json?.id || null,
    error: ok ? undefined : truncate(response.body),
  });
}

async function runBatchLocalCase(testCase, context, started) {
  const endpoint = testCase.endpoint || "/v1/embeddings";
  let inputFile = null;
  let batch = null;
  let outputText = "";
  let errorText = "";
  try {
    const jsonl = `${testCase.requests.map((request, index) => JSON.stringify({
      custom_id: request.custom_id || `request-${index + 1}`,
      method: "POST",
      url: endpoint,
      body: request.body,
    })).join("\n")}\n`;

    const fileResponse = await postJson(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}.jsonl`,
      purpose: "batch",
      content_base64: Buffer.from(jsonl, "utf8").toString("base64"),
      mime_type: "application/jsonl",
      metadata: { suite, case_id: testCase.id },
    });
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    inputFile = JSON.parse(fileBody);

    const batchResponse = await postJson(`${baseUrl}/v1/batches`, {
      input_file_id: inputFile.id,
      endpoint,
      completion_window: "24h",
      metadata: { suite, case_id: testCase.id },
    });
    const batchBody = await batchResponse.text();
    if (!batchResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: batchResponse.status,
        error: truncate(batchBody),
      });
    }
    batch = JSON.parse(batchBody);

    if (batch.output_file_id) outputText = await getText(`${baseUrl}/v1/files/${batch.output_file_id}/content`);
    if (batch.error_file_id) errorText = await getText(`${baseUrl}/v1/files/${batch.error_file_id}/content`);
    const outputLines = parseJsonl(outputText);
    const errorLines = parseJsonl(errorText);
    const fetched = await getJson(`${baseUrl}/v1/batches/${batch.id}`);
    const listed = await getJson(`${baseUrl}/v1/batches?limit=20`);
    const cancelledResponse = await postJson(`${baseUrl}/v1/batches/${batch.id}/cancel`, {});
    const cancelled = parseJsonish(await cancelledResponse.text());
    const ok = !!testCase.check({
      batch,
      outputText,
      outputLines,
      errorText,
      errorLines,
      fetched: fetched.json,
      listed: listed.json,
      cancelled,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: batchResponse.status,
      batch_id: batch.id,
      output_file_id: batch.output_file_id,
      error_file_id: batch.error_file_id,
      request_counts: batch.request_counts,
      output_line_count: outputLines.length,
      error_line_count: errorLines.length,
      fetched_status: fetched.status,
      list_status: listed.status,
      cancel_status: cancelledResponse.status,
      usage: sumUsage(outputLines.map((line) => batchResponseUsage(testCase, line.response?.body)).filter(Boolean)),
    });
  } finally {
    if (inputFile?.id) await deleteJson(`${baseUrl}/v1/files/${inputFile.id}`);
    if (batch?.output_file_id) await deleteJson(`${baseUrl}/v1/files/${batch.output_file_id}`);
    if (batch?.error_file_id) await deleteJson(`${baseUrl}/v1/files/${batch.error_file_id}`);
  }
}

async function runBackgroundCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/responses`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const created = JSON.parse(createdBody);
  const history = [created.status];
  let final = created;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    const fetched = await getJson(`${baseUrl}/v1/responses/${created.id}`);
    if (!fetched.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fetched.status,
        error: truncate(fetched.body),
        status_history: history,
      });
    }
    final = fetched.json;
    history.push(final.status);
    if (["completed", "failed", "cancelled", "incomplete"].includes(final.status)) break;
  }

  const text = responseOutputText(final);
  const ok = !!testCase.check({ created, final, text, history });
  return finishResult(testCase, context, started, {
    ok,
    status: 200,
    response_id: created.id,
    status_history: history,
    usage: responseUsage(final),
    output_text: truncate(text),
  });
}

async function runResponsesLifecycleCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/responses`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const created = JSON.parse(createdBody);
  const fetched = await getJson(`${baseUrl}/v1/responses/${created.id}`);
  const updatedMetadata = testCase.updateMetadata
    ? { ...testCase.updateMetadata, response_id: created.id }
    : null;
  let updated = { status: 0, ok: false, json: null, body: "" };
  if (updatedMetadata) {
    const updatedResponse = await postJson(`${baseUrl}/v1/responses/${created.id}`, {
      metadata: updatedMetadata,
    });
    const updatedBody = await updatedResponse.text();
    updated = {
      status: updatedResponse.status,
      ok: updatedResponse.ok,
      json: parseJsonish(updatedBody),
      body: updatedBody,
    };
  }
  const inputItems = await getJson(`${baseUrl}/v1/responses/${created.id}/input_items?limit=10`);
  const cancelResponse = await postJson(`${baseUrl}/v1/responses/${created.id}/cancel`, {});
  const cancelBody = await cancelResponse.text();
  const deletion = await deleteJson(`${baseUrl}/v1/responses/${created.id}`);
  const afterDelete = await getJson(`${baseUrl}/v1/responses/${created.id}`);
  const text = responseOutputText(created);
  const ok = !!testCase.check({
    created,
    text,
    fetched: fetched.json,
    updated: updated.json,
    inputItems: inputItems.json,
    cancelled: parseJsonish(cancelBody),
    deleted: parseJsonish(deletion.body),
    afterDelete,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: createdResponse.status,
    response_id: created.id,
    usage: responseUsage(created),
    output_text: truncate(text),
    fetched_status: fetched.status,
    update_status: updated.status,
    input_items_status: inputItems.status,
    cancel_status: cancelResponse.status,
    delete_status: deletion.status,
    post_delete_get_status: afterDelete.status,
    input_item_count: Array.isArray(inputItems.json?.data) ? inputItems.json.data.length : 0,
  });
}

async function runConversationCase(testCase, context, started) {
  let conversation = null;
  try {
    const conversationResponse = await postJson(`${baseUrl}/v1/conversations`, testCase.conversation || {});
    const conversationBody = await conversationResponse.text();
    if (!conversationResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: conversationResponse.status,
        error: truncate(conversationBody),
      });
    }
    conversation = JSON.parse(conversationBody);

    const stepResults = [];
    let inputTokensJson = null;
    if (testCase.inputTokens) {
      const tokenRequest = resolveRequest(testCase.inputTokens, { ...context, conversationId: conversation.id });
      const tokenResponse = await postJson(`${baseUrl}/v1/responses/input_tokens`, tokenRequest);
      const tokenBody = await tokenResponse.text();
      if (!tokenResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: tokenResponse.status,
          conversation_id: conversation.id,
          error: `input_tokens: ${truncate(tokenBody)}`,
          steps: stepResults,
        });
      }
      inputTokensJson = JSON.parse(tokenBody);
      stepResults.push({
        step: "input_tokens",
        ok: inputTokensJson.input_tokens > 0,
        input_tokens: inputTokensJson.input_tokens || 0,
        usage: {
          input_tokens: inputTokensJson.input_tokens || 0,
          output_tokens: 0,
          total_tokens: inputTokensJson.input_tokens || 0,
        },
      });
    }

    const request = resolveRequest(testCase.request, { ...context, conversationId: conversation.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        conversation_id: conversation.id,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    stepResults.push({
      step: "response",
      ok: response.ok,
      response_id: json.id,
      output_text: truncate(text),
      usage: responseUsage(json),
    });

    let compactJson = null;
    if (testCase.compact) {
      const compactRequest = resolveRequest(testCase.compact, { ...context, conversationId: conversation.id, response: json });
      const compactResponse = await postJson(`${baseUrl}/v1/responses/compact`, compactRequest);
      const compactBody = await compactResponse.text();
      if (!compactResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: compactResponse.status,
          conversation_id: conversation.id,
          error: `compact: ${truncate(compactBody)}`,
          steps: stepResults,
        });
      }
      compactJson = JSON.parse(compactBody);
      stepResults.push({
        step: "compact",
        ok: compactJson.object === "response.compaction",
        output_items: Array.isArray(compactJson.output) ? compactJson.output.length : 0,
        usage: responseUsage(compactJson),
      });
    }

    const createdConversation = conversation;
    const items = await getJson(`${baseUrl}/v1/conversations/${conversation.id}/items?limit=20`);
    const deletion = await deleteJson(`${baseUrl}/v1/conversations/${conversation.id}`);
    const deleted = parseJsonish(deletion.body);
    const afterDelete = await getJson(`${baseUrl}/v1/conversations/${conversation.id}`);
    conversation = null;
    const ok = !!testCase.check({
      conversation: createdConversation,
      response: json,
      text,
      items: items.json,
      inputTokens: inputTokensJson,
      compact: compactJson,
      deleted,
      afterDelete,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      steps: stepResults,
      conversation_id: json.conversation || null,
      item_count: Array.isArray(items.json?.data) ? items.json.data.length : 0,
      delete_status: deletion.status,
      post_delete_get_status: afterDelete.status,
      usage: sumUsage(stepResults.map((step) => step.usage).filter(Boolean)),
      output_text: truncate(text),
    });
  } finally {
    if (conversation?.id) await deleteJson(`${baseUrl}/v1/conversations/${conversation.id}`);
  }
}

async function runConversationItemsLocalCase(testCase, context, started) {
  let conversation = null;
  try {
    const conversationResponse = await postJson(`${baseUrl}/v1/conversations`, testCase.conversation || {});
    const conversationBody = await conversationResponse.text();
    if (!conversationResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: conversationResponse.status,
        error: truncate(conversationBody),
      });
    }
    conversation = JSON.parse(conversationBody);

    const include = encodeURIComponent(testCase.include || "message.input_image.image_url");
    const hiddenItems = await getJson(`${baseUrl}/v1/conversations/${conversation.id}/items?limit=20`);
    const includedItems = await getJson(`${baseUrl}/v1/conversations/${conversation.id}/items?limit=20&include[]=${include}`);
    const firstItemId = includedItems.json?.data?.[0]?.id || hiddenItems.json?.data?.[0]?.id;
    const hiddenItem = firstItemId
      ? await getJson(`${baseUrl}/v1/conversations/${conversation.id}/items/${firstItemId}`)
      : { ok: false, status: 0, json: null };
    const includedItem = firstItemId
      ? await getJson(`${baseUrl}/v1/conversations/${conversation.id}/items/${firstItemId}?include=${include}`)
      : { ok: false, status: 0, json: null };
    const createdConversation = conversation;
    const deletion = await deleteJson(`${baseUrl}/v1/conversations/${conversation.id}`);
    const deleted = parseJsonish(deletion.body);
    conversation = null;

    const ok = !!testCase.check({
      conversation: createdConversation,
      hiddenItems: hiddenItems.json,
      includedItems: includedItems.json,
      hiddenItem: hiddenItem.json,
      includedItem: includedItem.json,
      deleted,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: conversationResponse.status,
      conversation_id: createdConversation.id,
      hidden_items_status: hiddenItems.status,
      included_items_status: includedItems.status,
      hidden_item_status: hiddenItem.status,
      included_item_status: includedItem.status,
      delete_status: deletion.status,
      item_count: Array.isArray(includedItems.json?.data) ? includedItems.json.data.length : 0,
    });
  } finally {
    if (conversation?.id) await deleteJson(`${baseUrl}/v1/conversations/${conversation.id}`);
  }
}

async function runFileSearchCase(testCase, context, started) {
  let file = null;
  let vectorStore = null;
  let fileBatch = null;
  let responseId = null;
  try {
    const fileResponse = await postJson(`${baseUrl}/v1/files`, testCase.file);
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    file = JSON.parse(fileBody);

    const storeResponse = await postJson(`${baseUrl}/v1/vector_stores`, testCase.vectorStore || {});
    const storeBody = await storeResponse.text();
    if (!storeResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: storeResponse.status,
        error: truncate(storeBody),
      });
    }
    vectorStore = JSON.parse(storeBody);

    if (testCase.vectorFileBatch) {
      const batchRequest = resolveRequest(testCase.vectorFileBatch, { ...context, fileId: file.id, vectorStoreId: vectorStore.id });
      const batchResponse = await postJson(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches`, batchRequest);
      const batchBody = await batchResponse.text();
      if (!batchResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: batchResponse.status,
          error: truncate(batchBody),
        });
      }
      fileBatch = JSON.parse(batchBody);
    } else {
      const attachResponse = await postJson(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files`, {
        file_id: file.id,
        ...(testCase.vectorFile || {}),
      });
      const attachBody = await attachResponse.text();
      if (!attachResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: attachResponse.status,
          error: truncate(attachBody),
        });
      }
    }

    const request = resolveRequest(testCase.request, { ...context, fileId: file.id, vectorStoreId: vectorStore.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    responseId = request.store !== false ? json.id || null : null;
    let hiddenResponse = { ok: false, status: 0, json: null };
    let includedResponse = { ok: false, status: 0, json: null };
    if (testCase.retrieveResponseInclude && json.id) {
      hiddenResponse = await getJson(`${baseUrl}/v1/responses/${json.id}`);
      const include = encodeURIComponent(testCase.retrieveResponseInclude);
      includedResponse = await getJson(`${baseUrl}/v1/responses/${json.id}?include[]=${include}`);
    }
    const text = responseOutputText(json);
    const ok = !!testCase.check({
      json,
      text,
      fileId: file.id,
      vectorStoreId: vectorStore.id,
      fileBatch,
      hiddenResponse: hiddenResponse.json,
      includedResponse: includedResponse.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      file_id: file.id,
      vector_store_id: vectorStore.id,
      ...(fileBatch?.id ? { file_batch_id: fileBatch.id, file_batch_status: fileBatch.status } : {}),
      ...(testCase.retrieveResponseInclude ? {
        hidden_response_status: hiddenResponse.status,
        included_response_status: includedResponse.status,
      } : {}),
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (responseId) await deleteJson(`${baseUrl}/v1/responses/${responseId}`);
    if (vectorStore?.id) await deleteJson(`${baseUrl}/v1/vector_stores/${vectorStore.id}`);
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runVectorStoreLifecycleCase(testCase, context, started) {
  let file = null;
  let store = null;
  try {
    const fileResponse = await postJson(`${baseUrl}/v1/files`, testCase.file);
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    file = JSON.parse(fileBody);

    const storeResponse = await postJson(`${baseUrl}/v1/vector_stores`, {
      name: "bridge-vector-lifecycle",
      metadata: { suite: "vector-lifecycle-initial" },
    });
    const storeBody = await storeResponse.text();
    if (!storeResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: storeResponse.status,
        error: truncate(storeBody),
      });
    }
    store = JSON.parse(storeBody);

    const updatedStoreResponse = await postJson(`${baseUrl}/v1/vector_stores/${store.id}`, {
      name: "bridge-vector-lifecycle-updated",
      metadata: { suite: "vector-lifecycle" },
      expires_after: { anchor: "last_active_at", days: 7 },
    });
    const updatedStoreBody = await updatedStoreResponse.text();
    if (!updatedStoreResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: updatedStoreResponse.status,
        error: truncate(updatedStoreBody),
      });
    }
    const updatedStore = JSON.parse(updatedStoreBody);

    const attachResponse = await postJson(`${baseUrl}/v1/vector_stores/${store.id}/files`, {
      file_id: file.id,
      attributes: { suite: "vector-lifecycle-initial" },
      ...(testCase.vectorFile || {}),
    });
    const attachBody = await attachResponse.text();
    if (!attachResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: attachResponse.status,
        error: truncate(attachBody),
      });
    }
    const attached = JSON.parse(attachBody);

    const updatedFileResponse = await postJson(`${baseUrl}/v1/vector_stores/${store.id}/files/${file.id}`, {
      attributes: {
        suite: "vector-lifecycle-updated",
        region: "emea",
        year: 2026,
        archived: false,
      },
    });
    const updatedFileBody = await updatedFileResponse.text();
    if (!updatedFileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: updatedFileResponse.status,
        error: truncate(updatedFileBody),
      });
    }
    const updatedFile = JSON.parse(updatedFileBody);

    const content = await getJson(`${baseUrl}/v1/vector_stores/${store.id}/files/${file.id}/content`);
    if (!content.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: content.status,
        error: truncate(content.body),
      });
    }

    const searchResponse = await postJson(`${baseUrl}/v1/vector_stores/${store.id}/search`, {
      query: ["vector-lifecycle-ok", "vectorword150"],
      attribute_filter: {
        type: "and",
        filters: [
          { type: "eq", key: "suite", value: "vector-lifecycle-updated" },
          { type: "gte", key: "year", value: 2025 },
          { type: "ne", key: "archived", value: true },
          {
            type: "or",
            filters: [
              { type: "eq", key: "region", value: "emea" },
              { type: "eq", key: "region", value: "apac" },
            ],
          },
        ],
      },
      max_num_results: 50,
      ranking_options: { score_threshold: 0.8 },
    });
    const searchBody = await searchResponse.text();
    if (!searchResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchResponse.status,
        error: truncate(searchBody),
      });
    }
    const search = JSON.parse(searchBody);

    const semanticSearchResponse = await postJson(`${baseUrl}/v1/vector_stores/${store.id}/search`, {
      query: "automobile repair",
      attribute_filter: { type: "eq", key: "suite", value: "vector-lifecycle-updated" },
      max_num_results: 3,
      ranking_options: {
        score_threshold: 0.1,
        hybrid_search: { embedding_weight: 1, text_weight: 0 },
      },
    });
    const semanticSearchBody = await semanticSearchResponse.text();
    if (!semanticSearchResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: semanticSearchResponse.status,
        error: truncate(semanticSearchBody),
      });
    }
    const semanticSearch = JSON.parse(semanticSearchBody);

    const refreshedStore = await getJson(`${baseUrl}/v1/vector_stores/${store.id}`);
    if (!refreshedStore.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: refreshedStore.status,
        error: truncate(refreshedStore.body),
      });
    }

    const ok = !!testCase.check({
      file,
      store,
      updatedStore,
      refreshedStore: refreshedStore.json,
      attached,
      updatedFile,
      content: content.json,
      search,
      semanticSearch,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: 200,
      file_id: file.id,
      vector_store_id: store.id,
      vector_store_file_status: updatedFile.status,
      content_parts: content.json.content?.length || 0,
      search_results: search.data?.length || 0,
      semantic_search_results: semanticSearch.data?.length || 0,
    });
  } finally {
    if (store?.id) await deleteJson(`${baseUrl}/v1/vector_stores/${store.id}`);
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runInputFileCase(testCase, context, started) {
  let file = null;
  try {
    const fileResponse = await postJson(`${baseUrl}/v1/files`, testCase.file);
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    file = JSON.parse(fileBody);

    const request = resolveRequest(testCase.request, { ...context, fileId: file.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, fileId: file.id });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      file_id: file.id,
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runUploadInputFileCase(testCase, context, started) {
  let file = null;
  try {
    const fixture = testCase.upload || {};
    const contentBuffer = fixture.content_base64
      ? Buffer.from(String(fixture.content_base64), "base64")
      : Buffer.from(String(fixture.content || ""), "utf8");
    const splitAt = Math.max(1, Math.floor(contentBuffer.length / 2));
    const firstChunk = contentBuffer.subarray(0, splitAt);
    const secondChunk = contentBuffer.subarray(splitAt);
    const uploadResponse = await postJson(`${baseUrl}/v1/uploads`, {
      filename: fixture.filename || "bridge-upload.txt",
      purpose: fixture.purpose || "user_data",
      bytes: contentBuffer.length,
      mime_type: fixture.mime_type || "text/plain",
      expires_after: { anchor: "created_at", seconds: 3600 },
    });
    const uploadBody = await uploadResponse.text();
    if (!uploadResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: uploadResponse.status,
        error: truncate(uploadBody),
      });
    }
    const upload = JSON.parse(uploadBody);

    const secondPartResponse = await postJson(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      data_base64: secondChunk.toString("base64"),
    });
    const secondPartBody = await secondPartResponse.text();
    if (!secondPartResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: secondPartResponse.status,
        upload_id: upload.id,
        error: truncate(secondPartBody),
      });
    }
    const secondPart = JSON.parse(secondPartBody);

    const firstPartResponse = await postRaw(
      `${baseUrl}/v1/uploads/${upload.id}/parts`,
      firstChunk,
      fixture.mime_type || "application/octet-stream",
    );
    const firstPartBody = await firstPartResponse.text();
    if (!firstPartResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: firstPartResponse.status,
        upload_id: upload.id,
        error: truncate(firstPartBody),
      });
    }
    const firstPart = JSON.parse(firstPartBody);

    const completeResponse = await postJson(`${baseUrl}/v1/uploads/${upload.id}/complete`, {
      part_ids: [firstPart.id, secondPart.id],
    });
    const completeBody = await completeResponse.text();
    if (!completeResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: completeResponse.status,
        upload_id: upload.id,
        error: truncate(completeBody),
      });
    }
    const completed = JSON.parse(completeBody);
    file = completed.file || null;

    const request = resolveRequest(testCase.request, { ...context, fileId: file?.id, upload: completed });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        upload_id: upload.id,
        file_id: file?.id || null,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, upload: completed, fileId: file?.id });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      upload_id: upload.id,
      file_id: file?.id || null,
      part_ids: [firstPart.id, secondPart.id],
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runInputFileUrlCase(testCase, context, started) {
  const fixture = testCase.fileUrl || {};
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": fixture.contentType || "text/plain" });
    res.end(fixture.content || "");
  });

  try {
    const address = await listenServer(server);
    const fileUrl = `http://127.0.0.1:${address.port}/${encodeURIComponent(fixture.filename || "fixture.txt")}`;
    const request = resolveRequest(testCase.request, { ...context, fileUrl });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        file_url: fileUrl,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, fileUrl });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      file_url: fileUrl,
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    await closeServer(server);
  }
}

async function runShellCase(testCase, context, started) {
  let container = null;
  let skill = null;
  let responseId = null;
  try {
    if (testCase.skill) {
      const skillResponse = await postJson(`${baseUrl}/v1/skills`, testCase.skill);
      const skillBody = await skillResponse.text();
      if (!skillResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: skillResponse.status,
          error: truncate(skillBody),
        });
      }
      skill = JSON.parse(skillBody);
    }

    const containerResponse = await postJson(`${baseUrl}/v1/containers`, testCase.container || {});
    const containerBody = await containerResponse.text();
    if (!containerResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: containerResponse.status,
        error: truncate(containerBody),
      });
    }
    container = JSON.parse(containerBody);

    const request = resolveRequest(testCase.request, { ...context, containerId: container.id, skillId: skill?.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    responseId = request.store !== false ? json.id || null : null;
    let hiddenResponse = { ok: false, status: 0, json: null };
    let includedResponse = { ok: false, status: 0, json: null };
    if (testCase.retrieveResponseInclude && json.id) {
      hiddenResponse = await getJson(`${baseUrl}/v1/responses/${json.id}`);
      const include = encodeURIComponent(testCase.retrieveResponseInclude);
      includedResponse = await getJson(`${baseUrl}/v1/responses/${json.id}?include[]=${include}`);
    }
    const files = await getJson(`${baseUrl}/v1/containers/${container.id}/files`);
    const artifact = files.ok
      ? files.json.data?.find((file) => file.path === "/shell.txt")
      : null;
    let artifactText = "";
    if (artifact) {
      const contentResponse = await fetch(`${baseUrl}/v1/containers/${container.id}/files/${artifact.id}/content`);
      if (contentResponse.ok) artifactText = await contentResponse.text();
    }
    const text = responseOutputText(json);
    const ok = !!testCase.check({
      json,
      text,
      containerId: container.id,
      skillId: skill?.id,
      artifactText,
      hiddenResponse: hiddenResponse.json,
      includedResponse: includedResponse.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      container_id: container.id,
      ...(skill ? { skill_id: skill.id } : {}),
      artifact_text: truncate(artifactText),
      ...(testCase.retrieveResponseInclude ? {
        hidden_response_status: hiddenResponse.status,
        included_response_status: includedResponse.status,
      } : {}),
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (responseId) await deleteJson(`${baseUrl}/v1/responses/${responseId}`);
    if (container?.id) await deleteJson(`${baseUrl}/v1/containers/${container.id}`);
    if (skill?.id) await deleteJson(`${baseUrl}/v1/skills/${skill.id}`);
  }
}

async function runCompactionCase(testCase, context, started) {
  const compactResponse = await postJson(`${baseUrl}/v1/responses/compact`, testCase.request);
  const compactBody = await compactResponse.text();
  if (!compactResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: compactResponse.status,
      error: truncate(compactBody),
    });
  }

  const compactJson = JSON.parse(compactBody);
  const compactOk = !!testCase.check({ json: compactJson, ok: compactResponse.ok });
  const stepResults = [{
    step: "compact",
    ok: compactOk,
    output_items: Array.isArray(compactJson.output) ? compactJson.output.length : 0,
    usage: responseUsage(compactJson),
  }];
  if (!compactOk || !testCase.followUp) {
    return finishResult(testCase, context, started, {
      ok: compactOk,
      status: compactResponse.status,
      steps: stepResults,
      usage: sumUsage(stepResults.map((step) => step.usage)),
    });
  }

  const followResponse = await postJson(`${baseUrl}/v1/responses`, testCase.followUp({ compactionOutput: compactJson.output || [] }));
  const followBody = await followResponse.text();
  if (!followResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: followResponse.status,
      error: truncate(followBody),
      steps: stepResults,
    });
  }

  const followJson = JSON.parse(followBody);
  const text = responseOutputText(followJson);
  const followOk = !!testCase.followCheck({ json: followJson, text, ok: followResponse.ok });
  stepResults.push({
    step: "follow-up",
    ok: followOk,
    output_text: truncate(text),
    usage: responseUsage(followJson),
  });
  return finishResult(testCase, context, started, {
    ok: followOk,
    status: followResponse.status,
    steps: stepResults,
    usage: sumUsage(stepResults.map((step) => step.usage)),
    output_text: truncate(text),
  });
}

async function runInputTokensCase(testCase, context, started) {
  const response = await postJson(`${baseUrl}/v1/responses/input_tokens`, testCase.request);
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const json = JSON.parse(body);
  const ok = !!testCase.check({ json, ok: response.ok });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: {
      input_tokens: json.input_tokens || 0,
      output_tokens: 0,
      total_tokens: json.input_tokens || 0,
    },
    input_tokens: json.input_tokens || 0,
  });
}

async function runSequenceCase(testCase, context, started) {
  const stepResults = [];
  let previousResponseId = null;
  for (const [index, step] of testCase.steps.entries()) {
    const response = await postJson(`${baseUrl}/v1/responses`, resolveRequest(step.request, { previousResponseId }));
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: `step ${index + 1}: ${truncate(body)}`,
        steps: stepResults,
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!step.check({ json, text, ok: response.ok });
    stepResults.push({
      step: index + 1,
      ok,
      response_id: json.id,
      output_text: truncate(text),
      usage: responseUsage(json),
    });
    if (!ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        steps: stepResults,
      });
    }
    previousResponseId = json.id;
  }

  return finishResult(testCase, context, started, {
    ok: true,
    status: 200,
    steps: stepResults,
    usage: sumUsage(stepResults.map((step) => step.usage)),
  });
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postRaw(url, body, contentType = "application/octet-stream") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      json: parseJsonish(body),
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "DELETE", signal: controller.signal });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  } catch {
    return { status: 0, ok: false, body: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRequest(request, context) {
  return typeof request === "function" ? request(context) : request;
}

function listenServer(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function finishResult(testCase, context, started, extra) {
  return {
    id: testCase.id,
    mode: testCase.mode || "responses",
    iteration: context.iteration,
    elapsed_ms: Math.round(performance.now() - started),
    ...extra,
  };
}

function makeReport({ suite, model, baseUrl, repeat, startedAt, results }) {
  const passed = results.filter((result) => result.ok).length;
  const latencies = results.map((result) => result.elapsed_ms).sort((a, b) => a - b);
  const usage = sumUsage(results.map((result) => result.usage).filter(Boolean));
  return {
    suite,
    model,
    base_url: baseUrl,
    repeat,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: {
      passed,
      total: results.length,
      pass_rate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
      latency_ms_avg: average(latencies),
      latency_ms_p95: percentile(latencies, 0.95),
      usage,
    },
    results,
  };
}

function responseOutputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function chatOutputText(response) {
  return (response.choices || [])
    .map((choice) => choice.message?.content || "")
    .join("");
}

function completionOutputText(response) {
  return (response.choices || [])
    .map((choice) => choice.text || "")
    .join("");
}

function embeddingOutputText(response) {
  return `embeddings:${response?.data?.length || 0}x${response?.data?.[0]?.embedding?.length || 0}`;
}

function moderationOutputText(response) {
  const results = response?.results || [];
  const flagged = results.filter((result) => result?.flagged).length;
  return `moderations:${results.length}:flagged:${flagged}`;
}

function responseUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function chatUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function completionUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function embeddingUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function moderationUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function batchResponseUsage(testCase, response) {
  if (testCase.usage === "embeddings") return embeddingUsage(response);
  if (testCase.usage === "responses") return responseUsage(response);
  if (testCase.usage === "chat") return chatUsage(response);
  if (testCase.usage === "completions") return completionUsage(response);
  return moderationUsage(response);
}

function sumUsage(values) {
  return values.reduce((sum, value) => ({
    input_tokens: sum.input_tokens + (value?.input_tokens || 0),
    output_tokens: sum.output_tokens + (value?.output_tokens || 0),
    total_tokens: sum.total_tokens + (value?.total_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function parseSseEvents(body) {
  return body.split(/\n\n+/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const event = frame.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return { event, data: parseJsonish(data) };
    });
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function jsonHas(text, key, expected) {
  const parsed = parseJsonish(text);
  return parsed?.[key] === expected;
}

function parseJsonish(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}

function truncate(value, max = 1000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
