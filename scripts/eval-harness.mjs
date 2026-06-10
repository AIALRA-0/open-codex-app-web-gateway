#!/usr/bin/env node
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const suite = String(args.get("suite") || "protocol-smoke");
const baseUrl = trimTrailingSlash(args.get("base-url") || process.env.CODEXCOMPAT_EVAL_BASE_URL || "http://127.0.0.1:12912");
const model = String(args.get("model") || process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro");
const repeat = parsePositiveInt(args.get("repeat"), 1);
const outputPath = args.get("output");
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 10 * 60 * 1000);
const caseFilter = args.get("case");
const verbose = !!args.get("verbose");

const suites = buildSuites(model);
const selected = caseFilter
  ? suites[suite]?.filter((testCase) => testCase.id === caseFilter)
  : suites[suite];
if (!selected) {
  console.error(`Unknown suite: ${suite}`);
  console.error(`Available suites: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}
if (!selected.length) {
  console.error(`No cases selected for suite=${suite} case=${caseFilter}`);
  process.exit(2);
}

const startedAt = new Date().toISOString();
const results = [];
for (let iteration = 1; iteration <= repeat; iteration += 1) {
  for (const testCase of selected) {
    if (verbose) console.error(`running ${testCase.id} iteration ${iteration}`);
    const result = await withTimeout(
      runCase(testCase, { iteration }),
      timeoutMs,
      `case timed out after ${timeoutMs} ms: ${testCase.id}`,
      { id: testCase.id, mode: testCase.mode || "responses", iteration },
    );
    if (verbose) console.error(`finished ${testCase.id} ok=${result.ok} elapsed_ms=${result.elapsed_ms}`);
    results.push(result);
  }
}

const report = makeReport({ suite, model, baseUrl, repeat, startedAt, results });
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
console.log(serialized);
process.exit(report.summary.passed === report.summary.total ? 0 : 1);

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(key, true);
    } else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildSuites(defaultModel) {
  const protocolSmoke = [
    {
      id: "responses-text",
      mode: "responses",
      request: {
        model: defaultModel,
        input: "Return the exact string ok-text.",
        max_output_tokens: 64,
        store: false,
      },
      check: ({ text }) => /ok-text/i.test(text),
    },
    {
      id: "responses-json-schema",
      mode: "responses",
      request: {
        model: defaultModel,
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
      check: ({ text }) => jsonHas(text, "ok", true),
    },
  ];

  return {
    "protocol-smoke": protocolSmoke,
    "bridge-regression": [
      ...protocolSmoke,
      {
        id: "models-retrieve",
        mode: "model-get",
        model: defaultModel,
        check: ({ json }) => json?.object === "model" && json.id === defaultModel,
      },
      {
        id: "chat-passthrough",
        mode: "chat",
        request: {
          model: defaultModel,
          messages: [{ role: "user", content: "Return the exact string chat-ok." }],
          max_tokens: 64,
        },
        check: ({ text }) => /chat-ok/i.test(text),
      },
      {
        id: "chat-lifecycle",
        mode: "chat-lifecycle",
        request: {
          model: defaultModel,
          store: true,
          messages: [{ role: "user", content: "Return the exact string chat-life-ok." }],
          max_tokens: 96,
        },
        check: ({ text, fetched, messages }) => /chat-life-ok/i.test(text)
          && fetched?.id
          && messages?.object === "list"
          && messages.data?.some((message) => message.role === "user")
          && messages.data?.some((message) => message.role === "assistant"),
      },
      {
        id: "responses-input-tokens",
        mode: "responses-input-tokens",
        request: {
          model: defaultModel,
          input: "Count this bridge token probe.",
          max_output_tokens: 64,
          store: false,
        },
        check: ({ json }) => json?.object === "response.input_tokens"
          && Number.isInteger(json.input_tokens)
          && json.input_tokens > 0,
      },
      {
        id: "responses-input-file",
        mode: "responses-input-file",
        file: {
          filename: "bridge-input-file.txt",
          purpose: "user_data",
          content: "Bridge input file fixture. The exact answer is input-file-ok.",
        },
        request: ({ fileId }) => ({
          model: defaultModel,
          input: [{
            role: "user",
            content: [
              { type: "input_file", file_id: fileId },
              { type: "input_text", text: "Using the input file content, return exactly this text and nothing else: input-file-ok" },
            ],
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text }) => /input-file-ok/i.test(text)
          && json.metadata?.compatibility?.local_input_files?.resolved_count === 1
          && json.metadata?.compatibility?.local_input_files?.failed_count === 0,
      },
      {
        id: "responses-background",
        mode: "responses-background",
        request: {
          model: defaultModel,
          input: "Return the exact string background-ok.",
          background: true,
          max_output_tokens: 128,
        },
        check: ({ created, final, text, history }) => created?.status === "in_progress"
          && final?.status === "completed"
          && history.includes("in_progress")
          && /background-ok/i.test(text),
      },
      {
        id: "responses-web-search",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Use web search for OpenAI. Then return the exact string web-search-ok [1].",
          tools: [{ type: "web_search_preview" }],
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json, text }) => {
          const call = (json.output || []).find((item) => item.type === "web_search_call");
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          return !!call
            && call.status === "completed"
            && call.action?.type === "search"
            && annotations.some((annotation) => annotation.type === "url_citation" && /^https?:\/\//.test(annotation.url || ""))
            && /web-search-ok/i.test(text);
        },
      },
      {
        id: "responses-shell",
        mode: "responses-shell",
        container: { name: "bridge-shell-eval" },
        request: ({ containerId }) => ({
          model: defaultModel,
          input: "Execute: printf shell-ok > /mnt/data/shell.txt && cat /mnt/data/shell.txt",
          tools: [{
            type: "shell",
            environment: { type: "container_reference", container_id: containerId },
          }],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, containerId, artifactText }) => {
          const shellCall = (json.output || []).find((item) => item.type === "shell_call");
          const shellOutput = (json.output || []).find((item) => item.type === "shell_call_output");
          return !!shellCall
            && shellCall.status === "completed"
            && shellCall.container_id === containerId
            && !!shellOutput
            && shellOutput.status === "completed"
            && shellOutput.outcome?.exit_code === 0
            && /shell-ok/i.test(shellOutput.output?.[0]?.stdout || "")
            && /shell-ok/i.test(artifactText || "")
            && /shell-ok/i.test(text);
        },
      },
      {
        id: "responses-file-search",
        mode: "responses-file-search",
        file: {
          filename: "bridge-file-search.txt",
          purpose: "assistants",
          content: "Bridge file search fixture. The exact file search answer is file-search-ok. When asked for the exact answer, return file-search-ok [1].",
        },
        vectorStore: { name: "bridge-file-search-eval" },
        vectorFile: { attributes: { suite: "bridge-regression" } },
        request: ({ vectorStoreId }) => ({
          model: defaultModel,
          input: "File search for file-search-ok. Using the file search result, return exactly this text and nothing else: file-search-ok [1]",
          tools: [{
            type: "file_search",
            vector_store_ids: [vectorStoreId],
            max_num_results: 3,
            filters: { type: "eq", key: "suite", value: "bridge-regression" },
          }],
          include: ["file_search_call.results"],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json, text, fileId, vectorStoreId }) => {
          const call = (json.output || []).find((item) => item.type === "file_search_call");
          const annotations = (json.output || [])
            .flatMap((item) => item.content || [])
            .flatMap((part) => part.annotations || []);
          return !!call
            && call.status === "completed"
            && call.vector_store_ids?.includes(vectorStoreId)
            && call.results?.some((result) => result.file_id === fileId)
            && annotations.some((annotation) => annotation.type === "file_citation" && annotation.file_id === fileId)
            && /file-search-ok/i.test(text);
        },
      },
      {
        id: "responses-compact-continuation",
        mode: "responses-compact",
        request: {
          model: defaultModel,
          input: [
            {
              role: "user",
              content: "For a compaction regression, remember the exact code word atlas-77.",
            },
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "I will preserve atlas-77 for the next turn." }],
            },
          ],
          max_output_tokens: 256,
          store: false,
        },
        followUp: ({ compactionOutput }) => ({
          model: defaultModel,
          input: [
            ...compactionOutput,
            {
              role: "user",
              content: "Using only the compacted context, return the exact code word.",
            },
          ],
          max_output_tokens: 128,
          store: false,
        }),
        check: ({ json }) => json?.object === "response.compaction"
          && json.output?.some((item) => item.type === "compaction" && /^occomp1\./.test(item.encrypted_content || "")),
        followCheck: ({ text }) => /atlas-77/i.test(text),
      },
      {
        id: "responses-stream-events",
        mode: "responses-stream",
        request: {
          model: defaultModel,
          input: "Stream the exact string stream-ok.",
          stream: true,
          max_output_tokens: 256,
          store: false,
        },
        check: ({ text, events }) => {
          const types = new Set(events.map((event) => event.event));
          return /stream-ok/i.test(text)
            && types.has("response.created")
            && types.has("response.output_text.delta")
            && types.has("response.completed");
        },
      },
      {
        id: "responses-function-tool",
        mode: "responses",
        request: {
          model: defaultModel,
          input: "Call record_result with ok=true and label=\"tool-ok\". Do not answer in prose.",
          tools: [{
            type: "function",
            name: "record_result",
            description: "Record a benchmark result.",
            parameters: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                label: { type: "string" },
              },
              required: ["ok", "label"],
              additionalProperties: false,
            },
          }],
          tool_choice: { type: "function", name: "record_result" },
          max_output_tokens: 128,
          store: false,
        },
        check: ({ json }) => {
          const call = (json.output || []).find((item) => item.type === "function_call");
          if (!call || call.name !== "record_result") return false;
          const parsed = parseJsonish(call.arguments);
          return parsed?.ok === true && parsed?.label === "tool-ok";
        },
      },
      {
        id: "responses-previous-response-replay",
        mode: "responses-sequence",
        steps: [
          {
            request: {
              model: defaultModel,
              input: "Remember the token orchid-42. Reply only stored.",
              max_output_tokens: 64,
              store: true,
            },
            check: ({ ok }) => ok,
          },
          {
            request: ({ previousResponseId }) => ({
              model: defaultModel,
              previous_response_id: previousResponseId,
              input: "What token did I ask you to remember? Reply with only the token.",
              max_output_tokens: 256,
              store: false,
            }),
            check: ({ text }) => /orchid-42/i.test(text),
          },
        ],
      },
    ],
  };
}

async function runCase(testCase, context) {
  const started = performance.now();
  try {
    if (testCase.mode === "responses-sequence") {
      return await runSequenceCase(testCase, context, started);
    }
    if (testCase.mode === "responses-stream") {
      return await runStreamingResponsesCase(testCase, context, started);
    }
    if (testCase.mode === "chat-lifecycle") {
      return await runChatLifecycleCase(testCase, context, started);
    }
    if (testCase.mode === "responses-input-tokens") {
      return await runInputTokensCase(testCase, context, started);
    }
    if (testCase.mode === "responses-input-file") {
      return await runInputFileCase(testCase, context, started);
    }
    if (testCase.mode === "responses-background") {
      return await runBackgroundCase(testCase, context, started);
    }
    if (testCase.mode === "responses-shell") {
      return await runShellCase(testCase, context, started);
    }
    if (testCase.mode === "responses-file-search") {
      return await runFileSearchCase(testCase, context, started);
    }
    if (testCase.mode === "responses-compact") {
      return await runCompactionCase(testCase, context, started);
    }
    if (testCase.mode === "model-get") {
      return await runModelGetCase(testCase, context, started);
    }
    if (testCase.mode === "chat") {
      return await runJsonCase(testCase, context, started, "/v1/chat/completions", chatOutputText, chatUsage);
    }
    return await runJsonCase(testCase, context, started, "/v1/responses", responseOutputText, responseUsage);
  } catch (error) {
    return finishResult(testCase, context, started, {
      ok: false,
      error: error.message,
    });
  }
}

async function withTimeout(promise, ms, message, fallback) {
  let timeout = null;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } catch (error) {
    return {
      ...fallback,
      elapsed_ms: ms,
      ok: false,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runJsonCase(testCase, context, started, path, textSelector, usageSelector) {
  const response = await postJson(`${baseUrl}${path}`, resolveRequest(testCase.request, {}));
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const json = JSON.parse(body);
  const text = textSelector(json);
  const ok = !!testCase.check({ json, text, ok: response.ok });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: usageSelector(json),
    output_text: truncate(text),
  });
}

async function runStreamingResponsesCase(testCase, context, started) {
  const response = await postJson(`${baseUrl}/v1/responses`, testCase.request);
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const events = parseSseEvents(body);
  const text = events
    .filter((event) => event.event === "response.output_text.delta")
    .map((event) => event.data?.delta || "")
    .join("");
  const completed = events.findLast((event) => event.event === "response.completed")?.data?.response;
  const ok = !!testCase.check({ text, events, json: completed });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: responseUsage(completed || {}),
    output_text: truncate(text),
    event_count: events.length,
  });
}

async function runChatLifecycleCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/chat/completions`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const created = JSON.parse(createdBody);
  const fetched = await getJson(`${baseUrl}/v1/chat/completions/${created.id}`);
  const messages = await getJson(`${baseUrl}/v1/chat/completions/${created.id}/messages?limit=20`);
  const text = chatOutputText(created);
  const ok = !!testCase.check({ json: created, text, fetched: fetched.json, messages: messages.json });
  return finishResult(testCase, context, started, {
    ok,
    status: createdResponse.status,
    usage: chatUsage(created),
    output_text: truncate(text),
    fetched_status: fetched.status,
    messages_status: messages.status,
    message_count: Array.isArray(messages.json?.data) ? messages.json.data.length : 0,
  });
}

async function runModelGetCase(testCase, context, started) {
  const modelId = encodeURIComponent(testCase.model || model);
  const response = await getJson(`${baseUrl}/v1/models/${modelId}`);
  const ok = response.ok && !!testCase.check({ json: response.json, ok: response.ok });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    model_id: response.json?.id || null,
    error: ok ? undefined : truncate(response.body),
  });
}

