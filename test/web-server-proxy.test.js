"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = http.createServer((_req, res) => res.end("ok"));
  const address = await listen(server);
  await close(server);
  return address.port;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const timeout = sleep(2000).then(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await Promise.race([exited, timeout]);
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function waitForWebHealth(baseUrl, logs) {
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`web-server did not become healthy: ${lastError?.message || "timeout"}\n${logs()}`);
}

function createMockApiBridge(requests) {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: req.method, url: req.url, headers: req.headers, rawBody });

    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "mock-api-bridge" }));
      return;
    }

    if (req.method === "GET" && req.url === "/v1/models?limit=1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.write("data: {\"id\":\"chatcmpl_mock\",\"object\":\"chat.completion.chunk\",\"choices\":[]}\n\n");
      res.end("data: [DONE]\n\n");
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "missing mock route" } }));
  });
}

async function withSpawnedWebServer(apiPort, run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-codex-web-proxy-"));
  const webviewDir = path.join(tmpRoot, "webview");
  const stateDir = path.join(tmpRoot, "state");
  fs.mkdirSync(webviewDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(webviewDir, "index.html"),
    "<!doctype html><html><head></head><body><script type=\"module\"></script></body></html>",
  );

  const webPort = await freePort();
  let output = "";
  const child = spawn(process.execPath, ["web-server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      PATH: process.env.PATH || "",
      HOME: tmpRoot,
      NODE_ENV: "test",
      CODEX_HOME: path.join(tmpRoot, "codex-home"),
      CODEXAPP_WEB_HOST: "127.0.0.1",
      CODEXAPP_WEB_PORT: String(webPort),
      CODEXAPP_WEBVIEW_DIR: webviewDir,
      CODEXAPP_STATE_DIR: stateDir,
      CODEXAPP_EXTERNAL_APP_SERVER: "1",
      CODEXAPP_STARTUP_PREWARM: "0",
      CODEXAPP_API_PROXY_HOST: "127.0.0.1",
      CODEXAPP_API_PROXY_PORT: String(apiPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });

  try {
    const baseUrl = `http://127.0.0.1:${webPort}`;
    await waitForWebHealth(baseUrl, () => output);
    await run({ baseUrl });
  } finally {
    await stopChild(child);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test("web-server proxies public OpenAI-compatible API paths to the bridge", async () => {
  const requests = [];
  const apiBridge = createMockApiBridge(requests);
  const apiAddress = await listen(apiBridge);

  try {
    await withSpawnedWebServer(apiAddress.port, async ({ baseUrl }) => {
      const modelsResponse = await fetch(`${baseUrl}/v1/models?limit=1`, {
        headers: { accept: "text/html" },
      });
      assert.equal(modelsResponse.status, 200);
      assert.match(modelsResponse.headers.get("content-type") || "", /^application\/json\b/);
      assert.equal((await modelsResponse.json()).data[0].id, "mock-model");

      const healthzResponse = await fetch(`${baseUrl}/healthz`);
      assert.equal(healthzResponse.status, 200);
      assert.equal((await healthzResponse.json()).service, "mock-api-bridge");

      const spaResponse = await fetch(`${baseUrl}/threads/demo`, {
        headers: { accept: "text/html" },
      });
      assert.equal(spaResponse.status, 200);
      assert.match(spaResponse.headers.get("content-type") || "", /^text\/html\b/);
      assert.match(await spaResponse.text(), /name="initial-route" content="\/threads\/demo"/);

      const streamResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: "Bearer public-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "mock-model", stream: true }),
      });
      assert.equal(streamResponse.status, 200);
      assert.match(streamResponse.headers.get("content-type") || "", /^text\/event-stream\b/);
      assert.match(await streamResponse.text(), /chatcmpl_mock/);
    });
  } finally {
    await close(apiBridge);
  }

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`),
    [
      "GET /v1/models?limit=1",
      "GET /healthz",
      "POST /v1/chat/completions",
    ],
  );
  assert.equal(requests[2].headers.authorization, "Bearer public-test-token");
  assert.equal(JSON.parse(requests[2].rawBody).stream, true);
});
