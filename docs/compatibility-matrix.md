# Responses to Chat Completions Compatibility Matrix

Status: initial implementation, 2026-06-10.

Primary sources:

- OpenAI migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Responses reference: https://developers.openai.com/api/reference/responses/overview
- OpenAI Responses streaming events: https://developers.openai.com/api/reference/resources/responses/streaming-events
- OpenAI conversation state guide: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI Conversations reference: https://developers.openai.com/api/docs/api-reference/conversations/create
- OpenAI Chat Completions reference: https://developers.openai.com/api/reference/chat/create
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI file inputs guide: https://developers.openai.com/api/docs/guides/file-inputs
- OpenAI shell tool guide: https://developers.openai.com/api/docs/guides/tools-shell
- OpenAI Skills guide: https://developers.openai.com/api/docs/guides/tools-skills
- OpenAI file search guide: https://developers.openai.com/api/docs/guides/tools-file-search
- OpenAI Containers reference: https://platform.openai.com/docs/api-reference/containers
- OpenAI Uploads reference: https://developers.openai.com/api/reference/resources/uploads
- OpenAI Files reference: https://platform.openai.com/docs/api-reference/files
- OpenAI Vector Stores reference: https://platform.openai.com/docs/api-reference/vector-stores
- Codex config reference: https://developers.openai.com/codex/config-reference
- DeepSeek Chat Completion docs: https://api-docs.deepseek.com/api/create-chat-completion
- DeepSeek Token & Token Usage docs: https://api-docs.deepseek.com/quick_start/token_usage
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
| `input_file` | local extraction context plus explicit text marker | Emulated for local Files API `file_id`, completed Uploads API files, inline base64 `file_data`, and HTTP(S) `file_url` when text can be extracted; PDFs use local Poppler `pdftotext` when enabled; `.docx`, `.xlsx`, and `.pptx` OOXML files are extracted locally from ZIP/XML content |
| prior `message` output item | assistant chat message | Direct |
| `function_call` item | assistant `tool_calls[]` | Direct |
| `function_call_output` item | `role:"tool"` message with `tool_call_id` | Direct |
| `reasoning` item | assistant `reasoning_content` replay | DeepSeek-specific compatibility |
| `previous_response_id` | local replay store | Emulated locally |
| `conversation` / `conversation_id` | local Conversations item replay plus persisted turn append | Emulated locally; supports durable conversation state even when a response sets `store:false` |
| `background:true` | local async Chat completion plus local response store | Emulated locally; forces `store:true` and non-streaming upstream execution; startup reconciliation marks stale in-progress background records failed after a bridge restart |
| `tools[type=function]` | chat function tools | Direct |
| `tools[type=web_search_preview]` | local search adapter plus injected Chat context | Emulated locally; emits `web_search_call` search/open_page/find_in_page items and `url_citation` annotations |
| `tools[type=file_search]` | local vector-store search plus injected Chat context | Emulated locally; emits `file_search_call`, optional results, and `file_citation` annotations |
| `tool_resources.file_search.vector_store_ids` | local vector-store lookup targets | Emulated locally when the tool omits `vector_store_ids` |
| `tools[type=shell]` | local container command execution plus injected Chat context | Emulated locally for explicit `Execute:` prompts and shell code blocks; emits `shell_call` and `shell_call_output`; local `skill_reference` entries under `tools[].environment.skills` are mounted into the local container workspace |
| `tools[type=code_interpreter]` | local shell/container adapter | Compatibility alias; explicit Python code blocks are executed through `python3` in the local container workspace |
| other hosted tools | compatibility system notice | Requires local hosted-tool executors |
| `tool_choice` | `tool_choice` | Direct for `auto`, `none`, `required`, function name; DeepSeek defaults to `thinking:{type:"disabled"}` when tool choice is present unless overridden |
| `max_tool_calls` | local hosted-tool call budget | Emulated for local `web_search`, `file_search`, `shell`, and `code_interpreter` adapters. The shared budget is consumed before each local built-in tool call/action; skipped calls are recorded in `metadata.compatibility.local_tool_budget` and the tool-specific compatibility block |
| `text.format.type=text` | omitted/default | Direct |
| `text.format.type=json_object` | `response_format: {type:"json_object"}` | Provider-dependent |
| `text.format.type=json_schema` | `response_format.json_schema`, or DeepSeek default `json_object` plus schema instruction | Provider-dependent |
| `max_output_tokens` | `max_tokens` | Configurable via `CODEXCOMPAT_MAX_TOKENS_FIELD` |
| `max_completion_tokens` | configured max token field | Chat-native alias accepted on `/v1/responses`; `max_output_tokens` takes precedence and conflicts are recorded in `metadata.compatibility.max_completion_tokens` |
| `max_tokens` | configured max token field | Legacy Chat-native alias accepted on `/v1/responses`; `max_output_tokens` takes precedence, then `max_completion_tokens`, and conflicts are recorded in `metadata.compatibility.max_tokens` |
| `temperature`, `top_p`, penalties, `seed`, `user`, `metadata`, `store` | same-name fields | Provider-dependent |
| `service_tier` | `service_tier` | Provider-dependent Chat-native passthrough; DeepSeek defaults to filtering this unsupported field and records `metadata.compatibility.service_tier` |
| `logit_bias`, `modalities`, `audio`, `prediction`, `n`, `prompt_cache_key`, `prompt_cache_retention`, `safety_identifier`, `moderation`, `verbosity`, `web_search_options`, legacy `functions` / `function_call` | same-name Chat fields | Provider-aware Chat-native passthrough; DeepSeek defaults to filtering these unsupported fields and records forwarded/filtered names in `metadata.compatibility.chat_native_fields` |
| `stream_options` with `stream:true` | `stream_options` | Direct; when omitted the bridge defaults `include_usage:true` so streaming Responses terminal events can carry usage |
| `stream_options` without `stream:true` | omitted | Filtered with `metadata.compatibility.stream_options.reason=stream_required` |
| `stop` | `stop` | Compatibility extension for Chat-native stop sequences; OpenAI Chat supports up to 4, DeepSeek Chat supports up to 16 |
| `include:["message.output_text.logprobs"]` | `logprobs:true` | Direct for Chat providers that support token log probabilities |
| `top_logprobs` | `top_logprobs` plus `logprobs:true` | Direct; Chat requires `logprobs:true` when `top_logprobs` is set |
| `reasoning.effort` | `reasoning_effort` | DeepSeek-compatible mapping enabled by default |
| `user_id`, `safety_identifier`, `prompt_cache_key`, `user` | DeepSeek `user_id` | DeepSeek-specific compatibility; direct when already `[A-Za-z0-9_-]`, otherwise stable SHA-256 normalized |

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
| `choices[].message.content` / streaming `choices[].delta.content` | output `message.content[].output_text` | Direct for each Chat choice returned by the provider |
| `choices[].message.refusal` / streaming `choices[].delta.refusal` | output refusal content part | Direct when present |
| `choices[].message.tool_calls[]` | output `function_call` items | Direct |
| `choices[].message.function_call` | output `function_call` item | Legacy Chat function-call compatibility |
| `choices[].logprobs.content[]` | `message.content[].output_text.logprobs[]` | Direct for non-streaming and streaming Responses when provider returns Chat logprobs |
| `choices[].logprobs.refusal[]` | `metadata.compatibility.chat_refusal_logprobs[]` | Preserved in compatibility metadata because Responses refusal content parts do not expose a logprobs field |
| `choices[].message.annotations[]` / streaming `choices[].delta.annotations[]` | `message.content[].output_text.annotations[]` | Direct when a Chat provider returns citation annotations |
| `choices[].index`, `choices[].finish_reason` | `metadata.compatibility.chat_choices[]` | Preserves original Chat choice metadata while Responses output items carry the generated content |
| `choices[].message.reasoning_content` | output `reasoning.summary[]` and replay store | DeepSeek-specific |
| `usage.prompt_tokens` | `usage.input_tokens` | Direct |
| `usage.prompt_cache_hit_tokens` | `usage.input_tokens_details.cached_tokens` | DeepSeek-specific cache usage compatibility |
| `usage` | `metadata.compatibility.chat_usage` | Full original Chat usage object is preserved for provider-specific token detail fields that Responses usage does not expose |
| `usage.completion_tokens` | `usage.output_tokens` | Direct |
| `completion_tokens_details.reasoning_tokens` | `output_tokens_details.reasoning_tokens` | Direct when provider returns it |
| `service_tier` | `service_tier` | Direct for non-streaming responses and streaming chunks when a Chat provider echoes the actual tier used |
| `id` | `metadata.compatibility.chat_completion_id` | Preserved because the bridge must keep its own Responses `resp_*` id for storage and continuation |
| `object`, `created`, `model` | `metadata.compatibility.chat_object`, `chat_created`, `chat_model` | Preserved for non-streaming responses and streaming chunks; Responses keeps its own object identity |
| `system_fingerprint` | `metadata.compatibility.chat_system_fingerprint` | Preserved for non-streaming responses and streaming chunks, including explicit `null` values |
| `request_id`, `input_user` | `metadata.compatibility.chat_request_id`, `metadata.compatibility.chat_input_user` | Preserved when stored Chat response metadata is returned by an upstream provider |
| `seed`, `tool_choice`, `response_format`, sampling penalties, `metadata`, `tools` | `metadata.compatibility.chat_*` | Preserved when an upstream Chat provider returns stored-completion metadata fields with the response |
| `finish_reason=length` | `status=incomplete`, `incomplete_details.reason=max_output_tokens` | Direct for non-streaming and streaming Chat output |
| `finish_reason=content_filter` | `status=incomplete`, `incomplete_details.reason=content_filter` | Direct for non-streaming and streaming Chat output |
| `finish_reason=insufficient_system_resource` | `status=failed`, `error.code=server_error` | DeepSeek-specific Chat termination mapped to Responses failure because Responses incomplete reasons do not include this value |
| `finish_reason=stop`, `tool_calls`, or legacy `function_call` | `status=completed` | Direct |
| local background job state | `background`, `status`, `completed_at`, `error` | Emulated for `in_progress`, `completed`, `failed`, and `cancelled`; stale in-progress background records are reconciled to failed on startup instead of remaining stuck |
| local input file context | compatibility metadata `local_input_files` | Emulated before upstream Chat calls for Responses create, background, streaming, `/input_tokens`, and local compaction |
| local web search context | output `web_search_call` plus `output_text.annotations[].url_citation` | Emulated for non-streaming, streaming, and background Responses; bounded `open_page` extraction can inject top result page text and local `find_in_page` snippets |
| local file search context | output `file_search_call` plus `output_text.annotations[].file_citation` | Emulated for non-streaming, streaming, and background Responses |
| local shell context | output `shell_call` plus `shell_call_output` | Emulated for non-streaming, streaming, and background Responses when an explicit command is found |
| local hosted-tool budget | `metadata.compatibility.local_tool_budget` | Emulates Responses `max_tool_calls` across local hosted-tool adapters with `max_tool_calls`, `used`, `skipped`, `exhausted`, and bounded `skipped_calls` audit details |
| local conversation context | `response.conversation` plus persisted conversation items | Emulated for non-streaming, streaming, and background Responses attached to a local conversation; replay-only for `/input_tokens` and local compaction probes |

