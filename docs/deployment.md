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
| `CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH` | `true` | Disables DeepSeek thinking mode when the bridge injects local web-search context, preventing reasoning-only completions from exhausting the output budget |
| `CODEXCOMPAT_JSON_SCHEMA_MODE` | `json_object` | Downgrades Responses JSON Schema output to JSON object mode plus an explicit schema instruction |
| `CODEXCOMPAT_COMPACTION_MAX_OUTPUT_TOKENS` | `512` | Output budget for local `/v1/responses/compact` summaries |
| `CODEXCOMPAT_COMPACTION_SECRET_FILE` | `$CODEXCOMPAT_STATE_DIR/compaction.key` | AES-GCM key file for local compaction `encrypted_content`; keep outside Git and mode `0600` |
| `CODEXCOMPAT_WEB_SEARCH_PROVIDER` | `wikipedia` | Local `web_search_preview` adapter provider. Use `disabled`, `static`, or `wikipedia` |
| `CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS` | `5` | Maximum local web-search results injected into Chat context and citation output |
| `CODEXCOMPAT_WEB_SEARCH_TIMEOUT_MS` | `10000` | Timeout for local web-search provider requests |
| `CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS` | empty | JSON array of `{title,url,snippet}` results for the `static` provider; keep large/private fixtures outside Git |
| `CODEXCOMPAT_WEB_SEARCH_WIKIPEDIA_ENDPOINT` | `https://en.wikipedia.org/w/api.php` | Override endpoint for the no-key Wikipedia fallback |

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
npm run bench:code -- --timeout-ms 180000
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