async function runBackgroundCase(testCase, context, started) {
  const createdResponse = await postJson(`${baseUrl}/v1/responses`, testCase.request);
  const createdBody = await createdResponse.text();
  if (!createdResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: createdResponse.status,
      error: truncate(createdBody),
    });
  }

  const created = JSON.parse(createdBody);
  const history = [created.status];
  let final = created;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    const fetched = await getJson(`${baseUrl}/v1/responses/${created.id}`);
    if (!fetched.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fetched.status,
        error: truncate(fetched.body),
        status_history: history,
      });
    }
    final = fetched.json;
    history.push(final.status);
    if (["completed", "failed", "cancelled", "incomplete"].includes(final.status)) break;
  }

  const text = responseOutputText(final);
  const ok = !!testCase.check({ created, final, text, history });
  return finishResult(testCase, context, started, {
    ok,
    status: 200,
    response_id: created.id,
    status_history: history,
    usage: responseUsage(final),
    output_text: truncate(text),
  });
}

async function runFileSearchCase(testCase, context, started) {
  let file = null;
  let vectorStore = null;
  try {
    const fileResponse = await postJson(`${baseUrl}/v1/files`, testCase.file);
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    file = JSON.parse(fileBody);

    const storeResponse = await postJson(`${baseUrl}/v1/vector_stores`, testCase.vectorStore || {});
    const storeBody = await storeResponse.text();
    if (!storeResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: storeResponse.status,
        error: truncate(storeBody),
      });
    }
    vectorStore = JSON.parse(storeBody);

    const attachResponse = await postJson(`${baseUrl}/v1/vector_stores/${vectorStore.id}/files`, {
      file_id: file.id,
      ...(testCase.vectorFile || {}),
    });
    const attachBody = await attachResponse.text();
    if (!attachResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: attachResponse.status,
        error: truncate(attachBody),
      });
    }

    const request = resolveRequest(testCase.request, { ...context, fileId: file.id, vectorStoreId: vectorStore.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, fileId: file.id, vectorStoreId: vectorStore.id });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      file_id: file.id,
      vector_store_id: vectorStore.id,
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (vectorStore?.id) await deleteJson(`${baseUrl}/v1/vector_stores/${vectorStore.id}`);
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runInputFileCase(testCase, context, started) {
  let file = null;
  try {
    const fileResponse = await postJson(`${baseUrl}/v1/files`, testCase.file);
    const fileBody = await fileResponse.text();
    if (!fileResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: fileResponse.status,
        error: truncate(fileBody),
      });
    }
    file = JSON.parse(fileBody);

    const request = resolveRequest(testCase.request, { ...context, fileId: file.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, fileId: file.id });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      file_id: file.id,
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (file?.id) await deleteJson(`${baseUrl}/v1/files/${file.id}`);
  }
}

