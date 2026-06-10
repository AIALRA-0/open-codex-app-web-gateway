# Responses to Chat Completions Compatibility Matrix

Status: initial implementation, 2026-06-10.

Primary sources:

- OpenAI migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Responses reference: https://developers.openai.com/api/reference/responses/overview
- OpenAI Responses streaming events: https://developers.openai.com/api/reference/resources/responses/streaming-events
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- Codex config reference: https://developers.openai.com/codex/config-reference
- DeepSeek Chat Completion docs: https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek Thinking Mode docs: https://api-docs.deepseek.com/guides/thinking_mode
- DeepSeek Tool Calls docs: https://api-docs.deepseek.com/guides/tool_calls

## Design Rule

Codex must see a Responses-compatible service. The bridge exposes
`/v1/responses`, translates the request into `/v1/chat/completions`, then
translates Chat response objects and Chat SSE chunks back into Responses objects
and typed Responses SSE events.

This gives strong compatibility for Codex's normal agent loop. It cannot make a
chat-only provider truly support hosted OpenAI tools without adding local
implementations for those tools.

## Request Mapping

| Responses field | Chat Completions field | Status |
| --- | --- | --- |
| `model` | `model` | Direct |
| `instructions` | leading `system` message | Direct for DeepSeek/OpenAI-compatible providers |
| string `input` | `messages: [{role:"user"}]` | Direct |
| input message item | chat message | Direct |
| `input_text` | chat text content part | Direct |
| `input_image` | chat `image_url` content part | Provider-dependent |
| `input_file` | explicit text marker | Lossy until a file extraction layer is added |
| prior `message` output item | assistant chat message | Direct |
| `function_call` item | assistant `tool_calls[]` | Direct |
| `function_call_output` item | `role:"tool"` message with `tool_call_id` | Direct |
| `reasoning` item | assistant `reasoning_content` replay | DeepSeek-specific compatibility |
| `previous_response_id` | local replay store | Emulated locally |
| `tools[type=function]` | chat function tools | Direct |
| hosted tools | compatibility system notice | Requires local hosted-tool executor |
| `tool_choice` | `tool_choice` | Direct for `auto`, `none`, `required`, function name; DeepSeek defaults to `thinking:{type:"disabled"}` when tool choice is present unless overridden |
| `text.format.type=text` | omitted/default | Direct |
| `text.format.type=json_object` | `response_format: {type:"json_object"}` | Provider-dependent |
| `text.format.type=json_schema` | `response_format.json_schema`, or DeepSeek default `json_object` plus schema instruction | Provider-dependent |
| `max_output_tokens` | `max_tokens` | Configurable via `CODEXCOMPAT_MAX_TOKENS_FIELD` |
| `temperature`, `top_p`, penalties, `seed`, `user`, `metadata`, `store` | same-name fields | Provider-dependent |
| `reasoning.effort` | `reasoning_effort` | DeepSeek-compatible mapping enabled by default |

DeepSeek effort compatibility maps `minimal`, `low`, and `medium` to `high`, and
`xhigh` to `max`, matching current DeepSeek docs. The DeepSeek default upstream
path is `/chat/completions`, not `/v1/chat/completions`; OpenAI-style `/v1`
paths remain configurable for other providers.

DeepSeek thinking mode defaults to enabled in current DeepSeek docs. The bridge
therefore disables thinking only for requests that include function tools and a
`tool_choice`, because the live `deepseek-v4-pro` endpoint rejects that
combination in thinking mode. Set
`CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE=false` or force
`CODEXCOMPAT_DEEPSEEK_THINKING_MODE=true` to override this compatibility
behavior.

## Response Mapping

