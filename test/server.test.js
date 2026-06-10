"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createServer, loadConfig } = require("../src/bridge/server");
const { FileResponseStore } = require("../src/bridge/store");
const { unzipFiles } = require("../src/bridge/local_skills");
const { prepareWebSearchContext } = require("../src/bridge/web_search");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateVectorStoreTimestampsForTest(stateDir, storeId, { lastActiveAt, expiresAt }) {
  const storePath = path.join(stateDir, "local-file-search", "vector_stores", storeId, "store.json");
  const record = JSON.parse(fs.readFileSync(storePath, "utf8"));
  record.vector_store.last_active_at = lastActiveAt;
  record.vector_store.expires_at = expiresAt;
  fs.writeFileSync(storePath, `${JSON.stringify(record, null, 2)}\n`);
  return { last_active_at: lastActiveAt, expires_at: expiresAt };
}

function ageVectorStoreForTest(stateDir, storeId) {
  const now = Math.floor(Date.now() / 1000);
  return updateVectorStoreTimestampsForTest(stateDir, storeId, {
    lastActiveAt: now - 2 * 86400,
    expiresAt: now + 86400,
  });
}

function expireVectorStoreForTest(stateDir, storeId) {
  const now = Math.floor(Date.now() / 1000);
  return updateVectorStoreTimestampsForTest(stateDir, storeId, {
    lastActiveAt: now - 3 * 86400,
    expiresAt: now - 2 * 86400,
  });
}

async function withMockProvider(handler, run, configOverrides = {}) {
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ req, body: body ? JSON.parse(body) : null });
    await handler(req, res, requests.at(-1));
  });
  const providerAddress = await listen(provider);

  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-codex-bridge-"));
  const config = loadConfig({
    providerBaseUrl: `http://127.0.0.1:${providerAddress.port}`,
    providerApiKey: "test-key",
    defaultModel: "mock-model",
    stateDir,
    ...configOverrides,
  });
  const bridge = createServer(config);
  const bridgeAddress = await listen(bridge);

  try {
    await run({ bridgeAddress, providerAddress, requests, stateDir });
  } finally {
    await close(bridge);
    await close(provider);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

function parseSseEvents(text) {
  return text
    .split(/\n\n/)
    .filter((frame) => frame.trim())
    .map((frame) => {
      const lines = frame.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return { event, data: data === "[DONE]" ? data : data ? JSON.parse(data) : null };
    });
}

function tinyPdfBuffer(text) {
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
  return Buffer.from(pdf, "ascii");
}

function tinyZipBuffer(entries, options = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const method = options.deflate ? 8 : 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, end]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = (value >>> 8) ^ crcTable()[(value ^ byte) & 0xff];
  }
  return (value ^ 0xffffffff) >>> 0;
}

let cachedCrcTable = null;
function crcTable() {
  if (cachedCrcTable) return cachedCrcTable;
  cachedCrcTable = Array.from({ length: 256 }, (_unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  return cachedCrcTable;
}

function tinyDocxBuffer(text) {
  return tinyZipBuffer({
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:body>
</w:document>`,
  }, { deflate: true });
}

function tinyXlsxBuffer(rows) {
  const shared = rows.flat().map((value) => `<si><t>${xmlEscape(value)}</t></si>`).join("");
  let index = 0;
  const rowXml = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${
    row.map((_value, columnIndex) => `<c r="${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}" t="s"><v>${index++}</v></c>`).join("")
  }</row>`).join("");
  return tinyZipBuffer({
    "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`,
  });
}

function tinyPptxBuffer(text) {
  return tinyZipBuffer({
    "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
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

test("POST /v1/responses maps to /v1/chat/completions and stores previous response replay", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_mock",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "hello from chat" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        instructions: "short",
        input: "say hi",
        stop: ["<END>"],
        store: true,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "hello from chat");
    assert.equal(requests[0].req.url, "/chat/completions");
    assert.deepEqual(requests[0].body.stop, ["<END>"]);
    assert.deepEqual(requests[0].body.messages.slice(0, 2), [
      { role: "system", content: "short" },
      { role: "user", content: "say hi" },
    ]);

    await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        previous_response_id: json.id,
        input: "continue",
      }),
    });
    assert.equal(requests[1].body.messages.at(-2).content, "hello from chat");
    assert.equal(requests[1].body.messages.at(-1).content, "continue");
  });
});

test("POST /v1/responses forwards service_tier and preserves provider tier", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.service_tier, "priority");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_tier",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      service_tier: "flex",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "tier ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Check tier.",
        service_tier: "priority",
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.service_tier, "flex");
  });
});

test("POST /v1/responses maps Chat max_completion_tokens alias", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.max_tokens, 7);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_max_completion_alias",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "token alias ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Check max token alias.",
        max_completion_tokens: 7,
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "token alias ok");
    assert.deepEqual(json.metadata.compatibility.max_completion_tokens, {
      source: "max_completion_tokens",
      target: "max_tokens",
      value: 7,
      forwarded: true,
      reason: "chat_alias",
    });
  });
});

test("POST /v1/responses maps Chat-native aliases and request fields", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.max_tokens, 6);
    assert.deepEqual(call.body.logit_bias, { "7": -2 });
    assert.equal(call.body.n, 2);
    assert.deepEqual(call.body.prediction, { type: "content", content: "cached draft" });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_chat_native",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "chat native ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Check Chat-native fields.",
        max_tokens: 6,
        logit_bias: { "7": -2 },
        n: 2,
        prediction: { type: "content", content: "cached draft" },
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "chat native ok");
    assert.deepEqual(json.metadata.compatibility.max_tokens, {
      source: "max_tokens",
      target: "max_tokens",
      value: 6,
      forwarded: true,
      reason: "chat_alias",
    });
    assert.equal(json.metadata.compatibility.chat_native_fields.reason, "chat_native_passthrough");
    assert.deepEqual(json.metadata.compatibility.chat_native_fields.forwarded.sort(), [
      "logit_bias",
      "n",
      "prediction",
    ].sort());
  });
});

test("POST /v1/responses filters Chat-native request fields when configured", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.logit_bias, undefined);
    assert.equal(call.body.n, undefined);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_chat_native_filtered",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "filtered ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Filter Chat-native fields.",
        logit_bias: { "8": -4 },
        n: 3,
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "filtered ok");
    assert.equal(json.metadata.compatibility.chat_native_fields.reason, "provider_unsupported");
    assert.deepEqual(json.metadata.compatibility.chat_native_fields.filtered.sort(), [
      "logit_bias",
      "n",
    ].sort());
  }, { forwardChatNativeFields: false });
});

test("POST /v1/responses filters stream_options for non-streaming requests", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.stream, false);
    assert.equal(call.body.stream_options, undefined);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_non_stream_options",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "non-stream ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Check non-stream options.",
        stream_options: { include_usage: true },
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "non-stream ok");
    assert.equal(json.metadata.compatibility.stream_options.reason, "stream_required");
  });
});

test("POST /v1/responses maps output logprobs include to Chat and back", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.logprobs, true);
    assert.equal(call.body.top_logprobs, 2);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_logprobs",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "yes" },
        logprobs: {
          content: [{
            token: "yes",
            logprob: -0.02,
            bytes: [121, 101, 115],
            top_logprobs: [
              { token: "yes", logprob: -0.02, bytes: [121, 101, 115] },
              { token: "no", logprob: -4.5, bytes: [110, 111] },
            ],
          }],
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Answer yes.",
        include: ["message.output_text.logprobs"],
        top_logprobs: 2,
        store: false,
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    const part = json.output[0].content[0];
    assert.equal(part.text, "yes");
    assert.equal(part.logprobs[0].token, "yes");
    assert.equal(part.logprobs[0].top_logprobs[1].token, "no");
    assert.equal(json.top_logprobs, 2);
    assert.equal(json.metadata.compatibility.logprobs, "chat_logprobs");
  });
});

test("POST /v1/responses preserves non-streaming refusal logprobs metadata", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.logprobs, true);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_refusal_logprobs",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: null, refusal: "I cannot comply." },
        logprobs: {
          content: null,
          refusal: [{
            token: "I cannot",
            logprob: -0.04,
            bytes: [73],
            top_logprobs: [{ token: "I cannot", logprob: -0.04, bytes: [73] }],
          }],
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Refuse.",
        include: ["message.output_text.logprobs"],
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.deepEqual(json.output[0].content, [{ type: "refusal", refusal: "I cannot comply." }]);
    assert.equal(json.metadata.compatibility.logprobs, "chat_logprobs");
    assert.equal(json.metadata.compatibility.chat_refusal_logprobs[0].logprobs[0].token, "I cannot");
  });
});

test("POST /v1/responses replays legacy Chat function_call outputs with stable call ids", async () => {
  await withMockProvider(async (_req, res, _call) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (_call.body.messages.some((message) => message.role === "tool")) {
      res.end(JSON.stringify({
        id: "chatcmpl_legacy_followup",
        object: "chat.completion",
        created: 101,
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "legacy-tool-ok" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }));
      return;
    }

    res.end(JSON.stringify({
      id: "chatcmpl_legacy",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          function_call: { name: "legacy_lookup", arguments: "{\"query\":\"bridge\"}" },
        },
        finish_reason: "function_call",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const firstResponse = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Call the legacy lookup.",
        tools: [{
          type: "function",
          name: "legacy_lookup",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        }],
        store: true,
      }),
    });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    const call = first.output.find((item) => item.type === "function_call");
    assert.equal(call.call_id, "call_chatcmpl_legacy_0");
    assert.equal(call.name, "legacy_lookup");

    const followResponse = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        previous_response_id: first.id,
        input: [{
          type: "function_call_output",
          call_id: call.call_id,
          output: "{\"result\":\"ok\"}",
        }],
        store: false,
      }),
    });
    assert.equal(followResponse.status, 200);
    const follow = await followResponse.json();
    assert.equal(follow.output[0].content[0].text, "legacy-tool-ok");

    const replay = requests[1].body.messages;
    const assistantReplay = replay.find((message) => message.role === "assistant" && message.tool_calls);
    const toolReplay = replay.find((message) => message.role === "tool");
    assert.equal(assistantReplay.tool_calls[0].id, call.call_id);
    assert.equal(assistantReplay.tool_calls[0].function.name, "legacy_lookup");
    assert.equal(toolReplay.tool_call_id, call.call_id);
  });
});

test("POST /v1/responses executes local web_search_preview compatibility", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.tools, undefined);
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses web_search compatibility results/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /Bridge Search Result/.test(message.content || "")));
    assert.ok(!call.body.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_web_search",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "bridge-web-ok [1]" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Search for bridge web result and return bridge-web-ok [1].",
        tools: [{ type: "web_search_preview" }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].type, "web_search_call");
    assert.equal(json.output[0].status, "completed");
    assert.equal(json.output[0].action.type, "search");
    assert.match(json.output[0].action.query, /bridge web result/);
    assert.equal(json.output[1].type, "message");
    assert.equal(json.output[1].content[0].text, "bridge-web-ok [1]");
    assert.deepEqual(json.output[1].content[0].annotations, [{
      type: "url_citation",
      start_index: 14,
      end_index: 17,
      url: "https://example.test/bridge-search",
      title: "Bridge Search Result",
    }]);
    assert.equal(json.metadata.compatibility.local_web_search.provider, "static");
    assert.equal(json.metadata.compatibility.local_web_search.result_count, 1);
    assert.equal(json.metadata.compatibility.local_web_search.deepseek_thinking, "disabled_for_local_web_search");
  }, {
    webSearchProvider: "static",
    webSearchStaticResults: [{
      title: "Bridge Search Result",
      url: "https://example.test/bridge-search",
      snippet: "The bridge web search adapter found this result.",
    }],
  });
});

