"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  mapResponsesTools,
  mapTextFormat,
  responseInputToChatMessages,
  responsesToChatRequest,
} = require("../src/bridge/translator");

test("maps Responses string and instructions to Chat Completions messages", () => {
  const { chat } = responsesToChatRequest({
    model: "deepseek-chat",
    instructions: "Be concise.",
    input: "Hello",
    max_output_tokens: 64,
  }, [], { defaultModel: "deepseek-chat" });

  assert.equal(chat.model, "deepseek-chat");
  assert.equal(chat.max_tokens, 64);
  assert.deepEqual(chat.messages, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" },
  ]);
});

test("maps multimodal input items to OpenAI-compatible chat content parts", () => {
  const messages = responseInputToChatMessages([
    {
      role: "user",
      content: [
        { type: "input_text", text: "Describe this" },
        { type: "input_image", image_url: "https://example.test/a.png" },
      ],
    },
  ]);

  assert.deepEqual(messages, [{
    role: "user",
    content: [
      { type: "text", text: "Describe this" },
      { type: "image_url", image_url: { url: "https://example.test/a.png" } },
    ],
  }]);
});

test("maps Responses function tools and tool_choice", () => {
  const { mapped, unsupported } = mapResponsesTools([
    {
      type: "function",
      name: "run_shell",
      description: "Run a shell command",
      parameters: { type: "object", properties: { cmd: { type: "string" } } },
      strict: true,
    },
    { type: "web_search_preview" },
  ]);

  assert.equal(unsupported[0], "web_search_preview");
  assert.deepEqual(mapped[0], {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command",
      parameters: { type: "object", properties: { cmd: { type: "string" } } },
      strict: true,
    },
  });
});

test("can reserve hosted tools for local bridge execution", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Search locally.",
    tools: [{ type: "web_search_preview" }],
  }, [], { localHostedTools: ["web_search_preview"] });

  assert.equal(chat.tools, undefined);
  assert.deepEqual(compatibility.unsupported_tools, []);
  assert.ok(!chat.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
});

test("can reserve file_search for local bridge execution", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Search files locally.",
    tools: [{ type: "file_search", vector_store_ids: ["vs_test"] }],
  }, [], { localHostedTools: ["file_search"] });

  assert.equal(chat.tools, undefined);
  assert.deepEqual(compatibility.unsupported_tools, []);
  assert.ok(!chat.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
});

test("can reserve shell and code_interpreter for local bridge execution", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Execute locally.",
    tools: [
      { type: "shell", environment: { type: "container_auto" } },
      { type: "code_interpreter", container: { type: "auto" } },
    ],
    tool_choice: "required",
  }, [], { localHostedTools: ["shell", "code_interpreter"] });

  assert.equal(chat.tools, undefined);
  assert.equal(chat.tool_choice, undefined);
  assert.deepEqual(compatibility.unsupported_tools, []);
  assert.equal(compatibility.local_tool_choice, "handled_by_bridge");
  assert.ok(!chat.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
});

test("can disable DeepSeek thinking mode when tool_choice is forced", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Call the tool.",
    tools: [{
      type: "function",
      name: "record_result",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    }],
    tool_choice: { type: "function", name: "record_result" },
  }, [], { deepseekDisableThinkingForToolChoice: true });

  assert.deepEqual(chat.tool_choice, { type: "function", function: { name: "record_result" } });
  assert.deepEqual(chat.thinking, { type: "disabled" });
  assert.equal(compatibility.deepseek_thinking, "disabled_for_tool_choice");
});

test("maps Responses output logprobs request to Chat logprobs parameters", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Return token probabilities.",
    include: ["message.output_text.logprobs"],
    top_logprobs: 2,
  });

  assert.equal(chat.logprobs, true);
  assert.equal(chat.top_logprobs, 2);
  assert.equal(compatibility.logprobs, "chat_logprobs");
});

test("passes stop sequences and maps DeepSeek user identity aliases", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Return a stopped phrase.",
    stop: ["<cut>"],
    user: "legacy-user",
    safety_identifier: "user@example.test",
  }, [], { deepseekUserIdCompat: true });

  assert.deepEqual(chat.stop, ["<cut>"]);
  assert.equal(chat.user, undefined);
  assert.match(chat.user_id, /^sha256_[a-f0-9]{64}$/);
  assert.deepEqual(compatibility.deepseek_user_id, {
    source: "safety_identifier",
    normalized: "sha256",
  });
});

test("keeps already-compatible DeepSeek user_id values direct", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Hello",
    user_id: "tenant_42-user",
  }, [], { deepseekUserIdCompat: true });

  assert.equal(chat.user_id, "tenant_42-user");
  assert.deepEqual(compatibility.deepseek_user_id, {
    source: "user_id",
    normalized: "direct",
  });
});

test("maps Responses structured output text.format to chat response_format", () => {
  const format = mapTextFormat({
    format: {
      type: "json_schema",
      name: "answer",
      strict: true,
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
    },
  });

  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.name, "answer");
  assert.equal(format.json_schema.strict, true);
});

