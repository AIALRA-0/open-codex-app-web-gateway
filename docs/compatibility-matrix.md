# Responses to Chat Completions Compatibility Matrix

Status: initial implementation, 2026-06-10.

Primary sources:

- OpenAI migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI Responses reference: https://developers.openai.com/api/reference/responses/overview
- OpenAI Responses create reference: https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI Responses input-token count reference: https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count
- OpenAI Responses compact reference: https://developers.openai.com/api/reference/resources/responses/methods/compact
- OpenAI Responses streaming events: https://developers.openai.com/api/reference/resources/responses/streaming-events
- OpenAI official OpenAPI schema: https://github.com/openai/openai-openapi/blob/master/openapi.yaml
- OpenAI encrypted reasoning guidance: https://developers.openai.com/api/docs/guides/migrate-to-responses#4-decide-when-to-use-statefulness
- OpenAI reasoning effort guide: https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort
- OpenAI conversation state guide: https://developers.openai.com/api/docs/guides/conversation-state
- OpenAI Conversations reference: https://developers.openai.com/api/docs/api-reference/conversations/create
- OpenAI Assistants deep dive run lifecycle: https://developers.openai.com/api/docs/assistants/deep-dive#runs-and-run-steps
- OpenAI Assistants image input content: https://developers.openai.com/api/docs/assistants/deep-dive#creating-image-input-content
- OpenAI Assistants file search guide: https://developers.openai.com/api/docs/assistants/tools/file-search
- OpenAI Assistants OpenAPI operation `createAssistant`: https://api.openai.com/v1/assistants
- OpenAI Threads OpenAPI operation `createThread`: https://api.openai.com/v1/threads
- OpenAI Threads OpenAPI operation `createRun`: https://api.openai.com/v1/threads/{thread_id}/runs
- OpenAI Threads OpenAPI operation `createThreadAndRun`: https://api.openai.com/v1/threads/runs
- OpenAI Chat Completions reference: https://developers.openai.com/api/reference/chat/create
- OpenAI ChatKit session OpenAPI operation `CreateChatSessionMethod`: https://api.openai.com/v1/chatkit/sessions
- OpenAI ChatKit threads OpenAPI operation `ListThreadsMethod`: https://api.openai.com/v1/chatkit/threads
- OpenAI Realtime overview: https://developers.openai.com/api/docs/guides/realtime
- OpenAI Realtime session OpenAPI operation `create-realtime-session`: https://api.openai.com/v1/realtime/sessions
- OpenAI Realtime client secret OpenAPI operation `create-realtime-client-secret`: https://api.openai.com/v1/realtime/client_secrets
- OpenAI Realtime transcription session OpenAPI operation `create-realtime-transcription-session`: https://api.openai.com/v1/realtime/transcription_sessions
- OpenAI Realtime WebRTC call OpenAPI operation `create-realtime-call`: https://api.openai.com/v1/realtime/calls
- OpenAI Realtime SIP guide: https://developers.openai.com/api/docs/guides/realtime-sip#overview
- OpenAI audio guide: https://developers.openai.com/api/docs/guides/audio
- OpenAI legacy Completions OpenAPI operation `createCompletion`: https://api.openai.com/v1/completions
- OpenAI Embeddings OpenAPI operation `createEmbedding`: https://api.openai.com/v1/embeddings
- OpenAI Moderations OpenAPI operation `createModeration`: https://api.openai.com/v1/moderations
- OpenAI Batch OpenAPI operation `createBatch`: https://api.openai.com/v1/batches
- OpenAI Batch guide: https://developers.openai.com/api/docs/guides/batch
- OpenAI Evals guide: https://developers.openai.com/api/docs/guides/evals
- OpenAI Evals OpenAPI operation `createEval`: https://api.openai.com/v1/evals
- OpenAI Evals create reference: https://developers.openai.com/api/reference/resources/evals/methods/create
- OpenAI Graders guide: https://developers.openai.com/api/docs/guides/graders
- OpenAI Graders OpenAPI operation `validateGrader`: https://api.openai.com/v1/fine_tuning/alpha/graders/validate
- OpenAI Graders OpenAPI operation `runGrader`: https://api.openai.com/v1/fine_tuning/alpha/graders/run
- OpenAI Fine-tuning Jobs OpenAPI operation `createFineTuningJob`: https://api.openai.com/v1/fine_tuning/jobs
- OpenAI Fine-tuning Jobs OpenAPI operation `retrieveFineTuningJob`: https://api.openai.com/v1/fine_tuning/jobs/{fine_tuning_job_id}
- OpenAI Fine-tuning Jobs OpenAPI operation `listFineTuningEvents`: https://api.openai.com/v1/fine_tuning/jobs/{fine_tuning_job_id}/events
- OpenAI Fine-tuning Jobs OpenAPI operation `listFineTuningJobCheckpoints`: https://api.openai.com/v1/fine_tuning/jobs/{fine_tuning_job_id}/checkpoints
- OpenAI Fine-tuning checkpoint permissions OpenAPI operation `createFineTuningCheckpointPermission`: https://api.openai.com/v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions
- OpenAI Organization costs OpenAPI operation `usage-costs`: https://api.openai.com/v1/organization/costs
- OpenAI Organization completions usage OpenAPI operation `usage-completions`: https://api.openai.com/v1/organization/usage/completions
- OpenAI Organization images usage OpenAPI operation `usage-images`: https://api.openai.com/v1/organization/usage/images
- OpenAI Organization file-search usage OpenAPI operation `usage-file-search-calls`: https://api.openai.com/v1/organization/usage/file_search_calls
- OpenAI Organization web-search usage OpenAPI operation `usage-web-search-calls`: https://api.openai.com/v1/organization/usage/web_search_calls
- OpenAI Organization code-interpreter usage OpenAPI operation `usage-code-interpreter-sessions`: https://api.openai.com/v1/organization/usage/code_interpreter_sessions
- OpenAI Organization vector-store usage OpenAPI operation `usage-vector-stores`: https://api.openai.com/v1/organization/usage/vector_stores
- OpenAI Organization users OpenAPI operation `list-users`: https://api.openai.com/v1/organization/users
- OpenAI Organization invites OpenAPI operation `list-invites`: https://api.openai.com/v1/organization/invites
- OpenAI Organization admin API keys OpenAPI operation `admin-api-keys-list`: https://api.openai.com/v1/organization/admin_api_keys
- OpenAI Organization projects OpenAPI operation `admin-api-keys-list-projects`: https://api.openai.com/v1/organization/projects
- OpenAI Organization project OpenAPI operation `admin-api-keys-retrieve-project`: https://api.openai.com/v1/organization/projects/{project_id}
- OpenAI Organization project archive OpenAPI operation `admin-api-keys-archive-project`: https://api.openai.com/v1/organization/projects/{project_id}/archive
- OpenAI Organization project API keys OpenAPI operation `admin-api-keys-list-project-api-keys`: https://api.openai.com/v1/organization/projects/{project_id}/api_keys
- OpenAI Organization project service accounts OpenAPI operation `admin-api-keys-list-project-service-accounts`: https://api.openai.com/v1/organization/projects/{project_id}/service_accounts
- OpenAI Organization project groups endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/groups
- OpenAI Organization spend alerts OpenAPI operation `list-organization-spend-alerts`: https://api.openai.com/v1/organization/spend_alerts
- OpenAI Organization project spend alerts endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/spend_alerts
- OpenAI Organization certificates OpenAPI operation `listOrganizationCertificates`: https://api.openai.com/v1/organization/certificates
- OpenAI Organization certificate activation operation `activateOrganizationCertificates`: https://api.openai.com/v1/organization/certificates/activate
- OpenAI Organization project certificates endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/certificates
- OpenAI Organization data retention OpenAPI operation `retrieve-organization-data-retention`: https://api.openai.com/v1/organization/data_retention
- OpenAI Organization project data retention endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/data_retention
- OpenAI Organization project model permissions endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/model_permissions
- OpenAI Organization project hosted tool permissions endpoint family: https://api.openai.com/v1/organization/projects/{project_id}/hosted_tool_permissions
- OpenAI Organization roles OpenAPI operation `list-roles`: https://api.openai.com/v1/organization/roles
- OpenAI project roles endpoint family: https://api.openai.com/v1/projects/{project_id}/roles
- OpenAI project user/group role assignment endpoint family: https://api.openai.com/v1/projects/{project_id}/users/{user_id}/roles
- OpenAI project group role assignment endpoint family: https://api.openai.com/v1/projects/{project_id}/groups/{group_id}/roles
- OpenAI Organization groups OpenAPI operation `list-groups`: https://api.openai.com/v1/organization/groups
- OpenAI Organization audit logs OpenAPI operation `list-audit-logs`: https://api.openai.com/v1/organization/audit_logs
- OpenAI RBAC permissions guide: https://developers.openai.com/api/docs/guides/rbac#permissions
- OpenAI Admin APIs guide: https://developers.openai.com/api/docs/guides/admin-apis
- OpenAI Node SDK generated organization users resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/users/users.ts
- OpenAI Node SDK generated organization invites resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/invites.ts
- OpenAI Node SDK generated organization roles resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/roles.ts
- OpenAI Node SDK generated organization groups resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/groups/groups.ts
- OpenAI Node SDK generated organization group users resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/groups/users.ts
- OpenAI Node SDK generated organization group roles resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/groups/roles.ts
- OpenAI Node SDK generated organization user roles resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/users/roles.ts
- OpenAI Node SDK generated organization admin API keys resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/admin-api-keys.ts
- OpenAI Node SDK generated organization certificates resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/certificates.ts
- OpenAI Node SDK generated organization project certificates resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/certificates.ts
- OpenAI Node SDK generated organization audit logs resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/audit-logs.ts
- OpenAI Node SDK generated project groups resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/groups/groups.ts
- OpenAI Node SDK generated project users resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/users/users.ts
- OpenAI Node SDK generated project rate-limits resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/rate-limits.ts
- OpenAI Node SDK generated organization spend alerts resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/spend-alerts.ts
- OpenAI Node SDK generated project spend alerts resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/spend-alerts.ts
- OpenAI Node SDK generated organization data retention resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/data-retention.ts
- OpenAI Node SDK generated project data retention resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/data-retention.ts
- OpenAI Node SDK generated project model permissions resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/model-permissions.ts
- OpenAI Node SDK generated project hosted tool permissions resource: https://github.com/openai/openai-node/blob/main/src/resources/admin/organization/projects/hosted-tool-permissions.ts
- OpenAI Audio speech OpenAPI operation `createSpeech`: https://api.openai.com/v1/audio/speech
- OpenAI Audio transcription OpenAPI operation `createTranscription`: https://api.openai.com/v1/audio/transcriptions
- OpenAI Audio translation OpenAPI operation `createTranslation`: https://api.openai.com/v1/audio/translations
- OpenAI custom voices guide: https://developers.openai.com/api/docs/guides/text-to-speech#creating-a-voice
- OpenAI Audio voice consent OpenAPI operation `createVoiceConsent`: https://api.openai.com/v1/audio/voice_consents
- OpenAI Audio voice OpenAPI operation `createVoice`: https://api.openai.com/v1/audio/voices
- OpenAI image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Images variation OpenAPI operation `createImageVariation`: https://api.openai.com/v1/images/variations
- OpenAI Videos edit OpenAPI operation `CreateVideoEdit`: https://api.openai.com/v1/videos/edits
- OpenAI Videos extend OpenAPI operation `CreateVideoExtend`: https://api.openai.com/v1/videos/extensions
- OpenAI function calling guide: https://developers.openai.com/api/docs/guides/function-calling
- OpenAI tool search guide: https://developers.openai.com/api/docs/guides/tools-tool-search
- OpenAI file inputs guide: https://developers.openai.com/api/docs/guides/file-inputs
- OpenAI shell tool guide: https://developers.openai.com/api/docs/guides/tools-shell
- OpenAI Skills guide: https://developers.openai.com/api/docs/guides/tools-skills
- OpenAI file search guide: https://developers.openai.com/api/docs/guides/tools-file-search
- OpenAI computer use guide: https://developers.openai.com/api/docs/guides/tools-computer-use
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
and typed Responses SSE events. It also exposes compatibility surfaces for
Chat Completions passthrough and legacy text Completions so older OpenAI SDK
paths and evaluation harnesses can target the same deployment.

This gives strong compatibility for Codex's normal agent loop. It cannot make a
chat-only provider truly support hosted OpenAI tools without adding local
implementations for those tools.

## Request Mapping

Public body-only create endpoints reject unsupported query parameters before
body parsing or any provider call: `POST /v1/responses`,
`POST /v1/responses/input_tokens`, `POST /v1/responses/compact`, direct
`POST /v1/chat/completions`, and legacy `POST /v1/completions`. They then
validate required OpenAI request fields before any provider call:
`POST /v1/responses` requires a non-empty string `model`, direct
`POST /v1/chat/completions` requires a non-empty string `model` plus the
validated non-empty `messages` array, and legacy `POST /v1/completions`
requires a non-empty string `model` plus a present `prompt` field. These checks
prevent the bridge's internal default model from hiding malformed public SDK
requests. Official list/retrieve routes that do define query parameters, such
as `GET /v1/chat/completions`, retain their documented query handling.

