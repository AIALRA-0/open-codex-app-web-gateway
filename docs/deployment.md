# Deployment Notes

Target app path:

```text
/srv/aialra/apps/open-codex-app-web-gateway
```

Target public hostname:

```text
opencodexapp.aialra.online
```

## Ports

| Service | Default port |
| --- | ---: |
| login proxy | `12923` |
| web gateway | `12920` |
| Codex app-server websocket | `12921` |
| Responses bridge | `12912` |

The existing `codexapp` deployment uses separate ports. Do not reuse them.

## Secret File

Create a machine-local file such as:

```text
/srv/aialra/config/secrets/opencodexapp.env
```

It should be mode `0600`, owned by the runtime user, and must not be committed.
Use `.env.example` as the list of variables, but never copy real values into the
repository.

## Codex Provider Config

Codex provider settings must live in user-level `$CODEX_HOME/config.toml`.
Project-local `.codex/config.toml` cannot override provider settings according
to the current Codex config reference.

Example:

```toml
model = "deepseek-v4-pro"
model_provider = "opencodex_deepseek"

[model_providers.opencodex_deepseek]
name = "Open Codex DeepSeek Bridge"
base_url = "http://127.0.0.1:12912/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"
```

For isolation from the existing production CodexApp, prefer a dedicated
`CODEX_HOME`, for example:

```text
/srv/aialra/state/opencodexapp-codex-home
```

## DeepSeek Defaults

As of 2026-06-10, DeepSeek documents `https://api.deepseek.com` with the chat
path `/chat/completions`, and recommends `deepseek-v4-flash` or
`deepseek-v4-pro`. The older `deepseek-chat` and `deepseek-reasoner` aliases are
documented for deprecation on 2026-07-24 15:59 UTC.

