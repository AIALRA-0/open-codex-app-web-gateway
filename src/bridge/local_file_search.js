"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const FILE_SEARCH_TOOL_TYPES = new Set(["file_search"]);
const DEFAULT_CHUNKING_STRATEGY = Object.freeze({
  type: "static",
  static: Object.freeze({
    max_chunk_size_tokens: 800,
    chunk_overlap_tokens: 400,
  }),
});
const MAX_SEARCH_QUERIES = 4;
const MAX_SEARCH_QUERY_CHARS = 240;

function isFileSearchTool(tool) {
  return !!tool && typeof tool === "object" && FILE_SEARCH_TOOL_TYPES.has(tool.type);
}

function localFileSearchToolTypes(tools = [], config = {}) {
  if (!canUseLocalFileSearch(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isFileSearchTool)
    .map((tool) => tool.type)));
}

function canUseLocalFileSearch(config = {}) {
  return String(config.fileSearchProvider || "local").toLowerCase() !== "disabled";
}

class LocalFileSearchStore {
  constructor(config = {}) {
    this.dir = path.resolve(config.fileSearchStateDir || path.join(config.stateDir || process.cwd(), "local-file-search"));
    this.maxFileBytes = config.fileSearchMaxFileBytes || 4 * 1024 * 1024;
  }

  createFile({ filename, purpose = "assistants", content = "", metadata = {} }) {
    const body = stringifyContent(content);
    const bytes = Buffer.byteLength(body);
    if (bytes > this.maxFileBytes) {
      const error = new Error(`file exceeds local limit of ${this.maxFileBytes} bytes`);
      error.status = 413;
      throw error;
    }

    const file = {
      id: prefixedId("file"),
      object: "file",
      bytes,
      created_at: nowSeconds(),
      filename: sanitizeFilename(filename || "upload.txt"),
      purpose: purpose || "assistants",
      metadata: isPlainObject(metadata) ? metadata : {},
      status: "processed",
    };
    this.writeJson(this.fileJsonPath(file.id), { file, content: body });
    return file;
  }

  listFiles({ purpose, url } = {}) {
    const files = this.listJson(this.filesDir())
      .map((record) => record.file)
      .filter(Boolean)
      .filter((file) => !purpose || file.purpose === purpose);
    return paginateList(files, url);
  }

  getFile(fileId) {
    return this.readJson(this.fileJsonPath(fileId))?.file || null;
  }

  getFileRecord(fileId) {
    return this.readJson(this.fileJsonPath(fileId));
  }

  getFileContent(fileId) {
    const record = this.getFileRecord(fileId);
    return typeof record?.content === "string" ? record.content : null;
  }

  deleteFile(fileId) {
    const file = this.getFile(fileId);
    if (!file) return null;
    this.deletePath(this.fileJsonPath(fileId));
    for (const store of this.listVectorStores().data) {
      this.deletePath(this.vectorStoreFilePath(store.id, fileId));
    }
    return { id: fileId, object: "file", deleted: true };
  }

  createVectorStore(body = {}) {
    const now = nowSeconds();
    const store = {
      id: prefixedId("vs"),
      object: "vector_store",
      created_at: now,
      last_active_at: now,
      name: body.name || null,
      description: body.description || null,
      metadata: isPlainObject(body.metadata) ? body.metadata : {},
      status: "completed",
      ...(isPlainObject(body.expires_after) ? { expires_after: normalizeExpiresAfter(body.expires_after) } : {}),
      bytes: 0,
      file_counts: emptyFileCounts(),
    };
    if (store.expires_after) store.expires_at = expiresAtFromPolicy(store.expires_after, store.last_active_at);
    this.writeJson(this.vectorStoreJsonPath(store.id), { vector_store: store });
    return this.hydrateVectorStore(store.id);
  }

  listVectorStores({ url } = {}) {
    const stores = this.listJson(this.vectorStoresDir())
      .map((record) => record.vector_store)
      .filter(Boolean)
      .map((store) => this.hydrateVectorStore(store.id))
      .filter(Boolean);
    return paginateList(stores, url);
  }

  getVectorStore(storeId) {
    return this.hydrateVectorStore(storeId);
  }