| Responses field | Chat Completions field | Status |
| --- | --- | --- |
| `model` | `model` | Direct after required string request validation on public Responses, direct Chat, and legacy Completions create calls |
| `instructions` | leading `system` message | Direct for DeepSeek/OpenAI-compatible providers after Responses create, `/input_tokens`, and `/compact` validate the field as a string/null before provider calls |
| string `input` | `messages: [{role:"user"}]` | Direct |
| input message item | chat message | Direct after pre-provider schema validation. Responses create, `/input_tokens`, and `/compact` accept EasyInputMessage-style objects with `role:"user"|"assistant"|"system"|"developer"` and string or array content, validate optional `status` and Codex `phase:"commentary"|"final_answer"`, reject unsupported `role:"tool"` message envelopes before they can be silently normalized, and validate known content parts before upstream Chat calls |
| `input_text` / `text` / `summary_text` / `reasoning_text` message parts | chat text content part | Direct after validating string `text` |
| `input_image` | chat `image_url` content part or text marker | Provider-dependent after pre-provider schema validation. URL and base64 data-URL inputs are forwarded as Chat `image_url.url` when `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE=vision`; Responses create, `/input_tokens`, and `/compact` validate `detail` as `auto`, `low`, `high`, or `original`, require known source fields such as `image_url`, `file_id`, `file_data`, `data`, `image_data`, `url`, and nested `image_file` fields to have string/null/object shapes before provider calls, and reject malformed official `image_url` / `image_url.url` URI strings. Chat image inputs only support `auto`/`low`/`high`, so Responses `detail:"original"` is mapped to Chat `detail:"high"` for vision-capable providers and recorded in `metadata.compatibility.chat_image_inputs`; text-only providers preserve the original detail in explicit `[image:...]` markers without embedding data URLs. Compatible inline `file_data` / `data` image payloads are converted to `data:<media_type>;base64,...` for vision-capable providers. Local Files API `file_id` image inputs are resolved to bounded data URLs before upstream Chat calls and recorded in `metadata.compatibility.local_input_images` without storing the base64 payload in metadata |
| `input_audio` | chat `input_audio` content part or text marker | Provider-dependent after pre-provider schema validation. Official Responses `type:"input_audio"` content parts require `input_audio:{data,format}` with `format` set to `wav` or `mp3`, matching Chat audio parts; the bridge's local `type:"audio"` alias still accepts top-level `data`, `audio_data`, `file_data`, or `content_base64` and requires one of those data fields. Audio-capable Chat providers receive native `input_audio:{data,format}` parts when `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE=audio`; text-only providers such as DeepSeek default to explicit `[audio:format:hint]` markers with any transcript and do not embed base64 audio bytes in the upstream prompt. Responses and direct Chat passthrough record `metadata.compatibility.chat_audio_inputs` / `metadata.compatibility.chat_passthrough.chat_audio_inputs` when this mapping is exercised |
| `input_file` / compatible Chat `file` parts | local extraction context plus explicit text marker | Emulated for local Files API `file_id`, completed Uploads API files, inline base64 `file_data`, and HTTP(S) `file_url` when text can be extracted; Responses create, `/input_tokens`, and `/compact` validate official `input_file.detail` as `low` or `high`, require known source fields such as `file_id`, `filename`, `file_data`, and `file_url` plus bridge aliases to be strings when present before provider calls, and reject malformed official `file_url` URI strings. PDFs use local Poppler `pdftotext` when enabled and can fall back to bounded local `pdftoppm` + `tesseract` OCR when the text layer is empty; `.docx`, `.xlsx`, and `.pptx` OOXML files are extracted locally from ZIP/XML content. Direct Chat passthrough uses `CODEXCOMPAT_CHAT_FILE_INPUT_MODE`: file-capable providers may receive native file parts, while text-only providers such as DeepSeek receive safe `[file:...]` markers plus extracted local context and record `metadata.compatibility.chat_passthrough.chat_file_inputs` / `local_input_files` |
| prior `message` output item | assistant chat message | Direct after pre-provider schema validation. Assistant replay messages accept string content or output content parts such as `output_text` and `refusal`, validate `output_text.text`, `annotations`, `logprobs`, refusal text, optional `status`, and Codex `phase`, and map `summary_text` / `reasoning_text` text plus `computer_screenshot` image evidence into Chat-compatible content |
| `function_call` item | assistant `tool_calls[]` | Direct after pre-provider schema validation. Responses create, `/input_tokens`, and `/compact` require a non-empty `call_id`, string `name`, JSON-string `arguments`, optional string/null `namespace`, and returned `status` values of `in_progress`, `completed`, or `incomplete` before the item is replayed as a Chat function `tool_calls[]` entry |
| `function_call_output` item | `role:"tool"` message with `tool_call_id` | Direct |
| `item_reference` input item | bounded `system` context marker | Emulated locally after pre-provider schema validation. Responses create, `/input_tokens`, and `/compact` require a non-empty `id` and replay the reference as a stable Chat-visible context marker instead of raw JSON fallback. Chat Completions has no native item-reference primitive, so full dereference still depends on separately replayed local `previous_response_id` / `conversation` context |
| `custom_tool_call` item | assistant Chat custom `tool_calls[]`, or assistant text replay for function-only providers | Provider-dependent. When `CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS=true`, the bridge replays official Responses `custom_tool_call` items as Chat `tool_calls:[{type:"custom",custom:{name,input}}]`; DeepSeek/function-only deployments use a bounded assistant text replay that preserves `call_id`, `namespace`, `name`, and `input` without sending unsupported native custom tool-call fields upstream |
| `custom_tool_call_output` item | Chat `role:"tool"` custom output, or user text replay for function-only providers | Provider-dependent. Official `custom_tool_call_output` and `function_call_output` input items are validated before provider calls: `call_id` must be non-empty, `output` must be a string or input text/image/file content array, and returned `status` values must be `in_progress`, `completed`, or `incomplete`. Custom outputs are replayed as native tool messages only for providers with custom-tool forwarding enabled; DeepSeek/function-only deployments receive explicit text context instead |
| `computer_call_output` item | Chat-visible computer evidence | Emulated locally after pre-provider schema validation. Returned computer-use output items require a non-empty `call_id`, object `output`, official `status` values when present, valid screenshot image detail, optional `image_url` string/object or `file_id`, and array/null `acknowledged_safety_checks` with string ids. Valid outputs are translated into bounded readable Chat context and stored input-item projections continue to hide `output.image_url` unless `include:["computer_call_output.output.image_url"]` is requested |
| official hosted/local tool result items | bounded `system` context messages | Emulated for Chat-only providers after local input schema validation. Prior `file_search_call`, `web_search_call`, `image_generation_call`, `code_interpreter_call`, `computer_call`, `shell_call`, `shell_call_output`, `local_shell_call`, `local_shell_call_output`, `apply_patch_call`, `apply_patch_call_output`, `mcp_list_tools`, `mcp_call`, `mcp_approval_request`, and `mcp_approval_response` input items validate known status enums, required file/web search ids and status values, official web-search action shapes, required code-interpreter `id`/`status`/`container_id`/`code`/`outputs`, shell replay `action.commands` / integer limits / local or container-reference environments / stdout-stderr-outcome chunks, required apply-patch ids and statuses, string/object/array field shapes, MCP required replay ids, MCP list-tools `error`, required tool `name`/`input_schema`, tool `annotations`, and MCP approval booleans before provider calls, then translate into readable "Prior Responses tool context" messages. The serializer preserves ids, call ids, status, key results, logs, command output, MCP approval/call fields, and bounded extras while summarizing image-generation base64 as `base64_image(<chars> chars)` instead of injecting raw payloads. Tool-search protocol items keep their specialized loading path, and MCP protocol items are skipped when the local MCP adapter is already importing them |
| `reasoning` item | assistant `reasoning_content` replay | DeepSeek-specific compatibility after pre-provider schema validation. Local `encrypted_content` values with prefix `ocrsn1.` are decoded in memory when replayed; malformed `status`, `encrypted_content`, `summary:[{type:"summary_text",text}]`, or `content:[{type:"reasoning_text",text}]` fields are rejected before upstream Chat calls |
| `compaction` item | compacted conversation context message | Emulated locally after pre-provider schema validation. Local `encrypted_content` values with prefix `occomp1.` are decoded in memory and injected as bounded compacted context; foreign or undecodable compacted content becomes an explicit compatibility context notice, while missing/non-string `encrypted_content` is rejected before provider calls |
| `tool_search_call` / `tool_search_output` input items | local loaded-tool context plus Chat function tools | Emulated locally after pre-provider schema validation. The bridge skips raw Chat text fallback for tool-search protocol items, validates `tool_search_call` status/execution/arguments and `tool_search_output` status/execution/tool definitions before provider calls, loads `tool_search_output.tools` into Chat function definitions even when the next request does not repeat `tools:[{type:"tool_search"}]`, and records `metadata.compatibility.local_tool_search` |
| `additional_tools` input item | local loaded-tool context plus Chat function tools | Emulated locally for function and namespace tool definitions after pre-provider schema validation. Chat providers receive the loaded tools as global function tools plus a compatibility prompt, and malformed `additional_tools.tools` entries are rejected before any upstream Chat request; exact Responses mid-input tool availability ordering is approximated because Chat Completions tool definitions are request-global |
| `prompt` template reference | local prompt-template expansion or compatibility system context | Emulated locally after Responses create validates the official object shape before provider calls: `id` must be a non-empty string, `version` must be a string/null, and `variables` must be a map of strings or `input_text` / `input_image` / `input_file` objects. Official `prompt:{id,version,variables}` references are expanded from `CODEXCOMPAT_PROMPT_TEMPLATES` / `CODEXCOMPAT_PROMPT_TEMPLATE_FILE` when available, using `{{variable}}` substitution; otherwise the bridge injects a bounded compatibility system message preserving the prompt id/version/variable keys and records `metadata.compatibility.prompt_template`. The older local `prompt` string id, `prompt_id` / `name` aliases, and inline `template` / `local_template` extensions remain accepted for migration fixtures |
| `previous_response_id` | local replay store | Emulated locally; validated as a string/null request field and rejected before provider calls when combined with `conversation` or the local `conversation_id` alias |
| `conversation` / `conversation_id` | local Conversations item replay plus persisted turn append | Emulated locally; `conversation` accepts an id string or `{id}` object, `conversation_id` is a local string alias, and invalid shapes are rejected before replay; supports durable conversation state even when a response sets `store:false` |
| `context_management` / `context` alias | local compatibility metadata | Recognizes the official Responses `context_management` array before provider calls: when present it must contain at least one entry, and entries must be objects with `type:"compaction"` and optional numeric `compact_threshold`. Chat Completions has no equivalent request field, so the bridge does not forward it upstream and records `metadata.compatibility.context_management` with entry counts, types, and threshold presence only; caller-provided threshold values are not copied into compatibility metadata. The older local `context` field remains accepted as a compatibility alias and records only value type/object keys |
| `truncation:"auto"` | local replay-message pruning before upstream Chat | Emulated with `CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS` as an estimated input-character budget after OpenAI request validation. The bridge validates `truncation` as `auto`, `disabled`, or null on Responses create, input-token probes, and the local compact compatibility path before provider calls. Valid `auto` drops oldest `conversation` / `previous_response_id` replay messages first and records `metadata.compatibility.local_truncation`; current request input and local tool context are preserved |
| `truncation:"disabled"` / omitted | local preflight error when over local budget | After the same `auto` / `disabled` / null validation, if the estimated Chat input exceeds `CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS`, the bridge returns `400 context_length_exceeded` before calling the provider; otherwise the Chat provider's native context handling applies |
| `background` | local async Chat completion plus local response store when `true` | Emulated locally after OpenAI request validation. Responses requests validate `background` as boolean/null before provider calls, so non-boolean values cannot accidentally start async work. Valid `true` forces `store:true` and non-streaming upstream execution; valid `false` remains on the normal synchronous path. If a caller also passes `stream:true`, the bridge records `metadata.compatibility.stream=disabled_for_background` and removes Chat `stream_options` before the upstream non-streaming provider call, recording `metadata.compatibility.stream_options.reason=background_stream_disabled`. The bridge persists background job snapshots, resumes safe `preparing` checkpoints and `provider_pending` jobs after restart, and marks unsafe or missing snapshots failed instead of leaving them stuck |
| `tools[type=function]` | chat function tools | Direct |
| `tools[type=tool_search]` + `defer_loading:true` functions / namespaces / MCP servers | local tool-search adapter plus generated Chat search function | Emulated locally for Chat-only providers after Responses create and `/input_tokens` validate tool-search fields before provider calls: `execution`, when present, must be `server` or `client`; `description` must be a string/null; and `parameters` must be an object/null. The bridge hides deferred function schemas and deferred MCP remote tool lists from the initial Chat request, exposes a generated `local_tool_search` function, maps model search calls to Responses `tool_search_call` and `tool_search_output` or `mcp_list_tools` items, injects the loaded function or MCP schemas into a follow-up Chat request, maps final function calls back to the original Responses name/`namespace` or remote MCP `tools/call`, supports non-streaming, streaming, and active background requests, and records `metadata.compatibility.local_tool_search`. Approval-required remote MCP tools loaded by hosted tool search emit `mcp_approval_request`; a later non-streaming or streaming request can approve the request with `previous_response_id` and reuse the prior `mcp_list_tools` context without repeating remote `tools/list`. `execution:"client"` returns a client `tool_search_call` without auto-loading tools; a later request can pass matching `tool_search_output.tools` in `input` without repeating the `tools` array. Same-request hosted `tool_search` plus remote MCP execution requires at least two local tool loop rounds so the bridge can run search, execute or request approval for the MCP call, and ask for the final answer |
| `tools[type=web_search]` / `web_search_2025_08_26` / `web_search_preview` / `web_search_preview_2025_03_11` | local search adapter plus injected Chat context | Emulated locally after Responses create and `/input_tokens` validate hosted-tool search fields before provider calls: `search_context_size` must be `low`, `medium`, or `high`; `user_location` must be null or `{type:"approximate", country?, region?, city?, timezone?}` with nullable string location fields; `filters.allowed_domains` must be null or an array of non-empty strings; and preview `search_content_types` must contain only `text` / `image`. The local adapter emits `web_search_call` search/open_page/find_in_page items using official action fields, including `find_in_page.pattern`, and `url_citation` annotations |
| `tools[type=file_search]` | local vector-store search plus injected Chat context | Emulated locally after Responses create and `/input_tokens` validate hosted-tool retrieval fields before provider calls: `vector_store_ids` must be a non-empty string array unless the local `tool_resources.file_search.vector_store_ids` fallback is supplied; `max_num_results` must be an integer from 1 through 50; `ranking_options` must be an object with known rankers, score thresholds from 0 through 1, and non-negative hybrid-search weights; and comparison/compound filters are checked recursively. Emits `file_search_call`, optional results, and `file_citation` annotations |
| `tool_resources.file_search.vector_store_ids` | local vector-store lookup targets | Local compatibility extension when the Responses `file_search` tool omits official `vector_store_ids`; when supplied it is validated as a non-empty string array before local hosted-tool execution |
| `tools[type=image_generation]` | local Responses image-generation adapter plus optional OpenAI-compatible Images API | Emulated locally after Responses create and `/input_tokens` validate image-generation tool fields before provider calls: `model` and `size` must be strings when present; `quality` must be `low`, `medium`, `high`, or `auto`; `output_format` must be `png`, `webp`, or `jpeg`; `output_compression` must be an integer from 0 through 100; `moderation` must be `auto` or `low`; `background` must be `transparent`, `opaque`, or `auto`; `input_fidelity` must be `high`, `low`, or null; `partial_images` must be an integer from 0 through 3; `action` must be `generate`, `edit`, or `auto`; and `input_image_mask` only accepts string `image_url` and `file_id` fields. Emits `image_generation_call` items and streaming `response.image_generation_call.partial_image` events when partial images are requested |
| `tools[type=local_shell]` | protocol placeholder / compatibility notice | Accepted as an official Responses tool envelope with type-only schema validation before provider calls. It is not executed by the local shell adapter yet; use `tools[type=shell]` for the current local container command compatibility path |
| `tools[type=shell]` | local container command execution plus injected Chat context | Emulated locally for explicit `Execute:` prompts and shell code blocks; emits `shell_call` and `shell_call_output`; `environment` is validated before provider calls as `container_auto`, `container_reference`, or `local`; `container_auto.file_ids` are mounted from the local Files API; local `skill_reference` entries from `POST /v1/containers` `skills` and `tools[].environment.skills` are mounted into the local container workspace |
| `tools[type=apply_patch]` | protocol placeholder / compatibility notice | Accepted as an official Responses tool envelope with type-only schema validation before provider calls. It is reserved for future Codex patch-tool orchestration and is not executed locally by this bridge yet |
| `tools[type=code_interpreter]` | local container Python execution plus injected Chat context | Emulated locally for explicit Python code blocks; `container` is required before provider calls and accepts official `{type:"auto"}` or a non-empty string; the bridge also accepts `{type:"container_reference",container_id}` as a local extension for existing local container reuse; `container.file_ids` are mounted from the local Files API; emits `code_interpreter_call` and executes the block through `python3` in the local container workspace |
| `tools[type=computer]` | local computer action-loop adapter plus injected Chat context and action proxy | Emulated locally after Responses create and `/input_tokens` validate optional local display metadata before provider calls: `environment`, when present, must be one of `windows`, `mac`, `linux`, `ubuntu`, or `browser`; `display_width` and `display_height`, when present, must be positive integers. Valid GA requests may still use only `{type:"computer"}`. Emits a `computer_call` with GA `actions[]` and preview-compatible `action`, accepts returned `computer_call_output` items as Chat context, exposes a generated Chat function tool for the next model-requested Computer Use action on follow-up turns, maps that action back to `computer_call`, and preserves loop/audit metadata |
| `tools[type=computer_use_preview]` | local computer action-loop adapter | Compatibility alias for the deprecated preview tool name. The bridge preserves the legacy preview request shape and rejects malformed preview tools before provider calls: `environment` is required and must be `windows`, `mac`, `linux`, `ubuntu`, or `browser`; `display_width` and `display_height` are required positive integers |
| `tools[type=mcp]` | local MCP protocol-context adapter plus injected Chat context and non-streaming/streaming/background remote call/approval proxy | Emulated locally after Responses create and `/input_tokens` validate MCP tool fields before provider calls: `server_label` is required as a string; one of `server_url` or `connector_id` is required; `server_url` must be a valid URI string when present; `connector_id` must be one of the official connector ids; `authorization` and `server_description` must be strings when present; `headers` must be null or an object with string values; `allowed_tools` must be null, a string array, or an MCP filter object with only `tool_names` string array and/or `read_only` boolean; `require_approval` must be null, `always`, `never`, or an object containing only `always` / `never` MCP filters; and `defer_loading` must be boolean when present. The local adapter emits `mcp_list_tools`, imports explicit/allowed tool definitions, can fetch remote server `tools/list` over Streamable HTTP-style JSON-RPC with JSON or SSE responses, exposes imported remote MCP tools to upstream Chat as function tools on non-streaming, streaming, and active background requests, maps exact MCP `tool_choice` names onto generated Chat function names when uniquely resolvable, maps auto-approved returned Chat tool calls to remote MCP `tools/call`, maps approval-required returned Chat tool calls to `mcp_approval_request`, consumes later `mcp_approval_response` items to execute approved remote calls, emits `mcp_call`, preserves caller-supplied MCP input context items including `mcp_list_tools` replayed from `previous_response_id`, redacts `authorization` from responses and background snapshots, and records `metadata.compatibility.local_mcp`. Hosted connector calls and restart-resumable per-request connector credentials remain future work |
| other hosted tools | compatibility system notice | Requires local hosted-tool executors |
| Responses `tools` / `tool_choice` | Chat `tools` / `tool_choice`, local hosted-tool adapters, or compatibility notices | Responses create and `/input_tokens` validate the official native tool envelope before provider calls: `tools` must be an array/null of typed tool objects, function tool names must be 1-128 letters/numbers/underscores/dashes, custom tool names must be strings, function `parameters` must be an object/null when present, `strict` must be boolean/null when present, Responses custom tool `format` accepts official `text` and flat `grammar` shapes (`{type:"grammar",definition,syntax}`), MCP and tool-search tool fields are checked before adapter execution, type-only `local_shell` / `apply_patch` tool definitions reject extra fields, hosted-tool `tool_choice` selectors such as `file_search`, `web_search_preview`, `computer`, `image_generation`, `code_interpreter`, local `tool_search`, `apply_patch`, and `shell` reject fields other than `type`, namespaces contain non-empty function/custom tool lists, local `file_search` / `web_search*` / `image_generation` hosted-tool schema fields and Computer Use preview display fields are checked before adapter execution, and `tool_choice` must be `none`, `auto`, `required`, `allowed_tools`, a hosted-tool selector, or a valid named function/custom/MCP selector. Responses `allowed_tools` validates each selector's `type` plus function/custom/MCP names before provider calls, then maps selectors from the Responses `{type:"allowed_tools",mode,tools}` shape into Chat's nested `{type:"allowed_tools",allowed_tools:{mode,tools}}` shape. Function tools map to Chat function tools; custom tools map to Chat custom tools for providers with `CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS=true`, converting Responses flat grammar formats into Chat's nested `format.grammar` shape. Function names longer than Chat's 64-character limit are translated to deterministic Chat-safe aliases and remapped back to the original Responses name in non-streaming, streaming, background output, and allowed-tools selectors. Local hosted tools are reserved for bridge execution; unsupported hosted/custom tools become compatibility notices. DeepSeek defaults to filtering custom tools, using `thinking:{type:"disabled"}` on Responses translation and direct Chat passthrough when tool choice is present unless overridden |
| `max_tool_calls` | local hosted-tool call budget | Emulated for local `web_search`, `file_search`, `shell`, `code_interpreter`, `computer`, `mcp`, and `tool_search` adapters. The shared budget is consumed before each local built-in tool call/action, non-deferred local MCP list-tools item, local `tool_search_call`, or executed remote MCP `mcp_call`; deferred MCP servers that wait for hosted `tool_search` do not spend a list-tools budget slot during request preparation. Skipped calls are recorded in `metadata.compatibility.local_tool_budget` and the tool-specific compatibility block. Non-number JSON values such as strings or booleans are rejected instead of being coerced |
| `text.format.type=text` | omitted/default or Chat `response_format:{type:"text"}` | Direct after OpenAI request validation. Responses create and `/input_tokens` `text.format`, plus direct Chat `response_format`, must be objects whose `type` is one of `text`, `json_object`, or `json_schema` before provider calls |
| `text.format.type=json_object` | `response_format: {type:"json_object"}` plus a local JSON instruction when needed | Provider-dependent after OpenAI request validation; DeepSeek requires a prompt-level JSON instruction, so the bridge injects one when the caller did not already include it |
| `text.format.type=json_schema` | `response_format.json_schema`, or DeepSeek default `json_object` plus schema instruction | Provider-dependent after OpenAI request validation. Responses `text.format` validates the official flat `name` / `schema` / optional string-only `description` / optional boolean-or-null `strict` shape; direct Chat validates the nested `response_format.json_schema` shape, including string-only `description`, before provider calls. DeepSeek-compatible mode downgrades to JSON mode, injects the JSON Schema as model-visible instructions, and records the downgrade in compatibility metadata |
| `max_output_tokens` | `max_tokens` | Configurable via `CODEXCOMPAT_MAX_TOKENS_FIELD` after OpenAI request validation. Responses create and local `/v1/responses/input_tokens` reject non-integer values and values below the official minimum of 16 before provider calls |
| `max_completion_tokens` | configured max token field | Chat-native alias accepted on `/v1/responses` and direct `/v1/chat/completions` after integer/null request validation; `max_output_tokens` takes precedence on Responses requests, and conflicts are recorded in compatibility metadata |
| `max_tokens` | configured max token field | Legacy Chat-native alias accepted on `/v1/responses` and direct `/v1/chat/completions` after integer/null request validation; legacy `/v1/completions` validates `max_tokens` as an integer greater than or equal to 0 before prompt-to-Chat mapping. `max_output_tokens` takes precedence on Responses requests, then `max_completion_tokens`, and conflicts are recorded in compatibility metadata |
| `temperature`, `top_p`, penalties, `stop`, `seed`, `user` | same-name fields | Provider-dependent after OpenAI request validation. The bridge validates user-supplied Responses, direct Chat, and legacy Completions `temperature` as a number from 0 through 2, `top_p` as a number from 0 through 1, Chat-native/legacy `frequency_penalty` / `presence_penalty` aliases as numbers from -2 through 2, and `stop` as a string or an array of 1 to 4 strings before provider calls. It also validates Chat-native/legacy `seed` as an integer in the official `-9223372036854776000` through `9223372036854776000` range, and `user` as a string before provider calls; valid values are forwarded to upstream Chat providers unchanged |
| `metadata`, `store` | local Responses/Chat storage semantics plus optional upstream Chat stored-completion fields | Provider-aware stored-chat passthrough after OpenAI request validation. The bridge validates user-supplied Responses and direct Chat `metadata` against the official 16 key/value pair, 64-character key, string-only 512-character value limits before provider calls or stored-object updates, accepts official nullable `metadata:null` by clearing user metadata on the local stored Chat object, and validates `store` as boolean/null before storage routing. It always preserves valid local `metadata` on Responses and stored Chat create responses, retrieve responses, list records, and replay metadata, and uses `store` for local replay/list/retrieve behavior; when no bridge compatibility metadata is needed, nullable Chat metadata is returned as `{}`. DeepSeek defaults to filtering these unsupported upstream fields and records `metadata.compatibility.stored_chat_fields` / `metadata.compatibility.chat_passthrough.stored_chat_fields` while keeping user metadata empty |
| `service_tier` | `service_tier` | Provider-dependent Chat-native passthrough after OpenAI request validation. The bridge validates user-supplied Responses and direct Chat `service_tier` against the official `auto` / `default` / `flex` / `scale` / `priority` values before provider calls; valid values then follow provider-aware passthrough/filtering. DeepSeek defaults to filtering this unsupported field and records `metadata.compatibility.service_tier` |
| `logit_bias`, `modalities`, `audio`, `prediction` | same-name Chat fields | Provider-aware Chat-native passthrough after OpenAI request validation. The bridge validates user-supplied Responses and direct Chat `logit_bias` as an object whose values are integers from -100 through 100 before provider calls; it also validates Chat output `modalities` as an array/null of `text` / `audio`, requires a valid `audio` object with `voice` and `format` when `audio` output is requested, and validates `prediction:{type:"content",content:string|text-parts[]}` before provider calls. Valid values then follow provider-aware passthrough/filtering. DeepSeek defaults to filtering these unsupported fields and records forwarded/filtered names in `metadata.compatibility.chat_native_fields`. Identity/cache aliases such as `safety_identifier` and `prompt_cache_key` are not reported as dropped when they are consumed by the DeepSeek `user_id` mapping; they are recorded in `chat_native_fields.mapped` instead |
| direct Chat `messages` | same-name Chat messages plus bridge multimodal/file aliases | Direct Chat requests validate the OpenAI Chat message envelope before provider calls: `messages` must be a non-empty array, roles must be `developer`, `system`, `user`, `assistant`, `tool`, or deprecated `function`, optional message `name` values must be strings when present, developer/system/tool content must be string or text parts, user content must be string or supported content parts, assistant content may be null only when a valid `tool_calls` or deprecated `function_call` object is present, assistant content arrays must contain either one `refusal` part or one or more `text` parts, and tool/function replay messages require their linking identifiers. User content validation covers official `text`, `image_url`, `input_audio`, and `file` parts, requires official `image_url` parts to use the `{url, detail?}` object shape with a valid URI `url`, and preserves already-supported bridge aliases such as `input_text`, `input_image`, `image_file`, `audio`, and `input_file`; invalid message shapes fail locally with zero upstream provider calls |
| `parallel_tool_calls` | boolean request validation plus prompt-level single-tool-call instruction for `false` | Responses create, `/input_tokens`, and direct Chat requests validate the OpenAI boolean contract before provider calls. When native Chat field forwarding is disabled, the value is `false`, and the request exposes tools, the bridge injects a system instruction asking the model to emit at most one tool call in the current assistant turn and records `metadata.compatibility.parallel_tool_calls` or `metadata.compatibility.chat_passthrough.parallel_tool_calls`; valid `true` values, requests without tools, or unsupported provider-native forwarding remain provider-aware passthrough/filtering |
| direct Chat `tools` / `tool_choice` | same-name Chat fields | Provider-aware direct Chat passthrough after OpenAI request validation. The bridge validates Chat `tools` as an array of `function` or `custom` tools, function names as 1-64 characters using letters/numbers/underscores/dashes, function/custom `description` fields as strings when present, function `parameters` objects, optional `strict` booleans/null, custom tool names as strings with official text/grammar formats, Chat custom tool grammar uses the nested `{type:"grammar",grammar:{definition,syntax}}` format, and `tool_choice` as `none` / `auto` / `required`, named `function` / `custom`, or nested `allowed_tools` with `auto` / `required` mode and function/custom selector names before provider calls. Valid custom tools and `allowed_tools` choices are preserved for capable providers; DeepSeek-compatible deployments filter unsupported custom tools and incompatible tool choices while preserving function tools |
| legacy Chat `functions` / `function_call` | modern Chat `tools` / `tool_choice` | Provider-aware compatibility for deprecated Chat SDK callers after OpenAI request validation. The bridge validates legacy `functions` as 1-128 function definitions with valid names, string `description` fields when present, and object `parameters`, and `function_call` as `none`, `auto`, or `{name}` before provider calls. When Chat-native fields are not forwarded, valid legacy function definitions are converted to function tools and compatible `function_call` choices are converted to `tool_choice`; the bridge records `metadata.compatibility.legacy_functions` on Responses translation and `metadata.compatibility.chat_passthrough.legacy_functions` on direct Chat requests |
| `n` | same-name Chat field, or local fan-out for unsupported providers | Provider-aware Chat-native passthrough after OpenAI request validation. The bridge validates Responses Chat-native aliases, direct Chat requests, and legacy Completions requests with `n` as an integer from 1 through 128 before provider calls. For DeepSeek-compatible direct Chat requests with native Chat field forwarding disabled, `n:1` is treated as the single-choice default and audited, while `n>1` is emulated by making up to `CODEXCOMPAT_CHAT_N_EMULATION_MAX` upstream Chat calls without forwarding `n` and recording `metadata.compatibility.chat_passthrough.n`. Non-streaming fan-out merges returned `choices`, aggregates `usage`, and preserves local `store:true` messages. Streaming fan-out emits one logical `chat.completion.chunk` stream with a single completion id, remapped choice indexes, one final combined usage chunk when usage is available, and stored Chat replay for every generated choice |
| `verbosity` | same-name Chat field, or system instruction for unsupported providers | Provider-aware Chat-native passthrough. The bridge validates user-supplied Responses and direct Chat `verbosity` against the official `low` / `medium` / `high` values before provider calls; valid values are forwarded to capable providers or, for DeepSeek-compatible providers where Chat-native fields are filtered, translated into a leading system instruction and recorded in `metadata.compatibility.verbosity` or `metadata.compatibility.chat_passthrough.verbosity` instead of being silently dropped |
| `web_search_options` | same-name Chat field, or local web-search context for unsupported providers | Provider-aware Chat-native passthrough after OpenAI request validation. The bridge validates user-supplied Responses and direct Chat `web_search_options` as an object, `search_context_size` as `low` / `medium` / `high`, and `user_location` as null or `{type:"approximate",approximate:{country,region,city,timezone}}` with string approximate fields before provider calls. For DeepSeek-compatible direct Chat requests, the bridge removes the unsupported native field, runs the local web-search adapter, injects source context into the upstream Chat request, annotates non-streaming Chat messages with `url_citation` entries or appended sources, records `metadata.compatibility.chat_passthrough.web_search_options` / `local_web_search`, and writes local `web_search_calls` usage when usage storage is enabled. If local web search is disabled, the field remains in the generic filtered field list |
| `moderation` | same-name Chat field plus local inline moderation fallback | Responses create and direct Chat validate moderation config before provider calls. The official `{model}` object requests input/output moderated completions with that moderation model; the older bridge `{input,output}` boolean flags remain accepted as a local compatibility extension for selecting scopes. Provider-aware passthrough is used when supported; when the field is filtered or the upstream Chat provider returns no moderation payload, the bridge attaches local `input`/`output` moderation results to `response.moderation` and records `metadata.compatibility.local_moderation` on Responses |
| `stream` | same-name Chat field plus local SSE conversion | Responses, direct Chat, and legacy Completions validate `stream` as boolean/null before provider calls. Valid `true` values keep the existing Responses, Chat, and legacy completion SSE compatibility paths; valid `false` values use non-streaming paths and do not accidentally route through streaming because of truthy non-boolean input |
| `stream_options` with `stream:true` | `stream_options` plus local Responses SSE shaping | Provider-aware subfield passthrough after OpenAI request validation. The bridge validates `stream_options` as an object/null and validates known streaming subfields `include_usage` and `include_obfuscation` as booleans before provider calls. Responses-native `include_obfuscation` is implemented locally for Responses SSE output: delta events include an `obfuscation` field by default, and omit it when `include_obfuscation:false` is requested. Chat-native `include_usage` remains a Responses-to-Chat compatibility extension; when omitted the bridge defaults `include_usage:true` so streaming Responses terminal events can carry usage. DeepSeek defaults to forwarding only `include_usage` upstream and records provider-filtered subfields with `metadata.compatibility.stream_options.reason=provider_stream_option_filter` |
| `stream_options` without `stream:true` | omitted | Valid objects are filtered with `metadata.compatibility.stream_options.reason=stream_required`; invalid `stream_options` shapes or invalid known subfield types are rejected locally before non-streaming provider calls |
| `stop` | `stop` | Compatibility extension for Chat-native stop sequences; the OpenAI-compatible boundary accepts a string or an array of 1 to 4 strings before provider calls. DeepSeek Chat can support more provider-native stop sequences, but the bridge keeps the public OpenAI shape for Responses, direct Chat, and legacy Completions |
| `include` | local output/input projection selector | Responses create validates the official `array|null` shape and `IncludeEnum` values before provider calls. Valid values are `file_search_call.results`, `web_search_call.results`, `web_search_call.action.sources`, `message.input_image.image_url`, `computer_call_output.output.image_url`, `code_interpreter_call.outputs`, `reasoning.encrypted_content`, and `message.output_text.logprobs`; unknown values or non-string elements fail locally instead of being silently ignored |
| `include:["message.output_text.logprobs"]` | Chat `logprobs:true` plus local output projection | Emulated through Chat providers that support token log probabilities. Output-text `logprobs` are hidden by default and returned when this include value is requested on create or on `GET /v1/responses/{id}`. Responses and direct Chat `logprobs` flags are validated locally as boolean/null before provider calls, and `top_logprobs` values are validated locally as integers from 0 through 20 |
| `include:["web_search_call.results"]` | local output projection | Emulated locally for the Responses web-search adapter. `results` is hidden by default on `web_search_call` items and returned when this include value is requested on create or on `GET /v1/responses/{id}`. The projection exposes the local result URLs with titles, snippets, source indexes, and bounded open/find status metadata, while `action.sources` remains separately gated by `include:["web_search_call.action.sources"]`; the create request include is recorded in `metadata.compatibility.local_web_search.results` |
| `include:["web_search_call.action.sources"]` | local output projection | Emulated locally for the Responses web-search adapter. `action.sources` is hidden by default on `web_search_call` items and returned when this include value is requested on create or on `GET /v1/responses/{id}`; the create request include is recorded in `metadata.compatibility.local_web_search.action_sources` |
| `include:["code_interpreter_call.outputs"]` | local output projection | Emulated locally for the Responses code-interpreter adapter. Local stdout/stderr logs are hidden by default on `code_interpreter_call` items and returned when this include value is requested on create or on `GET /v1/responses/{id}`; the create request include is recorded in `metadata.compatibility.local_shell.include_code_interpreter_outputs` |
| `include:["file_search_call.results"]` | local output projection | Emulated locally for the Responses file-search adapter. Search results are hidden by default on `file_search_call` items and returned when this include value is requested on create or on `GET /v1/responses/{id}` |
| `include:["message.input_image.image_url"]` | local input-item projection | Emulated for `GET /v1/responses/{id}/input_items`, `GET /v1/conversations/{id}/items`, and `GET /v1/conversations/{id}/items/{item_id}`. Stored input image URLs are hidden by default and returned only when this include value is requested |
| `include:["computer_call_output.output.image_url"]` | local input-item projection plus computer-loop compatibility metadata | Emulated for `GET /v1/responses/{id}/input_items`, `GET /v1/conversations/{id}/items`, and `GET /v1/conversations/{id}/items/{item_id}`. Stored `computer_call_output.output.image_url` values are hidden by default and returned only when this include value is requested. Requests are also recorded in `metadata.compatibility.local_computer.include_output_image_url`, and returned `computer_call_output` input items are translated into Chat-visible context |
| `include:["reasoning.encrypted_content"]` | local encrypted reasoning payload plus output projection | Emulated locally. When the Chat provider returns `reasoning_content`, the bridge stores encrypted content for each Responses `reasoning` item using AES-GCM, prefix `ocrsn1.`, and returns it only when this include value is requested on create or on `GET /v1/responses/{id}`. Clients can pass the item back in a later stateless request after the Responses input validator confirms the reasoning item shape, and the bridge decodes it in memory to upstream `reasoning_content` |
| `top_logprobs` | `top_logprobs` plus `logprobs:true` | Responses-compatible mapping validates the official 0-20 integer range and automatically enables upstream Chat `logprobs:true`; direct Chat requests validate the same range, validate `logprobs` as boolean/null, and reject requests that set `top_logprobs` without `logprobs:true`, matching the OpenAI Chat contract |
| `reasoning.effort` / `reasoning.summary` / `reasoning.generate_summary` / Chat `reasoning.effort` / Chat `reasoning_effort` / Assistants Run `reasoning_effort` | `reasoning_effort` / DeepSeek `thinking` / optional `reasoning_summary` | DeepSeek-compatible mapping enabled by default on `/v1/responses`, `/v1/responses/input_tokens`, direct `/v1/chat/completions`, and local Assistants Runs; Responses and direct Chat requests validate the OpenAI effort enum `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and the reasoning summary enum `auto`, `concise`, `detailed` before provider calls, so provider-only aliases such as DeepSeek `max` or unknown summary modes are rejected at the OpenAI-compatible boundary. `none` disables DeepSeek thinking and omits unsupported `reasoning_effort:"none"`, while `minimal`/`low`/`medium` map to `high` and `xhigh` maps to `max`. Responses `reasoning.summary` and deprecated `reasoning.generate_summary` are forwarded to `reasoning_summary` only when explicitly enabled for a compatible provider; otherwise they are filtered with `metadata.compatibility.reasoning_summary`. Direct Chat `reasoning:{effort}` is unpacked for DeepSeek and unsupported sibling fields are removed with compatibility metadata |
| `user_id`, `safety_identifier`, `prompt_cache_key`, `prompt_cache_retention`, `user` | DeepSeek `user_id` plus prompt-cache passthrough/filtering | DeepSeek-specific compatibility after OpenAI request validation. Direct Chat and Responses Chat-native aliases validate `user` and `prompt_cache_key` as strings, `safety_identifier` as a string up to the official 64-character limit, and `prompt_cache_retention` as `in_memory` or `24h`; current official OpenAPI/docs do not publish a maximum length for the shared `prompt_cache_key` field, so the bridge no longer applies the older local 64-character cap on Responses create, `/input_tokens`, or direct Chat. `/v1/responses/compact` has its own official body schema and still enforces `prompt_cache_key` length up to 64 characters. DeepSeek `user_id` is direct when already `[A-Za-z0-9_-]`, otherwise stable SHA-256 normalized. Local organization usage dimensions use `user_id`, then `safety_identifier`, then `user`, then `prompt_cache_key` when no explicit usage user id exists |

DeepSeek effort compatibility first validates OpenAI request values, then maps
OpenAI `reasoning.effort:"none"` to `thinking:{type:"disabled"}` without
forwarding `reasoning_effort`, maps `minimal`, `low`, and `medium` to `high`,
and maps `xhigh` to `max`, matching current OpenAI and DeepSeek docs. The
DeepSeek default upstream path is
`/chat/completions`, not `/v1/chat/completions`; OpenAI-style `/v1` paths remain
configurable for other providers.

DeepSeek thinking mode defaults to enabled in current DeepSeek docs, and
thinking-mode tool calls require `reasoning_content` to be passed back on later
turns. The bridge therefore disables thinking by default for Responses
translation and direct Chat passthrough requests that include function tools and
a `tool_choice`, preserving OpenAI-compatible tool-call behavior for clients
that do not manage DeepSeek-specific reasoning state. This also retains the
earlier live-endpoint guard for `tool_choice` compatibility. Set
`CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE=false` or force
`CODEXCOMPAT_DEEPSEEK_THINKING_MODE=true` to override this compatibility
behavior.

## Response Mapping

| Chat response field | Responses field | Status |
| --- | --- | --- |
| `choices[].message.content` / streaming `choices[].delta.content` | output `message.content[].output_text` | Direct for each Chat choice returned by the provider |
| `choices[].message.refusal` / streaming `choices[].delta.refusal` | output refusal content part | Direct when present |
| `choices[].message.tool_calls[type=function]` / streaming `choices[].delta.tool_calls[type=function]` | output `function_call` items plus `response.function_call_arguments.*` events | Direct |
| `choices[].message.tool_calls[type=custom]` / streaming `choices[].delta.tool_calls[type=custom]` | output `custom_tool_call` items plus `response.custom_tool_call_input.*` events | Direct for custom-tool-capable Chat providers. Non-streaming Chat custom tool calls become Responses `custom_tool_call` items with `call_id`, `name`, `input`, and `status:"completed"`; streaming custom input emits `response.custom_tool_call_input.delta` and `response.custom_tool_call_input.done`, and replay storage preserves Chat `tool_calls:[{type:"custom",custom:{name,input}}]` |
| `choices[].message.function_call` / streaming `choices[].delta.function_call` | output `function_call` item plus `response.function_call_arguments.*` events | Legacy Chat function-call compatibility; streaming chunks are accumulated and replayed as Chat `tool_calls` for follow-up `function_call_output` turns |
| `choices[].logprobs.content[]` | `message.content[].output_text.logprobs[]` | Direct for non-streaming and streaming Responses when provider returns Chat logprobs |
| `choices[].logprobs.refusal[]` | `metadata.compatibility.chat_refusal_logprobs[]` | Preserved in compatibility metadata because Responses refusal content parts do not expose a logprobs field |
| `choices[].message.annotations[]` / streaming `choices[].delta.annotations[]` | `message.content[].output_text.annotations[]` | Direct when a Chat provider returns citation annotations |
| `choices[].message.audio` / streaming `choices[].delta.audio` | `message.content[].output_audio`, replay store, and `metadata.compatibility.chat_audio[]` | Compatibility preservation for audio-capable Chat providers. Known scalar fields `data`, `transcript`, `id`, `expires_at`, `format`, and `voice` are normalized onto the content part; provider-specific fields are preserved under `audio`. Streaming `data` and `transcript` fragments are accumulated. Text-only providers such as DeepSeek do not synthesize audio locally |
| `choices[].index`, `choices[].finish_reason` | `metadata.compatibility.chat_choices[]` | Preserves original Chat choice metadata while Responses output items carry the generated content |
| `choices[].message.reasoning_content` / streaming `choices[].delta.reasoning_content` | output `reasoning.summary[]`, optional `reasoning.encrypted_content`, and replay store | DeepSeek-specific reasoning compatibility; encrypted content is local bridge emulation for stateless Responses-style replay |
| `usage.prompt_tokens` | `usage.input_tokens` | Direct |
| `usage.prompt_cache_hit_tokens` | `usage.input_tokens_details.cached_tokens` | DeepSeek-specific cache usage compatibility |
| `usage` | `metadata.compatibility.chat_usage` | Full original Chat usage object is preserved for provider-specific token detail fields that Responses usage does not expose |
| `usage.completion_tokens` | `usage.output_tokens` | Direct |
| `completion_tokens_details.reasoning_tokens` | `output_tokens_details.reasoning_tokens` | Direct when provider returns it |
| `service_tier` | `service_tier` | Direct for non-streaming responses and streaming chunks when a Chat provider echoes the actual tier used |
| `moderation` | `response.moderation` and `metadata.compatibility.chat_moderation` | Direct when an upstream Chat provider returns moderation; otherwise local inline moderation can synthesize `response.moderation.input` and/or `response.moderation.output` when the request asked for `moderation` |
| `id` | `metadata.compatibility.chat_completion_id` | Preserved because the bridge must keep its own Responses `resp_*` id for storage and continuation |
| `object`, `created`, `model` | `metadata.compatibility.chat_object`, `chat_created`, `chat_model` | Preserved for non-streaming responses and streaming chunks; Responses keeps its own object identity |
| `system_fingerprint` | `metadata.compatibility.chat_system_fingerprint` | Preserved for non-streaming responses and streaming chunks, including explicit `null` values |
| `request_id`, `input_user` | `metadata.compatibility.chat_request_id`, `metadata.compatibility.chat_input_user` | Preserved in Responses compatibility metadata when returned by an upstream provider. For local stored Chat completion create/retrieve/list records, upstream `x-request-id` is exposed as top-level `request_id` and request `user` is projected to top-level `input_user` without overriding provider-supplied values |
| `seed`, `tool_choice`, `response_format`, sampling penalties, `metadata`, `tools` | `metadata.compatibility.chat_*` | Preserved when an upstream Chat provider returns stored-completion metadata fields with the response |
| `finish_reason=length` | `status=incomplete`, `incomplete_details.reason=max_output_tokens` | Direct for non-streaming and streaming Chat output |
| `finish_reason=content_filter` | `status=incomplete`, `incomplete_details.reason=content_filter` | Direct for non-streaming and streaming Chat output |
| `finish_reason=insufficient_system_resource` | `status=failed`, `error.code=server_error` | DeepSeek-specific Chat termination mapped to Responses failure because Responses incomplete reasons do not include this value |
| `finish_reason=stop`, `tool_calls`, or legacy `function_call` | `status=completed` | Direct |
| local background job state | `background`, `status`, `completed_at`, `error` | Emulated for `in_progress`, `completed`, `failed`, and `cancelled`; restart recovery resumes safe `preparing` checkpoints, persisted `provider_pending` provider calls, and reconciles unsafe or missing snapshots to failed terminal records |
| local input file context | compatibility metadata `local_input_files` | Emulated before upstream Chat calls for Responses create, background, streaming, `/input_tokens`, and local compaction |
| local web search context | output `web_search_call` plus `output_text.annotations[].url_citation` | Emulated for non-streaming, streaming, and background Responses; bounded `open_page` extraction can inject top result page text and local `find_in_page` snippets |
| local file search context | output `file_search_call` plus `output_text.annotations[].file_citation` | Emulated for non-streaming, streaming, and background Responses |
| local shell context | output `shell_call` plus `shell_call_output` | Emulated for non-streaming, streaming, and background Responses when an explicit command is found |
| local computer context | output `computer_call` plus returned `computer_call_output` prompt context | Emulated for non-streaming, streaming, and background Responses; the bridge emits screenshot-first `computer_call` items, maps client-returned `computer_call_output` input items into Chat-visible evidence, and maps model-requested follow-up actions back into `computer_call` items |
| local hosted-tool budget | `metadata.compatibility.local_tool_budget` | Emulates Responses `max_tool_calls` across local hosted-tool adapters with `max_tool_calls`, `used`, `skipped`, `exhausted`, and bounded `skipped_calls` audit details |
| local conversation context | `response.conversation` plus persisted conversation items | Emulated for non-streaming, streaming, and background Responses attached to a local conversation; replay-only for `/input_tokens` and local compaction probes |

## Responses Endpoint Coverage

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/responses` | Implemented | Rejects unsupported query parameters before JSON body parsing, then translates to upstream Chat Completions and stores replay state unless `store:false`; `background:true` returns `in_progress` immediately, persists a local background job snapshot, completes asynchronously through local storage, resumes safe `preparing` checkpoints and `provider_pending` snapshots after restart, and fails unsafe interrupted snapshots explicitly; `conversation` replays and appends local Conversation items |
| `GET /v1/responses/{response_id}` | Implemented | Returns the locally stored Responses object; validates `include`, `stream`, `starting_after`, and `include_obfuscation` query values, with scalar `stream`, `starting_after`, and `include_obfuscation` allowed only once; `stream=true` replays stored terminal responses as typed Responses SSE events with `starting_after` sequence filtering without re-calling the provider, and active in-process background responses now keep the SSE connection open after `response.created`, a synthetic `response.queued` snapshot, and `response.in_progress` until the locally stored response reaches a terminal state before replaying the output events. Cancelled background streams close after the progress events because the official Responses SSE event union does not define a `response.cancelled` terminal stream event. Local `message.output_text.logprobs`, `reasoning.encrypted_content`, `web_search_call.results`, `web_search_call.action.sources`, `code_interpreter_call.outputs`, and `file_search_call.results` are hidden unless their matching include values are requested |
| `POST /v1/responses/{response_id}` | Implemented for local `store:true` and local background records | Local compatibility extension for metadata updates. Updates only the stored response `metadata` field; local compatibility metadata is preserved so bridge-emulated behavior remains inspectable, and metadata updates made while a background response is `in_progress` are retained when the final completed response is stored. Returned response bodies use the same include projection as `GET /v1/responses/{response_id}`, and local include query extensions are validated against the official enum before projection |
| `DELETE /v1/responses/{response_id}` | Implemented | Deletes the local replay record, aborting an in-process background job when present, and returns the official deletion marker shape with `object:"response"` and `deleted:true` |
| `GET /v1/responses/{response_id}/input_items` | Implemented | Returns locally stored input items with official `limit`, `after`, and `order` pagination; defaults to the official `order=desc` while preserving explicit `order=asc`; validates `order` against `asc` / `desc`, validates `limit` as an integer from 1 through 100, validates `after` as a single string query value, and validates `include` query values against the official enum; message input image URLs and computer output image URLs are hidden unless their matching include values are requested |
| `POST /v1/responses/{response_id}/cancel` | Implemented for local `in_progress` background responses; compatibility no-op for terminal records | In-process background jobs are aborted and marked `cancelled`; completed records are returned unchanged with metadata explaining the no-op. Returned response bodies use the same local include projection as `GET /v1/responses/{response_id}`, and local include query extensions are validated against the official enum before projection |
| `POST /v1/responses/compact` | Implemented via local encrypted summary | Rejects unsupported query parameters before JSON body parsing, then validates the official required `model`, `previous_response_id`, `prompt_cache_key`, `prompt_cache_retention`, and `service_tier` request contract before provider calls, including the compact-specific `prompt_cache_key` 64-character maximum and compact `service_tier` enum `auto` / `default` / `flex` / `priority`. Request `input` also validates replayed `reasoning` and `compaction` item shapes before summarization. The bridge then uses upstream Chat Completions to summarize request, `previous_response_id`, and local `conversation` state. Valid prompt-cache and provider-supported service-tier fields are preserved on the compaction Chat request; returns `response.compaction`, attaches `response.conversation` when present, encrypts local compaction content with an AES-GCM key stored outside Git, and disables DeepSeek thinking for compaction replay follow-ups by default |
| `POST /v1/responses/input_tokens` | Implemented via upstream usage probe | Rejects unsupported query parameters before JSON body parsing, then validates official token-count request fields before provider calls, including `truncation`, `previous_response_id`/`conversation`, `parallel_tool_calls`, `text.format`, `reasoning.effort`, and `personality`; translates the request, local `conversation` state, local input files/images, and tool schemas to Chat Completions; validates the official `personality` preset limit of 64 characters and maps valid values to a Chat-visible compatibility instruction for the prompt-token probe while retaining the older `style` preset as the same 64-character compatibility alias; forces non-streaming `max_tokens:1`, strips streaming options, disables upstream storage, and returns `usage.prompt_tokens` as `input_tokens` without appending Conversation items |