## Responses Endpoint Coverage

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/responses` | Implemented | Translates to upstream Chat Completions and stores replay state unless `store:false`; `background:true` returns `in_progress` immediately and completes asynchronously through local storage; bridge startup marks interrupted background records as failed; `conversation` replays and appends local Conversation items |
| `GET /v1/responses/{response_id}` | Implemented | Returns the locally stored Responses object |
| `DELETE /v1/responses/{response_id}` | Implemented | Deletes the local replay record, aborting an in-process background job when present, and returns a deletion marker |
| `GET /v1/responses/{response_id}/input_items` | Implemented | Returns locally stored input items with `limit`, `after`, `before`, and `order` pagination |
| `POST /v1/responses/{response_id}/cancel` | Implemented for local `in_progress` background responses; compatibility no-op for terminal records | In-process background jobs are aborted and marked `cancelled`; completed records are returned unchanged with metadata explaining the no-op |
| `POST /v1/responses/compact` | Implemented via local encrypted summary | Uses upstream Chat Completions to summarize request, `previous_response_id`, and local `conversation` state; returns `response.compaction`, attaches `response.conversation` when present, encrypts local compaction content with an AES-GCM key stored outside Git, and disables DeepSeek thinking for compaction replay follow-ups by default |
| `POST /v1/responses/input_tokens` | Implemented via upstream usage probe | Translates the request, `previous_response_id`, and local `conversation` state to Chat Completions; forces non-streaming `max_tokens:1`, disables upstream storage, and returns `usage.prompt_tokens` as `input_tokens` without appending Conversation items |

## Chat Completions Endpoint Coverage

OpenAI's current Chat Completions paths include `/v1/chat/completions`,
`/v1/chat/completions/{completion_id}`, and
`/v1/chat/completions/{completion_id}/messages`. The bridge implements create,
list, retrieve, update metadata, delete, and messages retrieval for locally
stored Chat completion records.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | Implemented | Proxies to upstream Chat Completions with bridge-safe response headers |
| `GET /v1/chat/completions` | Implemented for local `store:true` records | Lists locally stored upstream Chat completion objects with `model`, `metadata[key]`, `limit`, `after`, and `order` filters |
| `GET /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Returns a locally stored upstream Chat completion object |
| `POST /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Updates only the stored completion `metadata` field, matching the current OpenAI API restriction for stored Chat Completions |
| `DELETE /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Deletes a locally stored Chat completion and returns `object:"chat.completion.deleted"` |
| `GET /v1/chat/completions/{completion_id}/messages` | Implemented for local `store:true` records | Returns request messages plus assistant choice messages with `limit`, `after`, `before`, and `order` pagination |