  updateVectorStore(storeId, body = {}) {
    const record = this.readJson(this.vectorStoreJsonPath(storeId));
    const store = record?.vector_store;
    if (!store) return null;
    const updated = { ...store };
    if (Object.prototype.hasOwnProperty.call(body, "name")) updated.name = body.name == null ? null : String(body.name);
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? body.metadata : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "expires_after")) {
      updated.expires_after = isPlainObject(body.expires_after) ? normalizeExpiresAfter(body.expires_after) : null;
    }
    if (updated.expires_after) {
      updated.expires_at = expiresAtFromPolicy(updated.expires_after, updated.last_active_at || updated.created_at || nowSeconds());
    } else {
      delete updated.expires_at;
    }
    this.writeJson(this.vectorStoreJsonPath(storeId), { ...record, vector_store: updated });
    return this.hydrateVectorStore(storeId);
  }

  deleteVectorStore(storeId) {
    const store = this.getVectorStore(storeId);
    if (!store) return null;
    this.deletePath(this.vectorStoreDir(storeId));
    return { id: storeId, object: "vector_store.deleted", deleted: true };
  }

  attachFile(storeId, body = {}) {
    const store = this.getVectorStore(storeId);
    if (!store) return null;
    const file = this.getFile(body.file_id);
    if (!file) {
      const error = new Error(`file not found: ${body.file_id}`);
      error.status = 404;
      throw error;
    }
    const attached = {
      id: file.id,
      object: "vector_store.file",
      created_at: nowSeconds(),
      vector_store_id: storeId,
      status: "completed",
      last_error: null,
      usage_bytes: file.bytes,
      attributes: isPlainObject(body.attributes) ? body.attributes : {},
      ...(isPlainObject(body.chunking_strategy) ? { chunking_strategy: normalizeChunkingStrategy(body.chunking_strategy) } : {}),
    };
    this.writeJson(this.vectorStoreFilePath(storeId, file.id), { vector_store_file: attached });
    return attached;
  }

  createVectorStoreFileBatch(storeId, body = {}) {
    const store = this.getVectorStore(storeId);
    if (!store) return null;
    const entries = normalizeBatchFiles(body);
    for (const entry of entries) {
      const file = this.getFile(entry.file_id);
      if (!file) {
        const error = new Error(`file not found: ${entry.file_id}`);
        error.status = 404;
        throw error;
      }
    }

    const batch = {
      id: prefixedId("vsfb"),
      object: "vector_store.file_batch",
      created_at: nowSeconds(),
      vector_store_id: storeId,
      status: "completed",
      file_counts: {
        in_progress: 0,
        completed: entries.length,
        failed: 0,
        cancelled: 0,
        total: entries.length,
      },
    };

    const fileIds = [];
    for (const entry of entries) {
      const attached = this.attachFile(storeId, entry);
      fileIds.push(attached.id);
    }
    this.writeJson(this.vectorStoreFileBatchPath(storeId, batch.id), {
      vector_store_file_batch: batch,
      file_ids: fileIds,
    });
    return batch;
  }

  getVectorStoreFileBatch(storeId, batchId) {
    const batch = this.readJson(this.vectorStoreFileBatchPath(storeId, batchId))?.vector_store_file_batch || null;
    if (!batch || !this.getVectorStore(storeId)) return null;
    return batch;
  }

  cancelVectorStoreFileBatch(storeId, batchId) {
    const record = this.readJson(this.vectorStoreFileBatchPath(storeId, batchId));
    const batch = record?.vector_store_file_batch;
    if (!batch || !this.getVectorStore(storeId)) return null;
    if (batch.status === "in_progress") {
      batch.status = "cancelled";
      batch.file_counts = {
        in_progress: 0,
        completed: 0,
        failed: 0,
        cancelled: record.file_ids?.length || 0,
        total: record.file_ids?.length || 0,
      };
      this.writeJson(this.vectorStoreFileBatchPath(storeId, batchId), { ...record, vector_store_file_batch: batch });
    }
    return batch;
  }

  listVectorStoreFileBatchFiles(storeId, batchId, { url } = {}) {
    const record = this.readJson(this.vectorStoreFileBatchPath(storeId, batchId));
    if (!record?.vector_store_file_batch || !this.getVectorStore(storeId)) return null;
    const status = url?.searchParams?.get("filter") || "";
    const files = (record.file_ids || [])
      .map((fileId) => this.getVectorStoreFile(storeId, fileId))
      .filter(Boolean)
      .filter((file) => !status || file.status === status);
    return paginateList(files, url);
  }

  listVectorStoreFiles(storeId, { url } = {}) {
    if (!this.getVectorStore(storeId)) return null;
    const files = this.listJson(this.vectorStoreFilesDir(storeId))
      .map((record) => record.vector_store_file)
      .filter(Boolean);
    return paginateList(files, url);
  }

  getVectorStoreFile(storeId, fileId) {
    return this.readJson(this.vectorStoreFilePath(storeId, fileId))?.vector_store_file || null;
  }

  updateVectorStoreFile(storeId, fileId, body = {}) {
    const record = this.readJson(this.vectorStoreFilePath(storeId, fileId));
    const attached = record?.vector_store_file;
    if (!attached || !this.getVectorStore(storeId)) return null;
    const updated = { ...attached };
    if (Object.prototype.hasOwnProperty.call(body, "attributes")) {
      updated.attributes = isPlainObject(body.attributes) ? body.attributes : {};
    }
    this.writeJson(this.vectorStoreFilePath(storeId, fileId), { ...record, vector_store_file: updated });
    return updated;
  }

  getVectorStoreFileContent(storeId, fileId) {
    const attached = this.getVectorStoreFile(storeId, fileId);
    if (!attached) return null;
    const record = this.getFileRecord(fileId);
    if (!record?.file || typeof record.content !== "string") return null;
    const chunks = chunkText(record.content, attached.chunking_strategy);
    const content = chunks.map((chunk) => ({ type: "text", text: chunk.text }));
    return {
      object: "vector_store.file_content.page",
      file_id: fileId,
      filename: record.file.filename,
      attributes: attached.attributes || {},
      chunking_strategy: effectiveChunkingStrategy(attached.chunking_strategy),
      content,
      data: content,
      chunks: chunks.map((chunk) => chunkMetadata(chunk)),
      has_more: false,
      next_page: null,
    };
  }

  deleteVectorStoreFile(storeId, fileId) {
    const attached = this.getVectorStoreFile(storeId, fileId);
    if (!attached) return null;
    this.deletePath(this.vectorStoreFilePath(storeId, fileId));
    return { id: fileId, object: "vector_store.file.deleted", deleted: true };
  }

  searchVectorStore(storeId, body = {}) {
    if (!this.getVectorStore(storeId)) return null;
    const queries = normalizeSearchQueries(body.query || "");
    const query = queries[0] || "";
    const maxResults = Math.max(1, Math.min(Number(body.max_num_results || body.limit || 5), 20));
    const filters = body.filters || body.filter || null;
    const rankingOptions = normalizeRankingOptions(body.ranking_options || body.rankingOptions);
    const attached = this.listVectorStoreFiles(storeId)?.data || [];
    const results = [];

    for (const item of attached) {
      const record = this.getFileRecord(item.id);
      if (!record?.file || typeof record.content !== "string") continue;
      const attributes = {
        ...(record.file.metadata || {}),
        ...(item.attributes || {}),
        file_id: record.file.id,
        filename: record.file.filename,
        purpose: record.file.purpose,
      };
      if (!matchesMetadataFilter(filters, attributes)) continue;
      for (const chunk of chunkText(record.content, item.chunking_strategy)) {
        const scoredQueries = scoreQueries(queries, chunk.text, record.file.filename);
        const score = scoredQueries[0]?.score || 0;
        if (score <= 0 || score < rankingOptions.score_threshold) continue;
        results.push({
          file_id: record.file.id,
          filename: record.file.filename,
          score,
          matched_queries: scoredQueries.map((item) => item.query),
          attributes: item.attributes || {},
          ...chunkMetadata(chunk),
          chunking_strategy: effectiveChunkingStrategy(item.chunking_strategy),
          content: [{ type: "text", text: chunk.text }],
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const page = results.slice(0, maxResults);
    return {
      object: "vector_store.search_results.page",
      search_query: query,
      search_queries: queries,
      ranking_options: rankingOptions,
      data: page,
      has_more: results.length > page.length,
    };
  }

  hydrateVectorStore(storeId) {
    const record = this.readJson(this.vectorStoreJsonPath(storeId));
    const store = record?.vector_store;
    if (!store) return null;
    const attached = this.listJson(this.vectorStoreFilesDir(storeId))
      .map((item) => item.vector_store_file)
      .filter(Boolean);
    const bytes = attached.reduce((sum, item) => sum + (item.usage_bytes || 0), 0);
    return {
      ...store,
      bytes,
      usage_bytes: bytes,
      file_counts: {
        in_progress: 0,
        completed: attached.length,
        failed: 0,
        cancelled: 0,
        total: attached.length,
      },
    };
  }

  filesDir() {
    return path.join(this.dir, "files");
  }

  fileJsonPath(fileId) {
    return path.join(this.filesDir(), `${safeId(fileId)}.json`);
  }

  vectorStoresDir() {
    return path.join(this.dir, "vector_stores");
  }

  vectorStoreDir(storeId) {
    return path.join(this.vectorStoresDir(), safeId(storeId));
  }

  vectorStoreJsonPath(storeId) {
    return path.join(this.vectorStoreDir(storeId), "store.json");
  }

  vectorStoreFilesDir(storeId) {
    return path.join(this.vectorStoreDir(storeId), "files");
  }

  vectorStoreFilePath(storeId, fileId) {
    return path.join(this.vectorStoreFilesDir(storeId), `${safeId(fileId)}.json`);
  }

  vectorStoreFileBatchesDir(storeId) {
    return path.join(this.vectorStoreDir(storeId), "file_batches");
  }

  vectorStoreFileBatchPath(storeId, batchId) {
    return path.join(this.vectorStoreFileBatchesDir(storeId), `${safeId(batchId)}.json`);
  }

  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  }

  listJson(dir) {
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.readJson(path.join(dir, name)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  deletePath(targetPath) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {
      // Best-effort delete.
    }
  }
}

async function prepareFileSearchContext(request = {}, config = {}, store, options = {}) {
  const tools = (request.tools || []).filter(isFileSearchTool);
  if (!tools.length || !canUseLocalFileSearch(config) || !store) return null;
  const queries = extractSearchQueries(request.input);
  const query = queries[0] || stringifyContent(request.input).slice(0, MAX_SEARCH_QUERY_CHARS);
  const includeResults = (request.include || []).some((item) => String(item).includes("file_search_call.results"));
  const allResults = [];
  const calls = [];
  const skippedCalls = [];

  for (const tool of tools) {
    const vectorStoreIds = tool.vector_store_ids
      || request.tool_resources?.file_search?.vector_store_ids
      || [];
    const maxResults = tool.max_num_results || config.fileSearchMaxResults || 5;
    const toolQueries = normalizeSearchQueries(tool.queries || tool.query || queries);
    for (const vectorStoreId of vectorStoreIds) {
      if (!reserveToolCall(options.toolBudget, {
        type: "file_search_call",
        tool_type: tool.type || "file_search",
        action: "search",
        vector_store_id: vectorStoreId,
        queries: toolQueries,
      })) {
        skippedCalls.push({
          action: "search",
          vector_store_id: vectorStoreId,
          queries: toolQueries,
          reason: "max_tool_calls_exhausted",
        });
        continue;
      }
      const page = store.searchVectorStore(vectorStoreId, {
        query: toolQueries,
        max_num_results: maxResults,
        filters: tool.filters,
        ranking_options: tool.ranking_options,
      });
      const results = page?.data || [];
      allResults.push(...results.map((result) => ({ ...result, vector_store_id: vectorStoreId })));
      calls.push({
        id: prefixedId("fs"),
        type: "file_search_call",
        status: page ? "completed" : "failed",
        queries: page?.search_queries || toolQueries,
        vector_store_ids: [vectorStoreId],
        ...(page?.ranking_options ? { ranking_options: page.ranking_options } : {}),
        ...(includeResults ? { results } : {}),
      });
    }
  }

  if (!calls.length) {
    if (!skippedCalls.length) {
      calls.push({
        id: prefixedId("fs"),
        type: "file_search_call",
        status: "failed",
        queries,
        vector_store_ids: [],
        ranking_options: normalizeRankingOptions(null),
        ...(includeResults ? { results: [] } : {}),
      });
    }
  }

  allResults.sort((a, b) => b.score - a.score);
  const effectiveQueries = normalizeSearchQueries(calls.flatMap((call) => call.queries || []));
  return {
    provider: "local",
    query: effectiveQueries[0] || query,
    queries: effectiveQueries,
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    calls,
    skipped_calls: skippedCalls,
    results: allResults.slice(0, config.fileSearchMaxResults || 5),
    ranking_options: calls.find((call) => call.ranking_options)?.ranking_options || normalizeRankingOptions(null),
  };
}

function injectFileSearchMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: fileSearchPrompt(context),
  });
}