## Legacy Completions Endpoint Coverage

OpenAI's `POST /v1/completions` operation is marked legacy, but current
clients and benchmarks still use it. The bridge rejects unsupported query
parameters before JSON body parsing, implements the endpoint locally by mapping
legacy prompt-style requests to upstream Chat Completions, and maps Chat
responses back to `object:"text_completion"` completion objects.

| Legacy Completions field | Chat bridge behavior | Status |
| --- | --- | --- |
| `prompt` string | one `role:"user"` Chat message | Direct after request validation; legacy Completions `prompt` must be present and must be `null`, a string, an array of strings, an array of token integers, or an array of non-empty token-integer arrays before any upstream Chat request |
| `prompt` array of strings | one upstream Chat request per prompt, aggregated into one `text_completion` response | Emulated locally for non-stream and stream after the same prompt schema validation |
| token-id prompts | token ids are preserved as visible numeric text because a Chat-only provider cannot decode the legacy model tokenizer | Best-effort local compatibility after prompt arrays are validated as integer-only token IDs |
| `model` | `model` | Direct after required string request validation |
| `max_tokens` | configured Chat max-token field, default `max_tokens` | Direct |
| `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `seed`, `n` | same-name Chat fields | Direct/provider-dependent after request validation; legacy Completions `temperature` must be a number from 0 through 2, `top_p` must be a number from 0 through 1, `frequency_penalty` / `presence_penalty` must be numbers from -2 through 2, `stop` must be a string or an array of 1 to 4 strings, `seed` must be an integer in the official 64-bit-compatible range, and `n` must be an integer from 1 through 128 before any upstream Chat request |
| `logprobs` | `logprobs:true` plus bounded `top_logprobs`; Chat token logprobs are reshaped to legacy `tokens`, `token_logprobs`, `top_logprobs`, and `text_offset` when present | Provider-dependent after request validation; legacy Completions `logprobs` must be an integer from 0 through 5 before prompt-to-Chat mapping |
| `logit_bias` | same-name Chat field when Chat-native passthrough is enabled | The bridge validates legacy Completions `logit_bias` as an object whose values are integers from -100 through 100 before any upstream Chat request; valid values then follow provider-dependent passthrough/filtering |
| `user` | OpenAI-compatible `user`, or DeepSeek-compatible normalized `user_id` when `CODEXCOMPAT_DEEPSEEK_USER_ID_COMPAT=true` | Provider-aware after request validation; legacy Completions `user` must be a string before prompt-to-Chat mapping |
| `stream` | validates as boolean/null before prompt-to-Chat mapping; valid `true` upstream Chat streams are transformed into `data: {object:"text_completion"}` frames plus `data: [DONE]`, while valid `false` remains non-streaming | Implemented |
| `stream_options` | forwarded when stream forwarding is enabled; the bridge defaults `include_usage:true` for usage-bearing final chunks and applies provider-aware subfield filtering | Provider-dependent after request validation; legacy Completions validates `stream_options` as an object/null and known subfields `include_usage` / `include_obfuscation` as booleans before prompt-to-Chat mapping. DeepSeek defaults to `include_usage` only |
| `echo` | validates as boolean/null before prompt-to-Chat mapping; `true` prefixes the original prompt to returned completion text, including the first stream chunk for each choice, while `false` returns only generated completion text | Emulated locally |
| `suffix` | added as suffix context in the Chat prompt because Chat Completions has no insertion-suffix primitive | Best-effort local compatibility after request validation; legacy Completions `suffix` must be a string/null before prompt-to-Chat mapping |
| `best_of` | accepted but not forwarded; Chat Completions has no equivalent server-side generation/ranking primitive | Not losslessly representable after request validation. Legacy Completions `best_of` must be an integer/null from 0 through 20, cannot be used with `stream:true`, and must be greater than explicit `n` when both fields are set before any upstream Chat request |

Returned non-stream objects use local `cmpl-...` ids, `object:"text_completion"`,
upstream `created` when available, upstream `model`, mapped legacy choices,
optional `system_fingerprint`, and usage mapped from Chat
`prompt_tokens`/`completion_tokens`/`total_tokens`.

## Assistants API Compatibility

The official OpenAPI spec still lists Assistants/Threads endpoints, although
the `/v1/assistants` operations are marked deprecated in favor of newer
Responses workflows. The bridge implements a local compatibility layer so
older SDKs and Assistants-style demos can run against a Chat-Completions-only
provider.

Runs are synchronous locally unless the upstream Chat provider returns function
tool calls. Creating a run builds a Chat Completions request from the Assistant
instructions plus Thread messages. If the provider returns text, the bridge
appends it as a `thread.message`, writes a `message_creation` Run Step, and
returns a terminal `thread.run`. If the provider returns Chat `tool_calls` or a
legacy `function_call`, the bridge writes a `tool_calls` Run Step and returns
`status:"requires_action"` with `required_action.type:"submit_tool_outputs"`.
Submitting tool outputs appends Chat `tool` messages, calls the upstream
provider again, and either completes the run or enters another
`requires_action` round. Streaming create/run and streamed
`submit_tool_outputs` requests emit Assistants-style SSE around the same local
run state changes: run lifecycle events, `thread.message.*` text/refusal
deltas, `thread.run.step.*` tool-call argument deltas, terminal completed
events, and `thread.run.requires_action` when streamed Chat tool calls need
client tool outputs.

Run-level `reasoning_effort` is persisted on local `thread.run` objects and
forwarded into the generated Chat request before provider compatibility
normalization. For DeepSeek-compatible providers, `reasoning_effort:"none"`
becomes `thinking:{type:"disabled"}` and records the action under
`metadata.compatibility.local_assistants.chat_passthrough.reasoning_effort`;
other effort values use the shared Chat passthrough mapping.

Run-level `truncation_strategy:{type:"last_messages"}` is applied before the
generated Chat request and before local Assistants hosted-tool adapters see
thread text. Run-level `max_prompt_tokens` is also applied as a best-effort
local prompt budget by estimating Chat prompt tokens from serialized message
characters divided by four and dropping oldest selected thread messages until
under budget. The bridge persists the original run fields and records the
local action under
`metadata.compatibility.local_assistants.truncation`, including the estimated
token counts, included/dropped message counts, and estimate source. When
upstream Chat `usage` proves that aggregate Run `prompt_tokens` or
`completion_tokens` exceed `max_prompt_tokens` / `max_completion_tokens`, or
when Chat finishes with a length-style `finish_reason` while
`max_completion_tokens` is set, the local Run ends with `status:"incomplete"`
and `incomplete_details.reason` set to `max_prompt_tokens` or
`max_completion_tokens`. The evidence is recorded under
`metadata.compatibility.local_assistants.token_budget`. This is a Chat-only
compatibility approximation, not OpenAI hosted tokenizer accounting or hosted
async worker scheduling.

Assistant message content supports image inputs before the generated Chat
request. `image_url` parts keep their URL and `detail` value as Chat vision
content parts. `image_file.file_id` parts are resolved through the local Files
API with the same bounded data-URL resolver used by Responses `input_image`;
the data URL is sent upstream when the configured Chat provider accepts vision
content. When the configured provider is text-only, the bridge sends explicit
image markers instead of Chat vision parts and never places data URLs in the
prompt. Compatibility metadata records only file id, media type, byte count,
status, provider mode, and aggregate part counts.

Assistant `file_search` and `code_interpreter` tools are intercepted before the
upstream Chat call. `file_search` merges assistant-, thread-, and run-level
`tool_resources.file_search.vector_store_ids`, searches the local vector store,
injects bounded retrieval evidence into Chat context, writes a local
`tool_calls` Run Step, and adds `file_citation` annotations to assistant text
when sources are present. `code_interpreter` merges
`tool_resources.code_interpreter.file_ids`, mounts those local Files into the
local container workspace, executes explicit Python code blocks, injects stdout
and mounted-file evidence into Chat context, and writes a `code_interpreter`
Run Step with outputs. Message `attachments` are also materialized into
thread-level resources before runs start: `file_search` attachments create or
reuse a local thread vector store, while `code_interpreter` attachments add the
file IDs to `tool_resources.code_interpreter.file_ids`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/assistants` | Implemented locally | Lists local `assistant` records with official `limit`, `after`, `before`, and `order` pagination; repeated scalar query values return 400 and `limit` is validated from 1 through 100 |
| `POST /v1/assistants` | Implemented locally | Rejects unsupported query parameters before JSON body parsing, then creates local `asst_...` records with `model`, `instructions`, `tools`, `tool_resources`, `metadata`, `temperature`, `top_p`, and `response_format` |
| `GET /v1/assistants/{assistant_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then retrieves local assistant metadata by id |
| `POST /v1/assistants/{assistant_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates mutable local assistant fields |
| `DELETE /v1/assistants/{assistant_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then deletes the local assistant record and returns `object:"assistant.deleted"` |
| `POST /v1/threads` | Implemented locally | Rejects unsupported query parameters before JSON body parsing, then creates local `thread_...` records and optional initial `messages`; message `attachments` for `file_search` / `code_interpreter` are materialized into thread `tool_resources` |
| `GET /v1/threads/{thread_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then retrieves local thread metadata |
| `POST /v1/threads/{thread_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates `metadata` and `tool_resources` |
| `DELETE /v1/threads/{thread_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then deletes local thread state, including messages/runs/steps |
| `GET /v1/threads/{thread_id}/messages` | Implemented locally | Lists local `thread.message` records with official `limit`, `after`, `before`, `order`, and `run_id` pagination/filtering; repeated scalar query values return 400, `limit` is validated from 1 through 100, and `run_id` filters messages generated by a specific run |
| `POST /v1/threads/{thread_id}/messages` | Implemented locally | Rejects unsupported query parameters before thread-lock checks, JSON body parsing, attachment materialization, or message creation; adds a local user/assistant message; string content is normalized to `[{type:"text", text:{value, annotations:[]}}]`; relevant message `attachments` update thread `tool_resources`; returns `thread_locked` while a non-terminal local run is active on the thread |
| `GET /v1/threads/{thread_id}/messages/{message_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then retrieves a local message |
| `POST /v1/threads/{thread_id}/messages/{message_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates message `metadata` |
| `DELETE /v1/threads/{thread_id}/messages/{message_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then deletes the local message record |
| `GET /v1/threads/{thread_id}/runs` | Implemented locally | Lists local runs for a thread with official `limit`, `after`, `before`, and `order` pagination; repeated scalar query values return 400, `limit` is validated from 1 through 100, and stale non-terminal runs whose `expires_at` has elapsed are refreshed to `status:"expired"` |
| `POST /v1/threads/{thread_id}/runs` | Implemented via upstream Chat plus local hosted-tool adapters | Creates a local run by calling the configured Chat provider; allows the official Run Step `include` / `include[]` projection query only and rejects unsupported query parameters or invalid include values before JSON body parsing, message insertion, or provider calls; rejects with `thread_locked` while another non-terminal local run is active on the thread; supports `additional_instructions` by appending it to the run instructions, `additional_messages` by adding messages to the thread before the run starts, including attachment materialization into thread/run tool resources, Run `reasoning_effort` through the shared Chat/DeepSeek compatibility mapper, Run `response_format` through the shared Chat passthrough mapper including DeepSeek-compatible `json_schema` to `json_object` downgrade with injected schema instruction, Run `truncation_strategy.last_messages`, best-effort local `max_prompt_tokens` budget shaping before Chat/local hosted-tool context, and `status:"incomplete"` terminal mapping for observed Run token-budget overruns; local Assistants `file_search` and `code_interpreter` tools run first and persist `tool_calls` Run Steps; function tools complete with one assistant message and `message_creation` step, enter `requires_action`, or become `incomplete` when token budgets are already exhausted; `stream:true` relays Chat text/refusal deltas as `thread.message.delta`, Chat tool-call argument deltas as `thread.run.step.delta`, and token-budget terminal failures as `thread.run.incomplete`, while streamed hosted `file_search` Run Steps hide result `content` unless the official Run Step `include[]` value is requested |
| `GET /v1/threads/{thread_id}/runs/{run_id}` | Implemented locally | Rejects unsupported query parameters before refreshing/reading local state, then retrieves local run state and refreshes stale non-terminal runs whose `expires_at` has elapsed to `status:"expired"` with `expired_at` and `last_error.code:"run_expired"` |
| `POST /v1/threads/{thread_id}/runs/{run_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates run `metadata` |
| `POST /v1/threads/{thread_id}/runs/{run_id}/cancel` | Implemented locally | Rejects unsupported query parameters before lifecycle mutation, then cancels non-terminal local runs, returns terminal local runs unchanged, and refreshes elapsed `expires_at` runs to `expired` before deciding |
| `POST /v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs` | Implemented for function tools | Rejects unsupported query parameters before JSON body parsing, expiration checks, or provider replay; accepts all required tool outputs before `expires_at`, replays the assistant `tool_calls` plus Chat `tool` messages upstream, then completes the run or enters another `requires_action` round; stale required-action runs become `expired` before provider replay; `stream:true` relays follow-up message or tool-call deltas; non-required-action runs are returned unchanged with compatibility metadata |
| `GET /v1/threads/{thread_id}/runs/{run_id}/steps` | Implemented locally | Lists local `thread.run.step` records with official `limit`, `after`, `before`, `order`, and `include[]` pagination/projection; repeated scalar query values return 400, `limit` is validated from 1 through 100, elapsed run expiration is refreshed first, and Assistants `file_search` result `content` is hidden by default and returned only with `include[]=step_details.tool_calls[*].file_search.results[*].content` |
| `GET /v1/threads/{thread_id}/runs/{run_id}/steps/{step_id}` | Implemented locally | Retrieves one run step and refreshes elapsed run expiration first; invalid Run Step `include[]` query values return 400, and Assistants `file_search` result `content` follows the same `include[]` projection as list responses |
| `POST /v1/threads/runs` | Implemented via upstream Chat plus local hosted-tool adapters | Allows the official Run Step `include` / `include[]` projection query only and rejects unsupported query parameters or invalid include values before JSON body parsing, thread creation, or provider calls; creates a thread and immediately creates/completes a run, including Run `reasoning_effort`, Run `response_format` shared Chat passthrough normalization, `truncation_strategy.last_messages`, best-effort `max_prompt_tokens`, and observed token-budget `incomplete` compatibility mapping; `stream:true` emits `thread.created`, run lifecycle events, hosted-tool Run Steps when local Assistants tools execute, message deltas, run-step deltas, `thread.run.incomplete`, and terminal run events; streamed hosted `file_search` Run Steps also hide result `content` unless the official Run Step `include[]` value is requested |

Current boundary: Assistants `file_search` and `code_interpreter` are local
compatibility adapters, not OpenAI hosted jobs. File search uses the bridge's
local vector-store retrieval rather than OpenAI hosted ranking/rewrite policy.
Message attachments for `file_search` create/reuse a local thread vector store
with a seven-day last-active expiration policy, and `code_interpreter`
attachments are unioned into thread file resources. Code interpreter executes
explicit Python blocks locally rather than running a model-driven hosted code
loop. Broader edge-delta parity for non-image message content, hosted tool
output deltas, and hosted async worker scheduling remain future work. Local
active-run locks are implemented for message creation and run creation, and
stale non-terminal runs are marked `expired` when `expires_at` has elapsed.
Function tools are forwarded through Chat Completions, with `tool_calls` Run
Steps, streamed argument deltas, and `submit_tool_outputs` replay. The local
layer records `metadata.compatibility.local_assistants` on runs so callers can
see that execution happened locally through Chat Completions and local bridge
adapters rather than OpenAI hosted Assistants.

## Chat Completions Endpoint Coverage

OpenAI's current Chat Completions paths include `/v1/chat/completions`,
`/v1/chat/completions/{completion_id}`, and
`/v1/chat/completions/{completion_id}/messages`. The bridge implements create,
list, retrieve, update metadata, delete, and messages retrieval for locally
stored Chat completion records.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | Implemented | Rejects unsupported query parameters before JSON body parsing, then proxies to upstream Chat Completions with bridge-safe response headers; non-streaming and streaming requests with `store:true` are recorded in the local Chat completion lifecycle store, with request metadata attached to the created local stored Chat object, `metadata:null` clearing user metadata while preserving any bridge compatibility metadata, upstream `x-request-id` normalized to top-level `request_id`, request `user` normalized to top-level `input_user`, missing `object`, `created`, or `model` fields normalized to the official stored Chat completion shape, missing stored-list envelope fields such as `tool_choice`, `tools`, `response_format`, sampling fields, `service_tier`, and `system_fingerprint` normalized to `null` when unknown, and missing stored choice `logprobs` / assistant message `refusal`, `annotations`, `tool_calls`, and `function_call` fields normalized to official empty values. Direct Chat `tools` are validated as at most 128 function/custom tool definitions before provider calls. Direct Chat `response_format:{type:"json_schema"}` is preserved for capable providers or downgraded for DeepSeek-compatible providers to `json_object` with an injected JSON Schema instruction and `metadata.compatibility.chat_passthrough.response_format`. Direct Chat `web_search_options` is preserved for capable providers or emulated for DeepSeek-compatible providers through the local web-search adapter with injected source context, citation annotations for non-streaming completions, local usage accounting, and `metadata.compatibility.chat_passthrough.web_search_options` / `local_web_search`. Direct Chat `n>1` is preserved for capable providers or locally emulated for DeepSeek-compatible providers by fan-out calls that merge non-streaming `choices` / `usage`, or produce one logical streaming chunk sequence with remapped choice indexes and combined usage metadata. Direct Chat image content parts use `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE`: vision-capable providers receive native `image_url` parts, while text-only providers receive safe `[image:...]` markers and record `metadata.compatibility.chat_passthrough.chat_image_inputs`. Direct Chat audio content parts use `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE`: audio-capable providers receive native `input_audio` parts, while text-only providers receive safe `[audio:...]` markers and record `metadata.compatibility.chat_passthrough.chat_audio_inputs`. Direct Chat file content parts use `CODEXCOMPAT_CHAT_FILE_INPUT_MODE`: file-capable providers can receive native file parts, while text-only providers receive safe `[file:...]` markers plus local extracted file context and record `metadata.compatibility.chat_passthrough.chat_file_inputs` |
| `GET /v1/chat/completions` | Implemented for local `store:true` records | Lists locally stored upstream Chat completion objects with official `model`, `metadata[key]`, `limit`, `after`, and `order` filters; legacy local records are projected through the current stored Chat completion normalizer before filtering and pagination; `order` is validated against the official `asc` / `desc` enum and defaults to `asc`, `limit` must be a positive integer query value, scalar `model` / `after` query parameters may appear only once, unsupported generic paginator parameters such as `before` do not affect the official list result, and `metadata[key]` filters follow the same official 16-pair, 64-character key, 512-character value limits used for stored Chat metadata |
| `GET /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Returns a locally stored upstream Chat completion object projected through the current stored Chat completion normalizer, so records created before newer shape fixes expose the same official fields as new records |
| `POST /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Updates only the stored completion `metadata` field, matching the current OpenAI API restriction for stored Chat Completions; accepts nullable official Metadata by clearing local metadata to `{}`; returns the updated record through the same stored Chat projection used by retrieve/list |
| `DELETE /v1/chat/completions/{completion_id}` | Implemented for local `store:true` records | Deletes a locally stored Chat completion and returns `object:"chat.completion.deleted"` |
| `GET /v1/chat/completions/{completion_id}/messages` | Implemented for local `store:true` records | Returns request messages plus assistant choice messages with official `limit`, `after`, and `order` pagination; message records include official `id`, `role`, `content`, `name`, and `content_parts` fields, and keep local `direction` for replay/debugging. Legacy local message records are projected through the current message normalizer before pagination. Assistant/output message records expose missing `refusal:null`, `annotations:[]`, `tool_calls:null`, and `function_call:null`, while input messages are not given assistant-only fields. `content_parts` is populated only when the stored Chat content-part array contains official `text` / `image_url` parts and is `null` for string content or bridge extension parts such as audio/file inputs. `order` is validated against the official `asc` / `desc` enum and defaults to `asc`, `limit` must be a positive integer query value, scalar `after` may appear only once, and unsupported generic paginator parameters such as `before` do not affect the official message-list result |

The bridge stores Chat completions only when the incoming Chat request sets
`store:true`. Non-streaming requests normalize the upstream
`chat.completion` into the official stored object shape before local storage.
Streaming requests are forwarded as SSE and reconstructed from the observed
`chat.completion.chunk` sequence into a local terminal `chat.completion`,
including accumulated assistant text, streamed tool-call arguments, logprobs
when present, terminal finish reasons, usage-bearing final chunks, request
metadata, and message history. Stored Chat message-list records expose
`name:null` when no caller name is present and `content_parts` for pure
official text/image content-part inputs. Assistant/output message-list records
also expose the same empty assistant fields as stored completion choices.
Stored Chat completion records expose
top-level `request_id` and `input_user` when those values are known, and expose
official required nullable choice/message fields such as `logprobs:null` and
`refusal:null` when upstream providers omit them. They also keep known request
fields such as `temperature`, `top_p`, penalties, `seed`, `tools`, and
`response_format`, while unknown official stored-list fields are returned as
`null` instead of invented provider defaults. Retrieve, list, update, and
message-list endpoints apply the same projection to older local records at read
time, without rewriting historical JSON files. This matches the
stored-completion lifecycle intent and avoids unbounded state growth for
ordinary passthrough Chat traffic.

DeepSeek-compatible Chat passthrough uses provider-aware request normalization
before proxying: OpenAI Chat `messages` are validated as a non-empty,
role-specific Chat message array before any upstream call, valid
`messages[].role:"developer"` entries are mapped to `system` by default,
`user` / `safety_identifier` / `prompt_cache_key` are
normalized into DeepSeek `user_id`, OpenAI Chat `max_completion_tokens` is
mapped to the configured provider max-token field (`max_tokens` for DeepSeek),
conflicting legacy `max_tokens` values are withheld and audited, OpenAI Chat
`reasoning:{effort}` / `reasoning_effort` values are mapped to DeepSeek
`reasoning_effort` / `thinking`, unsupported Chat `reasoning` object sibling
fields are filtered with compatibility metadata, OpenAI Chat `tools` and
`tool_choice` are validated against the official function/custom/allowed-tools
request shapes before provider calls, including string-only custom tool names,
OpenAI Chat custom tools are filtered by
default for DeepSeek because DeepSeek currently documents only
`type:"function"` tools, incompatible custom or allowed-tools `tool_choice`
values are removed while function tools remain forwardable, `store` and
`metadata` are kept as
local stored-completion
semantics and filtered for DeepSeek upstream calls, `service_tier` is filtered
when unsupported, OpenAI Chat `verbosity:"low"|"medium"|"high"` is converted
to a leading system instruction when the provider does not support the native
field, OpenAI Chat `web_search_options` is executed through the local
web-search adapter after official `search_context_size` / `user_location`
shape validation when native Chat fields are not forwarded, OpenAI Chat
`n` is validated as an integer from 1 through 128 before provider calls, and
`n>1` is locally fanned out for providers that do not support native
multi-choice generation, OpenAI Chat `stream` is validated as boolean/null
before stream routing, OpenAI Chat `store` is validated as boolean/null before
stored-completion routing, `stream_options` are removed on non-streaming requests,
provider-unsupported streaming subfields are filtered by
`CODEXCOMPAT_STREAM_OPTION_FIELDS`, mapped identity/cache aliases are reported
under `metadata.compatibility.chat_passthrough.chat_native_fields.mapped`, and
remaining configured OpenAI-only Chat fields such as `logit_bias`, `modalities`,
`audio`, `moderation`, `prediction`, and `prompt_cache_retention` are validated
at the OpenAI-compatible boundary and then filtered instead of being sent to
the provider when unsupported. `parallel_tool_calls` must be a boolean
on both Responses and direct Chat requests before any provider call is made.
When tools are present, `parallel_tool_calls:false` is translated into a
single-tool-call system instruction and recorded under
`metadata.compatibility.chat_passthrough.parallel_tool_calls`; valid `true`
values, requests without tools, or unsupported native forwarding follow the
provider-aware passthrough/filtering path.
Deprecated Chat `functions` / `function_call` requests are upgraded to modern
`tools` / `tool_choice` after official legacy function-field validation when
possible and recorded under
`metadata.compatibility.chat_passthrough.legacy_functions`. DeepSeek-supported Chat log-probability controls such as `logprobs`
and `top_logprobs` remain pass-through after OpenAI-compatible `logprobs`
boolean/null validation. Non-streaming JSON
responses and stored reconstructed streaming responses record these actions under
`metadata.compatibility.chat_passthrough`, while stored Chat messages preserve
the original client request shape for `/messages` retrieval.

## ChatKit Endpoint Coverage

OpenAI's current endpoint list includes beta ChatKit paths for sessions,
threads, and thread items. The bridge implements a local file-backed
compatibility layer so SDKs and ChatKit-style UI flows can create a bounded
client session token, manage local thread metadata, and persist thread items
without calling a Chat Completions provider.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/chatkit/sessions` | Implemented locally | Requires `user` and `workflow.id`, returns `object:"chatkit.session"`, a local `client_secret`, `expires_at`, workflow/scope, request caps, `status:"active"`, and local compatibility metadata |
| `POST /v1/chatkit/sessions/{session_id}/cancel` | Implemented locally | Marks a local session `status:"cancelled"` with `cancelled_at` and returns the session resource |
| `GET /v1/chatkit/threads` | Implemented locally | Lists local `chatkit.thread` records with official `limit`, `after`, `before`, `order`, and `user` filtering; default order is `desc`, repeated scalar query values return 400, `limit` is validated from 0 through 100, and `user` is validated with the official 1 through 512 character range |
| `POST /v1/chatkit/threads` | Local compatibility extension | Creates a local thread so SDK/UI smoke tests can exercise the thread lifecycle before a hosted ChatKit workflow executor exists; `session_id` copies session user/workflow/scope when present |
| `GET /v1/chatkit/threads/{thread_id}` | Implemented locally | Retrieves a stored local ChatKit thread |
| `POST /v1/chatkit/threads/{thread_id}` | Local compatibility extension | Updates local thread `title`, `user`, and `metadata` |
| `DELETE /v1/chatkit/threads/{thread_id}` | Local compatibility extension | Deletes local thread state and its items |
| `GET /v1/chatkit/threads/{thread_id}/items` | Implemented locally | Lists local thread items with official `limit`, `after`, `before`, and `order` pagination; default order is `desc`, repeated scalar query values return 400, and `limit` is validated from 0 through 100 |
| `POST /v1/chatkit/threads/{thread_id}/items` | Local compatibility extension | Appends one `{item}` or an `items[]` batch to the local thread and returns the created item or list |

Local ChatKit state lives under
`CODEXCOMPAT_CHATKIT_STATE_DIR=$CODEXCOMPAT_STATE_DIR/local-chatkit` by
default. `scripts/prune-runtime-state.mjs` prunes ChatKit session files and
thread directories with separate file-count, age, and byte caps.

## Realtime REST Endpoint Coverage

OpenAI's current endpoint list includes Realtime REST endpoints for creating
short-lived browser/mobile credentials, transcription sessions, translation
credentials, and WebRTC/SIP call controls. Chat Completions-only providers
cannot provide native low-latency media streams, so the bridge implements the
REST handshake and local lifecycle state while marking the media transport as a
local compatibility placeholder.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/realtime/sessions` | Implemented locally | Creates `object:"realtime.session"` with `type`, model, modalities, instructions, audio config, tools, tracing/truncation fields, metadata, local compatibility metadata, and a short-lived `client_secret:{value,expires_at}`; rejects unsupported query parameters before JSON parsing |
| `POST /v1/realtime/client_secrets` | Implemented locally | Accepts optional `expires_after` and `session`; returns `value:"ek_..."`, `expires_at`, and the effective local session without exposing the deployment provider key; rejects unsupported query parameters before JSON parsing |
| `POST /v1/realtime/transcription_sessions` | Implemented locally | Creates `object:"realtime.transcription_session"` with transcription defaults, audio format, VAD config, and an ephemeral `client_secret`; rejects unsupported query parameters before JSON parsing |
| `POST /v1/realtime/translations/client_secrets` | Implemented locally | Creates `value:"ek_..."` plus a local `type:"translation"` session, preserving translation model and output language fields; rejects unsupported query parameters before JSON parsing |
| `POST /v1/realtime/calls` | Implemented locally for REST/WebRTC setup | Accepts official `application/sdp`, JSON, or multipart `sdp` + `session` request shapes; rejects unsupported query parameters before SDP/body parsing; returns `201 application/sdp` with a local placeholder SDP answer and `Location:/v1/realtime/calls/{call_id}` |
| `POST /v1/realtime/calls/{call_id}/accept` | Implemented locally | Marks a local call `accepted` and can replace the effective session with the supplied accept-time session config; rejects unsupported query parameters before JSON parsing or call lookup |
| `POST /v1/realtime/calls/{call_id}/reject` | Implemented locally | Marks a local call `rejected` and preserves an optional rejection reason; rejects unsupported query parameters before JSON parsing or call lookup |
| `POST /v1/realtime/calls/{call_id}/refer` | Implemented locally | Marks a local call `referred` and preserves `target_uri` / `refer_to` plus metadata; rejects unsupported query parameters before JSON parsing or call lookup |
| `POST /v1/realtime/calls/{call_id}/hangup` | Implemented locally | Marks a local call `completed`; rejects unsupported query parameters before JSON parsing or call lookup |

Local Realtime state lives under
`CODEXCOMPAT_REALTIME_STATE_DIR=$CODEXCOMPAT_STATE_DIR/local-realtime` by
default. `scripts/prune-runtime-state.mjs` prunes Realtime session files,
client-secret files, and call files with separate age, count, and byte caps.
The generated `ek_...` values are local compatibility tokens, not upstream
provider credentials.

## Fine-tuning Endpoint Coverage

OpenAI's current endpoint list includes Fine-tuning Jobs plus checkpoint
permission management. Chat Completions-only providers such as DeepSeek cannot
train OpenAI fine-tuned models through those endpoints, so the bridge implements
a local file-backed protocol layer. It accepts the official request shape,
stores job metadata, creates deterministic lifecycle events, and returns a
local synthetic checkpoint without calling the upstream Chat provider.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/fine_tuning/jobs` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before body validation or local state mutation; requires official `model` and `training_file` string fields; validates optional `validation_file`, `suffix` length, `seed` range, OpenAI string metadata, deprecated supervised `hyperparameters`, `method.type` plus supervised/DPO/reinforcement hyperparameters, required reinforcement `grader` when that object is supplied, and W&B `integrations`; preserves `validation_file`, `suffix`, `method`, `hyperparameters`, `integrations`, and `metadata`; returns `object:"fine_tuning.job"`, `status:"succeeded"`, a local `ft:...` model id, and compatibility metadata with `actual_model_training:false` |
| `GET /v1/fine_tuning/jobs` | Implemented locally | Lists local jobs with official `limit` and `after` pagination plus `metadata[k]=v` / `metadata=null` filters; repeated official scalar query values return 400, invalid metadata filter syntax returns 400, default order is newest-first, and unsupported generic paginator parameters such as `before` and `order` do not affect the official list result |
| `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}` | Implemented locally | Retrieves a stored local Fine-tuning job; unsupported query parameters return 400 before reading local state because the official retrieve endpoint only defines the path parameter |
| `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/cancel` | Implemented locally | Accepts the official no-query/no-body action shape, allowing an empty JSON object for SDK compatibility; unsupported query parameters, non-empty JSON body fields, and non-object JSON bodies return 400 before local mutation; marks the local job `status:"cancelled"` and records a local lifecycle event |
| `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/pause` | Implemented locally | Accepts the official no-query/no-body action shape, allowing an empty JSON object for SDK compatibility; unsupported query parameters, non-empty JSON body fields, and non-object JSON bodies return 400 before local mutation; marks the local job `status:"paused"` and records a local lifecycle event |
| `POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/resume` | Implemented locally | Accepts the official no-query/no-body action shape, allowing an empty JSON object for SDK compatibility; unsupported query parameters, non-empty JSON body fields, and non-object JSON bodies return 400 before local mutation; marks the local job `status:"queued"` and records a local lifecycle event |
| `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}/events` | Implemented locally | Lists OpenAI-style `fine_tuning.job.event` records for creation, simulated run, completion, and lifecycle actions with official `limit` and `after` pagination; repeated official scalar query values return 400, default order is newest-first, and unsupported generic paginator parameters such as `before` and `order` do not affect the official list result |
| `GET /v1/fine_tuning/jobs/{fine_tuning_job_id}/checkpoints` | Implemented locally | Lists a synthetic `fine_tuning.job.checkpoint` with `fine_tuned_model_checkpoint`, `metrics`, `fine_tuning_job_id`, and `step_number` using official `limit` and `after` pagination; repeated official scalar query values return 400, default order is newest-first, and unsupported generic paginator parameters such as `before` and `order` do not affect the official list result |
| `GET /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions` | Implemented locally | Lists local `checkpoint.permission` records with official `project_id`, `limit`, `after`, and `order` controls; `order` is validated against the official `ascending` / `descending` enum with default `descending`, `limit` must be a positive integer query value with default 10, scalar `project_id` / `after` query parameters may appear only once, and unsupported generic paginator parameters such as `before` do not affect the official list result |
| `POST /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions` | Implemented locally | Accepts the official no-query create shape plus `project_ids` string array and returns the created or existing local permissions as an OpenAI-style list; unsupported query parameters return 400 before body validation or local state mutation; unknown JSON body fields are rejected, `project_ids` is required and must be an array of strings, and an empty array returns an empty OpenAI-style list without mutating local permissions |
| `DELETE /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions/{permission_id}` | Implemented locally | Accepts the official no-query/no-body delete shape, allowing an empty JSON object for SDK compatibility; unsupported query parameters, non-empty JSON body fields, and non-object JSON bodies return 400 before local mutation; deletes a local checkpoint permission and returns `{object:"checkpoint.permission", deleted:true}` |

Local Fine-tuning state lives under
`CODEXCOMPAT_FINE_TUNING_STATE_DIR=$CODEXCOMPAT_STATE_DIR/local-fine-tuning`
by default. `scripts/prune-runtime-state.mjs` prunes job files and checkpoint
permission files with separate age, count, and byte caps. This layer is a
protocol compatibility shim, not an implementation of hosted training,
dataset validation, OpenAI model deployment, or permission enforcement across
real projects.

## Organization Usage And Costs Coverage

OpenAI's current endpoint list includes admin-key usage and costs endpoints for
organization dashboards. Chat Completions-only providers do not expose OpenAI
organization billing data, so the bridge implements a local usage ledger with
zero-value fallback. It preserves the official `object:"page"` /
`object:"bucket"` shape, bucket time boundaries, `page` cursor pagination,
result object names, result numeric fields, filters, and supported `group_by`
dimensions while marking the payload as local protocol compatibility data.
The ledger stores only endpoint, time, model/dimension identifiers, hashed API
key IDs, and numeric usage totals; it does not store prompts, messages, file
payloads, Authorization headers, or provider secrets.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/organization/costs` | Implemented locally | Requires `start_time`; supports `end_time`, `bucket_width:"1d"`, `page`, `project_ids[]`, `api_key_ids[]`, `group_by[]=project_id|line_item|api_key_id`, and `limit`; returns local `organization.costs.result` rows with `amount:{value:0,currency:"usd"}`. When grouped by `line_item`, `quantity` aggregates the local usage quantity, but the amount remains zero because this is not provider billing |
| `GET /v1/organization/usage/completions` | Implemented locally | Aggregates local `/v1/responses`, `/v1/responses/compact`, `/v1/responses/input_tokens`, `/v1/chat/completions`, and `/v1/completions` usage into `organization.usage.completions.result` buckets with token, request, project/user/hashed-API-key/model/batch/service-tier fields; direct Chat identity dimensions include `user_id`, `safety_identifier`, `user`, and `prompt_cache_key` fallback order; falls back to zero rows when no events match |
| `GET /v1/organization/usage/embeddings` | Implemented locally | Aggregates local `/v1/embeddings` input-token/request usage and supports project/user/hashed-API-key/model filters and grouping |
| `GET /v1/organization/usage/moderations` | Implemented locally | Aggregates local `/v1/moderations` estimated input-token/request usage and supports project/user/hashed-API-key/model filters and grouping |
| `GET /v1/organization/usage/images` | Implemented locally | Aggregates direct `/v1/images/generations`, `/v1/images/edits`, and `/v1/images/variations` image counts with source/size/model/project/user/hashed-API-key dimensions |
| `GET /v1/organization/usage/audio_speeches` | Implemented locally | Aggregates local `/v1/audio/speech` input character/request usage with project/user/hashed-API-key/model dimensions |
| `GET /v1/organization/usage/audio_transcriptions` | Implemented locally | Aggregates local `/v1/audio/transcriptions` and `/v1/audio/translations` duration/request usage with project/user/hashed-API-key/model dimensions |
| `GET /v1/organization/usage/vector_stores` | Implemented locally | Aggregates local vector-store file attachments into `usage_bytes` buckets with project filtering/grouping. Local quantity is attached file bytes, not OpenAI-hosted storage duration billing |
| `GET /v1/organization/usage/file_search_calls` | Implemented locally | Aggregates local Responses/background/Assistants `file_search` executions into request-count buckets with project/user/hashed-API-key/vector-store filters and grouping |
| `GET /v1/organization/usage/web_search_calls` | Implemented locally | Aggregates local Responses/background `web_search_preview` executions into model-request and local action-count buckets with project/user/hashed-API-key/model/context-level filters and grouping |
| `GET /v1/organization/usage/code_interpreter_sessions` | Implemented locally | Aggregates local Responses/background/Assistants `code_interpreter` executions by unique local container session per request into `num_sessions` buckets with project filtering/grouping |

This compatibility surface writes bounded runtime ledger files under
`CODEXCOMPAT_ORGANIZATION_USAGE_STATE_DIR`. It does not expose real OpenAI
admin data, meter provider bills, calculate paid invoices, or replace
provider-specific billing exports. It exists so SDKs, diagnostics, and
dashboards can query the documented endpoint family without breaking on 404
while the deployment remains backed by a Chat Completions provider. Hosted-tool
metrics are local compatibility approximations for dashboard shape, regression
tests, and capacity auditing; prompts, code blocks, file contents, web result
text, and provider credentials are intentionally excluded from ledger records.

## Organization Admin Coverage

The bridge also implements a local file-backed subset of OpenAI Organization
administration so SDKs and admin pages can exercise organization user/invite
lifecycle, organization role/group lifecycle, user and group role assignments,
group memberships, organization admin API-key lifecycle, organization/project
certificate upload/activation metadata, local audit-log
review, project lifecycle, project user lifecycle, project service-account
lifecycle, project group access lifecycle, project API-key inspection flows,
project rate-limit update flows, and organization/project spend-alert lifecycle
flows, plus local organization/project data-retention, project model-permission,
and project hosted-tool-permission controls without calling hosted OpenAI admin APIs. These records are
protocol-compatibility metadata only; they do not create provider accounts,
grant provider access, send invitation email, enforce RBAC permissions, enforce
traffic throttling, send spend-alert email, enforce provider model/tool access,
change provider data-retention policy, or represent real OpenAI organization
state.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/organization/users` | Implemented locally | Lists local `organization.user` records with optional official `emails` filtering, compatibility `emails[]` filtering, nested local project memberships, and OpenAI-style pagination; validates official `limit` and `after` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `GET /v1/organization/users/{user_id}` | Implemented locally | Retrieves a local organization user or returns `404 organization_user_not_found` |
| `POST /v1/organization/users/{user_id}` | Implemented locally | Updates local organization user `role`, `role_id`, `developer_persona`, and `technical_level`; invalid org roles return `400 invalid_organization_role` |
| `DELETE /v1/organization/users/{user_id}` | Implemented locally | Removes a local organization user, deletes their local project memberships, and returns `organization.user.deleted` |
| `GET /v1/organization/invites` | Implemented locally | Lists local `organization.invite` records with OpenAI-style pagination; validates official `limit` and `after` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `POST /v1/organization/invites` | Implemented locally | Creates a local pending organization invite with `email`, org role `owner`/`reader`, optional project memberships, expiry timestamp, and no outbound email delivery |
| `GET /v1/organization/invites/{invite_id}` | Implemented locally | Retrieves a local organization invite or returns `404 organization_invite_not_found` |
| `DELETE /v1/organization/invites/{invite_id}` | Implemented locally | Deletes a pending/expired local invite and returns `organization.invite.deleted`; accepted invites are rejected with `organization_invite_accepted` |
| `GET /v1/organization/admin_api_keys` | Implemented locally | Lists local redacted `organization.admin_api_key` records with OpenAI-style pagination; persisted records never include a usable `value`; validates official `limit`, `after`, and `order` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, supports official `order:"asc"|"desc"`, and ignores unsupported `before` so it cannot shape the official list result |
| `POST /v1/organization/admin_api_keys` | Implemented locally | Creates a local admin API-key record from `name`; the response includes a one-time compatibility value prefixed `oc_local_admin_key_`, never `sk-`, and that value is not persisted |
| `GET /v1/organization/admin_api_keys/{key_id}` | Implemented locally | Retrieves a local redacted admin API key or returns `404 organization_admin_api_key_not_found`; the one-time `value` is never returned after create |
| `DELETE /v1/organization/admin_api_keys/{key_id}` | Implemented locally | Deletes a local admin API-key record, records an audit-log event, and returns `organization.admin_api_key.deleted` |
| `GET /v1/organization/certificates` | Implemented locally | Lists local uploaded certificate records as `organization.certificate` with organization-scope `active` flags and OpenAI-style cursor pagination; PEM content is omitted; validates official `limit`, `after`, and `order` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, supports official `order:"asc"|"desc"` with default `desc`, and ignores unsupported `before` so it cannot shape the official list result |
| `POST /v1/organization/certificates` | Implemented locally | Uploads local PEM certificate metadata from `certificate` and optional `name`, rejects private-key material, defaults inactive, and returns `object:"certificate"` without content |
| `GET /v1/organization/certificates/{certificate_id}` | Implemented locally | Retrieves a local certificate detail object or `404 organization_certificate_not_found`; supports official `include[]=content` / `include=content` to return uploaded PEM content and rejects unsupported include values before reading local certificate content |
| `POST /v1/organization/certificates/{certificate_id}` | Implemented locally | Updates local certificate `name` metadata and records a local audit event |
| `DELETE /v1/organization/certificates/{certificate_id}` | Implemented locally | Deletes a local certificate only when inactive at organization and project scopes, removes project-scope certificate state, records an audit event, and returns `certificate.deleted` |
| `POST /v1/organization/certificates/activate` | Implemented locally | Atomically validates 1-10 local `certificate_ids`, marks them organization-active, records audit events, and returns `organization.certificate.activation` |
| `POST /v1/organization/certificates/deactivate` | Implemented locally | Atomically validates 1-10 local `certificate_ids`, marks them organization-inactive, records audit events, and returns `organization.certificate.deactivation` |
| `GET /v1/organization/audit_logs` | Implemented locally | Lists local Organization admin lifecycle events generated by this compatibility store with official `effective_at[gt/gte/lt/lte]`, `project_ids[]`, `event_types[]`, `actor_ids[]`, `actor_emails[]`, `resource_ids[]`, `tenant_only`, `after`, `before`, and `limit` filtering/pagination; validates `limit` from 1 through 100 with default 20, single `after`/`before`, boolean `tenant_only`, and integer `effective_at` range values, ignores unsupported `order`, and returns OpenAI list fields `first_id`, `last_id`, and `has_more`. It is not a hosted OpenAI security audit export |
| `GET /v1/organization/data_retention` | Implemented locally | Retrieves local `organization.data_retention`, defaulting to `type:"modified_abuse_monitoring"` when no local override exists |
| `POST /v1/organization/data_retention` | Implemented locally | Updates local organization data-retention metadata from `retention_type`; supports OpenAI SDK values including zero/enhanced variants and records an audit-log event |
| `GET /v1/organization/spend_alerts` | Implemented locally | Lists local `organization.spend_alert` records with OpenAI-style `first_id`, `last_id`, and `has_more` pagination; validates official `limit` from 0 through 100 with default 20, `order:"asc"|"desc"`, `after`, and `before`, and rejects repeated scalar values |
| `POST /v1/organization/spend_alerts` | Implemented locally | Creates a local organization spend alert requiring `threshold_amount`, `currency:"USD"`, `interval:"month"`, and `notification_channel:{type:"email",recipients}`; no notification email is sent |
| `POST /v1/organization/spend_alerts/{alert_id}` | Implemented locally | Updates the local organization spend alert threshold and notification channel or returns `404 organization_spend_alert_not_found` |
| `DELETE /v1/organization/spend_alerts/{alert_id}` | Implemented locally | Deletes a local organization spend alert, records an audit-log event, and returns `organization.spend_alert.deleted` |
| `GET /v1/organization/roles` | Implemented locally | Lists local custom `role` records with OpenAI-style `next` cursor pagination; validates official `limit` from 0 through 1000 with default 1000, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` so it cannot shape official list results |
| `POST /v1/organization/roles` | Implemented locally | Creates a local custom role from `role_name`, `description`, and non-empty `permissions`; duplicate permissions are de-duplicated and invalid input returns `400 invalid_role_permissions` |
| `GET /v1/organization/roles/{role_id}` | Implemented locally | Retrieves a local role or returns `404 organization_role_not_found` |
| `POST /v1/organization/roles/{role_id}` | Implemented locally | Updates local custom role `name`, `description`, and `permissions`; predefined roles are reserved and reject updates |
| `DELETE /v1/organization/roles/{role_id}` | Implemented locally | Deletes a local role, removes local user/group assignments that reference it, and returns `role.deleted` |
| `GET /v1/organization/groups` | Implemented locally | Lists local `group` records with OpenAI-style `next` cursor pagination; validates official `limit` from 0 through 1000 with default 100, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` so it cannot shape official list results |
| `POST /v1/organization/groups` | Implemented locally | Creates a local non-SCIM `group` with `group_type:"group"` and `is_scim_managed:false` |
| `GET /v1/organization/groups/{group_id}` | Implemented locally | Retrieves a local group or returns `404 organization_group_not_found` |
| `POST /v1/organization/groups/{group_id}` | Implemented locally | Updates the local group `name`; SCIM-managed groups are reserved and reject updates |
| `DELETE /v1/organization/groups/{group_id}` | Implemented locally | Deletes a local group, its local memberships, and its local role assignments with `group.deleted` |
| `GET /v1/organization/groups/{group_id}/users` | Implemented locally | Lists local users assigned to a local group with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` |
| `POST /v1/organization/groups/{group_id}/users` | Implemented locally | Adds an existing local organization user to a local group and returns `group.user` |
| `GET /v1/organization/groups/{group_id}/users/{user_id}` | Implemented locally | Retrieves a local group user detail projection or returns `404 organization_group_user_not_found` |
| `DELETE /v1/organization/groups/{group_id}/users/{user_id}` | Implemented locally | Removes a local user from a local group and returns `group.user.deleted` |
| `GET /v1/organization/users/{user_id}/roles` | Implemented locally | Lists local organization roles directly assigned to a local user, including assignment-source metadata, with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` |
| `POST /v1/organization/users/{user_id}/roles` | Implemented locally | Assigns an existing local role to an existing local organization user and returns `user.role` |
| `GET /v1/organization/users/{user_id}/roles/{role_id}` | Implemented locally | Retrieves a local user role assignment or returns `404 organization_user_role_not_found` |
| `DELETE /v1/organization/users/{user_id}/roles/{role_id}` | Implemented locally | Removes a local user role assignment and returns `user.role.deleted` |
| `GET /v1/organization/groups/{group_id}/roles` | Implemented locally | Lists local organization roles assigned to a local group, including assignment-source metadata, with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` |
| `POST /v1/organization/groups/{group_id}/roles` | Implemented locally | Assigns an existing local role to an existing local group and returns `group.role` |
| `GET /v1/organization/groups/{group_id}/roles/{role_id}` | Implemented locally | Retrieves a local group role assignment or returns `404 organization_group_role_not_found` |
| `DELETE /v1/organization/groups/{group_id}/roles/{role_id}` | Implemented locally | Removes a local group role assignment and returns `group.role.deleted` |
| `GET /v1/projects/{project_id}/roles` | Implemented locally | Lists local project-scoped custom `role` records with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with default 1000, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, ignores unsupported `before`, and archived projects return `400 project_archived` |
| `POST /v1/projects/{project_id}/roles` | Implemented locally | Creates a local project-scoped custom role from `role_name`, `description`, and non-empty de-duplicated `permissions`; returns `resource_type:"api.project"` and local compatibility metadata |
| `GET /v1/projects/{project_id}/roles/{role_id}` | Implemented locally | Retrieves a local project role or returns `404 project_role_not_found` |
| `POST /v1/projects/{project_id}/roles/{role_id}` | Implemented locally | Updates local project role `name`, `description`, and `permissions`; invalid permission arrays return `400 invalid_role_permissions` |
| `DELETE /v1/projects/{project_id}/roles/{role_id}` | Implemented locally | Deletes a local project role, removes local project user/group assignments that reference it, records an audit event, and returns `project.role.deleted` |
| `GET /v1/projects/{project_id}/users/{user_id}/roles` | Implemented locally | Lists local project roles directly assigned to an existing project user, including assignment-source metadata and `project_id`, with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` |
| `POST /v1/projects/{project_id}/users/{user_id}/roles` | Implemented locally | Assigns an existing local project role to an existing project user and returns `project.user.role` |
| `GET /v1/projects/{project_id}/users/{user_id}/roles/{role_id}` | Implemented locally | Retrieves a local project user role assignment or returns `404 project_user_role_not_found` |
| `DELETE /v1/projects/{project_id}/users/{user_id}/roles/{role_id}` | Implemented locally | Removes a local project user role assignment and returns `project.user.role.deleted` |
| `GET /v1/projects/{project_id}/groups/{group_id}/roles` | Implemented locally | Lists local project roles directly assigned to an existing project group access record, including assignment-source metadata and `project_id`, with OpenAI SDK `NextCursorPage` semantics; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, and ignores unsupported `before` |
| `POST /v1/projects/{project_id}/groups/{group_id}/roles` | Implemented locally | Assigns an existing local project role to an existing project group access record and returns `project.group.role` |
| `GET /v1/projects/{project_id}/groups/{group_id}/roles/{role_id}` | Implemented locally | Retrieves a local project group role assignment or returns `404 project_group_role_not_found` |
| `DELETE /v1/projects/{project_id}/groups/{group_id}/roles/{role_id}` | Implemented locally | Removes a local project group role assignment and returns `project.group.role.deleted` |
| `GET /v1/organization/projects` | Implemented locally | Lists local `organization.project` records with OpenAI-style `object:"list"`, `first_id`, `last_id`, and `has_more`; validates official `limit`, `after`, and `include_archived` query parameters, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, excludes archived projects unless `include_archived=true`, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `POST /v1/organization/projects` | Implemented locally | Creates a local `organization.project` with `status:"active"`, `archived_at:null`, and compatibility metadata; requires `name` |
| `GET /v1/organization/projects/{project_id}` | Implemented locally | Retrieves a local project or returns `404 project_not_found` |
| `POST /v1/organization/projects/{project_id}` | Implemented locally | Updates the local project `name`; archived projects reject mutations with `project_archived` |
| `POST /v1/organization/projects/{project_id}/archive` | Implemented locally | Marks the project `status:"archived"` and sets `archived_at`; repeated archive calls are idempotent |
| `GET /v1/organization/projects/{project_id}/users` | Implemented locally | Lists local `organization.project.user` records for active projects; validates official `limit` and `after` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `POST /v1/organization/projects/{project_id}/users` | Implemented locally | Adds or updates a local project user from `user_id` and/or `email`; requires `role:"owner"` or `role:"member"` and returns `added_at`, optional `email/name`, and local compatibility metadata |
| `GET /v1/organization/projects/{project_id}/users/{user_id}` | Implemented locally | Retrieves a local project user or returns `404 project_user_not_found` |
| `POST /v1/organization/projects/{project_id}/users/{user_id}` | Implemented locally | Updates the local user's project role; invalid roles return `400 invalid_project_role` |
| `DELETE /v1/organization/projects/{project_id}/users/{user_id}` | Implemented locally | Removes a local project user and returns `organization.project.user.deleted` |
| `GET /v1/organization/projects/{project_id}/groups` | Implemented locally | Lists local `project.group` access records for active projects with OpenAI SDK `NextCursorPage` semantics using `group_id` as the cursor; validates `limit` from 0 through 1000 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, ignores unsupported `before`, and archived projects return `400 project_archived` |
| `POST /v1/organization/projects/{project_id}/groups` | Implemented locally | Grants an existing local organization group access to an active project from `group_id` and `role`, persists protocol metadata only, and records a local audit event |
| `GET /v1/organization/projects/{project_id}/groups/{group_id}` | Implemented locally | Retrieves a local project group access record; optional `group_type` mismatch returns `404 project_group_not_found` |
| `DELETE /v1/organization/projects/{project_id}/groups/{group_id}` | Implemented locally | Revokes local group access to a project, records an audit-log event, and returns `project.group.deleted` |
| `GET /v1/organization/projects/{project_id}/certificates` | Implemented locally | Lists local project certificate records for active projects as `organization.project.certificate`, including project-scope `active` flags and no PEM content, with OpenAI SDK `ConversationCursorPage` semantics; validates `limit` from 1 through 100 with local default 20, `after`, and `order:"asc"|"desc"`, rejects repeated scalar values, ignores unsupported `before`, returns `last_id` without legacy `first_id`, and archived projects return `400 project_archived` |
| `POST /v1/organization/projects/{project_id}/certificates/activate` | Implemented locally | Atomically validates 1-10 uploaded local `certificate_ids`, marks them active for the project, records project-scoped audit events, and returns `organization.project.certificate.activation` |
| `POST /v1/organization/projects/{project_id}/certificates/deactivate` | Implemented locally | Atomically validates 1-10 uploaded local `certificate_ids`, marks them inactive for the project, records project-scoped audit events, and returns `organization.project.certificate.deactivation` |
| `GET /v1/organization/projects/{project_id}/data_retention` | Implemented locally | Retrieves local `project.data_retention`, defaulting to `type:"organization_default"` for active projects |
| `POST /v1/organization/projects/{project_id}/data_retention` | Implemented locally | Updates local project data-retention metadata from `retention_type`; supports `organization_default`, `none`, and organization retention values |
| `GET /v1/organization/projects/{project_id}/model_permissions` | Implemented locally | Retrieves local `project.model_permissions`, defaulting to `mode:"deny_list"` and an empty `model_ids` list, which represents no local deny-list restrictions |
| `POST /v1/organization/projects/{project_id}/model_permissions` | Implemented locally | Updates local project model-permission metadata from `mode:"allow_list"|"deny_list"` and `model_ids[]`; duplicate model IDs are de-duplicated |
| `DELETE /v1/organization/projects/{project_id}/model_permissions` | Implemented locally | Deletes local project model-permission metadata, records an audit event, and returns `project.model_permissions.deleted`; subsequent retrieve returns the default metadata |
| `GET /v1/organization/projects/{project_id}/hosted_tool_permissions` | Implemented locally | Retrieves local hosted-tool permission metadata for `code_interpreter`, `file_search`, `image_generation`, `mcp`, and `web_search`, defaulting all to enabled |
| `POST /v1/organization/projects/{project_id}/hosted_tool_permissions` | Implemented locally | Partially updates local hosted-tool permission metadata; `null` resets a tool to enabled and invalid `enabled` values return `400 invalid_hosted_tool_permission` |
| `GET /v1/organization/projects/{project_id}/spend_alerts` | Implemented locally | Lists local `project.spend_alert` records for active projects with OpenAI-style pagination; validates `limit` from 0 through 100 with default 20, `order:"asc"|"desc"`, `after`, and `before`, rejects repeated scalar values, and archived projects return `400 project_archived` |
| `POST /v1/organization/projects/{project_id}/spend_alerts` | Implemented locally | Creates a local project spend alert requiring `threshold_amount`, `currency:"USD"`, `interval:"month"`, and an email notification channel; no notification email is sent |
| `POST /v1/organization/projects/{project_id}/spend_alerts/{alert_id}` | Implemented locally | Updates a local project spend alert or returns `404 project_spend_alert_not_found` |
| `DELETE /v1/organization/projects/{project_id}/spend_alerts/{alert_id}` | Implemented locally | Deletes a local project spend alert, records an audit-log event, and returns `project.spend_alert.deleted` |
| `GET /v1/organization/projects/{project_id}/api_keys` | Implemented locally | Lists local redacted `organization.project.api_key` records; persisted records never include a secret `value`; validates official `limit` and `after` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `GET /v1/organization/projects/{project_id}/api_keys/{api_key_id}` | Implemented locally | Retrieves a redacted project API key with owner metadata |
| `DELETE /v1/organization/projects/{project_id}/api_keys/{api_key_id}` | Implemented locally for user-owned keys | Deletes compatible user-owned key records; service-account keys return `400 service_account_api_key_delete_not_supported` and are removed by deleting the service account |
| `GET /v1/organization/projects/{project_id}/service_accounts` | Implemented locally | Lists local `organization.project.service_account` records for active projects; validates official `limit` and `after` pagination, rejects repeated scalar values, enforces `limit` from 1 through 100 with official default 20, and ignores unsupported `order`/`before` so they cannot shape the official list result |
| `POST /v1/organization/projects/{project_id}/service_accounts` | Implemented locally | Creates a local service account and a matching redacted project API key; the response includes a one-time compatibility key value prefixed `oc_local_key_`, never `sk-`, and that value is not persisted |
| `GET /v1/organization/projects/{project_id}/service_accounts/{service_account_id}` | Implemented locally | Retrieves a local service account for an active project |
| `POST /v1/organization/projects/{project_id}/service_accounts/{service_account_id}` | Implemented locally | Updates local service-account `name` and `role`, then refreshes owner metadata on its redacted key records |
| `DELETE /v1/organization/projects/{project_id}/service_accounts/{service_account_id}` | Implemented locally | Deletes the service account and its locally owned project API keys |
| `GET /v1/organization/projects/{project_id}/rate_limits` | Implemented locally | Lazily seeds and lists local `project.rate_limit` records with model, requests-per-minute, tokens-per-minute, and relevant optional limits such as requests/day, images/min, audio MB/min, and batch input tokens/day; validates official `limit`, `after`, and `before` pagination, rejects repeated scalar query values, enforces `limit` from 1 through 100 with official default 100, and ignores unsupported `order` so it cannot shape the official list result |
| `POST /v1/organization/projects/{project_id}/rate_limits/{rate_limit_id}` | Implemented locally | Updates numeric local rate-limit fields and returns `project.rate_limit`; invalid values return `400 invalid_rate_limit_value` |

Local Organization admin state lives under
`CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR=$CODEXCOMPAT_STATE_DIR/local-organization-admin`
by default. `scripts/prune-runtime-state.mjs` prunes JSON records in this tree
with age, count, and byte caps. Because service-account and organization
admin API-key create responses contain one-time synthetic secret values, keep
logs and test fixtures from storing full create response bodies unless needed
for a local-only diagnostic.

## Conversations Endpoint Coverage

OpenAI's current endpoint list includes `/v1/conversations`,
`/v1/conversations/{conversation_id}`,
`/v1/conversations/{conversation_id}/items`, and
`/v1/conversations/{conversation_id}/items/{item_id}`. The bridge implements a
local file-backed version to support Responses `conversation` state on
Chat-only providers.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/conversations` | Implemented locally | Rejects unsupported query parameters before JSON body parsing, then creates `object:"conversation"` with metadata and optional initial items; validates the official create contract before storage, including object request body, nullable string Metadata, `items` as array/null, and the 20 initial-item limit |
| `GET /v1/conversations/{conversation_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then retrieves local conversation metadata |
| `POST /v1/conversations/{conversation_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates local conversation `metadata`; requires the official `metadata` field, accepts nullable string Metadata by clearing local metadata to `{}`, and rejects empty bodies, non-string metadata values, and unsupported fields before storage |
| `DELETE /v1/conversations/{conversation_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then soft-deletes the local conversation and returns `object:"conversation.deleted"` while preserving its existing items, matching the official "items will not be deleted" behavior; deleted conversations cannot be retrieved, updated, appended to, or replayed into Responses |
| `GET /v1/conversations/{conversation_id}/items` | Implemented locally | Lists local conversation items, including items retained after the parent conversation is deleted, with official `limit`, `after`, `order`, and `include` query parameters only; unknown query parameters return 400 before reading local items; defaults to the official `order=desc` while preserving explicit `order=asc`; validates `order` as a single `asc` / `desc` query value, validates `limit` as a single integer query value from 1 through 100, validates `after` as a single string query value, and validates `include` query values against the official enum; message input image URLs and computer output image URLs are hidden unless their matching include values are requested |
| `POST /v1/conversations/{conversation_id}/items` | Implemented locally | Allows only the official `include` / `include[]` query projection and rejects other query parameters before JSON body parsing or append; appends official `{items:[...]}` payloads to the local conversation, validates `items` as an array with the official 20-item limit, validates `include` query values against the official enum, projects hidden fields in the create response, and keeps legacy local extensions for one raw item object or `{item}` |
| `GET /v1/conversations/{conversation_id}/items/{item_id}` | Implemented locally | Allows only the official `include` / `include[]` query projection and rejects other query parameters before reading local state; retrieves a local conversation item; validates `include` query values against the official enum; message input image URLs and computer output image URLs are hidden unless their matching include values are requested |
| `DELETE /v1/conversations/{conversation_id}/items/{item_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then deletes a local conversation item and returns the updated official `ConversationResource` |

When a Responses request includes `conversation:"conv_..."`, the bridge injects
existing conversation items into the upstream Chat prompt, returns
`response.conversation`, and appends the new input plus output items back to the
conversation. This append happens even when the Responses request sets
`store:false`, matching the OpenAI conversation-state guide's distinction
between response storage and durable Conversation items. Requests that combine
`previous_response_id` with `conversation` or the local `conversation_id` alias
are rejected before replay or provider calls, matching the current Responses
create, input-token-count, and compact request contract. The auxiliary
`/v1/responses/input_tokens` and `/v1/responses/compact` endpoints also replay
the local Conversation items before calling upstream Chat Completions, but they
do not mutate the Conversation item list; compaction returns
`response.conversation` and `metadata.compatibility.local_conversation` for
traceability. The local store is bounded by record count, not by the 30-day
Responses TTL.

## Models Endpoint Coverage

OpenAI's current endpoint list includes `GET /v1/models`,
`GET /v1/models/{model}`, and fine-tuned model deletion through
`DELETE /v1/models/{model}`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /v1/models` | Implemented | Accepts the official no-query list shape; unsupported query parameters return 400 before upstream proxying; proxies and normalizes upstream JSON model lists when available; invalid or non-JSON upstream list responses fall back to local bridge models for the configured default Chat provider model, local embeddings model, local moderations model, and local audio models |
| `GET /v1/models/{model}` | Implemented | Proxies upstream single-model retrieval when supported; otherwise searches upstream model list, then falls back to local bridge model objects for the configured default, embeddings, or moderations model IDs |
| `DELETE /v1/models/{model}` | Implemented for upstream-compatible fine-tuned models | Proxies upstream model deletion and normalizes successful `{deleted:true}` responses to OpenAI-style `{id,object:"model",deleted:true}`; when no upstream deletion is available, returns local `404 model_not_found` instead of deleting local bridge catalog models |

## Embeddings Endpoint Coverage

OpenAI's `POST /v1/embeddings` operation returns `object:"list"` containing
`object:"embedding"` data items plus prompt-token usage. The bridge implements
a local deterministic compatibility adapter so OpenAI SDKs, retrieval tests,
and lightweight evaluation tools can request embedding-shaped vectors even when
the upstream provider only exposes Chat Completions.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/embeddings` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before local vector generation or usage recording; accepts string input, arrays of strings/items, token id arrays, `dimensions`, and `encoding_format:"float"` or `"base64"`; returns deterministic normalized hashed-semantic vectors with OpenAI-style `object`, `data`, `model`, and `usage` fields |

This is not a hosted OpenAI embedding model. It uses the same local
hashed-semantic feature space used by the local vector-store search adapter,
defaults to `CODEXCOMPAT_EMBEDDINGS_MODEL=hashed-semantic-256` and
`CODEXCOMPAT_EMBEDDINGS_DIMENSIONS=256`, and caps requested dimensions at 3072.
The `model` response field echoes the request model when provided so SDKs that
require a model id can still validate the response shape.

## Moderations Endpoint Coverage

OpenAI's `POST /v1/moderations` operation returns an `id`, `model`, and
`results` array with `flagged`, `categories`, `category_scores`, and current
omni moderation `category_applied_input_types` fields. The bridge implements a
local deterministic compatibility adapter so Chat-Completions-only providers
can satisfy SDK and workflow calls that expect moderation-shaped responses.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/moderations` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before local classification or usage recording; accepts a string, an array of strings, or a multimodal text/image content-part array; returns OpenAI-style category booleans, category scores, applied input types, and a `modr_` id without calling the upstream Chat provider |

The local classifier is a conservative keyword/rule compatibility baseline,
not OpenAI's hosted moderation model and not image-content inspection. It
includes the current omni category set (`harassment`,
`harassment/threatening`, `sexual`, `hate`, `hate/threatening`, `illicit`,
`illicit/violent`, `self-harm`, `self-harm/intent`,
`self-harm/instructions`, `sexual/minors`, `violence`, and
`violence/graphic`) and defaults to
`CODEXCOMPAT_MODERATIONS_MODEL=omni-moderation-latest`.

### Inline Moderation

OpenAI's current Chat Completions and Responses create operations also expose a
`moderation` request configuration for running moderation on request input and
generated output. The bridge accepts this field on both `/v1/responses` and
`/v1/chat/completions`.

- When a provider supports and returns a native Chat `moderation` payload, the
  bridge preserves it as `response.moderation` and
  `metadata.compatibility.chat_moderation` on Responses.
- When the field is filtered for a Chat-only provider such as DeepSeek, or when
  the upstream response omits moderation, the bridge runs the local moderation
  adapter over the normalized request input and generated output text.
- Local inline results use the same OpenAI-compatible moderation payload shape
  as `/v1/moderations`, nested under `input` and/or `output`, and include
  compatibility metadata noting the local deterministic classifier.
- Streaming Responses attach local inline output moderation to the terminal
  `response.completed`/`response.incomplete`/`response.failed` event. Direct
  streaming Chat passthrough remains a byte-preserving upstream stream and does
  not append synthetic moderation chunks.

## Batch Endpoint Coverage

OpenAI's Batch API creates an asynchronous job from a `purpose:"batch"` JSONL
File. Each JSONL line has a `custom_id`, `method`, `url`, and request `body`.
Completed batches expose `output_file_id` and `error_file_id` that clients read
through the Files API. The bridge implements a local synchronous compatibility
layer so evaluation tooling can batch requests against the already implemented
OpenAI-compatible surfaces without adding a separate job runner.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/batches` | Implemented locally | Rejects unsupported query parameters before JSON parsing, file lookup, provider calls, or batch record creation; requires string `input_file_id`, `endpoint`, and `completion_window:"24h"`; validates user-supplied `metadata` against the official string Metadata limits and validates `output_expires_after:{anchor:"created_at",seconds:3600..2592000}` before file lookup or provider calls; validates `purpose:"batch"` input files; executes JSONL lines synchronously through the existing local endpoint handlers; writes successful lines to a `purpose:"batch_output"` File and failed lines to a `purpose:"batch_error"` File with local output-expiration metadata when requested |
| `GET /v1/batches` | Implemented locally | Lists local batch records with official `limit` and `after` pagination only; repeated scalar query values and unsupported parameters such as `before`, `order`, or `metadata` return 400 before listing; applies lazy `output_expires_after` cleanup before projecting each record |
| `GET /v1/batches/{batch_id}` | Implemented locally | Rejects unsupported query parameters before reading the stored Batch; returns the stored local Batch object, including `request_counts`, `output_file_id`, and `error_file_id`; deletes expired local output/error Files and clears stale file ids when `output_expires_after` has elapsed |
| `POST /v1/batches/{batch_id}/cancel` | Implemented as a compatibility no-op after synchronous completion | Rejects unsupported query parameters before lifecycle mutation; returns terminal local batches unchanged with metadata explaining the local synchronous execution boundary, after applying the same lazy output-file expiration check |

Local Batch execution currently accepts the official Batch endpoints
`/v1/responses`, `/v1/chat/completions`, `/v1/completions`,
`/v1/embeddings`, `/v1/images/generations`, `/v1/images/edits`,
`/v1/videos`, and `/v1/moderations`. It also accepts local compatibility
extensions `/v1/audio/transcriptions`, `/v1/audio/translations`, and
`/v1/images/variations`, because those surfaces are implemented by the bridge
and are useful for local regression coverage even though they are outside the
current OpenAI Batch endpoint enum. Batch output lines preserve upstream JSON
response bodies and upstream
`x-request-id` values when a proxied Chat provider supplies them; otherwise a
local `req_*` id is generated for auditability.
The `output_expires_after` policy is stored on the local Batch object, validated
against the official file-expiration shape, and attached to generated
`batch_output` / `batch_error` Files as local metadata. The bridge does not run
a separate TTL worker, but `GET /v1/batches`, `GET /v1/batches/{batch_id}`, and
terminal cancel no-ops lazily delete expired output/error Files, clear stale
file ids, and record `metadata.compatibility_output_expiration`.
Streaming (`stream:true`) and
background Responses (`background:true`) requests are rejected per JSONL line
and written to the error file because a completed Batch output file cannot
represent an open stream or a still-running background response. The local
request-count cap defaults to `CODEXCOMPAT_BATCH_MAX_REQUESTS=1000` to protect
the `/srv/aialra/apps` test deployment; it can be raised up to OpenAI's 50,000
request shape limit when disk and upstream quota policies are ready.

## Evals Endpoint Coverage

OpenAI's Evals API defines evaluation objects with `data_source_config` and
`testing_criteria`, then runs those evals against data sources such as
`purpose:"evals"` JSONL Files. The bridge implements a local synchronous
compatibility layer so SDKs and regression jobs can create evals, create runs,
read output items, and audit deterministic grader results even when the
upstream provider only exposes Chat Completions.

The official Evals product is also on a documented deprecation path: existing
users become read-only on 2026-10-31 and shutdown is scheduled for 2026-11-30.
This bridge support is therefore documented as local protocol compatibility and
transition tooling, not a dependency on the hosted Evals dashboard.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/evals` | Implemented locally | Rejects unsupported query parameters before JSON body parsing, then requires `name`, `data_source_config`, and non-empty `testing_criteria`; stores OpenAI-style `eval_...` objects with local metadata |
| `GET /v1/evals` | Implemented locally | Lists local evals with official `limit`, `after`, `order`, and `order_by=created_at|updated_at` pagination only; repeated scalar query values, invalid `order_by` values, and unsupported parameters such as `before` return 400 before listing |
| `GET /v1/evals/{eval_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then returns the stored local eval definition |
| `POST /v1/evals/{eval_id}` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or mutation, then updates local `name`, `data_source_config`, `testing_criteria`, and `metadata` |
| `DELETE /v1/evals/{eval_id}` | Implemented locally | Rejects unsupported query parameters before deletion, then deletes the eval definition, local runs, and output items |
| `POST /v1/evals/{eval_id}/runs` | Implemented locally | Rejects unsupported query parameters before JSON body parsing or run creation, then loads inline rows or `source:{type:"file_id",id}` from a `purpose:"evals"` File, runs synchronously, and stores `eval.run` results |
| `GET /v1/evals/{eval_id}/runs` | Implemented locally | Lists local runs with official `limit`, `after`, `order`, and `status=queued|in_progress|completed|canceled|failed` pagination and filtering only; repeated scalar query values, invalid `status` values, and unsupported parameters such as `before` return 400 before listing |
| `GET /v1/evals/{eval_id}/runs/{run_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then returns a stored run with `result_counts`, `per_model_usage`, `per_testing_criteria_results`, `data_source`, `error`, and metadata |
| `POST /v1/evals/{eval_id}/runs/{run_id}/cancel` | Local extension/no-op for terminal runs | Rejects unsupported query parameters before lifecycle mutation; local runs complete synchronously and terminal runs are returned unchanged |
| `GET /v1/evals/{eval_id}/runs/{run_id}/output_items` | Implemented locally | Lists stored `eval.run.output_item` records with official `limit`, `after`, `order`, and `status=pass|fail` pagination and filtering only; repeated scalar query values, invalid `status` values, and unsupported parameters such as `before` return 400 before listing; local historical `passed` / `failed` / `errored` statuses are projected to official `pass` / `fail` while preserving the original value in `metadata.compatibility.local_status` |
| `GET /v1/evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}` | Implemented locally | Rejects unsupported query parameters before reading local state, then returns one stored output item with datasource row, sample, criterion results, and error details when present |

Local run execution supports deterministic `string_check`,
`text_similarity`, local sandboxed-subprocess `python`, provider-backed
`score_model`, and one-level `multi` graders. String checks support the
documented `eq`, `neq`, `like`, and `ilike` operations plus compatibility
aliases such as `ne`, `contains`, `not_contains`, `starts_with`, `ends_with`,
and `regex`. Text similarity supports local deterministic approximations for
`fuzzy_match`, `bleu`, `gleu`, `meteor`, `cosine`, `rouge_1` through
`rouge_5`, and `rouge_l`. Multigraders can combine non-nested subgraders using
the documented arithmetic operators and functions (`min`, `max`, `abs`,
`floor`, `ceil`, `exp`, `sqrt`, and `log`) without executing arbitrary
JavaScript. `python` graders validate the documented `source`/`image_tag`
shape, execute `grade(sample, item)` in a short-lived local Python subprocess
with a sanitized environment, official 256 KiB source cap, timeout, disk/file
size and memory limits where the host Python runtime supports them, and network
module/audit guards. Non-float returns, exceptions, and timeouts return reward
`0` with `python_grader_runtime_error` metadata. `score_model` graders render
Chat messages from official
`item`/`sample` templates, call the configured Chat provider as a judge,
request a JSON `result`, default non-numeric judge output to `0`, and report
judge token usage in both `metadata.token_usage` and
`model_grader_token_usage_per_model`. Template values such as
`{{ item.correct_label }}` and `{{ sample.output_text }}` are resolved locally.
When a JSONL row already includes `sample.output_text` (or compatible sample
fields), deterministic and Python graders run without calling the upstream
provider; `score_model` still calls the configured judge model. When no sample
is supplied and
`data_source.type:"responses"` is used, the bridge materializes
`input_messages:{type:"template"}` and calls the local `/v1/responses` executor
with `store:false` to produce the sample output before grading.

Local Evals state is file-backed under
`CODEXCOMPAT_EVAL_STATE_DIR=$CODEXCOMPAT_STATE_DIR/local-evals` by default,
with `0700` directories and `0600` JSON records. The default
`CODEXCOMPAT_EVAL_MAX_ROWS=100` protects the `/srv/aialra/apps` deployment
from accidentally loading a large benchmark file into a synchronous request.

## Graders Endpoint Coverage

OpenAI's beta Graders API validates and runs grader definitions independently
of an eval run. The bridge implements local deterministic coverage plus
provider-backed `score_model` judge calls for the same grader engine used by
local Evals so SDKs and eval tooling can preflight grader configuration against
Chat-only providers.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/fine_tuning/alpha/graders/validate` | Implemented for supported graders | Accepts `grader` and returns the normalized grader object for `string_check`, `text_similarity`, local `python`, provider-backed `score_model`, and non-nested `multi`; returns a clear `unsupported_grader_type` error for unknown grader types |
| `POST /v1/fine_tuning/alpha/graders/run` | Implemented locally plus provider-backed judge calls | Accepts `grader`, optional `item`, and `model_sample`/`sample`; returns OpenAI-style `reward`, `metadata`, `sub_rewards`, and model-grader token usage. Deterministic and Python graders return empty model-token usage, while `score_model` calls the configured Chat provider and records judge usage |

This is not OpenAI's hosted Graders service. Local `text_similarity` metrics are
dependency-free approximations so they can run inside the bridge without
pulling large NLP packages into `/srv/aialra/apps`. They are deterministic and
useful for regression/eval workflows, but they are not exact `rapidfuzz`,
ROUGE, BLEU, METEOR, or embedding-cosine parity. `score_model` is
provider-backed Chat Completions compatibility rather than OpenAI's hosted
grader-model runtime. Python graders run in a local subprocess compatibility
runtime, not OpenAI's hosted execution image; the bridge scrubs environment
variables, creates a temporary work directory, applies local limits, blocks
common network/process operations, and deletes the work directory after the
run, but full hardened isolation still requires a dedicated sandbox such as a
container or microVM profile.

Python grader configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_PYTHON_GRADER_PROVIDER` | `local` | Use `disabled` to reject local Python grader execution while still validating other grader types |
| `CODEXCOMPAT_PYTHON_GRADER_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-python-graders` | Temporary local Python grader work directory root; keep outside Git |
| `CODEXCOMPAT_PYTHON_GRADER_TIMEOUT_MS` | `120000` | Per-grader subprocess timeout, capped at the documented 2 minute limit |
| `CODEXCOMPAT_PYTHON_GRADER_MAX_SOURCE_BYTES` | `262144` | Maximum grader source size, matching the documented 256 KiB cap |
| `CODEXCOMPAT_PYTHON_GRADER_DISK_BYTES` | `1073741824` | File-size limit applied through Python `resource` when available |
| `CODEXCOMPAT_PYTHON_GRADER_MEMORY_BYTES` | `2147483648` | Address-space limit applied through Python `resource` when available |
| `CODEXCOMPAT_PYTHON_GRADER_BIN` | `python3` | Python interpreter used for the local subprocess runner |

## Uploads, Files and Vector Stores Endpoint Coverage

Uploads are local intermediate objects for large/client-side file ingestion.
`complete` creates a regular local File object, so the completed content can be
used through `input_file`, direct Files API reads, or the local `file_search`
adapter. File bytes are preserved under the configured bridge state directory,
not in Git; clearly text-like files also keep a text index for local
`file_search`.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/uploads` | Implemented | Rejects unsupported query parameters before JSON body parsing, then creates a pending local Upload from `filename`, official File `purpose`, integer `bytes`, `mime_type`, and optional `expires_after:{anchor:"created_at",seconds:1..3600}`; invalid purpose, non-integer `bytes`, and malformed expiration policies return 400; returns OpenAI-style `status` and `expires_at`; local `CODEXCOMPAT_UPLOAD_MAX_BYTES` defaults to the local Files size cap |
| `POST /v1/uploads/{upload_id}/parts` | Implemented | Rejects unsupported query parameters before multipart/raw/JSON body parsing or Part creation, then adds an ordered candidate Part from JSON `data`/`data_base64`/`content`, multipart `data`, or raw body; each part is capped by `CODEXCOMPAT_UPLOAD_MAX_PART_BYTES` and the official 64 MB part maximum. Optional local integrity fields/headers (`sha256`, `checksum_sha256`, `checksum`, `x-content-sha256`, or `x-upload-part-sha256`) are validated as SHA-256 hex without changing the OpenAI-style public Part shape. Expired pending Uploads are persisted as `status:"expired"` and rejected with `upload_expired` |
| `POST /v1/uploads/{upload_id}/complete` | Implemented | Rejects unsupported query parameters before JSON body parsing or terminal state mutation, then requires ordered string `part_ids`, verifies the final byte count matches the original Upload `bytes`, optionally validates a local SHA-256 checksum, and returns `status:"completed"` with nested `file` object ready for the rest of the platform; preserves binary bytes in the created File and records `upload_sha256` / `upload_part_count` in File metadata for local auditability. Expired pending Uploads are persisted as `status:"expired"` and rejected before File creation. Completed Uploads keep Part metadata/checksums but prune intermediate Part `.bin` files by default after the File is created |
| `POST /v1/uploads/{upload_id}/cancel` | Implemented | Rejects unsupported query parameters before lifecycle mutation, then marks a pending Upload `cancelled`; no new Parts may be added after cancel. Already-expired Uploads remain `expired` instead of being converted to `cancelled`. Cancelled or expired Uploads prune intermediate Part `.bin` files by default while keeping lifecycle metadata |
| `POST /v1/files` | Implemented | Rejects unsupported query parameters before multipart/raw/JSON body parsing, then accepts JSON `{filename,purpose,content,content_base64,metadata,mime_type,expires_after}`, binary multipart upload including official `expires_after[anchor]` / `expires_after[seconds]`, or raw body with `x-filename`; validates public uploads against the official File `purpose` values before storage; validates `expires_after:{anchor:"created_at",seconds:3600..2592000}` and returns computed `expires_at`; defaults `purpose:"batch"` Files to the official 30-day expiration; stores byte-preserving local content and a text index for text-like files |
| `GET /v1/files` | Implemented | Lists local files with official `purpose`, `limit`, `after`, and `order` pagination; repeated scalar query values return 400, `limit` is validated from 1 through 10000, and unsupported generic paginator parameters such as `before` do not affect the official list result |
| `GET /v1/files/{file_id}` | Implemented | Rejects unsupported query parameters before reading local metadata, then returns local file metadata |
| `GET /v1/files/{file_id}/content` | Implemented | Rejects unsupported query parameters before reading stored bytes, then returns stored bytes with the best local content type, preserving binary uploads such as PDFs |
| `DELETE /v1/files/{file_id}` | Implemented | Rejects unsupported query parameters before deletion, then deletes the file and detaches it from all local vector stores |
| `POST /v1/vector_stores` | Implemented | Rejects unsupported query parameters before JSON body parsing, then creates a local vector-store record with `file_counts` and metadata |
| `GET /v1/vector_stores` | Implemented | Lists local vector stores with official `limit`, `after`, `before`, and `order` pagination; repeated scalar query values return 400, `limit` is validated from 1 through 100, and expired stores are marked `status:"expired"` |
| `GET /v1/vector_stores/{vector_store_id}` | Implemented | Rejects unsupported query parameters before reading metadata, then returns local vector-store metadata, live file counts, and expired status when `expires_at` is in the past |
| `POST /v1/vector_stores/{vector_store_id}` | Implemented | Rejects unsupported query parameters before JSON body parsing or mutation, then updates local vector-store `name`, `metadata`, and `expires_after`; computes `expires_at` from the local `last_active_at` timestamp |
| `DELETE /v1/vector_stores/{vector_store_id}` | Implemented | Rejects unsupported query parameters before deletion, then deletes the local vector store and its file attachments |
| `POST /v1/vector_stores/{vector_store_id}/files` | Implemented | Rejects unsupported query parameters before JSON body parsing or attachment, then attaches an uploaded file; supports per-file `attributes` for filtering and validates `chunking_strategy` |
| `GET /v1/vector_stores/{vector_store_id}/files` | Implemented | Lists attached files with official `limit`, `after`, `before`, `order`, and `filter` pagination; repeated scalar query values return 400, `limit` is validated from 1 through 100, and `filter` accepts `in_progress`, `completed`, `failed`, or `cancelled` |
| `GET /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Rejects unsupported query parameters before reading metadata, then returns local vector-store file metadata |
| `POST /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Rejects unsupported query parameters before JSON body parsing or mutation, then updates local vector-store file `attributes` for later `file_search` filters |
| `GET /v1/vector_stores/{vector_store_id}/files/{file_id}/content` | Implemented | Rejects unsupported query parameters before reading indexed content, then returns local extracted text chunks for a vector-store file, with chunk metadata and effective chunking strategy |
| `DELETE /v1/vector_stores/{vector_store_id}/files/{file_id}` | Implemented | Rejects unsupported query parameters before deletion, then detaches a file from the vector store |
| `POST /v1/vector_stores/{vector_store_id}/file_batches` | Implemented | Rejects unsupported query parameters before JSON body parsing or batch attachment, then synchronously attaches up to 2000 local files; accepts either `file_ids` with global `attributes`/`chunking_strategy` or `files[]` with per-file values; validates static chunking limits |
| `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}` | Implemented | Rejects unsupported query parameters before reading the batch, then returns the local batch record with OpenAI-style `vector_store.file_batch`, `status`, and `file_counts` fields |
| `GET /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/files` | Implemented | Lists the vector-store files attached by the batch with official `limit`, `after`, `before`, `order`, and `filter` pagination; repeated scalar query values return 400, `limit` is validated from 1 through 100, and `filter` accepts `in_progress`, `completed`, `failed`, or `cancelled` |
| `POST /v1/vector_stores/{vector_store_id}/file_batches/{batch_id}/cancel` | Implemented as a compatibility no-op after synchronous completion | Rejects unsupported query parameters before lifecycle mutation, then returns the completed batch unless a future async batch is still `in_progress`, in which case it is marked `cancelled` |
| `POST /v1/vector_stores/{vector_store_id}/search` | Implemented | Rejects unsupported query parameters before JSON body parsing or `last_active_at` refresh, then performs hybrid local keyword + hashed-semantic chunk search with required string or array `query`, `search_queries`, `matched_queries`, `max_num_results` default 10 / max 50, chunk metadata, static chunk overlap, ranking options, OpenAI-style attribute filters, structured OpenAI-style 400s for invalid `query`, `max_num_results`, `ranking_options`, and filters, and `400 vector_store_expired` for expired stores |

## Containers Endpoint Coverage

These endpoints back the local `shell` / `code_interpreter` compatibility
adapter. Container files are stored under the configured bridge state directory,
not in Git.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/containers` | Implemented | Rejects unsupported query parameters before JSON body parsing, then creates a local container workspace with OpenAI-style `container` metadata, preserves `memory_limit`, `expires_after`, `network_policy`, `metadata`, and local `skill_reference` defaults from `skills`; validates official `memory_limit` values (`1g` / `4g` / `16g` / `64g`), `expires_after:{anchor:"last_active_at",minutes:<positive integer>}`, and `network_policy:{type:"disabled"}` or `network_policy:{type:"allowlist",allowed_domains:[...]}` before storage; validates `domain_secrets` request shape but redacts secret values from persisted/returned container metadata |
| `GET /v1/containers` | Implemented | Lists local containers with official `name`, `limit`, `after`, and `order` pagination only; repeated scalar query values, `limit` outside 1 through 100, and unsupported parameters such as `before` return 400 before listing; elapsed `expires_after` containers are lazily marked `expired` with the local `/mnt/data` workspace pruned |
| `GET /v1/containers/{container_id}` | Implemented | Rejects unsupported query parameters before reading local state, then returns local container metadata, lazily refreshing elapsed `expires_after` containers to `status:"expired"` with local compatibility metadata |
| `DELETE /v1/containers/{container_id}` | Implemented | Rejects unsupported query parameters before deletion, then deletes the local container workspace and artifacts |
| `POST /v1/containers/{container_id}/files` | Implemented | Rejects unsupported query parameters before JSON/raw body parsing or file creation, then writes a local container file from JSON or raw body; expired containers fail closed with `container_expired` |
| `GET /v1/containers/{container_id}/files` | Implemented | Lists files under the local `/mnt/data` workspace with official `limit`, `after`, and `order` pagination only; repeated scalar query values, `limit` outside 1 through 100, and unsupported parameters such as `before` return 400 before listing; expired containers fail closed with `container_expired` because their workspace has been pruned |
| `GET /v1/containers/{container_id}/files/{file_id}` | Implemented | Rejects unsupported query parameters before reading local state, then returns local container file metadata; expired containers fail closed with `container_expired` |
| `GET /v1/containers/{container_id}/files/{file_id}/content` | Implemented | Rejects unsupported query parameters before reading stored bytes, then downloads local container file content; expired containers fail closed with `container_expired` |
| `DELETE /v1/containers/{container_id}/files/{file_id}` | Implemented | Rejects unsupported query parameters before deletion, then deletes a local container file; expired containers fail closed with `container_expired` |

## Skills Endpoint Coverage

These endpoints back local skill upload, versioning, content retrieval, and
`skill_reference` mounting for the local shell/code-interpreter adapter. Skill
bundles are stored under the configured bridge state directory, not in Git.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/skills` | Implemented locally | Accepts JSON, multipart directory-style `files[]`, or raw `SKILL.md`; validates exactly one `SKILL.md` manifest and extracts `name` / `description` |
| `GET /v1/skills` | Implemented locally | Lists local skill records with official `limit`, `after`, and `order` pagination; repeated scalar query values return 400, `limit` is validated from 0 through 100, `limit=0` returns an empty page with `has_more` when records exist, and unsupported `before` is ignored |
| `GET /v1/skills/{skill_id}` | Implemented locally | Returns local skill metadata, `default_version`, `latest_version`, and `version_count` |
| `POST /v1/skills/{skill_id}` | Implemented locally | Updates `metadata` and `default_version`; deleting the default version is rejected until another default is selected |
| `DELETE /v1/skills/{skill_id}` | Implemented locally | Deletes the local skill and all versions |
| `GET /v1/skills/{skill_id}/content` | Implemented locally | Returns the default version as an `application/zip` bundle |
| `POST /v1/skills/{skill_id}/versions` | Implemented locally | Creates a new immutable local skill version from JSON, multipart, or raw upload |
| `GET /v1/skills/{skill_id}/versions` | Implemented locally | Lists local skill versions with official `limit`, `after`, and `order` pagination; repeated scalar query values return 400, `limit` is validated from 0 through 100, `limit=0` returns an empty page with `has_more` when versions exist, and unsupported `before` is ignored |
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

Responses delta events generated by the bridge include a local `obfuscation`
field by default, matching the Responses `include_obfuscation` stream option.
Passing `stream_options.include_obfuscation:false` on create streams or
`include_obfuscation=false` on stored response retrieve streams omits that
field.

Chat stream chunks with `delta.content` become text deltas. Chunks with
`delta.refusal` become refusal content-part deltas. Chunks with `delta.tool_calls`
become function-call item events and argument deltas. Chunks
with DeepSeek `delta.reasoning_content` become reasoning summary deltas and are
kept in the replay store so later tool turns can pass the reasoning content back.
For stored Responses, local `reasoning.encrypted_content` payloads are retained
internally when reasoning text is available, but ordinary response retrieval
hides them. Clients can recover them with
`GET /v1/responses/{response_id}?include[]=reasoning.encrypted_content`.
Chat stream chunks with `choice.logprobs.content[]` are accumulated and attached
to the final `output_text` content part and terminal response. Chat stream
chunks with `choice.logprobs.refusal[]` are preserved under
`metadata.compatibility.chat_refusal_logprobs[]`, because Responses refusal
content parts only support `type` and `refusal`. Chat stream chunks with
`delta.audio` are accumulated into an `output_audio` content part and stored in
the replay record so `previous_response_id` follow-ups can preserve the original
Chat audio object.
For stored Responses, output-text token logprobs are retained internally when
the Chat provider returns them, but ordinary response retrieval hides
`message.output_text.logprobs`. Clients can recover them with
`GET /v1/responses/{response_id}?include[]=message.output_text.logprobs`.
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
When `computer` or `computer_use_preview` is handled by the local adapter, the
bridge emits a screenshot-first `computer_call` item before Chat text deltas.
When `tool_search` is handled by the local adapter, the bridge emits
`tool_search_call` and `tool_search_output` items before the subsequently
loaded function call or final Chat text.

## Local Hosted Tool Call Budget

Responses `max_tool_calls` limits the total number of built-in tool calls a
response may process. Chat-only providers do not enforce this for hosted tools,
so the bridge applies a shared local budget before executing emulated
`web_search`, `file_search`, `shell`, `code_interpreter`, `computer`, `mcp`,
and `tool_search` actions. Preparation-time local adapters run in the bridge's
fixed pipeline, while model-returned local tool calls are handled as tool
search before remote MCP calls so deferred function schemas can be loaded
before any subsequent function-call decision.

When the budget is exhausted, the bridge does not run the extra local action,
does not fabricate tool output, and records the skipped action under
`metadata.compatibility.local_tool_budget.skipped_calls`. Tool-specific
compatibility metadata also exposes skipped counters such as
`local_web_search.open_skipped_count`, `local_file_search.skipped_count`, and
`local_shell.skipped_count`, `local_computer.skipped_count`, and
`local_mcp.skipped_count`, plus `local_tool_search.skipped_count`. Invalid
non-number, non-integer, or negative `max_tool_calls` values are rejected with
`400 invalid_max_tool_calls`.

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

When a request includes `include:["web_search_call.action.sources"]`, the local
adapter adds `action.sources` to emitted `web_search_call` items. Search actions
carry the local result URLs with titles, snippets, and source indexes; local
`open_page` and `find_in_page` actions carry the matching URL source plus bounded
open/find status metadata. The bridge stores local web-search sources internally
for `store:true` responses so
`GET /v1/responses/{response_id}?include[]=web_search_call.action.sources` can
project the sources later while ordinary response retrieval keeps them hidden.
Without this include value, the bridge omits `action.sources` to preserve the
default Responses projection.

When a request includes `include:["web_search_call.results"]`, the local adapter
also adds a top-level `results` array to each emitted `web_search_call` item.
Search actions include the local search results; `open_page` and `find_in_page`
actions include only the matching URL result. The result objects intentionally
reuse the same stable source shape (`type:"url"`, `url`, `title`, `index`,
optional `snippet`, and bounded open/find status metadata) so clients can audit
local web evidence without receiving fetched page text. The bridge stores the
full local result projection for `store:true` responses and redacts it again
unless `include[]=web_search_call.results` is supplied on retrieval. Requesting
`web_search_call.results` does not imply `web_search_call.action.sources`, and
requesting `web_search_call.action.sources` does not imply `web_search_call.results`.

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

## Local Input Image Adapter

OpenAI Responses can reference image inputs by URL, base64 data URL, or Files
API `file_id`. Chat Completions commonly accepts image URL/data URL content
parts, so the bridge resolves local Files API image `file_id` inputs before the
upstream Chat request and applies the same provider-aware mode to direct Chat
Completions passthrough requests:

- `image_url` strings and `image_url:{url,detail}` objects are forwarded
  directly when the configured Chat image mode is `vision`;
- inline base64 `file_data`, `data`, and `image_data` are converted to
  `data:<media_type>;base64,...` for vision-capable Chat providers;
- local Files API `file_id` image inputs are read as bytes, checked against
  local image byte caps, converted to data URLs, and the original `detail` is
  preserved;
- text-only providers receive explicit `[image:...]` markers with URL/file
  hints, media type, and detail instead of Chat vision parts or data URLs;
- direct `/v1/chat/completions` requests with Chat `image_url` content parts
  use the same text fallback when `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE=text`;
- compatibility metadata records only file IDs, filenames, media types, byte
  counts, status, errors, and image-part counts; it does not echo the base64
  image payload.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_INPUT_IMAGE_PROVIDER` | `local` | Use `disabled` to leave `input_image.file_id` as a marker-only compatibility fallback |
| `CODEXCOMPAT_INPUT_IMAGE_MAX_IMAGES` | `32` | Maximum local image file IDs resolved per request |
| `CODEXCOMPAT_INPUT_IMAGE_MAX_BYTES` | `4194304` | Maximum bytes accepted from each local image file before it is converted to a data URL |
| `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE` | `text` for DeepSeek, `vision` otherwise | Use `auto`, `vision`, or `text`. `vision` forwards Chat multimodal content parts; `text` emits safe image markers for providers that reject `image_url` content parts |
| `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE` | `text` for DeepSeek, `audio` otherwise | Use `auto`, `audio`, or `text`. `audio` forwards Chat audio content parts; `text` emits safe audio markers for providers that reject `input_audio` content parts |
| `CODEXCOMPAT_CHAT_FILE_INPUT_MODE` | `text` for DeepSeek, `file` otherwise | Use `auto`, `file`, or `text`. `file` forwards compatible Chat file parts unchanged; `text` emits safe file markers and, when local input-file extraction is enabled, injects bounded extracted text context |
| `CODEXCOMPAT_CHAT_N_EMULATION_MAX` | `10` | Maximum local provider calls used to emulate unsupported Direct Chat `n>1` in non-streaming and streaming modes; capped at 50 |

This adapter does not make a text-only model understand images. It preserves
the protocol shape for vision-capable Chat providers and keeps DeepSeek text
workflows stable by avoiding live vision eval claims against text-only models.

## Local Input File Adapter

The bridge can emulate Responses `input_file` items and compatible direct Chat
`file` / `input_file` content parts for Chat-only providers by extracting text
from bounded file inputs and injecting that text into the upstream Chat prompt.
It supports the three official Responses input styles:

- `file_id` from the local Files API;
- inline base64 `file_data`, including `data:<media>;base64,...` URLs;
- HTTP(S) `file_url` when URL fetching is enabled; remote bodies that exceed
  the local byte cap are truncated and marked in compatibility metadata.

For direct `/v1/chat/completions`, DeepSeek defaults to
`CODEXCOMPAT_CHAT_FILE_INPUT_MODE=text`: the original request messages are
preserved in the local stored Chat lifecycle, while the upstream provider
receives text markers plus the extracted local file context.

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
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR` | `auto` | When `pdftotext` returns no text, attempts bounded local PDF OCR through Poppler `pdftoppm` plus `tesseract`; use `disabled` to skip OCR |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_MAX_PAGES` | `3` | Maximum PDF pages rendered for OCR fallback per file |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_DPI` | `150` | PDF page render DPI for OCR fallback, bounded to 72-300 |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_LANGUAGE` | `eng` | Tesseract language selector passed to OCR fallback |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES` | `true` | Disables DeepSeek thinking mode for local input-file requests so visible output remains available under small output budgets |

This is a text extraction compatibility layer, not native OpenAI file input
processing. Text and code files, JSON, Markdown, HTML, XML, and similar formats
are injected directly. Inline `file_data` must be valid base64. Spreadsheet-like
CSV/TSV files and `.xlsx` sheets get a deterministic local augmentation block:
the first 1,000 rows per sheet are parsed, row/column counts and the first-row
header are added, and `spreadsheet_extracted_count` records the path in
compatibility metadata. Binary PDF text layers are extracted with Poppler
`pdftotext` when available; if that returns no text, the optional OCR fallback
renders only the first bounded pages and injects Tesseract text as
`extraction_method: pdftoppm_tesseract_ocr`, with
`pdf_ocr_extracted_count` recording the path in compatibility metadata. Modern
Office OOXML files are parsed without new runtime dependencies: `.docx` text is
read from Word XML parts, `.xlsx` shared strings and worksheet rows are rendered
through the spreadsheet augmentation, and `.pptx` slide text is extracted from
slide XML. The bridge still does not send PDF page images to text-only
providers the way OpenAI vision-capable hosted models can, and OCR quality
depends on the installed local Tesseract data. Legacy binary Office formats,
embedded Office media, and complex workbook formulas/macros are still reported
with metadata unless a future parser extracts text safely. Remote `file_url`
inputs that exceed the byte cap keep the prefix that fits in budget, set
`truncated: true` in the injected prompt, and increment
`metadata.compatibility.local_input_files.truncated_count`. For large files,
prefer the local `file_search` adapter.

## Local File Search Adapter

The bridge can emulate the Responses `file_search` hosted tool for Chat-only
providers by keeping a local Files/Vector Stores state tree and running bounded
hybrid keyword plus hashed-semantic search over uploaded text and locally
extractable document text. The adapter:

- reserves `file_search` so it is not forwarded as an unsupported Chat tool;
- searches `vector_store_ids` from the tool or `tool_resources.file_search`;
- accepts direct `query` arrays on vector-store search and performs bounded
  deterministic multi-query decomposition for Responses prompts such as
  `file search for alpha and beta`;
- injects retrieved chunks into the upstream Chat prompt as source material;
- emits `file_search_call` output items with queries, vector store IDs, and
  optional results when `include:["file_search_call.results"]` is requested;
- stores local file-search results internally so
  `GET /v1/responses/{response_id}?include[]=file_search_call.results` can
  project search result details later while ordinary response retrieval keeps
  them hidden;
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
  `chunk_overlap_tokens` no more than half the chunk size;
- uses the shared local file extractor when a vector-store file is not plain
  text, including PDF text-layer extraction through Poppler `pdftotext`,
  bounded PDF OCR fallback through `pdftoppm` plus `tesseract`, and basic
  `.docx` / `.xlsx` / `.pptx` / CSV / TSV text extraction. Extracted text is
  cached as bounded `indexed_content` on the local vector-store file record so
  later searches do not rerun OCR unless the record predates indexing.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_FILE_SEARCH_PROVIDER` | `local` | Use `disabled` to leave `file_search` as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_FILE_SEARCH_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-file-search` | Local file/vector-store state path; keep outside Git |
| `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS` | `5` | Maximum retrieved chunks injected into Chat context; direct vector-store search defaults to 10 and accepts up to 50 via `max_num_results` |
| `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | `4194304` | Upload size limit for local Files API bytes that can be attached to vector stores |
| `CODEXCOMPAT_EMBEDDINGS_MODEL` | `hashed-semantic-256` | Model id returned by local `/v1/embeddings` when the request omits `model` |
| `CODEXCOMPAT_EMBEDDINGS_DIMENSIONS` | `256` | Default local `/v1/embeddings` vector dimensions; requests may override `dimensions` from 1 to 3072 |
| `CODEXCOMPAT_MODERATIONS_MODEL` | `omni-moderation-latest` | Model id returned by local `/v1/moderations` when the request omits `model` |
| `CODEXCOMPAT_UPLOAD_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-uploads` | Local Uploads API intermediate state path; keep outside Git. Runtime pruning includes bounded Upload workdirs under this state path |
| `CODEXCOMPAT_UPLOAD_MAX_BYTES` | same as `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | Maximum local Upload size before completion into a File; capped at the official 8 GB Upload limit but defaults small for `/srv/aialra/apps` disk safety |
| `CODEXCOMPAT_UPLOAD_MAX_PART_BYTES` | min(64 MB, upload max) | Maximum local Upload Part size; capped at the official 64 MB Part limit |
| `CODEXCOMPAT_UPLOAD_RETAIN_PART_DATA` | `false` | Keeps intermediate Upload Part `.bin` files after completion/cancellation/expiration when set to true; the default prunes those temporary bytes and retains metadata/checksums for auditability |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH` | `true` | Disables DeepSeek thinking mode for local file-search requests to avoid reasoning-only completions exhausting small output budgets |

This is a bridge compatibility layer, not native OpenAI file search. The current
retriever is intentionally local, auditable, and disk-bounded; it supports
overlapping static chunks and deterministic 256-dimensional hashed semantic
features but is not yet backed by a managed embedding model, ANN vector index,
or OpenAI's hosted reranker. PDF/OCR and document extraction use the same
`CODEXCOMPAT_INPUT_FILE_*` caps and Poppler/Tesseract knobs as Responses
`input_file` handling, but this is local extracted text rather than OpenAI's
managed file-ingestion pipeline: it does not inspect image pixels outside the
bounded OCR fallback, schedule asynchronous hosted indexing jobs, or reproduce
OpenAI's managed semantic ranking behavior. Local `hybrid_search` metadata
reports modes such as
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
- validates `shell.environment` before provider calls as `container_auto`,
  `container_reference`, or `local`, including `file_ids` capped at 50,
  `memory_limit` as `1g`/`4g`/`16g`/`64g`, `network_policy` as `disabled` or
  `allowlist`, and `skills` capped at 200 entries;
- validates `code_interpreter.container` before provider calls and requires it
  to be present; official `{type:"auto"}` containers and non-empty string
  container IDs are accepted, while `{type:"container_reference",container_id}`
  remains a local bridge extension for existing local container reuse;
- creates or reuses local container workspaces through `container_auto` and
  `container_reference`-style tool configuration;
- treats missing explicit `container_reference` IDs as
  `404 container_not_found`; only `container_auto` or omitted container
  references allocate a new local workspace;
- lazily expires referenced containers whose `expires_after` policy has elapsed,
  prunes their local `/mnt/data` workspace, and fails shell/code-interpreter
  execution with `container_expired` instead of forwarding a stale tool context;
- mounts local Skills API `skill_reference` entries from
  `POST /v1/containers` `skills` and `tools[].environment.skills` under
  `/mnt/data/.skills/<skill-name>/v<version>/` and records mounted skill
  metadata in `metadata.compatibility.local_shell.mounted_skills`;
- mounts `file_ids` supplied directly on the tool, under
  `tool_resources.code_interpreter.file_ids`, or inside
  `tools[].environment.file_ids` / `tools[].container.file_ids` into
  `/mnt/data`;
- maps `/mnt/data` in commands to the local container workspace;
- emits paired `shell_call` and `shell_call_output` output items for `shell`;
- emits `code_interpreter_call` output items for `code_interpreter`, with
  nested `outputs` logs when
  `include:["code_interpreter_call.outputs"]` is requested;
- stores local code-interpreter stdout/stderr internally so
  `GET /v1/responses/{response_id}?include[]=code_interpreter_call.outputs`
  can project nested logs later while ordinary response retrieval keeps them
  hidden;
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
| `CODEXCOMPAT_CHAT_DEVELOPER_ROLE_COMPAT` | `true` for DeepSeek providers | Maps direct Chat passthrough `role:"developer"` messages to `CODEXCOMPAT_CHAT_DEVELOPER_ROLE` before upstream proxying |
| `CODEXCOMPAT_CHAT_DEVELOPER_ROLE` | `system` | Provider role used for direct Chat passthrough developer-message compatibility |

This is a bridge compatibility layer, not OpenAI hosted shell or a Docker/VM
sandbox. It uses a local workspace, command timeouts, limited environment
variables, output caps, and audit metadata, but it does not yet provide kernel,
network, or filesystem isolation from the host. Full parity requires a hardened
container runtime, network allowlist enforcement, domain secret sidecars,
interactive service policies, and stronger artifact lifecycle controls.

## Local Computer Use Adapter

The bridge can emulate the Responses `computer` hosted tool and the deprecated
`computer_use_preview` name for Chat-only providers by preserving the Computer
Use action-loop shape. The adapter:

- reserves `computer` and `computer_use_preview` so they are not forwarded as
  unsupported Chat tools;
- validates legacy preview display fields before local adapter execution:
  `computer_use_preview` requires `environment`, `display_width`, and
  `display_height`, while GA `computer` keeps those fields optional for the
  official `{type:"computer"}` request shape;
- emits a `computer_call` output item with a GA-style `actions:[{type:"screenshot"}]`
  array and preview-compatible `action:{type:"screenshot"}`;
- preserves `call_id`, `environment`, `display_width`, `display_height`,
  `pending_safety_checks`, and local compatibility metadata for auditability;
- accepts follow-up Responses `computer_call_output` input items and translates
  `call_id`, `output.type`, `output.image_url`, `detail`, text, and bounded
  `acknowledged_safety_checks` summaries into Chat-visible context;
- on non-streaming, streaming, and active background follow-up turns with
  returned `computer_call_output`, injects a generated Chat function tool that
  lets the model request the next Computer Use action. Supported action types
  follow the official Computer Use loop: `click`, `double_click`, `scroll`,
  `type`, `wait`, `keypress`, `drag`, `move`, and `screenshot`;
- normalizes common action aliases on model-requested actions, including
  `scroll_x` / `scrollX`, `scroll_y` / `scrollY`, single `key` to `keys[]`,
  and drag path `[x,y]` pairs to `{x,y}` points;
- maps model-returned generated function calls back to Responses
  `computer_call` output items, preserving `action`, `actions[]`,
  `pending_safety_checks`, `environment`, display dimensions, and `call_id`,
  while suppressing the bridge-internal function call from public output and
  stream events;
- records returned-output safety acknowledgements and model-requested pending
  safety checks under `metadata.compatibility.local_computer` for auditability;
- maps forced `tool_choice:{type:"computer"}` / `computer_use_preview`
  follow-up requests to the generated Chat function name and records the
  mapping under `metadata.compatibility.local_computer.tool_choice`;
- records `include:["computer_call_output.output.image_url"]` requests in
  `metadata.compatibility.local_computer.include_output_image_url`;
- hides stored `computer_call_output.output.image_url` values on Responses and
  Conversations item retrieval unless that include value is requested;
- consumes one shared `max_tool_calls` budget slot before emitting the local
  screenshot request;
- disables DeepSeek thinking mode by default for local computer-use requests so
  small-output compatibility tests receive visible text.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_COMPUTER_PROVIDER` | `local` | Use `disabled` to leave `computer` / `computer_use_preview` as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_COMPUTER` | `true` | Disables DeepSeek thinking mode for local computer-use requests so final text is visible under small output budgets |

This is an action-loop protocol adapter, not OpenAI hosted Computer Use and not
a browser/VNC executor. It can preserve screenshot and follow-up action loop
items, but it does not click, type, scroll, run a VM, capture a real
screenshot, or isolate desktop state by itself. A client-side or server-side
executor must run returned actions and send `computer_call_output` back to the
bridge. Full parity requires a Playwright or VNC-backed execution harness,
safety-check acknowledgement policy, DOM/screenshot capture, secrets
isolation, per-session cleanup, and multi-round action-loop control.

## Local Tool Search Adapter

OpenAI Responses `tool_search` lets the model dynamically load deferred tool
definitions. The official hosted mode returns `tool_search_call` and
`tool_search_output` before the eventual function call; client mode returns a
`tool_search_call` and expects the application to provide a later
`tool_search_output`.

For Chat-only providers, the bridge now implements a local adapter for
functions, namespaces, and deferred remote MCP server groups:

- reserves `tool_search` and namespace surfaces so they are not forwarded as
  unsupported hosted tools;
- validates `tool_search` request fields before local adapter execution:
  `execution` is limited to `server` / `client`, `description` is string/null,
  and `parameters` is object/null;
- hides top-level `function` tools marked `defer_loading:true` from the
  initial Chat `tools` list, while non-deferred functions remain callable
  immediately;
- treats `namespace` tools as local search surfaces, initially showing only the
  namespace name/description to Chat and loading deferred child functions on
  demand;
- injects a generated `local_tool_search` Chat function for hosted-mode search
  calls, then converts model calls to public `tool_search_call` and
  `tool_search_output` Responses items;
- lists deferred remote MCP servers as searchable groups without importing
  their full tool catalog at request start; when the model searches a matching
  server, the bridge performs a bounded remote MCP `initialize` / `tools/list`,
  emits a public `mcp_list_tools` item, and injects the imported MCP tools as
  generated Chat functions for the follow-up request;
- appends loaded function schemas to a follow-up Chat request and maps final
  Chat function calls back to the original Responses function name and
  `namespace`, including streaming chunks where a collision-safe generated Chat
  function name is split across multiple provider events;
- promotes DeepSeek-style DSML/pseudo text calls for already-loaded
  `tool_search` functions into standard Chat `tool_calls` before public
  Responses translation. Covered forms include direct function invocations,
  `local_tool_call` with `path`/`input`, and namespace `method`/`params`
  wrappers. The public response emits a normal `function_call` and records
  `text_tool_call_count` / `text_suppressed_count` when this fallback is used;
- suppresses ordinary assistant prose that a Chat-only provider emits in the
  same choice as an already-loaded `tool_search` function call, preventing a
  tool-only Responses turn from gaining an extra `message` item while recording
  `assistant_text_suppressed_count` and
  `assistant_text_suppressed_char_count`;
- loads previously returned `tool_search_output.tools` from request input or a
  `previous_response_id` response so client-executed second turns and
  multi-turn tool-search state remain callable even when the request does not
  repeat `tools:[{type:"tool_search"}]`;
- loads function and namespace definitions from `additional_tools` input items
  into Chat function tools, with a compatibility prompt marking the loaded
  tool surface;
- validates `tool_search_call` / `tool_search_output` status, execution,
  arguments, and loaded tool schemas plus `additional_tools.tools` before
  provider calls on Responses create, `/input_tokens`, and `/compact`;
- skips raw Chat text fallback for `tool_search_call`, `tool_search_output`,
  and `additional_tools` input items so tool schemas are not duplicated as
  ordinary user text;
- supports non-streaming, streaming, and active background Responses paths;
- in streaming Responses, emits public `tool_search_call` / `mcp_list_tools`
  output items before later MCP call events, preserves combined usage, and
  suppresses bridge-internal Chat `function_call` stream items from the public
  SSE;
- maps `tool_choice:{type:"tool_search"}` to the generated search function and
  can preload a forced deferred `tool_choice:{type:"function"}` when it matches
  a known deferred function;
- records counts and boundaries in
  `metadata.compatibility.local_tool_search`, including
  `searchable_mcp_server_count`, `mcp_list_tools_loaded_count`, and
  `mcp_loaded_tool_count` for the MCP path, plus
  `stream_remapped_tool_call_count` when streaming output items are rewritten
  from generated Chat names to public Responses names, text pseudo-call
  counters when a Chat provider emits DSML instead of native `tool_calls`, and
  assistant text suppression counters when a loaded tool-only turn arrives with
  extra prose.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_TOOL_SEARCH_PROVIDER` | `local` | Use `disabled` to leave `tool_search` as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_TOOL_SEARCH_MAX_LOADED_TOOLS` | `10` | Maximum deferred functions loaded by one hosted local search call |

Known boundary: `additional_tools` availability ordering is approximated as
request-global Chat function definitions because Chat Completions does not
support mid-input tool availability. Hosted connector tool search is still
handled by the connector roadmap. Same-request `tool_search` plus remote MCP
execution needs `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS` high enough for the search
turn and the MCP call turn; the bridge automatically uses an effective minimum
of two rounds when local `tool_search` and MCP are both active so deferred MCP
discovery can be followed by an approval request or call in the same Responses
request.

## Local MCP Tool Adapter

OpenAI Responses supports MCP tools through `tools:[{type:"mcp"}]` with a
`server_label`, a remote `server_url` or hosted connector `connector_id`,
optional per-request `authorization`, `require_approval`, `allowed_tools`, and
`defer_loading`. The Responses output stream can include `mcp_list_tools`,
`mcp_call`, and `mcp_approval_request` items, and callers can send prior
`mcp_list_tools`, `mcp_call`, `mcp_approval_request`, and
`mcp_approval_response` items as input context.

For Chat-only providers, the bridge currently implements a local MCP adapter
that can import remote tool definitions and execute non-streaming, streaming,
and active background remote MCP calls and approved continuations through Chat
function-tool proxy calls:

- reserves `mcp` tools so they are not forwarded as unsupported Chat tool
  definitions;
- emits local `mcp_list_tools` output items for non-streaming, streaming, and
  background Responses requests;
- imports explicit `tools` / `tool_definitions` from the MCP tool object when
  present, or synthesizes generic definitions from `allowed_tools` when the
  request supplies only names;
- when `server_url` is present, `defer_loading` is false, and no explicit
  definitions are supplied, sends remote JSON-RPC `initialize`,
  `notifications/initialized`, and `tools/list` requests over HTTP, accepts
  `application/json` or `text/event-stream` JSON-RPC responses, follows
  `tools/list` pagination cursors up to local caps, preserves returned
  `annotations`, `description`, `name`, and `input_schema`, and filters the
  imported list by `allowed_tools`;
- when `defer_loading:true` and a matching prior `mcp_list_tools` item is
  supplied in `input` or via `previous_response_id`, reuses those cached tool
  definitions without issuing another remote `tools/list`, preserves
  `annotations`, `description`, `name`, and `input_schema`, exposes the loaded
  remote tools as Chat function tools, and records
  `metadata.compatibility.local_mcp.input_list_tools_loaded_count` plus an
  `input_mcp_list_tools_*` boundary;
- when `defer_loading:true` is paired with hosted local `tool_search`, keeps
  the remote MCP server as a searchable group without consuming a list-tools
  budget slot during request preparation. If the model searches that group, the
  bridge imports the remote `tools/list`, emits the resulting `mcp_list_tools`
  item as part of the tool-search execution output, injects the imported MCP
  tools as generated Chat functions, and records
  `local_mcp.tool_search_list_tools_loaded_count`,
  `local_mcp.tool_search_loaded_tool_count`, and
  `tool_search_mcp_list_tools_*` boundaries;
- when a non-streaming, streaming, or active background request has imported
  remote tools, exposes those remote tools to the upstream Chat provider as
  generated function tools. For
  `require_approval:"never"` or matching `require_approval.never.tool_names`,
  matching Chat `tool_calls` are mapped to remote MCP `tools/call`, Responses
  `mcp_call` items are emitted with `arguments`, `output`, and `error`, Chat
  `tool` messages are appended, and one bounded follow-up Chat completion
  produces final visible text;
- when the caller supplies exact MCP `tool_choice` such as
  `{type:"function",name:"roll"}` or `{type:"mcp",name:"roll"}`, the bridge
  maps that original tool name to the generated Chat function name after
  remote `tools/list` import if there is exactly one matching MCP tool. The
  mapping result is recorded in
  `metadata.compatibility.local_mcp.tool_choice`; ambiguous or missing matches
  fall back to normal Chat tool selection instead of forcing the wrong server;
- for streaming Responses, buffers the upstream tool-selection SSE turn while
  deciding whether the returned generated function call is an MCP proxy call,
  emits `response.mcp_call_arguments.delta`,
  `response.mcp_call_arguments.done`, and `response.mcp_call.in_progress`
  bridge events for executed remote calls, and replays only the final visible
  provider SSE deltas to avoid leaking generated proxy `function_call` items;
- for approval-required tools, matching Chat `tool_calls` are converted to
  Responses `mcp_approval_request` items without executing the remote call or
  leaking the internal generated function name. A later request can pass
  `mcp_approval_response` with `approve:true`, usually with
  `previous_response_id`; the bridge then executes the approved remote
  `tools/call`, emits an `mcp_call` with `approval_request_id`, and injects
  the tool output into the final Chat completion. Streaming approved
  continuation turns emit the approved `mcp_call` item at stream start with
  `response.mcp_call_arguments.delta`,
  `response.mcp_call_arguments.done`, and
  `response.mcp_call.in_progress` before the final provider text deltas.
  Denied or missing approval responses are counted in compatibility metadata
  and are not re-exposed as fresh generated function tools on that
  continuation turn;
- for DeepSeek-style text pseudo-tool outputs, parses DSML-like approval/call
  invocations into generated MCP Chat tool calls before public output when
  they identify a known MCP server/tool, including `requests:[[server, tool,
  args]]` payloads. After a successful remote `mcp_call`, assistant DSML /
  pseudo-tool text is suppressed so clients see the public MCP output item
  instead of bridge-internal markup;
- forwards caller-provided MCP headers except hop-by-hop headers, maps
  `authorization` to an HTTP `Authorization: Bearer ...` header for that
  request only, carries returned `mcp-session-id` values on later remote list
  and call requests, and enforces timeout, response-byte, maximum-tool, call
  round, and tool-output caps;
- preserves caller-supplied MCP input items as adapter-managed Chat-visible
  context so a model can reason over previous MCP list/call/approval state,
  while skipping the generic raw JSON fallback for those protocol items when the
  local MCP adapter is active;
- consumes one shared `max_tool_calls` budget slot per emitted non-deferred
  local `mcp_list_tools` item and per executed remote `mcp_call`; reusing an
  input-provided deferred `mcp_list_tools` item or deferring the list until
  `tool_search` does not consume a preparation-time list budget slot. The
  bridge records skipped local MCP work in
  `metadata.compatibility.local_tool_budget`;
- records `metadata.compatibility.local_mcp` counts for remote servers,
  connectors, imported tools, remote import attempts/successes/failures,
  remote call attempts/successes/failures, deferred servers, redacted
  authorization, input MCP context items, text pseudo-tool calls parsed,
  pseudo-tool text suppressions, skipped calls, and the current boundary;
- deletes MCP `authorization` and `headers.Authorization` from response
  objects and background job snapshots. The adapter only records that
  authorization was present.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_MCP_PROVIDER` | `local` | Use `disabled` to leave MCP tools as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_MCP_REMOTE_LIST_TOOLS` | `true` | Enables bounded remote MCP `initialize` / `tools/list` imports for `server_url` tools without explicit local definitions |
| `CODEXCOMPAT_MCP_REMOTE_TOOL_CALLS` | `true` | Enables non-streaming, streaming, and active background remote MCP `tools/call` execution through Chat function-tool proxy calls, including auto-approved calls and approved `mcp_approval_response` continuations |
| `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS` | `1` | Maximum remote MCP call/follow-up rounds per Responses request that runs a remote MCP call loop. Same-request hosted `tool_search` plus MCP uses an effective minimum of `2` so the search round can be followed by bridge-executed remote MCP approval/call handling |
| `CODEXCOMPAT_MCP_MAX_TOOL_OUTPUT_CHARS` | `20000` | Maximum remote MCP tool output characters injected into follow-up Chat tool messages and returned `mcp_call.output` |
| `CODEXCOMPAT_MCP_TIMEOUT_MS` | `5000` | Timeout for each remote MCP HTTP request |
| `CODEXCOMPAT_MCP_MAX_RESPONSE_BYTES` | `1048576` | Maximum bytes read from one remote MCP HTTP/SSE response |
| `CODEXCOMPAT_MCP_MAX_TOOLS` | `128` | Maximum remote tools imported per MCP server |
| `CODEXCOMPAT_MCP_PROTOCOL_VERSION` | `2025-03-26` | Protocol version sent in the remote MCP `initialize` request |
| `CODEXCOMPAT_MCP_CLIENT_NAME` | `open-codex-responses-bridge` | Client name sent in the remote MCP `initialize` request |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_MCP` | `true` | Disables DeepSeek thinking mode for local MCP-context requests so final text is visible under small output budgets |

This is not yet a full OpenAI hosted Connectors implementation. It executes
non-streaming, streaming, and active background auto-approved `tools/call`
requests for remote `server_url` servers, supports streaming approval-request
emission, and supports non-streaming, streaming, and background approval
request/response execution for approval-required remote calls. It does not
manage connector
OAuth consent flows, persist per-request MCP authorization after background
restart, or persist hosted connector approval state. Full parity requires
connector credential sidecars, restart-resumable connector credentials,
stronger egress/secret policies, and broader multi-turn call replay tests.
Input `mcp_list_tools` reuse is currently scoped to deferred remote MCP servers;
non-deferred remote servers still perform a fresh local `initialize` /
`tools/list` import so existing session-bound approval flows retain their
session headers.

## Image Generation

Responses `tools:[{type:"image_generation"}]` requests are reserved for local
bridge handling and are not forwarded to Chat Completions providers such as
DeepSeek. The local adapter emits the Responses output shape documented for the
tool:

- `image_generation_call` output items with `status:"completed"`,
  `revised_prompt`, and base64 `result` bytes;
- streaming `response.image_generation_call.partial_image` events when the
  tool requests `partial_images`;
- `metadata.compatibility.local_image_generation` with provider, action,
  requested image options, input-image counts, prior image-call references,
  stored prior image-call counts, partial-image count, shared
  `max_tool_calls` status, and DeepSeek thinking compatibility notes.

The default provider is `placeholder`. It generates a deterministic, non-empty
PNG from the prompt and requested options so CodexApp UI rendering, SDK
parsing, background jobs, stored responses, and streaming workflows can exercise
the full Responses protocol without an external image key. For real generation,
set `CODEXCOMPAT_IMAGE_GENERATION_PROVIDER=openai-compatible` (or `openai` /
`images`) and configure an OpenAI-compatible Images API endpoint. Provider-backed
generation calls `POST /images/generations`, requests one image, maps
`data[0].b64_json` into `image_generation_call.result`, preserves
provider `revised_prompt` when present, and surfaces provider failures as
failed `image_generation_call` output items instead of fabricating an image.
When `action:"edit"` is forced, or `action:"auto"` has input images or an
`input_image_mask`, provider-backed mode calls `POST /images/edits` with
multipart form data. It resolves `input_image.file_id`, data URLs, inline
base64 image fields, HTTP(S) image URLs, and `input_image_mask.file_id` into
`image[]` / `mask` uploads. A forced edit with no resolved input image returns a
failed `image_generation_call`, matching the hosted Responses requirement that
edit mode needs an image in context. If `input_image_mask` is supplied but
cannot be resolved, the call fails instead of silently editing without the
requested mask.
Generated `image_generation_call.result` bytes are also persisted in a local
image-generation state directory with a bounded TTL, record count, and per-image
byte limit. Follow-up Responses requests can therefore reference a prior image
with only `{type:"image_generation_call",id:"ig_..."}` and the bridge resolves
that id into an edit input before calling provider-backed `/images/edits`.
The adapter also reads prior image-generation output from `previous_response_id`
so the documented multi-turn image workflow can enter edit mode without
duplicating base64 data in the new request.
After the local edit adapter consumes those image inputs, the bridge replaces
the corresponding upstream Chat `image_url` content parts with a text marker so
text-only providers such as DeepSeek do not reject the request.

## Direct Audio Endpoint Coverage

OpenAI's request-based Audio APIs use direct HTTP requests for bounded speech
and audio-file workloads, while Realtime voice sessions are a separate surface.
The bridge implements the request-based protocol locally so SDKs, UI flows, and
Batch JSONL can exercise Audio routes even when the upstream provider is
Chat-only.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/audio/speech` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before local speech generation or usage recording; accepts JSON `input`, `model`, `voice`, `response_format`, `speed`, `instructions`, official `stream_format:"audio"|"sse"`, and the local `stream:true` extension; validates required `model`/`input`/`voice`, 4096-character `input`/`instructions` limits, custom voice `{id}` shape, and official response/stream format enums before returning deterministic placeholder audio bytes for `mp3`, `opus`, `aac`, `flac`, `wav`, or `pcm`, or SSE `speech.audio.*` events when streaming is requested |
| `POST /v1/audio/transcriptions` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before multipart/JSON parsing, local transcription generation, or usage recording; accepts official multipart `file` requests plus JSON/base64 file shapes for Batch; validates required `model`, `include:["logprobs"]`, `timestamp_granularities:["word","segment"]`, `chunking_strategy`, and known-speaker list caps before local handling; supports `json`, `verbose_json`, `diarized_json`, `text`, `srt`, `vtt`, transcription SSE events, placeholder `logprobs:[]` for valid JSON logprob requests, and word timestamps for valid verbose timestamp requests |
| `POST /v1/audio/translations` | Implemented locally | Accepts the official no-query create shape; unsupported query parameters return 400 before multipart/JSON parsing, local translation generation, or usage recording; accepts official multipart `file` requests plus JSON/base64 file shapes for Batch; validates required `model` and supports `json`, `verbose_json`, `text`, `srt`, and `vtt` response formats |
| `POST /v1/audio/voice_consents` | Implemented locally | Accepts official-style multipart `name`, `language`, and `recording` plus JSON/base64 compatibility; stores local metadata only with `cons_*` ids, file byte counts, content type, format, and sha256 |
| `GET /v1/audio/voice_consents` | Implemented locally | Lists local consent recording metadata with official `after` and `limit` pagination; `limit` is validated from 1 through 100 with default 20, scalar `after` may appear only once, and unsupported generic paginator parameters such as `before` and `order` do not affect the official list result |
| `GET /v1/audio/voice_consents/{consent_id}` | Implemented locally | Retrieves local consent metadata by id |
| `DELETE /v1/audio/voice_consents/{consent_id}` | Local cleanup extension | Deletes local consent metadata only when no stored custom voice references it; referenced consents fail closed with `voice_consent_in_use` so local state cannot keep dangling voice records |
| `POST /v1/audio/voices` | Implemented locally | Accepts official-style multipart `name`, `consent`, and `audio_sample` plus JSON/base64 compatibility; requires an existing local `cons_*` id and enforces a local 20-voice cap |
| `GET /v1/audio/voices` | Implemented locally | Lists local custom voice metadata; this is included for local UI and SDK compatibility even though the current public OpenAPI path metadata only expands `createVoice` |
| `GET /v1/audio/voices/{voice_id}` | Implemented locally | Retrieves local custom voice metadata by id; custom voice ids can also be passed as `/v1/audio/speech` `voice` values for placeholder speech protocol tests |
| `DELETE /v1/audio/voices/{voice_id}` | Local cleanup extension | Deletes local custom voice metadata and returns an OpenAI-style deleted object so long-running compatibility smoke tests can clean up bounded local state |

Local Batch JSONL can execute `/v1/audio/transcriptions` and
`/v1/audio/translations` when each request carries JSON/base64 audio data.
`/v1/audio/speech` intentionally remains a direct API path because its primary
response is binary audio, while Batch output files are JSONL.

This is protocol compatibility, not model-side listening, production-grade
speech synthesis, or real voice cloning. Placeholder mode returns deterministic
bytes/text and records `compatibility.provider:"local"` for transcription and
translation responses. Custom voice compatibility stores governance metadata
only and records `synthetic_voice_model_created:false`; it does not create a
usable cloned voice model. Text-only Chat providers such as DeepSeek still do
not natively process audio content, and Realtime sessions plus provider-backed
audio quality remain future work.

The bridge also exposes a direct OpenAI-compatible
`POST /v1/images/generations` endpoint for clients that call the Image API
instead of the Responses hosted tool. JSON requests accept `prompt`, `model`,
`n` from 1 to 10, `size`, `quality`, `background`, `moderation`,
`output_format`, `output_compression`, `response_format`, `style`, `user`, and
`stream`. Non-streaming responses use the OpenAI `ImagesResponse` shape with
`created`, `data[].b64_json`, optional `data[].revised_prompt`, and provider
`usage` when present. `stream:true` returns Image API SSE events
`image_generation.partial_image` and `image_generation.completed`;
provider-backed streaming requests forward `stream:true` and relay upstream
SSE events as they arrive, while placeholder mode and providers that return
JSON synthesize compatible events from the final image. The bridge also exposes
direct `POST /v1/images/edits` compatibility. Multipart requests accept
`image` / `image[]` / `images[]` files, optional `mask`, `prompt`, `model`,
`n`, `size`, `quality`, `background`, `input_fidelity`, `moderation`,
`output_format`, `output_compression`, `response_format`, `user`, `stream`,
and `partial_images`. JSON edit requests accept OpenAI-style `images` entries
and optional `mask` using `image_url` data URLs, HTTP(S) URLs, or local
`file_id` references so Batch JSONL can exercise edit workflows without
multipart bodies. Non-streaming direct edit responses use the same
`ImagesResponse` shape; `stream:true` returns `image_edit.partial_image` and
`image_edit.completed` SSE events, relaying upstream provider SSE when
available and synthesizing compatible events for placeholder or JSON fallback
responses. The direct `POST /v1/images/variations` endpoint follows the
official Images variation operation shape: multipart requests accept one
`image` file plus `model`, `n`, `size`, `response_format`, and `user`, default
to `dall-e-2` when the client omits `model`, and return the same
`ImagesResponse` shape. Provider-backed mode forwards multipart form data to
the configured `/images/variations` path. Placeholder mode returns deterministic
PNG variations for protocol/UI testing. For local Batch compatibility, the
bridge also accepts JSON variation bodies with `image`, `images`, or
`image_url` entries that use data URLs, HTTP(S) URLs, or local `file_id`
references, because Batch JSONL cannot carry multipart file parts. Direct
Images create/edit/variation calls reject unsupported URL query parameters with
OpenAI-style `invalid_request_parameter` errors before body parsing,
generation, provider forwarding, or usage recording.
Local Batch JSONL can execute `/v1/images/generations`, JSON-form
`/v1/images/edits`, and JSON-form `/v1/images/variations` requests
synchronously and write the direct Images response into the Batch output file.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_IMAGE_GENERATION_PROVIDER` | `placeholder` | Use `placeholder`, `openai-compatible`, `openai`, `images`, or `disabled` |
| `CODEXCOMPAT_IMAGE_GENERATION_BASE_URL` | `https://api.openai.com/v1` | Base URL for provider-backed image generation |
| `CODEXCOMPAT_IMAGE_GENERATION_PATH` | `/images/generations` | JSON image-generation endpoint path |
| `CODEXCOMPAT_IMAGE_GENERATION_EDIT_PATH` | `/images/edits` | Multipart image-edit endpoint path for provider-backed Responses edits and direct `/v1/images/edits` calls |
| `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_PATH` | `/images/variations` | Multipart image-variation endpoint path for provider-backed direct `/v1/images/variations` calls |
| `CODEXCOMPAT_IMAGE_GENERATION_STATE_DIR` | `${CODEXCOMPAT_STATE_DIR}/local-image-generations` | Local JSON state directory for generated image-call bytes used by id-only follow-up edits |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGES` | `5000` | Maximum generated image-call records retained locally before cleanup prunes older files |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGE_BYTES` | `52428800` | Maximum generated image bytes persisted for later id-only edit references |
| `CODEXCOMPAT_IMAGE_GENERATION_STORE_TTL_MS` | `1209600000` | TTL for locally persisted generated image-call records; default is 14 days |
| `CODEXCOMPAT_IMAGE_GENERATION_API_KEY_ENV` | `OPENAI_API_KEY` | Environment variable name used for provider-backed image generation keys |
| `CODEXCOMPAT_IMAGE_GENERATION_MODEL` | `gpt-image-2` | Image model sent to provider-backed image generation |
| `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_MODEL` | `dall-e-2` | Default model sent to direct Images variation provider calls when the client omits `model`; OpenAI's documented variation operation currently supports `dall-e-2` |
| `CODEXCOMPAT_IMAGE_GENERATION_RESPONSE_FORMAT` | empty | Optional `response_format` override, for example `b64_json` for providers/models that require it |
| `CODEXCOMPAT_IMAGE_GENERATION_TIMEOUT_MS` | `120000` | Timeout for provider-backed image generation requests |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_INPUT_IMAGE_BYTES` | `52428800` | Maximum local bytes per edit input image or mask, aligned to the documented 50MB Images edit limit |
| `CODEXCOMPAT_IMAGE_GENERATION_INPUT_FETCH_TIMEOUT_MS` | `10000` | Timeout for bounded HTTP(S) input image URL fetches before multipart edits |
| `CODEXCOMPAT_IMAGE_GENERATION_PLACEHOLDER_SIZE` | `96` | Pixel width/height for the deterministic local PNG placeholder, bounded from 16 to 512 |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_IMAGE_GENERATION` | `true` | Disables DeepSeek thinking mode when the bridge injects local image-generation context so visible text still returns under small output budgets |

## Videos Endpoint Coverage

OpenAI's current Video generation guide describes an asynchronous `POST
/v1/videos` job, polling with `GET /v1/videos/{video_id}`, downloading the final
MP4 plus optional `thumbnail` and `spritesheet` variants through `GET
/v1/videos/{video_id}/content`, and creating reusable video characters through
`POST /v1/videos/characters`. The bridge implements a local OpenAI-compatible
job and character surface so SDKs, UI workflows, and Batch JSONL tests can
exercise video protocol paths even when the upstream provider only exposes Chat
Completions.

| Endpoint | Status | Notes |
| --- | --- | --- |
| `POST /v1/videos` | Implemented locally | Accepts JSON or multipart `prompt`, optional `model`, `size`, `seconds`, `quality`, `metadata`, `characters` with up to two character ID references, and asset references; rejects unsupported query parameters before body parsing; returns an OpenAI-style `object:"video"` record with `status:"completed"` and `progress:100` |
| `GET /v1/videos` | Implemented locally | Lists local video jobs with official `limit`, `after`, and `order` pagination; `limit` is validated from 0 through 100 with default 20, `limit=0` returns an empty page with `has_more` when records exist, scalar `after` / `order` / `limit` may appear only once, `order` is validated against `asc` / `desc`, and unsupported generic paginator parameters such as `before` do not affect the official list result |
| `GET /v1/videos/{video_id}` | Implemented locally | Retrieves a stored local video job and rejects unsupported query parameters before lookup |
| `DELETE /v1/videos/{video_id}` | Implemented locally | Deletes a local video job and returns `object:"video.deleted"`; unsupported query parameters fail before deletion |
| `GET /v1/videos/{video_id}/content` | Implemented locally | Returns small placeholder bytes with single `variant=video`, `thumbnail`, or `spritesheet` and matching `video/mp4`, `image/webp`, or `image/jpeg` content type; unsupported query parameters and repeated `variant` values fail locally |
| `POST /v1/videos/characters` | Implemented locally | Accepts multipart `name` plus `video` upload, with JSON/base64 compatibility for tests, rejects unsupported query parameters before body parsing, stores a local `object:"video.character"` record, and returns a reusable `char_...` id |
| `GET /v1/videos/characters/{character_id}` | Implemented locally | Retrieves a stored local video character record and rejects unsupported query parameters before lookup |
| `DELETE /v1/videos/characters/{character_id}` | Implemented locally | Deletes a local video character record and returns `object:"video.character.deleted"`; unsupported query parameters fail before deletion |
| `POST /v1/videos/edits` | Implemented locally | Accepts JSON or multipart edit requests with a source `video` reference/upload, rejects unsupported query parameters before body parsing, returns a completed local video job, and records `source_video` plus `metadata.compatibility.operation:"edit"` |
| `POST /v1/videos/{video_id}/edits` | Local compatibility alias | Accepts clients following earlier cookbook-style path examples, rejects unsupported query parameters before body parsing, maps `{video_id}` to the local source video descriptor, and returns the same local edit job shape as `POST /v1/videos/edits` |
| `POST /v1/videos/extensions` | Implemented locally | Accepts JSON or multipart extension requests with a source `video` reference/upload, rejects unsupported query parameters before body parsing, and returns a completed local video job with `source_video` and `metadata.compatibility.operation:"extend"` |
| `POST /v1/videos/{video_id}/remix` | Implemented locally | Accepts JSON or multipart remix requests, rejects unsupported query parameters before body parsing, records `source_video_id`, and returns a completed local video job |

Local Batch JSONL now executes `/v1/videos` requests synchronously. This matches
the documented Batch restriction that video Batch requests are JSON-only and use
`POST /v1/videos`; multipart video edit/extension/remix requests are direct API
compatibility paths, not Batch inputs.

This is a protocol compatibility layer, not hosted Sora rendering. The default
`CODEXCOMPAT_VIDEO_GENERATION_PROVIDER=placeholder` avoids large media files and
keeps the `/srv/aialra/apps` deployment disk-bounded. Real video provider
integration remains future work.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_VIDEO_GENERATION_PROVIDER` | `placeholder` | Local video compatibility mode |
| `CODEXCOMPAT_VIDEO_GENERATION_MODEL` | `sora-2` | Default model id returned by local video jobs when the request omits `model` |
| `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SIZE` | `1280x720` | Default video `size` field |
| `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SECONDS` | `4` | Default video `seconds` field |
| `CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_QUALITY` | `standard` | Default video `quality` field |
| `CODEXCOMPAT_VIDEO_GENERATION_MAX_INPUT_BYTES` | `52428800` | Maximum multipart body size accepted by the local video compatibility endpoint |

## Known Gaps

| Capability | Why it is not fully native yet | Planned path |
| --- | --- | --- |
| OpenAI hosted `web_search` full parity | The local adapter can search, cite, open bounded top-result pages, and run local `find_in_page` scans over extracted text, but the default no-key provider is Wikipedia-only and does not match OpenAI's hosted ranking/policy behavior | Add production web-search provider support, stronger citation ranking, and richer search policy controls |
| OpenAI Batch full parity | The local adapter covers synchronous JSONL execution for implemented text/embedding/moderation endpoints, direct `/v1/audio/transcriptions`, direct `/v1/audio/translations`, direct `/v1/images/generations`, JSON-form direct `/v1/images/edits`, JSON-form direct `/v1/images/variations`, direct `/v1/videos`, plus `/v1/responses` requests that use local `image_generation`, and stores output/error JSONL through the Files API, but it is not an async distributed 24h job service or hosted media-render queue | Add async workers, resumable/persisted queues, larger disk-governed staging profiles, multipart-to-Batch staging if OpenAI documents it, and provider-backed media generation |
| OpenAI Fine-tuning full parity | The local adapter covers job create/list/retrieve, cancel/pause/resume lifecycle events, checkpoint listing, and checkpoint permission list/create/delete, but it does not validate training datasets, schedule hosted training, produce a real provider-deployed fine-tuned model, enforce organization/project permissions, or train DeepSeek/OpenAI weights | Add provider-specific tuning backends where available, dataset validators, async job workers, artifact/result-file generation, permission middleware, and quality evals comparing tuned-model behavior against baseline models |
| OpenAI Organization admin full parity | The local adapter covers the documented costs and usage response shapes with a bounded local usage ledger and zero-cost billing boundary, plus local organization user/invite lifecycle, redacted organization admin API-key lifecycle, organization/project certificate metadata lifecycle, local audit-log listing/filtering over compatibility-store events, organization custom roles/groups/user-role/group-role/group-membership lifecycle, organization/project spend-alert lifecycle, organization/project data-retention metadata, project model-permission metadata, project hosted-tool-permission metadata, project create/list/retrieve/update/archive, project user lifecycle, project group access lifecycle, project service-account lifecycle, redacted project API-key inspection/deletion boundaries, and project rate-limit listing/updating so admin SDK calls do not 404 for those families. It is not real OpenAI organization billing, hosted organization administration, hosted OpenAI security logging, or provider TLS policy control; it does not import provider invoices, compute paid costs, create provider accounts, send invite email, send spend-alert email, enforce provider retention/model/tool/certificate permissions, enforce RBAC authorization, or produce usable provider keys | Extend usage aggregation into hosted-tool internals and provider billing importers, add admin-auth middleware, export jobs, dashboard reconciliation tests, and project-scoped authorization checks |
| OpenAI Evals and Graders full parity | The local adapter covers eval create/list/get/update/delete, synchronous run create/list/get, output item list/get, `purpose:"evals"` Files, Responses-template sample generation, deterministic `string_check`, `text_similarity`, local subprocess `python`, provider-backed `score_model`, and non-nested `multi` grading, standalone Graders validate/run endpoints for those supported graders, judge token usage accounting, and result aggregation. It is not the hosted OpenAI Evals dashboard, async large-run scheduler, exact NLP metric implementation, OpenAI hosted judge runtime, OpenAI hosted Python execution image, or replacement for SWE-bench/scored agent benchmarks | Add async workers, exact optional grader dependencies, hardened container/microVM Python isolation, provider selection policies for judge models, dataset sharding, dashboard/report export, and larger quality/stability eval suites |
| OpenAI ChatKit full parity | The local adapter covers beta session creation/cancellation, thread listing/filtering, local thread lifecycle, and item append/list persistence, but it is not OpenAI's hosted ChatKit workflow runtime, hosted authentication broker, UI transport, or workflow execution service | Add hosted-style workflow execution over Responses/Chat, session request accounting, auth-token validation middleware, richer thread item subtype coverage, and ChatKit UI smoke tests when the frontend adopts these endpoints |
| OpenAI Realtime full parity | The local adapter covers REST creation of Realtime sessions, client secrets, transcription sessions, translation client secrets, WebRTC call setup response shape, and local call accept/reject/refer/hangup lifecycle state. It is not a low-latency Realtime media service, WebRTC/SIP media bridge, WebSocket event runtime, speech-to-speech model loop, or hosted tracing backend | Add a real WebRTC/WebSocket relay backed by an audio-capable provider or OpenAI Realtime, server-side event translation, media/session isolation, call monitoring streams, token validation/accounting, and audio latency/quality evals |
| OpenAI Assistants full parity | The local adapter covers Assistants CRUD, Threads CRUD, Messages CRUD, synchronous Chat-backed Runs, run `additional_messages` / `additional_instructions` / `reasoning_effort` / `truncation_strategy.last_messages` / best-effort `max_prompt_tokens`, observed `max_prompt_tokens` / `max_completion_tokens` incomplete terminal mapping, function-tool `requires_action` / `submit_tool_outputs` loops through Chat `tool_calls`, local active-run thread locks, elapsed `expires_at` expiration to `expired`, local Assistants `file_search` over bridge vector stores with include-gated Run Step result content, local Assistants `code_interpreter` over explicit Python blocks with file-id mounts, message-attachment resource materialization for `file_search` and `code_interpreter`, Run Step listing/retrieval, terminal cancel no-op, create-thread-and-run, streamed Chat text/refusal deltas as Assistants `thread.message.delta`, streamed token-budget terminal events as `thread.run.incomplete`, and streamed Chat tool-call/function-call arguments as `thread.run.step.delta`, but it is not OpenAI hosted Assistants and does not yet implement exact hosted tokenizer accounting ahead of provider calls, model-driven hosted code loops, non-text hosted-tool delta details, or hosted async worker scheduling | Add async run workers with hosted-style scheduling/lock timing, exact provider/model token accounting where available, broader non-text delta parity, and stronger hosted-tool loop orchestration |
| OpenAI hosted Moderations full parity | The local adapter covers response shape and deterministic text/category rules for Chat-only provider compatibility, but it is not OpenAI's hosted moderation classifier and does not inspect image pixels | Add provider-backed or specialized moderation models, image inspection, multilingual policy evals, and larger safety benchmark suites |
| OpenAI `input_file` full parity | The local adapter covers text/code/base64/local file IDs/completed Uploads/HTTP(S) URLs, PDF text-layer extraction, optional bounded local Tesseract OCR fallback for scanned PDFs, deterministic CSV/TSV/XLSX spreadsheet augmentation, and basic `.docx`/`.pptx` OOXML text extraction, but not OpenAI hosted PDF page-image/vision context, OpenAI's model-generated spreadsheet summaries, legacy binary Office formats, embedded media, or complex workbook semantics | Add optional rendered-page context for vision-capable providers, richer spreadsheet summarization, legacy Office parsers, embedded media handling, and stronger file-type detection |
| OpenAI Uploads full parity | The local adapter covers create, add Parts, ordered completion, byte-count validation, optional local SHA-256 checksum validation, expiration persistence, cancellation, binary-safe File creation, completed File checksum metadata, default pruning of intermediate Part bytes after terminal states, runtime pruning for Upload workdirs, and PDF `input_file` extraction after completion, but local disk caps are intentionally much smaller than OpenAI hosted limits by default and resumability semantics are not yet modeled | Add resumable upload sessions if an official-compatible surface is documented, async/parallel stress tests, and larger disk-governed staging profiles |
| OpenAI hosted `file_search` full parity | The local adapter covers API shape, byte-preserving file upload, vector-store lifecycle, static overlapping chunks for text-like files plus shared local extraction for PDF text layers, bounded PDF OCR, basic OOXML documents, and spreadsheet text, hybrid local keyword + hashed-semantic retrieval, comparison/compound attribute filters, bounded multi-query decomposition, `score_threshold` ranking options, local OpenAI-compatible embeddings, and citations, but it is not OpenAI's managed semantic vector search, hosted embedding model, hosted asynchronous ingestion worker, or reranker | Add provider/model-backed embeddings, ANN vector indexing, async batches, managed-style query rewriting/reranking, richer binary-document/media extraction, and larger eval sets |
| OpenAI hosted `shell` / `code_interpreter` full parity | The local adapter covers explicit command execution, container lifecycle shape, output items, and artifacts, but it is not a hardened hosted container runtime | Add Docker/Firecracker isolation, network allowlists, domain secrets, service support, richer command negotiation, and lifecycle garbage collection |
| OpenAI Skills full parity | The local adapter covers upload/list/read/delete/version/content endpoints and local shell `skill_reference` mounting, but it is not OpenAI's hosted skill service and does not yet expose org/project governance, hosted validation policy, or SDK-perfect metadata for every future field | Expand schema fidelity as official SDKs stabilize, add richer bundle validation, and connect skills to future hosted tool adapters |
| OpenAI hosted `computer` / `computer_use_preview` full parity | The local adapter covers the screenshot-first `computer_call` item shape, `computer_call_output` replay context including bounded acknowledged safety-check summaries, non-streaming/streaming/background model-requested follow-up action mapping and common action-field alias normalization for `click`, `double_click`, `scroll`, `type`, `wait`, `keypress`, `drag`, `move`, and `screenshot`, local metadata, and shared `max_tool_calls`, but it is not a hosted browser/desktop executor and does not yet physically perform UI actions or run server-side multi-step UI loops | Add Playwright/VNC execution, screenshot capture, product safety-check acknowledgement policy, per-session isolation, cleanup policies, and richer multi-round action-loop control |
| OpenAI hosted `tool_search` full parity | The local adapter covers function/namespace deferred loading for known request tools, deferred remote MCP server group search with bounded `tools/list` import, public `tool_search_call` / `tool_search_output` / `mcp_list_tools` items, client-mode first-call emission, previous-response/input `tool_search_output` replay without repeating the `tools` array, live client-executed bridge regression against DeepSeek, live large-catalog bridge regression over 8 namespaces / 48 deferred tools that loads only the selected namespace, an eight-namespace deterministic shuffled-catalog sweep with latency/token/load-fraction/leak/suppression metrics, DSML text pseudo-call promotion for loaded functions, assistant-prose suppression for loaded tool-only turns, `additional_tools` input loading, non-streaming/streaming/background paths, collision-safe streaming name remapping for generated Chat function names, and shared `max_tool_calls`, but it is not OpenAI's hosted tool-index service and does not yet search hosted connector inventories or guarantee exact hosted ranking/cache behavior | Add connector search, per-tenant search indexes, larger randomized quality/latency/token evals, and hosted ranking/cache comparisons |
| OpenAI hosted MCP / Connectors full parity | The local MCP adapter covers MCP tool reservation, remote `initialize` / `tools/list` import over Streamable HTTP-style JSON-RPC with JSON/SSE responses, deferred input `mcp_list_tools` reuse, deferred MCP server loading through hosted local `tool_search`, exact MCP `tool_choice` mapping to generated Chat function names when uniquely resolvable, non-streaming, streaming, and active background auto-approved remote `tools/call` execution through Chat function-tool proxies, streaming `mcp_call` argument/progress events, streaming `mcp_approval_request` emission, non-streaming/streaming/background `mcp_approval_request` / `mcp_approval_response` execution for approval-required remote calls, `mcp_list_tools` and `mcp_call` output items, caller-supplied MCP input context, authorization redaction, background snapshots, streaming list output items, and shared `max_tool_calls`, but it does not provide restart-resumable per-request MCP authorization or hosted connector flows | Add hosted connector OAuth/token sidecars, allowlists, tool-output review, restart-resumable connector credentials, broader approval-state persistence, and multi-turn call replay tests |
| OpenAI hosted `image_generation` / Videos full parity | The local adapter covers Responses output shape, direct `/v1/images/generations` JSON and SSE compatibility, direct `/v1/images/edits` multipart/JSON and SSE compatibility, direct `/v1/images/variations` multipart/JSON compatibility, provider-backed Images API generations, multipart edits, and multipart variations, upstream provider SSE relay for direct Images generation/edit requests, input image and mask upload mapping, placeholder fallback, provider failure mapping, background/stored response preservation, id-only multi-turn image-call persistence, Batch `/v1/responses`, `/v1/images/generations`, JSON-form `/v1/images/edits`, JSON-form `/v1/images/variations`, direct `/v1/videos`, local Videos create/list/retrieve/delete/content protocol compatibility, local Videos character create/retrieve/delete compatibility, and video `characters` reference preservation. It does not yet perform hosted Sora-quality video rendering, OpenAI hosted model-side prompt rewriting, or image/video-quality evals beyond protocol shape checks | Add moderation/error-detail parity, provider-backed video rendering, hosted-style prompt rewrite metadata, and image/video-quality evals |
| OpenAI Conversations full parity | The local adapter covers object/item lifecycle and Responses state replay, but not every future OpenAI item subtype or server-side retention policy | Expand item subtype coverage as Codex emits them and add explicit retention/compaction policy controls |
| Native OpenAI compaction portability | Local compaction can be decrypted only by this bridge deployment/key; it is not OpenAI ZDR encrypted content | Keep key outside Git, document the boundary, and add optional key rotation/export policy |
| Native hosted background durability full parity | Local background jobs are file-backed, carry per-process persistent leases, can resume provider calls after `provider_pending`, and can resume local tool/context preparation from persisted `ready` step checkpoints. Startup skips records with an unexpired foreign lease to avoid duplicate multi-process recovery, and jobs interrupted while a local preparation step is actively `running` fail closed to avoid re-running side-effecting local tools. This is still a local retry layer rather than OpenAI's hosted job service | Add a persisted worker queue with retry policies, backoff, heartbeat metrics, idempotency-aware active-step retries, and cross-host lease storage for distributed deployments |
| Native audio input/output parity on text-only providers | Audio-capable Chat providers can accept `input_audio` content parts and return `message.audio`/`delta.audio`, which the bridge preserves as `output_audio`; text-only providers receive transcript/marker context through `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE=text` instead of raw audio bytes. The bridge also implements direct request-based `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/audio/voice_consents`, and `/v1/audio/voices` protocol compatibility. Text-only providers such as DeepSeek still do not natively understand audio input, synthesize semantic audio, or create real cloned voice models | Add optional provider/model adapters for audio-capable Chat or Realtime models, provider-backed speech/transcription/custom voices, and audio-quality evals |
| `n>1` multiple candidates | Responses removed `n`; Codex expects one generation | Non-streaming and streaming upstream Chat choices are preserved as multiple output items and replay messages when returned. Direct Chat request-side `n>1` is forwarded to capable providers or locally emulated for unsupported providers in both non-streaming and streaming modes; streaming fan-out preserves a single logical completion id and remaps choice indexes across upstream calls |
| Exact OpenAI annotations | Provider-specific; chat often lacks annotations | Preserve non-streaming and streaming annotations when present, synthesize only from local tools |
| Direct Chat passthrough full parity across providers | The bridge now normalizes current OpenAI Chat developer-role requests, token aliases, reasoning effort, DeepSeek `user_id`, local stored-chat `store`/`metadata` semantics, direct Chat `tool_choice` thinking compatibility, maps OpenAI identity/cache aliases into DeepSeek `user_id` without misreporting them as dropped, and filters known unsupported OpenAI-only fields such as `parallel_tool_calls` for DeepSeek, but every provider has its own evolving field matrix | Add provider profiles for additional Chat-compatible APIs and expand live conformance cases as SDKs add fields |

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
