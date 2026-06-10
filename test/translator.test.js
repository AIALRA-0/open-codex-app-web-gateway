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

test("expands configured Responses prompt templates before request input", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-chat",
    prompt: {
      id: "pmpt_test",
      version: "2",
      variables: {
        tone: "terse",
        answer: "prompt-template-ok",
      },
    },
    instructions: "Prefer exact output.",
    input: "Follow the reusable prompt.",
  }, [], {
    localPromptTemplates: {
      "pmpt_test@2": {
        instructions: "Use a {{tone}} style.",
        messages: [{ role: "user", content: "Return exactly {{answer}}." }],
      },
    },
  });

  assert.deepEqual(chat.messages, [
    { role: "system", content: "Use a terse style." },
    { role: "user", content: "Return exactly prompt-template-ok." },
    { role: "system", content: "Prefer exact output." },
    { role: "user", content: "Follow the reusable prompt." },
  ]);
  assert.deepEqual(compatibility.prompt_template, {
    status: "expanded_locally",
    id: "pmpt_test",
    version: "2",
    variable_keys: ["tone", "answer"],
    message_count: 2,
    source: "configured_template",
  });
});

test("preserves hosted Responses prompt references when no local template is configured", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-chat",
    prompt: {
      id: "pmpt_hosted",
      version: "7",
      variables: { answer: "hosted-template-ok" },
    },
    input: "Use the visible input.",
  });

  assert.match(chat.messages[0].content, /hosted prompt template reference/i);
  assert.match(chat.messages[0].content, /prompt_id: pmpt_hosted/);
  assert.match(chat.messages[0].content, /variable_keys: answer/);
  assert.deepEqual(chat.messages[1], { role: "user", content: "Use the visible input." });
  assert.deepEqual(compatibility.prompt_template, {
    status: "reference_preserved",
    id: "pmpt_hosted",
    version: "7",
    variable_keys: ["answer"],
    reason: "hosted_prompt_template_unavailable",
  });
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

test("can reserve computer hosted tools for local bridge execution", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Use the computer locally.",
    tools: [{ type: "computer", environment: "browser" }],
    tool_choice: { type: "computer" },
  }, [], { localHostedTools: ["computer"] });

  assert.equal(chat.tools, undefined);
  assert.equal(chat.tool_choice, undefined);
  assert.deepEqual(compatibility.unsupported_tools, []);
  assert.equal(compatibility.local_tool_choice, "handled_by_bridge");
  assert.ok(!chat.messages.some((message) => /cannot be invoked upstream/.test(message.content || "")));
});