test("local web_search falls back to Wikipedia REST when the MediaWiki API is rejected", async () => {
  const seen = [];
  const context = await prepareWebSearchContext({
    input: "Use web search for OpenAI.",
    tools: [{ type: "web_search_preview" }],
  }, {
    webSearchProvider: "wikipedia",
    webSearchMaxResults: 1,
    webSearchTimeoutMs: 1000,
  }, {
    fetch: async (url, options) => {
      seen.push({ url: String(url), userAgent: options.headers["user-agent"] });
      if (String(url).includes("/w/api.php")) {
        return { ok: false, status: 403, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          pages: [{
            key: "OpenAI",
            title: "OpenAI",
            excerpt: "<span>OpenAI</span> is an AI research organization.",
          }],
        }),
      };
    },
  });

  assert.equal(context.calls[0].status, "completed");
  assert.equal(context.results.length, 1);
  assert.equal(context.results[0].title, "OpenAI");
  assert.equal(context.results[0].url, "https://en.wikipedia.org/wiki/OpenAI");
  assert.ok(seen[0].userAgent.includes("opencodexapp.aialra.online"));
  assert.ok(seen.some((item) => item.url.includes("/w/rest.php/v1/search/page")));
});

test("local web_search can open result pages and inject extracted page text", async () => {
  const context = await prepareWebSearchContext({
    input: "Use web search for local page text.",
    tools: [{ type: "web_search_preview" }],
  }, {
    webSearchProvider: "static",
    webSearchStaticResults: [{
      title: "Open Page Fixture",
      url: "https://example.test/open-page",
      snippet: "Snippet before opening.",
    }],
    webSearchOpenPages: 1,
    webSearchFindInPage: false,
    webSearchPageMaxTextChars: 2000,
  }, {
    fetch: async (url, options) => {
      assert.equal(String(url), "https://example.test/open-page");
      assert.equal(options.headers.accept.includes("text/html"), true);
      return new Response("<html><head><style>.x{}</style><script>bad()</script></head><body><main><h1>Opened fixture</h1><p>Page body says open-page-ok.</p></main></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  assert.equal(context.calls.length, 2);
  assert.equal(context.calls[0].action.type, "search");
  assert.equal(context.calls[1].action.type, "open_page");
  assert.equal(context.calls[1].status, "completed");
  assert.equal(context.results[0].opened.status, "completed");
  assert.match(context.results[0].opened.text, /Opened fixture/);
  assert.match(context.results[0].opened.text, /open-page-ok/);
  assert.doesNotMatch(context.results[0].opened.text, /bad\(\)/);
});

test("local web_search can find matches inside opened pages", async () => {
  const context = await prepareWebSearchContext({
    input: "Use web search for open-page-ok.",
    tools: [{ type: "web_search_preview" }],
  }, {
    webSearchProvider: "static",
    webSearchStaticResults: [{
      title: "Find Page Fixture",
      url: "https://example.test/find-page",
      snippet: "Snippet before opening.",
    }],
    webSearchOpenPages: 1,
    webSearchFindInPage: true,
    webSearchFindInPageMaxMatches: 2,
    webSearchFindInPageContextChars: 32,
  }, {
    fetch: async () => new Response("<main><p>Before text. The marker open-page-ok appears here. After text.</p></main>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  });

  assert.equal(context.calls.length, 3);
  assert.equal(context.calls[0].action.type, "search");
  assert.equal(context.calls[1].action.type, "open_page");
  assert.equal(context.calls[2].action.type, "find_in_page");
  assert.equal(context.calls[2].status, "completed");
  assert.equal(context.calls[2].action.url, "https://example.test/find-page");
  assert.match(context.calls[2].action.query, /open-page-ok/);
  assert.equal(context.results[0].find_in_page.status, "completed");
  assert.equal(context.results[0].find_in_page.match_count, 1);
  assert.match(context.results[0].find_in_page.matches[0].text, /open-page-ok/);
});

test("POST /v1/responses emits local web_search open_page calls", async () => {
  const pageServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><main><h1>Bridge opened page</h1><p>Opened page body says open-page-ok.</p></main>");
  });
  const pageAddress = await listen(pageServer);
  try {
    await withMockProvider(async (_req, res, call) => {
      const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
      assert.match(prompt, /Bridge Open Page Result/);
      assert.match(prompt, /Opened page text:/);
      assert.match(prompt, /Opened page body says open-page-ok/);
      assert.match(prompt, /Find in page matches/);
      assert.match(prompt, /open-page-ok/);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl_web_search_open",
        object: "chat.completion",
        created: 100,
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "open-page-ok [1]" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
      }));
    }, async ({ bridgeAddress }) => {
      const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          input: "Search for bridge open page result and return open-page-ok [1].",
          tools: [{ type: "web_search_preview" }],
          store: false,
        }),
      });
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.output[0].type, "web_search_call");
      assert.equal(json.output[0].action.type, "search");
      assert.equal(json.output[1].type, "web_search_call");
      assert.equal(json.output[1].action.type, "open_page");
      assert.equal(json.output[1].action.url, `http://127.0.0.1:${pageAddress.port}/open-page`);
      assert.equal(json.output[1].status, "completed");
      assert.equal(json.output[2].type, "web_search_call");
      assert.equal(json.output[2].action.type, "find_in_page");
      assert.equal(json.output[2].action.url, `http://127.0.0.1:${pageAddress.port}/open-page`);
      assert.equal(json.output[2].status, "completed");
      assert.equal(json.output[3].type, "message");
      assert.equal(json.metadata.compatibility.local_web_search.opened_count, 1);
      assert.equal(json.metadata.compatibility.local_web_search.open_failed_count, 0);
      assert.equal(json.metadata.compatibility.local_web_search.find_in_page_count, 1);
      assert.equal(json.metadata.compatibility.local_web_search.find_in_page_match_count, 1);
      assert.equal(json.metadata.compatibility.local_web_search.find_in_page_failed_count, 0);
    }, {
      webSearchProvider: "static",
      webSearchOpenPages: 1,
      webSearchStaticResults: [{
        title: "Bridge Open Page Result",
        url: `http://127.0.0.1:${pageAddress.port}/open-page`,
        snippet: "The bridge can open this page.",
      }],
    });
  } finally {
    await close(pageServer);
  }
});

test("POST /v1/responses streams Chat chunks as typed Responses events", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.logprobs, true);
    assert.equal(call.body.top_logprobs, 2);
    assert.equal(call.body.service_tier, "priority");
    assert.deepEqual(call.body.stream_options, { include_usage: true });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream",
      object: "chat.completion.chunk",
      created: 1694268190,
      model: "mock-stream-model",
      service_tier: "flex",
      system_fingerprint: "fp_stream",
      choices: [{
        index: 0,
        delta: { role: "assistant", content: "hel" },
        logprobs: { content: [{ token: "hel", logprob: -0.1, bytes: [104, 101, 108], top_logprobs: [] }] },
        finish_reason: null,
      }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: {
          content: "lo",
          annotations: [{
            type: "url_citation",
            start_index: 0,
            end_index: 5,
            url: "https://example.test/stream",
            title: "Stream Citation",
          }],
        },
        logprobs: { content: [{ token: "lo", logprob: -0.2, bytes: [108, 111], top_logprobs: [] }] },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 1,
        prompt_tokens_details: { cached_tokens: 1, audio_tokens: 0 },
        completion_tokens: 1,
        completion_tokens_details: {
          reasoning_tokens: 0,
          accepted_prediction_tokens: 1,
          rejected_prediction_tokens: 0,
        },
        total_tokens: 2,
      },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "stream",
        stream: true,
        include: ["message.output_text.logprobs"],
        top_logprobs: 2,
        service_tier: "priority",
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: response\.created/);
    assert.match(text, /event: response\.output_text\.delta/);
    assert.match(text, /"delta":"hel"/);
    assert.match(text, /event: response\.completed/);
    assert.match(text, /"text":"hello"/);
    assert.match(text, /"logprobs":\[\{"token":"hel","logprob":-0\.1/);
    assert.match(text, /\{"token":"lo","logprob":-0\.2/);
    const events = parseSseEvents(text);
    const completed = events.find((event) => event.event === "response.completed").data.response;
    assert.equal(completed.service_tier, "flex");
    assert.deepEqual(completed.output[0].content[0].annotations, [{
      type: "url_citation",
      start_index: 0,
      end_index: 5,
      url: "https://example.test/stream",
      title: "Stream Citation",
    }]);
    assert.equal(completed.metadata.compatibility.chat_completion_id, "chatcmpl_stream");
    assert.equal(completed.metadata.compatibility.chat_object, "chat.completion.chunk");
    assert.equal(completed.metadata.compatibility.chat_created, 1694268190);
    assert.equal(completed.metadata.compatibility.chat_model, "mock-stream-model");
    assert.equal(completed.metadata.compatibility.chat_system_fingerprint, "fp_stream");
    assert.deepEqual(completed.metadata.compatibility.chat_choices, [
      { choice_index: 0, finish_reason: "stop" },
    ]);
    assert.equal(completed.metadata.compatibility.chat_usage.prompt_tokens_details.cached_tokens, 1);
    assert.equal(completed.metadata.compatibility.chat_usage.completion_tokens_details.accepted_prediction_tokens, 1);
    assert.equal(completed.metadata.compatibility.stream_options.reason, "enabled_by_bridge");
  });
});

test("POST /v1/responses preserves multiple streaming Chat choices", async () => {
  let callCount = 0;
  await withMockProvider(async (_req, res, call) => {
    callCount += 1;
    if (callCount === 1) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl_stream_multi",
        object: "chat.completion.chunk",
        choices: [
          { index: 0, delta: { role: "assistant", content: "al" }, finish_reason: null },
          { index: 1, delta: { role: "assistant", content: "be" }, finish_reason: null },
        ],
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl_stream_multi",
        object: "chat.completion.chunk",
        choices: [
          { index: 1, delta: { content: "ta" }, finish_reason: "stop" },
          { index: 0, delta: { content: "pha" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const assistantMessages = call.body.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.content);
    assert.deepEqual(assistantMessages, ["alpha", "beta"]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_after_stream_multi",
      object: "chat.completion",
      created: 456,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "continued" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "stream multi",
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    const completed = events.find((event) => event.event === "response.completed").data.response;
    const messages = completed.output.filter((item) => item.type === "message");
    assert.deepEqual(messages.map((message) => message.content[0].text), ["alpha", "beta"]);

    const addedMessages = events
      .filter((event) => event.event === "response.output_item.added")
      .map((event) => event.data.item)
      .filter((item) => item.type === "message");
    assert.equal(addedMessages.length, 2);

    const followUp = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        previous_response_id: completed.id,
        input: "continue",
      }),
    });
    assert.equal(followUp.status, 200);
    const json = await followUp.json();
    assert.equal(json.output[0].content[0].text, "continued");
  });
});

test("POST /v1/responses streams Chat refusal deltas and replays refusal history", async () => {
  let callCount = 0;
  await withMockProvider(async (_req, res, call) => {
    callCount += 1;
    if (callCount === 1) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl_stream_refusal",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: { role: "assistant", refusal: "I can" },
          logprobs: { refusal: [{ token: "I can", logprob: -0.1, bytes: [73], top_logprobs: [] }] },
          finish_reason: null,
        }],
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl_stream_refusal",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: { refusal: "not" },
          logprobs: { refusal: [{ token: "not", logprob: -0.2, bytes: [110], top_logprobs: [] }] },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const assistantMessages = call.body.messages
      .filter((message) => message.role === "assistant")
      .map((message) => ({ content: message.content, refusal: message.refusal }));
    assert.deepEqual(assistantMessages, [{ content: null, refusal: "I cannot" }]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_after_stream_refusal",
      object: "chat.completion",
      created: 457,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "after-refusal" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "stream refusal",
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    assert.equal(events.filter((event) => event.event === "response.refusal.delta").length, 2);
    const refusalDone = events.find((event) => event.event === "response.refusal.done").data;
    assert.equal(refusalDone.refusal, "I cannot");
    assert.ok(!events.some((event) => event.event === "response.output_text.done"));

    const completed = events.find((event) => event.event === "response.completed").data.response;
    assert.deepEqual(completed.output[0].content, [{ type: "refusal", refusal: "I cannot" }]);
    assert.equal(completed.metadata.compatibility.chat_refusal_logprobs[0].logprobs[1].token, "not");

    const followUp = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        previous_response_id: completed.id,
        input: "continue",
      }),
    });
    assert.equal(followUp.status, 200);
    const json = await followUp.json();
    assert.equal(json.output[0].content[0].text, "after-refusal");
  });
});

