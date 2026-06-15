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
const ASSISTANT_RUN_STEP_FILE_SEARCH_CONTENT_INCLUDE = "step_details.tool_calls[*].file_search.results[*].content";

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
        reasoning: { effort: "none" },
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
        reasoning: { effort: "none" },
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
  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const tinyMaskPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lC7V7wAAAABJRU5ErkJggg==";
  const tinyAudioBase64 = Buffer.from("tiny eval audio", "utf8").toString("base64");

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
        id: "realtime-lifecycle",
        mode: "realtime-lifecycle",
        request: {
          session: {
            type: "realtime",
            model: "gpt-realtime",
            instructions: "Keep responses short for bridge regression.",
            output_modalities: ["text"],
          },
        },
        check: ({ session, clientSecret, transcription, translationSecret, accepted, referred, hungup, rejected }) => session?.id?.startsWith("sess_")
          && session.object === "realtime.session"
          && /^ek_/.test(session.client_secret?.value || "")
          && session.compatibility?.provider === "local"
          && clientSecret?.value?.startsWith("ek_")
          && clientSecret.session?.object === "realtime.session"
          && transcription?.object === "realtime.transcription_session"
          && /^ek_/.test(transcription.client_secret?.value || "")
          && translationSecret?.session?.type === "translation"
          && accepted?.status === "accepted"
          && referred?.status === "referred"
          && referred?.refer_to === "sip:+12025550123@sip.example.com"
          && hungup?.status === "completed"
          && rejected?.status === "rejected",
      },
      {
        id: "fine-tuning-lifecycle",
        mode: "fine-tuning-lifecycle",
        request: {
          model: "gpt-4o-mini",
        },
        check: ({ job, fetched, jobs, events, checkpoints, permissionCreate, permissionList, permissionDelete, paused, resumed, cancelled, missingJob }) => job?.id?.startsWith("ftjob_")
          && job.object === "fine_tuning.job"
          && job.status === "succeeded"
          && job.compatibility?.provider === "local"
          && fetched?.id === job.id
          && jobs?.data?.some((entry) => entry.id === job.id)
          && events?.data?.some((event) => event.object === "fine_tuning.job.event" && /fine-tuned model/i.test(event.message || ""))
          && checkpoints?.data?.some((checkpoint) => checkpoint.object === "fine_tuning.job.checkpoint" && checkpoint.fine_tuning_job_id === job.id)
          && permissionCreate?.data?.length === 2
          && permissionCreate.data.every((permission) => permission.object === "checkpoint.permission")
          && permissionList?.data?.length === 1
          && permissionList.data[0].project_id === "proj_bridge_regression_a"
          && permissionDelete?.deleted === true
          && paused?.status === "paused"
          && resumed?.status === "queued"
          && cancelled?.status === "cancelled"
          && missingJob?.status === 404,
      },
      {
        id: "organization-usage-costs",
        mode: "organization-usage-costs",
        check: ({ costs, completions, images, fileSearch, webSearch, invalidBucket, missingStart }) => costs?.object === "page"
          && costs.data?.[0]?.results?.[0]?.object === "organization.costs.result"
          && costs.data[0].results[0].amount?.value === 0
          && costs.compatibility?.actual_openai_admin_data === false
          && completions?.data?.[0]?.results?.[0]?.object === "organization.usage.completions.result"
          && completions.data[0].results[0].input_tokens === 0
          && images?.data?.[0]?.results?.[0]?.object === "organization.usage.images.result"
          && images.data[0].results[0].images === 0
          && fileSearch?.data?.[0]?.results?.[0]?.object === "organization.usage.file_searches.result"
          && fileSearch.data[0].results[0].num_requests === 0
          && webSearch?.data?.[0]?.results?.[0]?.object === "organization.usage.web_searches.result"
          && webSearch.data[0].results[0].num_model_requests === 0
          && invalidBucket?.status === 400
          && missingStart?.status === 400,
      },
      {
        id: "chatkit-lifecycle",
        mode: "chatkit-lifecycle",
        request: {
          workflow: { id: "workflow_bridge_regression", version: "2026-06-15" },
          scope: { project: "open-codex", environment: "bridge-regression" },
        },
        check: ({ session, cancelled, thread, updatedThread, item, items, threads, deleted, missingThread }) => session?.id?.startsWith("csess_")
          && session.object === "chatkit.session"
          && /^chatkit_token_/.test(session.client_secret || "")
          && session.workflow?.id === "workflow_bridge_regression"
          && cancelled?.status === "cancelled"
          && thread?.id?.startsWith("cthr_")
          && thread.object === "chatkit.thread"
          && thread.user === session.user
          && updatedThread?.title === "ChatKit lifecycle updated"
          && item?.id?.startsWith("citm_")
          && item.thread_id === thread.id
          && items?.data?.some((entry) => entry.id === item.id)
          && threads?.data?.some((entry) => entry.id === thread.id)
          && deleted?.deleted === true
          && missingThread?.status === 404,
      },
      {
        id: "audio-speech",
        mode: "audio-speech",
        request: {
          model: "gpt-4o-mini-tts",
          input: "Exercise direct Audio speech compatibility.",
          voice: "alloy",
          response_format: "wav",
        },
        check: ({ contentType, bytes, buffer }) => contentType === "audio/wav"
          && bytes > 44
          && buffer.subarray(0, 4).toString("ascii") === "RIFF"
          && buffer.subarray(8, 12).toString("ascii") === "WAVE",
      },
      {
        id: "audio-transcription",
        mode: "audio-transcription",
        request: {
          model: "gpt-4o-transcribe",
          file: {
            data: `data:audio/wav;base64,${tinyAudioBase64}`,
            filename: "eval-transcribe.wav",
          },
          response_format: "verbose_json",
        },
        check: ({ json, text }) => json?.task === "transcribe"
          && /eval-transcribe\.wav/i.test(text)
          && json.compatibility?.operation === "audio_transcription"
          && json.usage?.type === "duration",
      },
      {
        id: "audio-translation",
        mode: "audio-translation",
        request: {
          model: "whisper-1",
          file: {
            data: `data:audio/wav;base64,${tinyAudioBase64}`,
            filename: "eval-translate.wav",
          },
          response_format: "json",
        },
        check: ({ json, text }) => /translation in English/i.test(text)
          && json.compatibility?.operation === "audio_translation"
          && json.usage?.type === "duration",
      },
      {
        id: "audio-voice-lifecycle",
        mode: "audio-voice-lifecycle",
        request: {
          language: "en-US",
        },
        check: ({ consent, voice, consentList, voiceList, consentGet, voiceGet }) => consent?.id?.startsWith("cons_")
          && consent.object === "audio.voice_consent"
          && consent.recording?.sha256
          && voice?.id?.startsWith("voice_")
          && voice.object === "audio.voice"
          && voice.consent === consent.id
          && voice.compatibility?.synthetic_voice_model_created === false
          && consentGet?.id === consent.id
          && voiceGet?.id === voice.id
          && Array.isArray(consentList?.data)
          && consentList.data.some((item) => item.id === consent.id)
          && Array.isArray(voiceList?.data)
          && voiceList.data.some((item) => item.id === voice.id),
      },
      {
        id: "assistants-lifecycle",
        mode: "assistants-lifecycle",
        request: {
          model: defaultModel,
        },
        check: ({ assistant, thread, run, messages, runs, steps, step, streamEvents, streamMessage, streamDeltaText }) => assistant?.id?.startsWith("asst_")
          && thread?.id?.startsWith("thread_")
          && run?.id?.startsWith("run_")
          && run.status === "completed"
          && run.metadata?.compatibility?.local_assistants?.upstream === "chat_completions"
          && messages?.data?.some((message) => message.role === "assistant" && /assistants-life-ok/i.test(message.content?.[0]?.text?.value || ""))
          && runs?.data?.some((item) => item.id === run.id)
          && steps?.data?.length === 1
          && step?.id === steps?.data?.[0]?.id
          && streamEvents?.some((event) => event.event === "thread.message.created")
          && streamEvents?.some((event) => event.event === "thread.message.delta")
          && streamEvents?.some((event) => event.event === "thread.run.completed")
          && /assistants-stream-ok/i.test(streamDeltaText || "")
          && /assistants-stream-ok/i.test(streamMessage?.content?.[0]?.text?.value || ""),
      },
      {
        id: "assistants-required-action",
        mode: "assistants-required-action",
        request: {
          model: defaultModel,
        },
        check: ({ assistant, thread, firstRun, finalRun, messages, steps, toolCallCount, messageLock, runLock }) => assistant?.id?.startsWith("asst_")
          && thread?.id?.startsWith("thread_")
          && firstRun?.status === "requires_action"
          && messageLock?.status === 400
          && messageLock?.json?.error?.code === "thread_locked"
          && runLock?.status === 400
          && runLock?.json?.error?.code === "thread_locked"
          && finalRun?.status === "completed"
          && finalRun.metadata?.compatibility?.local_assistants?.upstream === "chat_completions"
          && finalRun.metadata?.compatibility?.local_assistants?.tool_calls_supported === true
          && toolCallCount >= 1
          && messages?.data?.some((message) => message.role === "assistant" && /assistants-tool-ok/i.test(message.content?.[0]?.text?.value || ""))
          && steps?.data?.some((step) => step.type === "tool_calls")
          && steps?.data?.some((step) => step.type === "message_creation"),
      },
      {
        id: "assistants-reasoning-effort-none",
        mode: "assistants-reasoning-effort",
        request: {
          model: defaultModel,
        },
        check: ({ run, fetchedRun, runs, messages }) => run?.status === "completed"
          && run.reasoning_effort === "none"
          && fetchedRun?.reasoning_effort === "none"
          && runs?.data?.some((item) => item.id === run.id && item.reasoning_effort === "none")
          && run.metadata?.compatibility?.local_assistants?.chat_passthrough?.reasoning_effort?.reason === "deepseek_thinking_disabled"
          && run.metadata?.compatibility?.local_assistants?.chat_passthrough?.reasoning_effort?.forwarded === false
          && messages?.data?.some((message) => message.role === "assistant"
            && /assistants-reasoning-effort-live-ok/i.test(message.content?.[0]?.text?.value || "")),
      },
      {
        id: "assistants-truncation",
        mode: "assistants-truncation",
        request: {
          model: defaultModel,
        },
        check: ({ run, fetchedRun, runs, messages }) => {
          const truncation = run?.metadata?.compatibility?.local_assistants?.truncation || {};
          const fetchedTruncation = fetchedRun?.metadata?.compatibility?.local_assistants?.truncation || {};
          return run?.status === "completed"
            && run?.max_prompt_tokens === 96
            && run?.truncation_strategy?.type === "last_messages"
            && run?.truncation_strategy?.last_messages === 1
            && fetchedRun?.truncation_strategy?.type === "last_messages"
            && runs?.data?.some((item) => item.id === run.id
              && item.truncation_strategy?.type === "last_messages")
            && truncation.strategy === "last_messages"
            && truncation.last_messages === 1
            && truncation.original_message_count >= 2
            && truncation.included_message_count === 1
            && truncation.dropped_message_count >= 1
            && truncation.max_prompt_tokens === 96
            && truncation.max_prompt_tokens_budget_status === "applied"
            && fetchedTruncation.strategy === "last_messages"
            && messages?.data?.some((message) => message.role === "assistant"
              && /assistants-truncation-live-ok/i.test(message.content?.[0]?.text?.value || ""));
        },
      },
      {
        id: "assistants-token-budget-incomplete",
        mode: "assistants-token-budget",
        request: {
          model: defaultModel,
        },
        check: ({ run, fetchedRun, runs, messages }) => {
          const budget = run?.metadata?.compatibility?.local_assistants?.token_budget || {};
          return run?.status === "incomplete"
            && run?.max_completion_tokens === 1
            && run?.incomplete_details?.reason === "max_completion_tokens"
            && Number.isInteger(run?.incomplete_at)
            && run?.completed_at === null
            && fetchedRun?.status === "incomplete"
            && fetchedRun?.incomplete_details?.reason === "max_completion_tokens"
            && runs?.data?.some((item) => item.id === run.id
              && item.status === "incomplete"
              && item.incomplete_details?.reason === "max_completion_tokens")
            && budget.reason === "max_completion_tokens"
            && budget.status === "incomplete"
            && ["finish_reason_length", "usage_exceeded_budget"].includes(budget.trigger)
            && messages?.data?.some((message) => message.role === "assistant");
        },
      },
      {
        id: "assistants-additional-messages",
        mode: "assistants-additional-messages",
        request: {
          model: defaultModel,
        },
        check: ({ assistant, thread, run, messages, runs, steps }) => assistant?.id?.startsWith("asst_")
          && thread?.id?.startsWith("thread_")
          && run?.status === "completed"
          && /per-run additional instruction/i.test(run.instructions || "")
          && run.metadata?.compatibility?.local_assistants?.upstream === "chat_completions"
          && messages?.data?.some((message) => message.role === "user"
            && message.metadata?.source === "additional_messages"
            && /assistants-additional-live-ok/i.test(message.content?.[0]?.text?.value || ""))
          && messages?.data?.some((message) => message.role === "assistant"
            && /assistants-additional-live-ok/i.test(message.content?.[0]?.text?.value || ""))
          && runs?.data?.some((item) => item.id === run.id)
          && steps?.data?.some((step) => step.type === "message_creation"),
      },
      {
        id: "assistants-file-search",
        mode: "assistants-file-search",
        request: {
          model: defaultModel,
        },
        check: ({ run, messages, steps, stepsIncluded, file, vectorStore }) => {
          const text = assistantMessageTextFromList(messages?.data || []);
          const toolStep = (steps?.data || []).find((step) => step.type === "tool_calls");
          const fileSearchCall = (toolStep?.step_details?.tool_calls || []).find((toolCall) => toolCall.type === "file_search");
          const includedToolStep = (stepsIncluded?.data || []).find((step) => step.type === "tool_calls");
          const includedFileSearchCall = (includedToolStep?.step_details?.tool_calls || []).find((toolCall) => toolCall.type === "file_search");
          const assistantMessage = (messages?.data || []).find((message) => message.role === "assistant");
          const annotations = assistantMessage?.content?.[0]?.text?.annotations || [];
          return run?.status === "completed"
            && /assistants-file-search-live-ok/i.test(text)
            && run.metadata?.compatibility?.local_file_search?.provider === "local"
            && run.metadata?.compatibility?.local_assistants?.local_hosted_tool_types?.includes("file_search")
            && run.tool_resources?.file_search?.vector_store_ids?.includes(vectorStore?.id)
            && fileSearchCall?.file_search?.vector_store_ids?.includes(vectorStore?.id)
            && fileSearchCall?.file_search?.results?.some((result) => result.file_id === file?.id
              && !Object.prototype.hasOwnProperty.call(result, "content"))
            && includedFileSearchCall?.file_search?.results?.some((result) => result.file_id === file?.id
              && /Assistants live file-search fixture/i.test(result.content?.[0]?.text || ""))
            && annotations.some((annotation) => annotation.type === "file_citation" && annotation.file_id === file?.id);
        },
      },
      {
        id: "assistants-code-interpreter",
        mode: "assistants-code-interpreter",
        request: {
          model: defaultModel,
        },
        check: ({ run, messages, steps, file }) => {
          const text = assistantMessageTextFromList(messages?.data || []);
          const toolStep = (steps?.data || []).find((step) => step.type === "tool_calls");
          const codeCall = (toolStep?.step_details?.tool_calls || []).find((toolCall) => toolCall.type === "code_interpreter");
          const logs = (codeCall?.code_interpreter?.outputs || [])
            .map((output) => output.logs || "")
            .join("\n");
          return run?.status === "completed"
            && /assistants-ci-live-ok/i.test(text)
            && run.metadata?.compatibility?.local_shell?.provider === "local"
            && run.metadata?.compatibility?.local_shell?.mounted_file_count >= 1
            && run.metadata?.compatibility?.local_assistants?.local_hosted_tool_types?.includes("code_interpreter")
            && run.tool_resources?.code_interpreter?.file_ids?.includes(file?.id)
            && /assistants-ci-live-ok/i.test(logs)
            && /mounted-live-ok/i.test(logs);
        },
      },
      {
        id: "assistants-attachments",
        mode: "assistants-attachments",
        request: {
          model: defaultModel,
        },
        check: ({
          searchRun,
          searchMessages,
          searchSteps,
          searchFile,
          searchVectorStoreId,
          searchAttachedFiles,
          codeRun,
          codeMessages,
          codeSteps,
          codeFile,
          codeThread,
        }) => {
          const searchText = assistantMessageTextFromList(searchMessages?.data || []);
          const searchToolStep = (searchSteps?.data || []).find((step) => step.type === "tool_calls");
          const fileSearchCall = (searchToolStep?.step_details?.tool_calls || []).find((toolCall) => toolCall.type === "file_search");
          const searchAssistantMessage = (searchMessages?.data || []).find((message) => message.role === "assistant");
          const searchAnnotations = searchAssistantMessage?.content?.[0]?.text?.annotations || [];
          const codeText = assistantMessageTextFromList(codeMessages?.data || []);
          const codeToolStep = (codeSteps?.data || []).find((step) => step.type === "tool_calls");
          const codeCall = (codeToolStep?.step_details?.tool_calls || []).find((toolCall) => toolCall.type === "code_interpreter");
          const logs = (codeCall?.code_interpreter?.outputs || [])
            .map((output) => output.logs || "")
            .join("\n");
          return searchRun?.status === "completed"
            && /assistants-attachment-search-live-ok/i.test(searchText)
            && searchRun.tool_resources?.file_search?.vector_store_ids?.includes(searchVectorStoreId)
            && fileSearchCall?.file_search?.vector_store_ids?.includes(searchVectorStoreId)
            && fileSearchCall?.file_search?.results?.some((result) => result.file_id === searchFile?.id)
            && searchAttachedFiles?.data?.some((attached) => attached.id === searchFile?.id)
            && searchAnnotations.some((annotation) => annotation.type === "file_citation" && annotation.file_id === searchFile?.id)
            && codeRun?.status === "completed"
            && /assistants-attachment-ci-live-ok/i.test(codeText)
            && codeThread?.tool_resources?.code_interpreter?.file_ids?.includes(codeFile?.id)
            && codeRun.tool_resources?.code_interpreter?.file_ids?.includes(codeFile?.id)
            && codeRun.metadata?.compatibility?.local_shell?.mounted_file_count >= 1
            && /assistants-attachment-ci-live-ok/i.test(logs)
            && /attachment-mounted-live-ok/i.test(logs);
        },
      },
      {
        id: "evals-lifecycle",
        mode: "evals-lifecycle",
        request: {
          model: defaultModel,
        },
        check: ({ evalObject, file, run, outputItems, outputItem, runGet, runList, evalList, evalUpdated, deleted }) => {
          const statuses = (outputItems?.data || []).map((item) => item.status);
          return evalObject?.object === "eval"
            && /^eval_/.test(evalObject.id || "")
            && file?.purpose === "evals"
            && run?.object === "eval.run"
            && run.status === "completed"
            && run.result_counts?.total === 2
            && run.result_counts?.passed === 1
            && run.result_counts?.failed === 1
            && run.result_counts?.errored === 0
            && run.per_testing_criteria_results?.[0]?.passed === 1
            && run.per_testing_criteria_results?.[0]?.failed === 1
            && outputItems?.object === "list"
            && outputItems.data?.length === 2
            && statuses.includes("passed")
            && statuses.includes("failed")
            && outputItem?.object === "eval.run.output_item"
            && outputItem.run_id === run.id
            && runGet?.id === run.id
            && runList?.data?.some((item) => item.id === run.id)
            && evalList?.data?.some((item) => item.id === evalObject.id)
            && evalUpdated?.metadata?.updated === "true"
            && deleted?.deleted === true;
        },
      },
      {
        id: "graders-api-local",
        mode: "graders-api-local",
        check: ({ validate, similarity, multi, python, unsupported }) => validate?.grader?.type === "string_check"
          && similarity?.reward >= 0.5
          && similarity?.metadata?.type === "text_similarity"
          && similarity?.metadata?.errors?.other_error === false
          && multi?.metadata?.type === "multi"
          && multi?.reward >= 0.8
          && multi?.sub_rewards?.email === 1
          && python?.metadata?.type === "python"
          && python?.reward === 1
          && python?.metadata?.errors?.python_grader_runtime_error === false
          && python?.metadata?.errors?.python_grader_server_error === false
          && unsupported?.status === 400
          && unsupported?.json?.error?.code === "unsupported_grader_type",
      },
      {
        id: "graders-api-score-model",
        mode: "graders-api-score-model",
        request: {
          model: defaultModel,
        },
        check: ({ run }) => run?.metadata?.type === "score_model"
          && run.reward >= 0.5
          && run.metadata?.sampled_model_name
          && run.metadata?.errors?.model_grader_parse_error === false
          && run.metadata?.errors?.model_grader_server_error === false
          && (run.metadata?.token_usage?.total_tokens || 0) > 0
          && Object.keys(run.model_grader_token_usage_per_model || {}).length >= 1,
      },
      {
        id: "responses-inline-moderation",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Return the exact string inline-moderation-ok.",
          metadata: { suite: "responses-inline-moderation" },
          moderation: { input: true, output: true },
          parallel_tool_calls: false,
          reasoning: { effort: "none" },
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json, text }) => /inline-moderation-ok/i.test(text)
          && json?.moderation?.input?.results?.length === 1
          && json?.moderation?.output?.results?.length === 1
          && json.moderation.input.compatibility?.provider === "local"
          && json.moderation.output.compatibility?.provider === "local"
          && json.metadata?.compatibility?.local_moderation?.input?.flagged === false
          && json.metadata?.compatibility?.local_moderation?.output?.flagged === false
          && json.metadata?.suite === "responses-inline-moderation"
          && json.metadata?.compatibility?.stored_chat_fields?.filtered?.includes("metadata")
          && json.metadata?.compatibility?.stored_chat_fields?.filtered?.includes("store")
          && json.metadata?.compatibility?.chat_native_fields?.filtered?.includes("parallel_tool_calls"),
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
          reasoning: { effort: "none" },
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => /prompt-template-ok/i.test(text)
          && json.metadata?.compatibility?.prompt_template?.status === "expanded_locally"
          && json.metadata?.compatibility?.prompt_template?.source === "inline_template",
      },
      {
        id: "responses-mcp-local",
        mode: "responses",
        request: {
          model: defaultModel,
          instructions: "The local bridge handles MCP compatibility context. Return exactly this text and nothing else: mcp-local-ok.",
          input: [
            { role: "user", content: "Use the docs MCP context shape and return mcp-local-ok." },
            {
              type: "mcp_call",
              server_label: "docs",
              name: "search",
              arguments: "{\"query\":\"bridge compatibility\"}",
              output: "{\"matches\":1}",
            },
          ],
          tools: [{
            type: "mcp",
            server_label: "docs",
            server_description: "Documentation search connector",
            connector_id: "connector_dropbox",
            require_approval: "never",
            allowed_tools: ["search"],
          }],
          max_tool_calls: 1,
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json, text }) => {
          const mcpList = (json.output || []).find((item) => item.type === "mcp_list_tools");
          const localMcp = json.metadata?.compatibility?.local_mcp || {};
          return /mcp-local-ok/i.test(text)
            && mcpList?.server_label === "docs"
            && mcpList.tools?.[0]?.name === "search"
            && localMcp.provider === "local"
            && localMcp.connector_count === 1
            && localMcp.imported_tool_count === 1
            && localMcp.input_item_count === 1
            && localMcp.deepseek_thinking === "disabled_for_local_mcp"
            && json.metadata?.compatibility?.local_tool_budget?.used === 1;
        },
      },
      {
        id: "responses-mcp-remote-list",
        mode: "responses-mcp-remote",
        request: {
          model: defaultModel,
          instructions: "The bridge imported a remote MCP tools/list result. Return exactly this text and nothing else: mcp-remote-ok.",
          input: "Inspect the imported MCP tool summary and return mcp-remote-ok.",
          reasoning: { effort: "none" },
          max_tool_calls: 1,
          max_output_tokens: 64,
          store: false,
        },
      },
      {
        id: "responses-mcp-remote-call",
        mode: "responses-mcp-remote",
        remoteCall: true,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool. First call the available tool with expression 2d4+1. After the tool result is returned, answer exactly this text and nothing else: mcp-remote-call-ok.",
          input: "Call the remote MCP roll tool with expression 2d4+1, then return mcp-remote-call-ok.",
          reasoning: { effort: "none" },
          max_tool_calls: 2,
          max_output_tokens: 128,
          store: false,
        },
      },
      {
        id: "responses-mcp-remote-stream-call",
        mode: "responses-mcp-remote",
        remoteCall: true,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool. First call the available tool with expression 2d4+1. After the tool result is returned, answer exactly this text and nothing else: mcp-remote-stream-call-ok.",
          input: "Stream a remote MCP roll tool call with expression 2d4+1, then return mcp-remote-stream-call-ok.",
          reasoning: { effort: "none" },
          stream: true,
          max_tool_calls: 2,
          max_output_tokens: 128,
          store: false,
        },
      },
      {
        id: "responses-mcp-remote-background-call",
        mode: "responses-mcp-remote",
        remoteCall: true,
        background: true,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool. Call it with expression 2d4+1, then answer exactly this text and nothing else: mcp-remote-background-call-ok.",
          input: "Use the remote MCP roll tool with expression 2d4+1 in the background, then return mcp-remote-background-call-ok.",
          reasoning: { effort: "none" },
          tool_choice: { type: "function", name: "roll" },
          max_tool_calls: 2,
          max_output_tokens: 128,
          background: true,
          store: false,
        },
      },
      {
        id: "responses-mcp-remote-approval",
        mode: "responses-mcp-remote",
        remoteApproval: true,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool, but it requires approval. First request the tool call with expression 2d4+1. After approval and tool output are available, answer exactly this text and nothing else: mcp-remote-approval-ok.",
          input: "Request approval to call the remote MCP roll tool with expression 2d4+1, then after approval return mcp-remote-approval-ok.",
          reasoning: { effort: "none" },
          max_tool_calls: 2,
          max_output_tokens: 128,
          store: true,
        },
      },
      {
        id: "responses-mcp-remote-stream-approval",
        mode: "responses-mcp-remote",
        remoteApproval: true,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool, but it requires approval. First request the tool call with expression 2d4+1. After approval and tool output are available, stream exactly this text and nothing else: mcp-remote-stream-approval-ok.",
          input: "Stream the approval flow for the remote MCP roll tool with expression 2d4+1, then after approval return mcp-remote-stream-approval-ok.",
          reasoning: { effort: "none" },
          stream: true,
          max_tool_calls: 2,
          max_output_tokens: 128,
          store: true,
        },
      },
      {
        id: "responses-mcp-remote-denial",
        mode: "responses-mcp-remote",
        remoteApproval: true,
        remoteApprovalApprove: false,
        request: {
          model: defaultModel,
          instructions: "You have an MCP dice tool exposed as a function tool, but it requires approval. First request the tool call with expression 2d4+1. If approval is denied, answer exactly this text and nothing else: mcp-remote-denial-ok.",
          input: "Request approval to call the remote MCP roll tool with expression 2d4+1, then if approval is denied return mcp-remote-denial-ok.",
          reasoning: { effort: "none" },
          max_tool_calls: 2,
          max_output_tokens: 128,
          store: true,
        },
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
        id: "responses-reasoning-encrypted",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Think briefly, then return exactly this text and nothing else: reasoning-encrypted-ok",
          reasoning: { effort: "high" },
          include: ["reasoning.encrypted_content"],
          max_output_tokens: 128,
          store: true,
        },
        retrieveResponseInclude: "reasoning.encrypted_content",
        check: ({ json, text, hiddenResponse, includedResponse }) => {
          const reasoning = (json.output || []).find((item) => item.type === "reasoning");
          const hiddenReasoning = (hiddenResponse?.output || []).find((item) => item.type === "reasoning");
          const includedReasoning = (includedResponse?.output || []).find((item) => item.type === "reasoning");
          return /reasoning-encrypted-ok/i.test(text)
            && /^ocrsn1\./.test(reasoning?.encrypted_content || "")
            && hiddenReasoning?.encrypted_content === undefined
            && /^ocrsn1\./.test(includedReasoning?.encrypted_content || "")
            && json.metadata?.compatibility?.local_reasoning_encrypted_content?.output_count >= 1;
        },
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
        id: "batch-audio-transcription",
        mode: "batch-local",
        endpoint: "/v1/audio/transcriptions",
        usage: "audio",
        requests: [
          {
            custom_id: "batch-audio-transcription",
            body: {
              model: "gpt-4o-transcribe",
              file: {
                data: `data:audio/wav;base64,${tinyAudioBase64}`,
                filename: "batch-eval-transcribe.wav",
              },
              response_format: "verbose_json",
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/audio/transcriptions"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].response?.status_code === 200
            && response?.task === "transcribe"
            && /batch-eval-transcribe\.wav/i.test(response?.text || "")
            && response?.compatibility?.operation === "audio_transcription";
        },
      },
      {
        id: "batch-audio-translation",
        mode: "batch-local",
        endpoint: "/v1/audio/translations",
        usage: "audio",
        requests: [
          {
            custom_id: "batch-audio-translation",
            body: {
              model: "whisper-1",
              file: {
                data: `data:audio/wav;base64,${tinyAudioBase64}`,
                filename: "batch-eval-translate.wav",
              },
              response_format: "json",
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/audio/translations"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].response?.status_code === 200
            && /translation in English/i.test(response?.text || "")
            && response?.compatibility?.operation === "audio_translation";
        },
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
              thinking: { type: "disabled" },
              max_tokens: 64,
              store: false,
            },
          },
          {
            custom_id: "batch-chat-two",
            body: {
              model: defaultModel,
              messages: [{ role: "user", content: "Return the exact string batch-chat-two." }],
              thinking: { type: "disabled" },
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
        id: "batch-responses-image-generation",
        mode: "batch-local",
        endpoint: "/v1/responses",
        usage: "responses",
        requests: [
          {
            custom_id: "batch-response-image",
            body: {
              model: defaultModel,
              instructions: "The local bridge handles image_generation in Batch. Return exactly this text and nothing else: batch-image-generation-ok.",
              input: "Exercise image_generation inside local Batch JSONL.",
              tools: [{ type: "image_generation", action: "generate" }],
              tool_choice: { type: "image_generation" },
              max_tool_calls: 1,
              max_output_tokens: 128,
              store: false,
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          const call = (response?.output || []).find((item) => item.type === "image_generation_call");
          const localImage = response?.metadata?.compatibility?.local_image_generation || {};
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/responses"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].custom_id === "batch-response-image"
            && outputLines[0].response?.status_code === 200
            && response?.object === "response"
            && response.status === "completed"
            && call?.status === "completed"
            && /^ig_/.test(call?.id || "")
            && /^iVBORw0KGgo/.test(call?.result || "")
            && localImage.call_count === 1
            && localImage.stored_image_call_count === 1
            && localImage.deepseek_thinking === "disabled_for_local_image_generation";
        },
      },
      {
        id: "batch-images-generation",
        mode: "batch-local",
        endpoint: "/v1/images/generations",
        usage: "images",
        requests: [
          {
            custom_id: "batch-direct-image",
            body: {
              model: "gpt-image-2",
              prompt: "Exercise the direct Images API inside local Batch JSONL.",
              n: 2,
              size: "1024x1024",
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/images/generations"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].custom_id === "batch-direct-image"
            && outputLines[0].response?.status_code === 200
            && response?.data?.length === 2
            && response.data.every((item) => /^iVBORw0KGgo/.test(item?.b64_json || ""));
        },
      },
      {
        id: "batch-images-edit",
        mode: "batch-local",
        endpoint: "/v1/images/edits",
        usage: "images",
        requests: [
          {
            custom_id: "batch-direct-image-edit",
            body: {
              model: "gpt-image-2",
              prompt: "Exercise the direct Images edit API inside local Batch JSONL.",
              images: [{ image_url: `data:image/png;base64,${tinyPngBase64}`, filename: "eval-source.png" }],
              mask: { image_url: `data:image/png;base64,${tinyMaskPngBase64}`, filename: "eval-mask.png" },
              n: 2,
              size: "1024x1024",
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/images/edits"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].custom_id === "batch-direct-image-edit"
            && outputLines[0].response?.status_code === 200
            && response?.data?.length === 2
            && response.data.every((item) => /^iVBORw0KGgo/.test(item?.b64_json || ""))
            && /Edit the supplied image using this instruction/.test(response.data[0]?.revised_prompt || "");
        },
      },
      {
        id: "batch-images-variation",
        mode: "batch-local",
        endpoint: "/v1/images/variations",
        usage: "images",
        requests: [
          {
            custom_id: "batch-direct-image-variation",
            body: {
              model: "dall-e-2",
              image: { image_url: `data:image/png;base64,${tinyPngBase64}`, filename: "eval-source.png" },
              n: 2,
              size: "1024x1024",
              response_format: "b64_json",
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/images/variations"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].custom_id === "batch-direct-image-variation"
            && outputLines[0].response?.status_code === 200
            && response?.data?.length === 2
            && response.data.every((item) => /^iVBORw0KGgo/.test(item?.b64_json || ""))
            && /variation of the supplied image/.test(response.data[0]?.revised_prompt || "");
        },
      },
      {
        id: "batch-videos",
        mode: "batch-local",
        endpoint: "/v1/videos",
        usage: "videos",
        requests: [
          {
            custom_id: "batch-direct-video",
            body: {
              model: "sora-2",
              prompt: "Exercise the direct OpenAI-compatible Videos API inside local Batch JSONL.",
              size: "1280x720",
              seconds: "4",
              input_reference: { image_url: "https://example.test/frame.png" },
            },
          },
        ],
        check: ({ batch, outputLines, errorText }) => {
          const response = outputLines[0]?.response?.body;
          return batch?.object === "batch"
            && batch.status === "completed"
            && batch.endpoint === "/v1/videos"
            && batch.request_counts?.total === 1
            && batch.request_counts?.completed === 1
            && batch.request_counts?.failed === 0
            && !batch.error_file_id
            && !errorText
            && outputLines.length === 1
            && outputLines[0].custom_id === "batch-direct-video"
            && outputLines[0].response?.status_code === 200
            && /^video_/.test(response?.id || "")
            && response?.object === "video"
            && response?.status === "completed"
            && response?.metadata?.compatibility?.batch_supported === true;
        },
      },
      {
        id: "chat-passthrough",
        mode: "chat",
        request: {
          model: defaultModel,
          messages: [{ role: "user", content: "Return the exact string chat-ok." }],
          thinking: { type: "disabled" },
          max_tokens: 64,
        },
        check: ({ text }) => /chat-ok/i.test(text),
      },
      {
        id: "chat-developer-compat",
        mode: "chat",
        request: {
          model: defaultModel,
          store: true,
          metadata: { suite: "chat-developer-compat" },
          messages: [
            { role: "developer", content: "You must answer with the exact requested marker and no prose." },
            { role: "user", content: "Return the exact string chat-developer-ok." },
          ],
          user: "developer-compat@example.com",
          service_tier: "flex",
          modalities: ["text"],
          moderation: { input: true },
          parallel_tool_calls: false,
          stream_options: { include_usage: true },
          reasoning_effort: "none",
          max_completion_tokens: 64,
        },
        check: ({ json, text }) => /chat-developer-ok/i.test(text)
          && json.metadata?.compatibility?.chat_passthrough?.developer_role?.count === 1
          && json.metadata?.compatibility?.chat_passthrough?.deepseek_user_id?.source === "user"
          && json.metadata?.compatibility?.chat_passthrough?.max_completion_tokens?.target === "max_tokens"
          && json.metadata?.compatibility?.chat_passthrough?.max_completion_tokens?.value === 64
          && json.metadata?.compatibility?.chat_passthrough?.max_completion_tokens?.forwarded === true
          && json.metadata?.compatibility?.chat_passthrough?.reasoning_effort?.value === "none"
          && json.metadata?.compatibility?.chat_passthrough?.reasoning_effort?.reason === "deepseek_thinking_disabled"
          && json.metadata?.compatibility?.chat_passthrough?.stored_chat_fields?.filtered?.includes("metadata")
          && json.metadata?.compatibility?.chat_passthrough?.stored_chat_fields?.filtered?.includes("store")
          && json.metadata?.compatibility?.chat_passthrough?.service_tier?.forwarded === false
          && json.metadata?.compatibility?.chat_passthrough?.stream_options?.reason === "stream_required"
          && json.metadata?.compatibility?.chat_passthrough?.chat_native_fields?.filtered?.includes("modalities")
          && json.metadata?.compatibility?.chat_passthrough?.chat_native_fields?.filtered?.includes("moderation")
          && json.metadata?.compatibility?.chat_passthrough?.chat_native_fields?.filtered?.includes("parallel_tool_calls")
          && json.moderation?.input?.results?.[0]?.flagged === false,
      },
      {
        id: "chat-tool-choice-compat",
        mode: "chat",
        request: {
          model: defaultModel,
          messages: [{
            role: "user",
            content: "Call record_result with ok=true and label=\"chat-tool-ok\". Do not answer in prose.",
          }],
          tools: [{
            type: "function",
            function: {
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
            },
          }],
          tool_choice: { type: "function", function: { name: "record_result" } },
          max_completion_tokens: 128,
        },
        check: ({ json }) => {
          const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall?.function?.name !== "record_result") return false;
          if (json.metadata?.compatibility?.chat_passthrough?.deepseek_thinking?.reason !== "disabled_for_tool_choice") {
            return false;
          }
          const parsed = parseJsonish(toolCall.function.arguments);
          return parsed?.ok === true && parsed?.label === "chat-tool-ok";
        },
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
        id: "chat-reasoning-object-compat",
        mode: "chat",
        request: {
          model: defaultModel,
          messages: [{ role: "user", content: "Return the exact string chat-reasoning-object-ok." }],
          reasoning: { effort: "none", summary: "auto" },
          max_completion_tokens: 64,
        },
        check: ({ json, text }) => /chat-reasoning-object-ok/i.test(text)
          && json.metadata?.compatibility?.chat_passthrough?.reasoning?.filtered?.includes("summary")
          && json.metadata?.compatibility?.chat_passthrough?.reasoning?.effort?.source === "reasoning.effort"
          && json.metadata?.compatibility?.chat_passthrough?.reasoning?.effort?.reason === "deepseek_thinking_disabled"
          && json.metadata?.compatibility?.chat_passthrough?.reasoning?.effort?.forwarded === false,
      },
      {
        id: "chat-custom-tool-filter-compat",
        mode: "chat",
        request: {
          model: defaultModel,
          store: true,
          metadata: { suite: "bridge-regression", feature: "custom-tool-filter" },
          messages: [{ role: "user", content: "Return the exact string chat-custom-tool-filter-ok." }],
          tools: [{
            type: "custom",
            custom: {
              name: "emit_text",
              description: "Emit free-form text.",
            },
          }],
          tool_choice: { type: "custom", custom: { name: "emit_text" } },
          reasoning_effort: "none",
          max_completion_tokens: 64,
        },
        check: ({ json, text }) => {
          const customTools = json.metadata?.compatibility?.chat_passthrough?.custom_tools;
          return /chat-custom-tool-filter-ok/i.test(text)
            && customTools?.reason === "provider_function_tools_only"
            && customTools?.filtered?.some((tool) => tool.type === "custom" && tool.name === "emit_text")
            && customTools?.tool_choice?.reason === "no_forwardable_tools"
            && customTools?.tool_choice?.forwarded === false;
        },
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
          thinking: { type: "disabled" },
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
          stream_options: { include_usage: true, include_obfuscation: false },
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
          && fetched?.metadata?.compatibility?.chat_passthrough?.stream_options?.reason === "provider_stream_option_filter"
          && fetched?.metadata?.compatibility?.chat_passthrough?.stream_options?.filtered?.includes("include_obfuscation")
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
          store: true,
        },
        retrieveResponseInclude: "message.output_text.logprobs",
        exerciseStoredResponseProjection: true,
        check: ({ json, text, hiddenResponse, includedResponse, projectionUpdateHidden, projectionUpdateIncluded, projectionCancelHidden, projectionCancelIncluded }) => {
          const hasVisibleLogprobs = (json.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs) && part.logprobs.length > 0));
          const hiddenHasLogprobs = (hiddenResponse?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs)));
          const includedHasLogprobs = (includedResponse?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs) && part.logprobs.length > 0));
          const updateHiddenHasLogprobs = (projectionUpdateHidden?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs)));
          const updateIncludedHasLogprobs = (projectionUpdateIncluded?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs) && part.logprobs.length > 0));
          const cancelHiddenHasLogprobs = (projectionCancelHidden?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs)));
          const cancelIncludedHasLogprobs = (projectionCancelIncluded?.output || []).some((item) => (item.content || [])
            .some((part) => Array.isArray(part.logprobs) && part.logprobs.length > 0));
          return /logprobs-ok/i.test(text)
            && json.metadata?.compatibility?.logprobs === "chat_logprobs"
            && hasVisibleLogprobs
            && !hiddenHasLogprobs
            && includedHasLogprobs
            && projectionUpdateHidden?.metadata?.suite === "projection-update-hidden"
            && !updateHiddenHasLogprobs
            && projectionUpdateIncluded?.metadata?.suite === "projection-update-included"
            && updateIncludedHasLogprobs
            && /terminal responses/.test(projectionCancelHidden?.metadata?.compatibility_cancel || "")
            && !cancelHiddenHasLogprobs
            && cancelIncludedHasLogprobs;
        },
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
          reasoning: { effort: "none" },
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
          reasoning: { effort: "none" },
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
        id: "responses-computer-action",
        mode: "responses",
        request: {
          model: defaultModel,
          instructions: "A computer screenshot was returned. Use the provided computer action tool to request exactly one click at x=42 and y=55, then stop without normal text.",
          input: [{
            type: "computer_call_output",
            call_id: "call_eval_screenshot",
            output: {
              type: "input_image",
              image_url: "https://example.test/computer-screen.png",
              detail: "low",
            },
            acknowledged_safety_checks: [{ id: "safe_eval_ack" }],
          }],
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
            && call.action?.type === "click"
            && call.actions?.some((action) => action.type === "click")
            && call.environment === "browser"
            && call.display_width === 1024
            && call.display_height === 768
            && !(json.output || []).some((item) => item.type === "function_call")
            && computer.status === "action_requested"
            && computer.returned_output_count === 1
            && computer.model_action_tool_call_count === 1
            && computer.model_action_call_count === 1
            && computer.tool_choice?.reason === "computer_tool_choice_mapped"
            && budget.used === 1;
        },
      },
      {
        id: "responses-computer-action-stream",
        mode: "responses-stream",
        request: {
          model: defaultModel,
          instructions: "A computer screenshot was returned. Stream by using the provided computer action tool to request exactly one click at x=42 and y=55, then stop without normal text.",
          input: [{
            type: "computer_call_output",
            call_id: "call_eval_stream_screenshot",
            output: {
              type: "input_image",
              image_url: "https://example.test/computer-stream-screen.png",
              detail: "low",
            },
            acknowledged_safety_checks: [{ id: "safe_eval_stream_ack" }],
          }],
          tools: [{
            type: "computer",
            environment: "browser",
            display_width: 1024,
            display_height: 768,
          }],
          tool_choice: { type: "computer" },
          max_tool_calls: 1,
          max_output_tokens: 128,
          stream: true,
          store: false,
        },
        check: ({ events, json }) => {
          const call = (json.output || []).find((item) => item.type === "computer_call");
          const computer = json.metadata?.compatibility?.local_computer || {};
          const budget = json.metadata?.compatibility?.local_tool_budget || {};
          return !!call
            && call.status === "completed"
            && call.action?.type === "click"
            && call.actions?.some((action) => action.type === "click")
            && call.environment === "browser"
            && call.display_width === 1024
            && call.display_height === 768
            && events.some((event) => event.event === "response.output_item.added" && event.data?.item?.type === "computer_call")
            && events.some((event) => event.event === "response.output_item.done" && event.data?.item?.type === "computer_call")
            && !events.some((event) => event.event === "response.function_call_arguments.delta" || event.data?.item?.type === "function_call")
            && computer.status === "action_requested"
            && computer.returned_output_count === 1
            && computer.model_action_tool_call_count === 1
            && computer.model_action_call_count === 1
            && computer.tool_choice?.reason === "computer_tool_choice_mapped"
            && budget.used === 1;
        },
      },
      {
        id: "responses-image-generation",
        mode: "responses",
        request: {
          model: defaultModel,
          instructions: "The local bridge handles image_generation. Return exactly this text and nothing else: image-generation-ok.",
          input: "Exercise the image_generation tool and then return the requested marker.",
          tools: [{ type: "image_generation", action: "generate", partial_images: 1 }],
          tool_choice: { type: "image_generation" },
          max_tool_calls: 1,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => {
          const call = (json.output || []).find((item) => item.type === "image_generation_call");
          const localImage = json.metadata?.compatibility?.local_image_generation || {};
          return call?.status === "completed"
            && /^ig_/.test(call?.id || "")
            && /^iVBORw0KGgo/.test(call?.result || "")
            && /Generate an image from this prompt/.test(call?.revised_prompt || "")
            && text.trim().length > 0
            && localImage.provider === "placeholder"
            && localImage.placeholder === true
            && localImage.call_count === 1
            && localImage.partial_image_count === 1
            && localImage.deepseek_thinking === "disabled_for_local_image_generation"
            && json.metadata?.compatibility?.local_tool_choice === "handled_by_bridge";
        },
      },
      {
        id: "images-generation",
        mode: "images-generation",
        request: {
          model: "gpt-image-2",
          prompt: "Exercise the direct OpenAI-compatible Images API endpoint.",
          n: 2,
          size: "1024x1024",
          quality: "low",
        },
        check: ({ json, text }) => Array.isArray(json.data)
          && json.data.length === 2
          && /^iVBORw0KGgo/.test(json.data[0]?.b64_json || "")
          && /^iVBORw0KGgo/.test(json.data[1]?.b64_json || "")
          && /images:2/.test(text),
      },
      {
        id: "images-generation-stream",
        mode: "images-generation-stream",
        request: {
          model: "gpt-image-2",
          prompt: "Exercise the direct OpenAI-compatible Images API streaming endpoint.",
          n: 1,
          size: "1024x1024",
          quality: "low",
          stream: true,
          partial_images: 2,
        },
        check: ({ completed, events, partials, text }) => partials.length === 2
          && events.some((event) => event.event === "image_generation.completed")
          && /^iVBORw0KGgo/.test(completed?.b64_json || "")
          && /image_generation:2:completed/.test(text),
      },
      {
        id: "images-edit",
        mode: "images-edit",
        request: {
          model: "gpt-image-2",
          prompt: "Exercise the direct OpenAI-compatible Images edit API endpoint.",
          images: [{ image_url: `data:image/png;base64,${tinyPngBase64}`, filename: "eval-source.png" }],
          mask: { image_url: `data:image/png;base64,${tinyMaskPngBase64}`, filename: "eval-mask.png" },
          n: 2,
          size: "1024x1024",
          quality: "low",
        },
        check: ({ json, text }) => Array.isArray(json.data)
          && json.data.length === 2
          && /^iVBORw0KGgo/.test(json.data[0]?.b64_json || "")
          && /^iVBORw0KGgo/.test(json.data[1]?.b64_json || "")
          && /Edit the supplied image using this instruction/.test(json.data[0]?.revised_prompt || "")
          && /images:2/.test(text),
      },
      {
        id: "images-edit-stream",
        mode: "images-edit-stream",
        request: {
          model: "gpt-image-2",
          prompt: "Exercise the direct OpenAI-compatible Images edit API streaming endpoint.",
          images: [{ image_url: `data:image/png;base64,${tinyPngBase64}`, filename: "eval-source.png" }],
          mask: { image_url: `data:image/png;base64,${tinyMaskPngBase64}`, filename: "eval-mask.png" },
          n: 1,
          size: "1024x1024",
          quality: "low",
          stream: true,
          partial_images: 2,
        },
        check: ({ completed, events, partials, text }) => partials.length === 2
          && events.some((event) => event.event === "image_edit.completed")
          && /^iVBORw0KGgo/.test(completed?.b64_json || "")
          && /image_edit:2:completed/.test(text),
      },
      {
        id: "images-variation",
        mode: "images-variation",
        request: {
          model: "dall-e-2",
          image: { image_url: `data:image/png;base64,${tinyPngBase64}`, filename: "eval-source.png" },
          n: 2,
          size: "1024x1024",
          response_format: "b64_json",
        },
        check: ({ json, text }) => Array.isArray(json.data)
          && json.data.length === 2
          && /^iVBORw0KGgo/.test(json.data[0]?.b64_json || "")
          && /^iVBORw0KGgo/.test(json.data[1]?.b64_json || "")
          && /variation of the supplied image/.test(json.data[0]?.revised_prompt || "")
          && /images:2/.test(text),
      },
      {
        id: "video-lifecycle",
        mode: "video-lifecycle",
        request: {
          model: "sora-2",
          prompt: "Exercise the direct OpenAI-compatible Videos API endpoint.",
          size: "1280x720",
          seconds: "4",
          quality: "standard",
          metadata: { suite: "bridge-regression-video" },
        },
        check: ({ created, retrieved, listed, content, deleted, text }) => /^video_/.test(created?.id || "")
          && created?.object === "video"
          && created?.status === "completed"
          && created?.progress === 100
          && created?.metadata?.compatibility?.provider === "local"
          && retrieved?.id === created?.id
          && listed?.data?.some((item) => item.id === created?.id)
          && content?.status === 200
          && content?.content_type === "video/mp4"
          && content?.bytes > 16
          && deleted?.deleted === true
          && /video:completed:content/.test(text),
      },
      {
        id: "video-character-lifecycle",
        mode: "video-character-lifecycle",
        request: {
          model: "sora-2",
          prompt: "Exercise the direct OpenAI-compatible Videos API character endpoint.",
          size: "1280x720",
          seconds: "4",
          quality: "standard",
          metadata: { suite: "bridge-regression-video-character" },
        },
        check: ({ createdCharacter, retrievedCharacter, createdVideo, deletedCharacter, text }) => /^char_/.test(createdCharacter?.id || "")
          && createdCharacter?.object === "video.character"
          && createdCharacter?.status === "completed"
          && createdCharacter?.metadata?.compatibility?.operation === "create_character"
          && retrievedCharacter?.id === createdCharacter?.id
          && /^video_/.test(createdVideo?.id || "")
          && createdVideo?.object === "video"
          && createdVideo?.status === "completed"
          && createdVideo?.characters?.[0]?.id === createdCharacter?.id
          && createdVideo?.metadata?.compatibility?.character_count === 1
          && deletedCharacter?.deleted === true
          && /video-character:completed:completed/.test(text),
      },
      {
        id: "video-iteration-lifecycle",
        mode: "video-iteration-lifecycle",
        request: {
          model: "sora-2",
          prompt: "Exercise the direct OpenAI-compatible Videos API iteration endpoints.",
          size: "1280x720",
          seconds: "4",
          quality: "standard",
          metadata: { suite: "bridge-regression-video-iteration" },
        },
        check: ({ created, edit, extension, pathEdit, remix, text }) => /^video_/.test(created?.id || "")
          && edit?.metadata?.compatibility?.operation === "edit"
          && edit?.source_video?.type === "video_id"
          && edit?.source_video?.id === created?.id
          && extension?.metadata?.compatibility?.operation === "extend"
          && extension?.source_video?.type === "video_id"
          && extension?.source_video?.id === created?.id
          && pathEdit?.metadata?.compatibility?.operation === "edit"
          && pathEdit?.source_video_id === created?.id
          && pathEdit?.source_video?.id === created?.id
          && remix?.metadata?.compatibility?.operation === "remix"
          && remix?.source_video_id === created?.id
          && /video-iteration:completed:completed:completed:completed/.test(text),
      },
      {
        id: "responses-image-edit",
        mode: "responses",
        request: {
          model: defaultModel,
          instructions: "The local bridge handles image_generation edits. Return exactly this text and nothing else: image-edit-ok.",
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: "Edit the attached tiny image by changing the background color." },
              { type: "input_image", filename: "eval-source.png", image_url: `data:image/png;base64,${tinyPngBase64}` },
            ],
          }],
          tools: [{
            type: "image_generation",
            action: "edit",
            input_image_mask: {
              filename: "eval-mask.png",
              image_url: `data:image/png;base64,${tinyMaskPngBase64}`,
            },
          }],
          tool_choice: { type: "image_generation" },
          max_tool_calls: 1,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => {
          const call = (json.output || []).find((item) => item.type === "image_generation_call");
          const localImage = json.metadata?.compatibility?.local_image_generation || {};
          return call?.status === "completed"
            && /^ig_/.test(call?.id || "")
            && /^iVBORw0KGgo/.test(call?.result || "")
            && /Edit the supplied image using this instruction/.test(call?.revised_prompt || "")
            && text.trim().length > 0
            && localImage.provider === "placeholder"
            && localImage.placeholder === true
            && localImage.mode === "edit"
            && localImage.call_count === 1
            && localImage.resolved_image_count === 1
            && localImage.input_image_mask === true
            && localImage.input_image_mask_resolved === true
            && localImage.deepseek_thinking === "disabled_for_local_image_generation"
            && json.metadata?.compatibility?.local_tool_choice === "handled_by_bridge";
        },
      },
      {
        id: "responses-image-id-edit",
        mode: "responses-sequence",
        steps: [
          {
            request: {
              model: defaultModel,
              instructions: "The local bridge handles image_generation. Return exactly this text and nothing else: image-id-generate-ok.",
              input: "Generate a tiny image for an id-only follow-up edit.",
              tools: [{ type: "image_generation", action: "generate" }],
              tool_choice: { type: "image_generation" },
              max_tool_calls: 1,
              max_output_tokens: 128,
              store: false,
            },
            check: ({ json, text }) => {
              const call = (json.output || []).find((item) => item.type === "image_generation_call");
              const localImage = json.metadata?.compatibility?.local_image_generation || {};
              return call?.status === "completed"
                && /^ig_/.test(call?.id || "")
                && /^iVBORw0KGgo/.test(call?.result || "")
                && text.trim().length > 0
                && localImage.mode === "generate"
                && localImage.stored_image_call_count === 1;
            },
          },
          {
            request: ({ previousJson }) => {
              const call = (previousJson?.output || []).find((item) => item.type === "image_generation_call");
              return {
                model: defaultModel,
                instructions: "The local bridge handles id-only image_generation edits. Return exactly this text and nothing else: image-id-edit-ok.",
                input: [
                  {
                    role: "user",
                    content: [{ type: "input_text", text: "Edit the prior generated image using only its image_generation_call id." }],
                  },
                  { type: "image_generation_call", id: call?.id || "ig_missing" },
                ],
                tools: [{ type: "image_generation", action: "edit" }],
                tool_choice: { type: "image_generation" },
                max_tool_calls: 1,
                max_output_tokens: 128,
                store: false,
              };
            },
            check: ({ json, text }) => {
              const call = (json.output || []).find((item) => item.type === "image_generation_call");
              const localImage = json.metadata?.compatibility?.local_image_generation || {};
              return call?.status === "completed"
                && /^ig_/.test(call?.id || "")
                && /^iVBORw0KGgo/.test(call?.result || "")
                && text.trim().length > 0
                && localImage.mode === "edit"
                && localImage.prior_image_call_count === 1
                && localImage.prior_stored_image_call_count === 1
                && localImage.resolved_stored_image_call_count === 1
                && localImage.resolved_image_count === 1
                && localImage.deepseek_thinking === "disabled_for_local_image_generation";
            },
          },
        ],
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
          stream_options: { include_obfuscation: false },
          max_output_tokens: 256,
          store: false,
        },
        check: ({ text, events, json }) => {
          const types = new Set(events.map((event) => event.event));
          return /stream-ok/i.test(text)
            && types.has("response.created")
            && types.has("response.output_text.delta")
            && types.has("response.completed")
            && json?.metadata?.compatibility?.stream_options?.reason === "provider_stream_option_filter"
            && json?.metadata?.compatibility?.stream_options?.filtered?.includes("include_obfuscation")
            && json?.metadata?.compatibility?.stream_options?.include_usage?.reason === "enabled_by_bridge"
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
        id: "responses-function-tool-stream",
        mode: "responses-stream",
        request: {
          model: defaultModel,
          input: "Stream by calling record_result with ok=true and label=\"tool-stream-ok\". Do not answer in prose.",
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
          stream: true,
          max_output_tokens: 128,
          store: false,
        },
        check: ({ events, json }) => {
          const call = (json.output || []).find((item) => item.type === "function_call");
          const parsed = parseJsonish(call?.arguments);
          return !!call
            && call.name === "record_result"
            && parsed?.ok === true
            && parsed?.label === "tool-stream-ok"
            && events.some((event) => event.event === "response.output_item.added" && event.data?.item?.type === "function_call")
            && events.some((event) => event.event === "response.function_call_arguments.delta")
            && events.some((event) => event.event === "response.function_call_arguments.done")
            && events.some((event) => event.event === "response.output_item.done" && event.data?.item?.type === "function_call");
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
    if (testCase.mode === "responses-mcp-remote") {
      return await runMcpRemoteCase(testCase, context, started);
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
    if (testCase.mode === "realtime-lifecycle") {
      return await runRealtimeLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "fine-tuning-lifecycle") {
      return await runFineTuningLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "organization-usage-costs") {
      return await runOrganizationUsageCostsCase(testCase, context, started);
    }
    if (testCase.mode === "chatkit-lifecycle") {
      return await runChatKitLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "audio-speech") {
      return await runAudioSpeechCase(testCase, context, started);
    }
    if (testCase.mode === "audio-transcription") {
      return await runJsonCase(testCase, context, started, "/v1/audio/transcriptions", audioOutputText, audioUsage);
    }
    if (testCase.mode === "audio-translation") {
      return await runJsonCase(testCase, context, started, "/v1/audio/translations", audioOutputText, audioUsage);
    }
    if (testCase.mode === "audio-voice-lifecycle") {
      return await runAudioVoiceLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-lifecycle") {
      return await runAssistantsLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-required-action") {
      return await runAssistantsRequiredActionCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-reasoning-effort") {
      return await runAssistantsReasoningEffortCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-truncation") {
      return await runAssistantsTruncationCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-token-budget") {
      return await runAssistantsTokenBudgetCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-additional-messages") {
      return await runAssistantsAdditionalMessagesCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-file-search") {
      return await runAssistantsFileSearchCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-code-interpreter") {
      return await runAssistantsCodeInterpreterCase(testCase, context, started);
    }
    if (testCase.mode === "assistants-attachments") {
      return await runAssistantsAttachmentsCase(testCase, context, started);
    }
    if (testCase.mode === "evals-lifecycle") {
      return await runEvalsLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "graders-api-local") {
      return await runGradersApiLocalCase(testCase, context, started);
    }
    if (testCase.mode === "graders-api-score-model") {
      return await runGradersApiScoreModelCase(testCase, context, started);
    }
    if (testCase.mode === "images-generation") {
      return await runJsonCase(testCase, context, started, "/v1/images/generations", imagesGenerationOutputText, imagesGenerationUsage);
    }
    if (testCase.mode === "images-generation-stream") {
      return await runImageApiStreamCase(testCase, context, started, "/v1/images/generations", "image_generation");
    }
    if (testCase.mode === "images-edit") {
      return await runJsonCase(testCase, context, started, "/v1/images/edits", imagesGenerationOutputText, imagesGenerationUsage);
    }
    if (testCase.mode === "images-edit-stream") {
      return await runImageApiStreamCase(testCase, context, started, "/v1/images/edits", "image_edit");
    }
    if (testCase.mode === "images-variation") {
      return await runJsonCase(testCase, context, started, "/v1/images/variations", imagesGenerationOutputText, imagesGenerationUsage);
    }
    if (testCase.mode === "video-lifecycle") {
      return await runVideoLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "video-character-lifecycle") {
      return await runVideoCharacterLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "video-iteration-lifecycle") {
      return await runVideoIterationLifecycleCase(testCase, context, started);
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
    let projectionUpdateHidden = { ok: false, status: 0, json: null };
    let projectionUpdateIncluded = { ok: false, status: 0, json: null };
    let projectionCancelHidden = { ok: false, status: 0, json: null };
    let projectionCancelIncluded = { ok: false, status: 0, json: null };
    if (testCase.exerciseStoredResponseProjection && json.id) {
      const include = encodeURIComponent(testCase.retrieveResponseInclude || "");
      projectionUpdateHidden = await postJsonCapture(`${baseUrl}/v1/responses/${json.id}`, {
        metadata: { suite: "projection-update-hidden" },
      });
      projectionUpdateIncluded = await postJsonCapture(`${baseUrl}/v1/responses/${json.id}?include[]=${include}`, {
        metadata: { suite: "projection-update-included" },
      });
      projectionCancelHidden = await postJsonCapture(`${baseUrl}/v1/responses/${json.id}/cancel`, {});
      projectionCancelIncluded = await postJsonCapture(`${baseUrl}/v1/responses/${json.id}/cancel?include[]=${include}`, {});
    }
    const text = textSelector(json);
    const ok = !!testCase.check({
      json,
      text,
      ok: response.ok,
      hiddenResponse: hiddenResponse.json,
      includedResponse: includedResponse.json,
      projectionUpdateHidden: projectionUpdateHidden.json,
      projectionUpdateIncluded: projectionUpdateIncluded.json,
      projectionCancelHidden: projectionCancelHidden.json,
      projectionCancelIncluded: projectionCancelIncluded.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      ...(testCase.retrieveResponseInclude ? {
        hidden_response_status: hiddenResponse.status,
        included_response_status: includedResponse.status,
      } : {}),
      ...(testCase.exerciseStoredResponseProjection ? {
        projection_update_hidden_status: projectionUpdateHidden.status,
        projection_update_included_status: projectionUpdateIncluded.status,
        projection_cancel_hidden_status: projectionCancelHidden.status,
        projection_cancel_included_status: projectionCancelIncluded.status,
      } : {}),
      usage: usageSelector(json),
      output_text: truncate(text),
    });
  } finally {
    if (responseId) await deleteJson(`${baseUrl}/v1/responses/${responseId}`);
  }
}

async function runAudioSpeechCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const response = await postJson(`${baseUrl}/v1/audio/speech`, request);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(buffer.toString("utf8")),
    });
  }
  const ok = !!testCase.check({
    status: response.status,
    contentType,
    bytes: buffer.length,
    buffer,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    content_type: contentType,
    bytes: buffer.length,
    usage: audioUsage(null),
    output_text: `audio_speech:${contentType}:${buffer.length}`,
  });
}

