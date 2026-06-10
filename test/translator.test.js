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

test("maps chat completion content, tool calls, reasoning and usage back to Responses", () => {
  const response = chatCompletionToResponse({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 123,
    model: "deepseek-chat",
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
    }],
    usage: {
      prompt_tokens: 10,
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
  assert.equal(response.output[2].type, "function_call");
  assert.equal(response.output[2].call_id, "call_1");
  assert.equal(response.usage.output_tokens_details.reasoning_tokens, 2);
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