test("POST /v1/responses streams incomplete terminal events from Chat finish reasons", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream_length",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { role: "assistant", content: "partial" },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "stream length",
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: response\.incomplete/);
    assert.doesNotMatch(text, /event: response\.completed/);
    assert.match(text, /"status":"incomplete"/);
    assert.match(text, /"completed_at":null/);
    assert.match(text, /"incomplete_details":\{"reason":"max_output_tokens"\}/);
  });
});

test("POST /v1/responses streams failed terminal events from Chat finish reasons", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream_resource",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { role: "assistant", content: "partial" },
        finish_reason: "insufficient_system_resource",
      }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "stream resource",
        stream: true,
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: response\.failed/);
    assert.doesNotMatch(text, /event: response\.completed/);
    assert.match(text, /"status":"failed"/);
    assert.match(text, /"code":"server_error"/);
    assert.match(text, /insufficient_system_resource/);
  });
});

test("POST /v1/responses streams local web_search_preview call and citations", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Streaming Search Result/.test(message.content || "")));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream_web",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "stream-web-ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Search for streaming result and answer.",
        tools: [{ type: "web_search_preview" }],
        stream: true,
        store: false,
      }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: response\.output_item\.added/);
    assert.match(text, /"type":"web_search_call"/);
    assert.match(text, /event: response\.output_text\.done/);
    assert.match(text, /stream-web-ok\\n\\nSources:/);
    assert.match(text, /"type":"url_citation"/);
    assert.match(text, /"url":"https:\/\/example\.test\/stream-search"/);
  }, {
    webSearchProvider: "static",
    webSearchStaticResults: [{
      title: "Streaming Search Result",
      url: "https://example.test/stream-search",
      snippet: "The streaming adapter can cite this result.",
    }],
  });
});

test("POST /v1/responses limits local web_search actions with max_tool_calls", async () => {
  await withMockProvider(async (_req, res, call) => {
    const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
    assert.match(prompt, /Budget Search Result/);
    assert.match(prompt, /Open page skipped: max_tool_calls_exhausted/);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_web_budget",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "budget-web-ok [1]" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Use web search for budget result and return budget-web-ok [1].",
        tools: [{ type: "web_search_preview" }],
        max_tool_calls: 1,
        store: false,
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    const webCalls = json.output.filter((item) => item.type === "web_search_call");
    assert.equal(webCalls.length, 1);
    assert.equal(webCalls[0].action.type, "search");
    assert.equal(json.metadata.compatibility.local_web_search.open_skipped_count, 1);
    assert.equal(json.metadata.compatibility.local_web_search.skipped_count, 1);
    assert.deepEqual(json.metadata.compatibility.local_tool_budget, {
      max_tool_calls: 1,
      used: 1,
      skipped: 1,
      exhausted: true,
      skipped_calls: [{
        type: "web_search_call",
        tool_type: "web_search_preview",
        action: "open_page",
        url: "https://example.test/budget-search",
        reason: "max_tool_calls_exhausted",
      }],
    });
    assert.equal(json.output.at(-1).content[0].text, "budget-web-ok [1]");
  }, {
    webSearchProvider: "static",
    webSearchOpenPages: 1,
    webSearchStaticResults: [{
      title: "Budget Search Result",
      url: "https://example.test/budget-search",
      snippet: "The web budget fixture can be cited without opening.",
    }],
  });
});

test("POST /v1/responses shares max_tool_calls across local shell and web_search", async () => {
  await withMockProvider(async (_req, res, call) => {
    const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
    assert.match(prompt, /STDOUT:\nbudget-shell-ok/);
    assert.match(prompt, /max_tool_calls exhausted before local web search could run/);
    assert.doesNotMatch(prompt, /This result should not be searched when shell consumes the budget/);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_shared_budget",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "budget-shell-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Execute: printf budget-shell-ok\nUse web search for Shell Budget Web Result.",
        tools: [{ type: "shell" }, { type: "web_search_preview" }],
        max_tool_calls: 1,
        store: false,
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output.filter((item) => item.type === "shell_call").length, 1);
    assert.equal(json.output.filter((item) => item.type === "web_search_call").length, 0);
    assert.equal(json.metadata.compatibility.local_shell.command_count, 1);
    assert.equal(json.metadata.compatibility.local_web_search.status, "skipped");
    assert.deepEqual(json.metadata.compatibility.local_tool_budget, {
      max_tool_calls: 1,
      used: 1,
      skipped: 1,
      exhausted: true,
      skipped_calls: [{
        type: "web_search_call",
        tool_type: "web_search_preview",
        action: "search",
        query: "Shell Budget Web Result",
        reason: "max_tool_calls_exhausted",
      }],
    });
  }, {
    webSearchProvider: "static",
    webSearchStaticResults: [{
      title: "Shell Budget Web Result",
      url: "https://example.test/shell-budget",
      snippet: "This result should not be searched when shell consumes the budget.",
    }],
  });
});

test("POST /v1/responses rejects invalid max_tool_calls", async () => {
  await withMockProvider(async () => {
    assert.fail("provider should not be called for invalid max_tool_calls");
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "invalid max tool calls",
        tools: [{ type: "web_search_preview" }],
        max_tool_calls: -1,
      }),
    });

    assert.equal(response.status, 400);
    const json = await response.json();
    assert.equal(json.error.code, "invalid_max_tool_calls");
    assert.equal(json.error.param, "max_tool_calls");
  });
});