The bridge stores Chat completions only when the incoming Chat request sets
`store:true`. This matches the stored-completion lifecycle intent and avoids
unbounded state growth for ordinary passthrough Chat traffic.

## Conversations Endpoint Coverage

OpenAI's current endpoint list includes `/v1/conversations`,
`/v1/conversations/{conversation_id}`,
`/v1/conversations/{conversation_id}/items`, and
`/v1/conversations/{conversation_id}/items/{item_id}`. The bridge implements a
local file-backed version to support Responses `conversation` state on
Chat-only providers.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/conversations` | Implemented locally | Creates `object:"conversation"` with metadata and optional initial items |
| `GET /v1/conversations/{conversation_id}` | Implemented locally | Retrieves local conversation metadata |
| `POST /v1/conversations/{conversation_id}` | Implemented locally | Updates local conversation `metadata` |
| `DELETE /v1/conversations/{conversation_id}` | Implemented locally | Deletes the local conversation and its items |
| `GET /v1/conversations/{conversation_id}/items` | Implemented locally | Lists local conversation items with `limit`, `after`, `before`, and `order` pagination |
| `POST /v1/conversations/{conversation_id}/items` | Implemented locally | Appends one item, `{item}`, or `{items:[...]}` to the local conversation |
| `GET /v1/conversations/{conversation_id}/items/{item_id}` | Implemented locally | Retrieves a local conversation item |
| `DELETE /v1/conversations/{conversation_id}/items/{item_id}` | Implemented locally | Deletes a local conversation item |

When a Responses request includes `conversation:"conv_..."`, the bridge injects
existing conversation items into the upstream Chat prompt, returns
`response.conversation`, and appends the new input plus output items back to the
conversation. This append happens even when the Responses request sets
`store:false`, matching the OpenAI conversation-state guide's distinction
between response storage and durable Conversation items. The auxiliary
`/v1/responses/input_tokens` and `/v1/responses/compact` endpoints also replay
the local Conversation items before calling upstream Chat Completions, but they
do not mutate the Conversation item list; compaction returns
`response.conversation` and `metadata.compatibility.local_conversation` for
traceability. The local store is bounded by record count, not by the 30-day
Responses TTL.

## Models Endpoint Coverage

OpenAI's current endpoint list includes `GET /v1/models` and
`GET /v1/models/{model}`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/models` | Implemented | Proxies upstream when available, otherwise returns the configured default bridge model |
| `GET /v1/models/{model}` | Implemented | Proxies upstream single-model retrieval when supported; otherwise searches upstream model list, then falls back to the configured default model only when the requested ID matches it |

