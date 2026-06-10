#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const suite = args.get("--suite") || "protocol-smoke";
const baseUrl = args.get("--base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912";
const model = args.get("--model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro";

const suites = {
  "protocol-smoke": [
    {
      id: "text",
      request: { model, input: "Return the exact string ok-text.", max_output_tokens: 64, store: false },
      check: (text) => /ok-text/i.test(text),
    },
    {
      id: "json-schema",
      request: {
        model,
        input: "Return JSON with ok true.",
        text: {
          format: {
            type: "json_schema",
            name: "smoke",
            strict: true,
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 128,
        store: false,
      },
      check: (text) => /"ok"\s*:\s*true/.test(text),
    },
  ],
};

function outputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

async function runCase(testCase) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(testCase.request),
  });
  const body = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  if (!response.ok) return { id: testCase.id, ok: false, status: response.status, elapsed_ms: elapsedMs, error: body };
  const json = JSON.parse(body);
  const text = outputText(json);
  return { id: testCase.id, ok: testCase.check(text), status: response.status, elapsed_ms: elapsedMs, output_text: text };
}

const selected = suites[suite];
if (!selected) {
  console.error(`Unknown suite: ${suite}`);
  process.exit(2);
}

const results = [];
for (const testCase of selected) results.push(await runCase(testCase));
const passed = results.filter((result) => result.ok).length;
console.log(JSON.stringify({ suite, model, passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