test("local Files and Vector Stores back Responses file_search compatibility", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.tools, undefined);
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses file_search compatibility results/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /File Search Fixture/.test(message.content || "")));
    assert.ok(!call.body.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_file_search",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "file-search-ok [1]" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const createdFile = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "fixture.txt",
        purpose: "assistants",
        content: "File Search Fixture says the exact marker is file-search-ok. A second marker is secondary-ok. A car maintenance note says technicians service sedans.",
      }),
    });
    assert.equal(createdFile.status, 200);
    const file = await createdFile.json();
    assert.equal(file.object, "file");
    assert.equal(file.filename, "fixture.txt");

    const content = await fetch(`${baseUrl}/v1/files/${file.id}/content`);
    assert.equal(content.status, 200);
    assert.match(await content.text(), /file-search-ok/);

    const createdStore = await fetch(`${baseUrl}/v1/vector_stores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "fixture-store" }),
    });
    assert.equal(createdStore.status, 200);
    const vectorStore = await createdStore.json();
    assert.equal(vectorStore.object, "vector_store");

    const attached = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_id: file.id,
        attributes: {
          suite: "server-test",
          region: "emea",
          year: 2026,
          archived: false,
          type: "fixture",
        },
      }),
    });
    assert.equal(attached.status, 200);
    const vectorFile = await attached.json();
    assert.equal(vectorFile.object, "vector_store.file");
    assert.equal(vectorFile.status, "completed");

    const search = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        max_num_results: 3,
        filters: { type: "eq", key: "suite", value: "server-test" },
      }),
    });
    assert.equal(search.status, 200);
    const searchJson = await search.json();
    assert.equal(searchJson.object, "vector_store.search_results.page");
    assert.deepEqual(searchJson.ranking_options, { ranker: "auto", score_threshold: 0 });
    assert.deepEqual(searchJson.search_queries, ["file-search-ok"]);
    assert.equal(searchJson.data[0].file_id, file.id);
    assert.ok(searchJson.data[0].score <= 1);

    const multiQuerySearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: ["file-search-ok", "secondary-ok"],
        max_num_results: 3,
        filters: { type: "eq", key: "suite", value: "server-test" },
      }),
    });
    assert.equal(multiQuerySearch.status, 200);
    const multiQueryJson = await multiQuerySearch.json();
    assert.deepEqual(multiQueryJson.search_queries, ["file-search-ok", "secondary-ok"]);
    assert.equal(multiQueryJson.data[0].file_id, file.id);
    assert.deepEqual(multiQueryJson.data[0].matched_queries, ["file-search-ok", "secondary-ok"]);

    const compoundFilterSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        max_num_results: 50,
        attribute_filter: {
          type: "and",
          filters: [
            { type: "eq", key: "suite", value: "server-test" },
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
      }),
    });
    assert.equal(compoundFilterSearch.status, 200);
    const compoundFilterJson = await compoundFilterSearch.json();
    assert.equal(compoundFilterJson.data[0].file_id, file.id);
    assert.equal(compoundFilterJson.filters.type, "and");

    const plainFilterSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        filters: { suite: "server-test", archived: false, type: "fixture" },
      }),
    });
    assert.equal(plainFilterSearch.status, 200);
    assert.equal((await plainFilterSearch.json()).data[0].file_id, file.id);

    const excludedFilterSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        filters: {
          type: "and",
          filters: [
            { type: "eq", key: "suite", value: "server-test" },
            { type: "lt", key: "year", value: 2020 },
          ],
        },
      }),
    });
    assert.equal(excludedFilterSearch.status, 200);
    assert.deepEqual((await excludedFilterSearch.json()).data, []);

    const invalidFilterSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        filters: { type: "and", filters: [] },
      }),
    });
    assert.equal(invalidFilterSearch.status, 400);
    assert.match(await invalidFilterSearch.text(), /invalid_vector_store_filter|filters/);

    const invalidLimitSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        max_num_results: 51,
      }),
    });
    assert.equal(invalidLimitSearch.status, 400);
    assert.match(await invalidLimitSearch.text(), /max_num_results/);

    const looseRankingSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok absent-token",
        max_num_results: 3,
        filters: { type: "eq", key: "suite", value: "server-test" },
        ranking_options: {
          ranker: "default_2024_08_21",
          score_threshold: 0.5,
          hybrid_search: { embedding_weight: 0, text_weight: 1 },
        },
      }),
    });
    assert.equal(looseRankingSearch.status, 200);
    const looseRankingJson = await looseRankingSearch.json();
    assert.equal(looseRankingJson.data[0].file_id, file.id);
    assert.deepEqual(looseRankingJson.ranking_options, {
      ranker: "default_2024_08_21",
      score_threshold: 0.5,
      hybrid_search: { embedding_weight: 0, text_weight: 1, local_mode: "text_only" },
    });

    const semanticRankingSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "automobile repair",
        max_num_results: 3,
        filters: { type: "eq", key: "suite", value: "server-test" },
        ranking_options: {
          score_threshold: 0.1,
          hybrid_search: { embedding_weight: 1, text_weight: 0 },
        },
      }),
    });
    assert.equal(semanticRankingSearch.status, 200);
    const semanticRankingJson = await semanticRankingSearch.json();
    assert.equal(semanticRankingJson.data[0].file_id, file.id);
    assert.equal(semanticRankingJson.data[0].text_score, 0);
    assert.ok(semanticRankingJson.data[0].embedding_score >= 0.1);
    assert.equal(semanticRankingJson.data[0].score_details.local_embedding_dimensions, 256);
    assert.deepEqual(semanticRankingJson.ranking_options, {
      ranker: "auto",
      score_threshold: 0.1,
      hybrid_search: {
        embedding_weight: 1,
        text_weight: 0,
        local_mode: "hashed_semantic",
        local_embedding_model: "hashed-semantic-256",
        local_embedding_dimensions: 256,
      },
    });

    const strictRankingSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok absent-token",
        max_num_results: 3,
        filters: { type: "eq", key: "suite", value: "server-test" },
        ranking_options: { score_threshold: 0.95 },
      }),
    });
    assert.equal(strictRankingSearch.status, 200);
    assert.deepEqual((await strictRankingSearch.json()).data, []);

    const invalidRankingSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "file-search-ok",
        ranking_options: { score_threshold: 1.5 },
      }),
    });
    assert.equal(invalidRankingSearch.status, 400);
    assert.match(await invalidRankingSearch.text(), /score_threshold/);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "File search for file-search-ok and secondary-ok. Return file-search-ok [1].",
        tools: [{
          type: "file_search",
          vector_store_ids: [vectorStore.id],
          max_num_results: 3,
          filters: { type: "eq", key: "suite", value: "server-test" },
          ranking_options: {
            ranker: "default_2024_08_21",
            score_threshold: 0.8,
          },
        }],
        include: ["file_search_call.results"],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].type, "file_search_call");
    assert.equal(json.output[0].status, "completed");
    assert.deepEqual(json.output[0].queries, ["file-search-ok", "secondary-ok"]);
    assert.deepEqual(json.output[0].vector_store_ids, [vectorStore.id]);
    assert.deepEqual(json.output[0].ranking_options, {
      ranker: "default_2024_08_21",
      score_threshold: 0.8,
    });
    assert.equal(json.output[0].results[0].file_id, file.id);
    assert.deepEqual(json.output[0].results[0].matched_queries, ["file-search-ok", "secondary-ok"]);
    assert.equal(json.output[1].type, "message");
    assert.equal(json.output[1].content[0].text, "file-search-ok [1]");
    assert.deepEqual(json.output[1].content[0].annotations, [{
      type: "file_citation",
      index: 15,
      file_id: file.id,
      filename: "fixture.txt",
    }]);
    assert.equal(json.metadata.compatibility.local_file_search.provider, "local");
    assert.equal(json.metadata.compatibility.local_file_search.result_count, 1);
    assert.equal(json.metadata.compatibility.local_file_search.query_count, 2);
    assert.deepEqual(json.metadata.compatibility.local_file_search.ranking_options, {
      ranker: "default_2024_08_21",
      score_threshold: 0.8,
    });
    assert.equal(json.metadata.compatibility.local_file_search.deepseek_thinking, "disabled_for_local_file_search");

    const genericResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Using the file search result, return exactly this text and nothing else: file-search-ok [1]",
        tools: [{
          type: "file_search",
          vector_store_ids: [vectorStore.id],
          max_num_results: 3,
          filters: { type: "eq", key: "suite", value: "server-test" },
        }],
        include: ["file_search_call.results"],
        store: false,
      }),
    });
    assert.equal(genericResponse.status, 200);
    const genericJson = await genericResponse.json();
    assert.equal(genericJson.output[0].queries[0], "file-search-ok");
    assert.equal(genericJson.output[0].results[0].file_id, file.id);

    const listed = await fetch(`${baseUrl}/v1/files?purpose=assistants`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).data[0].id, file.id);
  });
});

test("local Uploads API assembles ordered parts into Files and Responses input_file", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses input_file compatibility extracted file inputs/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /Upload fixture says upload-input-ok/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_upload_input_file",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "upload-input-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const partAContent = "Upload fixture says ";
    const partBContent = "upload-input-ok.";
    const fullContent = `${partAContent}${partBContent}`;

    const createdUploadResponse = await fetch(`${baseUrl}/v1/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "upload-fixture.txt",
        purpose: "user_data",
        bytes: Buffer.byteLength(fullContent, "utf8"),
        mime_type: "text/plain",
        expires_after: { anchor: "created_at", seconds: 3600 },
      }),
    });
    assert.equal(createdUploadResponse.status, 200);
    const upload = await createdUploadResponse.json();
    assert.equal(upload.object, "upload");
    assert.equal(upload.status, "pending");
    assert.equal(upload.bytes, Buffer.byteLength(fullContent, "utf8"));

    const partBResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data_base64: Buffer.from(partBContent, "utf8").toString("base64"),
      }),
    });
    assert.equal(partBResponse.status, 200);
    const partB = await partBResponse.json();
    assert.equal(partB.object, "upload.part");
    assert.equal(partB.upload_id, upload.id);

    const partAResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: partAContent,
    });
    assert.equal(partAResponse.status, 200);
    const partA = await partAResponse.json();

    const completedResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ part_ids: [partA.id, partB.id] }),
    });
    assert.equal(completedResponse.status, 200);
    const completed = await completedResponse.json();
    assert.equal(completed.status, "completed");
    assert.equal(completed.file.object, "file");
    assert.equal(completed.file.filename, "upload-fixture.txt");
    assert.equal(completed.file.purpose, "user_data");

    const contentResponse = await fetch(`${baseUrl}/v1/files/${completed.file.id}/content`);
    assert.equal(contentResponse.status, 200);
    assert.equal(await contentResponse.text(), fullContent);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [{
          role: "user",
          content: [
            { type: "input_file", file_id: completed.file.id },
            { type: "input_text", text: "Using the uploaded file, return exactly this text and nothing else: upload-input-ok" },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "upload-input-ok");
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 1);

    const cancelUploadResponse = await fetch(`${baseUrl}/v1/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "cancel-me.txt",
        purpose: "assistants",
        bytes: 1,
        mime_type: "text/plain",
      }),
    });
    assert.equal(cancelUploadResponse.status, 200);
    const cancelUpload = await cancelUploadResponse.json();
    const cancelResponse = await fetch(`${baseUrl}/v1/uploads/${cancelUpload.id}/cancel`, { method: "POST" });
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).status, "cancelled");
    const afterCancelPart = await fetch(`${baseUrl}/v1/uploads/${cancelUpload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    assert.equal(afterCancelPart.status, 400);

    const mismatchUploadResponse = await fetch(`${baseUrl}/v1/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "mismatch.txt",
        purpose: "assistants",
        bytes: 5,
        mime_type: "text/plain",
      }),
    });
    assert.equal(mismatchUploadResponse.status, 200);
    const mismatchUpload = await mismatchUploadResponse.json();
    const mismatchPartResponse = await fetch(`${baseUrl}/v1/uploads/${mismatchUpload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "abc",
    });
    assert.equal(mismatchPartResponse.status, 200);
    const mismatchPart = await mismatchPartResponse.json();
    const mismatchComplete = await fetch(`${baseUrl}/v1/uploads/${mismatchUpload.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ part_ids: [mismatchPart.id] }),
    });
    assert.equal(mismatchComplete.status, 400);
    assert.equal((await mismatchComplete.json()).error.code, "upload_bytes_mismatch");
  });
});

test("local Uploads and Files preserve binary bytes for PDF input_file extraction", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Binary Upload PDF says binary-upload-ok/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /extraction_method: pdftotext/.test(message.content || "")));
    assert.ok(!call.body.messages.some((message) => /%PDF-1\.4/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_binary_upload_input_file",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "binary-upload-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const pdf = tinyPdfBuffer("Binary Upload PDF says binary-upload-ok.");
    const splitAt = Math.floor(pdf.length / 2);

    const createdUploadResponse = await fetch(`${baseUrl}/v1/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "binary-upload.pdf",
        purpose: "user_data",
        bytes: pdf.length,
        mime_type: "application/pdf",
      }),
    });
    assert.equal(createdUploadResponse.status, 200);
    const upload = await createdUploadResponse.json();

    const partTwoResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data_base64: pdf.subarray(splitAt).toString("base64"),
      }),
    });
    assert.equal(partTwoResponse.status, 200);
    const partTwo = await partTwoResponse.json();

    const partOneResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/parts`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: pdf.subarray(0, splitAt),
    });
    assert.equal(partOneResponse.status, 200);
    const partOne = await partOneResponse.json();

    const completedResponse = await fetch(`${baseUrl}/v1/uploads/${upload.id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ part_ids: [partOne.id, partTwo.id] }),
    });
    assert.equal(completedResponse.status, 200);
    const completed = await completedResponse.json();
    assert.equal(completed.file.bytes, pdf.length);
    assert.equal(completed.file.metadata.mime_type, "application/pdf");

    const contentResponse = await fetch(`${baseUrl}/v1/files/${completed.file.id}/content`);
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await contentResponse.arrayBuffer()), pdf);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [{
          role: "user",
          content: [
            { type: "input_file", file_id: completed.file.id },
            { type: "input_text", text: "Using the uploaded PDF, return exactly this text and nothing else: binary-upload-ok" },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "binary-upload-ok");
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 1);
    assert.equal(json.metadata.compatibility.local_input_files.pdf_extracted_count, 1);
  });
});