async function runShellCase(testCase, context, started) {
  let container = null;
  try {
    const containerResponse = await postJson(`${baseUrl}/v1/containers`, testCase.container || {});
    const containerBody = await containerResponse.text();
    if (!containerResponse.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: containerResponse.status,
        error: truncate(containerBody),
      });
    }
    container = JSON.parse(containerBody);

    const request = resolveRequest(testCase.request, { ...context, containerId: container.id });
    const response = await postJson(`${baseUrl}/v1/responses`, request);
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: truncate(body),
      });
    }

    const json = JSON.parse(body);
    const files = await getJson(`${baseUrl}/v1/containers/${container.id}/files`);
    const artifact = files.ok
      ? files.json.data?.find((file) => file.path === "/shell.txt")
      : null;
    let artifactText = "";
    if (artifact) {
      const contentResponse = await fetch(`${baseUrl}/v1/containers/${container.id}/files/${artifact.id}/content`);
      if (contentResponse.ok) artifactText = await contentResponse.text();
    }
    const text = responseOutputText(json);
    const ok = !!testCase.check({ json, text, containerId: container.id, artifactText });
    return finishResult(testCase, context, started, {
      ok,
      status: response.status,
      container_id: container.id,
      artifact_text: truncate(artifactText),
      usage: responseUsage(json),
      output_text: truncate(text),
    });
  } finally {
    if (container?.id) await deleteJson(`${baseUrl}/v1/containers/${container.id}`);
  }
}