test("maps computer_call_output input to readable chat context", () => {
  const messages = responseInputToChatMessages([{
    type: "computer_call_output",
    call_id: "call_123",
    output: {
      type: "input_image",
      image_url: "https://example.test/screen.png",
      detail: "high",
    },
  }]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.match(messages[0].content, /Computer call output/);
  assert.match(messages[0].content, /call_123/);
  assert.match(messages[0].content, /https:\/\/example\.test\/screen\.png/);
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

test("maps Chat token aliases to configured upstream token field", () => {
  const aliasOnly = responsesToChatRequest({
    model: "mock-model",
    input: "Use Chat token alias.",
    max_completion_tokens: 17,
  });
  assert.equal(aliasOnly.chat.max_tokens, 17);
  assert.deepEqual(aliasOnly.compatibility.max_completion_tokens, {
    source: "max_completion_tokens",
    target: "max_tokens",
    value: 17,
    forwarded: true,
    reason: "chat_alias",
  });

  const legacyAlias = responsesToChatRequest({
    model: "mock-model",
    input: "Use legacy Chat token alias.",
    max_tokens: 13,
  });
  assert.equal(legacyAlias.chat.max_tokens, 13);
  assert.deepEqual(legacyAlias.compatibility.max_tokens, {
    source: "max_tokens",
    target: "max_tokens",
    value: 13,
    forwarded: true,
    reason: "chat_alias",
  });

  const aliasConflict = responsesToChatRequest({
    model: "mock-model",
    input: "Prefer current Chat token alias.",
    max_completion_tokens: 18,
    max_tokens: 19,
  });
  assert.equal(aliasConflict.chat.max_tokens, 18);
  assert.deepEqual(aliasConflict.compatibility.max_tokens, {
    source: "max_tokens",
    value: 19,
    forwarded: false,
    reason: "max_completion_tokens_precedence",
  });

  const conflict = responsesToChatRequest({
    model: "mock-model",
    input: "Prefer Responses token limit.",
    max_output_tokens: 11,
    max_completion_tokens: 22,
    max_tokens: 33,
  }, [], { maxTokensField: "max_completion_tokens" });
  assert.equal(conflict.chat.max_completion_tokens, 11);
  assert.deepEqual(conflict.compatibility.max_completion_tokens, {
    source: "max_completion_tokens",
    value: 22,
    forwarded: false,
    reason: "max_output_tokens_precedence",
  });
  assert.deepEqual(conflict.compatibility.max_tokens, {
    source: "max_tokens",
    value: 33,
    forwarded: false,
    reason: "max_output_tokens_precedence",
  });
});

test("forwards provider-supported Chat-native request fields", () => {
  const request = {
    model: "mock-model",
    input: "Use Chat-native options.",
    logit_bias: { "42": -3 },
    modalities: ["text", "audio"],
    audio: { voice: "alloy", format: "wav" },
    prediction: { type: "content", content: "draft" },
    n: 2,
    prompt_cache_key: "cache-key",
    prompt_cache_retention: "24h",
    safety_identifier: "safe-user",
    moderation: { input: true, output: true },
    verbosity: "low",
    web_search_options: { search_context_size: "low" },
    functions: [{ name: "legacy_tool", parameters: { type: "object", properties: {} } }],
    function_call: "auto",
  };
  const { chat, compatibility } = responsesToChatRequest(request, [], { forwardChatNativeFields: true });

  assert.deepEqual(chat.logit_bias, { "42": -3 });
  assert.deepEqual(chat.modalities, ["text", "audio"]);
  assert.deepEqual(chat.audio, { voice: "alloy", format: "wav" });
  assert.deepEqual(chat.prediction, { type: "content", content: "draft" });
  assert.equal(chat.n, 2);
  assert.equal(chat.prompt_cache_key, "cache-key");
  assert.equal(chat.prompt_cache_retention, "24h");
  assert.equal(chat.safety_identifier, "safe-user");
  assert.deepEqual(chat.moderation, { input: true, output: true });
  assert.equal(chat.verbosity, "low");
  assert.deepEqual(chat.web_search_options, { search_context_size: "low" });
  assert.deepEqual(chat.functions, request.functions);
  assert.equal(chat.function_call, "auto");
  assert.equal(compatibility.chat_native_fields.reason, "chat_native_passthrough");
  assert.deepEqual(compatibility.chat_native_fields.forwarded.sort(), [
    "audio",
    "function_call",
    "functions",
    "logit_bias",
    "modalities",
    "moderation",
    "n",
    "prediction",
    "prompt_cache_key",
    "prompt_cache_retention",
    "safety_identifier",
    "verbosity",
    "web_search_options",
  ].sort());
});

test("filters Chat-native request fields for unsupported providers", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Filter unsupported Chat-native options.",
    logit_bias: { "1": 2 },
    modalities: ["audio"],
    n: 2,
  }, [], { forwardChatNativeFields: false });

  assert.equal(chat.logit_bias, undefined);
  assert.equal(chat.modalities, undefined);
  assert.equal(chat.n, undefined);
  assert.deepEqual(compatibility.chat_native_fields.filtered.sort(), [
    "logit_bias",
    "modalities",
    "n",
  ].sort());
  assert.equal(compatibility.chat_native_fields.reason, "provider_unsupported");
});

test("requests streaming usage from Chat stream options by default", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "mock-model",
    input: "Stream with usage.",
    stream: true,
  });

  assert.deepEqual(chat.stream_options, { include_usage: true });
  assert.deepEqual(compatibility.stream_options, {
    source: "stream_options.include_usage",
    value: true,
    forwarded: true,
    reason: "enabled_by_bridge",
  });
});