function attachFileSearchOutput(response, context) {
  if (!context) return response;
  response.output = [
    ...fileSearchOutputItems(context),
    ...(response.output || []),
  ];
  annotateFileSearchResponse(response, context);
  return response;
}

function annotateFileSearchResponse(response, context) {
  if (!context?.results?.length) return response;
  const message = (response.output || []).find((item) => item.type === "message");
  const textPart = message?.content?.find((part) => part.type === "output_text");
  if (!textPart) return response;
  const withSources = ensureFileSourceMarkers(textPart.text || "", context.results);
  textPart.text = withSources.text;
  textPart.annotations = [
    ...(Array.isArray(textPart.annotations) ? textPart.annotations : []),
    ...withSources.annotations,
  ];
  return response;
}

function fileSearchOutputItems(context) {
  return (context?.calls || []).map((call) => ({
    id: call.id,
    type: "file_search_call",
    status: call.status || "completed",
    queries: call.queries || [context.query || ""],
    ...(call.vector_store_ids ? { vector_store_ids: call.vector_store_ids } : {}),
    ...(call.ranking_options ? { ranking_options: call.ranking_options } : {}),
    ...(call.results ? { results: call.results } : {}),
  }));
}

function fileSearchCompatibility(context) {
  if (!context) return {};
  return {
    local_file_search: {
      provider: context.provider || "local",
      status: context.calls?.some((call) => call.status === "completed")
        ? "completed"
        : (context.skipped_calls?.length ? "skipped" : "failed"),
      result_count: context.results?.length || 0,
      query_count: context.queries?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      tool_types: context.tool_types || [],
      ranking_options: context.ranking_options || normalizeRankingOptions(null),
    },
  };
}

