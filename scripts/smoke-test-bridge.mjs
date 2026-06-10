#!/usr/bin/env node
const baseUrl = process.env.CODEXCOMPAT_SMOKE_BASE_URL || "http://127.0.0.1:12912";
const model = process.env.CODEXCOMPAT_SMOKE_MODEL || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro";

async function main() {
  const health = await fetch(`${baseUrl}/healthz`);
  if (!health.ok) throw new Error(`health failed: ${health.status}`);

  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: "Say exactly: bridge-ok",
      max_output_tokens: 64,
      store: false,
    }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`responses failed: ${response.status} ${text}`);
  const json = JSON.parse(text);
  const outputText = (json.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
  console.log(JSON.stringify({ id: json.id, status: json.status, output_text: outputText }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
