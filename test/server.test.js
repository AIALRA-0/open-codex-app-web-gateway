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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

test("POST /v1/responses/compact returns local compaction and replays it", async () => {
  await withMockProvider(async (_req, res, call) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (call.body.messages?.[0]?.content.includes("compact long-running agent conversations")) {
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

    assert.match(requests[0].body.messages[1].content, /atlas-77/);
    assert.equal(requests[0].body.max_tokens, 512);
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
