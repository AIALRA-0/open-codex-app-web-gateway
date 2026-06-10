# Open Codex App Web Gateway

This repository is the open deployment track for the AIALRA Codex App web gateway.
It keeps the existing Codex App web experience and adds a local `/v1/responses`
compatibility bridge for OpenAI-compatible Chat Completions providers such as
DeepSeek.

## Components

- `web-server.js`: the existing Codex App web bridge.
- `login-proxy.js`: the existing login/session reverse proxy.
- `src/bridge/server.js`: Responses API facade, Chat Completions upstream.
- `src/bridge/translator.js`: schema and streaming event translation.
- `src/bridge/store.js`: local `previous_response_id` replay store.
- `test/`: unit and mock-upstream tests.
- `docs/`: compatibility, deployment, evaluation, and audit notes.

## Local Bridge Quick Start

```bash
npm ci
DEEPSEEK_API_KEY=... npm run start:bridge
```

Then point a Codex provider at `http://127.0.0.1:12912/v1` with
`wire_api = "responses"`. Keep real keys in machine-local secret files, never in
the repository.

## Safety Rules

- Do not commit `.env`, `state/`, `node_modules/`, logs, or local Codex auth.
- Run `npm run secret-scan` before committing.
- Use `/srv/aialra/config/secrets/opencodexapp.env` or another non-repo secret
  file for deployment credentials.

## Verification

```bash
npm test
npm run secret-scan
npm run eval:bridge -- --timeout-ms 45000
npm run bench:code -- --timeout-ms 180000
npm run smoke:ui -- --timeout-ms 180000
```

For a live provider smoke test, start the bridge with a provider key and run:

```bash
npm run smoke:bridge
```