function fileSearchPrompt(context) {
  if (!context.results.length) {
    return [
      context.skipped_calls?.length
        ? "Local Responses file_search compatibility skipped one or more searches because max_tool_calls was exhausted."
        : "Local Responses file_search compatibility found no matching vector store results.",
      `Queries: ${(context.queries || [context.query]).join(" | ")}`,
      context.skipped_calls?.length
        ? `Skipped searches: ${context.skipped_calls.map((call) => call.vector_store_id || call.action).join(", ")}`
        : null,
      "Do not invent file search results. Answer from visible context and say when file evidence is unavailable.",
    ].filter(Boolean).join("\n");
  }

  const lines = context.results.map((result, index) => [
    `[${index + 1}] ${result.filename}`,
    `file_id: ${result.file_id}`,
    `score: ${result.score.toFixed(4)}`,
    result.matched_queries?.length ? `matched_queries: ${result.matched_queries.join(" | ")}` : null,
    `content: ${result.content?.[0]?.text || ""}`,
  ].filter(Boolean).join("\n"));

  return [
    "Local Responses file_search compatibility results follow.",
    `Queries: ${(context.queries || [context.query]).join(" | ")}`,
    "Use these file results as retrieval evidence. Cite sources inline with [1], [2], etc. when using them.",
    "When the user asks for an exact string or exact answer, preserve the requested answer text and include only the requested citation marker.",
    ...lines,
  ].join("\n\n");
}

