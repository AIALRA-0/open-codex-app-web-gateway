"use strict";

const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const WEB_SEARCH_TOOL_TYPES = new Set([
  "web_search",
  "web_search_preview",
  "web_search_preview_2025_03_11",
]);
const WEB_SEARCH_RESULTS_INCLUDE = "web_search_call.results";
const WEB_SEARCH_ACTION_SOURCES_INCLUDE = "web_search_call.action.sources";
const DEFAULT_WIKIPEDIA_ENDPOINT = "https://en.wikipedia.org/w/api.php";
const DEFAULT_WEB_SEARCH_USER_AGENT = "open-codex-responses-bridge/0.2 (https://opencodexapp.aialra.online)";
const FIND_IN_PAGE_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "for",
  "from",
  "into",
  "return",
  "search",
  "that",
  "the",
  "then",
  "this",
  "use",
  "web",
  "with",
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
    include_results: webSearchResultsRequested(request),
    include_action_sources: webSearchActionSourcesRequested(request),
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    status: "completed",
    calls: [],
    results: [],
    skipped_calls: [],
  };

  const searchCall = {
    id: prefixedId("ws"),
    type: "web_search_call",
    status: "completed",
    action: {
      type: "search",
      query,
    },
  };
  if (!reserveToolCall(options.toolBudget, {
    type: "web_search_call",
    tool_type: context.tool_types[0] || "web_search",
    action: "search",
    query,
  })) {
    context.error = "max_tool_calls exhausted before local web search could run";
    context.status = "skipped";
    context.skipped_calls.push({ action: "search", query, reason: "max_tool_calls_exhausted" });
    return context;
  }
  context.calls.push(searchCall);

  try {
    context.results = await runSearchProvider(provider, query, maxResults, config, options);
    await openSearchResultPages(context, config, options);
    findInOpenedPages(context, config, options);
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

function attachWebSearchOutput(response, context, options = {}) {
  if (!context) return response;
  response.output = [
    ...webSearchOutputItems(context, options),
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

function annotateChatWebSearchCompletion(completion, context) {
  if (!context?.results?.length || !Array.isArray(completion?.choices)) return completion;
  for (const choice of completion.choices) {
    const message = choice?.message;
    if (!message || typeof message.content !== "string") continue;
    const withSources = ensureSourceMarkers(message.content, context.results);
    message.content = withSources.text;
    message.annotations = [
      ...(Array.isArray(message.annotations) ? message.annotations : []),
      ...withSources.annotations,
    ];
  }
  return completion;
}

function webSearchOutputItems(context, options = {}) {
  const includeResults = options.includeResults ?? context?.include_results ?? false;
  const includeSources = options.includeSources ?? context?.include_action_sources ?? false;
  return (context?.calls || []).map((call) => {
    const action = call.action || { type: "search", query: context.query || "" };
    const results = includeResults ? webSearchResults(context, action) : [];
    const sources = includeSources ? webSearchActionSources(context, action) : [];
    return {
      id: call.id,
      type: "web_search_call",
      status: call.status || "completed",
      action: {
        ...action,
        ...(sources.length ? { sources } : {}),
      },
      ...(results.length ? { results } : {}),
      ...(call.status === "failed" ? { error: call.error || context.error || "local web search failed" } : {}),
    };
  });
}

function webSearchCompatibility(context) {
  if (!context) return {};
  return {
    local_web_search: {
      provider: context.provider,
      status: context.status || context.calls?.[0]?.status || "completed",
      result_count: context.results?.length || 0,
      opened_count: context.results?.filter((result) => result.opened?.status === "completed").length || 0,
      open_failed_count: context.results?.filter((result) => result.opened?.status === "failed").length || 0,
      open_skipped_count: context.results?.filter((result) => result.opened?.status === "skipped").length || 0,
      find_in_page_count: context.results?.filter((result) => result.find_in_page?.status === "completed").length || 0,
      find_in_page_match_count: context.results?.reduce((sum, result) => sum + (result.find_in_page?.match_count || 0), 0) || 0,
      find_in_page_failed_count: context.results?.filter((result) => result.find_in_page?.status === "failed").length || 0,
      find_in_page_skipped_count: context.results?.filter((result) => result.find_in_page?.status === "skipped").length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      tool_types: context.tool_types || [],
      ...(context.include_action_sources ? {
        action_sources: {
          status: "included",
          source_count: context.results?.length || 0,
        },
      } : {}),
      ...(context.include_results ? {
        results: {
          status: "included",
          result_count: context.results?.length || 0,
        },
      } : {}),
      ...(context.error ? { error: context.error } : {}),
    },
  };
}

function webSearchResultsRequested(request = {}) {
  return Array.isArray(request.include) && request.include.includes(WEB_SEARCH_RESULTS_INCLUDE);
}

function webSearchActionSourcesRequested(request = {}) {
  return Array.isArray(request.include) && request.include.includes(WEB_SEARCH_ACTION_SOURCES_INCLUDE);
}

function webSearchResults(context, action = {}) {
  return webSearchResultObjectsForAction(context, action);
}

function webSearchActionSources(context, action = {}) {
  return webSearchResultObjectsForAction(context, action);
}

function webSearchResultObjectsForAction(context, action = {}) {
  const results = Array.isArray(context?.results) ? context.results : [];
  if (!results.length) return [];

  if (action.type === "search") {
    return results.map(sourceFromSearchResult).filter(Boolean);
  }

  const url = String(action.url || "");
  if (!url) return [];
  return results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.url === url)
    .map(({ result, index }) => sourceFromSearchResult(result, index))
    .filter(Boolean);
}

function sourceFromSearchResult(result, index) {
  if (!result?.url) return null;
  const source = {
    type: "url",
    url: result.url,
    title: result.title || result.url,
    index: index + 1,
  };
  if (result.snippet) source.snippet = result.snippet;
  if (result.opened) {
    source.opened = {
      status: result.opened.status || "completed",
      ...(result.opened.content_type ? { content_type: result.opened.content_type } : {}),
      ...(Number.isFinite(result.opened.bytes) ? { bytes: result.opened.bytes } : {}),
      ...(result.opened.truncated ? { truncated: true } : {}),
      ...(result.opened.error ? { error: result.opened.error } : {}),
      ...(result.opened.reason ? { reason: result.opened.reason } : {}),
    };
  }
  if (result.find_in_page) {
    source.find_in_page = {
      status: result.find_in_page.status || "completed",
      ...(Number.isFinite(result.find_in_page.match_count) ? { match_count: result.find_in_page.match_count } : {}),
      ...(result.find_in_page.truncated ? { truncated: true } : {}),
      ...(result.find_in_page.error ? { error: result.find_in_page.error } : {}),
      ...(result.find_in_page.reason ? { reason: result.find_in_page.reason } : {}),
    };
  }
  return source;
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
    result.opened?.status === "completed" ? `Opened page text:\n${result.opened.text}` : null,
    result.opened?.status === "failed" ? `Open page error: ${result.opened.error}` : null,
    result.opened?.status === "skipped" ? `Open page skipped: ${result.opened.reason}` : null,
    result.find_in_page?.status === "completed" ? findInPagePrompt(result.find_in_page) : null,
    result.find_in_page?.status === "failed" ? `Find in page error: ${result.find_in_page.error}` : null,
    result.find_in_page?.status === "skipped" ? `Find in page skipped: ${result.find_in_page.reason}` : null,
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

async function openSearchResultPages(context, config = {}, options = {}) {
  const openCount = Math.max(0, Math.min(Number(config.webSearchOpenPages || 0), 5));
  if (!openCount || !context?.results?.length) return;
  const candidates = context.results.slice(0, openCount);
  for (const result of candidates) {
    if (!reserveToolCall(options.toolBudget, {
      type: "web_search_call",
      tool_type: context.tool_types?.[0] || "web_search",
      action: "open_page",
      url: result.url,
    })) {
      result.opened = {
        status: "skipped",
        reason: "max_tool_calls_exhausted",
      };
      context.skipped_calls.push({ action: "open_page", url: result.url, reason: "max_tool_calls_exhausted" });
      continue;
    }
    const call = {
      id: prefixedId("ws"),
      type: "web_search_call",
      status: "completed",
      action: {
        type: "open_page",
        url: result.url,
      },
    };
    try {
      const opened = await fetchPageText(result.url, config, options);
      result.opened = {
        status: "completed",
        text: opened.text,
        content_type: opened.content_type,
        bytes: opened.bytes,
        truncated: opened.truncated,
      };
    } catch (error) {
      call.status = "failed";
      call.error = error.message || "local open_page failed";
      result.opened = {
        status: "failed",
        error: call.error,
      };
    }
    context.calls.push(call);
  }
}

function findInOpenedPages(context, config = {}, options = {}) {
  if (config.webSearchFindInPage === false || !context?.results?.length) return;
  for (const result of context.results) {
    if (result.opened?.status !== "completed") continue;
    if (!reserveToolCall(options.toolBudget, {
      type: "web_search_call",
      tool_type: context.tool_types?.[0] || "web_search",
      action: "find_in_page",
      url: result.url,
      query: context.query || "",
    })) {
      result.find_in_page = {
        status: "skipped",
        reason: "max_tool_calls_exhausted",
      };
      context.skipped_calls.push({ action: "find_in_page", url: result.url, reason: "max_tool_calls_exhausted" });
      continue;
    }
    const call = {
      id: prefixedId("ws"),
      type: "web_search_call",
      status: "completed",
      action: {
        type: "find_in_page",
        url: result.url,
        query: context.query || "",
      },
    };
    try {
      const found = findPageMatches(result.opened.text, context.query, config);
      result.find_in_page = {
        status: "completed",
        query: found.query,
        matches: found.matches,
        match_count: found.match_count,
        truncated: found.truncated,
      };
    } catch (error) {
      call.status = "failed";
      call.error = error.message || "local find_in_page failed";
      result.find_in_page = {
        status: "failed",
        error: call.error,
      };
    }
    context.calls.push(call);
  }
}

function findPageMatches(text, query, config = {}) {
  const pageText = String(text || "");
  if (!pageText.trim()) throw new Error("find_in_page has no page text to search");
  const needles = findInPageNeedles(query);
  if (!needles.length) throw new Error("find_in_page query is empty");

  const lowerText = pageText.toLowerCase();
  const maxMatches = Math.max(1, Math.min(Number(config.webSearchFindInPageMaxMatches || 3), 10));
  const contextChars = Math.max(40, Math.min(Number(config.webSearchFindInPageContextChars || 240), 2000));
  const matches = [];
  const seen = new Set();
  let truncated = false;

  for (const needle of needles) {
    const lowerNeedle = needle.toLowerCase();
    let from = 0;
    while (matches.length < maxMatches) {
      const index = lowerText.indexOf(lowerNeedle, from);
      if (index === -1) break;
      const start = Math.max(0, index - contextChars);
      const end = Math.min(pageText.length, index + needle.length + contextChars);
      const key = `${start}:${end}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          query: needle,
          start_index: index,
          end_index: index + needle.length,
          text: pageText.slice(start, end).replace(/\s+/g, " ").trim(),
        });
      }
      from = index + Math.max(needle.length, 1);
    }
    if (matches.length >= maxMatches) {
      truncated = lowerText.indexOf(lowerNeedle, from) !== -1 || needles.indexOf(needle) < needles.length - 1;
      break;
    }
  }

  return {
    query: String(query || "").trim(),
    matches,
    match_count: matches.length,
    truncated,
  };
}

function findInPageNeedles(query) {
  const normalized = String(query || "").replace(/\s+/g, " ").trim();
  const needles = [];
  if (normalized.length >= 3 && normalized.length <= 120) needles.push(normalized);
  const words = normalized.match(/[a-z0-9][a-z0-9'-]{2,}/gi) || [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (FIND_IN_PAGE_STOP_WORDS.has(lower)) continue;
    if (!needles.some((needle) => needle.toLowerCase() === lower)) needles.push(word);
    if (needles.length >= 8) break;
  }
  return needles;
}

function findInPagePrompt(findInPage) {
  const header = `Find in page matches for "${findInPage.query}":`;
  if (!findInPage.matches?.length) return `${header} none`;
  const lines = findInPage.matches.map((match, index) => `- Match ${index + 1} (${match.query}): ${match.text}`);
  return [header, ...lines].join("\n");
}

async function fetchPageText(value, config = {}, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("open_page URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("open_page URL must use http or https");
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), config.webSearchTimeoutMs || 10000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "accept": "text/html, text/plain;q=0.9, */*;q=0.1",
        "user-agent": config.webSearchUserAgent || DEFAULT_WEB_SEARCH_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`open_page failed with HTTP ${response.status}`);
    const contentType = response.headers?.get?.("content-type") || "";
    const { buffer, truncated: byteTruncated } = await readResponseLimited(response, config.webSearchPageMaxBytes || 512 * 1024);
    const rawText = buffer.toString("utf8").replace(/\u0000/g, "");
    let text = /^text\/html\b|application\/xhtml\+xml\b/i.test(contentType)
      ? htmlToText(rawText)
      : rawText;
    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const maxChars = config.webSearchPageMaxTextChars || 12000;
    const textTruncated = text.length > maxChars;
    if (textTruncated) text = text.slice(0, maxChars);
    if (!text) throw new Error("open_page returned no extractable text");
    return {
      text,
      content_type: contentType,
      bytes: buffer.length,
      truncated: byteTruncated || textTruncated,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("open_page timed out");
    throw error;
  } finally {
    options.signal?.removeEventListener?.("abort", abortFromParent);
    clearTimeout(timeout);
  }
}

async function readResponseLimited(response, maxBytes) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    const remaining = maxBytes - size;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (buffer.length > remaining) {
      chunks.push(buffer.subarray(0, remaining));
      size += remaining;
      truncated = true;
      break;
    }
    chunks.push(buffer);
    size += buffer.length;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

function htmlToText(value) {
  return decodeHtml(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n"));
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
  const endpoint = config.webSearchWikipediaEndpoint || DEFAULT_WIKIPEDIA_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  url.searchParams.set("srlimit", String(maxResults));
  url.searchParams.set("srsearch", query);

  try {
    const json = await fetchJson(url, config, options, "wikipedia search");
    return normalizeResults((json.query?.search || []).map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || "").replace(/ /g, "_"))}`,
      snippet: stripHtml(item.snippet || ""),
    }))).slice(0, maxResults);
  } catch (error) {
    const configuredStatic = staticResults(config).slice(0, maxResults);
    if (configuredStatic.length) return configuredStatic;
    if (endpoint !== DEFAULT_WIKIPEDIA_ENDPOINT) throw error;
    try {
      return await searchWikipediaRest(query, maxResults, config, options);
    } catch (fallbackError) {
      throw new Error(`${error.message || "wikipedia search failed"}; REST fallback failed: ${fallbackError.message || fallbackError}`);
    }
  }
}

async function searchWikipediaRest(query, maxResults, config = {}, options = {}) {
  const url = new URL("https://en.wikipedia.org/w/rest.php/v1/search/page");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(maxResults));
  const json = await fetchJson(url, config, options, "wikipedia REST search");
  return normalizeResults((json.pages || []).map((item) => ({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.key || item.title || "").replace(/ /g, "_"))}`,
    snippet: stripHtml(item.excerpt || item.description || ""),
  }))).slice(0, maxResults);
}

async function fetchJson(url, config = {}, options = {}, label = "request") {
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
        "user-agent": config.webSearchUserAgent || DEFAULT_WEB_SEARCH_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
    return await response.json();
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
  annotateChatWebSearchCompletion,
  annotateWebSearchResponse,
  attachWebSearchOutput,
  canUseLocalWebSearch,
  injectWebSearchMessages,
  localWebSearchToolTypes,
  prepareWebSearchContext,
  webSearchCompatibility,
  webSearchOutputItems,
};
