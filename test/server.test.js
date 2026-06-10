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

test("Responses collection endpoints that require native semantics return explicit compatibility errors", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(500).end();
  }, async ({ bridgeAddress }) => {
    const compact = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses/compact`, { method: "POST" });
    assert.equal(compact.status, 501);
    const compactJson = await compact.json();
    assert.equal(compactJson.error.code, "unsupported_endpoint");

    const inputTokens = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/responses/input_tokens`, { method: "POST" });
    assert.equal(inputTokens.status, 501);
    const inputTokensJson = await inputTokens.json();
    assert.equal(inputTokensJson.error.type, "unsupported_compatibility_feature");
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

    const messages = await fetch(`http://127.0.0.1:${bridgeAddress.port}/v1/chat/completions/${json.id}/messages?limit=1`);
    assert.equal(messages.status, 200);
    const messagesJson = await messages.json();
    assert.equal(messagesJson.object, "list");
    assert.equal(messagesJson.data.length, 1);
    assert.equal(messagesJson.data[0].role, "user");
    assert.equal(messagesJson.data[0].direction, "input");
    assert.equal(messagesJson.has_more, true);
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