## Uploads, Files and Vector Stores Endpoint Coverage

Uploads are local intermediate objects for large/client-side file ingestion.
`complete` creates a regular local File object, so the completed content can be
used through `input_file`, direct Files API reads, or the local `file_search`
adapter. File bytes are preserved under the configured bridge state directory,
not in Git; clearly text-like files also keep a text index for local
`file_search`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/uploads` | Implemented | Creates a pending local Upload from `filename`, `purpose`, `bytes`, `mime_type`, and optional `expires_after`; returns OpenAI-style `status` and `expires_at`; local `CODEXCOMPAT_UPLOAD_MAX_BYTES` defaults to the local Files size cap |
| `POST /v1/uploads/{upload_id}/parts` | Implemented | Adds an ordered candidate Part from JSON `data`/`data_base64`/`content`, multipart `data`, or raw body; each part is capped by `CODEXCOMPAT_UPLOAD_MAX_PART_BYTES` and the official 64 MB part maximum |
| `POST /v1/uploads/{upload_id}/complete` | Implemented | Requires ordered `part_ids`, verifies the final byte count matches the original Upload `bytes`, then returns `status:"completed"` with nested `file` object ready for the rest of the platform; preserves binary bytes in the created File |
| `POST /v1/uploads/{upload_id}/cancel` | Implemented | Marks a pending Upload `cancelled`; no new Parts may be added after cancel |
| `POST /v1/files` | Implemented | Accepts JSON `{filename,purpose,content,content_base64,metadata,mime_type}`, binary multipart upload, or raw body with `x-filename`; stores byte-preserving local content and a text index for text-like files |
| `GET /v1/files` | Implemented | Lists local files with `purpose`, `limit`, `after`, `before`, and `order` pagination |
| `GET /v1/files/{file_id}` | Implemented | Returns local file metadata |
| `GET /v1/files/{file_id}/content` | Implemented | Returns stored bytes with the best local content type, preserving binary uploads such as PDFs |
| `DELETE /v1/files/{file_id}` | Implemented | Deletes the file and detaches it from all local vector stores |
| `POST /v1/vector_stores` | Implemented | Creates a local vector-store record with `file_counts` and metadata |
| `GET /v1/vector_stores` | Implemented | Lists local vector stores with pagination; expired stores are marked `status:"expired"` |
| `GET /v1/vector_stores/{vector_store_id}` | Implemented | Returns local vector-store metadata, live file counts, and expired status when `expires_at` is in the past |
| `POST /v1/vector_stores/{vector_store_id}` | Implemented | Updates local vector-store `name`, `metadata`, and `expires_after`; computes `expires_at` from the local `last_active_at` timestamp |
| `DELETE /v1/vector_stores/{vector_store_id}` | Implemented | Deletes the local vector store and its file attachments |
| `POST /v1/vector_stores/{vector_store_id}/files` | Implemented | Attaches an uploaded file; supports per-file `attributes` for filtering and validates `chunking_strategy` |
| `GET /v1/vector_stores/{vector_store_id}/files` | Implemented | Lists attached files with pagination |
| `GET /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Returns local vector-store file metadata |
| `POST /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Updates local vector-store file `attributes` for later `file_search` filters |
| `GET /v1/vector_stores/{vector_store_id}/files/{file_id}/content` | Implemented | Returns local extracted text chunks for a vector-store file, with chunk metadata and effective chunking strategy |
| `DELETE /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Detaches a file from the vector store |
| `POST /v1/vector_stores/{vector_store_id}/file_batches` | Implemented | Synchronously attaches up to 2000 local files; accepts either `file_ids` with global `attributes`/`chunking_strategy` or `files[]` with per-file values; validates static chunking limits |
| `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}` | Implemented | Returns the local batch record with OpenAI-style `vector_store.file_batch`, `status`, and `file_counts` fields |
| `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/files` | Implemented | Lists the vector-store files attached by the batch with pagination and `filter` by file status |
| `POST /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel` | Implemented as a compatibility no-op after synchronous completion | Returns the completed batch unless a future async batch is still `in_progress`, in which case it is marked `cancelled` |
| `POST /v1/vector_stores/{vector_store_id}/search` | Implemented | Hybrid local keyword + hashed-semantic chunk search with string or array `query`, `search_queries`, `matched_queries`, `max_num_results` default 10 / max 50, chunk metadata, static chunk overlap, ranking options, OpenAI-style attribute filters, `last_active_at` refresh, and `400 vector_store_expired` for expired stores |

