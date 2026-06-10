"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer, loadConfig } = require("../src/bridge/server");
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
      return { event, data: data ? JSON.parse(data) : null };
    });
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
        content: "File Search Fixture says the exact marker is file-search-ok.",
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
      body: JSON.stringify({ file_id: file.id, attributes: { suite: "server-test" } }),
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
    assert.equal(searchJson.data[0].file_id, file.id);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        input: "File search for file-search-ok and return file-search-ok [1].",
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
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].type, "file_search_call");
    assert.equal(json.output[0].status, "completed");
    assert.equal(json.output[0].queries[0], "file-search-ok");
    assert.deepEqual(json.output[0].vector_store_ids, [vectorStore.id]);
    assert.equal(json.output[0].results[0].file_id, file.id);
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

test("local Vector Store file batches attach files and expose batch lifecycle", async () => {
  await withMockProvider(async (_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "provider should not be called" }));
  }, async ({ bridgeAddress }) => {
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

test("Responses input_file file_id and file_data are extracted for Chat compatibility", async () => {
  await withMockProvider(async (_req, res, call) => {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.ok(call.body.messages.some((message) => /Local Responses input_file compatibility extracted file inputs/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /File ID fixture says input-file-ok/.test(message.content || "")));
    assert.ok(call.body.messages.some((message) => /Inline fixture also says inline-ok/.test(message.content || "")));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl_input_file",
      object: "chat.completion",
      created: 100,
      model: "mock-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "input-file-ok inline-ok" },
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
            { type: "input_text", text: "Return input-file-ok inline-ok." },
          ],
        }],
        store: false,
      }),
    });
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.output[0].content[0].text, "input-file-ok inline-ok");
    assert.equal(json.metadata.compatibility.local_input_files.provider, "local");
    assert.equal(json.metadata.compatibility.local_input_files.status, "completed");
    assert.equal(json.metadata.compatibility.local_input_files.file_count, 2);
    assert.equal(json.metadata.compatibility.local_input_files.resolved_count, 2);
    assert.equal(json.metadata.compatibility.local_input_files.failed_count, 0);
    assert.equal(json.metadata.compatibility.local_input_files.deepseek_thinking, "disabled_for_input_files");
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
