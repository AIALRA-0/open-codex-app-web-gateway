# Responses to Chat Completions Compatibility Matrix

Status: initial implementation, 2026-06-10.

Primary sources:

- OpenAI migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Responses reference: https://developers.openai.com/api/reference/responses/overview
- OpenAI Responses streaming events: https://developers.openai.com/api/reference/resources/responses/streaming-events
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI shell tool guide: https://developers.openai.com/api/docs/guides/tools-shell
- OpenAI file search guide: https://developers.openai.com/api/docs/guides/tools-file-search
- OpenAI Containers reference: https://platform.openai.com/docs/api-reference/containers
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
| `input_file` | explicit text marker | Lossy until a file extraction layer is added |
| prior `message` output item | assistant chat message | Direct |
| `function_call` item | assistant `tool_calls[]` | Direct |
| `function_call_output` item | `role:"tool"` message with `tool_call_id` | Direct |
| `reasoning` item | assistant `reasoning_content` replay | DeepSeek-specific compatibility |
| `previous_response_id` | local replay store | Emulated locally |
| `background:true` | local async Chat completion plus local response store | Emulated locally; forces `store:true` and non-streaming upstream execution |
| `tools[type=function]` | chat function tools | Direct |
| `tools[type=web_search_preview]` | local search adapter plus injected Chat context | Emulated locally; emits `web_search_call` and `url_citation` annotations |
| `tools[type=file_search]` | local vector-store search plus injected Chat context | Emulated locally; emits `file_search_call`, optional results, and `file_citation` annotations |
| `tool_resources.file_search.vector_store_ids` | local vector-store lookup targets | Emulated locally when the tool omits `vector_store_ids` |
| `tools[type=shell]` | local container command execution plus injected Chat context | Emulated locally for explicit `Execute:` prompts and shell code blocks; emits `shell_call` and `shell_call_output` |
| `tools[type=code_interpreter]` | local shell/container adapter | Compatibility alias; explicit Python code blocks are executed through `python3` in the local container workspace |
| other hosted tools | compatibility system notice | Requires local hosted-tool executors |
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
| local background job state | `background`, `status`, `completed_at`, `error` | Emulated for `in_progress`, `completed`, `failed`, and `cancelled` |
| local web search context | output `web_search_call` plus `output_text.annotations[].url_citation` | Emulated for non-streaming, streaming, and background Responses |
| local file search context | output `file_search_call` plus `output_text.annotations[].file_citation` | Emulated for non-streaming, streaming, and background Responses |
| local shell context | output `shell_call` plus `shell_call_output` | Emulated for non-streaming, streaming, and background Responses when an explicit command is found |

## Responses Endpoint Coverage

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/responses` | Implemented | Translates to upstream Chat Completions and stores replay state unless `store:false`; `background:true` returns `in_progress` immediately and completes asynchronously through local storage |
| `GET /v1/responses/{response_id}` | Implemented | Returns the locally stored Responses object |
| `DELETE /v1/responses/{response_id}` | Implemented | Deletes the local replay record, aborting an in-process background job when present, and returns a deletion marker |
| `GET /v1/responses/{response_id}/input_items` | Implemented | Returns locally stored input items with `limit`, `after`, `before`, and `order` pagination |
| `POST /v1/responses/{response_id}/cancel` | Implemented for local `in_progress` background responses; compatibility no-op for terminal records | In-process background jobs are aborted and marked `cancelled`; completed records are returned unchanged with metadata explaining the no-op |
| `POST /v1/responses/compact` | Implemented via local encrypted summary | Uses upstream Chat Completions to summarize conversation state, returns `response.compaction`, and encrypts local compaction content with an AES-GCM key stored outside Git |
| `POST /v1/responses/input_tokens` | Implemented via upstream usage probe | Translates the request to Chat Completions, forces non-streaming `max_tokens:1`, disables upstream storage, and returns `usage.prompt_tokens` as `input_tokens` |

## Chat Completions Endpoint Coverage

OpenAI's current endpoint list includes `POST /v1/chat/completions`,
`GET /v1/chat/completions/{completion_id}`, and
`GET /v1/chat/completions/{completion_id}/messages`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | Implemented | Proxies to upstream Chat Completions with bridge-safe response headers |
| `GET /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Returns a locally stored upstream Chat completion object |
| `GET /v1/chat/completions/{completion_id}/messages` | Implemented for local `store:true` records | Returns request messages plus assistant choice messages with `limit`, `after`, `before`, and `order` pagination |

The bridge stores Chat completions only when the incoming Chat request sets
`store:true`. This matches the stored-completion lifecycle intent and avoids
unbounded state growth for ordinary passthrough Chat traffic.

## Models Endpoint Coverage