## Containers Endpoint Coverage

These endpoints back the local `shell` / `code_interpreter` compatibility
adapter. Container files are stored under the configured bridge state directory,
not in Git.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/containers` | Implemented | Creates a local container workspace with OpenAI-style `container` metadata |
| `GET /v1/containers` | Implemented | Lists local containers with `name`, `limit`, `after`, `before`, and `order` pagination |
| `GET /v1/containers/{container_id}` | Implemented | Returns local container metadata |
| `DELETE /v1/containers/{container_id}` | Implemented | Deletes the local container workspace and artifacts |
| `POST /v1/containers/{container_id}/files` | Implemented | Writes a local container file from JSON or raw body |
| `GET /v1/containers/{container_id}/files` | Implemented | Lists files under the local `/mnt/data` workspace |
| `GET /v1/containers/{container_id}/files/{file_id}` | Implemented | Returns local container file metadata |
| `GET /v1/containers/{container_id}/files/{file_id}/content` | Implemented | Downloads local container file content |
| `DELETE /v1/containers/{container_id}/files/{file_id}` | Implemented | Deletes a local container file |

## Skills Endpoint Coverage

These endpoints back local skill upload, versioning, content retrieval, and
`skill_reference` mounting for the local shell/code-interpreter adapter. Skill
bundles are stored under the configured bridge state directory, not in Git.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/skills` | Implemented locally | Accepts JSON, multipart directory-style `files[]`, or raw `SKILL.md`; validates exactly one `SKILL.md` manifest and extracts `name` / `description` |
| `GET /v1/skills` | Implemented locally | Lists local skill records with `limit`, `after`, `before`, and `order` pagination |
| `GET /v1/skills/{skill_id}` | Implemented locally | Returns local skill metadata, `default_version`, `latest_version`, and `version_count` |
| `POST /v1/skills/{skill_id}` | Implemented locally | Updates `metadata` and `default_version`; deleting the default version is rejected until another default is selected |
| `DELETE /v1/skills/{skill_id}` | Implemented locally | Deletes the local skill and all versions |
| `GET /v1/skills/{skill_id}/content` | Implemented locally | Returns the default version as an `application/zip` bundle |
| `POST /v1/skills/{skill_id}/versions` | Implemented locally | Creates a new immutable local skill version from JSON, multipart, or raw upload |
| `GET /v1/skills/{skill_id}/versions` | Implemented locally | Lists local skill versions with pagination |
| `GET /v1/skills/{skill_id}/versions/{version}` | Implemented locally | Retrieves a numeric version, `latest`, or `default` |
| `DELETE /v1/skills/{skill_id}/versions/{version}` | Implemented locally | Deletes a non-default version; deleting the last version deletes the skill |
| `GET /v1/skills/{skill_id}/versions/{version}/content` | Implemented locally | Returns the selected version as an `application/zip` bundle |

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
- `response.refusal.delta`
- `response.refusal.done`
- `response.output_item.done`
- `response.completed`
- `response.incomplete`
- `response.failed`
- `error`

Chat stream chunks with `delta.content` become text deltas. Chunks with
`delta.refusal` become refusal content-part deltas. Chunks with `delta.tool_calls`
become function-call item events and argument deltas. Chunks
with DeepSeek `delta.reasoning_content` become reasoning summary deltas and are
kept in the replay store so later tool turns can pass the reasoning content back.
Chat stream chunks with `choice.logprobs.content[]` are accumulated and attached
to the final `output_text` content part and terminal response. Chat stream
chunks with `choice.logprobs.refusal[]` are preserved under
`metadata.compatibility.chat_refusal_logprobs[]`, because Responses refusal
content parts only support `type` and `refusal`.
Terminal `choice.finish_reason` values are aggregated across chunks. `length`
and `content_filter` end the stream with `response.incomplete`; DeepSeek
`insufficient_system_resource` ends the stream with `response.failed`.
When a Chat stream contains multiple `choices[].index` values, the bridge keeps
separate Responses output items and replay messages per choice instead of
merging deltas into one assistant message.
When `web_search_preview` is handled by the local adapter, the bridge emits
`web_search_call` output items for the search, any bounded local page opens, and
local `find_in_page` scans over opened page text, then applies URL citation
annotations to the final message content.
When `file_search` is handled by the local adapter, the bridge emits a
`file_search_call` output item before Chat text deltas and applies file citation
annotations to the final message content.
When `shell` is handled by the local adapter, the bridge emits completed
`shell_call` and `shell_call_output` items before Chat text deltas.

## Local Hosted Tool Call Budget

Responses `max_tool_calls` limits the total number of built-in tool calls a
response may process. Chat-only providers do not enforce this for hosted tools,
so the bridge applies a shared local budget before executing emulated
`web_search`, `file_search`, `shell`, and `code_interpreter` actions. The
current deterministic adapter order is shell/code-interpreter, then web search,
then file search, matching the bridge's local execution pipeline.