test("can downgrade json_schema to json_object with an explicit schema instruction", () => {
  const { chat } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Return JSON.",
    text: {
      format: {
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    },
  }, [], { jsonSchemaMode: "json_object" });

  assert.equal(chat.response_format.type, "json_object");
  assert.match(chat.messages[0].content, /JSON Schema/);
  assert.equal(chat.messages[1].role, "user");
});

test("maps compaction items to continuation system context", () => {
  const messages = responseInputToChatMessages([
    {
      type: "compaction",
      encrypted_content: "local-token",
    },
    {
      type: "compaction",
      encrypted_content: "foreign-token",
    },
  ], {
    decodeCompaction: (value) => value === "local-token" ? "Remember code word atlas-77." : "",
  });

  assert.deepEqual(messages, [
    {
      role: "system",
      content: "Compacted conversation context:\nRemember code word atlas-77.",
    },
    {
      role: "system",
      content: "A compacted conversation context item was provided, but this bridge could not decode its opaque content. Continue using any other visible input items.",
    },
  ]);
});

test("maps chat completion content, tool calls, reasoning and usage back to Responses", () => {
  const response = chatCompletionToResponse({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 123,
    model: "deepseek-chat",
    service_tier: "priority",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        reasoning_content: "I should call a tool.",
        content: "Done",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "run_shell", arguments: "{\"cmd\":\"pwd\"}" },
        }],
      },
      finish_reason: "tool_calls",
      logprobs: {
        content: [{
          token: "Done",
          logprob: -0.01,
          bytes: [68, 111, 110, 101],
          top_logprobs: [{ token: "Done", logprob: -0.01, bytes: [68, 111, 110, 101] }],
        }],
      },
    }],
    usage: {
      prompt_tokens: 10,
      prompt_cache_hit_tokens: 6,
      prompt_cache_miss_tokens: 4,
      completion_tokens: 4,
      total_tokens: 14,
      completion_tokens_details: { reasoning_tokens: 2 },
    },
  }, { model: "deepseek-chat" }, { responseId: "resp_test" });

  assert.equal(response.id, "resp_test");
  assert.equal(response.object, "response");
  assert.equal(response.status, "completed");
  assert.equal(response.output[0].type, "reasoning");
  assert.equal(response.output[1].type, "message");
  assert.equal(response.output[1].content[0].text, "Done");
  assert.equal(response.output[1].content[0].logprobs[0].token, "Done");
  assert.equal(response.output[1].content[0].logprobs[0].top_logprobs[0].logprob, -0.01);
  assert.equal(response.output[2].type, "function_call");
  assert.equal(response.output[2].call_id, "call_1");
  assert.equal(response.service_tier, "priority");
  assert.equal(response.usage.input_tokens_details.cached_tokens, 6);
  assert.equal(response.usage.output_tokens_details.reasoning_tokens, 2);
});

test("preserves multiple Chat choices as Responses output items", () => {
  const completion = {
    id: "chatcmpl_multi",
    object: "chat.completion",
    created: 321,
    model: "multi-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "alpha" },
        finish_reason: "stop",
      },
      {
        index: 1,
        message: { role: "assistant", content: "beta" },
        finish_reason: "length",
      },
      {
        index: 2,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_choice_2",
            type: "function",
            function: { name: "modern_tool", arguments: "{\"ok\":true}" },
          }],
        },
        finish_reason: "tool_calls",
      },
      {
        index: 3,
        message: {
          role: "assistant",
          content: null,
          function_call: { name: "legacy_tool", arguments: "{\"legacy\":true}" },
        },
        finish_reason: "function_call",
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  };
  const response = chatCompletionToResponse(completion, { model: "multi-model" }, { responseId: "resp_multi" });

  assert.equal(response.status, "incomplete");
  assert.deepEqual(response.incomplete_details, { reason: "max_output_tokens" });
  assert.deepEqual(
    response.output
      .filter((item) => item.type === "message")
      .map((item) => item.content[0].text),
    ["alpha", "beta"],
  );
  const calls = response.output.filter((item) => item.type === "function_call");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].call_id, "call_choice_2");
  assert.equal(calls[0].name, "modern_tool");
  assert.equal(calls[1].name, "legacy_tool");
  assert.equal(calls[1].call_id, "call_chatcmpl_multi_3");

  const replay = chatCompletionToReplayMessages(completion);
  assert.equal(replay.length, 4);
  assert.equal(replay[2].tool_calls[0].id, "call_choice_2");
  assert.equal(replay[3].tool_calls[0].id, "call_chatcmpl_multi_3");
  assert.equal(replay[3].tool_calls[0].function.name, "legacy_tool");
});

test("keeps DeepSeek reasoning_content in replay messages", () => {
  const messages = chatCompletionToReplayMessages({
    choices: [{
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "hidden chain",
        tool_calls: [{
          id: "call_abc",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
        }],
      },
    }],
  });

  assert.equal(messages[0].reasoning_content, "hidden chain");
  assert.equal(messages[0].tool_calls[0].id, "call_abc");
});