| Chat response field | Responses field | Status |
| --- | --- | --- |
| `choices[0].message.content` | output `message.content[].output_text` | Direct |
| `choices[0].message.refusal` | output refusal content part | Direct when present |
| `choices[0].message.tool_calls[]` | output `function_call` items | Direct |
| `choices[0].message.reasoning_content` | output `reasoning.summary[]` and replay store | DeepSeek-specific |
| `usage.prompt_tokens` | `usage.input_tokens` | Direct |
| `usage.completion_tokens` | `usage.output_tokens` | Direct |
| `completion_tokens_details.reasoning_tokens` | `output_tokens_details.reasoning_tokens` | Direct when provider returns it |
| `finish_reason=length` | `status=incomplete` | Direct |
| other finish reasons | `status=completed` | Direct |

## Responses Endpoint Coverage

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/responses` | Implemented | Translates to upstream Chat Completions and stores replay state unless `store:false` |
| `GET /v1/responses/{response_id}` | Implemented | Returns the locally stored Responses object |
| `DELETE /v1/responses/{response_id}` | Implemented | Deletes the local replay record and returns a deletion marker |
| `GET /v1/responses/{response_id}/input_items` | Implemented | Returns locally stored input items with `limit`, `after`, `before`, and `order` pagination |
| `POST /v1/responses/{response_id}/cancel` | Compatibility no-op for completed records | The bridge only stores terminal responses today; completed records are returned unchanged with metadata explaining the no-op |
| `POST /v1/responses/compact` | Explicit 501 | Requires native Responses compaction semantics or a local summarization policy |
| `POST /v1/responses/input_tokens` | Explicit 501 | Requires provider-specific tokenizer accounting; planned for a tokenizer adapter layer |

## Streaming Mapping

The bridge emits:

- `response.created`
- `response.in_progress`
- `response.output_item.added`
- `response.content_part.added`
- `response.output_text.delta`
- `response.output_text.done`
- `response.content_part.done`
- `response.function_call_arguments.delta`
- `response.function_call_arguments.done`
- `response.reasoning_summary_text.delta`
- `response.reasoning_summary_text.done`
- `response.output_item.done`
- `response.completed`
- `error`

Chat stream chunks with `delta.content` become text deltas. Chunks with
`delta.tool_calls` become function-call item events and argument deltas. Chunks
with DeepSeek `delta.reasoning_content` become reasoning summary deltas and are
kept in the replay store so later tool turns can pass the reasoning content back.

## Known Gaps

| Capability | Why it is not fully native yet | Planned path |
| --- | --- | --- |
| OpenAI hosted `web_search` | Chat Completions providers do not execute OpenAI hosted tools | Add local web-search function executor and map citations |
| `file_search` | Requires vector store semantics absent from generic chat | Add local retrieval service and file citation mapping |
| `code_interpreter` | Requires sandboxed code runtime and artifact protocol | Add local sandbox executor with artifact storage |
| `computer_use` | Requires computer-use action loop | Add explicit local tool bridge if Codex exposes this over Responses |
| `image_generation` | Requires image API/provider adapter | Add provider-specific image tool |
| `Conversations API` | Separate OpenAI object model | Emulate only if Codex requires it |
| `n>1` multiple candidates | Responses removed `n`; Codex expects one output | Run multiple requests at caller layer |
| Exact OpenAI annotations | Provider-specific; chat often lacks annotations | Preserve when present, synthesize only from local tools |

## Reference Projects Reviewed

- Moon Bridge via DeepSeek agent docs: https://github.com/deepseek-ai/awesome-deepseek-agent/blob/main/docs/codex.md
- codex-relay: https://github.com/MetaFARS/codex-relay
- codex-bridge: https://github.com/wujfeng712-ui/codex-bridge
- codeproxy CLI: https://github.com/codeproxy-ai/cli
- VibeAround bridge notes: https://github.com/jazzenchen/VibeAround
- responses-proxy: https://docs.rs/responses-proxy
- LiteLLM transformation work: https://github.com/BerriAI/litellm/issues/21346

These projects validate the bridge architecture, but this repository keeps the
implementation local and auditable for the AIALRA deployment.