Useful bridge flags:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT` | `true` | Maps OpenAI/Codex Responses `reasoning.effort` and direct Chat `reasoning_effort` values to DeepSeek-supported values |
| `CODEXCOMPAT_DEEPSEEK_THINKING_MODE` | `false` | Forces `thinking:{type:"enabled"}` when a request asks for reasoning effort |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE` | `true` | Disables DeepSeek thinking mode for Responses translation and direct Chat passthrough function-tool requests that also set `tool_choice` |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_COMPACTION` | `true` | Disables DeepSeek thinking mode for local `/v1/responses/compact` summarization and compaction replay follow-ups so visible content is returned reliably |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH` | `true` | Disables DeepSeek thinking mode when the bridge injects local web-search context, preventing reasoning-only completions from exhausting the output budget |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH` | `true` | Disables DeepSeek thinking mode when the bridge injects local file-search context, preventing citation-only or empty visible completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL` | `true` | Disables DeepSeek thinking mode when the bridge injects local shell execution context, preventing empty visible completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_IMAGE_GENERATION` | `true` | Disables DeepSeek thinking mode when the bridge injects local image-generation context, preventing reasoning-only completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES` | `true` | Disables DeepSeek thinking mode when the bridge injects local input-file text, preventing reasoning-only completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_USER_ID_COMPAT` | auto for `*.deepseek.com` | Maps Responses/OpenAI identity fields to DeepSeek `user_id`; invalid DeepSeek characters are replaced with a stable SHA-256 identifier |
| `CODEXCOMPAT_MAX_TOKENS_FIELD` | `max_tokens` | Provider field used for Responses `max_output_tokens`, Chat `max_completion_tokens`, and legacy `max_tokens` aliases; DeepSeek documents `max_tokens` |
| `CODEXCOMPAT_FORWARD_STORED_CHAT_FIELDS` | auto: `false` for DeepSeek, `true` otherwise | Forwards OpenAI Chat stored-completion request fields `store` and `metadata` only to upstream providers that support them. Local Responses and Chat storage semantics remain active when this is disabled, and filtered fields are recorded in compatibility metadata |
| `CODEXCOMPAT_FORWARD_SERVICE_TIER` | auto: `false` for DeepSeek, `true` otherwise | Forwards Responses/OpenAI `service_tier` to upstream Chat providers that support it; filtered requests are recorded in compatibility metadata |
| `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS` | auto: `false` for DeepSeek, `true` otherwise | Forwards Chat-native request fields such as `logit_bias`, `modalities`, `prediction`, `n`, `parallel_tool_calls`, prompt-cache hints, `web_search_options`, and legacy `functions/function_call`; filtered requests are recorded in compatibility metadata |
| `CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS` | auto: `false` for DeepSeek, `true` otherwise | Forwards OpenAI Chat custom tools to upstream providers that support non-function tools; DeepSeek defaults to filtering custom tools and invalid custom `tool_choice` values while preserving function tools |
| `CODEXCOMPAT_FORWARD_STREAM_OPTIONS` | `true` | Forwards Chat-native `stream_options` when a Responses request uses `stream:true` |
| `CODEXCOMPAT_STREAM_OPTION_FIELDS` | auto: `include_usage` for DeepSeek, unrestricted otherwise | Optional comma-separated allowlist for forwarded `stream_options` subfields. Use `*` or `all` to forward every subfield, or `none` to filter all subfields |
| `CODEXCOMPAT_STREAM_INCLUDE_USAGE` | `true` | Adds `stream_options.include_usage=true` to streaming upstream Chat requests unless the caller sets it explicitly |
| `CODEXCOMPAT_JSON_SCHEMA_MODE` | `json_object` | Downgrades Responses JSON Schema output to JSON object mode plus an explicit schema instruction |
| `CODEXCOMPAT_PROMPT_TEMPLATES` | empty | Optional JSON object of local Responses prompt templates keyed by prompt id or `id@version`; supports `instructions`, `messages`, `input`, `content`, and `{{variable}}` substitution. Keep private templates out of Git |
| `CODEXCOMPAT_PROMPT_TEMPLATE_FILE` | empty | Optional path to a JSON object containing local prompt templates; env JSON overrides duplicate file keys. Store under `/srv/aialra/config` or another runtime path, not the repo |
| `CODEXCOMPAT_BATCH_MAX_REQUESTS` | `1000` | Maximum JSONL request lines accepted by the local synchronous Batch API; raise only with disk/quota controls in place |
| `CODEXCOMPAT_EVAL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-evals` | Local Evals API state path for eval definitions, runs, and output items; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_EVAL_MAX_ROWS` | `100` | Maximum JSONL rows loaded for a local synchronous Eval run; raise only after disk/quota and runtime controls are ready |
| `CODEXCOMPAT_FINE_TUNING_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-fine-tuning` | Local Fine-tuning Jobs/checkpoint permission compatibility state path; protocol metadata only, no real training artifacts |
| `CODEXCOMPAT_FINE_TUNING_MAX_RECORDS` | `5000` | Maximum local Fine-tuning job and checkpoint-permission records retained before opportunistic cleanup |
| `CODEXCOMPAT_ORGANIZATION_USAGE_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-organization-usage` | Local Organization usage ledger path for numeric usage events; stores no prompts, messages, uploaded file bodies, Authorization headers, API keys, or provider secrets. Costs remain zero-value compatibility data, not real provider billing |
| `CODEXCOMPAT_ORGANIZATION_USAGE_MAX_RECORDS` | `5000` | Maximum local Organization usage ledger events retained before opportunistic cleanup |
| `CODEXCOMPAT_ORGANIZATION_ADMIN_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-organization-admin` | Local Organization users/invites/admin-API-keys/certificates/audit-logs/roles/groups/user-role assignments/group-role assignments/group memberships/projects/project-users/project-groups/project-certificates/organization-and-project-spend-alerts/data-retention/model-permissions/hosted-tool-permissions/service-accounts/project-API-key/rate-limit compatibility state path; protocol metadata only, no real provider accounts, outbound invite email, hosted security audit export, spend-alert email, usable provider or admin keys, enforced RBAC permissions, enforced provider model/tool/certificate permissions, provider data-retention changes, provider TLS policy changes, or enforced provider throttles |
| `CODEXCOMPAT_ORGANIZATION_ADMIN_MAX_RECORDS` | `5000` | Maximum local Organization admin records retained before opportunistic cleanup |
| `CODEXCOMPAT_PYTHON_GRADER_PROVIDER` | `local` | Local Python grader execution provider; use `disabled` to reject Python grader runs |
| `CODEXCOMPAT_PYTHON_GRADER_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-python-graders` | Temporary local Python grader workdir root; keep outside Git |
| `CODEXCOMPAT_PYTHON_GRADER_TIMEOUT_MS` | `120000` | Per-grader subprocess timeout, capped at the documented 2 minute limit |
| `CODEXCOMPAT_PYTHON_GRADER_MAX_SOURCE_BYTES` | `262144` | Maximum Python grader source size |
| `CODEXCOMPAT_PYTHON_GRADER_DISK_BYTES` | `1073741824` | File-size limit applied by the Python runner when supported |
| `CODEXCOMPAT_PYTHON_GRADER_MEMORY_BYTES` | `2147483648` | Address-space limit applied by the Python runner when supported |
| `CODEXCOMPAT_PYTHON_GRADER_BIN` | `python3` | Python interpreter used by local Python graders |
| `CODEXCOMPAT_CONVERSATION_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-conversations` | Local Conversations API state path; keeps conversation items durable and outside Git |
| `CODEXCOMPAT_ASSISTANT_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-assistants` | Local deprecated Assistants/Threads compatibility state path; keeps assistants, thread messages, runs, and run steps outside Git |
| `CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS` | `400000` | Local estimated input-character budget used to emulate Responses `truncation`. With `truncation:"auto"`, old replay messages are dropped from the beginning of conversation state until under this budget; with `disabled`, the bridge returns `400 context_length_exceeded` before calling the provider when this budget is exceeded |
| `CODEXCOMPAT_COMPACTION_MAX_OUTPUT_TOKENS` | `512` | Output budget for local `/v1/responses/compact` summaries |
| `CODEXCOMPAT_COMPACTION_SECRET_FILE` | `$CODEXCOMPAT_STATE_DIR/compaction.key` | AES-GCM key file for local compaction `encrypted_content` and local Responses `reasoning.encrypted_content` emulation; keep outside Git and mode `0600` |
| `CODEXCOMPAT_INPUT_FILE_PROVIDER` | `local` | Local Responses `input_file` adapter provider. Use `disabled` to leave file inputs as marker-only metadata |
| `CODEXCOMPAT_INPUT_FILE_MAX_FILES` | `8` | Maximum `input_file` items extracted per Responses request |
| `CODEXCOMPAT_INPUT_FILE_MAX_BYTES` | `4194304` | Maximum bytes accepted from each local/inline file input and retained from each remote `file_url`; loader caps this at 50 MB |
| `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS` | `200000` | Maximum extracted text injected into Chat context per file |
| `CODEXCOMPAT_INPUT_FILE_FETCH_URLS` | `true` | Enables bounded HTTP(S) fetches for `input_file.file_url` |
| `CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS` | `10000` | Timeout for remote `input_file.file_url` fetches |
| `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR` | `pdftotext` | Uses local Poppler `pdftotext` to extract text-layer content from PDFs; set `disabled` to skip PDFs |
| `CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS` | `10000` | Timeout for each local PDF extraction process |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR` | `auto` | When PDF text extraction returns no text, attempts bounded local OCR through `pdftoppm` and `tesseract`; set `disabled` to skip OCR fallback |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_MAX_PAGES` | `3` | Maximum first pages rendered for OCR fallback per PDF |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_DPI` | `150` | Render DPI for OCR fallback, bounded to 72-300 |
| `CODEXCOMPAT_INPUT_FILE_PDF_OCR_LANGUAGE` | `eng` | Tesseract language selector for OCR fallback |
| `CODEXCOMPAT_INPUT_IMAGE_PROVIDER` | `local` | Local Responses and Assistants image-file resolver; use `disabled` to leave image file IDs as marker-only compatibility hints |
| `CODEXCOMPAT_INPUT_IMAGE_MAX_IMAGES` | `32` | Maximum local image file IDs resolved per upstream Chat request |
| `CODEXCOMPAT_INPUT_IMAGE_MAX_BYTES` | `4194304` | Maximum bytes accepted from each local image file before conversion to a data URL for vision-capable Chat providers |
| `CODEXCOMPAT_CHAT_IMAGE_INPUT_MODE` | `text` for DeepSeek, `vision` otherwise | `auto`, `vision`, or `text`; DeepSeek defaults to safe text markers because current DeepSeek Chat rejects `image_url` content parts |
| `CODEXCOMPAT_CHAT_AUDIO_INPUT_MODE` | `text` for DeepSeek, `audio` otherwise | `auto`, `audio`, or `text`; DeepSeek defaults to safe text markers because current DeepSeek Chat does not accept `input_audio` content parts |
| `CODEXCOMPAT_CHAT_FILE_INPUT_MODE` | `text` for DeepSeek, `file` otherwise | `auto`, `file`, or `text`; DeepSeek defaults to safe text markers and bounded local extraction for direct Chat `file` / `input_file` content parts |
| `CODEXCOMPAT_AUDIO_PROVIDER` | `placeholder` | Local request-based Audio API compatibility provider for `/v1/audio/speech`, `/v1/audio/transcriptions`, and `/v1/audio/translations`; use `disabled` to reject local Audio requests |
| `CODEXCOMPAT_AUDIO_SPEECH_MODEL` | `gpt-4o-mini-tts` | Default model id returned/recorded by local speech synthesis compatibility when a client omits `model` |
| `CODEXCOMPAT_AUDIO_TRANSCRIPTION_MODEL` | `gpt-4o-transcribe` | Default model id for local transcription compatibility when a client omits `model` |
| `CODEXCOMPAT_AUDIO_TRANSLATION_MODEL` | `whisper-1` | Default model id for local translation compatibility when a client omits `model` |
| `CODEXCOMPAT_AUDIO_DEFAULT_VOICE` | `alloy` | Default speech voice when `/v1/audio/speech` omits `voice` |
| `CODEXCOMPAT_AUDIO_MAX_INPUT_BYTES` | `26214400` | Maximum multipart or JSON-base64 audio input bytes accepted by local transcription/translation compatibility |
| `CODEXCOMPAT_AUDIO_VOICE_STATE_DIR` | `${CODEXCOMPAT_STATE_DIR}/local-audio-voices` | Local JSON metadata store for request-based custom voice consent and voice compatibility; keep outside Git |
| `CODEXCOMPAT_AUDIO_VOICE_MAX_VOICES` | `20` | Local custom voice cap, matching the documented OpenAI organization limit |
| `CODEXCOMPAT_AUDIO_VOICE_MAX_INPUT_BYTES` | `26214400` | Maximum local consent recording or voice sample upload bytes accepted by custom voice compatibility |
| `CODEXCOMPAT_IMAGE_GENERATION_PROVIDER` | `placeholder` | Local Responses `image_generation` plus direct `/v1/images/generations`, `/v1/images/edits`, and `/v1/images/variations` provider. Use `placeholder`, `openai-compatible`, `openai`, `images`, or `disabled`; provider-backed modes call an OpenAI-compatible Images API |
| `CODEXCOMPAT_IMAGE_GENERATION_BASE_URL` | `https://api.openai.com/v1` | Base URL for provider-backed image generation; keep provider-specific endpoints and secrets outside Git |
| `CODEXCOMPAT_IMAGE_GENERATION_PATH` | `/images/generations` | JSON image-generation endpoint path for provider-backed Responses-tool and direct Images API calls |
| `CODEXCOMPAT_IMAGE_GENERATION_EDIT_PATH` | `/images/edits` | Multipart image-edit endpoint path for provider-backed Responses edits and direct Images edit calls |
| `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_PATH` | `/images/variations` | Multipart image-variation endpoint path for provider-backed direct Images variation calls |
| `CODEXCOMPAT_IMAGE_GENERATION_STATE_DIR` | `${CODEXCOMPAT_STATE_DIR}/local-image-generations` | Local JSON state directory for generated image-call bytes used by `image_generation_call.id` and `previous_response_id` follow-up edits |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGES` | `5000` | Maximum locally persisted generated image-call records retained before cleanup |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGE_BYTES` | `52428800` | Maximum generated image bytes persisted per call for later edit references |
| `CODEXCOMPAT_IMAGE_GENERATION_STORE_TTL_MS` | `1209600000` | TTL for locally persisted generated image-call records; default is 14 days |
| `CODEXCOMPAT_IMAGE_GENERATION_API_KEY_ENV` | `OPENAI_API_KEY` | Environment variable name used for provider-backed image generation keys |
| `CODEXCOMPAT_IMAGE_GENERATION_MODEL` | `gpt-image-2` | Image model sent to provider-backed image generation |
| `CODEXCOMPAT_IMAGE_GENERATION_VARIATION_MODEL` | `dall-e-2` | Default model sent to provider-backed direct image variation requests when the client omits `model`; OpenAI's documented variation operation currently names `dall-e-2` |
| `CODEXCOMPAT_IMAGE_GENERATION_RESPONSE_FORMAT` | empty | Optional `response_format` override such as `b64_json` for providers/models that require it |
| `CODEXCOMPAT_IMAGE_GENERATION_TIMEOUT_MS` | `120000` | Timeout for provider-backed image generation requests; complex image prompts can take longer than text requests |
| `CODEXCOMPAT_IMAGE_GENERATION_MAX_INPUT_IMAGE_BYTES` | `52428800` | Maximum bytes per edit input image or mask before the bridge fails the local `image_generation_call` |
| `CODEXCOMPAT_IMAGE_GENERATION_INPUT_FETCH_TIMEOUT_MS` | `10000` | Timeout for bounded HTTP(S) image URL fetches used by provider-backed edits |
| `CODEXCOMPAT_IMAGE_GENERATION_PLACEHOLDER_SIZE` | `96` | Pixel width/height for the deterministic placeholder PNG; bounded from 16 to 512 |
| `CODEXCOMPAT_WEB_SEARCH_PROVIDER` | `wikipedia` | Local `web_search_preview` adapter provider. Use `disabled`, `static`, or `wikipedia` |
| `CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS` | `5` | Maximum local web-search results injected into Chat context and citation output |
| `CODEXCOMPAT_WEB_SEARCH_TIMEOUT_MS` | `10000` | Timeout for local web-search provider requests |
| `CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES` | `1` for `wikipedia`, `0` for `static` unless explicitly set | Number of top search results to open with bounded local `open_page` extraction |
| `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES` | `524288` | Maximum bytes read from each opened web page |
| `CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS` | `12000` | Maximum extracted page text injected into Chat context per opened page |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE` | `true` | Emits local `find_in_page` call items for successfully opened pages by searching extracted page text |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES` | `3` | Maximum snippets injected per opened page for local `find_in_page` |
| `CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS` | `240` | Characters of surrounding context included on each local `find_in_page` snippet |
| `CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS` | empty | JSON array of `{title,url,snippet}` results for the `static` provider; keep large/private fixtures outside Git |
| `CODEXCOMPAT_WEB_SEARCH_WIKIPEDIA_ENDPOINT` | `https://en.wikipedia.org/w/api.php` | Override endpoint for the no-key Wikipedia provider; the default endpoint falls back to the Wikipedia REST search API when rejected |
| `CODEXCOMPAT_WEB_SEARCH_USER_AGENT` | `open-codex-responses-bridge/0.2 (https://opencodexapp.aialra.online)` | User-Agent sent to Wikipedia search endpoints; include contact/site context to satisfy Wikimedia API policy |
| `CODEXCOMPAT_FILE_SEARCH_PROVIDER` | `local` | Local Responses `file_search` adapter provider. Use `disabled` to leave it unsupported |
| `CODEXCOMPAT_FILE_SEARCH_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-file-search` | Local Files/Vector Stores state path; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS` | `5` | Maximum local file-search chunks injected into Chat context and citation output; configurable up to 50 |
| `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | `4194304` | Maximum upload size for local Files API content; bytes are preserved and text/document extraction for local file search shares the `CODEXCOMPAT_INPUT_FILE_*` PDF/OCR/OOXML/spreadsheet settings |
| `CODEXCOMPAT_EMBEDDINGS_MODEL` | `hashed-semantic-256` | Model id returned by local `/v1/embeddings` when the request omits `model` |
| `CODEXCOMPAT_EMBEDDINGS_DIMENSIONS` | `256` | Default local `/v1/embeddings` vector dimensions; requests may override `dimensions` from 1 to 3072 |
| `CODEXCOMPAT_MODERATIONS_MODEL` | `omni-moderation-latest` | Model id returned by local `/v1/moderations` when the request omits `model` |
| `CODEXCOMPAT_UPLOAD_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-uploads` | Local Uploads API intermediate state path; keep outside Git. Runtime pruning covers bounded Upload workdirs, and completed Files carry local SHA-256 metadata for auditability |
| `CODEXCOMPAT_UPLOAD_MAX_BYTES` | same as `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | Maximum local Upload size before completion into a File; capped at OpenAI's 8 GB Upload limit but defaults small for `/srv/aialra/apps` disk safety |
| `CODEXCOMPAT_UPLOAD_MAX_PART_BYTES` | min(64 MB, upload max) | Maximum local Upload Part size; capped at OpenAI's 64 MB Part limit |
| `CODEXCOMPAT_UPLOAD_RETAIN_PART_DATA` | `false` | Set to true only for temporary debugging; by default terminal Uploads prune intermediate Part `.bin` files after File creation, cancellation, or expiration while keeping metadata/checksums |
| `CODEXCOMPAT_SHELL_PROVIDER` | `local` | Local Responses `shell` / `code_interpreter` adapter provider. Use `disabled` to leave it unsupported |
| `CODEXCOMPAT_SHELL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-containers` | Local container workspace/artifact path; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS` | `10000` | Per-command local shell timeout |
| `CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES` | `20480` | Captured stdout/stderr byte limit per stream |
| `CODEXCOMPAT_SHELL_MAX_FILE_BYTES` | `16777216` | Maximum local container file size |
| `CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS` | `4000` | Maximum extracted shell command length |
| `CODEXCOMPAT_SHELL_MAX_COMMANDS` | `1` | Maximum extracted shell commands executed per response |
| `CODEXCOMPAT_SHELL_MEMORY_LIMIT` | `1g` | Metadata value returned on local container objects |
| `CODEXCOMPAT_MCP_PROVIDER` | `local` | Local Responses `mcp` protocol-context adapter provider. Use `disabled` to leave MCP tools as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_MCP_REMOTE_LIST_TOOLS` | `true` | Enables bounded remote MCP `initialize` / `tools/list` imports for `server_url` tools without explicit local definitions |
| `CODEXCOMPAT_MCP_REMOTE_TOOL_CALLS` | `true` | Enables non-streaming, streaming, and active background remote MCP `tools/call` execution through Chat function-tool proxy calls, including auto-approved calls and approved `mcp_approval_response` continuations |
| `CODEXCOMPAT_MCP_MAX_CALL_ROUNDS` | `1` | Maximum remote MCP call/follow-up rounds per Responses request that runs a remote MCP call loop; same-request deferred `tool_search` plus MCP uses an effective minimum of `2` for the search and approval/call turns |
| `CODEXCOMPAT_MCP_MAX_TOOL_OUTPUT_CHARS` | `20000` | Maximum remote MCP tool output characters injected into the follow-up Chat tool message and returned `mcp_call.output` |
| `CODEXCOMPAT_MCP_TIMEOUT_MS` | `5000` | Timeout for each remote MCP HTTP request |
| `CODEXCOMPAT_MCP_MAX_RESPONSE_BYTES` | `1048576` | Maximum bytes read from one remote MCP HTTP/SSE response |
| `CODEXCOMPAT_MCP_MAX_TOOLS` | `128` | Maximum remote tools imported per MCP server |
| `CODEXCOMPAT_MCP_PROTOCOL_VERSION` | `2025-03-26` | Protocol version sent in the remote MCP `initialize` request |
| `CODEXCOMPAT_MCP_CLIENT_NAME` | `open-codex-responses-bridge` | Client name sent in the remote MCP `initialize` request |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_MCP` | `true` | Disables DeepSeek thinking mode for local MCP-context requests so final text is visible under small output budgets |
| `CODEXCOMPAT_TOOL_SEARCH_PROVIDER` | `local` | Local Responses `tool_search`, `tool_search_output`, and `additional_tools` adapter provider. Use `disabled` to leave tool search as unsupported hosted-tool compatibility text |
| `CODEXCOMPAT_TOOL_SEARCH_MAX_LOADED_TOOLS` | `10` | Maximum deferred functions loaded by one hosted local tool-search call |
| `CODEXCOMPAT_SKILL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-skills` | Local Skills API state path; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_SKILL_MAX_UPLOAD_BYTES` | `52428800` | Maximum local skill upload size |
| `CODEXCOMPAT_SKILL_MAX_FILE_COUNT` | `500` | Maximum files accepted in a local skill bundle |
| `CODEXCOMPAT_CHAT_DEVELOPER_ROLE_COMPAT` | `true` for DeepSeek providers | Maps direct Chat passthrough `role:"developer"` messages to `CODEXCOMPAT_CHAT_DEVELOPER_ROLE` before upstream proxying |
| `CODEXCOMPAT_CHAT_DEVELOPER_ROLE` | `system` | Provider role used for direct Chat passthrough developer-message compatibility |

## Systemd

The repo provides these templates:

- `systemd/aialra-opencodexapp-bridge.service`
- `systemd/aialra-opencodexapp-app-server.service`
- `systemd/aialra-opencodexapp-web.service`
- `systemd/aialra-opencodexapp-login.service`
- `systemd/aialra-opencodexapp-runtime-prune.service`
- `systemd/aialra-opencodexapp-runtime-prune.timer`

Install by copying or symlinking them into `/etc/systemd/system/`, then:

```bash
systemctl daemon-reload
systemctl enable --now aialra-opencodexapp-bridge.service
systemctl enable --now aialra-opencodexapp-app-server.service
systemctl enable --now aialra-opencodexapp-web.service
systemctl enable --now aialra-opencodexapp-login.service
# Optional daily ignored runtime-artifact pruning:
systemctl enable --now aialra-opencodexapp-runtime-prune.timer
```

## Nginx

The public vhost should terminate TLS and proxy to `127.0.0.1:12920` for
1:1 parity with the existing `codexapp.aialra.online` deployment. The tracked
template is `deploy/nginx/opencodexapp.aialra.online.conf`.

```nginx
include /srv/aialra/config/nginx/sites-available/opencodexapp.aialra.online.conf;
```

## Verification

Before exposing traffic:

```bash
npm test
npm run secret-scan
npm run prune:runtime -- --dry-run
curl http://127.0.0.1:12912/healthz
npm run smoke:bridge
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
npm run eval:bridge -- --case chat-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-logprobs --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-input-file-url --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-input-file-spreadsheet --timeout-ms 90000 --verbose
npm run eval:bridge -- --case assistants-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case assistants-required-action --timeout-ms 90000 --verbose
npm run eval:bridge -- --case evals-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case fine-tuning-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case graders-api-local --timeout-ms 90000 --verbose
npm run eval:bridge -- --case graders-api-score-model --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-mcp-local --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-list --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-call --timeout-ms 120000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-stream-call --timeout-ms 120000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-background-call --timeout-ms 120000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-approval --timeout-ms 120000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-stream-approval --timeout-ms 120000 --verbose
npm run eval:bridge -- --case responses-mcp-remote-denial --timeout-ms 120000 --verbose
npm run eval:bridge -- --case video-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case video-character-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case video-iteration-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-shell --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-file-search --timeout-ms 90000 --verbose
npm run bench:code -- --timeout-ms 180000
npm run bench:code -- --suite humaneval-mbpp --timeout-ms 180000
npm run bench:code -- --suite repo-maintenance --timeout-ms 180000
npm run bench:swe -- --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl --limit 3 --dry-run
npm run bench:swe:score -- --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json --dry-run
npm run soak:bridge -- --iterations 5 --timeout-ms 180000
npm run smoke:ui -- --timeout-ms 180000
npm run smoke:ui -- --timeout-ms 260000 --exercise-active-controls
curl http://127.0.0.1:12920/
curl http://127.0.0.1:12923/login
```

`smoke:ui` uses Playwright directly and creates a clean browser context for each
run. If the login page is visible, it reads credentials from
`UI_SMOKE_USERNAME`/`UI_SMOKE_PASSWORD` or `CODEXAPP_USERNAME`/`CODEXAPP_PASSWORD`
in the local environment. It writes screenshots under the ignored
`output/playwright/` directory. The smoke also opens/cancels the project dialog,
verifies the host browser-upload bridge by writing a small fixture under
`state/browser-uploads/`, adds and clears a project writable root, switches
through the plugins, automation, and mobile views before returning to new chat,
creates a saved project, reopens it from the sidebar, cleans the generated UI
smoke workspace root through the browser bridge, and records visible short-label
stop/retry controls after a model turn. It also hovers completed user/assistant
turns, verifies copy/edit/branch-from-here controls and the conversation action
menu, temporarily appends a generated-image rollout event for that smoke thread,
reopens the thread, verifies the rendered `data:image/*` artifact, and
truncates the rollout back to its original size.
The current `--exercise-active-controls` option runs a longer browser path that
actively clicks the visible stop control during generation when exposed, records
whether a composer-action fallback was used, records whether the interrupted
turn exposes retry/regenerate/continue, and sends a recovery prompt.
The `opencodexapp.aialra.online` nginx template proxies directly to the web service;
the optional login proxy service is not in the public request path unless nginx
is changed to target port `12923`. The current completed-turn UI exposes
branch-from-here rather than retry/regenerate; the smoke records
`completed_turn_retry_regenerate_visible:false` until that action appears.

## Runtime Retention

Long-running bridge and UI verification create ignored local artifacts under
`state/`, `output/`, and `.playwright-cli/`. These paths must not be committed,
but they also should not grow forever.

Use the runtime prune script in dry-run mode before applying changes:

```bash
npm run prune:runtime -- --dry-run
npm run prune:runtime -- --apply
```

The script prints a JSON report. By default it only prunes:

- UI smoke screenshots under `output/playwright/`;
- Playwright CLI captures under `.playwright-cli/`;
- temporary code-benchmark work directories under `output/code-benchmark/`;
- top-level local response JSON records under `state/responses-bridge/`;
- stale local shell/code-interpreter container work directories under
  `state/responses-bridge/local-containers/`;
- stale local Organization admin JSON records under
  `state/responses-bridge/local-organization-admin/`.

It intentionally does not prune local `file_search` vector-store state by
default, because those files can be user-provided retrieval data. Use explicit
manual deletion for vector stores whose lifecycle has ended.

The optional `aialra-opencodexapp-runtime-prune.timer` runs the same script with
`--apply` daily and writes its JSON reports to
`/srv/aialra/logs/opencodexapp/prune/service.log`.

## Playwright Storage Note

`playwright` is a dev dependency for browser smoke tests. On hosts that already
have a usable Playwright browser cache, install without downloading browsers:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --include=dev
```

On a fresh host, install only Chromium for the UI smoke path and keep the browser
cache outside the repository:

```bash
npx playwright install chromium
```