async function runChatKitLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const marker = `${testCase.id}-${context.iteration}-${Date.now().toString(36)}`;
  let threadId = null;
  try {
    const session = await postJsonCapture(`${baseUrl}/v1/chatkit/sessions`, {
      user: `eval-chatkit-${context.iteration}`,
      workflow: request.workflow || { id: "workflow_bridge_regression" },
      scope: request.scope || {},
      expires_after: 1800,
      max_requests_per_1_minute: 60,
      max_requests_per_session: 500,
      metadata: { suite: "bridge-regression", marker },
    });
    if (!session.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: session.status,
        error: truncate(session.body),
      });
    }

    const thread = await postJsonCapture(`${baseUrl}/v1/chatkit/threads`, {
      session_id: session.json.id,
      title: "ChatKit lifecycle",
      metadata: { suite: "bridge-regression", marker },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const updatedThread = await postJsonCapture(`${baseUrl}/v1/chatkit/threads/${threadId}`, {
      title: "ChatKit lifecycle updated",
      metadata: { suite: "bridge-regression", marker, updated: true },
    });
    const item = await postJsonCapture(`${baseUrl}/v1/chatkit/threads/${threadId}/items`, {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: marker }],
      metadata: { marker },
    });
    const items = await getJson(`${baseUrl}/v1/chatkit/threads/${threadId}/items?limit=10`);
    const threads = await getJson(`${baseUrl}/v1/chatkit/threads?user=${encodeURIComponent(session.json.user)}&limit=10`);
    const cancelled = await postJsonCapture(`${baseUrl}/v1/chatkit/sessions/${session.json.id}/cancel`, {});
    const deleted = await deleteJson(`${baseUrl}/v1/chatkit/threads/${threadId}`);
    threadId = null;
    const missingThread = await getJson(`${baseUrl}/v1/chatkit/threads/${thread.json.id}`);
    const deletedJson = parseJsonish(deleted.body);
    const ok = !!testCase.check({
      session: session.json,
      cancelled: cancelled.json,
      thread: thread.json,
      updatedThread: updatedThread.json,
      item: item.json,
      items: items.json,
      threads: threads.json,
      deleted: deletedJson,
      missingThread,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: item.status,
      session_id: session.json.id,
      thread_id: thread.json.id,
      item_id: item.json?.id,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      output_text: `chatkit:${session.json.id}:${thread.json.id}`,
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/chatkit/threads/${threadId}`);
  }
}

async function runRealtimeLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const marker = `${testCase.id}-${context.iteration}-${Date.now().toString(36)}`;
  const session = await postJsonCapture(`${baseUrl}/v1/realtime/sessions`, {
    ...(request.session || {}),
    metadata: { suite: "bridge-regression", marker },
  });
  if (!session.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: session.status,
      error: truncate(session.body),
    });
  }

  const clientSecret = await postJsonCapture(`${baseUrl}/v1/realtime/client_secrets`, {
    expires_after: { anchor: "created_at", seconds: 600 },
    session: {
      type: "realtime",
      model: "gpt-realtime-2",
      instructions: `Realtime client secret ${marker}`,
      output_modalities: ["text"],
    },
  });
  const transcription = await postJsonCapture(`${baseUrl}/v1/realtime/transcription_sessions`, {
    input_audio_transcription: { model: "gpt-4o-transcribe", language: "en", prompt: marker },
  });
  const translationSecret = await postJsonCapture(`${baseUrl}/v1/realtime/translations/client_secrets`, {
    expires_after: { anchor: "created_at", seconds: 900 },
    session: {
      model: "gpt-realtime-translate",
      audio: { output: { language: "es" } },
    },
  });

  const createdCall = await postSdpCapture(`${baseUrl}/v1/realtime/calls`, "v=0\r\ns=open-codex-realtime-eval\r\n");
  const callId = createdCall.headers.location?.split("/").pop() || createdCall.headers["x-open-codex-realtime-call-id"];
  const accepted = callId
    ? await postJsonCapture(`${baseUrl}/v1/realtime/calls/${callId}/accept`, {
      session: { type: "realtime", model: "gpt-realtime-2", instructions: `Accepted ${marker}` },
    })
    : { ok: false, json: null };
  const referred = callId
    ? await postJsonCapture(`${baseUrl}/v1/realtime/calls/${callId}/refer`, {
      target_uri: "sip:+12025550123@sip.example.com",
      metadata: { marker },
    })
    : { ok: false, json: null };
  const hungup = callId
    ? await postJsonCapture(`${baseUrl}/v1/realtime/calls/${callId}/hangup`, {})
    : { ok: false, json: null };

  const rejectCall = await postSdpCapture(`${baseUrl}/v1/realtime/calls`, "v=0\r\ns=open-codex-realtime-reject\r\n");
  const rejectCallId = rejectCall.headers.location?.split("/").pop() || rejectCall.headers["x-open-codex-realtime-call-id"];
  const rejected = rejectCallId
    ? await postJsonCapture(`${baseUrl}/v1/realtime/calls/${rejectCallId}/reject`, { reason: "bridge regression" })
    : { ok: false, json: null };

  const ok = !!testCase.check({
    session: session.json,
    clientSecret: clientSecret.json,
    transcription: transcription.json,
    translationSecret: translationSecret.json,
    accepted: accepted.json,
    referred: referred.json,
    hungup: hungup.json,
    rejected: rejected.json,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: session.status,
    session_id: session.json?.id,
    call_id: callId,
    rejected_call_id: rejectCallId,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    output_text: `realtime:${session.json?.id || "missing"}:${callId || "missing"}`,
  });
}

async function runFineTuningLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const marker = `${testCase.id}-${context.iteration}-${Date.now().toString(36)}`;
  const job = await postJsonCapture(`${baseUrl}/v1/fine_tuning/jobs`, {
    model: request.model || "gpt-4o-mini",
    training_file: `file_train_${marker}`,
    validation_file: `file_valid_${marker}`,
    suffix: "bridge-regression",
    method: {
      type: "supervised",
      supervised: {
        hyperparameters: {
          n_epochs: 2,
        },
      },
    },
    metadata: { suite: "bridge-regression", marker },
  });
  if (!job.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: job.status,
      error: truncate(job.body),
    });
  }

  const fetched = await getJson(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}`);
  const jobs = await getJson(`${baseUrl}/v1/fine_tuning/jobs?limit=20&metadata%5Bsuite%5D=bridge-regression`);
  const events = await getJson(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}/events?limit=10`);
  const checkpoints = await getJson(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}/checkpoints?limit=10`);
  const checkpoint = checkpoints.json?.data?.[0]?.fine_tuned_model_checkpoint || "";
  const checkpointPath = encodeURIComponent(checkpoint);
  const permissionCreate = checkpoint
    ? await postJsonCapture(`${baseUrl}/v1/fine_tuning/checkpoints/${checkpointPath}/permissions`, {
      project_ids: ["proj_bridge_regression_a", "proj_bridge_regression_b"],
    })
    : { ok: false, json: null, status: 0, body: "" };
  const permissionList = checkpoint
    ? await getJson(`${baseUrl}/v1/fine_tuning/checkpoints/${checkpointPath}/permissions?project_id=proj_bridge_regression_a&limit=10`)
    : { ok: false, json: null, status: 0, body: "" };
  const permissionDeleteRaw = checkpoint && permissionCreate.json?.data?.[0]?.id
    ? await deleteJson(`${baseUrl}/v1/fine_tuning/checkpoints/${checkpointPath}/permissions/${permissionCreate.json.data[0].id}`)
    : { ok: false, status: 0, body: "" };
  const paused = await postJsonCapture(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}/pause`, {});
  const resumed = await postJsonCapture(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}/resume`, {});
  const cancelled = await postJsonCapture(`${baseUrl}/v1/fine_tuning/jobs/${job.json.id}/cancel`, {});
  const missingJob = await getJson(`${baseUrl}/v1/fine_tuning/jobs/ftjob_missing_${context.iteration}/events`);
  const permissionDelete = parseJsonish(permissionDeleteRaw.body);
  const ok = !!testCase.check({
    job: job.json,
    fetched: fetched.json,
    jobs: jobs.json,
    events: events.json,
    checkpoints: checkpoints.json,
    permissionCreate: permissionCreate.json,
    permissionList: permissionList.json,
    permissionDelete,
    paused: paused.json,
    resumed: resumed.json,
    cancelled: cancelled.json,
    missingJob,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: job.status,
    job_id: job.json.id,
    checkpoint,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    output_text: `fine_tuning:${job.json.id}:${checkpoint || "missing"}`,
  });
}