When the budget is exhausted, the bridge does not run the extra local action,
does not fabricate tool output, and records the skipped action under
`metadata.compatibility.local_tool_budget.skipped_calls`. Tool-specific
compatibility metadata also exposes skipped counters such as
`local_web_search.open_skipped_count`, `local_file_search.skipped_count`, and
`local_shell.skipped_count`. Invalid non-integer or negative `max_tool_calls`
values are rejected with `400 invalid_max_tool_calls`.

## Local Web Search Adapter

The bridge can emulate the Responses `web_search_preview` hosted tool for
Chat-only providers. It runs a configured local search provider, injects the
results into the Chat prompt as source material, and then maps the final
Responses output to the OpenAI-style shape documented for web search:
`web_search_call` plus `url_citation` annotations. For the first
`CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES` results, it can also fetch the page, extract
bounded text from HTML/plain text, inject it into the Chat prompt, and emit an
additional `web_search_call` with `action.type:"open_page"`. When
`CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE` is enabled, the bridge searches that
extracted text for the request query and injects bounded snippets while emitting
`action.type:"find_in_page"`. Search, `open_page`, and `find_in_page` each
consume one shared `max_tool_calls` budget slot when that Responses field is
present.

Current providers:

| Provider | Status | Notes |
| --- | --- | --- |
| `wikipedia` | Default no-key fallback | Uses the public MediaWiki search API. This is stable and secret-free, but it is not a full web index. |
| `static` | Implemented for tests/controlled evals | Reads JSON results from configuration. |
| `disabled` | Implemented | Leaves web search as an unsupported hosted tool with a compatibility notice. |

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_WEB_SEARCH_PROVIDER` | `wikipedia` | Use `disabled`, `static`, or `wikipedia` |
| `CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS` | `5` | Maximum search results injected and eligible for citation |
| `CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES` | `1` for `wikipedia`, `0` for `static` unless explicitly set | Number of top results opened with local `open_page` extraction |
| `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES` | `524288` | Maximum bytes read from each opened page |
| `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS` | `12000` | Maximum extracted page text injected per opened page |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE` | `true` | Enables local `find_in_page` scans over successfully opened page text |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES` | `3` | Maximum local `find_in_page` snippets injected per opened page |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS` | `240` | Characters of surrounding context included in each local `find_in_page` snippet |

This is a bridge compatibility layer, not native OpenAI web search. Full parity
still requires a production-grade web index/provider, citation policy, and
stronger citation ranking.

## Local Input File Adapter

The bridge can emulate Responses `input_file` items for Chat-only providers by
extracting text from bounded file inputs and injecting that text into the
upstream Chat prompt. It supports the three official Responses input styles:

- `file_id` from the local Files API;
- inline base64 `file_data`, including `data:<media>;base64,...` URLs;
- HTTP(S) `file_url` when URL fetching is enabled; remote bodies that exceed
  the local byte cap are truncated and marked in compatibility metadata.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_INPUT_FILE_PROVIDER` | `local` | Use `disabled` to leave `input_file` as a marker-only compatibility fallback |
| `CODEXCOMPAT_INPUT_FILE_MAX_FILES` | `8` | Maximum input files extracted per request |
| `CODEXCOMPAT_INPUT_FILE_MAX_BYTES` | `4194304` | Maximum bytes accepted from each local or inline input file, and maximum bytes retained from each remote `file_url`; the loader caps this at OpenAI's documented 50 MB per-file ceiling |
| `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS` | `200000` | Maximum extracted text injected per file |
| `CODEXCOMPAT_INPUT_FILE_FETCH_URLS` | `true` | Allows HTTP(S) `file_url` fetching with size and timeout caps |
| `CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS` | `10000` | Timeout for remote input file fetches |
| `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR` | `pdftotext` | Uses local Poppler `pdftotext` for PDF text extraction; use `disabled` to report PDFs as unsupported metadata |
| `CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS` | `10000` | Timeout for each local PDF text extraction process |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES` | `true` | Disables DeepSeek thinking mode for local input-file requests so visible output remains available under small output budgets |

This is a text extraction compatibility layer, not native OpenAI file input
processing. Text and code files, JSON, Markdown, HTML, XML, and similar formats
are injected directly. Inline `file_data` must be valid base64. Spreadsheet-like
CSV/TSV files and `.xlsx` sheets get a deterministic local augmentation block:
the first 1,000 rows per sheet are parsed, row/column counts and the first-row
header are added, and `spreadsheet_extracted_count` records the path in
compatibility metadata. Binary PDF text layers are extracted with Poppler
`pdftotext` when available. Modern Office OOXML files are parsed without new
runtime dependencies: `.docx` text is read from Word XML parts, `.xlsx` shared
strings and worksheet rows are rendered through the spreadsheet augmentation,
and `.pptx` slide text is extracted from slide XML. Scanned PDF images, OCR,
PDF page rendering, legacy binary Office formats, embedded Office media, and
complex workbook formulas/macros are still reported with metadata unless a
future parser extracts text safely. Remote `file_url` inputs that exceed the
byte cap keep the prefix that fits in budget, set `truncated: true` in the
injected prompt, and increment
`metadata.compatibility.local_input_files.truncated_count`. For large files,
prefer the local `file_search` adapter.

## Local File Search Adapter