function ensureFileSourceMarkers(text, results) {
  let output = String(text || "");
  const annotations = [];
  const cited = [];

  results.forEach((result, index) => {
    const marker = `[${index + 1}]`;
    const markerIndex = output.indexOf(marker);
    if (markerIndex !== -1) cited.push({ result, index: markerIndex });
  });

  if (!cited.length && results.length) {
    const sources = results.map((result, index) => `[${index + 1}] ${result.filename}`).join("\n");
    output = `${output.trimEnd()}\n\nSources:\n${sources}`;
    results.forEach((result, index) => {
      const marker = `[${index + 1}]`;
      const start = output.indexOf(marker, output.indexOf("Sources:"));
      if (start !== -1) cited.push({ result, index: start });
    });
  }

  for (const citation of cited) {
    annotations.push({
      type: "file_citation",
      index: citation.index,
      file_id: citation.result.file_id,
      filename: citation.result.filename,
    });
  }

  return { text: output, annotations };
}

function extractSearchQueries(input) {
  const text = extractInputText(input).replace(/\s+/g, " ").trim();
  const explicit = text.match(/\b(?:file\s+search|search|look\s+up|find)\s+(?:for|about)?\s*["']?(.+?)(?:["']?(?:\.|\?|!|\bthen\b|\breturn\b|$))/i);
  let queries = normalizeSearchQueries(explicit?.[1]?.trim() || text);
  if (!queries.length || queries.some(isGenericSearchQuery)) {
    const exactAnswer = text.match(/\breturn\s+exactly(?:\s+this\s+text(?:\s+and\s+nothing\s+else)?|\s+the\s+exact\s+string)?\s*:?\s*["']?(.+?)["']?$/i);
    queries = normalizeSearchQueries(exactAnswer?.[1]?.replace(/\s*\[\d+\]\s*$/, "").trim() || text);
  }
  return queries;
}

function extractSearchQuery(input) {
  return extractSearchQueries(input)[0] || "";
}

function isGenericSearchQuery(query) {
  const normalized = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [
    "result",
    "results",
    "the result",
    "the results",
    "file search result",
    "file search results",
    "the file search result",
    "the file search results",
  ].includes(normalized);
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

function chunkText(text, chunkingStrategy) {
  const value = String(text || "").trim();
  if (!value) return [];
  const strategy = effectiveChunkingStrategy(chunkingStrategy);
  const maxTokens = strategy.static.max_chunk_size_tokens;
  const overlapTokens = strategy.static.chunk_overlap_tokens;
  const tokens = value.match(/\S+\s*/g) || [];
  if (!tokens.length) return [];
  const step = Math.max(1, maxTokens - overlapTokens);
  const chunks = [];
  for (let start = 0; start < tokens.length; start += step) {
    const end = Math.min(tokens.length, start + maxTokens);
    const chunkTextValue = tokens.slice(start, end).join("").trim();
    if (chunkTextValue) {
      chunks.push({
        text: chunkTextValue,
        chunk_index: chunks.length,
        token_start: start,
        token_end: end,
        token_count: end - start,
      });
    }
    if (end >= tokens.length) break;
  }
  return chunks;
}

function scoreText(query, text, filename = "") {
  const terms = tokenize(query);
  if (!terms.length) return 0;
  const haystackTokens = tokenize(`${filename} ${text}`);
  const haystack = new Set(haystackTokens);
  let hits = 0;
  for (const term of terms) if (haystack.has(term)) hits += 1;
  const coverage = hits / terms.length;
  const frequency = terms.reduce((sum, term) => sum + haystackTokens.filter((token) => token === term).length, 0);
  const phraseBoost = String(text || "").toLowerCase().includes(String(query || "").toLowerCase()) ? 0.25 : 0;
  return Math.min(1, coverage + Math.min(frequency / Math.max(haystackTokens.length, 1), 0.25) + phraseBoost);
}

function scoreQueries(queries, text, filename = "") {
  return normalizeSearchQueries(queries)
    .map((query) => ({ query, score: scoreText(query, text, filename) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
}

function normalizeSearchQueries(value) {
  const candidates = [];
  if (Array.isArray(value)) {
    for (const item of value) candidates.push(...splitSearchQueryText(stringifyContent(item)));
  } else {
    candidates.push(...splitSearchQueryText(stringifyContent(value)));
  }

  const seen = new Set();
  const queries = [];
  for (const candidate of candidates) {
    const query = String(candidate || "").replace(/\s+/g, " ").trim();
    if (!query) continue;
    const clipped = query.length > MAX_SEARCH_QUERY_CHARS ? query.slice(0, MAX_SEARCH_QUERY_CHARS) : query;
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(clipped);
    if (queries.length >= MAX_SEARCH_QUERIES) break;
  }
  return queries;
}

function splitSearchQueryText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const quoted = Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g))
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  if (quoted.length > 1) return quoted;
  const parts = text.split(/\s*(?:;|\band\b|\balso\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

function normalizeRankingOptions(value) {
  const source = isPlainObject(value) ? value : {};
  const threshold = Number(source.score_threshold ?? 0);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    const error = new Error("ranking_options.score_threshold must be between 0.0 and 1.0");
    error.status = 400;
    throw error;
  }

  const rankingOptions = {
    ranker: typeof source.ranker === "string" && source.ranker.trim() ? source.ranker.trim() : "auto",
    score_threshold: threshold,
  };

  if (isPlainObject(source.hybrid_search)) {
    rankingOptions.hybrid_search = normalizeHybridSearchOptions(source.hybrid_search);
  }
  return rankingOptions;
}

function normalizeHybridSearchOptions(value) {
  const embeddingWeight = Number(value.embedding_weight ?? value.rrf_embedding_weight ?? 0);
  const textWeight = Number(value.text_weight ?? value.rrf_text_weight ?? 1);
  if (!Number.isFinite(embeddingWeight) || embeddingWeight < 0) {
    const error = new Error("ranking_options.hybrid_search.embedding_weight must be non-negative");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(textWeight) || textWeight < 0) {
    const error = new Error("ranking_options.hybrid_search.text_weight must be non-negative");
    error.status = 400;
    throw error;
  }
  if (embeddingWeight === 0 && textWeight === 0) {
    const error = new Error("ranking_options.hybrid_search requires embedding_weight or text_weight to be greater than zero");
    error.status = 400;
    throw error;
  }
  return {
    embedding_weight: embeddingWeight,
    text_weight: textWeight,
    local_mode: "text_only",
  };
}

function effectiveChunkingStrategy(value) {
  if (!isPlainObject(value)) return cloneChunkingStrategy(DEFAULT_CHUNKING_STRATEGY);
  if (String(value.type || "").toLowerCase() === "auto") return cloneChunkingStrategy(DEFAULT_CHUNKING_STRATEGY);
  try {
    return normalizeChunkingStrategy(value);
  } catch {
    return cloneChunkingStrategy(DEFAULT_CHUNKING_STRATEGY);
  }
}

function normalizeChunkingStrategy(value) {
  if (!isPlainObject(value)) {
    const error = new Error("chunking_strategy must be an object");
    error.status = 400;
    throw error;
  }
  const type = String(value.type || "").toLowerCase();
  if (type === "auto") return { type: "auto" };
  if (type !== "static") {
    const error = new Error("chunking_strategy.type must be auto or static");
    error.status = 400;
    throw error;
  }
  const staticConfig = isPlainObject(value.static) ? value.static : {};
  const maxChunkSize = Number(staticConfig.max_chunk_size_tokens);
  const overlap = Number(staticConfig.chunk_overlap_tokens);
  if (!Number.isFinite(maxChunkSize) || maxChunkSize < 100 || maxChunkSize > 4096) {
    const error = new Error("chunking_strategy.static.max_chunk_size_tokens must be between 100 and 4096");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(overlap) || overlap < 0 || overlap > maxChunkSize / 2) {
    const error = new Error("chunking_strategy.static.chunk_overlap_tokens must be non-negative and no more than half of max_chunk_size_tokens");
    error.status = 400;
    throw error;
  }
  return {
    type: "static",
    static: {
      max_chunk_size_tokens: Math.trunc(maxChunkSize),
      chunk_overlap_tokens: Math.trunc(overlap),
    },
  };
}

function cloneChunkingStrategy(value) {
  return {
    type: value.type,
    static: {
      max_chunk_size_tokens: value.static.max_chunk_size_tokens,
      chunk_overlap_tokens: value.static.chunk_overlap_tokens,
    },
  };
}

function chunkMetadata(chunk) {
  return {
    chunk_index: chunk.chunk_index,
    token_start: chunk.token_start,
    token_end: chunk.token_end,
    token_count: chunk.token_count,
  };
}

function matchesMetadataFilter(filter, attributes = {}) {
  if (!filter) return true;
  if (Array.isArray(filter)) return filter.every((item) => matchesMetadataFilter(item, attributes));
  if (!isPlainObject(filter)) return true;

  const type = String(filter.type || filter.operator || "").toLowerCase();
  const nested = Array.isArray(filter.filters) ? filter.filters : [];
  if (type === "and") return nested.every((item) => matchesMetadataFilter(item, attributes));
  if (type === "or") return nested.some((item) => matchesMetadataFilter(item, attributes));

  const key = filter.key || filter.field || filter.attribute;
  if (!key) {
    return Object.entries(filter).every(([plainKey, plainValue]) => {
      if (["type", "operator", "filters"].includes(plainKey)) return true;
      return compareMetadataValue(attributes[plainKey], "eq", plainValue);
    });
  }

  const operator = type || "eq";
  return compareMetadataValue(attributes[key], operator, filter.value);
}

function compareMetadataValue(actual, operator, expected) {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "nin":
      return Array.isArray(expected) && !expected.includes(actual);
    default:
      return actual === expected;
  }
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((part) => part.length >= 2);
}

function paginateList(items, url) {
  const order = String(url?.searchParams?.get("order") || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const after = url?.searchParams?.get("after");
  const before = url?.searchParams?.get("before");
  const limit = parseLimit(url?.searchParams?.get("limit"), 20, 10000);
  let data = [...items].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  if (order === "desc") data.reverse();
  if (after) {
    const index = data.findIndex((item) => item.id === after);
    data = index === -1 ? [] : data.slice(index + 1);
  }
  if (before) {
    const index = data.findIndex((item) => item.id === before);
    data = index === -1 ? [] : data.slice(0, index);
  }
  const page = data.slice(0, limit);
  return {
    object: "list",
    data: page,
    first_id: page[0]?.id || null,
    last_id: page.at(-1)?.id || null,
    has_more: data.length > page.length,
  };
}

function emptyFileCounts() {
  return { in_progress: 0, completed: 0, failed: 0, cancelled: 0, total: 0 };
}

function normalizeExpiresAfter(value) {
  const days = Math.max(1, Math.min(Number(value.days || 1), 365));
  return {
    anchor: "last_active_at",
    days: Math.trunc(days),
  };
}

function expiresAtFromPolicy(policy, anchorTimestamp) {
  const days = Math.max(1, Math.min(Number(policy?.days || 1), 365));
  return Math.trunc(anchorTimestamp || nowSeconds()) + Math.trunc(days) * 86400;
}

function normalizeBatchFiles(body = {}) {
  const hasFileIds = Object.prototype.hasOwnProperty.call(body, "file_ids");
  const hasFiles = Object.prototype.hasOwnProperty.call(body, "files");
  if (hasFileIds && hasFiles) {
    const error = new Error("file_ids and files are mutually exclusive");
    error.status = 400;
    throw error;
  }

  let entries = [];
  if (hasFileIds) {
    if (!Array.isArray(body.file_ids)) {
      const error = new Error("file_ids must be an array");
      error.status = 400;
      throw error;
    }
    entries = body.file_ids.map((fileId) => ({
      file_id: fileId,
      ...(isPlainObject(body.attributes) ? { attributes: body.attributes } : {}),
      ...(isPlainObject(body.chunking_strategy) ? { chunking_strategy: body.chunking_strategy } : {}),
    }));
  } else if (hasFiles) {
    if (!Array.isArray(body.files)) {
      const error = new Error("files must be an array");
      error.status = 400;
      throw error;
    }
    entries = body.files.map((file) => {
      if (!isPlainObject(file)) {
        const error = new Error("files entries must be objects");
        error.status = 400;
        throw error;
      }
      return {
        file_id: file.file_id,
        ...(isPlainObject(file.attributes) ? { attributes: file.attributes } : {}),
        ...(isPlainObject(file.chunking_strategy) ? { chunking_strategy: file.chunking_strategy } : {}),
      };
    });
  }

  if (!entries.length) {
    const error = new Error("file_ids or files is required");
    error.status = 400;
    throw error;
  }
  if (entries.length > 2000) {
    const error = new Error("file batch cannot contain more than 2000 files");
    error.status = 400;
    throw error;
  }
  for (const entry of entries) {
    if (typeof entry.file_id !== "string" || !entry.file_id) {
      const error = new Error("each batch file must include file_id");
      error.status = 400;
      throw error;
    }
  }
  return entries;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) throw new Error(`invalid id: ${value}`);
  return value;
}

function sanitizeFilename(value) {
  return String(value || "upload.txt").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200) || "upload.txt";
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

module.exports = {
  LocalFileSearchStore,
  annotateFileSearchResponse,
  attachFileSearchOutput,
  fileSearchCompatibility,
  fileSearchOutputItems,
  injectFileSearchMessages,
  localFileSearchToolTypes,
  prepareFileSearchContext,
};