test("local Vector Store file batches attach files and expose batch lifecycle", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "provider should not be called" }));
  }, async ({ bridgeAddress, stateDir }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const fileAResponse = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "batch-a.txt",
        purpose: "assistants",
        content: "Batch file A contains batch-global-ok.",
      }),
    });
    assert.equal(fileAResponse.status, 200);
    const fileA = await fileAResponse.json();

    const fileBResponse = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "batch-b.txt",
        purpose: "assistants",
        content: "Batch file B contains batch-per-file-ok.",
      }),
    });
    assert.equal(fileBResponse.status, 200);
    const fileB = await fileBResponse.json();

    const storeResponse = await fetch(`${baseUrl}/v1/vector_stores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "batch-store" }),
    });
    assert.equal(storeResponse.status, 200);
    const vectorStore = await storeResponse.json();
    assert.equal(vectorStore.status, "completed");
    assert.equal(vectorStore.usage_bytes, 0);

    const updatedStoreResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "batch-store-updated",
        metadata: { suite: "vector-update" },
        expires_after: { anchor: "last_active_at", days: 3 },
      }),
    });
    assert.equal(updatedStoreResponse.status, 200);
    const updatedStore = await updatedStoreResponse.json();
    assert.equal(updatedStore.name, "batch-store-updated");
    assert.deepEqual(updatedStore.metadata, { suite: "vector-update" });
    assert.deepEqual(updatedStore.expires_after, { anchor: "last_active_at", days: 3 });
    assert.ok(Number.isInteger(updatedStore.expires_at));
    const agedStore = ageVectorStoreForTest(stateDir, vectorStore.id);

    const globalBatchResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_ids: [fileA.id],
        attributes: { suite: "batch-global" },
        chunking_strategy: {
          type: "static",
          static: { max_chunk_size_tokens: 800, chunk_overlap_tokens: 200 },
        },
      }),
    });
    assert.equal(globalBatchResponse.status, 200);
    const globalBatch = await globalBatchResponse.json();
    assert.equal(globalBatch.object, "vector_store.file_batch");
    assert.equal(globalBatch.status, "completed");
    assert.deepEqual(globalBatch.file_counts, {
      in_progress: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
      total: 1,
    });

    const perFileBatchResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attributes: { suite: "ignored-global" },
        files: [{
          file_id: fileB.id,
          attributes: { suite: "batch-per-file" },
          chunking_strategy: {
            type: "static",
            static: { max_chunk_size_tokens: 1200, chunk_overlap_tokens: 300 },
          },
        }],
      }),
    });
    assert.equal(perFileBatchResponse.status, 200);
    const perFileBatch = await perFileBatchResponse.json();
    assert.equal(perFileBatch.object, "vector_store.file_batch");
    assert.equal(perFileBatch.status, "completed");
    assert.equal(perFileBatch.file_counts.completed, 1);

    const retrieved = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/${perFileBatch.id}`);
    assert.equal(retrieved.status, 200);
    assert.equal((await retrieved.json()).id, perFileBatch.id);

    const globalFiles = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/${globalBatch.id}/files?filter=completed`);
    assert.equal(globalFiles.status, 200);
    const globalFilesJson = await globalFiles.json();
    assert.equal(globalFilesJson.object, "list");
    assert.equal(globalFilesJson.data.length, 1);
    assert.equal(globalFilesJson.data[0].id, fileA.id);
    assert.deepEqual(globalFilesJson.data[0].attributes, { suite: "batch-global" });
    assert.equal(globalFilesJson.data[0].chunking_strategy.type, "static");

    const updatedFileResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files/${fileA.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attributes: { suite: "batch-global-updated", topic: "content" } }),
    });
    assert.equal(updatedFileResponse.status, 200);
    const updatedFile = await updatedFileResponse.json();
    assert.deepEqual(updatedFile.attributes, { suite: "batch-global-updated", topic: "content" });

    const attachedContent = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files/${fileA.id}/content`);
    assert.equal(attachedContent.status, 200);
    const attachedContentJson = await attachedContent.json();
    assert.equal(attachedContentJson.file_id, fileA.id);
    assert.equal(attachedContentJson.filename, "batch-a.txt");
    assert.deepEqual(attachedContentJson.attributes, { suite: "batch-global-updated", topic: "content" });
    assert.match(attachedContentJson.content[0].text, /batch-global-ok/);

    const perFileFiles = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/${perFileBatch.id}/files`);
    assert.equal(perFileFiles.status, 200);
    const perFileFilesJson = await perFileFiles.json();
    assert.equal(perFileFilesJson.data.length, 1);
    assert.equal(perFileFilesJson.data[0].id, fileB.id);
    assert.deepEqual(perFileFilesJson.data[0].attributes, { suite: "batch-per-file" });

    const failedFilter = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/${perFileBatch.id}/files?filter=failed`);
    assert.equal(failedFilter.status, 200);
    assert.deepEqual((await failedFilter.json()).data, []);

    const search = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "batch-per-file-ok",
        filters: { type: "eq", key: "suite", value: "batch-per-file" },
      }),
    });
    assert.equal(search.status, 200);
    assert.equal((await search.json()).data[0].file_id, fileB.id);

    const activeAfterSearchResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}`);
    assert.equal(activeAfterSearchResponse.status, 200);
    const activeAfterSearch = await activeAfterSearchResponse.json();
    assert.ok(activeAfterSearch.last_active_at > agedStore.last_active_at);
    assert.ok(activeAfterSearch.expires_at > agedStore.expires_at);

    expireVectorStoreForTest(stateDir, vectorStore.id);
    const expiredStoreResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}`);
    assert.equal(expiredStoreResponse.status, 200);
    const expiredStore = await expiredStoreResponse.json();
    assert.equal(expiredStore.status, "expired");

    const expiredSearch = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "batch-per-file-ok" }),
    });
    assert.equal(expiredSearch.status, 400);
    assert.match(await expiredSearch.text(), /vector_store_expired|expired/);

    const expiredResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Use file search for batch-per-file-ok.",
        tools: [{ type: "file_search", vector_store_ids: [vectorStore.id] }],
        store: false,
      }),
    });
    assert.equal(expiredResponse.status, 400);
    assert.match(await expiredResponse.text(), /vector_store_expired|expired/);

    const cancel = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/${perFileBatch.id}/cancel`, {
      method: "POST",
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).status, "completed");

    const invalid = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_ids: [fileA.id], files: [{ file_id: fileB.id }] }),
    });
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /mutually exclusive/);

    const missing = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/file_batches/vsfb_missing`);
    assert.equal(missing.status, 404);
  });
});

test("local Vector Store static chunking strategy controls file_search chunks", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "provider should not be called" }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const tokens = Array.from({ length: 230 }, (_, index) => (
      index === 135 ? "chunk-needle" : `chunkword${index}`
    ));
    const fileResponse = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "chunked.txt",
        purpose: "assistants",
        content: tokens.join(" "),
      }),
    });
    assert.equal(fileResponse.status, 200);
    const file = await fileResponse.json();

    const storeResponse = await fetch(`${baseUrl}/v1/vector_stores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "chunking-store" }),
    });
    assert.equal(storeResponse.status, 200);
    const vectorStore = await storeResponse.json();

    const attachedResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_id: file.id,
        attributes: { suite: "chunking" },
        chunking_strategy: {
          type: "static",
          static: { max_chunk_size_tokens: 100, chunk_overlap_tokens: 50 },
        },
      }),
    });
    assert.equal(attachedResponse.status, 200);
    const attached = await attachedResponse.json();
    assert.deepEqual(attached.chunking_strategy, {
      type: "static",
      static: { max_chunk_size_tokens: 100, chunk_overlap_tokens: 50 },
    });

    const contentResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files/${file.id}/content`);
    assert.equal(contentResponse.status, 200);
    const content = await contentResponse.json();
    assert.equal(content.content.length, 4);
    assert.equal(content.chunks[1].chunk_index, 1);
    assert.equal(content.chunks[1].token_start, 50);
    assert.equal(content.chunks[1].token_end, 150);
    assert.equal(content.chunks[1].token_count, 100);
    assert.deepEqual(content.chunking_strategy, {
      type: "static",
      static: { max_chunk_size_tokens: 100, chunk_overlap_tokens: 50 },
    });

    const searchResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "chunk-needle",
        filters: { type: "eq", key: "suite", value: "chunking" },
        max_num_results: 3,
      }),
    });
    assert.equal(searchResponse.status, 200);
    const search = await searchResponse.json();
    assert.ok(search.data.some((result) => result.file_id === file.id && /chunk-needle/.test(result.content[0].text)));
    assert.ok(search.data.every((result) => result.token_count <= 100));
    assert.ok(search.data.some((result) => result.chunk_index === 1 || result.chunk_index === 2));

    const invalidResponse = await fetch(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file_id: file.id,
        chunking_strategy: {
          type: "static",
          static: { max_chunk_size_tokens: 100, chunk_overlap_tokens: 60 },
        },
      }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.match(await invalidResponse.text(), /chunk_overlap_tokens/);
  });
});

test("Responses input_file file_id and file_data are extracted for Chat compatibility", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses input_file compatibility extracted file inputs/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /File ID fixture says input-file-ok/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /Inline fixture also says inline-ok/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /PDF fixture says pdf-ok/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /extraction_method: pdftotext/.test(message.content || "")));
    assert.ok(!call.body.messages.some((message) => /%PDF-1\.4/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_input_file",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "input-file-ok inline-ok pdf-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const createdFile = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: "input-file-fixture.txt",
        purpose: "user_data",
        content: "File ID fixture says input-file-ok.",
      }),
    });
    assert.equal(createdFile.status, 200);
    const file = await createdFile.json();

    const inline = Buffer.from("Inline fixture also says inline-ok.", "utf8").toString("base64");
    const inlinePdf = tinyPdfBuffer("PDF fixture says pdf-ok.").toString("base64");
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [{
          role: "user",
          content: [
            { type: "input_file", file_id: file.id },
            { type: "input_file", filename: "inline.txt", file_data: `data:text/plain;base64,${inline}` },
            { type: "input_file", filename: "inline.pdf", file_data: `data:application/pdf;base64,${inlinePdf}` },
            { type: "input_text", text: "Return input-file-ok inline-ok pdf-ok." },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "input-file-ok inline-ok pdf-ok");
    assert.equal(json.metadata.compatibility.local_input_files.provider, "local");
    assert.equal(json.metadata.compatibility.local_input_files.status, "completed");
    assert.equal(json.metadata.compatibility.local_input_files.file_count, 3);
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 3);
    assert.equal(json.metadata.compatibility.local_input_files.failed_count, 0);
    assert.equal(json.metadata.compatibility.local_input_files.pdf_extracted_count, 1);
    assert.equal(json.metadata.compatibility.local_input_files.deepseek_thinking, "disabled_for_input_files");
  });
});

test("Responses input_file file_url truncates remote files for Chat compatibility", async () => {
  const remoteBody = "Remote URL fixture says url-ok.\n" + "padding ".repeat(80);
  const remote = http.createServer((req, res) => {
    assert.equal(req.url, "/fixture.txt");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(remoteBody);
  });
  const remoteAddress = await listen(remote);

  try {
    await withMockProvider(async (_req, res, call) => {
      const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
      assert.deepEqual(call.body.thinking, { type: "disabled" });
      assert.match(prompt, /Local Responses input_file compatibility extracted file inputs/);
      assert.match(prompt, /source: file_url/);
      assert.match(prompt, /file_url: http:\/\/127\.0\.0\.1:\d+\/fixture\.txt/);
      assert.match(prompt, /Remote URL fixture says url-ok/);
      assert.match(prompt, /truncated: true/);
      assert.doesNotMatch(prompt, /padding (?:padding ){70}/);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl_input_file_url",
        object: "chat.completion",
        created: 100,
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "url-ok" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 },
      }));
    }, async ({ bridgeAddress }) => {
      const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          input: [{
            role: "user",
            content: [
              {
                type: "input_file",
                filename: "fixture.txt",
                file_url: `http://127.0.0.1:${remoteAddress.port}/fixture.txt`,
              },
              { type: "input_text", text: "Return url-ok." },
            ],
          }],
          store: false,
        }),
      });
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.output[0].content[0].text, "url-ok");
      assert.equal(json.metadata.compatibility.local_input_files.status, "completed");
      assert.equal(json.metadata.compatibility.local_input_files.file_count, 1);
      assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 1);
      assert.equal(json.metadata.compatibility.local_input_files.failed_count, 0);
      assert.equal(json.metadata.compatibility.local_input_files.truncated_count, 1);
    }, {
      inputFileMaxBytes: 96,
      inputFileMaxTextChars: 4096,
    });
  } finally {
    await close(remote);
  }
});

