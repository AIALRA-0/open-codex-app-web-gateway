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
| `CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT` | `true` | Maps OpenAI/Codex effort values to DeepSeek-supported values |
| `CODEXCOMPAT_DEEPSEEK_THINKING_MODE` | `false` | Forces `thinking:{type:"enabled"}` when a request asks for reasoning effort |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE` | `true` | Disables DeepSeek thinking mode for function-tool requests that also set `tool_choice` |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_COMPACTION` | `true` | Disables DeepSeek thinking mode for local `/v1/responses/compact` summarization and compaction replay follow-ups so visible content is returned reliably |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH` | `true` | Disables DeepSeek thinking mode when the bridge injects local web-search context, preventing reasoning-only completions from exhausting the output budget |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH` | `true` | Disables DeepSeek thinking mode when the bridge injects local file-search context, preventing citation-only or empty visible completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL` | `true` | Disables DeepSeek thinking mode when the bridge injects local shell execution context, preventing empty visible completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES` | `true` | Disables DeepSeek thinking mode when the bridge injects local input-file text, preventing reasoning-only completions under small output budgets |
| `CODEXCOMPAT_DEEPSEEK_USER_ID_COMPAT` | auto for `*.deepseek.com` | Maps Responses/OpenAI identity fields to DeepSeek `user_id`; invalid DeepSeek characters are replaced with a stable SHA-256 identifier |
| `CODEXCOMPAT_FORWARD_SERVICE_TIER` | auto: `false` for DeepSeek, `true` otherwise | Forwards Responses/OpenAI `service_tier` to upstream Chat providers that support it; filtered requests are recorded in compatibility metadata |
| `CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS` | auto: `false` for DeepSeek, `true` otherwise | Forwards Chat-native request fields such as `logit_bias`, `modalities`, `prediction`, `n`, prompt-cache hints, `web_search_options`, and legacy `functions/function_call`; filtered requests are recorded in compatibility metadata |
| `CODEXCOMPAT_FORWARD_STREAM_OPTIONS` | `true` | Forwards Chat-native `stream_options` when a Responses request uses `stream:true` |
| `CODEXCOMPAT_STREAM_INCLUDE_USAGE` | `true` | Adds `stream_options.include_usage=true` to streaming upstream Chat requests unless the caller sets it explicitly |
| `CODEXCOMPAT_JSON_SCHEMA_MODE` | `json_object` | Downgrades Responses JSON Schema output to JSON object mode plus an explicit schema instruction |
| `CODEXCOMPAT_CONVERSATION_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-conversations` | Local Conversations API state path; keeps conversation items durable and outside Git |
| `CODEXCOMPAT_COMPACTION_MAX_OUTPUT_TOKENS` | `512` | Output budget for local `/v1/responses/compact` summaries |
| `CODEXCOMPAT_COMPACTION_SECRET_FILE` | `$CODEXCOMPAT_STATE_DIR/compaction.key` | AES-GCM key file for local compaction `encrypted_content`; keep outside Git and mode `0600` |
| `CODEXCOMPAT_INPUT_FILE_PROVIDER` | `local` | Local Responses `input_file` adapter provider. Use `disabled` to leave file inputs as marker-only metadata |
| `CODEXCOMPAT_INPUT_FILE_MAX_FILES` | `8` | Maximum `input_file` items extracted per Responses request |
| `CODEXCOMPAT_INPUT_FILE_MAX_BYTES` | `4194304` | Maximum bytes read from each local, inline, or remote file input; loader caps this at 50 MB |
| `CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS` | `200000` | Maximum extracted text injected into Chat context per file |
| `CODEXCOMPAT_INPUT_FILE_FETCH_URLS` | `true` | Enables bounded HTTP(S) fetches for `input_file.file_url` |
| `CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS` | `10000` | Timeout for remote `input_file.file_url` fetches |
| `CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR` | `pdftotext` | Uses local Poppler `pdftotext` to extract text-layer content from PDFs; set `disabled` to skip PDFs |
| `CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS` | `10000` | Timeout for each local PDF extraction process |
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
| `CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS` | `5` | Maximum local file-search chunks injected into Chat context and citation output |
| `CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES` | `4194304` | Maximum upload size for local text files |
| `CODEXCOMPAT_SHELL_PROVIDER` | `local` | Local Responses `shell` / `code_interpreter` adapter provider. Use `disabled` to leave it unsupported |
| `CODEXCOMPAT_SHELL_STATE_DIR` | `$CODEXCOMPAT_STATE_DIR/local-containers` | Local container workspace/artifact path; keep outside Git and monitor disk growth |
| `CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS` | `10000` | Per-command local shell timeout |
| `CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES` | `20480` | Captured stdout/stderr byte limit per stream |
| `CODEXCOMPAT_SHELL_MAX_FILE_BYTES` | `16777216` | Maximum local container file size |
| `CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS` | `4000` | Maximum extracted shell command length |
| `CODEXCOMPAT_SHELL_MAX_COMMANDS` | `1` | Maximum extracted shell commands executed per response |
| `CODEXCOMPAT_SHELL_MEMORY_LIMIT` | `1g` | Metadata value returned on local container objects |

## Systemd

The repo provides these templates:

- `systemd/aialra-opencodexapp-bridge.service`
- `systemd/aialra-opencodexapp-app-server.service`
- `systemd/aialra-opencodexapp-web.service`
- `systemd/aialra-opencodexapp-login.service`

Install by copying or symlinking them into `/etc/systemd/system/`, then:

```bash
systemctl daemon-reload
systemctl enable --now aialra-opencodexapp-bridge.service
systemctl enable --now aialra-opencodexapp-app-server.service
systemctl enable --now aialra-opencodexapp-web.service
systemctl enable --now aialra-opencodexapp-login.service
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
curl http://127.0.0.1:12912/healthz
npm run smoke:bridge
npm run eval:protocol
npm run eval:bridge -- --timeout-ms 45000
npm run eval:bridge -- --case chat-lifecycle --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-logprobs --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-input-file --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-shell --timeout-ms 90000 --verbose
npm run eval:bridge -- --case responses-file-search --timeout-ms 90000 --verbose
npm run bench:code -- --timeout-ms 180000
npm run bench:swe -- --dataset-jsonl /srv/aialra/data/swebench/verified-smoke.jsonl --limit 3 --dry-run
npm run bench:swe:score -- --prediction-report /srv/aialra/data/opencodexapp/eval/swebench/report.json --dry-run
npm run soak:bridge -- --iterations 5 --timeout-ms 180000
npm run smoke:ui -- --timeout-ms 180000
curl http://127.0.0.1:12920/
curl http://127.0.0.1:12923/login
```

`smoke:ui` uses Playwright directly and creates a clean browser context for each
run. If the login page is visible, it reads credentials from
`UI_SMOKE_USERNAME`/`UI_SMOKE_PASSWORD` or `CODEXAPP_USERNAME`/`CODEXAPP_PASSWORD`
in the local environment. It writes screenshots under the ignored
`output/playwright/` directory. The current `opencodexapp.aialra.online` nginx
template proxies directly to the web service; the optional login proxy service is
not in the public request path unless nginx is changed to target port `12923`.
Broader automated UI coverage still needs upload, interrupt/resume, generated
artifact display, and full page switching checks.

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