async function runCompactionCase(testCase, context, started) {
  const compactResponse = await postJson(`${baseUrl}/v1/responses/compact`, testCase.request);
  const compactBody = await compactResponse.text();
  if (!compactResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: compactResponse.status,
      error: truncate(compactBody),
    });
  }

  const compactJson = JSON.parse(compactBody);
  const compactOk = !!testCase.check({ json: compactJson, ok: compactResponse.ok });
  const stepResults = [{
    step: "compact",
    ok: compactOk,
    output_items: Array.isArray(compactJson.output) ? compactJson.output.length : 0,
    usage: responseUsage(compactJson),
  }];
  if (!compactOk || !testCase.followUp) {
    return finishResult(testCase, context, started, {
      ok: compactOk,
      status: compactResponse.status,
      steps: stepResults,
      usage: sumUsage(stepResults.map((step) => step.usage)),
    });
  }

  const followResponse = await postJson(`${baseUrl}/v1/responses`, testCase.followUp({ compactionOutput: compactJson.output || [] }));
  const followBody = await followResponse.text();
  if (!followResponse.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: followResponse.status,
      error: truncate(followBody),
      steps: stepResults,
    });
  }

  const followJson = JSON.parse(followBody);
  const text = responseOutputText(followJson);
  const followOk = !!testCase.followCheck({ json: followJson, text, ok: followResponse.ok });
  stepResults.push({
    step: "follow-up",
    ok: followOk,
    output_text: truncate(text),
    usage: responseUsage(followJson),
  });
  return finishResult(testCase, context, started, {
    ok: followOk,
    status: followResponse.status,
    steps: stepResults,
    usage: sumUsage(stepResults.map((step) => step.usage)),
    output_text: truncate(text),
  });
}