The bridge can emulate the Responses `file_search` hosted tool for Chat-only
providers by keeping a local Files/Vector Stores state tree and running bounded
hybrid keyword plus hashed-semantic search over uploaded text. The adapter:

- reserves `file_search` so it is not forwarded as an unsupported Chat tool;
- searches `vector_store_ids` from the tool or `tool_resources.file_search`;
- accepts direct `query` arrays on vector-store search and performs bounded
  deterministic multi-query decomposition for Responses prompts such as
  `file search for alpha and beta`;
- injects retrieved chunks into the upstream Chat prompt as source material;
- emits `file_search_call` output items with queries, vector store IDs, and
  optional results when `include:["file_search_call.results"]` is requested;
- consumes one shared `max_tool_calls` budget slot per vector-store search when
  that Responses field is present;
- annotates final message text with `file_citation` entries;
- refreshes `last_active_at` and recomputes `expires_at` whenever a vector store
  is searched, and fails closed with `vector_store_expired` when a requested
  store has passed its expiration time;
- supports OpenAI-style attribute filters over file metadata and
  vector-store-file attributes, including comparison filters such as
  `{type:"eq",key:"suite",value:"x"}`, compound `and`/`or` filters,
  `attribute_filter` aliases on direct vector-store search, and plain
  shorthand maps such as `{suite:"server-test"}`;
- accepts OpenAI-style `ranking_options` on vector-store search requests and
  Responses `file_search` tools. `score_threshold` filters local hybrid
  results on a normalized 0..1 score, while `hybrid_search.embedding_weight`
  and `hybrid_search.text_weight` control the local hashed-semantic and keyword
  score blend. Search results expose `text_score`, `embedding_score`, and
  `score_details` for auditability;
- honors OpenAI-style `chunking_strategy` when files are attached to vector
  stores. Missing or `auto` strategies use the documented default static
  behavior: 800-token chunks with 400-token overlap. Static strategies are
  validated with `max_chunk_size_tokens` from 100 to 4096 and
  `chunk_overlap_tokens` no more than half the chunk size.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_FILE_SEARCH_PROVIDER` | `local` | Use `disabled` to leave `file_search` as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_FILE_SEARCH_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-file-search` | Local file/vector-store state path; keep outside Git |