OpenAI's current endpoint list includes `GET /v1/models` and
`GET /v1/models/{model}`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/models` | Implemented | Proxies upstream when available, otherwise returns the configured default bridge model |
| `GET /v1/models/{model}` | Implemented | Proxies upstream single-model retrieval when supported; otherwise searches upstream model list, then falls back to the configured default model only when the requested ID matches it |

## Files and Vector Stores Endpoint Coverage

These endpoints back the local `file_search` adapter. File content is stored
under the configured bridge state directory, not in Git.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/files` | Implemented | Accepts JSON `{filename,purpose,content,metadata}`, basic multipart upload, or raw body with `x-filename`; stores text content locally |
| `GET /v1/files` | Implemented | Lists local files with `purpose`, `limit`, `after`, `before`, and `order` pagination |
| `GET /v1/files/{file_id}` | Implemented | Returns local file metadata |
| `GET /v1/files/{file_id}/content` | Implemented | Returns stored text content |
| `DELETE /v1/files/{file_id}` | Implemented | Deletes the file and detaches it from all local vector stores |
| `POST /v1/vector_stores` | Implemented | Creates a local vector-store record with `file_counts` and metadata |
| `GET /v1/vector_stores` | Implemented | Lists local vector stores with pagination |
| `GET /v1/vector_stores/{vector_store_id}` | Implemented | Returns local vector-store metadata and live file counts |
| `DELETE /v1/vector_stores/{vector_store_id}` | Implemented | Deletes the local vector store and its file attachments |
| `POST /v1/vector_stores/{vector_store_id}/files` | Implemented | Attaches an uploaded file; supports per-file `attributes` for filtering |
| `GET /v1/vector_stores/{vector_store_id}/files` | Implemented | Lists attached files with pagination |
| `GET /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Returns local vector-store file metadata |
| `DELETE /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Detaches a file from the vector store |
| `POST /v1/vector_stores/{vector_store_id}/search` | Implemented | Lexical chunk search with `query`, `max_num_results`, and simple metadata `filters` |

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
When `web_search_preview` is handled by the local adapter, the bridge emits a
`web_search_call` output item and applies URL citation annotations to the final
message content.
When `file_search` is handled by the local adapter, the bridge emits a
`file_search_call` output item before Chat text deltas and applies file citation
annotations to the final message content.
When `shell` is handled by the local adapter, the bridge emits completed
`shell_call` and `shell_call_output` items before Chat text deltas.

## Local Web Search Adapter

The bridge can emulate the Responses `web_search_preview` hosted tool for
Chat-only providers. It runs a configured local search provider, injects the
results into the Chat prompt as source material, and then maps the final
Responses output to the OpenAI-style shape documented for web search:
`web_search_call` plus `url_citation` annotations.

Current providers:

| Provider | Status | Notes |
| --- | --- | --- |
| `wikipedia` | Default no-key fallback | Uses the public MediaWiki search API. This is stable and secret-free, but it is not a full web index. |
| `static` | Implemented for tests/controlled evals | Reads JSON results from configuration. |
| `disabled` | Implemented | Leaves web search as an unsupported hosted tool with a compatibility notice. |

This is a bridge compatibility layer, not native OpenAI web search. Full parity
still requires a production-grade web index/provider, citation policy, and page
open/find support.

## Local File Search Adapter

The bridge can emulate the Responses `file_search` hosted tool for Chat-only
providers by keeping a local Files/Vector Stores state tree and running bounded
lexical search over uploaded text. The adapter:

- reserves `file_search` so it is not forwarded as an unsupported Chat tool;
- searches `vector_store_ids` from the tool or `tool_resources.file_search`;
- injects retrieved chunks into the upstream Chat prompt as source material;
- emits `file_search_call` output items with queries, vector store IDs, and
  optional results when `include:["file_search_call.results"]` is requested;
- annotates final message text with `file_citation` entries;
- supports simple metadata filters such as `{type:"eq",key:"suite",value:"x"}`
  over file metadata and vector-store-file attributes.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_FILE_SEARCH_PROVIDER` | `local` | Use `disabled` to leave `file_search` as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_FILE_SEARCH_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-file-search` | Local file/vector-store state path; keep outside Git |
| `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS` | `5` | Maximum retrieved chunks injected into Chat context |
| `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | `4194304` | Upload size limit for local text files |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH` | `true` | Disables DeepSeek thinking mode for local file-search requests to avoid reasoning-only completions exhausting small output budgets |

This is a bridge compatibility layer, not native OpenAI file search. The current
retriever is intentionally local, auditable, and disk-bounded; it is not yet an
embedding-based vector index and does not process binary PDFs, OCR, image files,
asynchronous batch indexing, or OpenAI's complete ranking behavior.

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
- maps `/mnt/data` in commands to the local container workspace;
- emits paired `shell_call` and `shell_call_output` output items;
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

This is a bridge compatibility layer, not OpenAI hosted shell or a Docker/VM
sandbox. It uses a local workspace, command timeouts, limited environment
variables, output caps, and audit metadata, but it does not yet provide kernel,
network, or filesystem isolation from the host. Full parity requires a hardened
container runtime, network allowlist enforcement, domain secret sidecars,
interactive service policies, and stronger artifact lifecycle controls.

## Known Gaps

| Capability | Why it is not fully native yet | Planned path |
| --- | --- | --- |
| OpenAI hosted `web_search` full parity | The local adapter can search and cite, but the default no-key provider is Wikipedia-only and does not support OpenAI page open/find actions | Add production web-search provider support, page open/find actions, and stronger citation ranking |
| OpenAI hosted `file_search` full parity | The local adapter covers API shape, text upload, vector-store lifecycle, lexical retrieval, simple filters, and citations, but it is not OpenAI's managed vector search | Add embedding/vector indexing, file parsers, async batches, expiration policy, richer filters, reranking, and larger eval sets |
| OpenAI hosted `shell` / `code_interpreter` full parity | The local adapter covers explicit command execution, container lifecycle shape, output items, and artifacts, but it is not a hardened hosted container runtime | Add Docker/Firecracker isolation, network allowlists, domain secrets, service support, richer command negotiation, and lifecycle garbage collection |
| `computer_use` | Requires computer-use action loop | Add explicit local tool bridge if Codex exposes this over Responses |
| `image_generation` | Requires image API/provider adapter | Add provider-specific image tool |
| `Conversations API` | Separate OpenAI object model | Emulate only if Codex requires it |
| Native OpenAI compaction portability | Local compaction can be decrypted only by this bridge deployment/key; it is not OpenAI ZDR encrypted content | Keep key outside Git, document the boundary, and add optional key rotation/export policy |
| Background durability after process restart | Local background jobs are in-process while the response record is file-backed | Add a persisted job queue if Codex relies on long-running background tasks across bridge restarts |
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