test("Responses input_file CSV adds spreadsheet augmentation metadata", async () => {
  await withMockProvider(async (_req, res, call) => {
    const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
    assert.match(prompt, /extraction_method: spreadsheet_csv/);
    assert.match(prompt, /local_spreadsheet_augmentation: true/);
    assert.match(prompt, /format: csv/);
    assert.match(prompt, /row_limit: 1000/);
    assert.match(prompt, /rows_parsed: 3/);
    assert.match(prompt, /columns_detected: 3/);
    assert.match(prompt, /header_row_1: Name \| Score \| Note/);
    assert.match(prompt, /Ada\t95\tcsv-ok, quoted note/);
    assert.match(prompt, /Grace\t88\tsecond row/);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_input_file_csv",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "csv-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 24, completion_tokens: 2, total_tokens: 26 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const csv = Buffer.from("Name,Score,Note\nAda,95,\"csv-ok, quoted note\"\nGrace,88,second row\n", "utf8").toString("base64");
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [{
          role: "user",
          content: [
            { type: "input_file", filename: "scores.csv", file_data: `data:text/csv;base64,${csv}` },
            { type: "input_text", text: "Return csv-ok." },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "csv-ok");
    assert.equal(json.metadata.compatibility.local_input_files.status, "completed");
    assert.equal(json.metadata.compatibility.local_input_files.file_count, 1);
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 1);
    assert.equal(json.metadata.compatibility.local_input_files.failed_count, 0);
    assert.equal(json.metadata.compatibility.local_input_files.spreadsheet_extracted_count, 1);
  });
});

test("Responses input_file Office documents are extracted for Chat compatibility", async () => {
  await withMockProvider(async (_req, res, call) => {
    const prompt = call.body.messages.map((message) => message.content || "").join("\n\n");
    assert.match(prompt, /DOCX fixture says docx-ok/);
    assert.match(prompt, /XLSX fixture/);
    assert.match(prompt, /xlsx-ok/);
    assert.match(prompt, /PPTX fixture says pptx-ok/);
    assert.match(prompt, /extraction_method: ooxml_docx/);
    assert.match(prompt, /extraction_method: ooxml_xlsx/);
    assert.match(prompt, /extraction_method: ooxml_pptx/);
    assert.match(prompt, /local_spreadsheet_augmentation: true/);
    assert.match(prompt, /header_row_1: XLSX fixture \| xlsx-ok/);
    assert.doesNotMatch(prompt, /PK\u0003\u0004/);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_input_office",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "docx-ok xlsx-ok pptx-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const docx = tinyDocxBuffer("DOCX fixture says docx-ok.").toString("base64");
    const xlsx = tinyXlsxBuffer([["XLSX fixture", "xlsx-ok"]]).toString("base64");
    const pptx = tinyPptxBuffer("PPTX fixture says pptx-ok.").toString("base64");

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [{
          role: "user",
          content: [
            {
              type: "input_file",
              filename: "fixture.docx",
              file_data: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx}`,
            },
            {
              type: "input_file",
              filename: "fixture.xlsx",
              file_data: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsx}`,
            },
            {
              type: "input_file",
              filename: "fixture.pptx",
              file_data: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${pptx}`,
            },
            { type: "input_text", text: "Return docx-ok xlsx-ok pptx-ok." },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "docx-ok xlsx-ok pptx-ok");
    assert.equal(json.metadata.compatibility.local_input_files.status, "completed");
    assert.equal(json.metadata.compatibility.local_input_files.file_count, 3);
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 3);
    assert.equal(json.metadata.compatibility.local_input_files.failed_count, 0);
    assert.equal(json.metadata.compatibility.local_input_files.office_extracted_count, 3);
    assert.equal(json.metadata.compatibility.local_input_files.spreadsheet_extracted_count, 1);
  });
});

test("local Containers back Responses shell compatibility and artifacts", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.tools, undefined);
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses shell compatibility executed command output/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /artifact-ok/.test(message.content || "")));
    assert.ok(!call.body.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_shell",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "artifact-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const createdContainer = await fetch(`${baseUrl}/v1/containers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "shell-fixture", memory_limit: "1g" }),
    });
    assert.equal(createdContainer.status, 200);
    const container = await createdContainer.json();
    assert.equal(container.object, "container");
    assert.equal(container.status, "running");

    const listed = await fetch(`${baseUrl}/v1/containers?name=shell-fixture`);
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).data[0].id, container.id);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Execute: printf artifact-ok > /mnt/data/artifact.txt && cat /mnt/data/artifact.txt",
        tools: [{
          type: "shell",
          environment: { type: "container_reference", container_id: container.id },
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].type, "shell_call");
    assert.equal(json.output[0].status, "completed");
    assert.equal(json.output[0].container_id, container.id);
    assert.match(json.output[0].action.command, /artifact-ok/);
    assert.equal(json.output[1].type, "shell_call_output");
    assert.equal(json.output[1].status, "completed");
    assert.equal(json.output[1].outcome.exit_code, 0);
    assert.equal(json.output[1].output[0].stdout, "artifact-ok");
    assert.equal(json.output[2].type, "message");
    assert.equal(json.output[2].content[0].text, "artifact-ok");
    assert.equal(json.metadata.compatibility.local_shell.provider, "local");
    assert.equal(json.metadata.compatibility.local_shell.status, "completed");
    assert.equal(json.metadata.compatibility.local_shell.command_count, 1);
    assert.equal(json.metadata.compatibility.local_shell.artifact_count, 1);
    assert.equal(json.metadata.compatibility.local_shell.deepseek_thinking, "disabled_for_local_shell");

    const files = await fetch(`${baseUrl}/v1/containers/${container.id}/files`);
    assert.equal(files.status, 200);
    const filesJson = await files.json();
    assert.equal(filesJson.data[0].path, "/artifact.txt");

    const content = await fetch(`${baseUrl}/v1/containers/${container.id}/files/${filesJson.data[0].id}/content`);
    assert.equal(content.status, 200);
    assert.equal(await content.text(), "artifact-ok");

    const deleted = await fetch(`${baseUrl}/v1/containers/${container.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);
  });
});

test("local Skills API manages versions and mounts skill references for shell", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.tools, undefined);
    assert.ok(call.body.messages.some((message) => /Mounted skills:\n- portable-math v2/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /skill-mount-v2-ok/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_skill_shell",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "skill-mounted-ok" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const createResponse = await fetch(`${baseUrl}/v1/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metadata: { suite: "skills-api" },
        files: [{
          path: "SKILL.md",
          content: [
            "---",
            "name: portable-math",
            "description: Mountable math helper for shell compatibility.",
            "---",
            "skill-mount-v1-ok",
          ].join("\n"),
        }, {
          path: "scripts/calc.sh",
          content: "echo calc-ok\n",
        }],
      }),
    });
    assert.equal(createResponse.status, 200);
    const skill = await createResponse.json();
    assert.equal(skill.object, "skill");
    assert.equal(skill.name, "portable-math");
    assert.equal(skill.default_version, 1);
    assert.equal(skill.latest_version, 1);
    assert.equal(skill.version_count, 1);

    const listResponse = await fetch(`${baseUrl}/v1/skills?order=asc`);
    assert.equal(listResponse.status, 200);
    const listed = await listResponse.json();
    assert.equal(listed.data[0].id, skill.id);

    const versionResponse = await fetch(`${baseUrl}/v1/skills/${skill.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "SKILL.md",
          content: [
            "---",
            "name: portable-math",
            "description: Mountable math helper for shell compatibility.",
            "---",
            "skill-mount-v2-ok",
          ].join("\n"),
        }],
      }),
    });
    assert.equal(versionResponse.status, 200);
    const version = await versionResponse.json();
    assert.equal(version.object, "skill.version");
    assert.equal(version.version, 2);

    const defaultDelete = await fetch(`${baseUrl}/v1/skills/${skill.id}/versions/1`, { method: "DELETE" });
    assert.equal(defaultDelete.status, 400);

    const updateResponse = await fetch(`${baseUrl}/v1/skills/${skill.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ default_version: 2, metadata: { suite: "skills-api-updated" } }),
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.default_version, 2);
    assert.equal(updated.latest_version, 2);
    assert.deepEqual(updated.metadata, { suite: "skills-api-updated" });

    const versionsResponse = await fetch(`${baseUrl}/v1/skills/${skill.id}/versions?order=asc`);
    assert.equal(versionsResponse.status, 200);
    const versions = await versionsResponse.json();
    assert.deepEqual(versions.data.map((item) => item.version), [1, 2]);

    const latestResponse = await fetch(`${baseUrl}/v1/skills/${skill.id}/versions/latest`);
    assert.equal(latestResponse.status, 200);
    assert.equal((await latestResponse.json()).version, 2);

    const contentResponse = await fetch(`${baseUrl}/v1/skills/${skill.id}/content`);
    assert.equal(contentResponse.status, 200);
    assert.match(contentResponse.headers.get("content-type"), /application\/zip/);
    const files = unzipFiles(Buffer.from(await contentResponse.arrayBuffer()), 500, 50 * 1024 * 1024);
    const manifest = files.find((file) => file.path === "SKILL.md");
    assert.ok(manifest);
    assert.match(manifest.content.toString("utf8"), /skill-mount-v2-ok/);

    const containerResponse = await fetch(`${baseUrl}/v1/containers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "skill-shell" }),
    });
    assert.equal(containerResponse.status, 200);
    const container = await containerResponse.json();

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "Execute: cat /mnt/data/.skills/portable-math/v2/SKILL.md",
        tools: [{
          type: "shell",
          environment: {
            type: "container_reference",
            container_id: container.id,
            skills: [{ type: "skill_reference", skill_id: skill.id }],
          },
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].type, "shell_call");
    assert.equal(json.output[1].type, "shell_call_output");
    assert.match(json.output[1].output[0].stdout, /skill-mount-v2-ok/);
    assert.equal(json.metadata.compatibility.local_shell.mounted_skill_count, 1);
    assert.equal(json.metadata.compatibility.local_shell.mounted_skills[0].skill_id, skill.id);
    assert.equal(json.metadata.compatibility.local_shell.mounted_skills[0].version, 2);
    assert.equal(json.output[2].content[0].text, "skill-mounted-ok");

    const setDefaultOne = await fetch(`${baseUrl}/v1/skills/${skill.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ default_version: 1 }),
    });
    assert.equal(setDefaultOne.status, 200);
    const deletedVersion = await fetch(`${baseUrl}/v1/skills/${skill.id}/versions/2`, { method: "DELETE" });
    assert.equal(deletedVersion.status, 200);
    assert.equal((await deletedVersion.json()).deleted, true);

    const deleteSkill = await fetch(`${baseUrl}/v1/skills/${skill.id}`, { method: "DELETE" });
    assert.equal(deleteSkill.status, 200);
    assert.equal((await deleteSkill.json()).deleted, true);
  });
});

test("Responses lifecycle endpoints retrieve input items, cancel completed records, and delete records", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_lifecycle",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "stored response" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const created = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "first" }],
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "second" }],
          },
        ],
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();

    const fetched = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`);
    assert.equal(fetched.status, 200);
    const fetchedJson = await fetched.json();
    assert.equal(fetchedJson.id, createdJson.id);
    assert.equal(fetchedJson.output[0].content[0].text, "stored response");

    const inputItems = await fetch(`${baseUrl}/v1/responses/${createdJson.id}/input_items?limit=1`);
    assert.equal(inputItems.status, 200);
    const inputItemsJson = await inputItems.json();
    assert.equal(inputItemsJson.object, "list");
    assert.equal(inputItemsJson.data.length, 1);
    assert.equal(inputItemsJson.data[0].id, "in_000000");
    assert.equal(inputItemsJson.has_more, true);

    const cancel = await fetch(`${baseUrl}/v1/responses/${createdJson.id}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);
    const cancelJson = await cancel.json();
    assert.equal(cancelJson.id, createdJson.id);
    assert.match(cancelJson.metadata.compatibility_cancel, /terminal responses/);

    const deleted = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), {
      id: createdJson.id,
      object: "response.deleted",
      deleted: true,
    });

    const missing = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`);
    assert.equal(missing.status, 404);
  });
});

test("POST /v1/responses with background true returns in_progress and later completes", async () => {
  await withMockProvider(async (_req, res) => {
    await sleep(40);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_background",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "background done" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const created = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "run in background",
        background: true,
        stream: true,
        store: false,
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    assert.equal(createdJson.status, "in_progress");
    assert.equal(createdJson.background, true);
    assert.equal(createdJson.store, true);
    assert.equal(createdJson.output.length, 0);
    assert.equal(createdJson.metadata.compatibility.background, "local_store_forced");
    assert.equal(createdJson.metadata.compatibility.stream, "disabled_for_background");

    const pending = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`);
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).status, "in_progress");

    let finalJson = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(20);
      const fetched = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`);
      finalJson = await fetched.json();
      if (finalJson.status === "completed") break;
    }

    assert.equal(finalJson.status, "completed");
    assert.equal(finalJson.background, true);
    assert.equal(finalJson.output[0].content[0].text, "background done");
    assert.equal(finalJson.usage.total_tokens, 11);
    assert.equal(finalJson.metadata.compatibility.background, "local_store_forced");
    assert.equal(finalJson.metadata.compatibility.stream, "disabled_for_background");
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.store, true);
  });
});

test("POST /v1/responses/{id}/cancel cancels an in-progress background response", async () => {
  await withMockProvider(async (_req, res) => {
    await sleep(200);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_cancelled_late",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "too late" },
        finish_reason: "stop",
      }],
    }));
  }, async ({ bridgeAddress }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const created = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "cancel me",
        background: true,
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    assert.equal(createdJson.status, "in_progress");

    const cancelled = await fetch(`${baseUrl}/v1/responses/${createdJson.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    const cancelledJson = await cancelled.json();
    assert.equal(cancelledJson.status, "cancelled");
    assert.match(cancelledJson.metadata.compatibility_cancel, /background job/);

    await sleep(240);
    const fetched = await fetch(`${baseUrl}/v1/responses/${createdJson.id}`);
    assert.equal(fetched.status, 200);
    const fetchedJson = await fetched.json();
    assert.equal(fetchedJson.status, "cancelled");
  });
});