test("preserves caller stream options and filters them outside streaming", () => {
  const streaming = responsesToChatRequest({
    model: "mock-model",
    input: "Stream without bridge-added usage.",
    stream: true,
    stream_options: { include_usage: false },
  });
  assert.deepEqual(streaming.chat.stream_options, { include_usage: false });
  assert.equal(streaming.compatibility.stream_options, undefined);

  const nonStreaming = responsesToChatRequest({
    model: "mock-model",
    input: "No stream.",
    stream_options: { include_usage: true },
  });
  assert.equal(nonStreaming.chat.stream_options, undefined);
  assert.deepEqual(nonStreaming.compatibility.stream_options, {
    source: "stream_options",
    forwarded: false,
    reason: "stream_required",
  });
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

test("passes Chat service tier to upstream requests", () => {
  const { chat } = responsesToChatRequest({
    model: "mock-model",
    input: "Use the requested tier.",
    service_tier: "priority",
  });

  assert.equal(chat.service_tier, "priority");
});

test("can filter service tier for providers that do not support it", () => {
  const { chat, compatibility } = responsesToChatRequest({
    model: "deepseek-v4-pro",
    input: "Use the available tier.",
    service_tier: "priority",
  }, [], { forwardServiceTier: false });

  assert.equal(chat.service_tier, undefined);
  assert.deepEqual(compatibility.service_tier, {
    source: "service_tier",
    value: "priority",
    forwarded: false,
    reason: "provider_unsupported",
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

test("maps encrypted reasoning items through the local decoder", () => {
  const messages = responseInputToChatMessages([
    {
      type: "reasoning",
      encrypted_content: "local-reasoning-token",
      summary: [{ type: "summary_text", text: "visible summary" }],
    },
    {
      type: "reasoning",
      encrypted_content: "foreign-reasoning-token",
      summary: [{ type: "summary_text", text: "foreign visible summary" }],
    },
    {
      type: "reasoning",
      encrypted_content: "foreign-without-summary",
    },
  ], {
    decodeReasoning: (value) => value === "local-reasoning-token" ? "hidden reasoning state" : "",
  });

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: "",
      reasoning_content: "hidden reasoning state",
    },
    {
      role: "assistant",
      content: "",
      reasoning_content: "foreign visible summary",
    },
  ]);
});

test("maps chat completion content, tool calls, reasoning and usage back to Responses", () => {
  const response = chatCompletionToResponse({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 123,
    model: "deepseek-chat",
    seed: 4242,
    tool_choice: "auto",
    response_format: { type: "json_object" },
    temperature: 0.2,
    top_p: 0.8,
    presence_penalty: 0.1,
    frequency_penalty: 0.3,
    metadata: { upstream: "chat-meta" },
    system_fingerprint: null,
    request_id: "req_123",
    input_user: "test-user",
    service_tier: "priority",
    moderation: {
      input: { results: [{ flagged: false }] },
      output: { results: [{ flagged: false }] },
    },
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
      prompt_tokens_details: { cached_tokens: 5, audio_tokens: 1 },
      completion_tokens: 4,
      total_tokens: 14,
      completion_tokens_details: {
        reasoning_tokens: 2,
        audio_tokens: 1,
        accepted_prediction_tokens: 3,
        rejected_prediction_tokens: 4,
      },
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
  assert.equal(response.metadata.compatibility.chat_completion_id, "chatcmpl_1");
  assert.equal(response.metadata.compatibility.chat_object, "chat.completion");
  assert.equal(response.metadata.compatibility.chat_created, 123);
  assert.equal(response.metadata.compatibility.chat_model, "deepseek-chat");
  assert.equal(Object.prototype.hasOwnProperty.call(response.metadata.compatibility, "chat_system_fingerprint"), true);
  assert.equal(response.metadata.compatibility.chat_system_fingerprint, null);
  assert.equal(response.metadata.compatibility.chat_request_id, "req_123");
  assert.equal(response.metadata.compatibility.chat_input_user, "test-user");
  assert.equal(response.metadata.compatibility.chat_seed, 4242);
  assert.equal(response.metadata.compatibility.chat_tool_choice, "auto");
  assert.deepEqual(response.metadata.compatibility.chat_response_format, { type: "json_object" });
  assert.equal(response.metadata.compatibility.chat_temperature, 0.2);
  assert.equal(response.metadata.compatibility.chat_top_p, 0.8);
  assert.equal(response.metadata.compatibility.chat_presence_penalty, 0.1);
  assert.equal(response.metadata.compatibility.chat_frequency_penalty, 0.3);
  assert.deepEqual(response.metadata.compatibility.chat_metadata, { upstream: "chat-meta" });
  assert.deepEqual(response.metadata.compatibility.chat_moderation, {
    input: { results: [{ flagged: false }] },
    output: { results: [{ flagged: false }] },
  });
  assert.deepEqual(response.moderation, {
    input: { results: [{ flagged: false }] },
    output: { results: [{ flagged: false }] },
  });
  assert.equal(response.metadata.compatibility.chat_usage.prompt_tokens_details.audio_tokens, 1);
  assert.equal(response.metadata.compatibility.chat_usage.completion_tokens_details.accepted_prediction_tokens, 3);
  assert.equal(response.metadata.compatibility.chat_usage.completion_tokens_details.rejected_prediction_tokens, 4);
  assert.equal(response.usage.input_tokens_details.cached_tokens, 5);
  assert.equal(response.usage.output_tokens_details.reasoning_tokens, 2);
});

test("maps Chat audio output into Responses message content and replay", () => {
  const completion = {
    id: "chatcmpl_audio",
    object: "chat.completion",
    created: 456,
    model: "audio-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Spoken answer",
        audio: {
          id: "audio_123",
          data: "UklGRg==",
          transcript: "Spoken answer",
          expires_at: 123456,
          format: "wav",
          voice: "alloy",
          provider_extra: { sample_rate: 24000 },
        },
      },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 5,
      total_tokens: 8,
      completion_tokens_details: { audio_tokens: 2, reasoning_tokens: 0 },
    },
  };

  const response = chatCompletionToResponse(completion, { model: "audio-model" }, { responseId: "resp_audio" });
  assert.equal(response.output[0].type, "message");
  assert.equal(response.output[0].content[0].type, "output_text");
  assert.equal(response.output[0].content[0].text, "Spoken answer");
  assert.deepEqual(response.output[0].content[1], {
    type: "output_audio",
    data: "UklGRg==",
    transcript: "Spoken answer",
    id: "audio_123",
    expires_at: 123456,
    format: "wav",
    voice: "alloy",
    audio: { provider_extra: { sample_rate: 24000 } },
  });
  assert.deepEqual(response.metadata.compatibility.chat_audio, [completion.choices[0].message.audio]);
  assert.equal(response.metadata.compatibility.chat_usage.completion_tokens_details.audio_tokens, 2);

  const replay = chatCompletionToReplayMessages(completion);
  assert.equal(replay.length, 1);
  assert.equal(replay[0].content, "Spoken answer");
  assert.deepEqual(replay[0].audio, completion.choices[0].message.audio);
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
  assert.deepEqual(response.metadata.compatibility.chat_choices, [
    { choice_index: 0, finish_reason: "stop" },
    { choice_index: 1, finish_reason: "length" },
    { choice_index: 2, finish_reason: "tool_calls" },
    { choice_index: 3, finish_reason: "function_call" },
  ]);

  const replay = chatCompletionToReplayMessages(completion);
  assert.equal(replay.length, 4);
  assert.equal(replay[2].tool_calls[0].id, "call_choice_2");
  assert.equal(replay[3].tool_calls[0].id, "call_chatcmpl_multi_3");
  assert.equal(replay[3].tool_calls[0].function.name, "legacy_tool");
});

test("maps Chat finish reasons to Responses terminal status", () => {
  const contentFiltered = chatCompletionToResponse({
    id: "chatcmpl_filter",
    created: 444,
    model: "deepseek-chat",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "" },
      finish_reason: "content_filter",
    }],
  }, { model: "deepseek-chat" }, { responseId: "resp_filter" });

  assert.equal(contentFiltered.status, "incomplete");
  assert.equal(contentFiltered.completed_at, null);
  assert.deepEqual(contentFiltered.incomplete_details, { reason: "content_filter" });
  assert.equal(contentFiltered.error, null);

  const resourceInterrupted = chatCompletionToResponse({
    id: "chatcmpl_resource",
    created: 445,
    model: "deepseek-chat",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "partial" },
      finish_reason: "insufficient_system_resource",
    }],
  }, { model: "deepseek-chat" }, { responseId: "resp_resource" });

  assert.equal(resourceInterrupted.status, "failed");
  assert.equal(resourceInterrupted.completed_at, null);
  assert.equal(resourceInterrupted.incomplete_details, null);
  assert.equal(resourceInterrupted.error.code, "server_error");
  assert.match(resourceInterrupted.error.message, /insufficient_system_resource/);
});

test("preserves non-streaming Chat refusal logprobs in compatibility metadata", () => {
  const response = chatCompletionToResponse({
    id: "chatcmpl_refusal_logprobs",
    created: 446,
    model: "deepseek-chat",
    choices: [{
      index: 2,
      message: { role: "assistant", content: null, refusal: "I cannot help with that." },
      logprobs: {
        content: null,
        refusal: [{
          token: "I cannot",
          logprob: -0.03,
          bytes: [73],
          top_logprobs: [{ token: "I cannot", logprob: -0.03, bytes: [73] }],
        }],
      },
      finish_reason: "stop",
    }],
  }, { model: "deepseek-chat" }, { responseId: "resp_refusal_logprobs" });

  assert.deepEqual(response.output[0].content, [{
    type: "refusal",
    refusal: "I cannot help with that.",
  }]);
  assert.equal(response.metadata.compatibility.chat_refusal_logprobs[0].choice_index, 2);
  assert.equal(response.metadata.compatibility.chat_refusal_logprobs[0].logprobs[0].token, "I cannot");
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