async function runOrganizationUsageCostsCase(testCase, context, started) {
  const startTime = 1730419200;
  const costs = await getJson(`${baseUrl}/v1/organization/costs?start_time=${startTime}&limit=2`);
  const completions = await getJson(`${baseUrl}/v1/organization/usage/completions?start_time=${startTime}&bucket_width=1h&limit=2&group_by=project_id`);
  const images = await getJson(`${baseUrl}/v1/organization/usage/images?start_time=${startTime}&bucket_width=1h&limit=2`);
  const fileSearch = await getJson(`${baseUrl}/v1/organization/usage/file_search_calls?start_time=${startTime}&bucket_width=1h&limit=2`);
  const webSearch = await getJson(`${baseUrl}/v1/organization/usage/web_search_calls?start_time=${startTime}&bucket_width=1h&limit=2`);
  const invalidBucket = await getJson(`${baseUrl}/v1/organization/costs?start_time=${startTime}&bucket_width=1h`);
  const missingStart = await getJson(`${baseUrl}/v1/organization/usage/completions`);
  const ok = !!testCase.check({
    costs: costs.json,
    completions: completions.json,
    images: images.json,
    fileSearch: fileSearch.json,
    webSearch: webSearch.json,
    invalidBucket,
    missingStart,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: costs.status,
    costs_bucket_count: costs.json?.data?.length || 0,
    usage_bucket_count: completions.json?.data?.length || 0,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    output_text: `organization_usage:${costs.json?.data?.length || 0}:${completions.json?.data?.length || 0}`,
  });
}