| `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS` | `5` | Maximum retrieved chunks injected into Chat context; direct vector-store search defaults to 10 and accepts up to 50 via `max_num_results` |
| `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | `4194304` | Upload size limit for local text files |
| `CODEXCOMPAT_UPLOAD_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-uploads` | Local Uploads API intermediate state path; keep outside Git and prune with runtime policy if needed |
| `CODEXCOMPAT_UPLOAD_MAX_BYTES` | same as `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | Maximum local Upload size before completion into a File; capped at the official 8 GB Upload limit but defaults small for `/srv/aialra/apps` disk safety |
| `CODEXCOMPAT_UPLOAD_MAX_PART_BYTES` | min(64 MB, upload max) | Maximum local Upload Part size; capped at the official 64 MB Part limit |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH` | `true` | Disables DeepSeek thinking mode for local file-search requests to avoid reasoning-only completions exhausting small output budgets |

This is a bridge compatibility layer, not native OpenAI file search. The current
retriever is intentionally local, auditable, and disk-bounded; it supports
overlapping static chunks and deterministic 256-dimensional hashed semantic
features but is not yet backed by a managed embedding model, ANN vector index,
or OpenAI's hosted reranker. It also does not process binary PDFs, OCR, image
files, asynchronous batch indexing, or OpenAI's managed semantic ranking
behavior. Local `hybrid_search` metadata reports modes such as
`text_only`, `hashed_semantic`, or `hybrid_hashed_semantic`. Multi-query
decomposition is deterministic and bounded; it is not equivalent to OpenAI's
hosted query rewriting.

## Local Shell and Code Interpreter Adapter

The bridge can emulate the Responses `shell` hosted tool and a `code_interpreter`
compatibility alias for Chat-only providers by running explicit commands in a
local container workspace. The adapter:

- reserves `shell` and `code_interpreter` so they are not forwarded as
  unsupported Chat tools;
- extracts explicit `Execute:`, `Run:`, `Command:`, shell code block, or Python
  code block commands;
- creates or reuses local container workspaces through `container_auto` and
  `container_reference`-style tool configuration;
- mounts local Skills API `skill_reference` entries from
  `tools[].environment.skills` under
  `/mnt/data/.skills/<skill-name>/v<version>/` and records mounted skill
  metadata in `metadata.compatibility.local_shell.mounted_skills`;
- maps `/mnt/data` in commands to the local container workspace;
- emits paired `shell_call` and `shell_call_output` output items;
- consumes one shared `max_tool_calls` budget slot before each local shell or
  code-interpreter command execution when that Responses field is present;
- injects stdout, stderr, exit code, timeout status, and artifact list into the
  upstream Chat prompt;
- exposes generated files through the local Containers files endpoints.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_SHELL_PROVIDER` | `local` | Use `disabled` to leave shell/code-interpreter as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_SHELL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-containers` | Local container workspace path; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS` | `10000` | Per-command execution timeout |
| `CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES` | `20480` | Captured stdout/stderr byte limit per stream |
| `CODEXCOMPAT_SHELL_MAX_FILE_BYTES` | `16777216` | Container file upload/write limit |
| `CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS` | `4000` | Maximum command text accepted from a prompt |
| `CODEXCOMPAT_SHELL_MAX_COMMANDS` | `1` | Maximum extracted commands executed per response |
| `CODEXCOMPAT_SHELL_MEMORY_LIMIT` | `1g` | Metadata value returned on local container objects |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL` | `true` | Disables DeepSeek thinking mode for local shell requests so final text is visible under small output budgets |
| `CODEXCOMPAT_SKILL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-skills` | Local Skills API state path; keep outside Git |
| `CODEXCOMPAT_SKILL_MAX_UPLOAD_BYTES` | `52428800` | Maximum local skill upload bundle size |
| `CODEXCOMPAT_SKILL_MAX_FILE_COUNT` | `500` | Maximum files accepted in one local skill bundle |

This is a bridge compatibility layer, not OpenAI hosted shell or a Docker/VM
sandbox. It uses a local workspace, command timeouts, limited environment
variables, output caps, and audit metadata, but it does not yet provide kernel,
network, or filesystem isolation from the host. Full parity requires a hardened
container runtime, network allowlist enforcement, domain secret sidecars,
interactive service policies, and stronger artifact lifecycle controls.

## Known Gaps

| Capability | Why it is not fully native yet | Planned path |
| --- | --- | --- |
| OpenAI hosted `web_search` full parity | The local adapter can search, cite, open bounded top-result pages, and run local `find_in_page` scans over extracted text, but the default no-key provider is Wikipedia-only and does not match OpenAI's hosted ranking/policy behavior | Add production web-search provider support, stronger citation ranking, and richer search policy controls |
| OpenAI `input_file` full parity | The local adapter covers text/code/base64/local file IDs/completed Uploads/HTTP(S) URLs, PDF text-layer extraction, deterministic CSV/TSV/XLSX spreadsheet augmentation, and basic `.docx`/`.pptx` OOXML text extraction, but not PDF page images/OCR, OpenAI's model-generated spreadsheet summaries, legacy binary Office formats, embedded media, or complex workbook semantics | Add optional rendered-page context, OCR, richer spreadsheet summarization, legacy Office parsers, embedded media handling, and stronger file-type detection |
| OpenAI Uploads full parity | The local adapter covers create, add Parts, ordered completion, byte-count validation, cancellation, binary-safe File creation, and PDF `input_file` extraction after completion, but local disk caps are intentionally much smaller than OpenAI hosted limits by default and checksum/resumability semantics are not yet modeled | Add resumable cleanup metadata, checksum validation, async/parallel stress tests, and larger disk-governed staging profiles |
| OpenAI hosted `file_search` full parity | The local adapter covers API shape, byte-preserving file upload, vector-store lifecycle, static overlapping chunks for text-like files, hybrid local keyword + hashed-semantic retrieval, comparison/compound attribute filters, bounded multi-query decomposition, `score_threshold` ranking options, and citations, but it is not OpenAI's managed semantic vector search, reranker, or binary document ingestion pipeline | Add provider/model-backed embeddings, ANN vector indexing, PDF/Office parsers for indexing, async batches, managed-style query rewriting/reranking, and larger eval sets |
| OpenAI hosted `shell` / `code_interpreter` full parity | The local adapter covers explicit command execution, container lifecycle shape, output items, and artifacts, but it is not a hardened hosted container runtime | Add Docker/Firecracker isolation, network allowlists, domain secrets, service support, richer command negotiation, and lifecycle garbage collection |
| OpenAI Skills full parity | The local adapter covers upload/list/read/delete/version/content endpoints and local shell `skill_reference` mounting, but it is not OpenAI's hosted skill service and does not yet expose org/project governance, hosted validation policy, or SDK-perfect metadata for every future field | Expand schema fidelity as official SDKs stabilize, add richer bundle validation, and connect skills to future hosted tool adapters |
| `computer_use` | Requires computer-use action loop | Add explicit local tool bridge if Codex exposes this over Responses |
| `image_generation` | Requires image API/provider adapter | Add provider-specific image tool |
| OpenAI Conversations full parity | The local adapter covers object/item lifecycle and Responses state replay, but not every future OpenAI item subtype or server-side retention policy | Expand item subtype coverage as Codex emits them and add explicit retention/compaction policy controls |
| Native OpenAI compaction portability | Local compaction can be decrypted only by this bridge deployment/key; it is not OpenAI ZDR encrypted content | Keep key outside Git, document the boundary, and add optional key rotation/export policy |
| Background durability after process restart | Local background jobs are in-process while the response record is file-backed; startup now reconciles interrupted in-progress background records to explicit `failed` responses, but it does not resume the upstream call | Add a persisted job queue if Codex relies on long-running background tasks across bridge restarts |
| `n>1` multiple candidates | Responses removed `n`; Codex expects one generation | Non-streaming and streaming upstream Chat choices are preserved as multiple output items and replay messages when returned; request-side `n` forwarding remains provider-dependent |
| Exact OpenAI annotations | Provider-specific; chat often lacks annotations | Preserve non-streaming and streaming annotations when present, synthesize only from local tools |

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