test("server startup reconciles stale in-progress background responses", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-codex-bridge-stale-background-"));
  const responseId = "resp_stale_background";
  const store = new FileResponseStore({ dir: stateDir });
  store.put(responseId, {
    response: {
      id: responseId,
      object: "response",
      created_at: 100,
      model: "mock-model",
      background: true,
      status: "in_progress",
      output: [],
      metadata: {
        compatibility: {
          background: "local_async",
        },
      },
    },
    input_items: [{ id: "item_stale", type: "message", role: "user", content: "stale background" }],
    messages: [{ role: "user", content: "stale background" }],
  });

  const config = loadConfig({
    providerBaseUrl: "http://127.0.0.1:9",
    providerApiKey: "test-key",
    defaultModel: "mock-model",
    stateDir,
  });
  const bridge = createServer(config);
  const bridgeAddress = await listen(bridge);

  try {
    const fetched = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses/${responseId}`);
    assert.equal(fetched.status, 200);
    const json = await fetched.json();
    assert.equal(json.status, "failed");
    assert.equal(json.background, true);
    assert.equal(json.error.type, "compatibility_bridge_error");
    assert.equal(json.error.code, "background_job_interrupted_by_restart");
    assert.equal(json.metadata.compatibility.background, "local_async");
    assert.equal(json.metadata.compatibility.background_restart, "marked_failed_on_startup");
  } finally {
    await close(bridge);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("local Conversations API persists items and feeds Responses conversation context", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.body.messages[0].content, "Remember codeword delta-42.");
    assert.equal(call.body.messages.at(-1).content, "What codeword is stored?");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_conversation",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "delta-42" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const created = await fetch(`${baseUrl}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metadata: { topic: "conversation-test" },
        items: [{
          type: "message",
          role: "user",
          content: "Remember codeword delta-42.",
        }],
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();
    assert.match(createdJson.id, /^conv_/);
    assert.equal(createdJson.object, "conversation");
    assert.deepEqual(createdJson.metadata, { topic: "conversation-test" });

    const updated = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { topic: "updated" } }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual((await updated.json()).metadata, { topic: "updated" });

    const itemCreate = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        role: "system",
        content: "Answer tersely.",
      }),
    });
    assert.equal(itemCreate.status, 200);
    const itemCreateJson = await itemCreate.json();
    assert.equal(itemCreateJson.type, "message");
    assert.equal(itemCreateJson.role, "system");

    const itemDelete = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}/items/${itemCreateJson.id}`, {
      method: "DELETE",
    });
    assert.equal(itemDelete.status, 200);
    assert.deepEqual(await itemDelete.json(), {
      id: itemCreateJson.id,
      object: "conversation.item.deleted",
      deleted: true,
    });

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        conversation: createdJson.id,
        input: "What codeword is stored?",
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const responseJson = await response.json();
    assert.equal(responseJson.conversation, createdJson.id);
    assert.equal(responseJson.store, false);
    assert.equal(responseJson.output[0].content[0].text, "delta-42");
    assert.equal(responseJson.metadata.compatibility.local_conversation.id, createdJson.id);
    assert.equal(requests.length, 1);

    const items = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}/items?limit=2`);
    assert.equal(items.status, 200);
    const itemsJson = await items.json();
    assert.equal(itemsJson.object, "list");
    assert.equal(itemsJson.data.length, 2);
    assert.equal(itemsJson.has_more, true);

    const allItems = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}/items`);
    assert.equal(allItems.status, 200);
    const allItemsJson = await allItems.json();
    assert.equal(allItemsJson.data.length, 3);
    assert.equal(allItemsJson.data[0].content, "Remember codeword delta-42.");
    assert.equal(allItemsJson.data[1].content[0].text, "What codeword is stored?");
    assert.equal(allItemsJson.data[2].role, "assistant");
    assert.equal(allItemsJson.data[2].content[0].text, "delta-42");

    const retrievedItem = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}/items/${allItemsJson.data[2].id}`);
    assert.equal(retrievedItem.status, 200);
    assert.equal((await retrievedItem.json()).role, "assistant");

    const deletedConversation = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}`, { method: "DELETE" });
    assert.equal(deletedConversation.status, 200);
    assert.deepEqual(await deletedConversation.json(), {
      id: createdJson.id,
      object: "conversation.deleted",
      deleted: true,
    });

    const missing = await fetch(`${baseUrl}/v1/conversations/${createdJson.id}`);
    assert.equal(missing.status, 404);
  });
});

test("Responses conversation references return 404 when the local conversation is missing", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "provider should not be called" } }));
  }, async ({ bridgeAddress, requests }) => {
    for (const endpoint of ["/v1/responses", "/v1/responses/input_tokens", "/v1/responses/compact"]) {
      const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          conversation: "conv_missing",
          input: "hello",
        }),
      });
      assert.equal(response.status, 404, endpoint);
      const json = await response.json();
      assert.equal(json.error.code, "conversation_not_found", endpoint);
    }
    assert.equal(requests.length, 0);
  });
});

test("Responses auxiliary endpoints replay local conversation state", async () => {
  await withMockProvider(async (_req, res, call) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (call.body.messages?.[0]?.content.includes("compact long-running agent conversations")) {
      assert.match(call.body.messages[1].content, /aux-99/);
      assert.match(call.body.messages[1].content, /Summarize with the auxiliary marker/);
      res.end(JSON.stringify({
        id: "chatcmpl_conversation_compact",
        object: "chat.completion",
        created: 101,
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Aux marker aux-99 preserved." },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 90, completion_tokens: 6, total_tokens: 96 },
      }));
      return;
    }

    assert.equal(call.body.stream, false);
    assert.equal(call.body.max_tokens, 1);
    assert.match(call.body.messages.map((message) => message.content).join("\n"), /aux-99/);
    assert.match(call.body.messages.at(-1).content, /Count this with conversation/);
    res.end(JSON.stringify({
      id: "chatcmpl_conversation_tokens",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "." },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 77, completion_tokens: 1, total_tokens: 78 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const conversationResponse = await fetch(`${baseUrl}/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ type: "message", role: "user", content: "Remember auxiliary marker aux-99." }],
      }),
    });
    assert.equal(conversationResponse.status, 200);
    const conversation = await conversationResponse.json();

    const inputTokens = await fetch(`${baseUrl}/v1/responses/input_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        conversation: conversation.id,
        input: "Count this with conversation.",
        stream: true,
        store: true,
      }),
    });
    assert.equal(inputTokens.status, 200);
    assert.deepEqual(await inputTokens.json(), {
      object: "response.input_tokens",
      input_tokens: 77,
    });

    const compact = await fetch(`${baseUrl}/v1/responses/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        conversation: { id: conversation.id },
        input: "Summarize with the auxiliary marker.",
        max_output_tokens: 88,
        store: false,
      }),
    });
    assert.equal(compact.status, 200);
    const compactJson = await compact.json();
    assert.equal(compactJson.conversation, conversation.id);
    assert.equal(compactJson.metadata.compatibility.local_conversation.id, conversation.id);
    assert.equal(compactJson.metadata.compatibility.local_conversation.replayed_item_count, 1);
    assert.equal(compactJson.metadata.upstream_object, "chat.completion");

    const items = await fetch(`${baseUrl}/v1/conversations/${conversation.id}/items`);
    assert.equal(items.status, 200);
    assert.equal((await items.json()).data.length, 1);
    assert.equal(requests.length, 2);
  });
});

