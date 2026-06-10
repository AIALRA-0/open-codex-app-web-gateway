"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, loadConfig } = require("../src/bridge/server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withMockProvider(handler, run) {
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
        store: true,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "hello from chat");
    assert.equal(requests[0].req.url, "/chat/completions");
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

test("POST /v1/responses streams Chat chunks as typed Responses events", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "hel" }, finish_reason: null }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      id: "chatcmpl_stream",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }, async ({ bridgeAddress }) => {
    const response = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", input: "stream", stream: true }),
    });

    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /event: response\.created/);
    assert.match(text, /event: response\.output_text\.delta/);
    assert.match(text, /"delta":"hel"/);
    assert.match(text, /event: response\.completed/);
    assert.match(text, /"text":"hello"/);
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