async function runAudioVoiceLifecycleCase(testCase, context, started) {
  const marker = testCase.id;
  const request = resolveRequest(testCase.request, {});
  const stableConsentName = `Eval Consent ${marker}`;
  const stableVoiceName = `Eval Voice ${marker}`;
  const existingVoices = await getJson(`${baseUrl}/v1/audio/voices?limit=100`);
  const existingVoice = (existingVoices.json?.data || []).find((item) => item?.name === stableVoiceName);
  if (existingVoice?.id) {
    const consentGet = await getJson(`${baseUrl}/v1/audio/voice_consents/${existingVoice.consent}`);
    const voiceGet = await getJson(`${baseUrl}/v1/audio/voices/${existingVoice.id}`);
    const consentList = await getJson(`${baseUrl}/v1/audio/voice_consents?limit=100`);
    const voiceList = await getJson(`${baseUrl}/v1/audio/voices?limit=100`);
    const ok = !!testCase.check({
      consent: consentGet.json,
      voice: voiceGet.json,
      consentGet: consentGet.json,
      voiceGet: voiceGet.json,
      consentList: consentList.json,
      voiceList: voiceList.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: voiceGet.status,
      consent_id: existingVoice.consent,
      voice_id: existingVoice.id,
      reused: true,
      usage: audioUsage(null),
      output_text: `audio_voice:${existingVoice.id}:reused`,
    });
  }

  const consentForm = new FormData();
  consentForm.append("name", stableConsentName);
  consentForm.append("language", request.language || "en-US");
  consentForm.append("recording", new Blob([Buffer.from(`consent ${marker}`)], { type: "audio/wav" }), `${marker}-consent.wav`);
  const voiceForm = new FormData();
  voiceForm.append("name", stableVoiceName);
  voiceForm.append("audio_sample", new Blob([Buffer.from(`sample ${marker}`)], { type: "audio/wav" }), `${marker}-sample.wav`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const consentResponse = await fetch(`${baseUrl}/v1/audio/voice_consents`, {
      method: "POST",
      body: consentForm,
      signal: controller.signal,
    });
    const consentBody = await consentResponse.text();
    if (!consentResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: consentResponse.status,
        error: truncate(consentBody),
      });
    }
    const consent = JSON.parse(consentBody);
    voiceForm.append("consent", consent.id);
    const voiceResponse = await fetch(`${baseUrl}/v1/audio/voices`, {
      method: "POST",
      body: voiceForm,
      signal: controller.signal,
    });
    const voiceBody = await voiceResponse.text();
    if (!voiceResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: voiceResponse.status,
        error: truncate(voiceBody),
      });
    }
    const voice = JSON.parse(voiceBody);
    const consentGet = await getJson(`${baseUrl}/v1/audio/voice_consents/${consent.id}`);
    const voiceGet = await getJson(`${baseUrl}/v1/audio/voices/${voice.id}`);
    const consentList = await getJson(`${baseUrl}/v1/audio/voice_consents?limit=100`);
    const voiceList = await getJson(`${baseUrl}/v1/audio/voices?limit=100`);
    const ok = !!testCase.check({
      consent,
      voice,
      consentGet: consentGet.json,
      voiceGet: voiceGet.json,
      consentList: consentList.json,
      voiceList: voiceList.json,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: voiceResponse.status,
      consent_id: consent.id,
      voice_id: voice.id,
      consent_get_status: consentGet.status,
      voice_get_status: voiceGet.status,
      consent_list_status: consentList.status,
      voice_list_status: voiceList.status,
      usage: audioUsage(null),
      output_text: `audio_voice:${voice.id}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runAssistantsLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  const threadIds = new Set();
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Return the requested marker exactly and with no extra words.",
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{ role: "user", content: "Return exactly assistants-life-ok." }],
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        error: truncate(thread.body),
      });
    }
    threadIds.add(thread.json.id);

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${thread.json.id}/runs`, {
      assistant_id: assistantId,
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        error: truncate(run.body),
      });
    }

    const messages = await getJson(`${baseUrl}/v1/threads/${thread.json.id}/messages?order=asc&limit=20`);
    const runs = await getJson(`${baseUrl}/v1/threads/${thread.json.id}/runs?limit=20`);
    const steps = await getJson(`${baseUrl}/v1/threads/${thread.json.id}/runs/${run.json.id}/steps?limit=20`);
    const stepId = steps.json?.data?.[0]?.id || "";
    const step = stepId
      ? await getJson(`${baseUrl}/v1/threads/${thread.json.id}/runs/${run.json.id}/steps/${stepId}`)
      : { status: 0, json: null };

    const streamResponse = await postJson(`${baseUrl}/v1/threads/runs`, {
      assistant_id: assistantId,
      stream: true,
      thread: {
        messages: [{ role: "user", content: "Return exactly assistants-stream-ok." }],
      },
    });
    const streamBody = await streamResponse.text();
    const streamEvents = parseSseEvents(streamBody);
    const streamThread = streamEvents.find((event) => event.event === "thread.created")?.data;
    if (streamThread?.id) threadIds.add(streamThread.id);
    const streamMessage = streamEvents.find((event) => event.event === "thread.message.completed")?.data || null;
    const streamDeltaText = streamEvents
      .filter((event) => event.event === "thread.message.delta")
      .map((event) => event.data?.delta?.content?.[0]?.text?.value || "")
      .join("");

    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      messages: messages.json,
      runs: runs.json,
      steps: steps.json,
      step: step.json,
      streamEvents,
      streamMessage,
      streamDeltaText,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.status,
      assistant_id: assistantId,
      thread_id: thread.json.id,
      run_id: run.json.id,
      message_count: messages.json?.data?.length || 0,
      run_count: runs.json?.data?.length || 0,
      step_count: steps.json?.data?.length || 0,
      stream_status: streamResponse.status,
      event_count: streamEvents.length,
      stream_delta_count: streamEvents.filter((event) => event.event === "thread.message.delta").length,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        messages: messages.json,
        runs: runs.json,
        steps: steps.json,
        step: step.json,
        streamEvents,
      })),
    });
  } finally {
    for (const threadId of threadIds) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsReasoningEffortCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Return the requested marker exactly and with no extra words.",
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: "Return exactly assistants-reasoning-effort-live-ok.",
      }],
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      reasoning_effort: "none",
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(run.body),
      });
    }

    const fetchedRun = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}`);
    const runs = await getJson(`${baseUrl}/v1/threads/${threadId}/runs?limit=20`);
    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      fetchedRun: fetchedRun.json,
      runs: runs.json,
      messages: messages.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json?.status || run.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json?.id,
      run_count: runs.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        fetchedRun: fetchedRun.json,
        runs: runs.json,
        messages: messages.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsTruncationCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Return the requested marker exactly and with no extra words.",
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const oldMessage = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/messages`, {
      role: "user",
      content: "If this old thread item is visible, answer assistants-truncation-old-bad.",
    });
    if (!oldMessage.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: oldMessage.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(oldMessage.body),
      });
    }
    await sleep(1100);

    const recentMessage = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/messages`, {
      role: "user",
      content: "Return exactly assistants-truncation-live-ok.",
    });
    if (!recentMessage.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: recentMessage.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(recentMessage.body),
      });
    }

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      truncation_strategy: { type: "last_messages", last_messages: 1 },
      max_prompt_tokens: 96,
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(run.body),
      });
    }

    const fetchedRun = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}`);
    const runs = await getJson(`${baseUrl}/v1/threads/${threadId}/runs?limit=20`);
    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      fetchedRun: fetchedRun.json,
      runs: runs.json,
      messages: messages.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json?.status || run.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json?.id,
      run_count: runs.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      dropped_message_count: run.json?.metadata?.compatibility?.local_assistants?.truncation?.dropped_message_count,
      included_message_count: run.json?.metadata?.compatibility?.local_assistants?.truncation?.included_message_count,
      max_prompt_tokens: run.json?.max_prompt_tokens,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        fetchedRun: fetchedRun.json,
        runs: runs.json,
        messages: messages.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsTokenBudgetCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Return the requested marker and then continue with several words.",
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: "Return assistants-token-budget-live-ok and five extra words.",
      }],
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      max_completion_tokens: 1,
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(run.body),
      });
    }

    const fetchedRun = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}`);
    const runs = await getJson(`${baseUrl}/v1/threads/${threadId}/runs?limit=20`);
    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      fetchedRun: fetchedRun.json,
      runs: runs.json,
      messages: messages.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json?.status || run.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json?.id,
      incomplete_reason: run.json?.incomplete_details?.reason,
      token_budget_trigger: run.json?.metadata?.compatibility?.local_assistants?.token_budget?.trigger,
      run_count: runs.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        fetchedRun: fetchedRun.json,
        runs: runs.json,
        messages: messages.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsRequiredActionCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  const threadIds = new Set();
  let firstRun = null;
  let finalRun = null;
  let toolCallCount = 0;
  let messageLock = null;
  let runLock = null;
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: [
        "You must call the marker_tool function before answering.",
        "After tool output is provided, return that tool output exactly and with no extra words.",
      ].join(" "),
      tools: [{
        type: "function",
        function: {
          name: "marker_tool",
          description: "Returns a marker string to verify Assistants required_action compatibility.",
          parameters: {
            type: "object",
            properties: {
              marker: { type: "string" },
            },
            required: ["marker"],
          },
        },
      }],
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: "Call marker_tool with marker assistants-tool-ok, then return the tool output.",
      }],
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        error: truncate(thread.body),
      });
    }
    threadIds.add(thread.json.id);

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${thread.json.id}/runs`, {
      assistant_id: assistantId,
      tool_choice: "auto",
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        error: truncate(run.body),
      });
    }
    firstRun = run.json;
    finalRun = run.json;

    if (finalRun?.status === "requires_action") {
      messageLock = await postJsonCapture(`${baseUrl}/v1/threads/${thread.json.id}/messages`, {
        role: "user",
        content: "This message should be rejected while the required_action run is active.",
      });
      runLock = await postJsonCapture(`${baseUrl}/v1/threads/${thread.json.id}/runs`, {
        assistant_id: assistantId,
        metadata: { suite: testCase.id, blocked_by: finalRun.id },
      });
    }

    for (let round = 0; finalRun?.status === "requires_action" && round < 3; round += 1) {
      const toolCalls = finalRun.required_action?.submit_tool_outputs?.tool_calls || [];
      toolCallCount += toolCalls.length;
      const submit = await postJsonCapture(`${baseUrl}/v1/threads/${thread.json.id}/runs/${finalRun.id}/submit_tool_outputs`, {
        tool_outputs: toolCalls.map((toolCall) => ({
          tool_call_id: toolCall.id,
          output: "assistants-tool-ok",
        })),
      });
      if (!submit.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: submit.status,
          assistant_id: assistantId,
          thread_id: thread.json.id,
          run_id: finalRun.id,
          tool_call_count: toolCallCount,
          error: truncate(submit.body),
        });
      }
      finalRun = submit.json;
    }

    const messages = await getJson(`${baseUrl}/v1/threads/${thread.json.id}/messages?order=asc&limit=20`);
    const steps = finalRun?.id
      ? await getJson(`${baseUrl}/v1/threads/${thread.json.id}/runs/${finalRun.id}/steps?limit=20`)
      : { status: 0, json: null };

    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      firstRun,
      finalRun,
      messages: messages.json,
      steps: steps.json,
      toolCallCount,
      messageLock,
      runLock,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: finalRun?.status || run.status,
      assistant_id: assistantId,
      thread_id: thread.json.id,
      run_id: finalRun?.id || run.json.id,
      first_status: firstRun?.status,
      final_status: finalRun?.status,
      message_lock_status: messageLock?.status,
      run_lock_status: runLock?.status,
      tool_call_count: toolCallCount,
      step_count: steps.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      usage: assistantsUsage(finalRun),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        firstRun,
        finalRun,
        messages: messages.json,
        steps: steps.json,
        toolCallCount,
        messageLock,
        runLock,
      })),
    });
  } finally {
    for (const threadId of threadIds) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsAdditionalMessagesCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  try {
    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Return the requested marker exactly and with no extra words.",
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      additional_instructions: "Per-run additional instruction: honor the appended user message.",
      additional_messages: [{
        role: "user",
        content: "Return exactly assistants-additional-live-ok.",
        metadata: { source: "additional_messages" },
      }],
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        error: truncate(run.body),
      });
    }

    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const runs = await getJson(`${baseUrl}/v1/threads/${threadId}/runs?limit=20`);
    const steps = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}/steps?limit=20`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      messages: messages.json,
      runs: runs.json,
      steps: steps.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json?.status || run.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json?.id,
      message_count: messages.json?.data?.length || 0,
      run_count: runs.json?.data?.length || 0,
      step_count: steps.json?.data?.length || 0,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        messages: messages.json,
        runs: runs.json,
        steps: steps.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
  }
}

async function runAssistantsFileSearchCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  let fileId = null;
  let vectorStoreId = null;
  try {
    const file = await postJsonCapture(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}.txt`,
      purpose: "assistants",
      content: "Assistants live file-search fixture says the exact marker is assistants-file-search-live-ok.",
    });
    if (!file.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: file.status,
        error: truncate(file.body),
      });
    }
    fileId = file.json.id;

    const vectorStore = await postJsonCapture(`${baseUrl}/v1/vector_stores`, {
      name: `Bridge ${testCase.id}`,
      metadata: { suite: "bridge-regression", case_id: testCase.id },
    });
    if (!vectorStore.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: vectorStore.status,
        file_id: fileId,
        error: truncate(vectorStore.body),
      });
    }
    vectorStoreId = vectorStore.json.id;

    const attached = await postJsonCapture(`${baseUrl}/v1/vector_stores/${vectorStoreId}/files`, {
      file_id: fileId,
      attributes: { suite: "bridge-regression", case_id: testCase.id },
    });
    if (!attached.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: attached.status,
        file_id: fileId,
        vector_store_id: vectorStoreId,
        error: truncate(attached.body),
      });
    }

    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Use file_search evidence. Return exactly assistants-file-search-live-ok [1] and no extra words.",
      tools: [{ type: "file_search" }],
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        file_id: fileId,
        vector_store_id: vectorStoreId,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: "File search for assistants-file-search-live-ok. Return exactly assistants-file-search-live-ok [1].",
      }],
      tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        file_id: fileId,
        vector_store_id: vectorStoreId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        file_id: fileId,
        vector_store_id: vectorStoreId,
        error: truncate(run.body),
      });
    }

    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const steps = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}/steps?limit=20`);
    const includeParam = encodeURIComponent(ASSISTANT_RUN_STEP_FILE_SEARCH_CONTENT_INCLUDE);
    const stepsIncluded = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}/steps?limit=20&include[]=${includeParam}`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      messages: messages.json,
      steps: steps.json,
      stepsIncluded: stepsIncluded.json,
      file: file.json,
      vectorStore: vectorStore.json,
      attached: attached.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json.id,
      file_id: fileId,
      vector_store_id: vectorStoreId,
      step_count: steps.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        messages: messages.json,
        steps: steps.json,
        stepsIncluded: stepsIncluded.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
    if (vectorStoreId) await deleteJson(`${baseUrl}/v1/vector_stores/${vectorStoreId}`);
    if (fileId) await deleteJson(`${baseUrl}/v1/files/${fileId}`);
  }
}

async function runAssistantsCodeInterpreterCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let assistantId = null;
  let threadId = null;
  let fileId = null;
  try {
    const file = await postJsonCapture(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}-fixture.txt`,
      purpose: "assistants",
      content: "mounted-live-ok",
    });
    if (!file.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: file.status,
        error: truncate(file.body),
      });
    }
    fileId = file.json.id;

    const assistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id}`,
      instructions: "Use code_interpreter output. Return exactly assistants-ci-live-ok and no extra words.",
      tools: [{ type: "code_interpreter" }],
      tool_resources: { code_interpreter: { file_ids: [fileId] } },
      metadata: { suite: testCase.id },
    });
    if (!assistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: assistant.status,
        file_id: fileId,
        error: truncate(assistant.body),
      });
    }
    assistantId = assistant.json.id;

    const thread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: [
          "Run this Python and answer from its output.",
          "```python",
          "from pathlib import Path",
          "print('assistants-ci-live-ok')",
          `print(Path('/mnt/data/${testCase.id}-fixture.txt').read_text())`,
          "```",
          "Return exactly assistants-ci-live-ok.",
        ].join("\n"),
      }],
      metadata: { suite: testCase.id },
    });
    if (!thread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: thread.status,
        assistant_id: assistantId,
        file_id: fileId,
        error: truncate(thread.body),
      });
    }
    threadId = thread.json.id;

    const run = await postJsonCapture(`${baseUrl}/v1/threads/${threadId}/runs`, {
      assistant_id: assistantId,
      metadata: { suite: testCase.id },
    });
    if (!run.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: run.status,
        assistant_id: assistantId,
        thread_id: threadId,
        file_id: fileId,
        error: truncate(run.body),
      });
    }

    const messages = await getJson(`${baseUrl}/v1/threads/${threadId}/messages?order=asc&limit=20`);
    const steps = await getJson(`${baseUrl}/v1/threads/${threadId}/runs/${run.json.id}/steps?limit=20`);
    const ok = !!testCase.check({
      assistant: assistant.json,
      thread: thread.json,
      run: run.json,
      messages: messages.json,
      steps: steps.json,
      file: file.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: run.json.status,
      assistant_id: assistantId,
      thread_id: threadId,
      run_id: run.json.id,
      file_id: fileId,
      step_count: steps.json?.data?.length || 0,
      message_count: messages.json?.data?.length || 0,
      usage: assistantsUsage(run.json),
      output_text: assistantMessageTextFromList(messages.json?.data || []),
      error: ok ? undefined : truncate(JSON.stringify({
        run: run.json,
        messages: messages.json,
        steps: steps.json,
      })),
    });
  } finally {
    if (threadId) await deleteJson(`${baseUrl}/v1/threads/${threadId}`);
    if (assistantId) await deleteJson(`${baseUrl}/v1/assistants/${assistantId}`);
    if (fileId) await deleteJson(`${baseUrl}/v1/files/${fileId}`);
  }
}

async function runAssistantsAttachmentsCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let searchAssistantId = null;
  let codeAssistantId = null;
  let searchThreadId = null;
  let codeThreadId = null;
  let searchFileId = null;
  let codeFileId = null;
  let searchVectorStoreId = null;
  try {
    const searchFile = await postJsonCapture(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}-search.txt`,
      purpose: "assistants",
      content: "Assistants attachment fixture says assistants-attachment-search-live-ok.",
    });
    if (!searchFile.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchFile.status,
        error: truncate(searchFile.body),
      });
    }
    searchFileId = searchFile.json.id;

    const searchAssistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id} file_search`,
      instructions: "Use file_search evidence. Return exactly assistants-attachment-search-live-ok [1] and no extra words.",
      tools: [{ type: "file_search" }],
      metadata: { suite: testCase.id, branch: "file_search_attachment" },
    });
    if (!searchAssistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchAssistant.status,
        file_id: searchFileId,
        error: truncate(searchAssistant.body),
      });
    }
    searchAssistantId = searchAssistant.json.id;

    const searchThread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      messages: [{
        role: "user",
        content: "Use the attached file_search file. Return exactly assistants-attachment-search-live-ok [1].",
        attachments: [{ file_id: searchFileId, tools: [{ type: "file_search" }] }],
      }],
      metadata: { suite: testCase.id, branch: "file_search_attachment" },
    });
    if (!searchThread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchThread.status,
        assistant_id: searchAssistantId,
        file_id: searchFileId,
        error: truncate(searchThread.body),
      });
    }
    searchThreadId = searchThread.json.id;
    searchVectorStoreId = searchThread.json.tool_resources?.file_search?.vector_store_ids?.[0] || null;
    if (!searchVectorStoreId) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchThread.status,
        assistant_id: searchAssistantId,
        thread_id: searchThreadId,
        file_id: searchFileId,
        error: "file_search attachment did not create a thread vector store",
      });
    }

    const searchAttachedFiles = await getJson(`${baseUrl}/v1/vector_stores/${searchVectorStoreId}/files?limit=20`);
    const searchRun = await postJsonCapture(`${baseUrl}/v1/threads/${searchThreadId}/runs`, {
      assistant_id: searchAssistantId,
      metadata: { suite: testCase.id, branch: "file_search_attachment" },
    });
    if (!searchRun.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: searchRun.status,
        assistant_id: searchAssistantId,
        thread_id: searchThreadId,
        file_id: searchFileId,
        vector_store_id: searchVectorStoreId,
        error: truncate(searchRun.body),
      });
    }
    const searchMessages = await getJson(`${baseUrl}/v1/threads/${searchThreadId}/messages?order=asc&limit=20`);
    const searchSteps = await getJson(`${baseUrl}/v1/threads/${searchThreadId}/runs/${searchRun.json.id}/steps?limit=20`);

    const codeFile = await postJsonCapture(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}-ci.txt`,
      purpose: "assistants",
      content: "attachment-mounted-live-ok",
    });
    if (!codeFile.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: codeFile.status,
        search_run_id: searchRun.json.id,
        error: truncate(codeFile.body),
      });
    }
    codeFileId = codeFile.json.id;

    const codeAssistant = await postJsonCapture(`${baseUrl}/v1/assistants`, {
      model: request.model,
      name: `Bridge ${testCase.id} code_interpreter`,
      instructions: "Use code_interpreter output. Return exactly assistants-attachment-ci-live-ok and no extra words.",
      tools: [{ type: "code_interpreter" }],
      metadata: { suite: testCase.id, branch: "code_interpreter_attachment" },
    });
    if (!codeAssistant.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: codeAssistant.status,
        search_run_id: searchRun.json.id,
        file_id: codeFileId,
        error: truncate(codeAssistant.body),
      });
    }
    codeAssistantId = codeAssistant.json.id;

    const codeThread = await postJsonCapture(`${baseUrl}/v1/threads`, {
      metadata: { suite: testCase.id, branch: "code_interpreter_attachment" },
    });
    if (!codeThread.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: codeThread.status,
        assistant_id: codeAssistantId,
        file_id: codeFileId,
        error: truncate(codeThread.body),
      });
    }
    codeThreadId = codeThread.json.id;

    const codeMessage = await postJsonCapture(`${baseUrl}/v1/threads/${codeThreadId}/messages`, {
      role: "user",
      content: [
        "Run this Python and answer from its output.",
        "```python",
        "from pathlib import Path",
        "print('assistants-attachment-ci-live-ok')",
        `print(Path('/mnt/data/${testCase.id}-ci.txt').read_text())`,
        "```",
        "Return exactly assistants-attachment-ci-live-ok.",
      ].join("\n"),
      attachments: [{ file_id: codeFileId, tools: [{ type: "code_interpreter" }] }],
      metadata: { suite: testCase.id, branch: "code_interpreter_attachment" },
    });
    if (!codeMessage.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: codeMessage.status,
        assistant_id: codeAssistantId,
        thread_id: codeThreadId,
        file_id: codeFileId,
        error: truncate(codeMessage.body),
      });
    }

    const codeThreadAfterMessage = await getJson(`${baseUrl}/v1/threads/${codeThreadId}`);
    const codeRun = await postJsonCapture(`${baseUrl}/v1/threads/${codeThreadId}/runs`, {
      assistant_id: codeAssistantId,
      metadata: { suite: testCase.id, branch: "code_interpreter_attachment" },
    });
    if (!codeRun.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: codeRun.status,
        assistant_id: codeAssistantId,
        thread_id: codeThreadId,
        file_id: codeFileId,
        error: truncate(codeRun.body),
      });
    }
    const codeMessages = await getJson(`${baseUrl}/v1/threads/${codeThreadId}/messages?order=asc&limit=20`);
    const codeSteps = await getJson(`${baseUrl}/v1/threads/${codeThreadId}/runs/${codeRun.json.id}/steps?limit=20`);

    const ok = !!testCase.check({
      searchAssistant: searchAssistant.json,
      searchThread: searchThread.json,
      searchRun: searchRun.json,
      searchMessages: searchMessages.json,
      searchSteps: searchSteps.json,
      searchFile: searchFile.json,
      searchVectorStoreId,
      searchAttachedFiles: searchAttachedFiles.json,
      codeAssistant: codeAssistant.json,
      codeThread: codeThreadAfterMessage.json,
      codeRun: codeRun.json,
      codeMessages: codeMessages.json,
      codeSteps: codeSteps.json,
      codeFile: codeFile.json,
      codeMessage: codeMessage.json,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: `${searchRun.json.status}/${codeRun.json.status}`,
      search_assistant_id: searchAssistantId,
      search_thread_id: searchThreadId,
      search_run_id: searchRun.json.id,
      search_file_id: searchFileId,
      search_vector_store_id: searchVectorStoreId,
      code_assistant_id: codeAssistantId,
      code_thread_id: codeThreadId,
      code_run_id: codeRun.json.id,
      code_file_id: codeFileId,
      search_step_count: searchSteps.json?.data?.length || 0,
      code_step_count: codeSteps.json?.data?.length || 0,
      search_message_count: searchMessages.json?.data?.length || 0,
      code_message_count: codeMessages.json?.data?.length || 0,
      usage: sumUsage([assistantsUsage(searchRun.json), assistantsUsage(codeRun.json)]),
      output_text: [
        assistantMessageTextFromList(searchMessages.json?.data || []),
        assistantMessageTextFromList(codeMessages.json?.data || []),
      ].filter(Boolean).join(" | "),
      error: ok ? undefined : truncate(JSON.stringify({
        searchRun: searchRun.json,
        searchMessages: searchMessages.json,
        searchSteps: searchSteps.json,
        searchAttachedFiles: searchAttachedFiles.json,
        codeThread: codeThreadAfterMessage.json,
        codeRun: codeRun.json,
        codeMessages: codeMessages.json,
        codeSteps: codeSteps.json,
      })),
    });
  } finally {
    if (codeThreadId) await deleteJson(`${baseUrl}/v1/threads/${codeThreadId}`);
    if (searchThreadId) await deleteJson(`${baseUrl}/v1/threads/${searchThreadId}`);
    if (codeAssistantId) await deleteJson(`${baseUrl}/v1/assistants/${codeAssistantId}`);
    if (searchAssistantId) await deleteJson(`${baseUrl}/v1/assistants/${searchAssistantId}`);
    if (searchVectorStoreId) await deleteJson(`${baseUrl}/v1/vector_stores/${searchVectorStoreId}`);
    if (codeFileId) await deleteJson(`${baseUrl}/v1/files/${codeFileId}`);
    if (searchFileId) await deleteJson(`${baseUrl}/v1/files/${searchFileId}`);
  }
}

