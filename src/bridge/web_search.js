"use strict";

const { prefixedId, stringifyContent } = require("./translator");

const WEB_SEARCH_TOOL_TYPES = new Set([
  "web_search",
  "web_search_preview",
  "web_search_preview_2025_03_11",
]);

function isWebSearchTool(tool) {
  return !!tool && typeof tool === "object" && WEB_SEARCH_TOOL_TYPES.has(tool.type);
}

function localWebSearchToolTypes(tools = [], config = {}) {
  if (!canUseLocalWebSearch(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isWebSearchTool)
    .map((tool) => tool.type)));
}

function canUseLocalWebSearch(config = {}) {
  return String(config.webSearchProvider || "wikipedia").toLowerCase() !== "disabled";
}

async function prepareWebSearchContext(request = {}, config = {}, options = {}) {
  const tools = (request.tools || []).filter(isWebSearchTool);
  if (!tools.length || !canUseLocalWebSearch(config)) return null;

  const provider = String(config.webSearchProvider || "wikipedia").toLowerCase();
  const query = extractSearchQuery(request.input) || stringifyContent(request.input).slice(0, 240) || "OpenAI";
  const maxResults = Math.max(1, Math.min(Number(config.webSearchMaxResults || 5), 10));
  const context = {
    provider,
    query,
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    calls: [{
      id: prefixedId("ws"),
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query,
      },
    }],
    results: [],
  };

  try {
    context.results = await runSearchProvider(provider, query, maxResults, config, options);
    return context;
  } catch (error) {
    context.calls[0].status = "failed";
    context.error = error.message || "local web search failed";
    return context;
  }
}

function injectWebSearchMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: webSearchPrompt(context),
  });
}

function attachWebSearchOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...webSearchOutputItems(context),
    ...(response.output || []),
  ];
  annotateWebSearchResponse(response, context);
  return response;
}

function annotateWebSearchResponse(response, context) {
  if (!context?.results?.length) return response;
  const message = (response.output || []).find((item) => item.type === "message");
  const textPart = message?.content?.find((part) => part.type === "output_text");
  if (!textPart) return response;

  const withSources = ensureSourceMarkers(textPart.text || "", context.results);
  textPart.text = withSources.text;
  textPart.annotations = [
    ...(Array.isArray(textPart.annotations) ? textPart.annotations : []),
    ...withSources.annotations,
  ];
  return response;
}

function webSearchOutputItems(context) {
  return (context?.calls || []).map((call) => ({
    id: call.id,
    type: "web_search_call",
    status: call.status || "completed",
    action: call.action || { type: "search", query: context.query || "" },
    ...(call.status === "failed" ? { error: context.error || "local web search failed" } : {}),
  }));
}

function webSearchCompatibility(context) {
  if (!context) return {};
  return {
    local_web_search: {
      provider: context.provider,
      status: context.calls?.[0]?.status || "completed",
      result_count: context.results?.length || 0,
      tool_types: context.tool_types || [],
      ...(context.error ? { error: context.error } : {}),
    },
  };
}

function webSearchPrompt(context) {
  if (context.error) {
    return [
      "Local Responses web_search compatibility attempted a search, but it failed.",
      `Provider: ${context.provider}`,
      `Query: ${context.query}`,
      `Error: ${context.error}`,
      "Do not invent web search results. Answer from visible context and say when fresh web evidence is unavailable.",
    ].join("\n");
  }

  if (!context.results.length) {
    return [
      "Local Responses web_search compatibility ran a search but found no results.",
      `Provider: ${context.provider}`,
      `Query: ${context.query}`,
      "Do not invent web search results. Answer from visible context and say when fresh web evidence is unavailable.",
    ].join("\n");
  }

  const lines = context.results.map((result, index) => [
    `[${index + 1}] ${result.title}`,
    `URL: ${result.url}`,
    `Snippet: ${result.snippet || ""}`,
  ].join("\n"));

  return [
    "Local Responses web_search compatibility results follow.",
    `Provider: ${context.provider}`,
    `Query: ${context.query}`,
    "Use these results as web evidence. Cite sources inline with [1], [2], etc. when using information from them.",
    ...lines,
  ].join("\n\n");
}