async function runInputTokensCase(testCase, context, started) {
  const response = await postJson(`${baseUrl}/v1/responses/input_tokens`, testCase.request);
  const body = await response.text();
  if (!response.ok) {
    return finishResult(testCase, context, started, {
      ok: false,
      status: response.status,
      error: truncate(body),
    });
  }

  const json = JSON.parse(body);
  const ok = !!testCase.check({ json, ok: response.ok });
  return finishResult(testCase, context, started, {
    ok,
    status: response.status,
    usage: {
      input_tokens: json.input_tokens || 0,
      output_tokens: 0,
      total_tokens: json.input_tokens || 0,
    },
    input_tokens: json.input_tokens || 0,
  });
}

async function runSequenceCase(testCase, context, started) {
  const stepResults = [];
  let previousResponseId = null;
  for (const [index, step] of testCase.steps.entries()) {
    const response = await postJson(`${baseUrl}/v1/responses`, resolveRequest(step.request, { previousResponseId }));
    const body = await response.text();
    if (!response.ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        error: `step ${index + 1}: ${truncate(body)}`,
        steps: stepResults,
      });
    }

    const json = JSON.parse(body);
    const text = responseOutputText(json);
    const ok = !!step.check({ json, text, ok: response.ok });
    stepResults.push({
      step: index + 1,
      ok,
      response_id: json.id,
      output_text: truncate(text),
      usage: responseUsage(json),
    });
    if (!ok) {
      return finishResult(testCase, context, started, {
        ok: false,
        status: response.status,
        steps: stepResults,
      });
    }
    previousResponseId = json.id;
  }

  return finishResult(testCase, context, started, {
    ok: true,
    status: 200,
    steps: stepResults,
    usage: sumUsage(stepResults.map((step) => step.usage)),
  });
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      json: parseJsonish(body),
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "DELETE", signal: controller.signal });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  } catch {
    return { status: 0, ok: false, body: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRequest(request, context) {
  return typeof request === "function" ? request(context) : request;
}

function finishResult(testCase, context, started, extra) {
  return {
    id: testCase.id,
    mode: testCase.mode || "responses",
    iteration: context.iteration,
    elapsed_ms: Math.round(performance.now() - started),
    ...extra,
  };
}

function makeReport({ suite, model, baseUrl, repeat, startedAt, results }) {
  const passed = results.filter((result) => result.ok).length;
  const latencies = results.map((result) => result.elapsed_ms).sort((a, b) => a - b);
  const usage = sumUsage(results.map((result) => result.usage).filter(Boolean));
  return {
    suite,
    model,
    base_url: baseUrl,
    repeat,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: {
      passed,
      total: results.length,
      pass_rate: results.length ? Number((passed / results.length).toFixed(4)) : 0,
      latency_ms_avg: average(latencies),
      latency_ms_p95: percentile(latencies, 0.95),
      usage,
    },
    results,
  };
}

function responseOutputText(response) {
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function chatOutputText(response) {
  return (response.choices || [])
    .map((choice) => choice.message?.content || "")
    .join("");
}

function responseUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function chatUsage(response) {
  const usage = response?.usage || {};
  return {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function sumUsage(values) {
  return values.reduce((sum, value) => ({
    input_tokens: sum.input_tokens + (value?.input_tokens || 0),
    output_tokens: sum.output_tokens + (value?.output_tokens || 0),
    total_tokens: sum.total_tokens + (value?.total_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function parseSseEvents(body) {
  return body.split(/\n\n+/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const event = frame.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return { event, data: parseJsonish(data) };
    });
}

function jsonHas(text, key, expected) {
  const parsed = parseJsonish(text);
  return parsed?.[key] === expected;
}

function parseJsonish(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}

function truncate(value, max = 1000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}