async function runEvalsLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let evalId = null;
  let fileId = null;
  try {
    const evalResponse = await postJson(`${baseUrl}/v1/evals`, {
      name: `Bridge ${testCase.id}`,
      data_source_config: {
        type: "custom",
        include_sample_schema: true,
        item_schema: {
          type: "object",
          properties: {
            ticket_text: { type: "string" },
            correct_label: { type: "string" },
          },
          required: ["ticket_text", "correct_label"],
          additionalProperties: false,
        },
      },
      testing_criteria: [{
        type: "string_check",
        name: "Exact label match",
        input: "{{ sample.output_text }}",
        operation: "eq",
        reference: "{{ item.correct_label }}",
      }],
      metadata: { suite: "bridge-regression", case_id: testCase.id },
    });
    const evalBody = await evalResponse.text();
    if (!evalResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: evalResponse.status,
        error: truncate(evalBody),
      });
    }
    const evalObject = JSON.parse(evalBody);
    evalId = evalObject.id || null;

    const jsonl = [
      {
        item: { ticket_text: "Mouse will not pair after update.", correct_label: "Hardware" },
        sample: { output_text: "Hardware" },
      },
      {
        item: { ticket_text: "Editor plugin crashes on startup.", correct_label: "Software" },
        sample: { output_text: "Hardware" },
      },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n";
    const fileResponse = await postJson(`${baseUrl}/v1/files`, {
      filename: `${testCase.id}.jsonl`,
      purpose: "evals",
      content_base64: Buffer.from(jsonl, "utf8").toString("base64"),
      mime_type: "application/jsonl",
      metadata: { suite: "bridge-regression", case_id: testCase.id },
    });
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    const file = JSON.parse(fileBody);
    fileId = file.id || null;

    const runResponse = await postJson(`${baseUrl}/v1/evals/${evalId}/runs`, {
      name: `Bridge ${testCase.id} run`,
      data_source: {
        type: "responses",
        model: request.model || model,
        source: { type: "file_id", id: file.id },
        input_messages: {
          type: "template",
          template: [{
            role: "user",
            content: "Classify this support ticket as Hardware or Software: {{ item.ticket_text }}",
          }],
        },
      },
      metadata: { suite: "bridge-regression", case_id: testCase.id },
    });
    const runBody = await runResponse.text();
    if (!runResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: runResponse.status,
        error: truncate(runBody),
      });
    }
    const run = JSON.parse(runBody);

    const outputItems = await getJson(`${baseUrl}/v1/evals/${evalId}/runs/${run.id}/output_items?limit=20`);
    const firstOutputItemId = outputItems.json?.data?.[0]?.id || null;
    const outputItem = firstOutputItemId
      ? await getJson(`${baseUrl}/v1/evals/${evalId}/runs/${run.id}/output_items/${firstOutputItemId}`)
      : { status: 0, ok: false, json: null };
    const runGet = await getJson(`${baseUrl}/v1/evals/${evalId}/runs/${run.id}`);
    const runList = await getJson(`${baseUrl}/v1/evals/${evalId}/runs?limit=20`);
    const updateResponse = await postJson(`${baseUrl}/v1/evals/${evalId}`, {
      metadata: { updated: "true", suite: "bridge-regression", case_id: testCase.id },
    });
    const updateBody = await updateResponse.text();
    const evalUpdated = parseJsonish(updateBody);
    const evalList = await getJson(`${baseUrl}/v1/evals?limit=20&order=desc&order_by=updated_at`);
    const deleteResponse = await deleteJson(`${baseUrl}/v1/evals/${evalId}`);
    const deleted = parseJsonish(deleteResponse.body);
    if (deleted?.deleted) evalId = null;

    const ok = !!testCase.check({
      evalObject,
      file,
      run,
      outputItems: outputItems.json,
      outputItem: outputItem.json,
      runGet: runGet.json,
      runList: runList.json,
      evalList: evalList.json,
      evalUpdated,
      deleted,
    });
    return finishResult(testCase, context, started, {
      ok,
      status: runResponse.status,
      eval_id: evalObject.id,
      file_id: file.id,
      run_id: run.id,
      output_item_count: Array.isArray(outputItems.json?.data) ? outputItems.json.data.length : 0,
      run_status: run.status,
      result_counts: run.result_counts,
      output_item_status: outputItems.status,
      output_item_get_status: outputItem.status,
      run_get_status: runGet.status,
      run_list_status: runList.status,
      eval_update_status: updateResponse.status,
      eval_list_status: evalList.status,
      delete_status: deleteResponse.status,
      usage: moderationUsage(),
      output_text: `evals:${run.result_counts?.passed || 0}/${run.result_counts?.total || 0}`,
    });
  } finally {
    if (evalId) await deleteJson(`${baseUrl}/v1/evals/${evalId}`);
    if (fileId) await deleteJson(`${baseUrl}/v1/files/${fileId}`);
  }
}