async function runSearchProvider(provider, query, maxResults, config, options) {
  if (provider === "static") return staticResults(config).slice(0, maxResults);
  if (provider === "wikipedia") return searchWikipedia(query, maxResults, config, options);
  throw new Error(`unsupported local web search provider: ${provider}`);
}

function staticResults(config = {}) {
  const value = config.webSearchStaticResults;
  if (Array.isArray(value)) return normalizeResults(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return normalizeResults(JSON.parse(value));
  } catch {
    return [];
  }
}

async function searchWikipedia(query, maxResults, config = {}, options = {}) {
  const endpoint = config.webSearchWikipediaEndpoint || "https://en.wikipedia.org/w/api.php";
  const url = new URL(endpoint);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  url.searchParams.set("srlimit", String(maxResults));
  url.searchParams.set("srsearch", query);

  const fetchImpl = options.fetch || globalThis.fetch;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.webSearchTimeoutMs || 10000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "accept": "application/json",
        "user-agent": config.webSearchUserAgent || "open-codex-responses-bridge/0.2",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`wikipedia search failed with HTTP ${response.status}`);
    const json = await response.json();
    return normalizeResults((json.query?.search || []).map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "").replace(/ /g, "_"))}`,
      snippet: stripHtml(item.snippet || ""),
    }))).slice(0, maxResults);
  } finally {
    options.signal?.removeEventListener?.("abort", abortFromParent);
    clearTimeout(timeout);
  }
}

function normalizeResults(results) {
  return (results || [])
    .map((result) => ({
      title: stringifyContent(result.title || result.name || result.url || "Untitled result").slice(0, 200),
      url: stringifyContent(result.url || result.link || "").trim(),
      snippet: stringifyContent(result.snippet || result.description || result.content || "").slice(0, 1000),
    }))
    .filter((result) => result.url);
}

function ensureSourceMarkers(text, results) {
  let output = String(text || "");
  const annotations = [];
  const cited = [];

  results.forEach((result, index) => {
    const marker = `[${index + 1}]`;
    const markerIndex = output.indexOf(marker);
    if (markerIndex !== -1) {
      cited.push({ result, start: markerIndex, end: markerIndex + marker.length });
    }
  });

  if (!cited.length && results.length) {
    const sources = results.map((result, index) => `[${index + 1}] ${result.title}: ${result.url}`).join("\n");
    output = `${output.trimEnd()}\n\nSources:\n${sources}`;
    results.forEach((result, index) => {
      const marker = `[${index + 1}]`;
      const start = output.indexOf(marker, output.indexOf("Sources:"));
      const lineEnd = output.indexOf("\n", start);
      cited.push({
        result,
        start,
        end: lineEnd === -1 ? output.length : lineEnd,
      });
    });
  }

  for (const citation of cited) {
    annotations.push({
      type: "url_citation",
      start_index: citation.start,
      end_index: citation.end,
      url: citation.result.url,
      title: citation.result.title,
    });
  }

  return { text: output, annotations };
}

function extractSearchQuery(input) {
  const text = extractInputText(input).replace(/\s+/g, " ").trim();
  const explicit = text.match(/\b(?:web\s+search|search|look\s+up|find)\s+(?:for|about)?\s*["']?(.+?)(?:["']?(?:\.|\?|!|\bthen\b|\band\b|\breturn\b|$))/i);
  const query = explicit?.[1]?.trim() || text;
  return query.length > 240 ? query.slice(0, 240) : query;
}

function extractInputText(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map(extractInputText).filter(Boolean).join("\n");
  if (typeof input !== "object") return stringifyContent(input);
  if (typeof input.text === "string") return input.text;
  if (typeof input.content === "string") return input.content;
  if (Array.isArray(input.content)) return input.content.map(extractInputText).filter(Boolean).join("\n");
  return "";
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, ""));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

module.exports = {
  WEB_SEARCH_TOOL_TYPES,
  annotateWebSearchResponse,
  attachWebSearchOutput,
  injectWebSearchMessages,
  localWebSearchToolTypes,
  prepareWebSearchContext,
  webSearchCompatibility,
  webSearchOutputItems,
};