test("POST /v1/responses/compact returns local compaction and replays it", async () => {
  await withMockProvider(async (_req, res, call) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (call.body.messages?.[0]?.content.includes("compact long-running agent conversations")) {
      assert.deepEqual(call.body.thinking, { type: "disabled" });
      res.end(JSON.stringify({
        id: "chatcmpl_compact",
        object: "chat.completion",
        created: 100,
        model: "mock-model",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Project code word atlas-77. Next action: answer the follow-up." },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 },
      }));
      return;
    }

    res.end(JSON.stringify({
      id: "chatcmpl_after_compact",
      object: "chat.completion",
      created: 101,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "continued from compact" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
    }));
  }, async ({ bridgeAddress, requests, stateDir }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const compact = await fetch(`${baseUrl}/v1/responses/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [
          { role: "user", content: "Project code word is atlas-77." },
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Acknowledged." }],
          },
        ],
      }),
    });
    assert.equal(compact.status, 200);
    const compactJson = await compact.json();
    assert.equal(compactJson.object, "response.compaction");
    assert.equal(compactJson.output.length, 3);
    assert.equal(compactJson.output[2].type, "compaction");
    assert.match(compactJson.output[2].encrypted_content, /^occomp1\./);
    assert.equal(compactJson.usage.input_tokens, 50);
    assert.equal(fs.existsSync(path.join(stateDir, "compaction.key")), true);

    const continued = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: [
          ...compactJson.output,
          { role: "user", content: "What is the code word?" },
        ],
        store: false,
      }),
    });
    assert.equal(continued.status, 200);
    const continuedJson = await continued.json();
    assert.equal(continuedJson.output[0].content[0].text, "continued from compact");
    assert.equal(continuedJson.metadata.compatibility.local_compaction.deepseek_thinking, "disabled_for_compaction_replay");

    assert.match(requests[0].body.messages[1].content, /atlas-77/);
    assert.equal(requests[0].body.max_tokens, 512);
    assert.deepEqual(requests[1].body.thinking, { type: "disabled" });
    assert.equal(requests[1].body.messages.at(-2).role, "system");
    assert.match(requests[1].body.messages.at(-2).content, /Compacted conversation context:\nProject code word atlas-77/);
    assert.equal(requests[1].body.messages.at(-1).content, "What is the code word?");
  });
});

test("POST /v1/responses/input_tokens returns upstream prompt token usage", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_token_probe",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "." },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 42, completion_tokens: 1, total_tokens: 43 },
    }));
  }, async ({ bridgeAddress, requests }) => {
    const inputTokens = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses/input_tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        instructions: "count only",
        input: "How many tokens?",
        stream: true,
        store: true,
        max_output_tokens: 99,
      }),
    });
    assert.equal(inputTokens.status, 200);
    assert.deepEqual(await inputTokens.json(), {
      object: "response.input_tokens",
      input_tokens: 42,
    });
    assert.equal(requests[0].req.url, "/chat/completions");
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.max_tokens, 1);
    assert.equal("store" in requests[0].body, false);
    assert.deepEqual(requests[0].body.messages, [
      { role: "system", content: "count only" },
      { role: "user", content: "How many tokens?" },
    ]);
  });
});

test("POST /v1/completions maps legacy prompts to Chat Completions", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.req.url, "/chat/completions");
    assert.deepEqual(call.body, {
      model: "mock-model",
      messages: [{ role: "user", content: "Return exactly completion-ok." }],
      max_tokens: 32,
      temperature: 0,
      stop: ["END"],
      seed: 7,
      n: 2,
      logprobs: true,
      top_logprobs: 2,
      user: "legacy-user",
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_legacy",
      object: "chat.completion",
      created: 1700000123,
      model: "mock-model",
      system_fingerprint: "fp_legacy",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "completion-ok" },
          logprobs: {
            content: [{
              token: "completion-ok",
              logprob: -0.1,
              top_logprobs: [{ token: "completion-ok", logprob: -0.1 }],
            }],
          },
          finish_reason: "stop",
        },
        {
          index: 1,
          message: { role: "assistant", content: "completion-alt" },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        prompt: "Return exactly completion-ok.",
        max_tokens: 32,
        temperature: 0,
        stop: ["END"],
        seed: 7,
        n: 2,
        logprobs: 2,
        user: "legacy-user",
      }),
    });

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.match(json.id, /^cmpl-/);
    assert.equal(json.object, "text_completion");
    assert.equal(json.created, 1700000123);
    assert.equal(json.model, "mock-model");
    assert.equal(json.system_fingerprint, "fp_legacy");
    assert.deepEqual(json.usage, { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 });
    assert.equal(json.choices[0].text, "completion-ok");
    assert.equal(json.choices[0].index, 0);
    assert.equal(json.choices[0].finish_reason, "stop");
    assert.deepEqual(json.choices[0].logprobs, {
      tokens: ["completion-ok"],
      token_logprobs: [-0.1],
      top_logprobs: [{ "completion-ok": -0.1 }],
      text_offset: [0],
    });
    assert.equal(json.choices[1].text, "completion-alt");
    assert.equal(json.choices[1].index, 1);
    assert.equal(json.choices[1].logprobs, null);
  });
});

test("POST /v1/completions streams Chat chunks as legacy completion chunks", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.messages, [{ role: "user", content: "stream legacy" }]);
    assert.equal(call.body.stream, true);
    assert.deepEqual(call.body.stream_options, { include_usage: true });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_legacy_stream",
      object: "chat.completion.chunk",
      created: 1700000222,
      model: "mock-model",
      system_fingerprint: "fp_stream",
      choices: [{ index: 0, delta: { role: "assistant", content: "stream-" }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_legacy_stream",
      object: "chat.completion.chunk",
      model: "mock-model",
      choices: [{ index: 0, delta: { content: "completion-ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        prompt: "stream legacy",
        stream: true,
        max_tokens: 32,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const events = parseSseEvents(await response.text());
    assert.equal(events.at(-1).data, "[DONE]");
    const chunks = events.slice(0, -1).map((event) => event.data);
    assert.match(chunks[0].id, /^cmpl-/);
    assert.equal(chunks[0].object, "text_completion");
    assert.equal(chunks[0].created, 1700000222);
    assert.equal(chunks[0].system_fingerprint, "fp_stream");
    assert.equal(chunks[0].choices[0].text, "stream-");
    assert.equal(chunks[0].choices[0].finish_reason, null);
    assert.equal(chunks[1].choices[0].text, "completion-ok");
    assert.equal(chunks[1].choices[0].finish_reason, "stop");
    assert.deepEqual(chunks[1].usage, { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 });
  });
});

test("POST /v1/chat/completions proxies and stores chat responses when requested", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_passthrough",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "chat-ok" }, finish_reason: "stop" }],
    }));
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        store: true,
        metadata: { suite: "chat-list" },
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("content-length"), false);
    const json = await response.json();
    assert.equal(json.choices[0].message.content, "chat-ok");

    const fetched = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`);
    assert.equal(fetched.status, 200);
    const fetchedJson = await fetched.json();
    assert.equal(fetchedJson.id, json.id);

    const invalidUpdate = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "other-model" }),
    });
    assert.equal(invalidUpdate.status, 400);
    assert.equal((await invalidUpdate.json()).error.param, "model");

    const updated = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { suite: "chat-updated", owner: "bridge-test" } }),
    });
    assert.equal(updated.status, 200);
    const updatedJson = await updated.json();
    assert.equal(updatedJson.id, json.id);
    assert.deepEqual(updatedJson.metadata, { suite: "chat-updated", owner: "bridge-test" });

    const refetched = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`);
    assert.equal(refetched.status, 200);
    assert.deepEqual((await refetched.json()).metadata, { suite: "chat-updated", owner: "bridge-test" });

    const messages = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}/messages?limit=1`);
    assert.equal(messages.status, 200);
    const messagesJson = await messages.json();
    assert.equal(messagesJson.object, "list");
    assert.equal(messagesJson.data.length, 1);
    assert.equal(messagesJson.data[0].role, "user");
    assert.equal(messagesJson.data[0].direction, "input");
    assert.equal(messagesJson.has_more, true);

    const listed = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions?model=mock-model&metadata[suite]=chat-updated&limit=10`);
    assert.equal(listed.status, 200);
    const listedJson = await listed.json();
    assert.equal(listedJson.object, "list");
    assert.equal(listedJson.data.length, 1);
    assert.equal(listedJson.data[0].id, json.id);
    assert.equal(listedJson.data[0].metadata.suite, "chat-updated");
    assert.equal(listedJson.data[0].metadata.owner, "bridge-test");
    assert.equal(listedJson.first_id, json.id);
    assert.equal(listedJson.last_id, json.id);
    assert.equal(listedJson.has_more, false);

    const previousMetadata = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions?metadata[suite]=chat-list`);
    assert.equal(previousMetadata.status, 200);
    assert.equal((await previousMetadata.json()).data.length, 0);

    const filtered = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions?metadata[suite]=other`);
    assert.equal(filtered.status, 200);
    assert.equal((await filtered.json()).data.length, 0);

    const deleted = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), {
      id: json.id,
      object: "chat.completion.deleted",
      deleted: true,
    });

    const missingAfterDelete = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`);
    assert.equal(missingAfterDelete.status, 404);

    const messagesAfterDelete = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}/messages`);
    assert.equal(messagesAfterDelete.status, 404);

    const listedAfterDelete = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions?metadata[suite]=chat-updated`);
    assert.equal(listedAfterDelete.status, 200);
    assert.equal((await listedAfterDelete.json()).data.length, 0);

    const repeatedDelete = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}`, {
      method: "DELETE",
    });
    assert.equal(repeatedDelete.status, 404);
  });
});

test("POST /v1/chat/completions streams and stores reconstructed chat completion when requested", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.equal(call.req.url, "/chat/completions");
    assert.equal(call.body.store, true);
    assert.equal(call.body.stream, true);
    assert.deepEqual(call.body.metadata, { suite: "chat-stream-list" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream_store",
      object: "chat.completion.chunk",
      created: 1700000333,
      model: "mock-stream-model",
      system_fingerprint: "fp_chat_stream_store",
      service_tier: "flex",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "stream-" },
          finish_reason: null,
        },
        {
          index: 1,
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call_stream_store",
              type: "function",
              function: { name: "record_result", arguments: "{" },
            }],
          },
          finish_reason: null,
        },
      ],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream_store",
      object: "chat.completion.chunk",
      model: "mock-stream-model",
      choices: [
        {
          index: 0,
          delta: { content: "store-ok" },
          logprobs: { content: [{ token: "store-ok", logprob: -0.3, bytes: [115], top_logprobs: [] }] },
          finish_reason: "stop",
        },
        {
          index: 1,
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: "\"ok\":true}" },
            }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        store: true,
        stream: true,
        metadata: { suite: "chat-stream-list" },
        messages: [{ role: "user", content: "stream and store" }],
        tools: [{
          type: "function",
          function: {
            name: "record_result",
            parameters: { type: "object", properties: { ok: { type: "boolean" } } },
          },
        }],
        stream_options: { include_usage: true },
      }),
    });

    assert.equal(response.status, 200);
    const events = parseSseEvents(await response.text());
    assert.equal(events.at(-1).data, "[DONE]");
    assert.equal(events.slice(0, -1)
      .flatMap((event) => event.data.choices || [])
      .filter((choice) => choice.index === 0)
      .map((choice) => choice.delta?.content || "")
      .join(""), "stream-store-ok");

    const fetched = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/chatcmpl_stream_store`);
    assert.equal(fetched.status, 200);
    const fetchedJson = await fetched.json();
    assert.equal(fetchedJson.object, "chat.completion");
    assert.equal(fetchedJson.created, 1700000333);
    assert.equal(fetchedJson.model, "mock-stream-model");
    assert.equal(fetchedJson.system_fingerprint, "fp_chat_stream_store");
    assert.equal(fetchedJson.service_tier, "flex");
    assert.deepEqual(fetchedJson.metadata, { suite: "chat-stream-list" });
    assert.deepEqual(fetchedJson.usage, { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 });
    assert.equal(fetchedJson.choices[0].message.content, "stream-store-ok");
    assert.equal(fetchedJson.choices[0].finish_reason, "stop");
    assert.equal(fetchedJson.choices[0].logprobs.content[0].token, "store-ok");
    assert.equal(fetchedJson.choices[1].message.content, null);
    assert.deepEqual(fetchedJson.choices[1].message.tool_calls, [{
      id: "call_stream_store",
      type: "function",
      function: { name: "record_result", arguments: "{\"ok\":true}" },
    }]);
    assert.equal(fetchedJson.choices[1].finish_reason, "tool_calls");

    const messages = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/chatcmpl_stream_store/messages?limit=10`);
    assert.equal(messages.status, 200);
    const messagesJson = await messages.json();
    assert.equal(messagesJson.data.length, 3);
    assert.equal(messagesJson.data[0].direction, "input");
    assert.equal(messagesJson.data[1].direction, "output");
    assert.equal(messagesJson.data[1].content, "stream-store-ok");
    assert.equal(messagesJson.data[2].tool_calls[0].function.arguments, "{\"ok\":true}");

    const listed = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions?metadata[suite]=chat-stream-list`);
    assert.equal(listed.status, 200);
    const listedJson = await listed.json();
    assert.equal(listedJson.data.length, 1);
    assert.equal(listedJson.data[0].id, "chatcmpl_stream_store");
  });
});

test("Chat completion retrieval only returns explicitly stored chat completions", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_unstored",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "not stored" }, finish_reason: "stop" }],
    }));
  }, async ({ bridgeAddress }) => {
    const created = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(created.status, 200);
    const createdJson = await created.json();

    const missing = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${createdJson.id}`);
    assert.equal(missing.status, 404);
  });
});

test("GET /healthz does not require a provider key", async () => {
  const server = createServer(loadConfig({ providerApiKey: "", providerBaseUrl: "http://127.0.0.1:1" }));
  const address = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.equal(json.has_provider_key, false);
  } finally {
    await close(server);
  }
});

test("loadConfig filters provider-specific Chat fields for DeepSeek providers by default", () => {
  const previousServiceTier = process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER;
  const previousChatNativeFields = process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS;
  delete process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER;
  delete process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS;
  try {
    const deepseekConfig = loadConfig({ providerBaseUrl: "https://api.deepseek.com" });
    assert.equal(deepseekConfig.forwardServiceTier, false);
    assert.equal(deepseekConfig.forwardChatNativeFields, false);

    const openaiCompatibleConfig = loadConfig({ providerBaseUrl: "https://api.openai-compatible.test" });
    assert.equal(openaiCompatibleConfig.forwardServiceTier, true);
    assert.equal(openaiCompatibleConfig.forwardChatNativeFields, true);
  } finally {
    if (previousServiceTier === undefined) delete process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER;
    else process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER = previousServiceTier;
    if (previousChatNativeFields === undefined) delete process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS;
    else process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS = previousChatNativeFields;
  }
});

test("GET /v1/models/{model} proxies direct retrieval and falls back to model list", async () => {
  await withMockProvider(async (req, res) => {
    if (req.method === "GET" && req.url === "/models/direct-model") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "direct-model",
        object: "model",
        created: 123,
        owned_by: "provider",
      }));
      return;
    }

    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [{
          id: "listed-model",
          object: "model",
          created: 456,
          owned_by: "provider-list",
        }],
      }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  }, async ({ bridgeAddress, requests }) => {
    const baseUrl = `http://127.0.0.1:${bridgeAddress.port}`;
    const direct = await fetch(`${baseUrl}/v1/models/direct-model`);
    assert.equal(direct.status, 200);
    assert.deepEqual(await direct.json(), {
      id: "direct-model",
      object: "model",
      created: 123,
      owned_by: "provider",
    });

    const listed = await fetch(`${baseUrl}/v1/models/listed-model`);
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), {
      id: "listed-model",
      object: "model",
      created: 456,
      owned_by: "provider-list",
    });

    assert.equal(requests[0].req.url, "/models/direct-model");
    assert.equal(requests[1].req.url, "/models/listed-model");
    assert.equal(requests[2].req.url, "/models");
  });
});