async function runGradersApiLocalCase(testCase, context, started) {
  const validate = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/validate`, {
    grader: {
      type: "string_check",
      name: "exact",
      input: "{{ sample.output_text }}",
      reference: "{{ item.label }}",
      operation: "eq",
    },
  });
  const similarity = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/run`, {
    grader: {
      type: "text_similarity",
      name: "summary_similarity",
      input: "{{ sample.output_text }}",
      reference: "{{ item.reference_answer }}",
      evaluation_metric: "rouge_l",
      pass_threshold: 0.5,
    },
    item: { reference_answer: "The router was restarted successfully" },
    model_sample: "Router restarted successfully",
  });
  const multi = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/run`, {
    grader: {
      type: "multi",
      name: "contact_json",
      graders: {
        name: {
          type: "text_similarity",
          input: "{{ sample.output_json.name }}",
          reference: "{{ item.name }}",
          evaluation_metric: "fuzzy_match",
          pass_threshold: 0.7,
        },
        email: {
          type: "string_check",
          input: "{{ sample.output_json.email }}",
          reference: "{{ item.email }}",
          operation: "eq",
        },
      },
      calculate_output: "(name + email) / 2",
      pass_threshold: 0.8,
    },
    item: { name: "Jane Doe", email: "jane@example.com" },
    model_sample: {
      output_text: "{\"name\":\"Jane Do\",\"email\":\"jane@example.com\"}",
      output_json: { name: "Jane Do", email: "jane@example.com" },
    },
  });
  const python = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/run`, {
    grader: {
      type: "python",
      name: "exact_python",
      source: [
        "def grade(sample, item):",
        "    return 1.0 if sample.get('output_text') == item.get('expected') else 0.0",
      ].join("\n"),
    },
    item: { expected: "python-grader-ok" },
    model_sample: "python-grader-ok",
  });
  const unsupported = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/validate`, {
    grader: {
      type: "javascript",
      source: "function grade() { return 1; }",
    },
  });

  const ok = !!testCase.check({
    validate: validate.json,
    similarity: similarity.json,
    multi: multi.json,
    python: python.json,
    unsupported,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: multi.status,
    validate_status: validate.status,
    similarity_status: similarity.status,
    python_status: python.status,
    unsupported_status: unsupported.status,
    similarity_reward: similarity.json?.reward || 0,
    multi_reward: multi.json?.reward || 0,
    python_reward: python.json?.reward || 0,
    usage: moderationUsage(),
    output_text: `graders:${similarity.json?.reward || 0}:${multi.json?.reward || 0}:${python.json?.reward || 0}`,
  });
}

async function runGradersApiScoreModelCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const run = await postJsonCapture(`${baseUrl}/v1/fine_tuning/alpha/graders/run`, {
    grader: {
      type: "score_model",
      name: "live_score_model_judge",
      input: [{
        role: "user",
        content: [
          "Grade whether the model answer is semantically equivalent to the reference answer.",
          "Return JSON with result 1 for equivalent and 0 for not equivalent.",
          "Reference: {{ item.reference }}",
          "Model answer: {{ sample.output_text }}",
        ].join("\n"),
      }],
      model: request.model || model,
      range: [0, 1],
      pass_threshold: 0.5,
      sampling_params: {
        temperature: 0,
        max_completion_tokens: 256,
      },
    },
    item: { reference: "exact-pass" },
    model_sample: "exact-pass",
  });

  const ok = !!testCase.check({
    run: run.json,
  });
  return finishResult(testCase, context, started, {
    ok,
    status: run.status,
    reward: run.json?.reward || 0,
    sampled_model_name: run.json?.metadata?.sampled_model_name || null,
    model_grader_output_text: truncate(run.json?.metadata?.compatibility?.model_grader_output_text || ""),
    usage: {
      input_tokens: run.json?.metadata?.token_usage?.prompt_tokens || 0,
      output_tokens: run.json?.metadata?.token_usage?.completion_tokens || 0,
      total_tokens: run.json?.metadata?.token_usage?.total_tokens || 0,
    },
    output_text: `score_model:${run.json?.reward || 0}`,
  });
}

async function runVideoLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let videoId = null;
  try {
    const createResponse = await postJson(`${baseUrl}/v1/videos`, request);
    const createBody = await createResponse.text();
    if (!createResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: createResponse.status,
        error: truncate(createBody),
      });
    }

    const created = JSON.parse(createBody);
    videoId = created.id || null;
    const retrieved = videoId ? await getJson(`${baseUrl}/v1/videos/${videoId}`) : { status: 0, json: null };
    const listed = await getJson(`${baseUrl}/v1/videos?limit=20`);
    const content = videoId ? await getBinaryMetadata(`${baseUrl}/v1/videos/${videoId}/content`) : { status: 0, bytes: 0 };
    const deletedResponse = videoId ? await deleteJson(`${baseUrl}/v1/videos/${videoId}`) : { status: 0, body: "" };
    const deleted = parseJsonish(deletedResponse.body);
    if (deleted?.deleted) videoId = null;
    const text = `video:${created.status}:${content.ok ? "content" : "missing"}`;
    const ok = !!testCase.check({
      created,
      retrieved: retrieved.json,
      listed: listed.json,
      content,
      deleted,
      text,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: createResponse.status,
      video_id: created.id,
      retrieve_status: retrieved.status,
      list_status: listed.status,
      content_status: content.status,
      delete_status: deletedResponse.status,
      usage: videoUsage(created),
      output_text: text,
    });
  } finally {
    if (videoId) await deleteJson(`${baseUrl}/v1/videos/${videoId}`);
  }
}

async function runVideoCharacterLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  let videoId = null;
  let characterId = null;
  try {
    const characterForm = new FormData();
    characterForm.append("name", "Bridge regression character");
    characterForm.append("video", new Blob([Buffer.from("tiny bridge regression character video")], { type: "video/mp4" }), "bridge-character.mp4");
    const characterResponse = await fetch(`${baseUrl}/v1/videos/characters`, {
      method: "POST",
      body: characterForm,
    });
    const characterBody = await characterResponse.text();
    if (!characterResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: characterResponse.status,
        error: truncate(characterBody),
      });
    }

    const createdCharacter = JSON.parse(characterBody);
    characterId = createdCharacter.id || null;
    const retrievedCharacter = characterId ? await getJson(`${baseUrl}/v1/videos/characters/${characterId}`) : { status: 0, json: null };
    const videoResponse = await postJson(`${baseUrl}/v1/videos`, {
      ...request,
      characters: [{ id: characterId }],
    });
    const videoBody = await videoResponse.text();
    if (!videoResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: videoResponse.status,
        character_id: characterId,
        retrieve_character_status: retrievedCharacter.status,
        error: truncate(videoBody),
      });
    }

    const createdVideo = JSON.parse(videoBody);
    videoId = createdVideo.id || null;
    const deletedCharacterResponse = characterId ? await deleteJson(`${baseUrl}/v1/videos/characters/${characterId}`) : { status: 0, body: "" };
    const deletedCharacter = parseJsonish(deletedCharacterResponse.body);
    if (deletedCharacter?.deleted) characterId = null;
    const text = `video-character:${createdCharacter.status}:${createdVideo.status}`;
    const ok = !!testCase.check({
      createdCharacter,
      retrievedCharacter: retrievedCharacter.json,
      createdVideo,
      deletedCharacter,
      text,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: videoResponse.status,
      character_id: createdCharacter.id,
      video_id: createdVideo.id,
      retrieve_character_status: retrievedCharacter.status,
      delete_character_status: deletedCharacterResponse.status,
      usage: videoUsage(createdVideo),
      output_text: text,
    });
  } finally {
    if (videoId) await deleteJson(`${baseUrl}/v1/videos/${videoId}`);
    if (characterId) await deleteJson(`${baseUrl}/v1/videos/characters/${characterId}`);
  }
}

async function runVideoIterationLifecycleCase(testCase, context, started) {
  const request = resolveRequest(testCase.request, {});
  const videoIds = new Set();
  try {
    const createResponse = await postJson(`${baseUrl}/v1/videos`, request);
    const createBody = await createResponse.text();
    if (!createResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: createResponse.status,
        error: truncate(createBody),
      });
    }

    const created = JSON.parse(createBody);
    if (created.id) videoIds.add(created.id);

    const edit = await postJsonCapture(`${baseUrl}/v1/videos/edits`, {
      model: request.model,
      prompt: "Edit the base clip by making the camera movement smoother.",
      video: { id: created.id },
      size: request.size,
    });
    const extension = await postJsonCapture(`${baseUrl}/v1/videos/extensions`, {
      model: request.model,
      prompt: "Extend the base clip with the same visual style.",
      video: { id: created.id },
      seconds: "8",
    });
    const pathEdit = await postJsonCapture(`${baseUrl}/v1/videos/${created.id}/edits`, {
      model: request.model,
      prompt: "Edit through the path-compatible route.",
    });
    const remix = await postJsonCapture(`${baseUrl}/v1/videos/${created.id}/remix`, {
      model: request.model,
      prompt: "Remix the base clip with a wider camera angle.",
    });

    const bodies = {
      edit: edit.json,
      extension: extension.json,
      pathEdit: pathEdit.json,
      remix: remix.json,
    };
    for (const body of Object.values(bodies)) {
      if (body?.id) videoIds.add(body.id);
    }

    const allStatusesOk = [edit, extension, pathEdit, remix].every((response) => response.ok);
    const text = `video-iteration:${bodies.edit?.status}:${bodies.extension?.status}:${bodies.pathEdit?.status}:${bodies.remix?.status}`;
    const ok = allStatusesOk && !!testCase.check({
      created,
      ...bodies,
      text,
    });

    return finishResult(testCase, context, started, {
      ok,
      status: createResponse.status,
      video_id: created.id,
      edit_status: edit.status,
      extension_status: extension.status,
      path_edit_status: pathEdit.status,
      remix_status: remix.status,
      usage: videoUsage(created),
      output_text: text,
      error: ok ? undefined : truncate(JSON.stringify({ edit: edit.body, extension: extension.body, pathEdit: pathEdit.body, remix: remix.body })),
    });
  } finally {
    for (const id of videoIds) {
      await deleteJson(`${baseUrl}/v1/videos/${id}`);
    }
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

async function runImageApiStreamCase(testCase, context, started, path, eventPrefix) {
  const response = await postJson(`${baseUrl}${path}`, testCase.request);
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const events = parseSseEvents(body);
  const partials = events.filter((event) => event.event === `${eventPrefix}.partial_image`);
  const completed = events.findLast((event) => event.event === `${eventPrefix}.completed`)?.data || null;
  const text = `${eventPrefix}:${partials.length}:${completed ? "completed" : "missing"}`;
  const ok = !!testCase.check({ completed, events, partials, text });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: imagesGenerationUsage({ usage: completed?.usage || {} }),
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

async function runMcpRemoteCase(testCase, context, started) {
  const authValue = "eval-remote-mcp-token";
  const wantsCall = !!testCase.remoteCall;
  const wantsApproval = !!testCase.remoteApproval;
  const approvalApprove = testCase.remoteApprovalApprove !== false;
  const wantsBackground = !!testCase.background || !!testCase.request?.background;
  const wantsStream = !!testCase.request?.stream;
  const records = [];
  const mcpServer = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const rpc = parseJsonish(raw) || {};
      records.push({
        method: rpc.method || null,
        id: rpc.id,
        params: rpc.params || null,
        headers: req.headers,
      });
      if (rpc.method === "initialize") {
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "sess_eval_remote_mcp",
        });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "eval-remote-mcp", version: "1.0.0" },
          },
        }));
        return;
      }
      if (rpc.method === "notifications/initialized") {
        res.writeHead(202, { "content-type": "application/json" });
        res.end("");
        return;
      }
      if (rpc.method === "tools/list") {
        const payload = {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            tools: [
              {
                name: "roll",
                description: "Roll dice remotely",
                inputSchema: {
                  type: "object",
                  properties: {
                    expression: { type: "string" },
                  },
                  required: ["expression"],
                  additionalProperties: false,
                },
                annotations: { readOnlyHint: true },
              },
              {
                name: "hidden_tool",
                description: "Filtered by allowed_tools",
                inputSchema: { type: "object" },
              },
            ],
          },
        };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        return;
      }
      if (rpc.method === "tools/call") {
        if (rpc.params?.name !== "roll" || rpc.params?.arguments?.expression !== "2d4+1") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "unexpected_tools_call", params: rpc.params }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "sess_eval_remote_mcp",
        });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            content: [{ type: "text", text: "7" }],
          },
        }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown_method", method: rpc.method }));
    });
  });

  try {
    const address = await listenServer(mcpServer);
    const request = {
      ...resolveRequest(testCase.request, {}),
      tools: [{
        type: "mcp",
        server_label: "remote_eval",
        server_url: `http://127.0.0.1:${address.port}/mcp`,
        authorization: authValue,
        headers: { "x-eval-mcp": wantsApproval ? "remote-approval" : wantsBackground ? "remote-background-call" : wantsStream && wantsCall ? "remote-stream-call" : wantsCall ? "remote-call" : "remote-list" },
        require_approval: wantsApproval ? "always" : "never",
        allowed_tools: ["roll"],
      }],
    };
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    let streamEvents = [];
    let json = null;
    if (wantsStream) {
      streamEvents = parseSseEvents(body);
      json = streamEvents.findLast((event) => event.event === "response.completed")?.data?.response || null;
      if (!json) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: response.status,
          event_count: streamEvents.length,
          error: truncate(body),
        });
      }
    } else {
      json = JSON.parse(body);
    }
    const backgroundHistory = wantsBackground ? [json.status] : [];
    if (wantsBackground && json.status === "in_progress" && json.id) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(1000);
        const fetched = await getJson(`${baseUrl}/v1/responses/${json.id}`);
        if (!fetched.ok) {
          return finishResult(testCase, context, started, {
            ok: false,
            status: fetched.status,
            background_status_history: backgroundHistory,
            error: truncate(fetched.body),
          });
        }
        json = fetched.json;
        backgroundHistory.push(json.status);
        if (["completed", "failed", "cancelled", "incomplete"].includes(json.status)) break;
      }
    }
    const text = responseOutputText(json);
    const serialized = JSON.stringify(json);
    const mcpList = (json.output || []).find((item) => item.type === "mcp_list_tools");
    const mcpCall = (json.output || []).find((item) => item.type === "mcp_call");
    const localMcp = json.metadata?.compatibility?.local_mcp || {};
    const methods = records.map((record) => record.method);
    const initializeRecord = records.find((record) => record.method === "initialize") || {};
    const toolsListRecord = records.find((record) => record.method === "tools/list") || {};
    const toolsCallRecord = records.find((record) => record.method === "tools/call") || {};
    const mcpCallArguments = parseJsonish(mcpCall?.arguments);
    const expectedHeader = wantsApproval
      ? "remote-approval"
      : wantsBackground
      ? "remote-background-call"
      : wantsStream && wantsCall
      ? "remote-stream-call"
      : wantsCall
      ? "remote-call"
      : "remote-list";
    if (wantsApproval) {
      const approvalRequest = (json.output || []).find((item) => item.type === "mcp_approval_request");
      const firstOk = mcpList?.server_label === "remote_eval"
        && mcpList.tools?.length === 1
        && mcpList.tools?.[0]?.name === "roll"
        && approvalRequest?.server_label === "remote_eval"
        && approvalRequest?.name === "roll"
        && parseJsonish(approvalRequest?.arguments)?.expression === "2d4+1"
        && localMcp.provider === "local"
        && localMcp.remote_import_success_count === 1
        && localMcp.remote_approval_request_count === 1
        && localMcp.remote_call_attempt_count === 0
        && localMcp.boundary === "remote_list_tools_with_approval_request"
        && initializeRecord.headers?.authorization === `Bearer ${authValue}`
        && initializeRecord.headers?.["x-eval-mcp"] === "remote-approval"
        && toolsListRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp"
        && !serialized.includes(authValue)
        && !serialized.includes("hidden_tool");
      if (!firstOk) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: response.status,
          usage: responseUsage(json),
          output_text: text,
          remote_import_success_count: localMcp.remote_import_success_count || 0,
          remote_approval_request_count: localMcp.remote_approval_request_count || 0,
          mcp_methods: methods,
          error: truncate(serialized),
        });
      }

      const secondRequest = {
        ...request,
        instructions: approvalApprove
          ? wantsStream
            ? "The approved MCP roll output is now available in context. Stream exactly this text and nothing else: mcp-remote-stream-approval-ok."
            : "The approved MCP roll output is now available in context. Return exactly this text and nothing else: mcp-remote-approval-ok."
          : "The MCP roll tool approval was denied. Return exactly this text and nothing else: mcp-remote-denial-ok.",
        input: [{
          type: "mcp_approval_response",
          approve: approvalApprove,
          approval_request_id: approvalRequest.id,
        }],
        previous_response_id: json.id,
        store: false,
      };
      const secondResponse = await postJson(`${baseUrl}/v1/responses`, secondRequest);
      const secondBody = await secondResponse.text();
      if (!secondResponse.ok) {
        return finishResult(testCase, context, started, {
          ok: false,
          status: secondResponse.status,
          usage: responseUsage(json),
          output_text: text,
          mcp_methods: records.map((record) => record.method),
          error: truncate(secondBody),
        });
      }

      let secondEvents = [];
      let secondJson = null;
      if (wantsStream) {
        secondEvents = parseSseEvents(secondBody);
        secondJson = secondEvents.findLast((event) => event.event === "response.completed")?.data?.response || null;
        if (!secondJson) {
          return finishResult(testCase, context, started, {
            ok: false,
            status: secondResponse.status,
            usage: responseUsage(json),
            output_text: text,
            mcp_methods: records.map((record) => record.method),
            event_count: streamEvents.length + secondEvents.length,
            error: truncate(secondBody),
          });
        }
      } else {
        secondJson = JSON.parse(secondBody);
      }
      const secondText = responseOutputText(secondJson);
      const secondSerialized = JSON.stringify(secondJson);
      const secondMcpCall = (secondJson.output || []).find((item) => item.type === "mcp_call");
      const secondMcpCallArguments = parseJsonish(secondMcpCall?.arguments);
      const secondLocalMcp = secondJson.metadata?.compatibility?.local_mcp || {};
      const allMethods = records.map((record) => record.method);
      const callRecord = records.find((record) => record.method === "tools/call") || {};
      const secondOk = approvalApprove
        ? (wantsStream ? /mcp-remote-stream-approval-ok/i.test(secondText) : /mcp-remote-approval-ok/i.test(secondText))
        && secondMcpCall?.approval_request_id === approvalRequest.id
        && secondMcpCall?.server_label === "remote_eval"
        && secondMcpCall?.name === "roll"
        && secondMcpCall?.output === "7"
        && !secondMcpCall?.error
        && secondMcpCallArguments?.expression === "2d4+1"
        && secondLocalMcp.remote_approval_response_count === 1
        && secondLocalMcp.remote_approval_approved_count === 1
        && secondLocalMcp.remote_call_success_count === 1
        && secondLocalMcp.boundary === "remote_list_tools_and_call_execution"
        && callRecord.headers?.authorization === `Bearer ${authValue}`
        && callRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp"
        && callRecord.params?.name === "roll"
        && callRecord.params?.arguments?.expression === "2d4+1"
        && !secondSerialized.includes(authValue)
        && !secondSerialized.includes("hidden_tool")
        && (!wantsStream || (
          secondEvents.some((event) => event.event === "response.mcp_call_arguments.delta")
          && secondEvents.some((event) => event.event === "response.output_text.delta")
          && !secondEvents.some((event) => event.event === "response.function_call_arguments.delta" || event.data?.item?.type === "function_call")
        ))
        : /mcp-remote-denial-ok/i.test(secondText)
        && !secondMcpCall
        && secondLocalMcp.remote_approval_response_count === 1
        && secondLocalMcp.remote_approval_denied_count === 1
        && secondLocalMcp.remote_call_success_count === 0
        && secondLocalMcp.boundary === "remote_list_tools_with_approval_response"
        && !allMethods.includes("tools/call")
        && !secondSerialized.includes(authValue)
        && !secondSerialized.includes("hidden_tool");
      return finishResult(testCase, context, started, {
        ok: secondOk,
        status: secondResponse.status,
        usage: sumUsage([responseUsage(json), responseUsage(secondJson)]),
        output_text: secondText,
        remote_import_success_count: secondLocalMcp.remote_import_success_count || 0,
        imported_tool_count: secondLocalMcp.imported_tool_count || 0,
        remote_approval_request_count: localMcp.remote_approval_request_count || 0,
        remote_approval_approved_count: secondLocalMcp.remote_approval_approved_count || 0,
        remote_approval_denied_count: secondLocalMcp.remote_approval_denied_count || 0,
        remote_call_success_count: secondLocalMcp.remote_call_success_count || 0,
        mcp_methods: allMethods,
        mcp_auth_forwarded: callRecord.headers?.authorization === `Bearer ${authValue}`,
        session_forwarded: callRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp",
        event_count: streamEvents.length + secondEvents.length || undefined,
        error: secondOk ? undefined : truncate(secondSerialized),
      });
    }
    const commonOk = mcpList?.server_label === "remote_eval"
      && mcpList.tools?.length === 1
      && mcpList.tools?.[0]?.name === "roll"
      && mcpList.tools?.[0]?.description === "Roll dice remotely"
      && mcpList.tools?.[0]?.input_schema?.properties?.expression?.type === "string"
      && mcpList.tools?.[0]?.annotations?.readOnlyHint === true
      && localMcp.provider === "local"
      && localMcp.remote_server_count === 1
      && localMcp.remote_import_attempt_count === 1
      && localMcp.remote_import_success_count === 1
      && localMcp.remote_import_failed_count === 0
      && localMcp.imported_tool_count === 1
      && localMcp.authorization_redacted_count === 1
      && methods.includes("initialize")
      && methods.includes("notifications/initialized")
      && methods.includes("tools/list")
      && initializeRecord.headers?.authorization === `Bearer ${authValue}`
      && initializeRecord.headers?.["x-eval-mcp"] === expectedHeader
      && /application\/json/.test(String(initializeRecord.headers?.accept || ""))
      && /text\/event-stream/.test(String(initializeRecord.headers?.accept || ""))
      && toolsListRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp"
      && !serialized.includes(authValue)
      && !serialized.includes("hidden_tool");
    const ok = commonOk && (
      wantsCall
        ? (wantsBackground ? /mcp-remote-background-call-ok/i.test(text) : wantsStream ? /mcp-remote-stream-call-ok/i.test(text) : /mcp-remote-call-ok/i.test(text))
          && mcpCall?.server_label === "remote_eval"
          && mcpCall?.name === "roll"
          && mcpCall?.output === "7"
          && !mcpCall?.error
          && mcpCallArguments?.expression === "2d4+1"
          && methods.includes("tools/call")
          && toolsCallRecord.headers?.authorization === `Bearer ${authValue}`
          && toolsCallRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp"
          && toolsCallRecord.params?.name === "roll"
          && toolsCallRecord.params?.arguments?.expression === "2d4+1"
          && localMcp.remote_call_tool_count === 1
          && localMcp.remote_call_attempt_count === 1
          && localMcp.remote_call_success_count === 1
          && localMcp.remote_call_failed_count === 0
          && localMcp.boundary === "remote_list_tools_and_call_execution"
          && json.metadata?.compatibility?.local_tool_budget?.used === 2
          && json.metadata?.compatibility?.local_tool_budget?.exhausted === true
          && (!wantsStream || (
            streamEvents.length > 0
            && streamEvents.some((event) => event.event === "response.mcp_call_arguments.delta")
            && streamEvents.some((event) => event.event === "response.output_text.delta")
            && !streamEvents.some((event) => event.event === "response.function_call_arguments.delta" || event.data?.item?.type === "function_call")
          ))
        : /mcp-remote-ok/i.test(text)
          && localMcp.boundary === "remote_list_tools_without_call_execution"
          && json.metadata?.compatibility?.local_tool_budget?.used === 1
    );
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      usage: responseUsage(json),
      output_text: text,
      background_status_history: backgroundHistory.length ? backgroundHistory : undefined,
      remote_import_success_count: localMcp.remote_import_success_count || 0,
      imported_tool_count: localMcp.imported_tool_count || 0,
      remote_call_success_count: localMcp.remote_call_success_count || 0,
      mcp_methods: methods,
      mcp_auth_forwarded: initializeRecord.headers?.authorization === `Bearer ${authValue}`,
      session_forwarded: toolsListRecord.headers?.["mcp-session-id"] === "sess_eval_remote_mcp",
      event_count: streamEvents.length || undefined,
      error: ok ? undefined : truncate(serialized),
    });
  } finally {
    await closeServer(mcpServer);
  }
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
  let previousJson = null;
  for (const [index, step] of testCase.steps.entries()) {
    const response = await postJson(`${baseUrl}/v1/responses`, resolveRequest(step.request, { previousResponseId, previousJson, stepResults }));
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
    const ok = !!step.check({ json, text, ok: response.ok, previousJson, stepResults });
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
    previousJson = json;
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

async function postJsonCapture(url, body) {
  const response = await postJson(url, body);
  const responseBody = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    json: parseJsonish(responseBody),
    body: responseBody,
  };
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

async function postSdpCapture(url, body) {
  const response = await postRaw(url, body, "application/sdp");
  const responseBody = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: responseBody,
    headers: Object.fromEntries(response.headers.entries()),
  };
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

async function getBinaryMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      ok: response.ok,
      content_type: response.headers.get("content-type") || "",
      bytes: body.length,
    };
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

function audioOutputText(response) {
  return response?.text || `${response?.task || "audio"}:${response?.segments?.length || 0}`;
}

function imagesGenerationOutputText(response) {
  return `images:${response?.data?.length || 0}`;
}

function assistantMessageTextFromList(messages = []) {
  return messages
    .filter((message) => message?.role === "assistant")
    .map((message) => (message.content || [])
      .map(assistantMessagePartText)
      .join(""))
    .filter(Boolean)
    .join("\n");
}

function assistantMessagePartText(part) {
  const value = part?.text?.value ?? part?.text ?? part?.content ?? "";
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function audioUsage(response) {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    audio_seconds: response?.usage?.seconds || 0,
  };
}

function imagesGenerationUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function videoUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function assistantsUsage(run) {
  return {
    input_tokens: run?.usage?.prompt_tokens || 0,
    output_tokens: run?.usage?.completion_tokens || 0,
    total_tokens: run?.usage?.total_tokens || 0,
  };
}

function batchResponseUsage(testCase, response) {
  if (testCase.usage === "embeddings") return embeddingUsage(response);
  if (testCase.usage === "responses") return responseUsage(response);
  if (testCase.usage === "chat") return chatUsage(response);
  if (testCase.usage === "completions") return completionUsage(response);
  if (testCase.usage === "audio") return audioUsage(response);
  if (testCase.usage === "images") return imagesGenerationUsage(response);
  if (testCase.usage === "videos") return videoUsage(response);
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
