"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {
  FileAssistantStore,
  FileAudioVoiceStore,
  FileChatKitStore,
  FileConversationStore,
  FileImageGenerationStore,
  FileRealtimeStore,
  FileResponseStore,
} = require("./store");
const {
  createToolCallBudget,
  toolBudgetCompatibility,
} = require("./local_tool_budget");
const {
  injectInputFileMessages,
  inputFileCompatibility,
  prepareInputFileContext,
} = require("./input_files");
const {
  inputImageCompatibility,
  prepareInputImageContext,
} = require("./input_images");
const {
  LOCAL_EMBEDDING_DIMENSIONS,
  annotateFileSearchResponse,
  attachFileSearchOutput,
  fileSearchCompatibility,
  fileSearchOutputItems,
  injectFileSearchMessages,
  localFileSearchToolTypes,
  LocalFileSearchStore,
  prepareFileSearchContext,
  semanticVector,
} = require("./local_file_search");
const { LocalEvalStore } = require("./local_evals");
const {
  SUPPORTED_GRADER_TYPES,
  evaluateGraderAsync,
  normalizeRunSample,
  renderTemplateValue,
  runGraderAsync,
  validateGrader,
} = require("./local_graders");
const {
  LocalUploadStore,
  OFFICIAL_UPLOAD_MAX_BYTES,
  OFFICIAL_UPLOAD_PART_MAX_BYTES,
} = require("./local_uploads");
const { LocalFineTuningStore } = require("./local_fine_tuning");
const {
  createOrganizationCostsPage,
  createOrganizationUsagePage,
} = require("./local_organization_usage");
const {
  attachShellOutput,
  injectShellMessages,
  localShellToolTypes,
  LocalContainerStore,
  prepareShellContext,
  shellCompatibility,
  shellOutputItems,
} = require("./local_shell");
const {
  attachComputerOutput,
  computerCompatibility,
  computerOutputItems,
  executeComputerChatToolCalls,
  injectComputerActionTool,
  injectComputerMessages,
  localComputerToolTypes,
  prepareComputerContext,
  suppressComputerChatToolCalls,
} = require("./local_computer");
const {
  attachMcpOutput,
  executeApprovedMcpApprovalResponses,
  executeMcpChatToolCalls,
  injectMcpChatTools,
  injectMcpMessages,
  localMcpToolTypes,
  mcpCompatibility,
  mcpOutputItems,
  prepareMcpContext,
  suppressMcpChatToolCalls,
} = require("./local_mcp");
const {
  attachImageGenerationOutput,
  createImagesEditEventStream,
  createImagesEditResponse,
  createImagesGenerationEventStream,
  createImagesGenerationResponse,
  createImagesVariationResponse,
  imageGenerationCompatibility,
  imageGenerationOutputItems,
  imageGenerationPartialImages,
  injectImageGenerationMessages,
  localImageGenerationToolTypes,
  prepareImageGenerationContext,
} = require("./local_image_generation");
const { LocalSkillStore } = require("./local_skills");
const {
  chatCompatibilityMetadata,
  chatCompletionToReplayMessages,
  chatCompletionToResponse,
  chatUsageCompatibilityMetadata,
  createResponseSkeleton,
  filterStreamOptionsForProvider,
  mapUsage,
  normalizeChatAudioPart,
  normalizeOutputTextLogprobs,
  normalizeReasoningEffort,
  prefixedId,
  responseTerminalStateFromFinishReasons,
  responsesToChatRequest,
  stringifyContent,
} = require("./translator");
const {
  annotateWebSearchResponse,
  attachWebSearchOutput,
  injectWebSearchMessages,
  localWebSearchToolTypes,
  prepareWebSearchContext,
  webSearchCompatibility,
  webSearchOutputItems,
} = require("./web_search");

const DEFAULT_PROVIDER_BASE_URL = "https://api.deepseek.com";
const LOCAL_BATCH_ENDPOINTS = new Set([
  "/v1/responses",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/embeddings",
  "/v1/audio/transcriptions",
  "/v1/audio/translations",
  "/v1/images/generations",
  "/v1/images/edits",
  "/v1/images/variations",
  "/v1/videos",
  "/v1/moderations",
]);

const AUDIO_SPEECH_CONTENT_TYPES = Object.freeze({
  aac: "audio/aac",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  opus: "audio/opus",
  pcm: "application/octet-stream",
  wav: "audio/wav",
});
const AUDIO_CUSTOM_VOICE_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "mp4", "mpeg", "oga", "ogg", "wav", "webm"]);
const AUDIO_CUSTOM_VOICE_CONTENT_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4",
]);
const LOCAL_VIDEO_CONTENT_VARIANTS = new Set(["video", "thumbnail", "spritesheet"]);
const LOCAL_PLACEHOLDER_MP4 = Buffer.from("AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAGG1kYXQ=", "base64");
const LOCAL_PLACEHOLDER_WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const LOCAL_PLACEHOLDER_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const MODERATION_CATEGORIES = Object.freeze([
  "harassment",
  "harassment/threatening",
  "sexual",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual/minors",
  "violence",
  "violence/graphic",
]);

const MODERATION_IMAGE_AWARE_CATEGORIES = new Set([
  "sexual",
  "self-harm",
  "violence",
  "violence/graphic",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function numberFromEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function streamOptionFieldsFromEnv(fallback) {
  const value = process.env.CODEXCOMPAT_STREAM_OPTION_FIELDS;
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "*" || normalized === "all") return null;
  if (normalized === "none") return [];
  return String(value)
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function loadConfig(overrides = {}) {
  const apiKeyEnv = process.env.CODEXCOMPAT_PROVIDER_API_KEY_ENV || "DEEPSEEK_API_KEY";
  const imageGenerationApiKeyEnv = process.env.CODEXCOMPAT_IMAGE_GENERATION_API_KEY_ENV || "OPENAI_API_KEY";
  const stateDir = overrides.stateDir || process.env.CODEXCOMPAT_STATE_DIR || path.join(process.cwd(), "state", "responses-bridge");
  const providerBaseUrl = trimTrailingSlash(process.env.CODEXCOMPAT_PROVIDER_BASE_URL || DEFAULT_PROVIDER_BASE_URL);
  const deepseekProvider = isDeepSeekProvider(overrides.providerBaseUrl || providerBaseUrl);
  const webSearchProvider = overrides.webSearchProvider || process.env.CODEXCOMPAT_WEB_SEARCH_PROVIDER || "wikipedia";
  const defaultWebSearchOpenPages = String(webSearchProvider).toLowerCase() === "wikipedia" ? 1 : 0;
  const compactionSecretFile = overrides.compactionSecretFile
    || process.env.CODEXCOMPAT_COMPACTION_SECRET_FILE
    || path.join(stateDir, "compaction.key");
  const fileSearchMaxFileBytes = overrides.fileSearchMaxFileBytes
    || numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_FILE_BYTES", 4 * 1024 * 1024, 1024, 64 * 1024 * 1024);
  const uploadMaxBytes = overrides.uploadMaxBytes
    || numberFromEnv("CODEXCOMPAT_UPLOAD_MAX_BYTES", fileSearchMaxFileBytes, 1024, OFFICIAL_UPLOAD_MAX_BYTES);
  const uploadMaxPartBytes = overrides.uploadMaxPartBytes || numberFromEnv(
    "CODEXCOMPAT_UPLOAD_MAX_PART_BYTES",
    Math.min(OFFICIAL_UPLOAD_PART_MAX_BYTES, uploadMaxBytes),
    1024,
    OFFICIAL_UPLOAD_PART_MAX_BYTES,
  );
  const requestTimeoutMs = overrides.requestTimeoutMs
    || numberFromEnv("CODEXCOMPAT_REQUEST_TIMEOUT_MS", 10 * 60 * 1000, 5000, 60 * 60 * 1000);
  return {
    host: process.env.CODEXCOMPAT_HOST || "127.0.0.1",
    port: Number(process.env.CODEXCOMPAT_PORT || 12912),
    providerBaseUrl,
    chatCompletionsPath: normalizeRoute(process.env.CODEXCOMPAT_CHAT_COMPLETIONS_PATH || "/chat/completions"),
    modelsPath: normalizeRoute(process.env.CODEXCOMPAT_MODELS_PATH || "/models"),
    providerApiKey: process.env[apiKeyEnv] || process.env.CODEXCOMPAT_PROVIDER_API_KEY || "",
    providerApiKeyEnv: apiKeyEnv,
    defaultModel: process.env.CODEXCOMPAT_DEFAULT_MODEL || "deepseek-v4-pro",
    embeddingsModel: process.env.CODEXCOMPAT_EMBEDDINGS_MODEL || "hashed-semantic-256",
    embeddingsDimensions: numberFromEnv("CODEXCOMPAT_EMBEDDINGS_DIMENSIONS", LOCAL_EMBEDDING_DIMENSIONS, 1, 3072),
    moderationsModel: process.env.CODEXCOMPAT_MODERATIONS_MODEL || "omni-moderation-latest",
    batchMaxRequests: numberFromEnv("CODEXCOMPAT_BATCH_MAX_REQUESTS", 1000, 1, 50000),
    evalStateDir: process.env.CODEXCOMPAT_EVAL_STATE_DIR || path.join(stateDir, "local-evals"),
    evalMaxRows: numberFromEnv("CODEXCOMPAT_EVAL_MAX_ROWS", 100, 1, 5000),
    pythonGraderProvider: process.env.CODEXCOMPAT_PYTHON_GRADER_PROVIDER || "local",
    pythonGraderStateDir: process.env.CODEXCOMPAT_PYTHON_GRADER_STATE_DIR || path.join(stateDir, "local-python-graders"),
    pythonGraderTimeoutMs: numberFromEnv("CODEXCOMPAT_PYTHON_GRADER_TIMEOUT_MS", 120 * 1000, 1000, 120 * 1000),
    pythonGraderMaxSourceBytes: numberFromEnv("CODEXCOMPAT_PYTHON_GRADER_MAX_SOURCE_BYTES", 256 * 1024, 1, 256 * 1024),
    pythonGraderDiskBytes: numberFromEnv("CODEXCOMPAT_PYTHON_GRADER_DISK_BYTES", 1024 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024),
    pythonGraderMemoryBytes: numberFromEnv("CODEXCOMPAT_PYTHON_GRADER_MEMORY_BYTES", 2 * 1024 * 1024 * 1024, 64 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    pythonGraderBin: process.env.CODEXCOMPAT_PYTHON_GRADER_BIN || "python3",
    maxTokensField: process.env.CODEXCOMPAT_MAX_TOKENS_FIELD || "max_tokens",
    jsonSchemaMode: process.env.CODEXCOMPAT_JSON_SCHEMA_MODE || "json_object",
    localPromptTemplates: loadLocalPromptTemplates(),
    stateDir,
    chatKitStateDir: process.env.CODEXCOMPAT_CHATKIT_STATE_DIR || path.join(stateDir, "local-chatkit"),
    fineTuningStateDir: process.env.CODEXCOMPAT_FINE_TUNING_STATE_DIR || path.join(stateDir, "local-fine-tuning"),
    fineTuningMaxRecords: numberFromEnv("CODEXCOMPAT_FINE_TUNING_MAX_RECORDS", 5000, 1, 100000),
    conversationStateDir: process.env.CODEXCOMPAT_CONVERSATION_STATE_DIR || path.join(stateDir, "local-conversations"),
    assistantStateDir: process.env.CODEXCOMPAT_ASSISTANT_STATE_DIR || path.join(stateDir, "local-assistants"),
    requestTimeoutMs,
    backgroundLeaseTtlMs: numberFromEnv(
      "CODEXCOMPAT_BACKGROUND_LEASE_TTL_MS",
      Math.max(15 * 60 * 1000, requestTimeoutMs + 60 * 1000),
      5000,
      2 * 60 * 60 * 1000,
    ),
    truncationMaxInputChars: numberFromEnv("CODEXCOMPAT_TRUNCATION_MAX_INPUT_CHARS", 400000, 1000, 2 * 1024 * 1024),
    compactionMaxOutputTokens: numberFromEnv("CODEXCOMPAT_COMPACTION_MAX_OUTPUT_TOKENS", 512, 64, 4096),
    compactionSecret: process.env.CODEXCOMPAT_COMPACTION_SECRET || "",
    compactionSecretFile,
    inputFileProvider: process.env.CODEXCOMPAT_INPUT_FILE_PROVIDER || "local",
    inputFileMaxFiles: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_FILES", 8, 1, 32),
    inputFileMaxBytes: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_BYTES", 4 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    inputFileMaxTextChars: numberFromEnv("CODEXCOMPAT_INPUT_FILE_MAX_TEXT_CHARS", 200000, 1024, 2 * 1024 * 1024),
    inputFileFetchUrls: parseBoolean(process.env.CODEXCOMPAT_INPUT_FILE_FETCH_URLS, true),
    inputFileFetchTimeoutMs: numberFromEnv("CODEXCOMPAT_INPUT_FILE_FETCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    inputFilePdfExtractor: process.env.CODEXCOMPAT_INPUT_FILE_PDF_EXTRACTOR || "pdftotext",
    inputFilePdfTimeoutMs: numberFromEnv("CODEXCOMPAT_INPUT_FILE_PDF_TIMEOUT_MS", 10 * 1000, 1000, 120 * 1000),
    inputImageProvider: process.env.CODEXCOMPAT_INPUT_IMAGE_PROVIDER || "local",
    inputImageMaxImages: numberFromEnv("CODEXCOMPAT_INPUT_IMAGE_MAX_IMAGES", 32, 1, 1500),
    inputImageMaxBytes: numberFromEnv("CODEXCOMPAT_INPUT_IMAGE_MAX_BYTES", 4 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    webSearchProvider,
    webSearchMaxResults: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_MAX_RESULTS", 5, 1, 10),
    webSearchTimeoutMs: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    webSearchOpenPages: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_OPEN_PAGES", defaultWebSearchOpenPages, 0, 5),
    webSearchPageMaxBytes: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_BYTES", 512 * 1024, 4096, 5 * 1024 * 1024),
    webSearchPageMaxTextChars: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_PAGE_MAX_TEXT_CHARS", 12000, 1000, 200000),
    webSearchFindInPage: parseBoolean(process.env.CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE, true),
    webSearchFindInPageMaxMatches: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_MAX_MATCHES", 3, 1, 10),
    webSearchFindInPageContextChars: numberFromEnv("CODEXCOMPAT_WEB_SEARCH_FIND_IN_PAGE_CONTEXT_CHARS", 240, 40, 2000),
    webSearchStaticResults: process.env.CODEXCOMPAT_WEB_SEARCH_STATIC_RESULTS || "",
    webSearchWikipediaEndpoint: process.env.CODEXCOMPAT_WEB_SEARCH_WIKIPEDIA_ENDPOINT || "",
    webSearchUserAgent: process.env.CODEXCOMPAT_WEB_SEARCH_USER_AGENT || "open-codex-responses-bridge/0.2 (https://opencodexapp.aialra.online)",
    fileSearchProvider: process.env.CODEXCOMPAT_FILE_SEARCH_PROVIDER || "local",
    fileSearchStateDir: process.env.CODEXCOMPAT_FILE_SEARCH_STATE_DIR || path.join(stateDir, "local-file-search"),
    fileSearchMaxResults: numberFromEnv("CODEXCOMPAT_FILE_SEARCH_MAX_RESULTS", 5, 1, 50),
    fileSearchMaxFileBytes,
    uploadStateDir: process.env.CODEXCOMPAT_UPLOAD_STATE_DIR || path.join(stateDir, "local-uploads"),
    uploadMaxBytes,
    uploadMaxPartBytes,
    shellProvider: process.env.CODEXCOMPAT_SHELL_PROVIDER || "local",
    shellStateDir: process.env.CODEXCOMPAT_SHELL_STATE_DIR || path.join(stateDir, "local-containers"),
    shellCommandTimeoutMs: numberFromEnv("CODEXCOMPAT_SHELL_COMMAND_TIMEOUT_MS", 10 * 1000, 1000, 120 * 1000),
    shellMaxOutputBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_OUTPUT_BYTES", 20 * 1024, 1024, 512 * 1024),
    shellMaxFileBytes: numberFromEnv("CODEXCOMPAT_SHELL_MAX_FILE_BYTES", 16 * 1024 * 1024, 1024, 128 * 1024 * 1024),
    shellMaxCommandChars: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMAND_CHARS", 4000, 32, 20000),
    shellMaxCommands: numberFromEnv("CODEXCOMPAT_SHELL_MAX_COMMANDS", 1, 1, 5),
    shellMemoryLimit: process.env.CODEXCOMPAT_SHELL_MEMORY_LIMIT || "1g",
    computerProvider: process.env.CODEXCOMPAT_COMPUTER_PROVIDER || "local",
    mcpProvider: process.env.CODEXCOMPAT_MCP_PROVIDER || "local",
    mcpRemoteListTools: parseBoolean(process.env.CODEXCOMPAT_MCP_REMOTE_LIST_TOOLS, true),
    mcpRemoteToolCalls: parseBoolean(process.env.CODEXCOMPAT_MCP_REMOTE_TOOL_CALLS, true),
    mcpMaxCallRounds: numberFromEnv("CODEXCOMPAT_MCP_MAX_CALL_ROUNDS", 1, 1, 5),
    mcpMaxToolOutputChars: numberFromEnv("CODEXCOMPAT_MCP_MAX_TOOL_OUTPUT_CHARS", 20000, 1024, 1000000),
    mcpTimeoutMs: numberFromEnv("CODEXCOMPAT_MCP_TIMEOUT_MS", 5000, 500, 60000),
    mcpMaxResponseBytes: numberFromEnv("CODEXCOMPAT_MCP_MAX_RESPONSE_BYTES", 1048576, 4096, 8388608),
    mcpMaxTools: numberFromEnv("CODEXCOMPAT_MCP_MAX_TOOLS", 128, 1, 1000),
    mcpProtocolVersion: process.env.CODEXCOMPAT_MCP_PROTOCOL_VERSION || "2025-03-26",
    mcpClientName: process.env.CODEXCOMPAT_MCP_CLIENT_NAME || "open-codex-responses-bridge",
    audioProvider: process.env.CODEXCOMPAT_AUDIO_PROVIDER || "placeholder",
    audioSpeechModel: process.env.CODEXCOMPAT_AUDIO_SPEECH_MODEL || "gpt-4o-mini-tts",
    audioTranscriptionModel: process.env.CODEXCOMPAT_AUDIO_TRANSCRIPTION_MODEL || "gpt-4o-transcribe",
    audioTranslationModel: process.env.CODEXCOMPAT_AUDIO_TRANSLATION_MODEL || "whisper-1",
    audioDefaultVoice: process.env.CODEXCOMPAT_AUDIO_DEFAULT_VOICE || "alloy",
    audioMaxInputBytes: numberFromEnv("CODEXCOMPAT_AUDIO_MAX_INPUT_BYTES", 25 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    audioVoiceStateDir: process.env.CODEXCOMPAT_AUDIO_VOICE_STATE_DIR || path.join(stateDir, "local-audio-voices"),
    audioVoiceMaxVoices: numberFromEnv("CODEXCOMPAT_AUDIO_VOICE_MAX_VOICES", 20, 1, 20),
    audioVoiceMaxInputBytes: numberFromEnv("CODEXCOMPAT_AUDIO_VOICE_MAX_INPUT_BYTES", 25 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    imageGenerationProvider: process.env.CODEXCOMPAT_IMAGE_GENERATION_PROVIDER || "placeholder",
    imageGenerationStateDir: process.env.CODEXCOMPAT_IMAGE_GENERATION_STATE_DIR || path.join(stateDir, "local-image-generations"),
    imageGenerationMaxStoredImages: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGES", 5000, 1, 100000),
    imageGenerationMaxStoredImageBytes: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_MAX_STORED_IMAGE_BYTES", 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    imageGenerationStoreTtlMs: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_STORE_TTL_MS", 14 * 24 * 60 * 60 * 1000, 60 * 60 * 1000, 90 * 24 * 60 * 60 * 1000),
    imageGenerationBaseUrl: trimTrailingSlash(process.env.CODEXCOMPAT_IMAGE_GENERATION_BASE_URL || "https://api.openai.com/v1"),
    imageGenerationPath: normalizeRoute(process.env.CODEXCOMPAT_IMAGE_GENERATION_PATH || "/images/generations"),
    imageGenerationEditPath: normalizeRoute(process.env.CODEXCOMPAT_IMAGE_GENERATION_EDIT_PATH || "/images/edits"),
    imageGenerationVariationPath: normalizeRoute(process.env.CODEXCOMPAT_IMAGE_GENERATION_VARIATION_PATH || "/images/variations"),
    imageGenerationApiKey: process.env[imageGenerationApiKeyEnv] || process.env.CODEXCOMPAT_IMAGE_GENERATION_API_KEY || "",
    imageGenerationApiKeyEnv,
    imageGenerationModel: process.env.CODEXCOMPAT_IMAGE_GENERATION_MODEL || "gpt-image-2",
    imageGenerationVariationModel: process.env.CODEXCOMPAT_IMAGE_GENERATION_VARIATION_MODEL || "dall-e-2",
    imageGenerationResponseFormat: process.env.CODEXCOMPAT_IMAGE_GENERATION_RESPONSE_FORMAT || "",
    imageGenerationUser: process.env.CODEXCOMPAT_IMAGE_GENERATION_USER || "",
    imageGenerationTimeoutMs: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_TIMEOUT_MS", 120 * 1000, 1000, 10 * 60 * 1000),
    imageGenerationMaxInputImageBytes: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_MAX_INPUT_IMAGE_BYTES", 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    imageGenerationInputFetchTimeoutMs: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_INPUT_FETCH_TIMEOUT_MS", 10 * 1000, 1000, 60 * 1000),
    imageGenerationPlaceholderSize: numberFromEnv("CODEXCOMPAT_IMAGE_GENERATION_PLACEHOLDER_SIZE", 96, 16, 512),
    videoGenerationProvider: process.env.CODEXCOMPAT_VIDEO_GENERATION_PROVIDER || "placeholder",
    videoGenerationModel: process.env.CODEXCOMPAT_VIDEO_GENERATION_MODEL || "sora-2",
    videoGenerationDefaultSize: process.env.CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SIZE || "1280x720",
    videoGenerationDefaultSeconds: process.env.CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_SECONDS || "4",
    videoGenerationDefaultQuality: process.env.CODEXCOMPAT_VIDEO_GENERATION_DEFAULT_QUALITY || "standard",
    videoGenerationMaxInputBytes: numberFromEnv("CODEXCOMPAT_VIDEO_GENERATION_MAX_INPUT_BYTES", 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    realtimeStateDir: process.env.CODEXCOMPAT_REALTIME_STATE_DIR || path.join(stateDir, "local-realtime"),
    realtimeMaxRecords: numberFromEnv("CODEXCOMPAT_REALTIME_MAX_RECORDS", 5000, 1, 100000),
    skillStateDir: process.env.CODEXCOMPAT_SKILL_STATE_DIR || path.join(stateDir, "local-skills"),
    skillMaxUploadBytes: numberFromEnv("CODEXCOMPAT_SKILL_MAX_UPLOAD_BYTES", 50 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    skillMaxFileCount: numberFromEnv("CODEXCOMPAT_SKILL_MAX_FILE_COUNT", 500, 1, 500),
    deepseekReasoningEffortCompat: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_REASONING_EFFORT_COMPAT, true),
    deepseekThinkingMode: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_THINKING_MODE, false),
    deepseekDisableThinkingForToolChoice: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_TOOL_CHOICE, true),
    deepseekDisableThinkingForCompaction: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_COMPACTION, true),
    deepseekDisableThinkingForLocalWebSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_WEB_SEARCH, true),
    deepseekDisableThinkingForLocalFileSearch: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_FILE_SEARCH, true),
    deepseekDisableThinkingForLocalShell: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_SHELL, true),
    deepseekDisableThinkingForLocalComputer: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_COMPUTER, true),
    deepseekDisableThinkingForLocalMcp: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_MCP, true),
    deepseekDisableThinkingForLocalImageGeneration: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_LOCAL_IMAGE_GENERATION, true),
    deepseekDisableThinkingForInputFiles: parseBoolean(process.env.CODEXCOMPAT_DEEPSEEK_DISABLE_THINKING_FOR_INPUT_FILES, true),
    chatDeveloperRoleCompat: parseBoolean(process.env.CODEXCOMPAT_CHAT_DEVELOPER_ROLE_COMPAT, deepseekProvider),
    chatDeveloperRole: process.env.CODEXCOMPAT_CHAT_DEVELOPER_ROLE || "system",
    deepseekUserIdCompat: parseBoolean(
      process.env.CODEXCOMPAT_DEEPSEEK_USER_ID_COMPAT,
      deepseekProvider,
    ),
    forwardStoredChatFields: parseBoolean(process.env.CODEXCOMPAT_FORWARD_STORED_CHAT_FIELDS, !deepseekProvider),
    forwardServiceTier: parseBoolean(process.env.CODEXCOMPAT_FORWARD_SERVICE_TIER, !deepseekProvider),
    forwardChatNativeFields: parseBoolean(process.env.CODEXCOMPAT_FORWARD_CHAT_NATIVE_FIELDS, !deepseekProvider),
    forwardChatCustomTools: parseBoolean(process.env.CODEXCOMPAT_FORWARD_CHAT_CUSTOM_TOOLS, !deepseekProvider),
    forwardStreamOptions: parseBoolean(process.env.CODEXCOMPAT_FORWARD_STREAM_OPTIONS, true),
    streamOptionFields: streamOptionFieldsFromEnv(deepseekProvider ? ["include_usage"] : null),
    streamIncludeUsage: parseBoolean(process.env.CODEXCOMPAT_STREAM_INCLUDE_USAGE, true),
    forwardReasoningSummary: parseBoolean(process.env.CODEXCOMPAT_FORWARD_REASONING_SUMMARY, false),
    ...overrides,
  };
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeRoute(value) {
  const route = String(value || "").trim();
  if (!route) return "/";
  return route.startsWith("/") ? route : `/${route}`;
}

function loadLocalPromptTemplates() {
  const templates = {};
  mergePlainObjects(templates, readJsonObjectFile(process.env.CODEXCOMPAT_PROMPT_TEMPLATE_FILE));
  mergePlainObjects(templates, parseJsonObject(process.env.CODEXCOMPAT_PROMPT_TEMPLATES));
  return templates;
}

function mergePlainObjects(target, source) {
  if (!isPlainObject(source)) return target;
  for (const [key, value] of Object.entries(source)) target[key] = value;
  return target;
}

function readJsonObjectFile(filePath) {
  if (!filePath) return {};
  try {
    return parseJsonObject(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch {
    return {};
  }
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isDeepSeekProvider(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === "deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return /\bdeepseek\b/i.test(String(value || ""));
  }
}

function log(...args) {
  console.log(new Date().toISOString(), "[responses-bridge]", ...args);
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function sendError(res, status, message, details = {}) {
  sendJson(res, status, {
    error: {
      message,
      type: details.type || "compatibility_bridge_error",
      param: details.param || null,
      code: details.code || null,
    },
  });
}

async function readBody(req, maxBytes = 16 * 1024 * 1024) {
  return (await readRawBody(req, maxBytes)).toString("utf8");
}

async function readRawBody(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function providerHeaders(config, incomingHeaders = {}) {
  const headers = {
    "content-type": "application/json",
    "accept": incomingHeaders.accept || "application/json",
  };
  if (config.providerApiKey) headers.authorization = `Bearer ${config.providerApiKey}`;
  return headers;
}

function translatorOptions(config, extra = {}) {
  return {
    ...config,
    ...extra,
    decodeCompaction: (encryptedContent) => decodeLocalCompaction(encryptedContent, config),
    decodeReasoning: (encryptedContent) => decodeLocalReasoning(encryptedContent, config),
  };
}

async function fetchProvider(config, route, body, incomingHeaders = {}, options = {}) {
  if (!config.providerApiKey && !options.allowMissingKey) {
    const error = new Error(`${config.providerApiKeyEnv} is required for upstream provider calls`);
    error.status = 500;
    throw error;
  }

  const controller = options.controller || new AbortController();
  const timeout = setTimeout(() => {
    options.onTimeout?.();
    controller.abort();
  }, config.requestTimeoutMs);
  try {
    return await fetch(`${config.providerBaseUrl}${route}`, {
      method: "POST",
      headers: providerHeaders(config, incomingHeaders),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderGet(config, route, incomingHeaders = {}, options = {}) {
  if (!config.providerApiKey && !options.allowMissingKey) {
    const error = new Error(`${config.providerApiKeyEnv} is required for upstream provider calls`);
    error.status = 500;
    throw error;
  }

  const controller = options.controller || new AbortController();
  const timeout = setTimeout(() => {
    options.onTimeout?.();
    controller.abort();
  }, config.requestTimeoutMs);
  try {
    return await fetch(`${config.providerBaseUrl}${route}`, {
      method: "GET",
      headers: providerHeaders(config, incomingHeaders),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderWithMcpToolLoop(config, chat, request, incomingHeaders, localMcp, toolBudget, options = {}) {
  const usageParts = [];
  let current = await fetchProviderJson(config, chat, incomingHeaders, options);
  if (!current.ok) return current;
  if (current.json?.usage) usageParts.push(current.json.usage);

  const maxRounds = Math.max(1, Math.min(5, Number(config.mcpMaxCallRounds || 1)));
  for (let round = 0; round < maxRounds; round += 1) {
    const execution = await executeMcpChatToolCalls(localMcp, current.json, config, { toolBudget });
    if (!execution.executed) break;
    if (execution.approval_requested) {
      current.json = suppressMcpChatToolCalls(current.json, localMcp);
      break;
    }
    chat.messages.push(...execution.messages);
    if (round + 1 >= maxRounds) chat.tool_choice = "none";
    current = await fetchProviderJson(config, chat, incomingHeaders, options);
    if (!current.ok) return current;
    if (current.json?.usage) usageParts.push(current.json.usage);
  }

  if (usageParts.length > 1 && current.json) {
    current.json.usage = combineChatUsage(usageParts);
  }
  return current;
}

async function fetchProviderJson(config, chat, incomingHeaders, options = {}) {
  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, incomingHeaders, options);
  const text = await upstream.text();
  const json = parseJsonOrNull(text);
  return {
    ok: upstream.ok,
    status: upstream.status,
    text,
    json,
  };
}

function combineChatUsage(usages = []) {
  const totals = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let sawTotal = false;
  let reasoningTokens = 0;
  let cachedTokens = 0;
  for (const usage of usages) {
    if (!isPlainObject(usage)) continue;
    const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
    const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    totals.prompt_tokens += prompt;
    totals.completion_tokens += completion;
    if (usage.total_tokens != null) {
      sawTotal = true;
      totals.total_tokens += Number(usage.total_tokens) || 0;
    }
    reasoningTokens += Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0) || 0;
    cachedTokens += Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0) || 0;
  }
  if (!sawTotal) totals.total_tokens = totals.prompt_tokens + totals.completion_tokens;
  if (reasoningTokens) totals.completion_tokens_details = { reasoning_tokens: reasoningTokens };
  if (cachedTokens) totals.prompt_tokens_details = { cached_tokens: cachedTokens };
  return totals;
}

async function handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, imageGenerationStore, containerStore, conversationStore, skillStore) {
  const request = await readJson(req);
  const responseId = prefixedId("resp");
  const toolBudget = createToolCallBudget(request.max_tool_calls);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousResponseRecord = request.previous_response_id ? store.get(request.previous_response_id) : null;
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(Array.isArray(previousResponseRecord?.messages) ? previousResponseRecord.messages : []),
  ];
  const previousResponse = previousResponseRecord?.response || null;
  const localHostedTools = [
    ...localWebSearchToolTypes(request.tools || [], config),
    ...localFileSearchToolTypes(request.tools || [], config),
    ...localShellToolTypes(request.tools || [], config),
    ...localComputerToolTypes(request.tools || [], config),
    ...localMcpToolTypes(request.tools || [], config),
    ...localImageGenerationToolTypes(request.tools || [], config),
  ];
  const localInputImages = prepareInputImageContext(request, config, fileSearchStore);
  const translatorRequest = localInputImages?.request || request;
  const { chat, compatibility } = responsesToChatRequest(
    translatorRequest,
    previousMessages,
    translatorOptions(config, { localHostedTools }),
  );
  Object.assign(compatibility, inputImageCompatibility(localInputImages));
  chat.model = chat.model || config.defaultModel;
  applyCompactionReplayToChat(chat, compatibility, request, config);

  if (request.background) {
    handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, {
      ...compatibility,
      ...(conversation ? { local_conversation: { id: conversation.id, replayed_item_count: conversation.items.length } } : {}),
      ...(localHostedTools.length ? { local_hosted_tools: { status: "pending", tool_types: localHostedTools } } : {}),
    }, previousMessages, fileSearchStore, imageGenerationStore, containerStore, conversationStore, conversation, toolBudget, skillStore);
    return;
  }

  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) {
    applyInputFilesToChat(chat, compatibility, localInputFiles, config);
  }
  const localShell = await prepareShellContext(request, config, containerStore, { toolBudget, skillStore });
  if (localShell) {
    applyLocalShellToChat(chat, compatibility, localShell, config);
  }
  const localComputer = await prepareComputerContext(request, config, { toolBudget });
  if (localComputer) {
    applyLocalComputerToChat(chat, compatibility, localComputer, config);
  }
  const localMcp = await prepareMcpContext(request, config, { toolBudget, previousResponse });
  if (localMcp) {
    const approvedMcp = await executeApprovedMcpApprovalResponses(localMcp, config, { toolBudget });
    applyLocalMcpToChat(chat, compatibility, localMcp, config);
    if (!approvedMcp.handled) injectMcpChatTools(chat, localMcp, config, { toolBudget });
  }
  const localImageGeneration = await prepareImageGenerationContext(request, config, { fileSearchStore, imageGenerationStore, previousResponse, toolBudget });
  if (localImageGeneration) {
    applyLocalImageGenerationToChat(chat, compatibility, localImageGeneration, config);
  }
  const localWebSearch = await prepareWebSearchContext(request, config, { toolBudget });
  if (localWebSearch) {
    applyLocalWebSearchToChat(chat, compatibility, localWebSearch, config);
  }
  const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore, { toolBudget });
  if (localFileSearch) {
    applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config);
  }
  Object.assign(compatibility, toolBudgetCompatibility(toolBudget));
  const truncationError = applyLocalContextTruncation(chat, compatibility, request, previousMessages, config);
  if (truncationError) {
    sendLocalTruncationError(res, truncationError);
    return;
  }

  if (chat.stream) {
    await handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, {
      ...compatibility,
      ...(conversation ? { local_conversation: { id: conversation.id, replayed_item_count: conversation.items.length } } : {}),
    }, localWebSearch, localFileSearch, localShell, localComputer, localImageGeneration, localMcp, conversationStore, conversation, toolBudget);
    return;
  }

  const providerResult = await fetchProviderWithMcpToolLoop(config, chat, request, req.headers, localMcp, toolBudget);
  if (!providerResult.ok) {
    sendJson(res, providerResult.status, providerResult.json || { error: { message: providerResult.text } });
    return;
  }
  let upstreamJson = providerResult.json;
  const computerExecution = executeComputerChatToolCalls(localComputer, upstreamJson, config, { toolBudget });
  if (computerExecution.executed) {
    upstreamJson = suppressComputerChatToolCalls(upstreamJson, localComputer);
  }
  mergeLocalComputerCompatibility(compatibility, computerCompatibility(localComputer));
  mergeLocalMcpCompatibility(compatibility, mcpCompatibility(localMcp));
  Object.assign(compatibility, toolBudgetCompatibility(toolBudget));

  const response = chatCompletionToResponse(upstreamJson, request, { responseId });
  attachConversationToResponse(response, conversation);
  attachShellOutput(response, localShell, { includeCodeInterpreterOutputs: true });
  attachComputerOutput(response, localComputer);
  attachMcpOutput(response, localMcp);
  attachImageGenerationOutput(response, localImageGeneration);
  attachWebSearchOutput(response, localWebSearch, { includeSources: true });
  attachFileSearchOutput(response, localFileSearch, { includeResults: true });
  const localReasoningEncryptedContent = attachLocalReasoningEncryptedContent(response, request, config, { force: true });
  const localModeration = attachLocalResponseInlineModeration(response, request, config);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(
      response.metadata?.compatibility,
      compatibility,
      {
        ...(localReasoningEncryptedContent ? { local_reasoning_encrypted_content: localReasoningEncryptedContent } : {}),
        ...(localModeration ? { local_moderation: localModeration } : {}),
      },
    ),
    upstream_object: upstreamJson.object || null,
  };

  if (request.store !== false) {
    store.put(response.id, {
      response,
      input_items: normalizeStoredInputItems(request.input),
      messages: [
        ...chat.messages,
        ...chatCompletionToReplayMessages(upstreamJson),
      ],
    });
  }
  const publicResponse = projectResponseForRequestIncludes(response, request);
  appendResponseToConversation(conversationStore, conversation, request, publicResponse);

  sendJson(res, 200, publicResponse);
}

function mergeLocalComputerCompatibility(target, source) {
  if (!isPlainObject(source?.local_computer)) {
    Object.assign(target, source || {});
    return target;
  }
  target.local_computer = {
    ...(isPlainObject(target.local_computer) ? target.local_computer : {}),
    ...source.local_computer,
  };
  for (const [key, value] of Object.entries(source)) {
    if (key !== "local_computer") target[key] = value;
  }
  return target;
}

function mergeLocalMcpCompatibility(target, source) {
  if (!isPlainObject(source?.local_mcp)) {
    Object.assign(target, source || {});
    return target;
  }
  target.local_mcp = {
    ...(isPlainObject(target.local_mcp) ? target.local_mcp : {}),
    ...source.local_mcp,
  };
  for (const [key, value] of Object.entries(source)) {
    if (key !== "local_mcp") target[key] = value;
  }
  return target;
}

function handleBackgroundResponse(req, res, config, store, backgroundJobs, request, chat, responseId, compatibility, previousMessages, fileSearchStore, imageGenerationStore, containerStore, conversationStore, conversation, toolBudget, skillStore) {
  const backgroundRequest = {
    ...request,
    background: true,
    stream: false,
    store: true,
  };
  chat.stream = false;
  if (config.forwardStoredChatFields === false) {
    delete chat.store;
  } else {
    chat.store = true;
  }

  const response = createResponseSkeleton(backgroundRequest, {
    id: responseId,
    model: chat.model,
    status: "in_progress",
  });
  attachConversationToResponse(response, conversation);
  const backgroundCompatibility = {
    ...compatibility,
    ...toolBudgetCompatibility(toolBudget),
    background: request.store === false ? "local_store_forced" : "local_async",
    ...(request.stream ? { stream: "disabled_for_background" } : {}),
  };
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: backgroundCompatibility,
  };

  store.put(response.id, {
    response,
    input_items: normalizeStoredInputItems(request.input),
    messages: chat.messages,
    background_job: backgroundJobState({
      stage: "queued",
      request: backgroundRequest,
      chat,
      compatibility: backgroundCompatibility,
      previousMessages,
      conversation,
      lease: createBackgroundJobLease(config.backgroundLeaseOwner, config.backgroundLeaseTtlMs),
    }),
  });

  startBackgroundJob({
    config,
    store,
    backgroundJobs,
    request: backgroundRequest,
    chat,
    responseId: response.id,
    compatibility: backgroundCompatibility,
    incomingHeaders: req.headers,
    previousMessages,
    fileSearchStore,
    imageGenerationStore,
    containerStore,
    conversationStore,
    conversation,
    toolBudget,
    skillStore,
  });

  sendJson(res, 200, response);
}

function startBackgroundJob(params) {
  const controller = new AbortController();
  const job = {
    controller,
    created_at: Date.now(),
    deleted: false,
    resumed: !!params.resumed,
    lease_owner: params.config?.backgroundLeaseOwner || null,
    lease_ttl_ms: normalizeBackgroundLeaseTtlMs(params.config),
  };
  params.backgroundJobs.set(params.responseId, job);
  runBackgroundResponse({
    ...params,
    job,
  });
  return job;
}

const BACKGROUND_PREPARE_STEPS = ["input_files", "shell", "computer", "mcp", "image_generation", "web_search", "file_search", "truncation"];

async function runBackgroundResponse({ config, store, backgroundJobs, job, request, chat, responseId, compatibility, incomingHeaders, previousMessages = [], fileSearchStore, imageGenerationStore, containerStore, conversationStore, conversation, toolBudget, skillStore, prepared = false, localOutputItems = [], preparationState = null }) {
  try {
    if (prepared) {
      await runPreparedBackgroundProviderResponse({
        config,
        store,
        job,
        request,
        chat,
        responseId,
        compatibility,
        incomingHeaders,
        conversationStore,
        conversation,
        localOutputItems,
        toolBudget,
      });
      return;
    }

    const preparedRequest = await prepareBackgroundProviderRequest({
      config,
      store,
      job,
      request,
      chat,
      responseId,
      compatibility,
      previousMessages,
      fileSearchStore,
      imageGenerationStore,
      containerStore,
      toolBudget,
      skillStore,
      preparationState,
    });
    if (preparedRequest.truncationError) {
      const truncationError = preparedRequest.truncationError;
      storeFailedBackgroundResponse(store, responseId, truncationError.message, 400, {
        error: localTruncationErrorBody(truncationError).error,
      });
      return;
    }

    persistBackgroundJobState(store, responseId, {
      stage: "provider_pending",
      request,
      chat: preparedRequest.chat,
      compatibility: preparedRequest.compatibility,
      local_output_items: preparedRequest.localOutputItems,
      conversation,
      mcp_ephemeral_context: hasBackgroundEphemeralMcpContext(preparedRequest.contexts),
    }, job);

    await runPreparedBackgroundProviderResponse({
      config,
      store,
      job,
      request,
      chat: preparedRequest.chat,
      responseId,
      compatibility: preparedRequest.compatibility,
      incomingHeaders,
      conversationStore,
      conversation,
      localOutputItems: preparedRequest.localOutputItems,
      contexts: preparedRequest.contexts,
      toolBudget,
    });
  } catch (error) {
    if (job.deleted) return;
    if (job.timed_out) {
      storeFailedBackgroundResponse(store, responseId, "upstream provider request timed out", 504);
      return;
    }
    if (job.controller.signal.aborted || error.name === "AbortError") {
      storeCancelledBackgroundResponse(store, responseId, "cancelled");
      return;
    }
    storeFailedBackgroundResponse(store, responseId, error.message, 500);
  } finally {
    backgroundJobs.delete(responseId);
  }
}

async function prepareBackgroundProviderRequest({ config, store, job, request, chat, responseId, compatibility, previousMessages = [], fileSearchStore, imageGenerationStore, containerStore, toolBudget, skillStore, preparationState = null }) {
  const runtime = backgroundPreparationRuntime({
    preparationState,
    chat,
    compatibility,
    toolBudget,
  });

  persistBackgroundPrepareState(store, responseId, runtime, {
    status: "ready",
    current_step: null,
  }, job);

  while (runtime.nextStep) {
    const step = runtime.nextStep;
    persistBackgroundPrepareState(store, responseId, runtime, {
      status: "running",
      current_step: step,
    }, job);

    const result = await runBackgroundPrepareStep(step, {
      config,
      store,
      job,
      request,
      previousMessages,
      fileSearchStore,
      imageGenerationStore,
      containerStore,
      skillStore,
      runtime,
    });
    if (result?.truncationError) {
      return {
        truncationError: result.truncationError,
      };
    }

    runtime.completedSteps = Array.from(new Set([...runtime.completedSteps, step]));
    runtime.nextStep = nextBackgroundPrepareStep(step);
    persistBackgroundPrepareState(store, responseId, runtime, {
      status: "ready",
      current_step: null,
    }, job);
  }

  return {
    chat: runtime.chat,
    compatibility: runtime.compatibility,
    localOutputItems: backgroundPreparationOutputItems(runtime.contexts),
    contexts: runtime.contexts,
    toolBudget: runtime.toolBudget,
  };
}

async function runBackgroundPrepareStep(step, { config, store, job, request, previousMessages, fileSearchStore, imageGenerationStore, containerStore, skillStore, runtime }) {
  if (step === "input_files") {
    const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore, { signal: job.controller.signal });
    runtime.contexts.input_files = localInputFiles;
    if (localInputFiles) {
      runtime.compatibility = applyInputFilesToChat(runtime.chat, { ...runtime.compatibility }, localInputFiles, config);
    }
    return {};
  }

  if (step === "shell") {
    const localShell = await prepareShellContext(request, config, containerStore, { toolBudget: runtime.toolBudget, skillStore });
    runtime.contexts.shell = localShell;
    if (localShell) {
      runtime.compatibility = applyLocalShellToChat(runtime.chat, { ...runtime.compatibility }, localShell, config);
    }
    return {};
  }

  if (step === "computer") {
    const localComputer = await prepareComputerContext(request, config, { toolBudget: runtime.toolBudget });
    runtime.contexts.computer = localComputer;
    if (localComputer) {
      runtime.compatibility = applyLocalComputerToChat(runtime.chat, { ...runtime.compatibility }, localComputer, config);
    }
    return {};
  }

  if (step === "mcp") {
    const previousResponse = request.previous_response_id ? store.get(request.previous_response_id)?.response : null;
    const localMcp = await prepareMcpContext(request, config, { toolBudget: runtime.toolBudget, previousResponse });
    runtime.contexts.mcp = localMcp;
    if (localMcp) {
      const approvedMcp = await executeApprovedMcpApprovalResponses(localMcp, config, { toolBudget: runtime.toolBudget });
      runtime.compatibility = applyLocalMcpToChat(runtime.chat, { ...runtime.compatibility }, localMcp, config);
      if (!approvedMcp.handled) injectMcpChatTools(runtime.chat, localMcp, config, { toolBudget: runtime.toolBudget });
    }
    return {};
  }

  if (step === "image_generation") {
    const previousResponse = request.previous_response_id ? store.get(request.previous_response_id)?.response : null;
    const localImageGeneration = await prepareImageGenerationContext(request, config, { fileSearchStore, imageGenerationStore, previousResponse, toolBudget: runtime.toolBudget });
    runtime.contexts.image_generation = localImageGeneration;
    if (localImageGeneration) {
      runtime.compatibility = applyLocalImageGenerationToChat(runtime.chat, { ...runtime.compatibility }, localImageGeneration, config);
    }
    return {};
  }

  if (step === "web_search") {
    const localWebSearch = await prepareWebSearchContext(request, config, { signal: job.controller.signal, toolBudget: runtime.toolBudget });
    runtime.contexts.web_search = localWebSearch;
    if (localWebSearch) {
      runtime.compatibility = applyLocalWebSearchToChat(runtime.chat, { ...runtime.compatibility }, localWebSearch, config);
    }
    return {};
  }

  if (step === "file_search") {
    const localFileSearch = await prepareFileSearchContext(request, config, fileSearchStore, { toolBudget: runtime.toolBudget });
    runtime.contexts.file_search = localFileSearch;
    if (localFileSearch) {
      runtime.compatibility = applyLocalFileSearchToChat(runtime.chat, { ...runtime.compatibility }, localFileSearch, config);
    }
    return {};
  }

  if (step === "truncation") {
    Object.assign(runtime.compatibility, toolBudgetCompatibility(runtime.toolBudget));
    const truncationError = applyLocalContextTruncation(runtime.chat, runtime.compatibility, request, previousMessages, config);
    if (truncationError) return { truncationError };
    return {};
  }

  throw new Error(`unknown background prepare step: ${stringifyContent(step)}`);
}

function backgroundPreparationRuntime({ preparationState = null, chat, compatibility, toolBudget }) {
  const state = isPlainObject(preparationState) ? preparationState : {};
  const hasPersistedNextStep = Object.prototype.hasOwnProperty.call(state, "next_step");
  return {
    status: "ready",
    currentStep: null,
    nextStep: hasPersistedNextStep && validBackgroundPrepareStep(state.next_step) ? state.next_step : "input_files",
    completedSteps: Array.isArray(state.completed_steps) ? [...state.completed_steps] : [],
    chat: isPlainObject(state.chat) ? clone(state.chat) : clone(chat || {}),
    compatibility: isPlainObject(state.compatibility) ? clone(state.compatibility) : clone(compatibility || {}),
    contexts: isPlainObject(state.contexts) ? clone(state.contexts) : {},
    toolBudget: toolBudget || null,
  };
}

function persistBackgroundPrepareState(store, responseId, runtime, patch = {}, job = null) {
  return persistBackgroundJobState(store, responseId, {
    stage: "preparing",
    prepare: {
      version: 1,
      status: patch.status || runtime.status || "ready",
      current_step: patch.current_step ?? runtime.currentStep ?? null,
      next_step: runtime.nextStep || null,
      completed_steps: clone(runtime.completedSteps || []),
      chat: clone(runtime.chat || {}),
      compatibility: clone(runtime.compatibility || {}),
      contexts: clone(runtime.contexts || {}),
      tool_budget: cloneToolCallBudget(runtime.toolBudget),
    },
  }, job);
}

function backgroundPreparationOutputItems(contexts = {}) {
  return [
    ...shellOutputItems(contexts.shell, { includeCodeInterpreterOutputs: true }),
    ...computerOutputItems(contexts.computer),
    ...mcpOutputItems(contexts.mcp),
    ...imageGenerationOutputItems(contexts.image_generation),
    ...webSearchOutputItems(contexts.web_search, { includeSources: true }),
    ...fileSearchOutputItems(contexts.file_search, { includeResults: true }),
  ];
}

function hasBackgroundEphemeralMcpContext(contexts = {}) {
  return !!contexts?.mcp?.chat_tool_map;
}

function validBackgroundPrepareStep(step) {
  return step == null || BACKGROUND_PREPARE_STEPS.includes(step);
}

function nextBackgroundPrepareStep(step) {
  const index = BACKGROUND_PREPARE_STEPS.indexOf(step);
  if (index < 0) return null;
  return BACKGROUND_PREPARE_STEPS[index + 1] || null;
}

async function runPreparedBackgroundProviderResponse({ config, store, job, request, chat, responseId, compatibility, incomingHeaders = {}, conversationStore, conversation, localOutputItems = [], contexts = null, toolBudget = null }) {
  const providerResult = await fetchProviderWithMcpToolLoop(config, chat, request, incomingHeaders, contexts?.mcp, toolBudget, {
    controller: job.controller,
    onTimeout: () => {
      job.timed_out = true;
    },
  });
  if (job.deleted) return;
  if (job.controller.signal.aborted) {
    storeCancelledBackgroundResponse(store, responseId, "cancelled");
    return;
  }

  if (!providerResult.ok) {
    storeFailedBackgroundResponse(store, responseId, providerResult.text, providerResult.status, providerResult.json);
    return;
  }

  let upstreamJson = providerResult.json;
  if (contexts?.computer) {
    const computerExecution = executeComputerChatToolCalls(contexts.computer, upstreamJson, config, { toolBudget });
    if (computerExecution.executed) {
      upstreamJson = suppressComputerChatToolCalls(upstreamJson, contexts.computer);
    }
  }
  const finalLocalOutputItems = contexts ? backgroundPreparationOutputItems(contexts) : localOutputItems;
  const finalCompatibility = { ...(compatibility || {}) };
  if (contexts?.computer) mergeLocalComputerCompatibility(finalCompatibility, computerCompatibility(contexts.computer));
  if (contexts?.mcp) mergeLocalMcpCompatibility(finalCompatibility, mcpCompatibility(contexts.mcp));
  Object.assign(finalCompatibility, toolBudgetCompatibility(toolBudget));

  const response = chatCompletionToResponse(upstreamJson, request, { responseId });
  attachConversationToResponse(response, conversation);
  prependLocalOutputItems(response, finalLocalOutputItems);
  response.background = true;
  const localReasoningEncryptedContent = attachLocalReasoningEncryptedContent(response, request, config, { force: true });
  const localModeration = attachLocalResponseInlineModeration(response, request, config);
  const storedResponse = store.get(responseId)?.response;
  const storedMetadata = isPlainObject(storedResponse?.metadata) ? clone(storedResponse.metadata) : {};
  const responseMetadata = isPlainObject(response.metadata) ? response.metadata : {};
  response.metadata = {
    ...responseMetadata,
    ...storedMetadata,
    compatibility: mergeCompatibility(
      responseMetadata.compatibility,
      storedMetadata.compatibility,
      finalCompatibility,
      {
        ...(localReasoningEncryptedContent ? { local_reasoning_encrypted_content: localReasoningEncryptedContent } : {}),
        ...(localModeration ? { local_moderation: localModeration } : {}),
      },
    ),
    upstream_object: upstreamJson?.object || null,
  };

  store.put(response.id, {
    response,
    input_items: normalizeStoredInputItems(request.input),
    messages: [
      ...chat.messages,
      ...chatCompletionToReplayMessages(upstreamJson),
    ],
  });
  appendResponseToConversation(conversationStore, conversation, request, projectResponseForRequestIncludes(response, request));
}

function prependLocalOutputItems(response, items = []) {
  const localItems = Array.isArray(items) ? items.filter(isPlainObject).map(clone) : [];
  if (!localItems.length) return response;
  response.output = [
    ...localItems,
    ...(response.output || []),
  ];
  return response;
}

function responseWithFullLocalOutputs(response, contexts = {}) {
  const full = clone(response);
  if (contexts.request && contexts.config) {
    attachLocalReasoningEncryptedContent(full, contexts.request, contexts.config, {
      force: true,
      reportMetadata: false,
    });
  }
  if (contexts.localShell) mergeFullShellOutputs(full, contexts.localShell);
  if (contexts.localWebSearch) mergeFullWebSearchOutputs(full, contexts.localWebSearch);
  if (contexts.localFileSearch) mergeFullFileSearchOutputs(full, contexts.localFileSearch);
  return full;
}

function mergeFullShellOutputs(response, localShell) {
  if (!Array.isArray(response?.output)) return response;
  const fullShellItems = shellOutputItems(localShell, { includeCodeInterpreterOutputs: true });
  const fullCodeCalls = new Map(fullShellItems
    .filter((item) => item?.type === "code_interpreter_call" && item.id)
    .map((item) => [item.id, item]));
  if (!fullCodeCalls.size) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "code_interpreter_call" || !item.id) return item;
    return fullCodeCalls.get(item.id) || item;
  });
  return response;
}

function mergeFullFileSearchOutputs(response, localFileSearch) {
  if (!Array.isArray(response?.output)) return response;
  const fullFileSearchItems = fileSearchOutputItems(localFileSearch, { includeResults: true });
  const fullFileSearchCalls = new Map(fullFileSearchItems
    .filter((item) => item?.type === "file_search_call" && item.id)
    .map((item) => [item.id, item]));
  if (!fullFileSearchCalls.size) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "file_search_call" || !item.id) return item;
    return fullFileSearchCalls.get(item.id) || item;
  });
  return response;
}

function mergeFullWebSearchOutputs(response, localWebSearch) {
  if (!Array.isArray(response?.output)) return response;
  const fullWebSearchItems = webSearchOutputItems(localWebSearch, { includeSources: true });
  const fullWebSearchCalls = new Map(fullWebSearchItems
    .filter((item) => item?.type === "web_search_call" && item.id)
    .map((item) => [item.id, item]));
  if (!fullWebSearchCalls.size) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "web_search_call" || !item.id) return item;
    return fullWebSearchCalls.get(item.id) || item;
  });
  return response;
}

function backgroundJobState({
  stage,
  request,
  chat,
  compatibility,
  previousMessages = [],
  conversation = null,
  local_output_items = [],
  lease = null,
} = {}) {
  return {
    version: 1,
    stage,
    created_at: Date.now(),
    updated_at: Date.now(),
    request: redactStoredRequestSecrets(request || {}),
    chat: clone(chat || {}),
    compatibility: clone(compatibility || {}),
    previous_messages: clone(previousMessages || []),
    conversation: conversation ? clone(conversation) : null,
    local_output_items: clone(local_output_items || []),
    ...(isPlainObject(lease) ? { lease: clone(lease) } : {}),
  };
}

function redactStoredRequestSecrets(request = {}) {
  const sanitized = clone(request || {});
  if (Array.isArray(sanitized.tools)) {
    sanitized.tools = sanitized.tools.map((tool) => redactStoredToolSecrets(tool));
  }
  return sanitized;
}

function redactStoredToolSecrets(tool) {
  if (!isPlainObject(tool)) return tool;
  const sanitized = clone(tool);
  if (sanitized.type === "mcp") {
    delete sanitized.authorization;
    if (isPlainObject(sanitized.headers)) {
      for (const key of Object.keys(sanitized.headers)) {
        if (key.toLowerCase() === "authorization") delete sanitized.headers[key];
      }
      if (!Object.keys(sanitized.headers).length) delete sanitized.headers;
    }
  }
  return sanitized;
}

function persistBackgroundJobState(store, responseId, patch = {}, job = null) {
  const record = store.get(responseId);
  if (!record?.response || record.response.status !== "in_progress") return null;
  const existing = isPlainObject(record.background_job) ? record.background_job : {};
  const next = {
    ...existing,
    ...clone(patch),
    version: existing.version || 1,
    updated_at: Date.now(),
  };
  if (isPlainObject(next.request)) {
    next.request = redactStoredRequestSecrets(next.request);
  }
  if (job?.lease_owner) {
    next.lease = createBackgroundJobLease(job.lease_owner, job.lease_ttl_ms, existing.lease);
  }
  store.put(responseId, {
    ...record,
    background_job: next,
  });
  return next;
}

function storeFailedBackgroundResponse(store, responseId, message, status, upstreamJson = null) {
  return updateStoredResponse(store, responseId, (response) => ({
    ...response,
    status: "failed",
    completed_at: nowSeconds(),
    error: {
      message: stringifyContent(upstreamJson?.error?.message || message || "background response failed"),
      type: upstreamJson?.error?.type || "upstream_provider_error",
      code: upstreamJson?.error?.code || status || 500,
      param: upstreamJson?.error?.param || null,
    },
  }));
}

function storeCancelledBackgroundResponse(store, responseId, reason) {
  return updateStoredResponse(store, responseId, (response) => ({
    ...response,
    status: "cancelled",
    completed_at: nowSeconds(),
    error: null,
    metadata: {
      ...(response.metadata || {}),
      compatibility_cancel: reason || "cancelled",
    },
  }));
}

function resumeStaleBackgroundResponses({ config, store, backgroundJobs, fileSearchStore, imageGenerationStore, containerStore, conversationStore, skillStore }) {
  if (typeof store?.list !== "function" || typeof store?.put !== "function") {
    return { resumed: 0, reconciled: 0, skipped: 0 };
  }
  const summary = { resumed: 0, reconciled: 0, skipped: 0 };
  const leaseOwner = config.backgroundLeaseOwner || createBackgroundLeaseOwner();
  const leaseTtlMs = normalizeBackgroundLeaseTtlMs(config);
  for (const record of store.list()) {
    const response = record?.response;
    if (!response || response.status !== "in_progress" || response.background !== true) continue;
    const responseId = response.id || record.id;
    if (!responseId) continue;
    const leaseClaim = claimBackgroundJobLease(store, responseId, {
      owner: leaseOwner,
      ttlMs: leaseTtlMs,
    });
    if (!leaseClaim.claimed) {
      summary.skipped += 1;
      continue;
    }
    const claimedRecord = leaseClaim.record || record;
    const claimedResponse = claimedRecord?.response || response;
    const jobState = isPlainObject(claimedRecord.background_job) ? claimedRecord.background_job : null;
    if (canResumePreparedBackgroundJob(jobState)) {
      const toolBudget = createResumedToolCallBudget(jobState.request?.max_tool_calls);
      if (toolBudget.error) {
        markInterruptedBackgroundResponseFailed(store, responseId, claimedRecord, claimedResponse, backgroundJobValidationFailureReason(toolBudget.error));
        summary.reconciled += 1;
        continue;
      }
      markBackgroundRestart(store, responseId, "resumed_provider_call");
      startBackgroundJob({
        config,
        store,
        backgroundJobs,
        request: jobState.request,
        chat: jobState.chat,
        responseId,
        compatibility: jobState.compatibility || claimedResponse.metadata?.compatibility || {},
        incomingHeaders: {},
        previousMessages: jobState.previous_messages || [],
        fileSearchStore,
        imageGenerationStore,
        containerStore,
        conversationStore,
        conversation: jobState.conversation || null,
        toolBudget: toolBudget.value,
        skillStore,
        resumed: true,
        prepared: true,
        localOutputItems: jobState.local_output_items || [],
      });
      summary.resumed += 1;
      continue;
    }

    if (canResumePreparingBackgroundJob(jobState)) {
      const toolBudget = createResumedToolCallBudget(jobState.request?.max_tool_calls, jobState.prepare?.tool_budget);
      if (toolBudget.error) {
        markInterruptedBackgroundResponseFailed(store, responseId, claimedRecord, claimedResponse, backgroundJobValidationFailureReason(toolBudget.error));
        summary.reconciled += 1;
        continue;
      }
      markBackgroundRestart(store, responseId, "resumed_preparation");
      startBackgroundJob({
        config,
        store,
        backgroundJobs,
        request: jobState.request,
        chat: jobState.prepare.chat,
        responseId,
        compatibility: jobState.prepare.compatibility || jobState.compatibility || claimedResponse.metadata?.compatibility || {},
        incomingHeaders: {},
        previousMessages: jobState.previous_messages || [],
        fileSearchStore,
        imageGenerationStore,
        containerStore,
        conversationStore,
        conversation: jobState.conversation || null,
        toolBudget: toolBudget.value,
        skillStore,
        resumed: true,
        preparationState: jobState.prepare,
      });
      summary.resumed += 1;
      continue;
    }

    if (canResumeQueuedBackgroundJob(jobState)) {
      const toolBudget = createResumedToolCallBudget(jobState.request?.max_tool_calls);
      if (toolBudget.error) {
        markInterruptedBackgroundResponseFailed(store, responseId, claimedRecord, claimedResponse, backgroundJobValidationFailureReason(toolBudget.error));
        summary.reconciled += 1;
        continue;
      }
      markBackgroundRestart(store, responseId, "resumed_from_queue");
      startBackgroundJob({
        config,
        store,
        backgroundJobs,
        request: jobState.request,
        chat: jobState.chat,
        responseId,
        compatibility: jobState.compatibility || claimedResponse.metadata?.compatibility || {},
        incomingHeaders: {},
        previousMessages: jobState.previous_messages || [],
        fileSearchStore,
        imageGenerationStore,
        containerStore,
        conversationStore,
        conversation: jobState.conversation || null,
        toolBudget: toolBudget.value,
        skillStore,
        resumed: true,
      });
      summary.resumed += 1;
      continue;
    }

    markInterruptedBackgroundResponseFailed(store, responseId, claimedRecord, claimedResponse, restartFailureReason(jobState));
    summary.reconciled += 1;
  }
  return summary;
}

function createBackgroundLeaseOwner() {
  return `bridge-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeBackgroundLeaseTtlMs(config = {}) {
  const fallback = Math.max(15 * 60 * 1000, Number(config.requestTimeoutMs || 0) + 60 * 1000);
  const value = Number(config.backgroundLeaseTtlMs || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(5000, Math.min(Math.trunc(value), 2 * 60 * 60 * 1000));
}

function createBackgroundJobLease(owner, ttlMs, existing = null) {
  if (!owner) return null;
  const now = Date.now();
  const previousAcquiredAt = Number(existing?.acquired_at || 0);
  return {
    owner,
    token: crypto.randomBytes(12).toString("hex"),
    acquired_at: previousAcquiredAt > 0 && existing?.owner === owner ? previousAcquiredAt : now,
    renewed_at: now,
    expires_at: now + normalizeBackgroundLeaseTtlMs({ backgroundLeaseTtlMs: ttlMs }),
  };
}

function claimBackgroundJobLease(store, responseId, { owner, ttlMs } = {}) {
  const lock = acquireBackgroundJobClaimLock(store, responseId, ttlMs);
  if (!lock.acquired) return { claimed: false, reason: lock.reason || "claim_lock_active" };
  try {
    const record = store.get(responseId);
    const response = record?.response;
    if (!response || response.status !== "in_progress" || response.background !== true) {
      return { claimed: false, reason: "not_in_progress_background" };
    }
    const jobState = isPlainObject(record.background_job) ? record.background_job : null;
    if (!jobState) {
      return { claimed: true, record, response, jobState: null };
    }
    if (hasActiveForeignBackgroundLease(jobState.lease, owner)) {
      return { claimed: false, reason: "active_foreign_lease", record, response, jobState };
    }
    const lease = createBackgroundJobLease(owner, ttlMs, jobState.lease);
    const nextJobState = {
      ...jobState,
      lease,
      updated_at: Date.now(),
    };
    store.put(responseId, {
      ...record,
      background_job: nextJobState,
    });
    const claimedRecord = store.get(responseId);
    const claimedLease = claimedRecord?.background_job?.lease;
    if (!isPlainObject(claimedLease) || claimedLease.owner !== lease.owner || claimedLease.token !== lease.token) {
      return { claimed: false, reason: "lease_claim_lost", record: claimedRecord || record };
    }
    return {
      claimed: true,
      record: claimedRecord,
      response: claimedRecord.response,
      jobState: claimedRecord.background_job,
      lease,
    };
  } finally {
    lock.release?.();
  }
}

function hasActiveForeignBackgroundLease(lease, owner, now = Date.now()) {
  if (!isPlainObject(lease)) return false;
  const leaseOwner = typeof lease.owner === "string" ? lease.owner : "";
  const expiresAt = Number(lease.expires_at || 0);
  return !!leaseOwner && leaseOwner !== owner && Number.isFinite(expiresAt) && expiresAt > now;
}

function acquireBackgroundJobClaimLock(store, responseId, ttlMs) {
  const lockPath = backgroundJobClaimLockPath(store, responseId);
  if (!lockPath) {
    return { acquired: true, release: () => {} };
  }
  const staleMs = Math.max(5000, Math.min(normalizeBackgroundLeaseTtlMs({ backgroundLeaseTtlMs: ttlMs }), 30000));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd = null;
    let createdLock = false;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
      createdLock = true;
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: Date.now() }));
      } finally {
        fs.closeSync(fd);
        fd = null;
      }
      return {
        acquired: true,
        release: () => {
          try { fs.unlinkSync(lockPath); } catch {}
        },
      };
    } catch (error) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
      if (createdLock) {
        try { fs.unlinkSync(lockPath); } catch {}
      }
      if (error.code !== "EEXIST") return { acquired: false, reason: "claim_lock_error" };
      if (!removeStaleBackgroundJobClaimLock(lockPath, staleMs)) {
        return { acquired: false, reason: "claim_lock_active" };
      }
    }
  }
  return { acquired: false, reason: "claim_lock_active" };
}

function backgroundJobClaimLockPath(store, responseId) {
  if (typeof store?.filePath !== "function") return null;
  try {
    const filePath = store.filePath(responseId);
    return filePath ? `${filePath}.bgclaim.lock` : null;
  } catch {
    return null;
  }
}

function removeStaleBackgroundJobClaimLock(lockPath, staleMs) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs <= staleMs) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    return error.code === "ENOENT";
  }
}

function createResumedToolCallBudget(maxToolCalls, persistedBudget = null) {
  try {
    const budget = createToolCallBudget(maxToolCalls);
    if (!budget || !isPlainObject(persistedBudget)) return { value: budget };
    const used = Number(persistedBudget.used || 0);
    const skipped = Number(persistedBudget.skipped || 0);
    if (!Number.isInteger(used) || used < 0 || used > budget.limit) {
      const error = new Error("background job tool budget has invalid used count");
      error.code = "invalid_tool_budget";
      throw error;
    }
    if (!Number.isInteger(skipped) || skipped < 0) {
      const error = new Error("background job tool budget has invalid skipped count");
      error.code = "invalid_tool_budget";
      throw error;
    }
    budget.used = used;
    budget.skipped = skipped;
    budget.skipped_calls = Array.isArray(persistedBudget.skipped_calls)
      ? persistedBudget.skipped_calls.filter(isPlainObject).map(clone).slice(0, 20)
      : [];
    return { value: budget };
  } catch (error) {
    return { error };
  }
}

function cloneToolCallBudget(budget) {
  if (!budget) return null;
  return {
    limit: budget.limit,
    used: budget.used || 0,
    skipped: budget.skipped || 0,
    skipped_calls: Array.isArray(budget.skipped_calls)
      ? budget.skipped_calls.filter(isPlainObject).map(clone).slice(0, 20)
      : [],
  };
}

function backgroundJobValidationFailureReason(error) {
  const code = stringifyContent(error?.code || error?.message || "invalid_background_job").slice(0, 80);
  return `invalid_persistent_background_job_${code}`;
}

function canResumePreparedBackgroundJob(jobState) {
  return isPlainObject(jobState)
    && jobState.stage === "provider_pending"
    && jobState.mcp_ephemeral_context !== true
    && isPlainObject(jobState.request)
    && isPlainObject(jobState.chat)
    && Array.isArray(jobState.chat.messages);
}

function canResumePreparingBackgroundJob(jobState) {
  const prepare = jobState?.prepare;
  return isPlainObject(jobState)
    && jobState.stage === "preparing"
    && isPlainObject(jobState.request)
    && isPlainObject(prepare)
    && prepare.status === "ready"
    && Object.prototype.hasOwnProperty.call(prepare, "next_step")
    && validBackgroundPrepareStep(prepare.next_step)
    && isPlainObject(prepare.chat)
    && Array.isArray(prepare.chat.messages)
    && isPlainObject(prepare.compatibility);
}

function canResumeQueuedBackgroundJob(jobState) {
  return isPlainObject(jobState)
    && jobState.stage === "queued"
    && isPlainObject(jobState.request)
    && isPlainObject(jobState.chat)
    && Array.isArray(jobState.chat.messages);
}

function restartFailureReason(jobState) {
  if (!isPlainObject(jobState)) return "missing_persistent_background_job";
  if (jobState.stage === "preparing") {
    if (jobState.prepare?.status === "running") {
      return `interrupted_during_local_preparation_${stringifyContent(jobState.prepare.current_step || "unknown").slice(0, 80)}`;
    }
    return "interrupted_during_local_preparation";
  }
  if (jobState.stage === "provider_pending" && jobState.mcp_ephemeral_context === true) {
    return "interrupted_provider_pending_ephemeral_mcp_context";
  }
  return `unresumable_stage_${stringifyContent(jobState.stage || "unknown").slice(0, 80)}`;
}

function markBackgroundRestart(store, responseId, reason) {
  return updateStoredResponse(store, responseId, (response) => ({
    ...response,
    metadata: {
      ...(response.metadata || {}),
      compatibility: mergeCompatibility(response.metadata?.compatibility, {
        background_restart: reason,
      }),
    },
  }));
}

function markInterruptedBackgroundResponseFailed(store, responseId, record, response, reason) {
  const nextRecord = {
    ...record,
    response: {
      ...response,
      status: "failed",
      completed_at: nowSeconds(),
      error: {
        message: "background response was interrupted by bridge restart",
        type: "compatibility_bridge_error",
        code: "background_job_interrupted_by_restart",
        param: null,
      },
      metadata: {
        ...(response.metadata || {}),
        compatibility: mergeCompatibility(response.metadata?.compatibility, {
          background_restart: "marked_failed_on_startup",
          background_restart_reason: reason,
        }),
      },
    },
  };
  delete nextRecord.background_job;
  store.put(responseId, nextRecord);
}

function updateStoredResponse(store, responseId, updater) {
  const record = store.get(responseId);
  if (!record?.response) return null;
  if (record.response.status !== "in_progress") return record.response;
  const response = updater(clone(record.response));
  const nextRecord = {
    ...record,
    response,
  };
  if (response.status !== "in_progress") delete nextRecord.background_job;
  store.put(responseId, nextRecord);
  return response;
}

function applyLocalWebSearchToChat(chat, compatibility, localWebSearch, config) {
  injectWebSearchMessages(chat, localWebSearch);
  Object.assign(compatibility, webSearchCompatibility(localWebSearch));
  if (config.deepseekDisableThinkingForLocalWebSearch && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_web_search = {
      ...(compatibility.local_web_search || {}),
      deepseek_thinking: "disabled_for_local_web_search",
    };
  }
  return compatibility;
}

function applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config) {
  injectFileSearchMessages(chat, localFileSearch);
  Object.assign(compatibility, fileSearchCompatibility(localFileSearch));
  if (config.deepseekDisableThinkingForLocalFileSearch && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_file_search = {
      ...(compatibility.local_file_search || {}),
      deepseek_thinking: "disabled_for_local_file_search",
    };
  }
  return compatibility;
}

function applyLocalShellToChat(chat, compatibility, localShell, config) {
  injectShellMessages(chat, localShell);
  Object.assign(compatibility, shellCompatibility(localShell));
  if (config.deepseekDisableThinkingForLocalShell && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_shell = {
      ...(compatibility.local_shell || {}),
      deepseek_thinking: "disabled_for_local_shell",
    };
  }
  return compatibility;
}

function applyLocalComputerToChat(chat, compatibility, localComputer, config) {
  injectComputerMessages(chat, localComputer);
  injectComputerActionTool(chat, localComputer);
  mergeLocalComputerCompatibility(compatibility, computerCompatibility(localComputer));
  if (config.deepseekDisableThinkingForLocalComputer && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_computer = {
      ...(compatibility.local_computer || {}),
      deepseek_thinking: "disabled_for_local_computer",
    };
  }
  return compatibility;
}

function applyLocalMcpToChat(chat, compatibility, localMcp, config) {
  injectMcpMessages(chat, localMcp);
  Object.assign(compatibility, mcpCompatibility(localMcp));
  if (config.deepseekDisableThinkingForLocalMcp && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_mcp = {
      ...(compatibility.local_mcp || {}),
      deepseek_thinking: "disabled_for_local_mcp",
    };
  }
  return compatibility;
}

function applyLocalImageGenerationToChat(chat, compatibility, localImageGeneration, config) {
  injectImageGenerationMessages(chat, localImageGeneration);
  Object.assign(compatibility, imageGenerationCompatibility(localImageGeneration));
  if (config.deepseekDisableThinkingForLocalImageGeneration && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_image_generation = {
      ...(compatibility.local_image_generation || {}),
      deepseek_thinking: "disabled_for_local_image_generation",
    };
  }
  return compatibility;
}

function applyInputFilesToChat(chat, compatibility, localInputFiles, config = {}) {
  injectInputFileMessages(chat, localInputFiles);
  Object.assign(compatibility, inputFileCompatibility(localInputFiles));
  if (config.deepseekDisableThinkingForInputFiles && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_input_files = {
      ...(compatibility.local_input_files || {}),
      deepseek_thinking: "disabled_for_input_files",
    };
  }
  return compatibility;
}

function applyCompactionReplayToChat(chat, compatibility, request, config) {
  if (!hasCompactionInput(request.input)) return compatibility;
  if (config.deepseekDisableThinkingForCompaction && !config.deepseekThinkingMode) {
    chat.thinking = { type: "disabled" };
    compatibility.local_compaction = {
      ...(compatibility.local_compaction || {}),
      deepseek_thinking: "disabled_for_compaction_replay",
    };
  }
  return compatibility;
}

function applyLocalContextTruncation(chat, compatibility, request = {}, previousMessages = [], config = {}) {
  const maxChars = Number(config.truncationMaxInputChars || 0);
  if (!Number.isFinite(maxChars) || maxChars <= 0 || !Array.isArray(chat?.messages)) return null;

  const estimatedBefore = estimateChatMessagesChars(chat.messages);
  if (estimatedBefore <= maxChars) return null;

  const strategy = request.truncation ?? "disabled";
  if (strategy !== "auto") {
    return makeLocalTruncationError({
      strategy,
      maxChars,
      estimatedBefore,
      estimatedAfter: estimatedBefore,
      droppedMessageCount: 0,
      reason: "truncation_disabled",
    });
  }

  const replayMessages = new WeakSet((previousMessages || []).filter(isPlainObject));
  let estimatedAfter = estimatedBefore;
  let droppedMessageCount = 0;
  let droppedChars = 0;
  const droppedRoles = {};

  while (estimatedAfter > maxChars) {
    const dropIndex = chat.messages.findIndex((message) => isPlainObject(message) && replayMessages.has(message));
    if (dropIndex === -1) break;
    const [dropped] = chat.messages.splice(dropIndex, 1);
    const chars = estimateChatMessageChars(dropped);
    droppedMessageCount += 1;
    droppedChars += chars;
    const role = stringifyContent(dropped.role || "unknown").slice(0, 40) || "unknown";
    droppedRoles[role] = (droppedRoles[role] || 0) + 1;
    estimatedAfter = estimateChatMessagesChars(chat.messages);
  }

  const status = estimatedAfter <= maxChars ? "applied" : "failed";
  compatibility.local_truncation = {
    status,
    strategy: "auto",
    source: "local_char_budget",
    max_input_chars: maxChars,
    estimated_chars_before: estimatedBefore,
    estimated_chars_after: estimatedAfter,
    dropped_message_count: droppedMessageCount,
    dropped_chars: droppedChars,
    dropped_roles: droppedRoles,
    preserved_current_input: true,
  };

  if (status === "failed") {
    return makeLocalTruncationError({
      strategy,
      maxChars,
      estimatedBefore,
      estimatedAfter,
      droppedMessageCount,
      reason: droppedMessageCount ? "insufficient_replay_context" : "no_replay_context",
    });
  }
  return null;
}

function estimateChatMessagesChars(messages = []) {
  return (messages || []).reduce((sum, message) => sum + estimateChatMessageChars(message), 0);
}

function estimateChatMessageChars(message) {
  try {
    return JSON.stringify(message || {}).length;
  } catch {
    return stringifyContent(message).length;
  }
}

function makeLocalTruncationError(details = {}) {
  const maxChars = details.maxChars || 0;
  const estimatedAfter = details.estimatedAfter ?? details.estimatedBefore ?? 0;
  return {
    message: `input exceeds local context budget (${estimatedAfter}/${maxChars} estimated chars)`,
    type: "invalid_request_error",
    code: "context_length_exceeded",
    param: "truncation",
    details,
  };
}

function localTruncationErrorBody(error) {
  return {
    error: {
      message: error.message,
      type: error.type || "invalid_request_error",
      param: error.param || "truncation",
      code: error.code || "context_length_exceeded",
    },
  };
}

function sendLocalTruncationError(res, error) {
  sendJson(res, 400, localTruncationErrorBody(error));
}

function hasCompactionInput(value) {
  if (Array.isArray(value)) return value.some(hasCompactionInput);
  if (!value || typeof value !== "object") return false;
  if (value.type === "compaction") return true;
  return hasCompactionInput(value.content) || hasCompactionInput(value.input);
}

function attachLocalReasoningEncryptedContent(response, request, config, options = {}) {
  const requested = reasoningEncryptedContentRequested(request);
  if (!requested && !options.force) return null;
  const reasoningItems = Array.isArray(response?.output)
    ? response.output.filter((item) => item?.type === "reasoning")
    : [];
  let encryptedCount = 0;

  for (const item of reasoningItems) {
    if (typeof item.encrypted_content === "string" && item.encrypted_content) {
      encryptedCount += 1;
      continue;
    }
    const reasoning = reasoningOutputText(item);
    if (!reasoning) continue;
    item.encrypted_content = encryptLocalReasoning(reasoning, config);
    encryptedCount += 1;
  }

  if (!encryptedCount || (!requested && !options.reportMetadata)) return null;
  return {
    status: "emulated_locally",
    output_count: encryptedCount,
    source: "chat_reasoning_content",
  };
}

function reasoningEncryptedContentRequested(request = {}) {
  return Array.isArray(request.include) && request.include.includes("reasoning.encrypted_content");
}

function reasoningOutputText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.summary)) {
    return item.summary
      .map((part) => stringifyContent(part?.text ?? part?.summary_text ?? part))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function mergeCompatibility(...parts) {
  const merged = {};
  for (const part of parts) {
    if (part && typeof part === "object" && !Array.isArray(part)) {
      Object.assign(merged, part);
    }
  }
  return merged;
}

function conversationIdFromRequest(request = {}) {
  if (typeof request.conversation === "string") return request.conversation;
  if (isPlainObject(request.conversation) && typeof request.conversation.id === "string") return request.conversation.id;
  if (typeof request.conversation_id === "string") return request.conversation_id;
  return "";
}

function prepareConversationContext(request, conversationStore, config) {
  const id = conversationIdFromRequest(request);
  if (!id) return null;
  const items = conversationStore?.listItems(id);
  if (!items) return { id, missing: true, items: [], messages: [] };
  const replayRequest = {
    model: request.model || config.defaultModel,
    input: items,
    stream: false,
  };
  const { chat } = responsesToChatRequest(replayRequest, [], translatorOptions(config));
  return { id, items, messages: chat.messages };
}

function attachConversationToResponse(response, conversation) {
  if (!conversation?.id) return response;
  response.conversation = conversation.id;
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(response.metadata?.compatibility, {
      local_conversation: {
        id: conversation.id,
        replayed_item_count: conversation.items?.length || 0,
      },
    }),
  };
  return response;
}

function appendResponseToConversation(conversationStore, conversation, request, response) {
  if (!conversationStore || !conversation?.id || !response) return;
  const items = [
    ...conversationInputItems(request.input),
    ...conversationOutputItems(response.output),
  ];
  if (!items.length) return;
  conversationStore.appendItems(conversation.id, items);
}

function conversationInputItems(input) {
  return normalizeStoredInputItems(input).map((item) => {
    const cloned = clone(item);
    delete cloned.id;
    delete cloned.object;
    return cloned;
  });
}

function conversationOutputItems(output) {
  if (!Array.isArray(output)) return [];
  return output
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const cloned = clone(item);
      if (cloned.id) cloned.response_item_id = cloned.id;
      delete cloned.id;
      delete cloned.object;
      return cloned;
    });
}

async function handleResponseInputTokens(req, res, config, store, fileSearchStore, conversationStore) {
  const request = await readJson(req);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(request.previous_response_id ? store.getMessages(request.previous_response_id) : []),
  ];
  const localInputImages = prepareInputImageContext(request, config, fileSearchStore);
  const translatorRequest = localInputImages?.request || request;
  const { chat } = responsesToChatRequest(translatorRequest, previousMessages, translatorOptions(config));
  chat.model = chat.model || config.defaultModel;
  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) injectInputFileMessages(chat, localInputFiles);
  const truncationError = applyLocalContextTruncation(chat, {}, request, previousMessages, config);
  if (truncationError) {
    sendLocalTruncationError(res, truncationError);
    return;
  }
  chat.stream = false;
  delete chat.store;
  chat[config.maxTokensField || "max_tokens"] = 1;

  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
  const upstreamText = await upstream.text();
  const upstreamJson = parseJsonOrNull(upstreamText);

  if (!upstream.ok) {
    sendJson(res, upstream.status, upstreamJson || { error: { message: upstreamText } });
    return;
  }

  const inputTokens = upstreamJson?.usage?.prompt_tokens ?? upstreamJson?.usage?.input_tokens;
  if (!Number.isFinite(inputTokens)) {
    sendError(res, 502, "upstream provider did not return input token usage", {
      type: "upstream_provider_error",
      code: "missing_usage",
    });
    return;
  }

  sendJson(res, 200, {
    object: "response.input_tokens",
    input_tokens: inputTokens,
  });
}

async function handleResponseCompact(req, res, config, store, fileSearchStore, conversationStore) {
  const request = await readJson(req);
  const conversation = prepareConversationContext(request, conversationStore, config);
  if (conversation?.missing) {
    sendError(res, 404, `conversation not found: ${conversation.id}`, { code: "conversation_not_found", param: "conversation" });
    return;
  }
  const previousMessages = [
    ...(conversation?.messages || []),
    ...(request.previous_response_id ? store.getMessages(request.previous_response_id) : []),
  ];
  const localInputImages = prepareInputImageContext(request, config, fileSearchStore);
  const translatorRequest = localInputImages?.request || request;
  const { chat, compatibility } = responsesToChatRequest(translatorRequest, previousMessages, translatorOptions(config));
  Object.assign(compatibility, inputImageCompatibility(localInputImages));
  chat.model = chat.model || config.defaultModel;
  const localInputFiles = await prepareInputFileContext(request, config, fileSearchStore);
  if (localInputFiles) applyInputFilesToChat(chat, compatibility, localInputFiles, config);
  const truncationError = applyLocalContextTruncation(chat, compatibility, request, previousMessages, config);
  if (truncationError) {
    sendLocalTruncationError(res, truncationError);
    return;
  }

  const upstream = await fetchProvider(config, config.chatCompletionsPath, makeCompactionChatRequest(request, chat, config), req.headers);
  const upstreamText = await upstream.text();
  const upstreamJson = parseJsonOrNull(upstreamText);

  if (!upstream.ok) {
    sendJson(res, upstream.status, upstreamJson || { error: { message: upstreamText } });
    return;
  }

  const summary = extractChatCompletionText(upstreamJson).trim();
  if (!summary) {
    sendError(res, 502, "upstream provider did not return compaction content", {
      type: "upstream_provider_error",
      code: "missing_compaction",
    });
    return;
  }

  const response = createCompactionResource(request, upstreamJson, summary, config);
  attachConversationToResponse(response, conversation);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility: mergeCompatibility(response.metadata?.compatibility, compatibility),
    upstream_object: upstreamJson?.object || null,
  };
  if (request.store !== false) {
    store.put(response.id, {
      response,
      input_items: normalizeStoredInputItems(request.input),
      messages: [compactionSummaryMessage(summary)],
      compaction_summary: summary,
    });
  }

  sendJson(res, 200, response);
}

async function handleFileCreate(req, res, config, fileSearchStore) {
  const upload = await readFileCreateRequest(req, config);
  if (!upload.content) {
    sendError(res, 400, "file content is required", { code: "missing_file" });
    return;
  }
  const file = fileSearchStore.createFile(upload);
  sendJson(res, 200, file);
}

function handleFilesList(res, fileSearchStore, url) {
  sendJson(res, 200, fileSearchStore.listFiles({
    purpose: url.searchParams.get("purpose") || undefined,
    url,
  }));
}

function handleFileGet(res, fileSearchStore, fileId) {
  const file = fileSearchStore.getFile(fileId);
  if (!file) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleFileContent(res, fileSearchStore, fileId) {
  const file = fileSearchStore.getFile(fileId);
  const fallbackContent = fileSearchStore.getFileContent(fileId);
  const content = fileSearchStore.getFileContentBuffer?.(fileId)
    || (fallbackContent != null
      ? Buffer.from(fallbackContent, "utf8")
      : null);
  if (!file || content == null) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": file.mime_type || file.metadata?.mime_type || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(content);
}

function handleFileDelete(res, fileSearchStore, fileId) {
  const deleted = fileSearchStore.deleteFile(fileId);
  if (!deleted) {
    sendError(res, 404, `file not found: ${fileId}`, { code: "file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleUploadCreate(req, res, uploadStore) {
  const body = await readJson(req);
  sendJson(res, 200, uploadStore.createUpload(body));
}

async function handleUploadPartCreate(req, res, config, uploadStore, uploadId) {
  const content = await readUploadPartRequest(req, config);
  sendJson(res, 200, uploadStore.addPart(uploadId, content));
}

async function handleUploadComplete(req, res, uploadStore, fileSearchStore, uploadId) {
  const body = await readJson(req);
  sendJson(res, 200, uploadStore.completeUpload(uploadId, body, fileSearchStore));
}

function handleUploadCancel(res, uploadStore, uploadId) {
  sendJson(res, 200, uploadStore.cancelUpload(uploadId));
}

async function handleVectorStoreCreate(req, res, fileSearchStore) {
  const body = await readJson(req);
  sendJson(res, 200, fileSearchStore.createVectorStore(body));
}

function handleVectorStoresList(res, fileSearchStore, url) {
  sendJson(res, 200, fileSearchStore.listVectorStores({ url }));
}

function handleVectorStoreGet(res, fileSearchStore, storeId) {
  const store = fileSearchStore.getVectorStore(storeId);
  if (!store) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, store);
}

async function handleVectorStoreUpdate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const store = fileSearchStore.updateVectorStore(storeId, body);
  if (!store) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, store);
}

function handleVectorStoreDelete(res, fileSearchStore, storeId) {
  const deleted = fileSearchStore.deleteVectorStore(storeId);
  if (!deleted) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleVectorStoreFileCreate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const attached = fileSearchStore.attachFile(storeId, body);
  if (!attached) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

async function handleVectorStoreFileBatchCreate(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const batch = fileSearchStore.createVectorStoreFileBatch(storeId, body);
  if (!batch) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchGet(res, fileSearchStore, storeId, batchId) {
  const batch = fileSearchStore.getVectorStoreFileBatch(storeId, batchId);
  if (!batch) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchCancel(res, fileSearchStore, storeId, batchId) {
  const batch = fileSearchStore.cancelVectorStoreFileBatch(storeId, batchId);
  if (!batch) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, batch);
}

function handleVectorStoreFileBatchFilesList(res, fileSearchStore, storeId, batchId, url) {
  const page = fileSearchStore.listVectorStoreFileBatchFiles(storeId, batchId, { url });
  if (!page) {
    sendError(res, 404, `vector store file batch not found: ${batchId}`, { code: "vector_store_file_batch_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleVectorStoreFilesList(res, fileSearchStore, storeId, url) {
  const page = fileSearchStore.listVectorStoreFiles(storeId, { url });
  if (!page) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleVectorStoreFileGet(res, fileSearchStore, storeId, fileId) {
  const attached = fileSearchStore.getVectorStoreFile(storeId, fileId);
  if (!attached) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

async function handleVectorStoreFileUpdate(req, res, fileSearchStore, storeId, fileId) {
  const body = await readJson(req);
  const attached = fileSearchStore.updateVectorStoreFile(storeId, fileId, body);
  if (!attached) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, attached);
}

function handleVectorStoreFileContent(res, fileSearchStore, storeId, fileId) {
  const content = fileSearchStore.getVectorStoreFileContent(storeId, fileId);
  if (!content) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, content);
}

function handleVectorStoreFileDelete(res, fileSearchStore, storeId, fileId) {
  const deleted = fileSearchStore.deleteVectorStoreFile(storeId, fileId);
  if (!deleted) {
    sendError(res, 404, `vector store file not found: ${fileId}`, { code: "vector_store_file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleVectorStoreSearch(req, res, fileSearchStore, storeId) {
  const body = await readJson(req);
  const page = fileSearchStore.searchVectorStore(storeId, body);
  if (!page) {
    sendError(res, 404, `vector store not found: ${storeId}`, { code: "vector_store_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

async function handleSkillCreate(req, res, config, skillStore) {
  const upload = await readSkillCreateRequest(req, config);
  sendJson(res, 200, skillStore.createSkill(upload));
}

function handleSkillsList(res, skillStore, url) {
  sendJson(res, 200, skillStore.listSkills({ url }));
}

function handleSkillGet(res, skillStore, skillId) {
  const skill = skillStore.getSkill(skillId);
  if (!skill) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, skill);
}

async function handleSkillUpdate(req, res, skillStore, skillId) {
  const body = await readJson(req);
  const skill = skillStore.updateSkill(skillId, body);
  if (!skill) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, skill);
}

function handleSkillDelete(res, skillStore, skillId) {
  const deleted = skillStore.deleteSkill(skillId);
  if (!deleted) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleSkillVersionCreate(req, res, config, skillStore, skillId) {
  const upload = await readSkillCreateRequest(req, config);
  const version = skillStore.createSkillVersion(skillId, upload);
  if (!version) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, version);
}

function handleSkillVersionsList(res, skillStore, skillId, url) {
  const page = skillStore.listSkillVersions(skillId, { url });
  if (!page) {
    sendError(res, 404, `skill not found: ${skillId}`, { code: "skill_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleSkillVersionGet(res, skillStore, skillId, version) {
  const resource = skillStore.getSkillVersion(skillId, version);
  if (!resource) {
    sendError(res, 404, `skill version not found: ${version}`, { code: "skill_version_not_found" });
    return;
  }
  sendJson(res, 200, resource);
}

function handleSkillVersionDelete(res, skillStore, skillId, version) {
  const deleted = skillStore.deleteSkillVersion(skillId, version);
  if (!deleted) {
    sendError(res, 404, `skill version not found: ${version}`, { code: "skill_version_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

function handleSkillContent(res, skillStore, skillId, version) {
  const content = skillStore.getSkillContentZip(skillId, version);
  if (!content) {
    sendError(res, 404, `skill content not found: ${skillId}`, { code: "skill_content_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "application/zip",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${content.skill.name}-v${content.version.version}.zip"`,
    "x-skill-id": content.skill.id,
    "x-skill-version": String(content.version.version),
  });
  res.end(content.content);
}

async function handleContainerCreate(req, res, containerStore) {
  const body = await readJson(req);
  sendJson(res, 200, containerStore.createContainer(body));
}

function handleContainersList(res, containerStore, url) {
  sendJson(res, 200, containerStore.listContainers({
    name: url.searchParams.get("name") || undefined,
    url,
  }));
}

function handleContainerGet(res, containerStore, containerId) {
  const container = containerStore.getContainer(containerId);
  if (!container) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, container);
}

function handleContainerDelete(res, containerStore, containerId) {
  const deleted = containerStore.deleteContainer(containerId);
  if (!deleted) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleContainerFileCreate(req, res, config, containerStore, containerId) {
  const upload = await readContainerFileCreateRequest(req, config);
  const file = containerStore.createContainerFile(containerId, upload);
  if (!file) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleContainerFilesList(res, containerStore, containerId, url) {
  const page = containerStore.listContainerFiles(containerId, { url });
  if (!page) {
    sendError(res, 404, `container not found: ${containerId}`, { code: "container_not_found" });
    return;
  }
  sendJson(res, 200, page);
}

function handleContainerFileGet(res, containerStore, containerId, fileId) {
  const file = containerStore.getContainerFile(containerId, fileId);
  if (!file) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  sendJson(res, 200, file);
}

function handleContainerFileContent(res, containerStore, containerId, fileId) {
  const file = containerStore.getContainerFile(containerId, fileId);
  const content = file ? containerStore.getContainerFileContent(containerId, fileId) : null;
  if (content == null) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
    "x-container-file-path": file.path,
  });
  res.end(content);
}

function handleContainerFileDelete(res, containerStore, containerId, fileId) {
  const deleted = containerStore.deleteContainerFile(containerId, fileId);
  if (!deleted) {
    sendError(res, 404, `container file not found: ${fileId}`, { code: "container_file_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function readSkillCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    return readJson(req);
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, config.skillMaxUploadBytes), contentType);
    return {
      name: form.fields.name,
      description: form.fields.description,
      metadata: parseJsonOrNull(form.fields.metadata) || {},
      files: form.files.map((file, index) => ({
        path: file.filename || file.name || (index === 0 ? "SKILL.md" : `file-${index}.txt`),
        content: file.content,
      })),
    };
  }

  const body = await readRawBody(req, config.skillMaxUploadBytes);
  return {
    name: req.headers["x-skill-name"],
    description: req.headers["x-skill-description"],
    files: [{
      path: req.headers["x-filename"] || "SKILL.md",
      content: body,
    }],
  };
}

async function readContainerFileCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    const body = await readJson(req);
    return {
      filename: body.filename || body.path || "upload.txt",
      path: body.path,
      content: body.content || "",
    };
  }

  const body = await readRawBody(req, config.shellMaxFileBytes);
  return {
    filename: req.headers["x-filename"] || "upload.txt",
    path: req.headers["x-path"] || req.headers["x-filename"] || "upload.txt",
    content: body,
  };
}

async function readFileCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("application/json")) {
    const body = await readJson(req);
    const content = typeof body.content_base64 === "string"
      ? decodeBase64Payload(body.content_base64)
      : body.content || "";
    return {
      filename: body.filename || "upload.txt",
      purpose: body.purpose || "assistants",
      content,
      metadata: body.metadata || {},
      mime_type: body.mime_type || body.mimeType,
    };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, config.fileSearchMaxFileBytes + 1024 * 1024), contentType);
    const file = form.files.find((item) => item.name === "file") || form.files[0];
    return {
      filename: file?.filename || form.fields.filename || "upload.txt",
      purpose: form.fields.purpose || "assistants",
      content: file?.content || form.fields.content || "",
      metadata: parseJsonOrNull(form.fields.metadata) || {},
      mime_type: form.fields.mime_type || file?.content_type,
    };
  }

  const body = await readRawBody(req, config.fileSearchMaxFileBytes);
  return {
    filename: req.headers["x-filename"] || "upload.txt",
    purpose: req.headers["x-purpose"] || "assistants",
    content: body,
    mime_type: req.headers["content-type"],
  };
}

async function readUploadPartRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  const maxPartBytes = config.uploadMaxPartBytes || OFFICIAL_UPLOAD_PART_MAX_BYTES;
  const maxBodyBytes = Math.ceil(maxPartBytes * 4 / 3) + 1024 * 1024;
  if (contentType.includes("application/json")) {
    const raw = await readRawBody(req, maxBodyBytes);
    const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    if (typeof body.data_base64 === "string") return decodeBase64Payload(body.data_base64);
    if (typeof body.data === "string") return Buffer.from(body.data, "utf8");
    if (typeof body.content === "string") return Buffer.from(body.content, "utf8");
    return Buffer.alloc(0);
  }

  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(await readRawBody(req, maxBodyBytes), contentType);
    const file = form.files.find((item) => item.name === "data") || form.files[0];
    if (file) return file.content;
    if (typeof form.fields.data === "string") return Buffer.from(form.fields.data, "utf8");
    return Buffer.alloc(0);
  }

  return readRawBody(req, maxPartBytes);
}

function decodeBase64Payload(value) {
  const raw = String(value || "");
  const dataUrl = raw.match(/^data:[^,]*;base64,(.*)$/s);
  return Buffer.from(dataUrl ? dataUrl[1] : raw, "base64");
}

function parseMultipartForm(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    const error = new Error("multipart boundary is required");
    error.status = 400;
    throw error;
  }

  const body = buffer.toString("utf8");
  const parts = body.split(`--${boundary}`).slice(1, -1);
  const fields = {};
  const files = [];
  for (const rawPart of parts) {
    const part = rawPart.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const separator = part.indexOf("\r\n\r\n");
    const fallbackSeparator = part.indexOf("\n\n");
    const index = separator !== -1 ? separator : fallbackSeparator;
    if (index === -1) continue;
    const rawHeaders = part.slice(0, index);
    const content = part.slice(index + (separator !== -1 ? 4 : 2)).replace(/\r?\n$/, "");
    const disposition = rawHeaders.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line)) || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    if (filename != null) files.push({ name, filename, content });
    else fields[name] = content;
  }
  return { fields, files };
}

function parseMultipartFormBinary(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    const error = new Error("multipart boundary is required");
    error.status = 400;
    throw error;
  }

  const marker = Buffer.from(`--${boundary}`);
  const crlfMarker = Buffer.from(`\r\n--${boundary}`);
  const lfMarker = Buffer.from(`\n--${boundary}`);
  const fields = {};
  const files = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    let start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    start += marker.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    else if (buffer[start] === 10) start += 1;

    let next = buffer.indexOf(crlfMarker, start);
    if (next === -1) next = buffer.indexOf(lfMarker, start);
    if (next === -1) break;
    const part = buffer.subarray(start, next);
    cursor = next + 1;

    let separator = part.indexOf(Buffer.from("\r\n\r\n"));
    let separatorLength = 4;
    if (separator === -1) {
      separator = part.indexOf(Buffer.from("\n\n"));
      separatorLength = 2;
    }
    if (separator === -1) continue;

    const rawHeaders = part.subarray(0, separator).toString("utf8");
    const content = part.subarray(separator + separatorLength);
    const disposition = rawHeaders.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line)) || "";
    const partContentType = rawHeaders.split(/\r?\n/).find((line) => /^content-type:/i.test(line)) || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const contentTypeHeader = partContentType.replace(/^content-type:\s*/i, "").trim();
    if (!name) continue;
    if (filename != null) files.push({ name, filename, content, content_type: contentTypeHeader || undefined });
    else fields[name] = content.toString("utf8");
  }

  return { fields, files };
}

function makeCompactionChatRequest(request, chat, config) {
  const maxTokensField = config.maxTokensField || "max_tokens";
  const compactChat = {
    model: chat.model || request.model || config.defaultModel,
    stream: false,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You compact long-running agent conversations for continuation.",
          "Write a concise but complete state summary preserving durable facts, user requirements, unresolved tasks, tool results, file paths, constraints, and next actions.",
          "Do not invent facts. Prefer bullet-like plain text. Include exact IDs, filenames, commands, and code words when present.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Compact this conversation state for a future turn:\n\n${serializeChatMessages(chat.messages)}`,
      },
    ],
  };
  compactChat[maxTokensField] = request.max_output_tokens || config.compactionMaxOutputTokens;
  if (config.deepseekDisableThinkingForCompaction && !config.deepseekThinkingMode) {
    compactChat.thinking = { type: "disabled" };
  }
  return compactChat;
}

function createCompactionResource(request, upstreamJson, summary, config) {
  return {
    id: prefixedId("resp"),
    object: "response.compaction",
    created_at: upstreamJson?.created || nowSeconds(),
    output: [
      ...normalizeStoredInputItems(request.input),
      {
        id: prefixedId("cmp"),
        type: "compaction",
        encrypted_content: encryptLocalCompaction(summary, config),
      },
    ],
    usage: mapUsage(upstreamJson?.usage),
  };
}

function compactionSummaryMessage(summary) {
  return {
    role: "system",
    content: `Compacted conversation context:\n${summary}`,
  };
}

function serializeChatMessages(messages) {
  return (messages || [])
    .map((message, index) => {
      const lines = [`[${index + 1}] role=${message.role || "unknown"}`];
      if (message.name) lines.push(`name=${message.name}`);
      if (message.tool_call_id) lines.push(`tool_call_id=${message.tool_call_id}`);
      if (message.content != null) lines.push(`content=${stringifyContent(message.content)}`);
      if (message.reasoning_content) lines.push(`reasoning=${stringifyContent(message.reasoning_content)}`);
      if (message.tool_calls) lines.push(`tool_calls=${JSON.stringify(message.tool_calls)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function extractChatCompletionText(chat) {
  return (chat?.choices || [])
    .map((choice) => choice.message?.content || "")
    .map((content) => Array.isArray(content) ? content.map((part) => stringifyContent(part.text ?? part.content ?? part)).join("") : stringifyContent(content))
    .join("\n")
    .trim();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function encryptLocalCompaction(summary, config) {
  const key = getCompactionKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("open-codex-compaction-v1"));
  const plaintext = Buffer.from(JSON.stringify({
    summary,
    created_at: nowSeconds(),
    source: "open-codex-responses-bridge",
  }));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `occomp1.${base64url(iv)}.${base64url(tag)}.${base64url(encrypted)}`;
}

function encryptLocalReasoning(reasoning, config) {
  const key = getCompactionKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("open-codex-reasoning-v1"));
  const plaintext = Buffer.from(JSON.stringify({
    reasoning,
    created_at: nowSeconds(),
    source: "open-codex-responses-bridge",
  }));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `ocrsn1.${base64url(iv)}.${base64url(tag)}.${base64url(encrypted)}`;
}

function decodeLocalCompaction(encryptedContent, config) {
  const value = String(encryptedContent || "");
  if (!value.startsWith("occomp1.")) return "";
  const parts = value.split(".");
  if (parts.length !== 4) return "";
  try {
    const [, iv, tag, encrypted] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getCompactionKey(config), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from("open-codex-compaction-v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    return typeof payload.summary === "string" ? payload.summary : "";
  } catch {
    return "";
  }
}

function decodeLocalReasoning(encryptedContent, config) {
  const value = String(encryptedContent || "");
  if (!value.startsWith("ocrsn1.")) return "";
  const parts = value.split(".");
  if (parts.length !== 4) return "";
  try {
    const [, iv, tag, encrypted] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getCompactionKey(config), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from("open-codex-reasoning-v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    return typeof payload.reasoning === "string" ? payload.reasoning : "";
  } catch {
    return "";
  }
}

function getCompactionKey(config) {
  if (config.compactionSecret) return crypto.createHash("sha256").update(String(config.compactionSecret)).digest();
  const filePath = path.resolve(config.compactionSecretFile || path.join(config.stateDir, "compaction.key"));
  try {
    const existing = Buffer.from(fs.readFileSync(filePath, "utf8").trim(), "base64");
    if (existing.length === 32) return existing;
  } catch {
    // Generate below when the key file is absent or unreadable.
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${key.toString("base64")}\n`, { mode: 0o600 });
  return key;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

async function handleStreamingResponse(req, res, config, store, request, chat, previousMessages, responseId, compatibility, localWebSearch = null, localFileSearch = null, localShell = null, localComputer = null, localImageGeneration = null, localMcp = null, conversationStore = null, conversation = null, toolBudget = null) {
  const response = createResponseSkeleton(request, { id: responseId, model: chat.model });
  attachConversationToResponse(response, conversation);
  const state = createStreamState(response, compatibility);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });

  writeSse(res, "response.created", sequence(state, { type: "response.created", response: clone(response) }));
  writeSse(res, "response.in_progress", sequence(state, { type: "response.in_progress", response: clone(response) }));
  emitShellStreamItems(res, state, localShell);
  emitComputerStreamItems(res, state, localComputer);
  emitMcpStreamItems(res, state, localMcp);
  emitImageGenerationStreamItems(res, state, localImageGeneration);
  emitWebSearchStreamItems(res, state, localWebSearch);
  emitFileSearchStreamItems(res, state, localFileSearch);

  try {
    if (canRunStreamingLocalToolLoop(localMcp, localComputer, config)) {
      const localToolStreamResult = await streamProviderWithLocalToolLoop(res, state, config, chat, req.headers, {
        localMcp,
        localComputer,
        toolBudget,
      });
      if (!localToolStreamResult.ok) {
        emitError(res, state, localToolStreamResult.text || localToolStreamResult.json?.error?.message || "upstream provider request failed", localToolStreamResult.status);
        res.end();
        return;
      }
    } else {
      const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
      if (!upstream.ok) {
        const text = await upstream.text();
        emitError(res, state, text, upstream.status);
        res.end();
        return;
      }

      for await (const payload of iterateSseJson(upstream.body)) {
        if (payload === "[DONE]") break;
        const events = applyChatStreamChunk(state, payload);
        for (const event of events) writeSse(res, event.type, sequence(state, event));
      }
    }

    annotateWebSearchResponse(response, localWebSearch);
    annotateFileSearchResponse(response, localFileSearch);
    mergeLocalComputerCompatibility(compatibility, computerCompatibility(localComputer));
    mergeLocalMcpCompatibility(compatibility, mcpCompatibility(localMcp));
    Object.assign(compatibility, toolBudgetCompatibility(toolBudget));
    syncStreamTextFromResponse(state);
    const localReasoningEncryptedContent = attachLocalReasoningEncryptedContent(response, request, config);
    const doneEvents = finishStreamState(state);
    for (const event of doneEvents) writeSse(res, event.type, sequence(state, event));
    const terminal = responseTerminalStateFromFinishReasons(state.finishReasons);
    response.status = terminal.status;
    response.completed_at = terminal.completed_at;
    response.incomplete_details = terminal.incomplete_details;
    response.error = terminal.error;
    response.service_tier = state.serviceTier;
    response.usage = state.usage;
    const refusalLogprobs = streamRefusalLogprobs(state);
    const localModeration = attachLocalResponseInlineModeration(response, request, config);
    response.metadata = {
      ...(response.metadata || {}),
      compatibility: mergeCompatibility(
        compatibility,
        {
          ...state.chatCompatibility,
          ...streamChoiceCompatibilityMetadata(state),
          ...chatUsageCompatibilityMetadata(state.chatUsage),
        },
        {
          ...(refusalLogprobs.length ? { chat_refusal_logprobs: refusalLogprobs } : {}),
          ...(localReasoningEncryptedContent ? { local_reasoning_encrypted_content: localReasoningEncryptedContent } : {}),
          ...(localModeration ? { local_moderation: localModeration } : {}),
        },
      ),
      upstream_object: "chat.completion.chunk",
    };
    const terminalEvent = terminalEventForResponseStatus(response.status);
    writeSse(res, terminalEvent, sequence(state, { type: terminalEvent, response: clone(response) }));

    if (request.store !== false) {
      const storedResponse = responseWithFullLocalOutputs(response, {
        request,
        config,
        localShell,
        localWebSearch,
        localFileSearch,
        localImageGeneration,
      });
      store.put(response.id, {
        response: storedResponse,
        input_items: normalizeStoredInputItems(request.input),
        messages: [
          ...chat.messages,
          ...streamStateToReplayMessages(state),
        ],
      });
    }
    appendResponseToConversation(conversationStore, conversation, request, response);
  } catch (error) {
    emitError(res, state, error.message, 500);
  } finally {
    res.end();
  }
}

function canRunStreamingMcpToolLoop(localMcp, config = {}) {
  return config.mcpRemoteToolCalls !== false
    && !!localMcp?.chat_tool_map
    && typeof localMcp.chat_tool_map.size === "number"
    && localMcp.chat_tool_map.size > 0;
}

function canRunStreamingComputerActionLoop(localComputer) {
  return !!localComputer?.chat_action_tool_name;
}

function canRunStreamingLocalToolLoop(localMcp, localComputer, config = {}) {
  return canRunStreamingComputerActionLoop(localComputer)
    || canRunStreamingMcpToolLoop(localMcp, config);
}

async function streamProviderWithLocalToolLoop(res, state, config, chat, incomingHeaders, contexts = {}) {
  const { localMcp = null, localComputer = null, toolBudget = null } = contexts;
  const usageParts = [];
  const maxRounds = Math.max(1, Math.min(5, Number(config.mcpMaxCallRounds || 1)));

  for (let round = 0; round <= maxRounds; round += 1) {
    const current = await collectProviderStreamCompletion(config, chat, incomingHeaders);
    if (!current.ok) return current;
    if (current.completion?.usage) usageParts.push(current.completion.usage);

    const computerExecution = executeComputerChatToolCalls(localComputer, current.completion, config, { toolBudget });
    if (computerExecution.executed) {
      emitComputerExecutionStreamItems(res, state, computerExecution.output_items || []);
      applyCombinedStreamUsage(state, usageParts);
      return { ok: true };
    }

    const execution = round < maxRounds
      && canRunStreamingMcpToolLoop(localMcp, config)
      ? await executeMcpChatToolCalls(localMcp, current.completion, config, { toolBudget })
      : { executed: false };
    if (!execution.executed) {
      replayBufferedChatStreamEvents(res, state, current.payloads);
      applyCombinedStreamUsage(state, usageParts);
      return { ok: true };
    }

    emitMcpExecutionStreamItems(res, state, execution.output_items || []);
    if (execution.approval_requested) {
      applyCombinedStreamUsage(state, usageParts);
      return { ok: true };
    }

    chat.messages.push(...(execution.messages || []));
    if (round + 1 >= maxRounds) chat.tool_choice = "none";
  }

  applyCombinedStreamUsage(state, usageParts);
  return { ok: true };
}

async function collectProviderStreamCompletion(config, chat, incomingHeaders) {
  const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, incomingHeaders);
  if (!upstream.ok) {
    const text = await upstream.text();
    return {
      ok: false,
      status: upstream.status,
      text,
      json: parseJsonOrNull(text),
    };
  }

  const accumulator = createChatStreamAccumulator(chat);
  const payloads = [];
  for await (const payload of iterateSseJson(upstream.body)) {
    if (payload === "[DONE]") break;
    payloads.push(payload);
    applyChatCompletionStreamChunk(accumulator, payload);
  }

  return {
    ok: true,
    status: upstream.status,
    payloads,
    completion: finalizeChatStreamCompletion(accumulator),
  };
}

function replayBufferedChatStreamEvents(res, state, payloads = []) {
  for (const payload of payloads) {
    const events = applyChatStreamChunk(state, payload);
    for (const event of events) writeSse(res, event.type, sequence(state, event));
  }
}

function applyCombinedStreamUsage(state, usageParts = []) {
  const usable = usageParts.filter(isPlainObject);
  if (!usable.length) return;
  const usage = usable.length > 1 ? combineChatUsage(usable) : clone(usable[0]);
  state.chatUsage = usage;
  state.usage = mapUsage(usage);
}

function emitMcpExecutionStreamItems(res, state, items = []) {
  for (const rawItem of items) {
    const item = clone(rawItem);
    state.response.output.push(item);
    const outputIndex = state.response.output.length - 1;
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: outputIndex,
      item: clone(item),
    }));
    if (item.type !== "mcp_call") continue;
    if (item.arguments) {
      writeSse(res, "response.mcp_call_arguments.delta", sequence(state, {
        type: "response.mcp_call_arguments.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        delta: item.arguments,
      }));
      writeSse(res, "response.mcp_call_arguments.done", sequence(state, {
        type: "response.mcp_call_arguments.done",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      }));
    }
    writeSse(res, "response.mcp_call.in_progress", sequence(state, {
      type: "response.mcp_call.in_progress",
      response_id: state.response.id,
      item_id: item.id,
      output_index: outputIndex,
    }));
    if (item.error) {
      writeSse(res, "response.mcp_call.failed", sequence(state, {
        type: "response.mcp_call.failed",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        error: clone(item.error),
      }));
    }
  }
}

function emitComputerExecutionStreamItems(res, state, items = []) {
  for (const item of items) emitComputerStreamItem(res, state, item);
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emitError(res, state, message, status) {
  writeSse(res, "error", sequence(state, {
    type: "error",
    code: status || 500,
    message: stringifyContent(message),
  }));
}

function createStreamState(response, compatibility) {
  return {
    response,
    compatibility,
    sequenceNumber: 0,
    choices: new Map(),
    finishReasons: [],
    outputDone: new Set(),
    serviceTier: response.service_tier,
    chatCompatibility: {},
    chatUsage: undefined,
    usage: null,
  };
}

function getChoiceStreamState(state, choiceIndex = 0) {
  const index = choiceIndex ?? 0;
  if (!state.choices.has(index)) {
    state.choices.set(index, {
      index,
      finishReason: null,
      hasFinishReason: false,
      messageItem: null,
      text: "",
      reasoningItem: null,
      reasoningText: "",
      outputTextLogprobs: [],
      outputTextAnnotations: [],
      outputRefusalLogprobs: [],
      refusalText: "",
      audio: null,
      audioPart: null,
      toolCalls: new Map(),
    });
  }
  return state.choices.get(index);
}

function terminalEventForResponseStatus(status) {
  if (status === "failed") return "response.failed";
  if (status === "incomplete") return "response.incomplete";
  return "response.completed";
}

function sequence(state, event) {
  state.sequenceNumber += 1;
  return { sequence_number: state.sequenceNumber, ...event };
}

function emitWebSearchStreamItems(res, state, context) {
  for (const item of webSearchOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitFileSearchStreamItems(res, state, context) {
  for (const item of fileSearchOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitShellStreamItems(res, state, context) {
  for (const item of shellOutputItems(context)) {
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitComputerStreamItems(res, state, context) {
  for (const item of computerOutputItems(context)) {
    emitComputerStreamItem(res, state, item);
  }
}

function emitComputerStreamItem(res, state, rawItem) {
  const item = clone(rawItem);
  state.response.output.push(item);
  writeSse(res, "response.output_item.added", sequence(state, {
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }));
}

function emitMcpStreamItems(res, state, context) {
  for (const item of mcpOutputItems(context)) {
    if (item.type === "mcp_call") {
      emitMcpExecutionStreamItems(res, state, [item]);
      continue;
    }
    state.response.output.push(item);
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: state.response.output.length - 1,
      item: clone(item),
    }));
  }
}

function emitImageGenerationStreamItems(res, state, context) {
  const partialsByItemId = new Map();
  for (const partial of imageGenerationPartialImages(context)) {
    if (!partialsByItemId.has(partial.item_id)) partialsByItemId.set(partial.item_id, []);
    partialsByItemId.get(partial.item_id).push(partial);
  }

  for (const item of imageGenerationOutputItems(context)) {
    state.response.output.push(item);
    const outputIndex = state.response.output.length - 1;
    writeSse(res, "response.output_item.added", sequence(state, {
      type: "response.output_item.added",
      response_id: state.response.id,
      output_index: outputIndex,
      item: clone(item),
    }));

    for (const partial of partialsByItemId.get(item.id) || []) {
      writeSse(res, "response.image_generation_call.partial_image", sequence(state, {
        type: "response.image_generation_call.partial_image",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        partial_image_index: partial.partial_image_index,
        partial_image_b64: partial.partial_image_b64,
      }));
    }
  }
}

function syncStreamTextFromResponse(state) {
  for (const choiceState of state.choices.values()) {
    const textPart = choiceState.messageItem?.content?.find((part) => part.type === "output_text");
    if (typeof textPart?.text === "string") choiceState.text = textPart.text;
    if (choiceState.outputTextLogprobs.length && textPart) {
      textPart.logprobs = clone(choiceState.outputTextLogprobs);
    }
    if (choiceState.outputTextAnnotations.length && textPart) {
      textPart.annotations = clone(choiceState.outputTextAnnotations);
    }
  }
}

function ensureMessageItem(state, choiceState) {
  if (choiceState.messageItem) return [];
  const item = {
    id: prefixedId("msg"),
    type: "message",
    status: "in_progress",
    role: "assistant",
    content: [],
  };
  choiceState.messageItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureTextPart(state, choiceState) {
  const events = ensureMessageItem(state, choiceState);
  if (choiceState.messageItem.content.some((part) => part.type === "output_text")) return events;
  const part = { type: "output_text", text: "", annotations: [] };
  choiceState.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: choiceState.messageItem.id,
    output_index: state.response.output.indexOf(choiceState.messageItem),
    content_index: 0,
    part: clone(part),
  });
  return events;
}

function ensureRefusalPart(state, choiceState) {
  const events = ensureMessageItem(state, choiceState);
  if (choiceState.messageItem.content.some((part) => part.type === "refusal")) return events;
  const part = { type: "refusal", refusal: "" };
  choiceState.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: choiceState.messageItem.id,
    output_index: state.response.output.indexOf(choiceState.messageItem),
    content_index: choiceState.messageItem.content.indexOf(part),
    part: clone(part),
  });
  return events;
}

function ensureAudioPart(state, choiceState) {
  const events = ensureMessageItem(state, choiceState);
  if (choiceState.audioPart) return events;
  const part = { type: "output_audio" };
  choiceState.audioPart = part;
  choiceState.messageItem.content.push(part);
  events.push({
    type: "response.content_part.added",
    response_id: state.response.id,
    item_id: choiceState.messageItem.id,
    output_index: state.response.output.indexOf(choiceState.messageItem),
    content_index: choiceState.messageItem.content.indexOf(part),
    part: clone(part),
  });
  return events;
}

function ensureReasoningItem(state, choiceState) {
  if (choiceState.reasoningItem) return [];
  const item = {
    id: prefixedId("rs"),
    type: "reasoning",
    status: "in_progress",
    summary: [{ type: "summary_text", text: "" }],
  };
  choiceState.reasoningItem = item;
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function ensureToolCallItem(state, choiceState, index, deltaToolCall) {
  if (choiceState.toolCalls.has(index)) return [];
  const callId = deltaToolCall.id || prefixedId("call");
  const item = {
    id: prefixedId("fc"),
    type: "function_call",
    call_id: callId,
    name: "",
    arguments: "",
    status: "in_progress",
  };
  choiceState.toolCalls.set(index, item);
  state.response.output.push(item);
  return [{
    type: "response.output_item.added",
    response_id: state.response.id,
    output_index: state.response.output.length - 1,
    item: clone(item),
  }];
}

function applyChatStreamChunk(state, chunk) {
  const events = [];
  if (chunk.usage) {
    state.chatUsage = chunk.usage;
    state.usage = mapUsage(chunk.usage);
  }
  if (chunk.service_tier != null) state.serviceTier = chunk.service_tier;
  Object.assign(state.chatCompatibility, chatCompatibilityMetadata(chunk));

  for (const choice of chunk.choices || []) {
    const choiceState = getChoiceStreamState(state, choice.index);
    if (Object.prototype.hasOwnProperty.call(choice, "finish_reason")) {
      choiceState.finishReason = choice.finish_reason;
      choiceState.hasFinishReason = true;
    }
    if (choice.finish_reason) state.finishReasons.push(choice.finish_reason);
    const delta = choice.delta || {};

    if (delta.reasoning_content) {
      events.push(...ensureReasoningItem(state, choiceState));
      const item = choiceState.reasoningItem;
      const outputIndex = state.response.output.indexOf(item);
      item.summary[0].text += delta.reasoning_content;
      choiceState.reasoningText += delta.reasoning_content;
      events.push({
        type: "response.reasoning_summary_text.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        delta: delta.reasoning_content,
      });
    }

    if (delta.content) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const outputIndex = state.response.output.indexOf(item);
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      item.content[contentIndex].text += delta.content;
      choiceState.text += delta.content;
      events.push({
        type: "response.output_text.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: delta.content,
      });
    }

    const annotations = [
      ...normalizeStreamAnnotations(delta.annotations),
      ...normalizeStreamAnnotations(choice.annotations),
    ];
    if (annotations.length) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      choiceState.outputTextAnnotations.push(...annotations);
      item.content[contentIndex].annotations = clone(choiceState.outputTextAnnotations);
    }

    const logprobs = normalizeStreamTextLogprobs(choice.logprobs);
    if (Array.isArray(logprobs) && logprobs.length) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      choiceState.outputTextLogprobs.push(...logprobs);
      item.content[contentIndex].logprobs = clone(choiceState.outputTextLogprobs);
    } else if (logprobs && !Array.isArray(logprobs)) {
      events.push(...ensureTextPart(state, choiceState));
      const item = choiceState.messageItem;
      const contentIndex = item.content.findIndex((part) => part.type === "output_text");
      item.content[contentIndex].logprobs = logprobs;
    }

    if (delta.refusal) {
      events.push(...ensureRefusalPart(state, choiceState));
      const item = choiceState.messageItem;
      const outputIndex = state.response.output.indexOf(item);
      const contentIndex = item.content.findIndex((part) => part.type === "refusal");
      item.content[contentIndex].refusal += delta.refusal;
      choiceState.refusalText += delta.refusal;
      events.push({
        type: "response.refusal.delta",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: delta.refusal,
      });
    }

    if (isPlainObject(delta.audio)) {
      choiceState.audio = mergeStreamAudio(choiceState.audio, delta.audio);
      events.push(...ensureAudioPart(state, choiceState));
      const audioPart = normalizeChatAudioPart(choiceState.audio);
      const item = choiceState.messageItem;
      let contentIndex = item.content.indexOf(choiceState.audioPart);
      if (contentIndex === -1) contentIndex = item.content.findIndex((part) => part?.type === "output_audio");
      if (contentIndex === -1) {
        item.content.push(audioPart);
      } else {
        item.content[contentIndex] = audioPart;
      }
      choiceState.audioPart = audioPart;
    }

    const refusalLogprobs = normalizeOutputTextLogprobs(choice.logprobs?.refusal);
    if (Array.isArray(refusalLogprobs) && refusalLogprobs.length) {
      choiceState.outputRefusalLogprobs.push(...refusalLogprobs);
    }

    for (const deltaToolCall of delta.tool_calls || []) {
      const index = deltaToolCall.index || 0;
      events.push(...ensureToolCallItem(state, choiceState, index, deltaToolCall));
      const item = choiceState.toolCalls.get(index);
      const outputIndex = state.response.output.indexOf(item);
      if (deltaToolCall.id) item.call_id = deltaToolCall.id;
      if (deltaToolCall.function?.name) item.name += deltaToolCall.function.name;
      if (deltaToolCall.function?.arguments) {
        item.arguments += deltaToolCall.function.arguments;
        events.push({
          type: "response.function_call_arguments.delta",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          delta: deltaToolCall.function.arguments,
        });
      }
    }

    if (isPlainObject(delta.function_call)) {
      const index = "__legacy_function_call";
      const legacyToolCall = {
        id: legacyStreamFunctionCallId(chunk, choice),
        type: "function",
        function: delta.function_call,
      };
      events.push(...ensureToolCallItem(state, choiceState, index, legacyToolCall));
      const item = choiceState.toolCalls.get(index);
      const outputIndex = state.response.output.indexOf(item);
      item.call_id = legacyToolCall.id;
      if (delta.function_call.name) item.name += delta.function_call.name;
      if (delta.function_call.arguments) {
        item.arguments += stringifyContent(delta.function_call.arguments);
        events.push({
          type: "response.function_call_arguments.delta",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          delta: stringifyContent(delta.function_call.arguments),
        });
      }
    }
  }

  return events;
}

function legacyStreamFunctionCallId(chunk = {}, choice = {}) {
  const raw = stringifyContent(chunk.id || "compat");
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "compat";
  return `call_${safe}_${choice.index ?? 0}`;
}

function finishStreamState(state) {
  const events = [];
  for (const item of state.response.output) {
    const outputIndex = state.response.output.indexOf(item);
    if (item.type === "message") {
      item.status = "completed";
      for (const [contentIndex, part] of item.content.entries()) {
        const doneKey = `${item.id}:${contentIndex}:${part.type}`;
        if (state.outputDone.has(doneKey)) continue;
        if (part.type === "output_text") {
          events.push({
            type: "response.output_text.done",
            response_id: state.response.id,
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            text: part.text,
          });
        } else if (part.type === "refusal") {
          events.push({
            type: "response.refusal.done",
            response_id: state.response.id,
            item_id: item.id,
            output_index: outputIndex,
            content_index: contentIndex,
            refusal: part.refusal,
          });
        }
        events.push({
          type: "response.content_part.done",
          response_id: state.response.id,
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
          part: clone(part),
        });
        state.outputDone.add(doneKey);
      }
    } else if (item.type === "reasoning") {
      item.status = "completed";
      events.push({
        type: "response.reasoning_summary_text.done",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        summary_index: 0,
        text: item.summary[0]?.text || "",
      });
    } else if (item.type === "function_call") {
      item.status = "completed";
      events.push({
        type: "response.function_call_arguments.done",
        response_id: state.response.id,
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      });
    }

    events.push({
      type: "response.output_item.done",
      response_id: state.response.id,
      output_index: outputIndex,
      item: clone(item),
    });
  }

  return events;
}

function mergeStreamAudio(existing, deltaAudio) {
  const next = isPlainObject(existing) ? clone(existing) : {};
  for (const [key, value] of Object.entries(deltaAudio)) {
    if (value === undefined) continue;
    if ((key === "data" || key === "transcript") && typeof value === "string" && typeof next[key] === "string") {
      next[key] += value;
      continue;
    }
    next[key] = clone(value);
  }
  return next;
}

function normalizeStreamTextLogprobs(logprobs) {
  if (Array.isArray(logprobs)) return normalizeOutputTextLogprobs(logprobs);
  if (Array.isArray(logprobs?.content) || Array.isArray(logprobs?.output_text)) {
    return normalizeOutputTextLogprobs(logprobs);
  }
  return undefined;
}

function normalizeStreamAnnotations(annotations) {
  if (annotations == null) return [];
  const values = Array.isArray(annotations) ? annotations : [annotations];
  return values.filter((annotation) => annotation != null).map((annotation) => clone(annotation));
}

function streamStateToReplayMessages(state) {
  const messages = [];
  for (const choiceState of sortedChoiceStates(state)) {
    const assistant = { role: "assistant", content: choiceState.text || null };
    if (choiceState.reasoningText) assistant.reasoning_content = choiceState.reasoningText;
    if (choiceState.refusalText) assistant.refusal = choiceState.refusalText;
    if (isPlainObject(choiceState.audio)) assistant.audio = clone(choiceState.audio);
    const toolCalls = Array.from(choiceState.toolCalls.values()).map((item) => ({
      id: item.call_id,
      type: "function",
      function: { name: item.name, arguments: item.arguments },
    }));
    if (toolCalls.length) assistant.tool_calls = toolCalls;
    if (assistant.content !== null || assistant.tool_calls || assistant.reasoning_content || assistant.refusal) {
      messages.push(assistant);
    }
  }
  return messages;
}

function sortedChoiceStates(state) {
  return Array.from(state.choices.values()).sort((a, b) => {
    const aIndex = Number(a.index);
    const bIndex = Number(b.index);
    if (Number.isFinite(aIndex) && Number.isFinite(bIndex)) return aIndex - bIndex;
    return String(a.index).localeCompare(String(b.index));
  });
}

function streamRefusalLogprobs(state) {
  return sortedChoiceStates(state)
    .filter((choiceState) => choiceState.outputRefusalLogprobs.length)
    .map((choiceState) => ({
      choice_index: choiceState.index,
      logprobs: clone(choiceState.outputRefusalLogprobs),
    }));
}

function streamChoiceCompatibilityMetadata(state) {
  const choices = sortedChoiceStates(state);
  if (!choices.length) return {};
  const audio = choices
    .map((choiceState) => choiceState.audio)
    .filter(isPlainObject);
  return {
    chat_choices: choices.map((choiceState) => ({
      choice_index: choiceState.index,
      ...(choiceState.hasFinishReason ? { finish_reason: choiceState.finishReason } : {}),
    })),
    ...(audio.length ? { chat_audio: audio.map(clone) } : {}),
  };
}

async function* iterateSseJson(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        if (data === "[DONE]") yield data;
        else yield JSON.parse(data);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function handleChatPassthrough(req, res, config, store) {
  const body = await readJson(req);
  const { upstreamBody, compatibility } = chatPassthroughUpstreamBody(body, config);
  const upstream = await fetchProvider(config, config.chatCompletionsPath, upstreamBody, req.headers);
  const headers = proxyResponseHeaders(upstream);
  if (body.store === true && body.stream && upstream.ok && isEventStreamResponse(upstream)) {
    await handleStoredChatStreamPassthrough(res, upstream, headers, body, store, compatibility);
    return;
  }

  const needsJsonPostProcessing = !body.stream
    && isJsonResponse(upstream)
    && (body.store === true || inlineModerationConfig(body.moderation).enabled || compatibility);
  if (needsJsonPostProcessing) {
    const text = await upstream.text();
    const json = parseJsonOrNull(text);
    const localModeration = upstream.ok ? attachLocalChatInlineModeration(json, body, config) : null;
    const attachedCompatibility = upstream.ok ? attachChatPassthroughCompatibility(json, body, compatibility) : false;
    if (upstream.ok && json?.id) {
      store.put(json.id, {
        chat_completion: json,
        chat_messages: normalizeStoredChatMessages(body.messages, json),
        chat_request: sanitizeChatRequest(body),
      });
    }
    if ((localModeration || attachedCompatibility) && isPlainObject(json)) {
      res.writeHead(upstream.status, headers);
      res.end(`${JSON.stringify(json)}\n`);
      return;
    }
    res.writeHead(upstream.status, headers);
    res.end(text);
    return;
  }

  res.writeHead(upstream.status, headers);
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

function chatPassthroughUpstreamBody(body, config) {
  if (!isPlainObject(body)) return { upstreamBody: body, compatibility: null };
  const upstreamBody = clone(body);

  const compatibility = {};
  const developerRole = normalizeChatPassthroughDeveloperRole(upstreamBody, config);
  if (developerRole) compatibility.developer_role = developerRole;

  const deepseekUserId = normalizeChatPassthroughDeepSeekUserId(upstreamBody, config);
  if (deepseekUserId) compatibility.deepseek_user_id = deepseekUserId;

  const maxTokens = normalizeChatPassthroughMaxTokens(upstreamBody, config);
  if (maxTokens) Object.assign(compatibility, maxTokens);

  const reasoning = normalizeChatPassthroughReasoningObject(upstreamBody, config);
  if (reasoning) compatibility.reasoning = reasoning;

  const reasoningEffort = normalizeChatPassthroughReasoningEffort(upstreamBody, config);
  if (reasoningEffort) compatibility.reasoning_effort = reasoningEffort;

  const customTools = filterChatPassthroughCustomTools(upstreamBody, config);
  if (customTools) compatibility.custom_tools = customTools;

  const deepseekThinking = normalizeChatPassthroughToolChoiceThinking(upstreamBody, config);
  if (deepseekThinking) compatibility.deepseek_thinking = deepseekThinking;

  const storedChatFields = filterChatPassthroughStoredFields(upstreamBody, config);
  if (storedChatFields) compatibility.stored_chat_fields = storedChatFields;

  const serviceTier = filterChatPassthroughServiceTier(upstreamBody, config);
  if (serviceTier) compatibility.service_tier = serviceTier;

  const streamOptions = filterChatPassthroughStreamOptions(upstreamBody, config);
  if (streamOptions) compatibility.stream_options = streamOptions;

  const nativeFields = filterChatPassthroughNativeFields(upstreamBody, config);
  if (nativeFields) compatibility.chat_native_fields = nativeFields;

  return {
    upstreamBody,
    compatibility: Object.keys(compatibility).length ? compatibility : null,
  };
}

function filterChatPassthroughStoredFields(upstreamBody, config = {}) {
  if (config.forwardStoredChatFields !== false) return null;
  const filterable = ["metadata", "store"];
  const filtered = [];
  for (const field of filterable) {
    if (Object.prototype.hasOwnProperty.call(upstreamBody, field) && upstreamBody[field] !== undefined) {
      filtered.push(field);
      delete upstreamBody[field];
    }
  }
  if (!filtered.length) return null;
  return {
    filtered,
    reason: "provider_unsupported_local_semantics",
  };
}

function normalizeChatPassthroughDeveloperRole(upstreamBody, config = {}) {
  if (!config.chatDeveloperRoleCompat || !Array.isArray(upstreamBody.messages)) return null;
  const targetRole = normalizeProviderChatRole(config.chatDeveloperRole || "system");
  let mapped = 0;
  upstreamBody.messages = upstreamBody.messages.map((message) => {
    if (!isPlainObject(message) || message.role !== "developer") return message;
    mapped += 1;
    return { ...message, role: targetRole };
  });
  if (!mapped) return null;
  return {
    source: "messages[].role",
    from: "developer",
    to: targetRole,
    count: mapped,
    reason: "provider_developer_role_compat",
  };
}

function normalizeProviderChatRole(value) {
  return ["system", "user", "assistant", "tool"].includes(value) ? value : "system";
}

function normalizeChatPassthroughDeepSeekUserId(upstreamBody, config = {}) {
  if (!config.deepseekUserIdCompat || upstreamBody.user_id != null) return null;
  const candidates = [
    ["safety_identifier", upstreamBody.safety_identifier],
    ["prompt_cache_key", upstreamBody.prompt_cache_key],
    ["user", upstreamBody.user],
  ];
  const found = candidates.find(([, value]) => value != null && value !== "");
  if (!found) return null;
  const [source, value] = found;
  upstreamBody.user_id = normalizeProviderUserId(value);
  delete upstreamBody.user;
  return {
    source,
    target: "user_id",
    normalized: upstreamBody.user_id === value ? "direct" : "sha256",
  };
}

function normalizeChatPassthroughMaxTokens(upstreamBody, config = {}) {
  const maxTokensField = config.maxTokensField || "max_tokens";
  const compatibility = {};

  if (upstreamBody.max_completion_tokens != null) {
    const value = upstreamBody.max_completion_tokens;
    const previousMaxTokens = upstreamBody.max_tokens;
    const conflictingMaxTokens = previousMaxTokens != null && previousMaxTokens !== value;
    upstreamBody[maxTokensField] = value;
    if (maxTokensField !== "max_completion_tokens") delete upstreamBody.max_completion_tokens;
    if (maxTokensField !== "max_tokens") delete upstreamBody.max_tokens;
    compatibility.max_completion_tokens = {
      source: "max_completion_tokens",
      target: maxTokensField,
      value,
      forwarded: true,
      reason: "chat_passthrough_alias",
    };
    if (conflictingMaxTokens) {
      compatibility.max_tokens = {
        source: "max_tokens",
        value: previousMaxTokens,
        forwarded: false,
        reason: "max_completion_tokens_precedence",
      };
    }
    return compatibility;
  }

  if (upstreamBody.max_tokens != null && maxTokensField !== "max_tokens") {
    const value = upstreamBody.max_tokens;
    upstreamBody[maxTokensField] = value;
    delete upstreamBody.max_tokens;
    return {
      max_tokens: {
        source: "max_tokens",
        target: maxTokensField,
        value,
        forwarded: true,
        reason: "chat_passthrough_alias",
      },
    };
  }

  return null;
}

function normalizeChatPassthroughReasoningObject(upstreamBody, config = {}) {
  if (!config.deepseekReasoningEffortCompat || !isPlainObject(upstreamBody.reasoning)) return null;
  const reasoning = clone(upstreamBody.reasoning);
  delete upstreamBody.reasoning;

  const filtered = Object.keys(reasoning).filter((key) => key !== "effort");
  const compatibility = {
    source: "reasoning",
    ...(filtered.length ? { filtered } : {}),
    reason: "chat_passthrough_reasoning_object",
  };

  if (reasoning.effort == null) {
    return {
      ...compatibility,
      forwarded: false,
      reason: "provider_unsupported_object",
    };
  }

  if (upstreamBody.reasoning_effort != null) {
    return {
      ...compatibility,
      effort: {
        source: "reasoning.effort",
        value: reasoning.effort,
        forwarded: false,
        reason: "reasoning_effort_precedence",
      },
    };
  }

  upstreamBody.reasoning_effort = reasoning.effort;
  const effortCompatibility = normalizeChatPassthroughReasoningEffort(upstreamBody, config, {
    source: "reasoning.effort",
  }) || {
    source: "reasoning.effort",
    target: "reasoning_effort",
    value: reasoning.effort,
    forwarded: true,
    reason: "chat_passthrough_reasoning_alias",
  };

  return {
    ...compatibility,
    effort: effortCompatibility,
  };
}

function normalizeChatPassthroughReasoningEffort(upstreamBody, config = {}, options = {}) {
  if (!config.deepseekReasoningEffortCompat || upstreamBody.reasoning_effort == null) return null;
  const source = options.source || "reasoning_effort";
  const value = upstreamBody.reasoning_effort;
  const mapped = normalizeReasoningEffort(value, config);

  if (mapped == null) {
    const previousThinking = isPlainObject(upstreamBody.thinking) ? clone(upstreamBody.thinking) : upstreamBody.thinking;
    delete upstreamBody.reasoning_effort;
    upstreamBody.thinking = { type: "disabled" };
    return {
      source,
      target: "thinking",
      value,
      mapped: upstreamBody.thinking,
      previous_thinking: previousThinking,
      forwarded: false,
      reason: "deepseek_thinking_disabled",
    };
  }

  if (mapped !== value) {
    upstreamBody.reasoning_effort = mapped;
    return {
      source,
      target: "reasoning_effort",
      value,
      mapped,
      forwarded: true,
      reason: "deepseek_effort_compat",
    };
  }

  return null;
}

function normalizeChatPassthroughToolChoiceThinking(upstreamBody, config = {}) {
  if (
    !config.deepseekDisableThinkingForToolChoice
    || config.deepseekThinkingMode
    || !Array.isArray(upstreamBody.tools)
    || upstreamBody.tools.length === 0
    || upstreamBody.tool_choice === undefined
  ) {
    return null;
  }

  const previousThinking = isPlainObject(upstreamBody.thinking) ? clone(upstreamBody.thinking) : upstreamBody.thinking;
  upstreamBody.thinking = { type: "disabled" };
  return {
    source: "tool_choice",
    target: "thinking",
    value: clone(upstreamBody.tool_choice),
    mapped: clone(upstreamBody.thinking),
    previous_thinking: previousThinking,
    forwarded: true,
    reason: "disabled_for_tool_choice",
  };
}

function filterChatPassthroughCustomTools(upstreamBody, config = {}) {
  if (config.forwardChatCustomTools !== false || !Array.isArray(upstreamBody.tools)) return null;

  const forwarded = [];
  const filtered = [];
  const forwardableTools = [];
  upstreamBody.tools.forEach((tool, index) => {
    const descriptor = chatToolCompatibilityDescriptor(tool, index);
    if (isPlainObject(tool) && tool.type === "function") {
      forwardableTools.push(tool);
      forwarded.push(descriptor);
      return;
    }
    filtered.push(descriptor);
  });

  if (!filtered.length) return null;
  if (forwardableTools.length) upstreamBody.tools = forwardableTools;
  else delete upstreamBody.tools;

  const toolChoice = filterChatPassthroughToolChoiceForForwardedTools(upstreamBody, forwardableTools);
  return {
    source: "tools",
    ...(forwarded.length ? { forwarded } : {}),
    filtered,
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    reason: "provider_function_tools_only",
  };
}

function filterChatPassthroughToolChoiceForForwardedTools(upstreamBody, forwardableTools = []) {
  if (upstreamBody.tool_choice === undefined) return null;
  const value = clone(upstreamBody.tool_choice);
  const forwardedFunctionNames = new Set(
    forwardableTools
      .map((tool) => stringifyOptional(tool.function?.name))
      .filter(Boolean),
  );

  if (!forwardableTools.length) {
    delete upstreamBody.tool_choice;
    return {
      source: "tool_choice",
      value,
      forwarded: false,
      reason: "no_forwardable_tools",
    };
  }

  if (typeof upstreamBody.tool_choice === "string") {
    if (["auto", "none", "required"].includes(upstreamBody.tool_choice)) return null;
    delete upstreamBody.tool_choice;
    return {
      source: "tool_choice",
      value,
      forwarded: false,
      reason: "unsupported_tool_choice",
    };
  }

  if (!isPlainObject(upstreamBody.tool_choice) || upstreamBody.tool_choice.type !== "function") {
    delete upstreamBody.tool_choice;
    return {
      source: "tool_choice",
      value,
      forwarded: false,
      reason: "provider_function_tools_only",
    };
  }

  const name = stringifyOptional(upstreamBody.tool_choice.function?.name);
  if (name && forwardedFunctionNames.has(name)) return null;

  delete upstreamBody.tool_choice;
  return {
    source: "tool_choice",
    value,
    forwarded: false,
    reason: "tool_choice_function_filtered",
  };
}

function chatToolCompatibilityDescriptor(tool, index) {
  const descriptor = {
    index,
    type: isPlainObject(tool) ? stringifyContent(tool.type || "unknown") : typeof tool,
  };
  const name = isPlainObject(tool)
    ? stringifyOptional(tool.function?.name || tool.custom?.name || tool.name)
    : null;
  if (name) descriptor.name = name;
  return descriptor;
}

function stringifyOptional(value) {
  if (value == null || value === "") return null;
  return stringifyContent(value);
}

function filterChatPassthroughServiceTier(upstreamBody, config = {}) {
  if (upstreamBody.service_tier === undefined || config.forwardServiceTier !== false) return null;
  const value = upstreamBody.service_tier;
  delete upstreamBody.service_tier;
  return {
    source: "service_tier",
    value,
    forwarded: false,
    reason: "provider_unsupported",
  };
}

function filterChatPassthroughStreamOptions(upstreamBody, config = {}) {
  if (upstreamBody.stream_options === undefined) return null;
  if (!upstreamBody.stream) {
    delete upstreamBody.stream_options;
    return {
      source: "stream_options",
      forwarded: false,
      reason: "stream_required",
    };
  }
  if (config.forwardStreamOptions !== false) {
    const filtered = filterStreamOptionsForProvider(upstreamBody.stream_options, config);
    if (!filtered.compatibility) return null;
    if (filtered.streamOptions === undefined) delete upstreamBody.stream_options;
    else upstreamBody.stream_options = filtered.streamOptions;
    return filtered.compatibility;
  }
  delete upstreamBody.stream_options;
  return {
    source: "stream_options",
    forwarded: false,
    reason: "provider_unsupported",
  };
}

function filterChatPassthroughNativeFields(upstreamBody, config = {}) {
  if (config.forwardChatNativeFields !== false) return null;
  const filterable = [
    "logit_bias",
    "modalities",
    "audio",
    "prediction",
    "n",
    "parallel_tool_calls",
    "prompt_cache_key",
    "prompt_cache_retention",
    "safety_identifier",
    "moderation",
    "verbosity",
    "web_search_options",
    "functions",
    "function_call",
  ];
  const filtered = [];
  for (const field of filterable) {
    if (Object.prototype.hasOwnProperty.call(upstreamBody, field) && upstreamBody[field] !== undefined) {
      filtered.push(field);
      delete upstreamBody[field];
    }
  }
  if (!filtered.length) return null;
  return {
    filtered,
    reason: "provider_unsupported",
  };
}

function attachChatPassthroughCompatibility(completion, request, compatibility) {
  if (!compatibility || !isPlainObject(completion)) return false;
  const metadata = isPlainObject(completion.metadata)
    ? clone(completion.metadata)
    : isPlainObject(request?.metadata)
      ? clone(request.metadata)
      : {};
  const existingCompatibility = isPlainObject(metadata.compatibility) ? metadata.compatibility : {};
  metadata.compatibility = {
    ...existingCompatibility,
    chat_passthrough: {
      ...(isPlainObject(existingCompatibility.chat_passthrough) ? existingCompatibility.chat_passthrough : {}),
      ...clone(compatibility),
    },
  };
  completion.metadata = metadata;
  return true;
}

async function handleStoredChatStreamPassthrough(res, upstream, headers, request, store, compatibility = null) {
  const accumulator = createChatStreamAccumulator(request);
  res.writeHead(upstream.status, headers);

  try {
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") {
        res.write("data: [DONE]\n\n");
        break;
      }
      applyChatCompletionStreamChunk(accumulator, payload);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    const completion = finalizeChatStreamCompletion(accumulator);
    if (completion?.id) {
      attachChatPassthroughCompatibility(completion, request, compatibility);
      store.put(completion.id, {
        chat_completion: completion,
        chat_messages: normalizeStoredChatMessages(request.messages, completion),
        chat_request: sanitizeChatRequest(request),
      });
    }
  } finally {
    res.end();
  }
}

function isJsonResponse(upstream) {
  return (upstream.headers.get("content-type") || "").includes("application/json");
}

function isEventStreamResponse(upstream) {
  return (upstream.headers.get("content-type") || "").includes("text/event-stream");
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleLegacyCompletions(req, res, config) {
  const request = await readJson(req);
  const prompts = normalizeCompletionPrompts(request.prompt);
  if (request.stream) {
    await handleStreamingLegacyCompletions(req, res, config, request, prompts);
    return;
  }

  const completionId = legacyCompletionId();
  let created = nowSeconds();
  const choices = [];
  const usage = emptyCompletionUsage();
  let model = request.model || config.defaultModel;
  let systemFingerprint = null;
  let sawUsage = false;

  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const prompt = prompts[promptIndex];
    const chat = legacyCompletionToChatRequest(request, prompt, config);
    const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
    const text = await upstream.text();
    const upstreamJson = parseJsonOrNull(text);
    if (!upstream.ok) {
      sendJson(res, upstream.status, upstreamJson || { error: { message: text } });
      return;
    }

    model = upstreamJson?.model || model;
    if (upstreamJson?.created && promptIndex === 0) created = upstreamJson.created;
    systemFingerprint = upstreamJson?.system_fingerprint || systemFingerprint;
    const choiceBase = promptIndex * normalizedCompletionChoiceCount(request.n);
    for (const [choiceOffset, choice] of (upstreamJson?.choices || []).entries()) {
      choices.push(chatChoiceToLegacyCompletionChoice(choice, {
        prompt,
        request,
        indexBase: choiceBase,
        fallbackIndex: choiceOffset,
      }));
    }
    if (addCompletionUsage(usage, upstreamJson?.usage)) sawUsage = true;
  }

  const response = {
    id: completionId,
    object: "text_completion",
    created,
    model,
    choices,
    ...(systemFingerprint ? { system_fingerprint: systemFingerprint } : {}),
    ...(sawUsage ? { usage } : {}),
  };
  sendJson(res, 200, response);
}

async function handleStreamingLegacyCompletions(req, res, config, request, prompts) {
  const completionId = legacyCompletionId();
  const created = nowSeconds();
  let headersWritten = false;
  const echoedChoices = new Set();

  for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
    const prompt = prompts[promptIndex];
    const chat = legacyCompletionToChatRequest(request, prompt, config);
    const upstream = await fetchProvider(config, config.chatCompletionsPath, chat, req.headers);
    if (!upstream.ok) {
      const text = await upstream.text();
      const upstreamJson = parseJsonOrNull(text);
      if (!headersWritten) {
        sendJson(res, upstream.status, upstreamJson || { error: { message: text } });
      } else {
        writeLegacyCompletionSse(res, upstreamJson || {
          error: {
            message: text || `upstream provider returned HTTP ${upstream.status}`,
            type: "upstream_provider_error",
            code: upstream.status,
          },
        });
        res.end();
      }
      return;
    }

    if (!headersWritten) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      });
      headersWritten = true;
    }

    const choiceBase = promptIndex * normalizedCompletionChoiceCount(request.n);
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") break;
      const chunk = chatStreamChunkToLegacyCompletionChunk(payload, {
        completionId,
        created,
        model: request.model || config.defaultModel,
        prompt,
        request,
        indexBase: choiceBase,
        echoedChoices,
      });
      writeLegacyCompletionSse(res, chunk);
    }
  }

  if (!headersWritten) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

function legacyCompletionId() {
  return `cmpl-${crypto.randomBytes(16).toString("hex")}`;
}

function normalizeCompletionPrompts(prompt) {
  if (prompt == null) return [""];
  if (!Array.isArray(prompt)) return [stringifyContent(prompt)];
  if (!prompt.length) return [""];
  if (prompt.every((part) => Number.isInteger(part))) {
    return [prompt.map((part) => String(part)).join(" ")];
  }
  return prompt.map((part) => normalizeSingleCompletionPrompt(part));
}

function normalizeSingleCompletionPrompt(prompt) {
  if (!Array.isArray(prompt)) return stringifyContent(prompt);
  if (prompt.every((part) => Number.isInteger(part))) {
    return prompt.map((part) => String(part)).join(" ");
  }
  return prompt.map((part) => stringifyContent(part)).join("");
}

function legacyCompletionToChatRequest(request, prompt, config) {
  const chat = {
    model: request.model || config.defaultModel,
    messages: [{ role: "user", content: completionPromptForChat(prompt, request) }],
  };

  const maxTokensField = config.maxTokensField || "max_tokens";
  if (request.max_tokens != null) chat[maxTokensField] = request.max_tokens;
  for (const field of ["temperature", "top_p", "frequency_penalty", "presence_penalty", "stop", "seed", "n"]) {
    copyDefinedField(chat, request, field);
  }
  if (request.logit_bias !== undefined && config.forwardChatNativeFields !== false) {
    chat.logit_bias = clone(request.logit_bias);
  }
  if (request.logprobs != null) {
    chat.logprobs = true;
    const topLogprobs = Number(request.logprobs);
    if (Number.isFinite(topLogprobs) && topLogprobs > 0) {
      chat.top_logprobs = Math.min(20, Math.trunc(topLogprobs));
    }
  }
  mapLegacyCompletionUser(request, chat, config);
  if (request.stream) {
    chat.stream = true;
    if (config.forwardStreamOptions !== false) {
      if (request.stream_options !== undefined) {
        chat.stream_options = isPlainObject(request.stream_options)
          ? clone(request.stream_options)
          : request.stream_options;
      }
      if (config.streamIncludeUsage !== false) {
        if (!isPlainObject(chat.stream_options)) chat.stream_options = {};
        if (chat.stream_options.include_usage === undefined) chat.stream_options.include_usage = true;
      }
      const filtered = filterStreamOptionsForProvider(chat.stream_options, config);
      if (filtered.compatibility) {
        if (filtered.streamOptions === undefined) delete chat.stream_options;
        else chat.stream_options = filtered.streamOptions;
      }
    }
  }

  return chat;
}

function copyDefinedField(target, source, field) {
  if (source[field] !== undefined) target[field] = clone(source[field]);
}

function completionPromptForChat(prompt, request) {
  if (request.suffix == null || request.suffix === "") return prompt;
  return [
    "Complete the prefix so it fits immediately before the suffix. Return only the missing continuation.",
    "",
    "Prefix:",
    prompt,
    "",
    "Suffix:",
    stringifyContent(request.suffix),
  ].join("\n");
}

function mapLegacyCompletionUser(request, chat, config) {
  if (request.user == null || request.user === "") return;
  if (!config.deepseekUserIdCompat) {
    chat.user = stringifyContent(request.user);
    return;
  }
  chat.user_id = normalizeProviderUserId(request.user);
}

function normalizeProviderUserId(value) {
  const raw = stringifyContent(value);
  if (/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return raw;
  return `sha256_${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

function normalizedCompletionChoiceCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.trunc(parsed);
}

function chatChoiceToLegacyCompletionChoice(choice, { prompt, request, indexBase, fallbackIndex }) {
  const completionText = chatChoiceText(choice);
  const text = request.echo ? `${prompt}${completionText}` : completionText;
  return {
    text,
    index: indexBase + numericChoiceIndex(choice, fallbackIndex),
    logprobs: chatLogprobsToLegacyCompletionLogprobs(choice?.logprobs),
    finish_reason: choice?.finish_reason ?? null,
  };
}

function chatStreamChunkToLegacyCompletionChunk(payload, options) {
  const chunk = {
    id: options.completionId,
    object: "text_completion",
    created: payload?.created || options.created,
    model: payload?.model || options.model,
    choices: (payload?.choices || []).map((choice, fallbackIndex) => {
      const index = options.indexBase + numericChoiceIndex(choice, fallbackIndex);
      let text = chatStreamChoiceText(choice);
      if (options.request.echo && !options.echoedChoices.has(index)) {
        text = `${options.prompt}${text}`;
        options.echoedChoices.add(index);
      }
      return {
        text,
        index,
        logprobs: chatLogprobsToLegacyCompletionLogprobs(choice?.logprobs),
        finish_reason: choice?.finish_reason ?? null,
      };
    }),
  };
  if (payload?.system_fingerprint) chunk.system_fingerprint = payload.system_fingerprint;
  const usage = completionUsage(payload?.usage);
  if (usage) chunk.usage = usage;
  return chunk;
}

function numericChoiceIndex(choice, fallbackIndex) {
  const parsed = Number(choice?.index);
  if (Number.isFinite(parsed)) return Math.trunc(parsed);
  return fallbackIndex;
}

function chatChoiceText(choice) {
  if (choice?.text != null) return stringifyContent(choice.text);
  return chatContentToText(choice?.message?.content);
}

function chatStreamChoiceText(choice) {
  if (choice?.text != null) return stringifyContent(choice.text);
  return chatContentToText(choice?.delta?.content ?? choice?.message?.content ?? "");
}

function chatContentToText(content) {
  if (!Array.isArray(content)) return stringifyContent(content);
  return content
    .map((part) => stringifyContent(part?.text ?? part?.content ?? part))
    .join("");
}

function chatLogprobsToLegacyCompletionLogprobs(logprobs) {
  const content = Array.isArray(logprobs?.content) ? logprobs.content : [];
  if (!content.length) return null;
  let offset = 0;
  return {
    tokens: content.map((item) => stringifyContent(item?.token ?? "")),
    token_logprobs: content.map((item) => Number.isFinite(item?.logprob) ? item.logprob : null),
    top_logprobs: content.map((item) => {
      if (!Array.isArray(item?.top_logprobs)) return null;
      return Object.fromEntries(item.top_logprobs.map((top) => [
        stringifyContent(top?.token ?? ""),
        Number.isFinite(top?.logprob) ? top.logprob : null,
      ]));
    }),
    text_offset: content.map((item) => {
      const current = offset;
      offset += stringifyContent(item?.token ?? "").length;
      return current;
    }),
  };
}

function emptyCompletionUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function addCompletionUsage(total, usage) {
  const mapped = completionUsage(usage);
  if (!mapped) return false;
  total.prompt_tokens += mapped.prompt_tokens;
  total.completion_tokens += mapped.completion_tokens;
  total.total_tokens += mapped.total_tokens;
  return true;
}

function completionUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  const totalTokens = usage.total_tokens ?? (
    Number(promptTokens || 0) + Number(completionTokens || 0)
  );
  if (![promptTokens, completionTokens, totalTokens].some((value) => Number.isFinite(Number(value)))) return null;
  return {
    prompt_tokens: Number(promptTokens || 0),
    completion_tokens: Number(completionTokens || 0),
    total_tokens: Number(totalTokens || 0),
  };
}

function writeLegacyCompletionSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function createChatStreamAccumulator(request = {}) {
  return {
    id: null,
    created: null,
    model: request.model || null,
    system_fingerprint: null,
    service_tier: null,
    usage: null,
    choices: new Map(),
    request,
  };
}

function applyChatCompletionStreamChunk(accumulator, chunk) {
  if (!isPlainObject(chunk)) return;
  if (chunk.id) accumulator.id = accumulator.id || chunk.id;
  if (Number.isFinite(Number(chunk.created))) accumulator.created = accumulator.created || Number(chunk.created);
  if (chunk.model) accumulator.model = chunk.model;
  if (chunk.system_fingerprint !== undefined) accumulator.system_fingerprint = chunk.system_fingerprint;
  if (chunk.service_tier !== undefined) accumulator.service_tier = chunk.service_tier;
  if (chunk.usage) accumulator.usage = clone(chunk.usage);

  for (const choice of chunk.choices || []) {
    const index = numericChoiceIndex(choice, accumulator.choices.size);
    const state = chatStreamChoiceState(accumulator, index);
    if (choice.finish_reason !== undefined) state.finish_reason = choice.finish_reason;
    mergeChatStreamLogprobs(state, choice.logprobs);
    mergeChatStreamDelta(state, choice.delta || {});
    if (choice.message) mergeChatStreamDelta(state, choice.message);
  }
}

function chatStreamChoiceState(accumulator, index) {
  if (!accumulator.choices.has(index)) {
    accumulator.choices.set(index, {
      index,
      role: "assistant",
      content: "",
      refusal: "",
      annotations: [],
      tool_calls: [],
      function_call: null,
      audio: null,
      logprobs: null,
      finish_reason: null,
    });
  }
  return accumulator.choices.get(index);
}

function mergeChatStreamDelta(state, delta) {
  if (!isPlainObject(delta)) return;
  if (delta.role) state.role = delta.role;
  if (delta.content !== undefined && delta.content !== null) {
    state.content += chatContentToText(delta.content);
  }
  if (delta.refusal !== undefined && delta.refusal !== null) {
    state.refusal += chatContentToText(delta.refusal);
  }
  if (Array.isArray(delta.annotations)) {
    state.annotations.push(...clone(delta.annotations));
  }
  if (Array.isArray(delta.tool_calls)) {
    mergeChatStreamToolCalls(state, delta.tool_calls);
  }
  if (isPlainObject(delta.function_call)) {
    state.function_call = mergeChatStreamFunctionCall(state.function_call, delta.function_call);
  }
  if (delta.audio !== undefined) {
    state.audio = mergeChatStreamObject(state.audio, delta.audio);
  }
}

function mergeChatStreamToolCalls(state, deltas) {
  for (const delta of deltas) {
    if (!isPlainObject(delta)) continue;
    const index = Number.isFinite(Number(delta.index)) ? Number(delta.index) : state.tool_calls.length;
    const current = state.tool_calls[index] || { function: {} };
    if (delta.id) current.id = delta.id;
    if (delta.type) current.type = delta.type;
    if (isPlainObject(delta.function)) {
      current.function = mergeChatStreamFunctionCall(current.function, delta.function);
    }
    state.tool_calls[index] = current;
  }
}

function mergeChatStreamFunctionCall(current, delta) {
  const merged = current ? { ...current } : {};
  if (delta.name !== undefined) merged.name = delta.name;
  if (delta.arguments !== undefined) {
    merged.arguments = `${merged.arguments || ""}${stringifyContent(delta.arguments)}`;
  }
  return merged;
}

function mergeChatStreamObject(current, delta) {
  if (!isPlainObject(delta)) return clone(delta);
  const merged = isPlainObject(current) ? clone(current) : {};
  for (const [key, value] of Object.entries(delta)) {
    if (value === undefined) continue;
    if (typeof value === "string" && typeof merged[key] === "string") merged[key] += value;
    else merged[key] = clone(value);
  }
  return merged;
}

function mergeChatStreamLogprobs(state, logprobs) {
  if (!isPlainObject(logprobs)) return;
  if (!state.logprobs) state.logprobs = {};
  for (const key of ["content", "refusal"]) {
    if (Array.isArray(logprobs[key])) {
      if (!Array.isArray(state.logprobs[key])) state.logprobs[key] = [];
      state.logprobs[key].push(...clone(logprobs[key]));
    }
  }
}

function finalizeChatStreamCompletion(accumulator) {
  if (!accumulator.id) return null;
  const completion = {
    id: accumulator.id,
    object: "chat.completion",
    created: accumulator.created || nowSeconds(),
    model: accumulator.model || accumulator.request?.model || "unknown",
    choices: Array.from(accumulator.choices.values())
      .sort((a, b) => a.index - b.index)
      .map(finalizeChatStreamChoice),
  };
  if (accumulator.system_fingerprint !== null) completion.system_fingerprint = accumulator.system_fingerprint;
  if (accumulator.service_tier !== null) completion.service_tier = accumulator.service_tier;
  if (accumulator.usage) completion.usage = clone(accumulator.usage);
  attachStoredChatRequestFields(completion, accumulator.request);
  return completion;
}

function finalizeChatStreamChoice(state) {
  const message = {
    role: state.role || "assistant",
    content: state.content || (state.tool_calls.length || state.function_call ? null : ""),
  };
  if (state.refusal) message.refusal = state.refusal;
  if (state.annotations.length) message.annotations = clone(state.annotations);
  const toolCalls = state.tool_calls.filter(Boolean).map(normalizeStreamToolCall);
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (state.function_call) message.function_call = clone(state.function_call);
  if (state.audio) message.audio = clone(state.audio);
  return {
    index: state.index,
    message,
    logprobs: state.logprobs || null,
    finish_reason: state.finish_reason ?? null,
  };
}

function normalizeStreamToolCall(toolCall) {
  return {
    id: toolCall.id || prefixedId("call"),
    type: toolCall.type || "function",
    function: {
      name: toolCall.function?.name || "",
      arguments: toolCall.function?.arguments || "",
    },
  };
}

function attachStoredChatRequestFields(completion, request = {}) {
  const fields = [
    "metadata",
    "tool_choice",
    "seed",
    "top_p",
    "temperature",
    "presence_penalty",
    "frequency_penalty",
    "response_format",
    "tools",
    "user",
  ];
  for (const field of fields) {
    if (request[field] !== undefined && completion[field] === undefined) {
      completion[field] = clone(request[field]);
    }
  }
  if (!completion.metadata && isPlainObject(request.metadata)) completion.metadata = clone(request.metadata);
  if (!completion.metadata) completion.metadata = {};
}

function proxyResponseHeaders(upstream) {
  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
  const headers = {
    "content-type": contentType,
    "cache-control": "no-store",
  };
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) headers["x-request-id"] = requestId;
  if (contentType.includes("text/event-stream")) {
    headers.connection = "keep-alive";
    headers["x-accel-buffering"] = "no";
  }
  return headers;
}

function sanitizeChatRequest(request) {
  const stored = clone(request || {});
  delete stored.stream;
  return stored;
}

function normalizeStoredChatMessages(messages, completion) {
  const data = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    data.push(addStoredChatMessageId(message, data.length, "input"));
  }

  for (const choice of completion?.choices || []) {
    if (choice.message) {
      data.push(addStoredChatMessageId({
        ...choice.message,
        finish_reason: choice.finish_reason || null,
        index: choice.index,
      }, data.length, "output"));
    }
  }

  return data;
}

function addStoredChatMessageId(message, index, direction) {
  const stored = message && typeof message === "object" && !Array.isArray(message)
    ? clone(message)
    : { role: "user", content: stringifyContent(message) };
  if (!stored.id) stored.id = `chatmsg_${String(index).padStart(6, "0")}`;
  if (!stored.object) stored.object = "chat.completion.message";
  stored.direction = direction;
  return stored;
}

async function handleModels(req, res, config) {
  if (config.providerApiKey) {
    try {
      const upstream = await fetchProviderGet(config, config.modelsPath, req.headers);
      if (upstream.ok) {
        const text = await upstream.text();
        res.writeHead(200, {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(text);
        return;
      }
    } catch {
      // Fall through to local model catalog.
    }
  }

  sendJson(res, 200, {
    object: "list",
    data: localModelCatalog(config),
  });
}

async function handleModelGet(req, res, config, modelId) {
  if (config.providerApiKey) {
    const direct = await tryFetchModel(config, req.headers, modelId);
    if (direct) {
      sendJson(res, 200, direct);
      return;
    }

    const listed = await tryFindListedModel(config, req.headers, modelId);
    if (listed) {
      sendJson(res, 200, listed);
      return;
    }
  }

  if (localModelCatalog(config).some((model) => model.id === modelId)) {
    sendJson(res, 200, localModelObject(modelId));
    return;
  }

  sendError(res, 404, `model not found: ${modelId}`, {
    type: "invalid_request_error",
    code: "model_not_found",
    param: "model",
  });
}

async function tryFetchModel(config, headers, modelId) {
  try {
    const route = `${config.modelsPath.replace(/\/+$/, "")}/${encodeURIComponent(modelId)}`;
    const upstream = await fetchProviderGet(config, route, headers);
    if (!upstream.ok || !isJsonResponse(upstream)) return null;
    const text = await upstream.text();
    const json = parseJsonOrNull(text);
    return normalizeModelObject(json);
  } catch {
    return null;
  }
}

async function tryFindListedModel(config, headers, modelId) {
  try {
    const upstream = await fetchProviderGet(config, config.modelsPath, headers);
    if (!upstream.ok || !isJsonResponse(upstream)) return null;
    const body = parseJsonOrNull(await upstream.text());
    const found = Array.isArray(body?.data)
      ? body.data.find((model) => model?.id === modelId)
      : null;
    return normalizeModelObject(found);
  } catch {
    return null;
  }
}

function normalizeModelObject(model) {
  if (!model?.id) return null;
  const created = Number(model.created);
  return {
    ...model,
    id: model.id,
    object: model.object || "model",
    created: Number.isFinite(created) ? created : 0,
    owned_by: model.owned_by || model.owned_by_organization || "upstream-provider",
  };
}

function localModelObject(modelId) {
  return {
    id: modelId,
    object: "model",
    created: 0,
    owned_by: "compatibility-bridge",
  };
}

function localModelCatalog(config) {
  return [...new Set([
    config.defaultModel,
    config.embeddingsModel,
    config.moderationsModel,
    config.audioSpeechModel,
    config.audioTranscriptionModel,
    config.audioTranslationModel,
  ].filter(Boolean))].map((modelId) => localModelObject(modelId));
}

async function handleEmbeddings(req, res, config) {
  const request = await readJson(req);
  let inputs = [];
  try {
    inputs = normalizeEmbeddingInputs(request.input);
  } catch (error) {
    sendError(res, error.status || 400, error.message, {
      type: "invalid_request_error",
      code: error.code || "invalid_embedding_input",
      param: "input",
    });
    return;
  }

  const dimensions = normalizeRequestedEmbeddingDimensions(request.dimensions, config);
  if (!dimensions.ok) {
    sendError(res, 400, dimensions.error, {
      type: "invalid_request_error",
      code: "invalid_embedding_dimensions",
      param: "dimensions",
    });
    return;
  }

  const encodingFormat = request.encoding_format || "float";
  if (!["float", "base64"].includes(encodingFormat)) {
    sendError(res, 400, "encoding_format must be float or base64", {
      type: "invalid_request_error",
      code: "invalid_embedding_encoding_format",
      param: "encoding_format",
    });
    return;
  }

  const model = request.model || config.embeddingsModel || `hashed-semantic-${dimensions.value}`;
  const data = inputs.map((input, index) => {
    const vector = normalizedEmbeddingVector(input.text, dimensions.value);
    return {
      object: "embedding",
      embedding: encodingFormat === "base64" ? embeddingVectorToBase64(vector) : vector,
      index,
    };
  });
  const promptTokens = inputs.reduce((sum, input) => sum + input.tokens, 0);

  sendJson(res, 200, {
    object: "list",
    data,
    model,
    usage: {
      prompt_tokens: promptTokens,
      total_tokens: promptTokens,
    },
    compatibility: {
      provider: "local",
      model: "hashed-semantic",
      dimensions: dimensions.value,
      encoding_format: encodingFormat,
      reason: "chat_provider_embedding_compatibility",
    },
  });
}

async function handleModerations(req, res, config) {
  const request = await readJson(req);
  let inputs = [];
  try {
    inputs = normalizeModerationInputs(request.input);
  } catch (error) {
    sendError(res, error.status || 400, error.message, {
      type: "invalid_request_error",
      code: error.code || "invalid_moderation_input",
      param: "input",
    });
    return;
  }

  const model = request.model || config.moderationsModel || "omni-moderation-latest";
  const results = inputs.map((input) => classifyModerationInput(input));

  sendJson(res, 200, {
    id: prefixedId("modr"),
    model,
    results,
    compatibility: {
      provider: "local",
      classifier: "deterministic-keyword-safety",
      reason: "chat_provider_moderation_compatibility",
      supports_image_inspection: false,
    },
  });
}

async function handleAudioSpeech(req, res, config) {
  try {
    if (!canUseLocalAudio(config)) {
      sendError(res, 400, "local audio compatibility is disabled", {
        type: "invalid_request_error",
        code: "audio_disabled",
        param: "provider",
      });
      return;
    }

    const request = await readJson(req);
    const speech = normalizeAudioSpeechRequest(request, config);
    const content = placeholderSpeechContent(speech);
    if (speech.stream) {
      writeAudioSpeechStream(res, speech, content);
      return;
    }

    res.writeHead(200, {
      "content-type": content.contentType,
      "content-length": content.buffer.length,
      "cache-control": "no-store",
      "x-audio-model": speech.model,
      "x-audio-provider": config.audioProvider || "placeholder",
      "x-audio-voice": speech.voice,
      "x-audio-format": speech.response_format,
    });
    res.end(content.buffer);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "audio speech request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "audio_speech_error",
      param: error.param || null,
    });
  }
}

async function handleAudioTranscriptions(req, res, config) {
  await handleAudioTranscriptLike(req, res, config, "transcribe");
}

async function handleAudioTranslations(req, res, config) {
  await handleAudioTranscriptLike(req, res, config, "translate");
}

async function handleAudioTranscriptLike(req, res, config, task) {
  try {
    if (!canUseLocalAudio(config)) {
      sendError(res, 400, "local audio compatibility is disabled", {
        type: "invalid_request_error",
        code: "audio_disabled",
        param: "provider",
      });
      return;
    }

    const request = await readAudioFileRequest(req, config);
    const normalized = normalizeAudioTranscriptRequest(request, config, task);
    const text = placeholderAudioTranscriptText(normalized, task);
    if (task === "transcribe" && normalized.stream) {
      writeAudioTranscriptStream(res, normalized, text);
      return;
    }

    const response = createAudioTranscriptResponse(normalized, text, task);
    if (response.kind === "text") {
      res.writeHead(200, {
        "content-type": response.contentType,
        "cache-control": "no-store",
      });
      res.end(response.text);
      return;
    }

    sendJson(res, 200, response.body);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "audio request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "audio_error",
      param: error.param || null,
    });
  }
}

function canUseLocalAudio(config = {}) {
  return String(config.audioProvider || "placeholder").toLowerCase() !== "disabled";
}

function normalizeAudioSpeechRequest(request = {}, config = {}) {
  if (!isPlainObject(request)) {
    throw requestError("audio speech request body must be a JSON object", {
      code: "invalid_request_body",
    });
  }
  const input = stringifyContent(request.input).trim();
  if (!input) {
    throw requestError("input is required", {
      code: "missing_required_parameter",
      param: "input",
    });
  }
  const responseFormat = normalizeAudioSpeechFormat(request.response_format || request.format || "mp3");
  const speed = normalizeAudioSpeed(request.speed);
  const voice = normalizeAudioVoice(request.voice || config.audioDefaultVoice || "alloy");
  return {
    input,
    model: stringifyContent(request.model || config.audioSpeechModel || "gpt-4o-mini-tts"),
    voice,
    response_format: responseFormat,
    speed,
    instructions: stringifyContent(request.instructions || ""),
    stream: request.stream === true || String(request.stream_format || "").toLowerCase() === "sse",
  };
}

function normalizeAudioSpeechFormat(value) {
  const format = String(value || "mp3").trim().toLowerCase();
  if (AUDIO_SPEECH_CONTENT_TYPES[format]) return format;
  throw requestError(`unsupported audio response_format: ${format || "empty"}`, {
    code: "invalid_request_parameter",
    param: "response_format",
  });
}

function normalizeAudioSpeed(value) {
  if (value === undefined || value === null || value === "") return 1;
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw requestError("speed must be a number between 0.25 and 4", {
      code: "invalid_request_parameter",
      param: "speed",
    });
  }
  return speed;
}

function normalizeAudioVoice(value) {
  if (isPlainObject(value) && value.id) return stringifyContent(value.id);
  const voice = stringifyContent(value || "alloy").trim();
  if (!voice) {
    throw requestError("voice is required", {
      code: "missing_required_parameter",
      param: "voice",
    });
  }
  return voice;
}

function placeholderSpeechContent(speech = {}) {
  const format = speech.response_format || "mp3";
  if (format === "wav") {
    return {
      contentType: AUDIO_SPEECH_CONTENT_TYPES.wav,
      buffer: placeholderWavBuffer(speech),
    };
  }
  if (format === "pcm") {
    return {
      contentType: AUDIO_SPEECH_CONTENT_TYPES.pcm,
      buffer: placeholderPcmBuffer(speech),
    };
  }
  return {
    contentType: AUDIO_SPEECH_CONTENT_TYPES[format] || "application/octet-stream",
    buffer: Buffer.concat([
      format === "mp3" ? Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "binary") : Buffer.alloc(0),
      Buffer.from(`open-codex-audio:${format}:${speech.model}:${speech.voice}:${speech.input}\n`, "utf8"),
    ]),
  };
}

function placeholderWavBuffer(speech = {}) {
  const sampleRate = 24000;
  const samples = Math.max(1200, Math.min(24000, Math.trunc(stringifyContent(speech.input).length * 120)));
  const pcm = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function placeholderPcmBuffer(speech = {}) {
  const samples = Math.max(1200, Math.min(24000, Math.trunc(stringifyContent(speech.input).length * 120)));
  return Buffer.alloc(samples * 2);
}

function writeAudioSpeechStream(res, speech, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const b64 = content.buffer.toString("base64");
  writeSse(res, "speech.audio.delta", {
    type: "speech.audio.delta",
    delta: b64,
    audio: b64,
    format: speech.response_format,
  });
  writeSse(res, "speech.audio.done", {
    type: "speech.audio.done",
    format: speech.response_format,
  });
  res.end();
}

async function readAudioFileRequest(req, config = {}) {
  const contentType = req.headers["content-type"] || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const maxBytes = Number(config.audioMaxInputBytes || 25 * 1024 * 1024);
    const form = parseMultipartFormBinary(await readRawBody(req, maxBytes + 1024 * 1024), contentType);
    const file = form.files.find((item) => item.name === "file") || form.files[0];
    return {
      ...form.fields,
      ...(file ? {
        file_upload: {
          filename: file.filename,
          content_type: file.content_type || "application/octet-stream",
          content: file.content,
        },
      } : {}),
    };
  }
  if (!contentType || contentType.includes("application/json")) return await readJson(req);
  throw requestError("audio requests must use application/json or multipart/form-data", {
    status: 415,
    code: "unsupported_content_type",
    param: "content-type",
  });
}

function normalizeAudioTranscriptRequest(request = {}, config = {}, task = "transcribe") {
  if (!isPlainObject(request)) {
    throw requestError("audio request body must be an object", {
      code: "invalid_request_body",
    });
  }
  const file = resolveAudioRequestFile(request, config);
  const model = stringifyContent(request.model || (task === "translate" ? config.audioTranslationModel : config.audioTranscriptionModel) || "whisper-1");
  const responseFormat = normalizeAudioTranscriptFormat(request.response_format, task);
  return {
    task,
    model,
    file,
    prompt: stringifyContent(request.prompt || ""),
    language: stringifyContent(request.language || ""),
    response_format: responseFormat,
    stream: task === "transcribe" && (request.stream === true || String(request.stream || "").toLowerCase() === "true"),
    temperature: request.temperature,
    include: normalizeArrayField(request.include),
    timestamp_granularities: normalizeArrayField(request.timestamp_granularities || request["timestamp_granularities[]"]),
  };
}

function resolveAudioRequestFile(request = {}, config = {}) {
  const maxBytes = Number(config.audioMaxInputBytes || 25 * 1024 * 1024);
  if (request.file_upload?.content) {
    return normalizeAudioBuffer({
      buffer: request.file_upload.content,
      filename: request.file_upload.filename || "audio",
      contentType: request.file_upload.content_type,
      maxBytes,
    });
  }

  const source = audioDataSource(request);
  if (!source) {
    throw requestError("file is required", {
      code: "missing_required_parameter",
      param: "file",
    });
  }
  const parsed = parseAudioData(source.value, source.contentType);
  if (!parsed) {
    throw requestError("audio file data must be base64 encoded", {
      code: "invalid_audio_file",
      param: source.param,
    });
  }
  return normalizeAudioBuffer({
    buffer: parsed.buffer,
    filename: source.filename || "audio",
    contentType: parsed.contentType || source.contentType,
    maxBytes,
  });
}

function audioDataSource(request = {}) {
  const fromFile = request.file;
  if (isPlainObject(fromFile)) {
    const value = fromFile.data || fromFile.file_data || fromFile.audio_data || fromFile.content_base64 || fromFile.b64_json;
    if (value) {
      return {
        value,
        filename: fromFile.filename || fromFile.name,
        contentType: fromFile.content_type || fromFile.mime_type || fromFile.media_type,
        param: "file",
      };
    }
  }
  if (typeof fromFile === "string" && fromFile.trim()) {
    return {
      value: fromFile,
      filename: request.filename,
      contentType: request.content_type || request.mime_type || request.media_type,
      param: "file",
    };
  }
  for (const key of ["file_data", "audio_data", "data", "content_base64"]) {
    if (typeof request[key] === "string" && request[key].trim()) {
      return {
        value: request[key],
        filename: request.filename,
        contentType: request.content_type || request.mime_type || request.media_type,
        param: key,
      };
    }
  }
  return null;
}

function parseAudioData(value, contentType = "") {
  const text = String(value || "").trim();
  const dataUrl = text.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is);
  const encoded = dataUrl ? dataUrl[2] : text;
  const normalized = encoded.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    return {
      buffer: Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64"),
      contentType: dataUrl?.[1] || contentType || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function normalizeAudioBuffer({ buffer, filename, contentType, maxBytes }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw requestError("audio file is empty", {
      code: "invalid_audio_file",
      param: "file",
    });
  }
  if (buffer.length > maxBytes) {
    throw requestError(`audio file exceeds local limit of ${maxBytes} bytes`, {
      code: "audio_file_too_large",
      param: "file",
    });
  }
  return {
    filename: stringifyContent(filename || "audio").split(/[\\/]/).pop() || "audio",
    content_type: stringifyContent(contentType || "application/octet-stream"),
    bytes: buffer.length,
    content: buffer,
  };
}

function normalizeAudioTranscriptFormat(value, task) {
  const fallback = "json";
  const format = String(value || fallback).trim().toLowerCase();
  const allowed = task === "translate"
    ? new Set(["json", "text", "srt", "verbose_json", "vtt"])
    : new Set(["json", "text", "srt", "verbose_json", "vtt", "diarized_json"]);
  if (allowed.has(format)) return format;
  throw requestError(`unsupported audio response_format: ${format || "empty"}`, {
    code: "invalid_request_parameter",
    param: "response_format",
  });
}

function normalizeArrayField(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map((item) => stringifyContent(item)).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function placeholderAudioTranscriptText(normalized = {}, task = "transcribe") {
  const action = task === "translate" ? "translation in English" : "transcription";
  const prompt = normalized.prompt ? ` Prompt hint: ${normalized.prompt}` : "";
  return `Local audio ${action} placeholder for ${normalized.file.filename} (${normalized.file.bytes} bytes).${prompt}`.trim();
}

function createAudioTranscriptResponse(normalized = {}, text = "", task = "transcribe") {
  const duration = estimateAudioDuration(normalized.file);
  const usage = { type: "duration", seconds: Math.max(1, Math.ceil(duration)) };
  const format = normalized.response_format || "json";
  const compatibility = audioTranscriptCompatibility(normalized, task);
  if (format === "text") {
    return { kind: "text", contentType: "text/plain; charset=utf-8", text: `${text}\n` };
  }
  if (format === "srt") {
    return { kind: "text", contentType: "text/plain; charset=utf-8", text: audioSrt(text, duration) };
  }
  if (format === "vtt") {
    return { kind: "text", contentType: "text/vtt; charset=utf-8", text: audioVtt(text, duration) };
  }

  if (format === "verbose_json") {
    return {
      kind: "json",
      body: {
        task,
        language: task === "translate" ? "english" : (normalized.language || "unknown"),
        duration,
        text,
        segments: [verboseAudioSegment(text, duration)],
        usage,
        compatibility,
      },
    };
  }

  if (format === "diarized_json") {
    return {
      kind: "json",
      body: {
        task: "transcribe",
        duration,
        text: `A: ${text}`,
        segments: [{
          type: "transcript.text.segment",
          id: "seg_001",
          start: 0,
          end: duration,
          text,
          speaker: "A",
        }],
        usage,
        compatibility,
      },
    };
  }

  return {
    kind: "json",
    body: {
      text,
      usage,
      compatibility,
    },
  };
}

function audioTranscriptCompatibility(normalized = {}, task = "transcribe") {
  return {
    provider: "local",
    operation: task === "translate" ? "audio_translation" : "audio_transcription",
    model: normalized.model,
    file: {
      filename: normalized.file?.filename || "audio",
      bytes: normalized.file?.bytes || 0,
      content_type: normalized.file?.content_type || "application/octet-stream",
    },
  };
}

function verboseAudioSegment(text, duration) {
  return {
    id: 0,
    seek: 0,
    start: 0,
    end: duration,
    text,
    tokens: [],
    temperature: 0,
    avg_logprob: 0,
    compression_ratio: 1,
    no_speech_prob: 0,
  };
}

function estimateAudioDuration(file = {}) {
  const seconds = Number(file.duration || 0);
  if (Number.isFinite(seconds) && seconds > 0) return Number(seconds.toFixed(3));
  const estimated = Math.max(1, Math.min(600, (file.bytes || 0) / 16000));
  return Number(estimated.toFixed(3));
}

function audioTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function audioSrt(text, duration) {
  return `1\n${audioTimestamp(0)} --> ${audioTimestamp(duration)}\n${text}\n`;
}

function audioVtt(text, duration) {
  return `WEBVTT\n\n00:00:00.000 --> ${audioTimestamp(duration).replace(",", ".")}\n${text}\n`;
}

function writeAudioTranscriptStream(res, normalized, text) {
  const usage = { type: "duration", seconds: Math.max(1, Math.ceil(estimateAudioDuration(normalized.file))) };
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  writeSse(res, "transcript.text.delta", {
    type: "transcript.text.delta",
    delta: text,
  });
  writeSse(res, "transcript.text.done", {
    type: "transcript.text.done",
    text,
    usage,
  });
  res.end();
}

async function handleAudioVoiceConsentsCreate(req, res, config, audioVoiceStore) {
  try {
    if (!canUseLocalAudio(config)) {
      sendError(res, 400, "local audio compatibility is disabled", {
        type: "invalid_request_error",
        code: "audio_disabled",
        param: "provider",
      });
      return;
    }
    const request = await readAudioNamedFileRequest(req, config, "recording");
    const consent = audioVoiceStore.createConsent({
      name: normalizeCustomVoiceName(request.name, "name"),
      language: normalizeVoiceConsentLanguage(request.language),
      recording: resolveCustomVoiceAudioFile(request, config, "recording"),
    });
    sendJson(res, 200, consent);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "voice consent request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "voice_consent_error",
      param: error.param || null,
    });
  }
}

function handleAudioVoiceConsentsList(res, audioVoiceStore, url) {
  sendJson(res, 200, paginateList(audioVoiceStore.listConsents(), url));
}

function handleAudioVoiceConsentGet(res, audioVoiceStore, consentId) {
  const consent = audioVoiceStore.getConsent(consentId);
  if (!consent) {
    sendError(res, 404, `voice consent not found: ${consentId}`, {
      type: "invalid_request_error",
      code: "voice_consent_not_found",
      param: "consent_id",
    });
    return;
  }
  sendJson(res, 200, consent);
}

async function handleAudioVoicesCreate(req, res, config, audioVoiceStore) {
  try {
    if (!canUseLocalAudio(config)) {
      sendError(res, 400, "local audio compatibility is disabled", {
        type: "invalid_request_error",
        code: "audio_disabled",
        param: "provider",
      });
      return;
    }
    const request = await readAudioNamedFileRequest(req, config, "audio_sample");
    const consentId = normalizeVoiceConsentReference(request.consent);
    if (!audioVoiceStore.getConsent(consentId)) {
      throw requestError(`voice consent not found: ${consentId}`, {
        status: 404,
        code: "voice_consent_not_found",
        param: "consent",
      });
    }
    const voice = audioVoiceStore.createVoice({
      name: normalizeCustomVoiceName(request.name, "name"),
      consent: consentId,
      audioSample: resolveCustomVoiceAudioFile(request, config, "audio_sample"),
    });
    sendJson(res, 200, voice);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "custom voice request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "custom_voice_error",
      param: error.param || null,
    });
  }
}

function handleAudioVoicesList(res, audioVoiceStore, url) {
  sendJson(res, 200, paginateList(audioVoiceStore.listVoices(), url));
}

function handleAudioVoiceGet(res, audioVoiceStore, voiceId) {
  const voice = audioVoiceStore.getVoice(voiceId);
  if (!voice) {
    sendError(res, 404, `voice not found: ${voiceId}`, {
      type: "invalid_request_error",
      code: "voice_not_found",
      param: "voice_id",
    });
    return;
  }
  sendJson(res, 200, voice);
}

async function readAudioNamedFileRequest(req, config = {}, fileField = "file") {
  const contentType = req.headers["content-type"] || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const maxBytes = Number(config.audioVoiceMaxInputBytes || config.audioMaxInputBytes || 25 * 1024 * 1024);
    const form = parseMultipartFormBinary(await readRawBody(req, maxBytes + 1024 * 1024), contentType);
    const file = form.files.find((item) => item.name === fileField);
    return {
      ...form.fields,
      ...(file ? {
        [`${fileField}_upload`]: {
          filename: file.filename,
          content_type: file.content_type || "application/octet-stream",
          content: file.content,
        },
      } : {}),
    };
  }
  if (!contentType || contentType.includes("application/json")) return await readJson(req);
  throw requestError("custom voice requests must use application/json or multipart/form-data", {
    status: 415,
    code: "unsupported_content_type",
    param: "content-type",
  });
}

function normalizeCustomVoiceName(value, param = "name") {
  const name = stringifyContent(value).trim();
  if (!name) {
    throw requestError(`${param} is required`, {
      code: "missing_required_parameter",
      param,
    });
  }
  if (name.length > 128) {
    throw requestError(`${param} must be at most 128 characters`, {
      code: "invalid_request_parameter",
      param,
    });
  }
  return name;
}

function normalizeVoiceConsentLanguage(value) {
  const language = stringifyContent(value).trim();
  if (!language) {
    throw requestError("language is required", {
      code: "missing_required_parameter",
      param: "language",
    });
  }
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(language)) {
    throw requestError("language must be a BCP-47-like language code", {
      code: "invalid_request_parameter",
      param: "language",
    });
  }
  return language.replace(/_/g, "-");
}

function normalizeVoiceConsentReference(value) {
  const consent = stringifyContent(value).trim();
  if (!consent) {
    throw requestError("consent is required", {
      code: "missing_required_parameter",
      param: "consent",
    });
  }
  if (!/^cons_[A-Za-z0-9_-]+$/.test(consent)) {
    throw requestError("consent must be a voice consent id", {
      code: "invalid_request_parameter",
      param: "consent",
    });
  }
  return consent;
}

function resolveCustomVoiceAudioFile(request = {}, config = {}, fieldName = "recording") {
  const maxBytes = Number(config.audioVoiceMaxInputBytes || config.audioMaxInputBytes || 25 * 1024 * 1024);
  const upload = request[`${fieldName}_upload`];
  let file = null;
  if (upload?.content) {
    file = normalizeAudioBuffer({
      buffer: upload.content,
      filename: upload.filename || fieldName,
      contentType: upload.content_type,
      maxBytes,
    });
  } else {
    const source = customVoiceAudioDataSource(request, fieldName);
    if (!source) {
      throw requestError(`${fieldName} is required`, {
        code: "missing_required_parameter",
        param: fieldName,
      });
    }
    const parsed = parseAudioData(source.value, source.contentType);
    if (!parsed) {
      throw requestError(`${fieldName} must be base64 encoded`, {
        code: "invalid_audio_file",
        param: fieldName,
      });
    }
    file = normalizeAudioBuffer({
      buffer: parsed.buffer,
      filename: source.filename || fieldName,
      contentType: parsed.contentType || source.contentType,
      maxBytes,
    });
  }
  validateCustomVoiceAudioFile(file, fieldName);
  return customVoiceAudioMetadata(file);
}

function customVoiceAudioDataSource(request = {}, fieldName = "recording") {
  const source = request[fieldName];
  if (isPlainObject(source)) {
    const value = source.data || source.file_data || source.audio_data || source.content_base64 || source.b64_json;
    if (value) {
      return {
        value,
        filename: source.filename || source.name,
        contentType: source.content_type || source.mime_type || source.media_type,
      };
    }
  }
  if (typeof source === "string" && source.trim()) {
    return {
      value: source,
      filename: request[`${fieldName}_filename`] || request.filename,
      contentType: request[`${fieldName}_content_type`] || request.content_type,
    };
  }
  const fallbackKeys = [`${fieldName}_data`, `${fieldName}_base64`, `${fieldName}_content_base64`];
  for (const key of fallbackKeys) {
    if (typeof request[key] === "string" && request[key].trim()) {
      return {
        value: request[key],
        filename: request[`${fieldName}_filename`] || request.filename,
        contentType: request[`${fieldName}_content_type`] || request.content_type,
      };
    }
  }
  return null;
}

function validateCustomVoiceAudioFile(file = {}, param = "file") {
  const extension = audioFileExtension(file.filename);
  const contentType = String(file.content_type || "").toLowerCase();
  if (AUDIO_CUSTOM_VOICE_EXTENSIONS.has(extension)) return;
  if (AUDIO_CUSTOM_VOICE_CONTENT_TYPES.has(contentType)) return;
  throw requestError(`${param} must be an audio sample of type mpeg, wav, ogg, aac, flac, webm, or mp4`, {
    code: "unsupported_audio_format",
    param,
  });
}

function audioFileExtension(filename = "") {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return "";
  return match[1] === "mp3" ? "mpeg" : match[1];
}

function customVoiceAudioMetadata(file = {}) {
  const format = audioFileExtension(file.filename) || String(file.content_type || "").split("/").pop() || "audio";
  return {
    filename: file.filename,
    bytes: file.bytes,
    content_type: file.content_type,
    format,
    sha256: crypto.createHash("sha256").update(file.content || Buffer.alloc(0)).digest("hex"),
  };
}

function requestError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 400;
  error.code = details.code || "invalid_request_error";
  error.type = details.type || "invalid_request_error";
  error.param = details.param || null;
  return error;
}

async function handleImagesGenerations(req, res, config) {
  let request;
  try {
    request = await readJson(req);
    if (request.stream === true) {
      const events = await createImagesGenerationEventStream(request, config);
      await writeImageApiEventStream(res, events, "streaming image responses require b64_json output");
      return;
    }
    const response = await createImagesGenerationResponse(request, config);
    sendJson(res, 200, response);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "image generation request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "image_generation_error",
      param: error.param || null,
    });
  }
}

async function handleImagesEdits(req, res, config, fileSearchStore, imageGenerationStore) {
  let request;
  try {
    request = await readImagesEditRequest(req, config);
    if (request.stream === true || String(request.stream || "").toLowerCase() === "true") {
      const events = await createImagesEditEventStream(request, config, {
        fileSearchStore,
        imageGenerationStore,
        fetch: globalThis.fetch,
      });
      await writeImageApiEventStream(res, events, "streaming image edit responses require b64_json output");
      return;
    }
    const response = await createImagesEditResponse(request, config, {
      fileSearchStore,
      imageGenerationStore,
      fetch: globalThis.fetch,
    });
    sendJson(res, 200, response);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "image edit request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "image_edit_error",
      param: error.param || null,
    });
  }
}

async function handleImagesVariations(req, res, config, fileSearchStore, imageGenerationStore) {
  let request;
  try {
    request = await readImagesVariationRequest(req, config);
    const response = await createImagesVariationResponse(request, config, {
      fileSearchStore,
      imageGenerationStore,
      fetch: globalThis.fetch,
    });
    sendJson(res, 200, response);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "image variation request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "image_variation_error",
      param: error.param || null,
    });
  }
}

async function handleVideosCreate(req, res, config, store, options = {}) {
  try {
    const request = await readVideoCreateRequest(req, config);
    const video = createLocalVideoResource(request, config, options);
    store.put(video.id, {
      video,
      video_request: sanitizeVideoRequestForStore(request),
    });
    sendJson(res, 200, video);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "video request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "video_generation_error",
      param: error.param || null,
    });
  }
}

async function handleVideoCharacterCreate(req, res, config, store) {
  try {
    const request = await readVideoCharacterCreateRequest(req, config);
    const character = createLocalVideoCharacterResource(request, config);
    store.put(character.id, {
      video_character: character,
      video_character_request: sanitizeVideoCharacterRequestForStore(request),
    });
    sendJson(res, 200, character);
  } catch (error) {
    sendError(res, error.status || 400, error.message || "video character request failed", {
      type: error.type || "invalid_request_error",
      code: error.code || "video_character_error",
      param: error.param || null,
    });
  }
}

function handleVideosList(res, store, url) {
  const videos = store.list()
    .filter((record) => record?.video)
    .map((record) => clone(record.video))
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  sendJson(res, 200, paginateVideosList(videos, url));
}

function handleVideoCharacterGet(res, store, characterId) {
  const record = store.get(characterId);
  if (!record?.video_character) {
    sendError(res, 404, `video character not found: ${characterId}`, { code: "video_character_not_found" });
    return;
  }
  sendJson(res, 200, record.video_character);
}

function handleVideoCharacterDelete(res, store, characterId) {
  const record = store.get(characterId);
  if (!record?.video_character) {
    sendError(res, 404, `video character not found: ${characterId}`, { code: "video_character_not_found" });
    return;
  }
  const deleted = store.delete(characterId);
  if (!deleted) {
    sendError(res, 404, `video character not found: ${characterId}`, { code: "video_character_not_found" });
    return;
  }
  sendJson(res, 200, {
    id: characterId,
    object: "video.character.deleted",
    deleted: true,
  });
}

function handleVideoGet(res, store, videoId) {
  const record = store.get(videoId);
  if (!record?.video) {
    sendError(res, 404, `video not found: ${videoId}`, { code: "video_not_found" });
    return;
  }
  sendJson(res, 200, record.video);
}

function handleVideoDelete(res, store, videoId) {
  const record = store.get(videoId);
  if (!record?.video) {
    sendError(res, 404, `video not found: ${videoId}`, { code: "video_not_found" });
    return;
  }
  const deleted = store.delete(videoId);
  if (!deleted) {
    sendError(res, 404, `video not found: ${videoId}`, { code: "video_not_found" });
    return;
  }
  sendJson(res, 200, {
    id: videoId,
    object: "video.deleted",
    deleted: true,
  });
}

function handleVideoContent(res, store, videoId, url) {
  const record = store.get(videoId);
  if (!record?.video) {
    sendError(res, 404, `video not found: ${videoId}`, { code: "video_not_found" });
    return;
  }

  const variant = String(url.searchParams.get("variant") || "video").trim().toLowerCase();
  if (!LOCAL_VIDEO_CONTENT_VARIANTS.has(variant)) {
    sendError(res, 400, `unsupported video content variant: ${variant}`, {
      type: "invalid_request_error",
      code: "unsupported_video_variant",
      param: "variant",
    });
    return;
  }

  if (record.video.status !== "completed") {
    sendError(res, 409, `video is not completed: ${videoId}`, {
      type: "invalid_request_error",
      code: "video_not_completed",
    });
    return;
  }

  const content = placeholderVideoContent(record.video, variant);
  res.writeHead(200, {
    "content-type": content.contentType,
    "content-length": content.buffer.length,
    "cache-control": "no-store",
    "x-video-id": videoId,
    "x-video-variant": variant,
  });
  res.end(content.buffer);
}

async function readVideoCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(
      await readRawBody(req, (config.videoGenerationMaxInputBytes || 50 * 1024 * 1024) + 1024 * 1024),
      contentType,
    );
    const videoFile = form.files.find((file) => file.name === "video") || null;
    return normalizeVideoRequest({
      ...form.fields,
      ...(form.fields.metadata ? { metadata: parseJsonOrNull(form.fields.metadata) || form.fields.metadata } : {}),
      ...(form.fields.input_reference ? { input_reference: parseJsonOrNull(form.fields.input_reference) || form.fields.input_reference } : {}),
      ...(form.fields.characters ? { characters: parseJsonOrNull(form.fields.characters) || form.fields.characters } : {}),
      ...(videoFile ? { video: multipartFileDescriptor(videoFile) } : {}),
      reference_files: form.files.map((file) => ({
        name: file.name,
        filename: file.filename,
        content_type: file.content_type || "application/octet-stream",
        bytes: file.content.length,
      })),
    });
  }

  if (!contentType || contentType.includes("application/json")) {
    return normalizeVideoRequest(await readJson(req));
  }

  const error = new Error("video requests must use application/json or multipart/form-data");
  error.status = 415;
  error.code = "unsupported_content_type";
  error.param = "content-type";
  throw error;
}

async function readVideoCharacterCreateRequest(req, config) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    const form = parseMultipartFormBinary(
      await readRawBody(req, (config.videoGenerationMaxInputBytes || 50 * 1024 * 1024) + 1024 * 1024),
      contentType,
    );
    const video = form.files.find((file) => file.name === "video") || form.files[0];
    return normalizeVideoCharacterRequest({
      name: form.fields.name,
      metadata: parseJsonOrNull(form.fields.metadata) || {},
      video: video ? {
        name: video.name,
        filename: video.filename,
        content_type: video.content_type || "application/octet-stream",
        bytes: video.content.length,
      } : null,
    });
  }

  if (!contentType || contentType.includes("application/json")) {
    const body = await readJson(req);
    return normalizeVideoCharacterRequest({
      ...body,
      video: normalizeVideoCharacterJsonVideo(body?.video),
    });
  }

  const error = new Error("video character requests must use application/json or multipart/form-data");
  error.status = 415;
  error.code = "unsupported_content_type";
  error.param = "content-type";
  throw error;
}

function normalizeVideoRequest(body) {
  if (!isPlainObject(body)) {
    const error = new Error("video request body must be an object");
    error.status = 400;
    error.code = "invalid_video_request";
    throw error;
  }
  return clone(body);
}

function normalizeVideoCharacterRequest(body) {
  if (!isPlainObject(body)) {
    const error = new Error("video character request body must be an object");
    error.status = 400;
    error.code = "invalid_video_character_request";
    throw error;
  }
  return clone(body);
}

function normalizeVideoCharacterJsonVideo(video) {
  if (video == null) return null;
  if (typeof video === "string") {
    const data = decodeBase64Payload(video);
    return {
      filename: "character.mp4",
      content_type: "video/mp4",
      bytes: data.length,
    };
  }
  if (isPlainObject(video)) {
    const data = typeof video.data_base64 === "string"
      ? decodeBase64Payload(video.data_base64)
      : typeof video.data === "string"
        ? decodeBase64Payload(video.data)
        : null;
    return {
      filename: stringifyContent(video.filename || video.name || "character.mp4") || "character.mp4",
      content_type: stringifyContent(video.content_type || video.mime_type || "video/mp4") || "video/mp4",
      bytes: data ? data.length : Number(video.bytes || 0),
    };
  }
  return null;
}

function multipartFileDescriptor(file) {
  return {
    name: file.name,
    filename: file.filename,
    content_type: file.content_type || "application/octet-stream",
    bytes: file.content.length,
  };
}

function createLocalVideoResource(request, config, options = {}) {
  const prompt = stringifyContent(request.prompt).trim();
  const operation = options.operation || "create";
  if (!prompt) {
    const error = new Error("prompt is required");
    error.status = 400;
    error.code = "missing_required_parameter";
    error.param = "prompt";
    throw error;
  }

  const now = nowSeconds();
  const model = stringifyContent(request.model || config.videoGenerationModel || "sora-2").trim() || "sora-2";
  const size = stringifyContent(request.size || config.videoGenerationDefaultSize || "1280x720").trim() || "1280x720";
  const seconds = stringifyContent(request.seconds ?? request.duration ?? config.videoGenerationDefaultSeconds ?? "4").trim() || "4";
  const quality = stringifyContent(request.quality || config.videoGenerationDefaultQuality || "standard").trim() || "standard";
  const characters = normalizeVideoCharacterReferences(request.characters);
  const sourceVideo = normalizeVideoSourceDescriptor(request, options);
  if ((operation === "edit" || operation === "extend") && !sourceVideo) {
    const error = new Error("video is required");
    error.status = 400;
    error.code = "missing_required_parameter";
    error.param = "video";
    throw error;
  }
  const metadata = isPlainObject(request.metadata) ? clone(request.metadata) : {};
  metadata.compatibility = mergeCompatibility(metadata.compatibility, {
    provider: "local",
    mode: config.videoGenerationProvider || "placeholder",
    operation,
    status: "synchronously_completed",
    content_variants: Array.from(LOCAL_VIDEO_CONTENT_VARIANTS),
    batch_supported: operation === "create",
    character_count: characters.length,
    ...(sourceVideo ? { source_video: sourceVideo } : {}),
    upstream_provider: "chat_completion_incompatible",
  });

  return {
    id: prefixedId("video"),
    object: "video",
    created_at: now,
    status: "completed",
    model,
    progress: 100,
    seconds,
    size,
    quality,
    ...(characters.length ? { characters } : {}),
    ...(options.sourceVideoId ? { source_video_id: options.sourceVideoId } : {}),
    ...(sourceVideo ? { source_video: sourceVideo } : {}),
    metadata,
  };
}

function normalizeVideoSourceDescriptor(request = {}, options = {}) {
  if (options.sourceVideoId) return { type: "video_id", id: stringifyContent(options.sourceVideoId) };
  const value = request.video ?? request.source_video ?? request.input_video ?? null;
  if (value != null) return normalizeVideoSourceValue(value);
  const referenceFiles = Array.isArray(request.reference_files) ? request.reference_files : [];
  const videoReference = referenceFiles.find((file) => file?.name === "video")
    || referenceFiles.find((file) => String(file?.content_type || "").startsWith("video/"));
  return videoReference ? normalizeVideoSourceValue(videoReference) : null;
}

function normalizeVideoSourceValue(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    if (/^https?:\/\//i.test(text)) return { type: "video_url", url: text };
    if (/^(video|file)_[A-Za-z0-9_-]+$/.test(text)) {
      return { type: text.startsWith("file_") ? "file_id" : "video_id", id: text };
    }
    const data = decodeBase64Payload(text);
    return {
      type: "uploaded_video",
      filename: "source.mp4",
      content_type: "video/mp4",
      bytes: data.length,
    };
  }
  if (!isPlainObject(value)) return null;

  const id = stringifyContent(value.id || value.video_id || value.file_id).trim();
  if (id) return { type: id.startsWith("file_") ? "file_id" : "video_id", id };
  const url = stringifyContent(value.video_url || value.url).trim();
  if (/^https?:\/\//i.test(url)) return { type: "video_url", url };

  const data = typeof value.data_base64 === "string"
    ? decodeBase64Payload(value.data_base64)
    : typeof value.data === "string"
      ? decodeBase64Payload(value.data)
      : null;
  const bytes = data ? data.length : Number(value.bytes || value.size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return {
    type: "uploaded_video",
    filename: stringifyContent(value.filename || value.name || "source.mp4") || "source.mp4",
    content_type: stringifyContent(value.content_type || value.mime_type || "video/mp4") || "video/mp4",
    bytes,
  };
}

function createLocalVideoCharacterResource(request, config) {
  const name = stringifyContent(request.name).trim();
  if (!name) {
    const error = new Error("name is required");
    error.status = 400;
    error.code = "missing_required_parameter";
    error.param = "name";
    throw error;
  }
  if (!isPlainObject(request.video) || !Number.isFinite(Number(request.video.bytes)) || Number(request.video.bytes) <= 0) {
    const error = new Error("video is required");
    error.status = 400;
    error.code = "missing_required_parameter";
    error.param = "video";
    throw error;
  }

  const now = nowSeconds();
  const sourceVideo = {
    filename: stringifyContent(request.video.filename || "character.mp4") || "character.mp4",
    content_type: stringifyContent(request.video.content_type || "video/mp4") || "video/mp4",
    bytes: Number(request.video.bytes),
  };
  const metadata = isPlainObject(request.metadata) ? clone(request.metadata) : {};
  metadata.compatibility = mergeCompatibility(metadata.compatibility, {
    provider: "local",
    mode: config.videoGenerationProvider || "placeholder",
    operation: "create_character",
    status: "synchronously_completed",
    source_video: sourceVideo,
    upstream_provider: "chat_completion_incompatible",
  });

  return {
    id: prefixedId("char"),
    object: "video.character",
    created_at: now,
    name,
    status: "completed",
    metadata,
    source_video: sourceVideo,
  };
}

function normalizeVideoCharacterReferences(value) {
  if (value == null || value === "") return [];
  const raw = typeof value === "string"
    ? (parseJsonOrNull(value) || value)
    : value;
  const entries = Array.isArray(raw) ? raw : [raw];
  if (entries.length > 2) {
    const error = new Error("characters must contain at most 2 entries");
    error.status = 400;
    error.code = "invalid_video_characters";
    error.param = "characters";
    throw error;
  }

  return entries.map((entry, index) => {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (!id) {
        const error = new Error("character id is required");
        error.status = 400;
        error.code = "invalid_video_character";
        error.param = `characters[${index}].id`;
        throw error;
      }
      return { id };
    }
    if (isPlainObject(entry)) {
      const id = stringifyContent(entry.id || entry.character_id || entry.character).trim();
      if (!id) {
        const error = new Error("character id is required");
        error.status = 400;
        error.code = "invalid_video_character";
        error.param = `characters[${index}].id`;
        throw error;
      }
      const normalized = { id };
      for (const key of ["name", "role"]) {
        if (entry[key] != null) normalized[key] = stringifyContent(entry[key]);
      }
      return normalized;
    }
    const error = new Error("character reference must be a string or object");
    error.status = 400;
    error.code = "invalid_video_character";
    error.param = `characters[${index}]`;
    throw error;
  });
}

function sanitizeVideoRequestForStore(request) {
  const sanitized = clone(request || {});
  for (const field of ["video", "image", "input_reference"]) {
    if (isPlainObject(sanitized[field]) && typeof sanitized[field].data === "string") {
      sanitized[field] = { ...sanitized[field], data: `[base64:${sanitized[field].data.length}]` };
    }
  }
  return sanitized;
}

function sanitizeVideoCharacterRequestForStore(request) {
  const sanitized = clone(request || {});
  if (isPlainObject(sanitized.video) && typeof sanitized.video.data === "string") {
    sanitized.video = { ...sanitized.video, data: `[base64:${sanitized.video.data.length}]` };
  }
  if (isPlainObject(sanitized.video) && typeof sanitized.video.data_base64 === "string") {
    sanitized.video = { ...sanitized.video, data_base64: `[base64:${sanitized.video.data_base64.length}]` };
  }
  return sanitized;
}

function placeholderVideoContent(video, variant) {
  if (variant === "thumbnail") {
    return {
      contentType: "image/webp",
      buffer: Buffer.concat([LOCAL_PLACEHOLDER_WEBP, Buffer.from(`\nopen-codex-video:${video.id}\n`)]),
    };
  }
  if (variant === "spritesheet") {
    return {
      contentType: "image/jpeg",
      buffer: Buffer.concat([LOCAL_PLACEHOLDER_JPEG, Buffer.from(`\nopen-codex-video:${video.id}\n`)]),
    };
  }
  return {
    contentType: "video/mp4",
    buffer: Buffer.concat([LOCAL_PLACEHOLDER_MP4, Buffer.from(`\nopen-codex-video:${video.id}\n`)]),
  };
}

function paginateVideosList(items, url) {
  const order = String(url.searchParams.get("order") || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const after = url.searchParams.get("after");
  const limit = parseLimit(url.searchParams.get("limit"), 20, 100);
  let data = items.map((item) => clone(item));
  if (order === "asc") data.reverse();
  if (after) {
    const index = data.findIndex((item) => item.id === after);
    data = index === -1 ? [] : data.slice(index + 1);
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

async function writeImageApiEventStream(res, events, emptyMessage) {
  if (Array.isArray(events) && !events.length) {
    sendError(res, 502, emptyMessage, {
      type: "image_provider_error",
      code: "invalid_image_provider_response",
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });

  let wrote = false;
  try {
    for await (const event of events || []) {
      if (!event?.event || !event?.data) continue;
      wrote = true;
      writeSse(res, event.event, event.data);
    }
    if (!wrote) {
      writeSse(res, "error", {
        error: {
          message: emptyMessage,
          type: "image_provider_error",
          code: "invalid_image_provider_response",
          param: null,
        },
      });
    }
  } catch (error) {
    writeSse(res, "error", {
      error: {
        message: error.message || "image streaming request failed",
        type: error.type || "image_provider_error",
        code: error.code || "image_stream_error",
        param: error.param || null,
      },
    });
  } finally {
    res.end();
  }
}

async function readImagesEditRequest(req, config = {}) {
  const contentType = req.headers["content-type"] || "";
  if (!/^multipart\/form-data\b/i.test(contentType)) return await readJson(req);

  const maxInputBytes = Number(config.imageGenerationMaxInputImageBytes || 50 * 1024 * 1024);
  const maxBodyBytes = Math.min(
    256 * 1024 * 1024,
    Math.max(1024 * 1024, Number.isFinite(maxInputBytes) ? maxInputBytes : 50 * 1024 * 1024) * 4 + 1024 * 1024,
  );
  const form = parseMultipartFormBinary(await readRawBody(req, maxBodyBytes), contentType);
  const imageFiles = form.files
    .filter((file) => ["image", "image[]", "images", "images[]"].includes(file.name))
    .map((file) => ({
      filename: file.filename,
      content_type: file.content_type,
      content: file.content,
    }));
  const maskFile = form.files.find((file) => file.name === "mask");
  return {
    ...form.fields,
    ...(imageFiles.length ? { image_files: imageFiles } : {}),
    ...(maskFile ? {
      mask_file: {
        filename: maskFile.filename,
        content_type: maskFile.content_type,
        content: maskFile.content,
      },
    } : {}),
  };
}

async function readImagesVariationRequest(req, config = {}) {
  const contentType = req.headers["content-type"] || "";
  if (!/^multipart\/form-data\b/i.test(contentType)) return await readJson(req);

  const maxInputBytes = Number(config.imageGenerationMaxInputImageBytes || 50 * 1024 * 1024);
  const maxBodyBytes = Math.min(
    256 * 1024 * 1024,
    Math.max(1024 * 1024, Number.isFinite(maxInputBytes) ? maxInputBytes : 50 * 1024 * 1024) + 1024 * 1024,
  );
  const form = parseMultipartFormBinary(await readRawBody(req, maxBodyBytes), contentType);
  const imageFile = form.files.find((file) => file.name === "image") || form.files[0];
  return {
    ...form.fields,
    ...(imageFile ? {
      image_files: [{
        filename: imageFile.filename,
        content_type: imageFile.content_type,
        content: imageFile.content,
      }],
    } : {}),
  };
}

function normalizeModerationInputs(input) {
  if (input === undefined || input === null) {
    const error = new Error("input is required");
    error.status = 400;
    throw error;
  }

  if (Array.isArray(input)) {
    if (!input.length) {
      const error = new Error("input array must not be empty");
      error.status = 400;
      throw error;
    }
    if (input.every((item) => typeof item === "string")) {
      return input.map((item) => moderationInputFromText(item));
    }
    if (input.some((item) => isModerationContentPart(item))) {
      return [moderationInputFromParts(input)];
    }
    return input.map((item) => moderationInputFromValue(item));
  }

  return [moderationInputFromValue(input)];
}

function moderationInputFromValue(value) {
  if (Array.isArray(value)) return moderationInputFromParts(value);
  if (isModerationContentPart(value)) return moderationInputFromParts([value]);
  return moderationInputFromText(stringifyContent(value));
}

function moderationInputFromText(text) {
  return {
    text: stringifyContent(text),
    input_types: ["text"],
  };
}

function moderationInputFromParts(parts) {
  const text = [];
  const inputTypes = [];
  for (const part of parts) {
    if (!isPlainObject(part)) {
      text.push(stringifyContent(part));
      inputTypes.push("text");
      continue;
    }
    const type = part.type || "text";
    if (type === "text" || type === "input_text" || part.text != null || part.content != null) {
      text.push(stringifyContent(part.text ?? part.content ?? ""));
      inputTypes.push("text");
      continue;
    }
    if (type === "image_url" || type === "input_image") {
      const caption = part.caption ?? part.alt_text ?? "";
      if (caption) {
        text.push(stringifyContent(caption));
        inputTypes.push("text");
      }
      inputTypes.push("image");
      continue;
    }
    text.push(stringifyContent(part));
    inputTypes.push("text");
  }
  return {
    text: text.filter(Boolean).join("\n"),
    input_types: [...new Set(inputTypes.length ? inputTypes : ["text"])],
  };
}

function isModerationContentPart(value) {
  if (!isPlainObject(value)) return false;
  return ["text", "input_text", "image_url", "input_image"].includes(value.type)
    || value.text != null
    || value.content != null
    || value.image_url != null;
}

function classifyModerationInput(input) {
  const normalized = String(input.text || "").toLowerCase();
  const baseScore = Math.min(0.15, 0.005 + normalized.length / 20000);
  const categories = Object.fromEntries(MODERATION_CATEGORIES.map((category) => [category, false]));
  const categoryScores = Object.fromEntries(MODERATION_CATEGORIES.map((category) => [category, score(baseScore)]));
  const mark = (category, value) => {
    categories[category] = true;
    categoryScores[category] = Math.max(categoryScores[category], score(value));
  };

  const violence = matchesAny(normalized, [
    /\bkill\b/,
    /\bmurder\b/,
    /\bshoot\b/,
    /\bstab\b/,
    /\bbomb\b/,
    /\battack\b/,
    /\bassault\b/,
    /\bbeat\b/,
    /\bweapon\b/,
  ]);
  const targetedThreat = matchesAny(normalized, [
    /\bi\s+(?:will|want to|am going to)\s+(?:kill|murder|shoot|stab|hurt|attack)\b/,
    /\b(?:kill|murder|shoot|stab|hurt|attack)\s+(?:you|him|her|them|people)\b/,
    /\byou\s+(?:should|deserve to)\s+(?:die|be hurt)\b/,
  ]);
  const graphicViolence = matchesAny(normalized, [
    /\bgore\b/,
    /\bgraphic\b/,
    /\bblood(?:y)?\b/,
    /\bdismember\b/,
    /\bcorpse\b/,
  ]);
  const harassment = matchesAny(normalized, [
    /\bidiot\b/,
    /\bmoron\b/,
    /\bloser\b/,
    /\btrash\b/,
    /\bworthless\b/,
    /\bshut up\b/,
    /\bi hate you\b/,
  ]);
  const hate = matchesAny(normalized, [
    /\bracial slur\b/,
    /\bethnic slur\b/,
    /\bdehumaniz(?:e|ing)\b/,
    /\bsupremacist\b/,
    /\bnazi\b/,
    /\bgenocide\b/,
  ]);
  const selfHarmIntent = matchesAny(normalized, [
    /\bkill myself\b/,
    /\bend my life\b/,
    /\bi want to die\b/,
    /\bsuicide\b/,
    /\boverdose\b/,
  ]);
  const selfHarmInstructions = matchesAny(normalized, [
    /\bhow to\s+(?:kill myself|commit suicide|self harm)\b/,
    /\bsuicide method\b/,
    /\bbest way to die\b/,
    /\bself harm instructions\b/,
  ]);
  const selfHarm = selfHarmIntent || selfHarmInstructions || matchesAny(normalized, [
    /\bself[- ]harm\b/,
    /\bcut myself\b/,
  ]);
  const sexual = matchesAny(normalized, [
    /\bsex(?:ual)?\b/,
    /\bporn\b/,
    /\bnude\b/,
    /\bexplicit\b/,
    /\berotic\b/,
  ]);
  const minors = matchesAny(normalized, [
    /\bminor\b/,
    /\bunderage\b/,
    /\bchild\b/,
    /\bchildren\b/,
  ]);
  const illicit = matchesAny(normalized, [
    /\bsteal\b/,
    /\bfraud\b/,
    /\bphishing\b/,
    /\bmalware\b/,
    /\bcounterfeit\b/,
    /\bexplosive\b/,
    /\billegal drug\b/,
    /\bbypass security\b/,
  ]);
  const violentIllicit = illicit && (violence || matchesAny(normalized, [/\bweapon\b/, /\bexplosive\b/, /\bbomb\b/]));

  if (harassment || targetedThreat) mark("harassment", targetedThreat ? 0.84 : 0.72);
  if (targetedThreat) mark("harassment/threatening", 0.92);
  if (sexual) mark("sexual", 0.76);
  if (sexual && minors) mark("sexual/minors", 0.95);
  if (hate) mark("hate", 0.82);
  if (hate && violence) mark("hate/threatening", 0.9);
  if (illicit) mark("illicit", violentIllicit ? 0.78 : 0.7);
  if (violentIllicit) mark("illicit/violent", 0.88);
  if (selfHarm) mark("self-harm", selfHarmInstructions ? 0.9 : 0.78);
  if (selfHarmIntent) mark("self-harm/intent", 0.9);
  if (selfHarmInstructions) mark("self-harm/instructions", 0.93);
  if (violence) mark("violence", targetedThreat ? 0.88 : 0.74);
  if (graphicViolence) mark("violence/graphic", 0.84);

  return {
    flagged: Object.values(categories).some(Boolean),
    categories,
    category_scores: categoryScores,
    category_applied_input_types: moderationAppliedInputTypes(input.input_types || ["text"]),
  };
}

function moderationAppliedInputTypes(inputTypes) {
  const unique = new Set(inputTypes);
  return Object.fromEntries(MODERATION_CATEGORIES.map((category) => {
    const applied = [];
    if (unique.has("text")) applied.push("text");
    if (unique.has("image") && MODERATION_IMAGE_AWARE_CATEGORIES.has(category)) applied.push("image");
    return [category, applied];
  }));
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function score(value) {
  return Number(Number(value || 0).toFixed(6));
}

function inlineModerationConfig(value) {
  if (value === undefined || value === null || value === false) {
    return { enabled: false, input: false, output: false };
  }
  if (value === true) return { enabled: true, input: true, output: true };
  if (!isPlainObject(value)) return { enabled: false, input: false, output: false };

  const input = value.input !== undefined ? value.input !== false && value.input !== null : false;
  const output = value.output !== undefined ? value.output !== false && value.output !== null : false;
  const enabled = input || output;
  return { enabled, input, output };
}

function attachLocalResponseInlineModeration(response, request, config) {
  if (!isPlainObject(response) || response.moderation !== undefined) return null;
  const options = inlineModerationConfig(request?.moderation);
  if (!options.enabled) return null;

  const moderation = {};
  const summary = {
    provider: "local",
    classifier: "deterministic-keyword-safety",
    reason: "requested_inline_moderation",
    requested: { input: options.input, output: options.output },
  };
  if (options.input) {
    moderation.input = localModerationPayload(moderationInputFromResponsesRequest(request), config, "input");
    summary.input = moderationSummary(moderation.input);
  }
  if (options.output) {
    moderation.output = localModerationPayload(moderationInputFromResponseOutput(response), config, "output");
    summary.output = moderationSummary(moderation.output);
  }
  response.moderation = moderation;
  return summary;
}

function attachLocalChatInlineModeration(completion, request, config) {
  if (!isPlainObject(completion) || completion.moderation !== undefined) return null;
  const options = inlineModerationConfig(request?.moderation);
  if (!options.enabled) return null;

  const moderation = {};
  const summary = {
    provider: "local",
    classifier: "deterministic-keyword-safety",
    reason: "requested_inline_moderation",
    requested: { input: options.input, output: options.output },
  };
  if (options.input) {
    moderation.input = localModerationPayload(moderationInputFromChatMessages(request.messages), config, "input");
    summary.input = moderationSummary(moderation.input);
  }
  if (options.output) {
    moderation.output = localModerationPayload(moderationInputFromChatCompletionOutput(completion), config, "output");
    summary.output = moderationSummary(moderation.output);
  }
  completion.moderation = moderation;
  return summary;
}

function localModerationPayload(input, config, scope) {
  return {
    id: prefixedId("modr"),
    model: config.moderationsModel || "omni-moderation-latest",
    results: [classifyModerationInput(input)],
    compatibility: {
      provider: "local",
      classifier: "deterministic-keyword-safety",
      scope,
      supports_image_inspection: false,
    },
  };
}

function moderationSummary(payload) {
  const results = payload?.results || [];
  return {
    id: payload?.id || null,
    model: payload?.model || null,
    result_count: results.length,
    flagged: results.some((result) => result?.flagged),
  };
}

function moderationInputFromResponsesRequest(request = {}) {
  const collector = createModerationCollector();
  collectModerationValue(request.instructions, collector);
  for (const item of normalizeStoredInputItems(request.input)) collectModerationValue(item, collector);
  return moderationInputFromCollector(collector);
}

function moderationInputFromResponseOutput(response = {}) {
  const collector = createModerationCollector();
  collectModerationValue(response.output, collector);
  return moderationInputFromCollector(collector);
}

function moderationInputFromChatMessages(messages = []) {
  const collector = createModerationCollector();
  collectModerationValue(messages, collector);
  return moderationInputFromCollector(collector);
}

function moderationInputFromChatCompletionOutput(completion = {}) {
  const collector = createModerationCollector();
  for (const choice of completion.choices || []) {
    collectModerationValue(choice?.message, collector);
  }
  return moderationInputFromCollector(collector);
}

function createModerationCollector() {
  return { text: [], inputTypes: new Set() };
}

function moderationInputFromCollector(collector) {
  const inputTypes = collector.inputTypes.size ? Array.from(collector.inputTypes) : ["text"];
  return {
    text: collector.text.filter(Boolean).join("\n"),
    input_types: inputTypes,
  };
}

function collectModerationValue(value, collector) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    addModerationText(collector, stringifyContent(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModerationValue(item, collector);
    return;
  }
  if (!isPlainObject(value)) {
    addModerationText(collector, stringifyContent(value));
    return;
  }

  const type = value.type || "";
  if (type === "image_url" || type === "input_image" || value.image_url != null) {
    collector.inputTypes.add("image");
    collectModerationValue(value.caption ?? value.alt_text ?? value.text, collector);
    return;
  }
  if (type === "input_text" || type === "output_text" || type === "text") {
    collectModerationValue(value.text ?? value.content, collector);
    return;
  }
  if (type === "message" || value.role) {
    collectModerationValue(value.content, collector);
    if (value.refusal) collectModerationValue(value.refusal, collector);
    if (value.reasoning_content) collectModerationValue(value.reasoning_content, collector);
    if (value.tool_calls) collectModerationValue(value.tool_calls, collector);
    if (value.function_call) collectModerationValue(value.function_call, collector);
    return;
  }
  if (type === "reasoning") {
    collectModerationValue(value.summary, collector);
    return;
  }
  if (type === "summary_text") {
    collectModerationValue(value.text, collector);
    return;
  }
  if (type === "function_call" || type === "function") {
    collectModerationValue(value.name, collector);
    collectModerationValue(value.arguments ?? value.function?.arguments, collector);
    return;
  }
  if (type === "function_call_output") {
    collectModerationValue(value.output, collector);
    return;
  }
  if (type === "refusal" || type === "output_refusal") {
    collectModerationValue(value.refusal ?? value.text, collector);
    return;
  }
  if (value.text !== undefined || value.content !== undefined) {
    collectModerationValue(value.text ?? value.content, collector);
    return;
  }
  if (value.arguments !== undefined) {
    collectModerationValue(value.arguments, collector);
    return;
  }
}

function addModerationText(collector, text) {
  const normalized = stringifyContent(text).trim();
  if (!normalized) return;
  collector.text.push(normalized);
  collector.inputTypes.add("text");
}

function normalizeEmbeddingInputs(input) {
  if (input === undefined || input === null) {
    const error = new Error("input is required");
    error.status = 400;
    throw error;
  }

  if (Array.isArray(input)) {
    if (!input.length) {
      const error = new Error("input array must not be empty");
      error.status = 400;
      throw error;
    }
    if (input.every((item) => Number.isInteger(item))) {
      return [embeddingInputFromTokenIds(input)];
    }
    return input.map((item) => Array.isArray(item) && item.every((token) => Number.isInteger(token))
      ? embeddingInputFromTokenIds(item)
      : embeddingInputFromText(item));
  }

  return [embeddingInputFromText(input)];
}

function embeddingInputFromTokenIds(tokens) {
  return {
    text: tokens.map((token) => String(token)).join(" "),
    tokens: tokens.length,
  };
}

function embeddingInputFromText(value) {
  const text = stringifyContent(value);
  return {
    text,
    tokens: estimateEmbeddingTokens(text),
  };
}

function estimateEmbeddingTokens(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.max(words, Math.ceil(normalized.length / 4)));
}

function normalizeRequestedEmbeddingDimensions(value, config) {
  const fallback = Number(config.embeddingsDimensions || LOCAL_EMBEDDING_DIMENSIONS);
  if (value == null) return { ok: true, value: fallback };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3072 || Math.trunc(parsed) !== parsed) {
    return { ok: false, error: "dimensions must be an integer between 1 and 3072" };
  }
  return { ok: true, value: parsed };
}

function normalizedEmbeddingVector(text, dimensions) {
  const vector = semanticVector(text, dimensions);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector.map(() => 0);
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function embeddingVectorToBase64(vector) {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer.toString("base64");
}

async function handleBatchCreate(req, res, config, store, fileSearchStore, imageGenerationStore, backgroundJobs, containerStore, conversationStore, skillStore) {
  const body = await readJson(req);
  const validation = validateBatchCreateRequest(body);
  if (!validation.ok) {
    sendError(res, validation.status, validation.message, validation.details);
    return;
  }

  if (!LOCAL_BATCH_ENDPOINTS.has(body.endpoint)) {
    sendError(res, 400, `local Batch API does not yet support endpoint: ${body.endpoint}`, {
      type: "invalid_request_error",
      code: "unsupported_batch_endpoint",
      param: "endpoint",
    });
    return;
  }

  const inputFile = fileSearchStore.getFile(body.input_file_id);
  const inputBuffer = fileSearchStore.getFileContentBuffer?.(body.input_file_id);
  if (!inputFile || inputBuffer == null) {
    sendError(res, 404, `file not found: ${body.input_file_id}`, {
      type: "invalid_request_error",
      code: "file_not_found",
      param: "input_file_id",
    });
    return;
  }
  if (inputFile.purpose !== "batch") {
    sendError(res, 400, "Batch input files must be uploaded with purpose=batch", {
      type: "invalid_request_error",
      code: "invalid_file_purpose",
      param: "input_file_id",
    });
    return;
  }

  const parsed = parseBatchInputJsonl(inputBuffer, {
    endpoint: body.endpoint,
    maxRequests: config.batchMaxRequests,
  });
  if (!parsed.ok) {
    sendError(res, parsed.status, parsed.message, parsed.details);
    return;
  }

  const now = nowSeconds();
  const batchId = prefixedId("batch");
  const outputLines = [];
  const errorLines = [];
  const batch = {
    id: batchId,
    object: "batch",
    endpoint: body.endpoint,
    errors: null,
    input_file_id: body.input_file_id,
    completion_window: body.completion_window,
    status: "in_progress",
    output_file_id: null,
    error_file_id: null,
    created_at: now,
    in_progress_at: now,
    expires_at: now + 24 * 60 * 60,
    finalizing_at: null,
    completed_at: null,
    failed_at: null,
    expired_at: null,
    cancelling_at: null,
    cancelled_at: null,
    request_counts: {
      total: parsed.requests.length,
      completed: 0,
      failed: 0,
    },
    metadata: isPlainObject(body.metadata) ? clone(body.metadata) : {},
  };
  if (isPlainObject(body.output_expires_after)) batch.output_expires_after = clone(body.output_expires_after);

  store.put(batchId, { batch: clone(batch) });

  for (const item of parsed.requests) {
    if (item.error) {
      errorLines.push(batchErrorLine(item.custom_id, item.line, item.error.code, item.error.message, item.error.param));
      continue;
    }

    const result = await executeLocalBatchRequest({
      endpoint: body.endpoint,
      requestBody: item.body,
      incomingHeaders: req.headers,
      config,
      store,
      backgroundJobs,
      fileSearchStore,
      imageGenerationStore,
      containerStore,
      conversationStore,
      skillStore,
    });
    if (result.ok) {
      outputLines.push(batchOutputLine(item.custom_id, result));
    } else {
      errorLines.push(batchErrorLine(item.custom_id, item.line, result.code, result.message, result.param, result.body));
    }
  }

  const finalizingAt = nowSeconds();
  let outputFile = null;
  let errorFile = null;
  try {
    outputFile = outputLines.length
      ? fileSearchStore.createFile({
        filename: `${batchId}_output.jsonl`,
        purpose: "batch_output",
        content: `${outputLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        metadata: { batch_id: batchId, endpoint: body.endpoint },
        mime_type: "application/jsonl",
      })
      : null;
    errorFile = errorLines.length
      ? fileSearchStore.createFile({
        filename: `${batchId}_error.jsonl`,
        purpose: "batch_error",
        content: `${errorLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        metadata: { batch_id: batchId, endpoint: body.endpoint },
        mime_type: "application/jsonl",
      })
      : null;
  } catch (error) {
    batch.status = "failed";
    batch.finalizing_at = finalizingAt;
    batch.failed_at = nowSeconds();
    batch.request_counts.completed = outputLines.length;
    batch.request_counts.failed = errorLines.length;
    batch.errors = {
      object: "list",
      data: [{
        code: error.code || "batch_output_file_error",
        message: error.message || "failed to write local batch output file",
        param: null,
        line: null,
      }],
    };
    store.put(batchId, { batch });
    sendJson(res, 200, batch);
    return;
  }

  batch.status = "completed";
  batch.finalizing_at = finalizingAt;
  batch.completed_at = nowSeconds();
  batch.output_file_id = outputFile?.id || null;
  batch.error_file_id = errorFile?.id || null;
  batch.request_counts.completed = outputLines.length;
  batch.request_counts.failed = errorLines.length;
  batch.metadata = {
    ...(batch.metadata || {}),
    compatibility: {
      provider: "local",
      execution: "synchronous",
      supported_endpoints: Array.from(LOCAL_BATCH_ENDPOINTS),
    },
  };
  store.put(batchId, {
    batch,
    batch_output_file_id: batch.output_file_id,
    batch_error_file_id: batch.error_file_id,
  });
  sendJson(res, 200, batch);
}

function validateBatchCreateRequest(body) {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      status: 400,
      message: "batch request body must be a JSON object",
      details: { type: "invalid_request_error", code: "invalid_batch_request" },
    };
  }
  for (const field of ["input_file_id", "endpoint", "completion_window"]) {
    if (!body[field]) {
      return {
        ok: false,
        status: 400,
        message: `${field} is required`,
        details: { type: "invalid_request_error", code: "missing_required_parameter", param: field },
      };
    }
  }
  if (body.completion_window !== "24h") {
    return {
      ok: false,
      status: 400,
      message: "completion_window must be 24h",
      details: { type: "invalid_request_error", code: "unsupported_completion_window", param: "completion_window" },
    };
  }
  return { ok: true };
}

function parseBatchInputJsonl(buffer, { endpoint, maxRequests }) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  const rawLines = text.split(/\r?\n/);
  const requests = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index].trim();
    if (!raw) continue;
    if (requests.length >= maxRequests) {
      return {
        ok: false,
        status: 400,
        message: `batch input exceeds local limit of ${maxRequests} requests`,
        details: { type: "invalid_request_error", code: "batch_too_large", param: "input_file_id" },
      };
    }
    requests.push(normalizeBatchRequestLine(raw, index + 1, endpoint));
  }
  if (!requests.length) {
    return {
      ok: false,
      status: 400,
      message: "batch input file must contain at least one JSONL request",
      details: { type: "invalid_request_error", code: "empty_batch_file", param: "input_file_id" },
    };
  }
  return { ok: true, requests };
}

function normalizeBatchRequestLine(raw, line, endpoint) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      line,
      custom_id: `line-${line}`,
      error: {
        code: "invalid_jsonl",
        message: `line ${line} is not valid JSON: ${error.message}`,
        param: "input_file_id",
      },
    };
  }

  const customId = parsed?.custom_id ? String(parsed.custom_id) : `line-${line}`;
  if (!isPlainObject(parsed)) {
    return {
      line,
      custom_id: customId,
      error: { code: "invalid_batch_line", message: "batch line must be an object", param: "input_file_id" },
    };
  }
  if (!parsed.custom_id) {
    return {
      line,
      custom_id: customId,
      error: { code: "missing_custom_id", message: "batch line custom_id is required", param: "custom_id" },
    };
  }
  if (String(parsed.method || "").toUpperCase() !== "POST") {
    return {
      line,
      custom_id: customId,
      error: { code: "unsupported_batch_method", message: "only POST batch requests are supported", param: "method" },
    };
  }
  const urlPath = normalizeBatchLineUrl(parsed.url);
  if (urlPath !== endpoint) {
    return {
      line,
      custom_id: customId,
      error: { code: "batch_endpoint_mismatch", message: `line url ${urlPath || "<missing>"} does not match batch endpoint ${endpoint}`, param: "url" },
    };
  }
  if (!isPlainObject(parsed.body)) {
    return {
      line,
      custom_id: customId,
      error: { code: "invalid_batch_body", message: "batch line body must be a JSON object", param: "body" },
    };
  }
  if (parsed.body.stream === true) {
    return {
      line,
      custom_id: customId,
      error: { code: "unsupported_batch_stream", message: "streaming requests are not supported in local Batch execution", param: "body.stream" },
    };
  }
  if (parsed.body.background === true) {
    return {
      line,
      custom_id: customId,
      error: { code: "unsupported_batch_background", message: "background Responses requests are not supported in local Batch execution", param: "body.background" },
    };
  }
  return { line, custom_id: customId, body: clone(parsed.body) };
}

function normalizeBatchLineUrl(value) {
  if (!value) return "";
  try {
    return new URL(String(value), "http://local").pathname;
  } catch {
    return "";
  }
}

async function executeLocalBatchRequest({ endpoint, requestBody, incomingHeaders, config, store, backgroundJobs, fileSearchStore, imageGenerationStore, containerStore, conversationStore, skillStore }) {
  const req = makeInternalJsonRequest(requestBody, incomingHeaders);
  const res = makeCaptureResponse();
  try {
    if (endpoint === "/v1/responses") {
      await handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, imageGenerationStore, containerStore, conversationStore, skillStore);
    } else if (endpoint === "/v1/chat/completions") {
      await handleChatPassthrough(req, res, config, store);
    } else if (endpoint === "/v1/completions") {
      await handleLegacyCompletions(req, res, config);
    } else if (endpoint === "/v1/embeddings") {
      await handleEmbeddings(req, res, config);
    } else if (endpoint === "/v1/audio/transcriptions") {
      await handleAudioTranscriptions(req, res, config);
    } else if (endpoint === "/v1/audio/translations") {
      await handleAudioTranslations(req, res, config);
    } else if (endpoint === "/v1/images/generations") {
      await handleImagesGenerations(req, res, config);
    } else if (endpoint === "/v1/images/edits") {
      await handleImagesEdits(req, res, config, fileSearchStore, imageGenerationStore);
    } else if (endpoint === "/v1/images/variations") {
      await handleImagesVariations(req, res, config, fileSearchStore, imageGenerationStore);
    } else if (endpoint === "/v1/videos") {
      await handleVideosCreate(req, res, config, store, { operation: "create" });
    } else if (endpoint === "/v1/moderations") {
      await handleModerations(req, res, config);
    } else {
      return {
        ok: false,
        status_code: 400,
        code: "unsupported_batch_endpoint",
        message: `unsupported local batch endpoint: ${endpoint}`,
        param: "endpoint",
      };
    }
  } catch (error) {
    return {
      ok: false,
      status_code: error.status || 500,
      code: error.code || "internal_batch_request_error",
      message: error.message || "internal batch request failed",
      param: error.param || null,
    };
  }

  const text = res.bodyText();
  const body = parseJsonOrNull(text) || (text ? { text } : {});
  const statusCode = res.statusCode || 200;
  if (statusCode >= 200 && statusCode < 300) {
    return {
      ok: true,
      status_code: statusCode,
      body,
      request_id: res.headers["x-request-id"] || prefixedId("req"),
    };
  }
  return {
    ok: false,
    status_code: statusCode,
    code: body?.error?.code || `http_${statusCode}`,
    message: body?.error?.message || text || `request failed with HTTP ${statusCode}`,
    param: body?.error?.param || null,
    body,
  };
}

function makeInternalJsonRequest(body, incomingHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body || {}));
  return {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(incomingHeaders?.["x-client-request-id"] ? { "x-client-request-id": incomingHeaders["x-client-request-id"] } : {}),
    },
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

function makeCaptureResponse() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
      this.headersSent = true;
    },
    write(chunk) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else if (ArrayBuffer.isView(chunk)) {
        chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      } else {
        chunks.push(Buffer.from(String(chunk)));
      }
      return true;
    },
    end(chunk) {
      if (chunk != null) this.write(chunk);
      this.writableEnded = true;
    },
    bodyText() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

function batchOutputLine(customId, result) {
  return {
    id: prefixedId("batch_req"),
    custom_id: customId,
    response: {
      status_code: result.status_code,
      request_id: result.request_id || prefixedId("req"),
      body: result.body,
    },
    error: null,
  };
}

function batchErrorLine(customId, line, code, message, param = null, body = null) {
  return {
    id: prefixedId("batch_req"),
    custom_id: customId || `line-${line}`,
    response: null,
    error: {
      code: code || "batch_request_failed",
      message: message || "batch request failed",
      param: param || null,
      ...(body ? { body } : {}),
    },
  };
}

async function handleEvalCreate(req, res, evalStore) {
  const body = await readJson(req);
  validateEvalBody(body, { requireCore: true });
  sendJson(res, 201, evalStore.createEval(body));
}

function handleEvalsList(res, evalStore, url) {
  const orderBy = url.searchParams.get("order_by") === "updated_at" ? "updated_at" : "created_at";
  const evals = evalStore.listEvals()
    .sort((a, b) => Number(a[orderBy] || 0) - Number(b[orderBy] || 0));
  sendJson(res, 200, paginateList(evals, url));
}

function handleEvalGet(res, evalStore, evalId) {
  const evalObject = evalStore.getEval(evalId);
  if (!evalObject) {
    sendError(res, 404, `eval not found: ${evalId}`, {
      type: "invalid_request_error",
      code: "eval_not_found",
      param: "eval_id",
    });
    return;
  }
  sendJson(res, 200, evalObject);
}

async function handleEvalUpdate(req, res, evalStore, evalId) {
  const body = await readJson(req);
  validateEvalBody(body, { requireCore: false });
  const evalObject = evalStore.updateEval(evalId, body);
  if (!evalObject) {
    sendError(res, 404, `eval not found: ${evalId}`, {
      type: "invalid_request_error",
      code: "eval_not_found",
      param: "eval_id",
    });
    return;
  }
  sendJson(res, 200, evalObject);
}

function handleEvalDelete(res, evalStore, evalId) {
  const deleted = evalStore.deleteEval(evalId);
  if (!deleted) {
    sendError(res, 404, `eval not found: ${evalId}`, {
      type: "invalid_request_error",
      code: "eval_not_found",
      param: "eval_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleEvalRunCreate(req, res, config, responseStore, fileSearchStore, imageGenerationStore, backgroundJobs, containerStore, conversationStore, skillStore, evalStore, evalId) {
  const evalObject = evalStore.getEval(evalId);
  if (!evalObject) {
    sendError(res, 404, `eval not found: ${evalId}`, {
      type: "invalid_request_error",
      code: "eval_not_found",
      param: "eval_id",
    });
    return;
  }

  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("eval run request body must be a JSON object", {
      type: "invalid_request_error",
      code: "invalid_eval_run_request",
    });
  }
  if (!isPlainObject(body.data_source)) {
    throw requestError("data_source is required", {
      type: "invalid_request_error",
      code: "missing_required_parameter",
      param: "data_source",
    });
  }

  const rows = loadEvalRows(body.data_source, fileSearchStore, config);
  const now = nowSeconds();
  const runId = prefixedId("evalrun");
  const model = String(body.data_source.model || body.model || config.defaultModel || "local");
  let run = {
    id: runId,
    object: "eval.run",
    eval_id: evalId,
    report_url: `local://evals/${evalId}/runs/${runId}`,
    status: "in_progress",
    model,
    name: String(body.name || "Local eval run"),
    created_at: now,
    started_at: now,
    completed_at: null,
    result_counts: { total: rows.length, errored: 0, failed: 0, passed: 0 },
    per_model_usage: null,
    per_testing_criteria_results: null,
    data_source: clone(body.data_source),
    error: null,
    metadata: isPlainObject(body.metadata) ? clone(body.metadata) : {},
  };
  evalStore.createRun(evalId, run, []);

  const outputItems = [];
  const criteriaAggregates = new Map();
  const usageAggregates = new Map();

  for (const row of rows) {
    const outputItem = await executeEvalRow({
      evalObject,
      run,
      row,
      config,
      responseStore,
      fileSearchStore,
      imageGenerationStore,
      backgroundJobs,
      containerStore,
      conversationStore,
      skillStore,
      incomingHeaders: req.headers,
      usageAggregates,
      criteriaAggregates,
    });
    outputItems.push(outputItem);
    if (outputItem.status === "passed") run.result_counts.passed += 1;
    else if (outputItem.status === "failed") run.result_counts.failed += 1;
    else run.result_counts.errored += 1;
  }

  run = {
    ...run,
    status: "completed",
    completed_at: nowSeconds(),
    per_model_usage: usageAggregates.size ? Array.from(usageAggregates.values()) : null,
    per_testing_criteria_results: Array.from(criteriaAggregates.values()),
    metadata: {
      ...(run.metadata || {}),
      compatibility: {
        provider: "local",
        execution: "synchronous",
        row_count: rows.length,
        supported_graders: SUPPORTED_GRADER_TYPES,
        reason: "evals_api_protocol_compatibility",
      },
    },
  };
  evalStore.createRun(evalId, run, outputItems);
  sendJson(res, 200, run);
}

function handleEvalRunsList(res, evalStore, evalId, url) {
  const runs = evalStore.listRuns(evalId);
  if (!runs) {
    sendError(res, 404, `eval not found: ${evalId}`, {
      type: "invalid_request_error",
      code: "eval_not_found",
      param: "eval_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(runs, url));
}

function handleEvalRunGet(res, evalStore, evalId, runId) {
  const run = evalStore.getRun(evalId, runId);
  if (!run) {
    sendError(res, 404, `eval run not found: ${runId}`, {
      type: "invalid_request_error",
      code: "eval_run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, run);
}

function handleEvalRunCancel(res, evalStore, evalId, runId) {
  const run = evalStore.cancelRun(evalId, runId);
  if (!run) {
    sendError(res, 404, `eval run not found: ${runId}`, {
      type: "invalid_request_error",
      code: "eval_run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, run);
}

function handleEvalRunOutputItemsList(res, evalStore, evalId, runId, url) {
  const items = evalStore.listOutputItems(evalId, runId);
  if (!items) {
    sendError(res, 404, `eval run not found: ${runId}`, {
      type: "invalid_request_error",
      code: "eval_run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(items, url));
}

function handleEvalRunOutputItemGet(res, evalStore, evalId, runId, outputItemId) {
  const item = evalStore.getOutputItem(evalId, runId, outputItemId);
  if (!item) {
    sendError(res, 404, `eval run output item not found: ${outputItemId}`, {
      type: "invalid_request_error",
      code: "eval_run_output_item_not_found",
      param: "output_item_id",
    });
    return;
  }
  sendJson(res, 200, item);
}

function validateEvalBody(body, { requireCore }) {
  if (!isPlainObject(body)) {
    throw requestError("eval request body must be a JSON object", {
      type: "invalid_request_error",
      code: "invalid_eval_request",
    });
  }
  if (requireCore || Object.prototype.hasOwnProperty.call(body, "data_source_config")) {
    if (!isPlainObject(body.data_source_config)) {
      throw requestError("data_source_config is required", {
        type: "invalid_request_error",
        code: "missing_required_parameter",
        param: "data_source_config",
      });
    }
  }
  if (requireCore || Object.prototype.hasOwnProperty.call(body, "testing_criteria")) {
    if (!Array.isArray(body.testing_criteria) || !body.testing_criteria.length) {
      throw requestError("testing_criteria must be a non-empty array", {
        type: "invalid_request_error",
        code: "missing_required_parameter",
        param: "testing_criteria",
      });
    }
  }
}

function loadEvalRows(dataSource, fileSearchStore, config) {
  const source = dataSource.source;
  if (isPlainObject(source) && source.type === "file_id") {
    const fileId = source.id || source.file_id;
    const file = fileSearchStore.getFile(fileId);
    const buffer = fileSearchStore.getFileContentBuffer?.(fileId);
    if (!file || buffer == null) {
      throw requestError(`file not found: ${fileId}`, {
        type: "invalid_request_error",
        code: "file_not_found",
        param: "data_source.source.id",
        status: 404,
      });
    }
    if (file.purpose !== "evals") {
      throw requestError("Eval input files must be uploaded with purpose=evals", {
        type: "invalid_request_error",
        code: "invalid_file_purpose",
        param: "data_source.source.id",
      });
    }
    return parseEvalJsonl(buffer, config.evalMaxRows);
  }

  if (isPlainObject(source) && Array.isArray(source.data)) {
    return normalizeEvalRows(source.data, config.evalMaxRows);
  }

  if (Array.isArray(dataSource.data)) {
    return normalizeEvalRows(dataSource.data, config.evalMaxRows);
  }

  throw requestError("data_source.source must reference a file_id or local inline data", {
    type: "invalid_request_error",
    code: "unsupported_eval_data_source",
    param: "data_source.source",
  });
}

function parseEvalJsonl(buffer, maxRows) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  const rows = [];
  const rawLines = text.split(/\r?\n/);
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index].trim();
    if (!raw) continue;
    if (rows.length >= maxRows) {
      throw requestError(`eval input exceeds local limit of ${maxRows} rows`, {
        type: "invalid_request_error",
        code: "eval_too_large",
        param: "data_source.source.id",
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw requestError(`line ${index + 1} is not valid JSON: ${error.message}`, {
        type: "invalid_request_error",
        code: "invalid_jsonl",
        param: "data_source.source.id",
      });
    }
    if (!isPlainObject(parsed)) {
      throw requestError(`line ${index + 1} must be a JSON object`, {
        type: "invalid_request_error",
        code: "invalid_eval_row",
        param: "data_source.source.id",
      });
    }
    rows.push(normalizeEvalRow(parsed, index + 1));
  }
  if (!rows.length) {
    throw requestError("eval input file must contain at least one JSONL row", {
      type: "invalid_request_error",
      code: "empty_eval_file",
      param: "data_source.source.id",
    });
  }
  return rows;
}

function normalizeEvalRows(values, maxRows) {
  if (values.length > maxRows) {
    throw requestError(`eval input exceeds local limit of ${maxRows} rows`, {
      type: "invalid_request_error",
      code: "eval_too_large",
      param: "data_source.data",
    });
  }
  return values.map((value, index) => normalizeEvalRow(value, index + 1));
}

function normalizeEvalRow(value, line) {
  const row = isPlainObject(value) ? clone(value) : { item: { value } };
  const item = isPlainObject(row.item) ? clone(row.item) : clone(row);
  return {
    id: row.id || row.custom_id || `row-${line}`,
    line,
    row,
    item,
  };
}

async function executeEvalRow(options) {
  const {
    evalObject,
    run,
    row,
    config,
    responseStore,
    fileSearchStore,
    imageGenerationStore,
    backgroundJobs,
    containerStore,
    conversationStore,
    skillStore,
    incomingHeaders,
    usageAggregates,
    criteriaAggregates,
  } = options;
  const createdAt = nowSeconds();
  let sample;
  let sampleError = null;
  try {
    const generated = await evalSampleForRow({
      dataSource: run.data_source,
      row,
      config,
      responseStore,
      fileSearchStore,
      imageGenerationStore,
      backgroundJobs,
      containerStore,
      conversationStore,
      skillStore,
      incomingHeaders,
    });
    sample = generated.sample;
    if (generated.usage) addEvalUsage(usageAggregates, generated.model || run.model, generated.usage);
  } catch (error) {
    sample = { output_text: "" };
    sampleError = {
      code: error.code || "eval_sample_error",
      message: error.message || "failed to create eval sample",
      param: error.param || null,
    };
  }

  const context = {
    item: row.item,
    sample,
    scoreModelRunner: (request) => runScoreModelGraderWithProvider(request, config, incomingHeaders),
    pythonGraderOptions: pythonGraderOptions(config),
  };
  let results;
  if (sampleError) {
    results = (evalObject.testing_criteria || []).map((criterion) => ({
        id: criterion.id || prefixedId("criterion"),
        name: criterion.name || criterion.type || "criterion",
        type: criterion.type || "string_check",
        status: "errored",
        passed: false,
        score: 0,
        error: clone(sampleError),
      }));
  } else {
    results = [];
    for (const criterion of evalObject.testing_criteria || []) {
      const result = await evaluateGraderAsync(criterion, context);
      if (result.token_usage) {
        addEvalUsage(usageAggregates, result.sampled_model_name || result.model || run.model, result.token_usage);
      }
      results.push(result);
    }
  }
  for (const result of results) addCriterionAggregate(criteriaAggregates, result);
  const status = sampleError
    ? "errored"
    : results.every((result) => result.status === "passed")
      ? "passed"
      : results.some((result) => result.status === "errored")
        ? "errored"
        : "failed";

  return {
    id: prefixedId("evalout"),
    object: "eval.run.output_item",
    eval_id: run.eval_id,
    run_id: run.id,
    created_at: createdAt,
    status,
    datasource_item_id: String(row.id),
    datasource_item: clone(row.row),
    item: clone(row.item),
    sample,
    results,
    error: sampleError,
    metadata: {
      line: row.line,
      compatibility: {
        provider: "local",
        reason: "eval_output_item_protocol_compatibility",
      },
    },
  };
}

async function evalSampleForRow({ dataSource, row, config, responseStore, fileSearchStore, imageGenerationStore, backgroundJobs, containerStore, conversationStore, skillStore, incomingHeaders }) {
  const provided = providedEvalSample(row.row);
  if (provided) return { sample: provided, usage: null, model: dataSource.model || config.defaultModel };

  const request = evalResponsesRequestForRow(dataSource, row.item, config);
  if (!request) {
    return {
      sample: {
        output_text: "",
        compatibility: {
          provider: "local",
          reason: "no_sample_or_supported_generation_prompt",
        },
      },
      usage: null,
      model: dataSource.model || config.defaultModel,
    };
  }

  const result = await executeLocalBatchRequest({
    endpoint: "/v1/responses",
    requestBody: request,
    incomingHeaders,
    config,
    store: responseStore,
    backgroundJobs,
    fileSearchStore,
    imageGenerationStore,
    containerStore,
    conversationStore,
    skillStore,
  });
  if (!result.ok) {
    const error = new Error(result.message || "eval sample generation failed");
    error.status = result.status_code || 500;
    error.code = result.code || "eval_sample_generation_failed";
    error.param = result.param || null;
    throw error;
  }

  return {
    sample: {
      output_text: extractResponseOutputText(result.body),
      response_id: result.body?.id || null,
      output: Array.isArray(result.body?.output) ? clone(result.body.output) : undefined,
    },
    usage: result.body?.usage || null,
    model: result.body?.model || request.model || config.defaultModel,
  };
}

function providedEvalSample(row) {
  if (!isPlainObject(row)) return null;
  if (isPlainObject(row.sample)) {
    const outputText = sampleOutputText(row.sample);
    if (outputText != null) return { ...clone(row.sample), output_text: outputText };
  }
  for (const key of ["sample_output_text", "output_text", "completion", "answer"]) {
    if (row[key] != null) return { output_text: stringifyContent(row[key]) };
  }
  return null;
}

function sampleOutputText(sample) {
  if (sample.output_text != null) return stringifyContent(sample.output_text);
  if (sample.text != null) return stringifyContent(sample.text);
  if (sample.output != null) return stringifyContent(sample.output);
  return null;
}

function evalResponsesRequestForRow(dataSource, item, config) {
  const type = String(dataSource.type || "responses");
  if (type !== "responses") return null;
  const input = evalInputForRow(dataSource.input_messages ?? dataSource.input ?? dataSource.messages, item);
  if (!input.length) return null;
  return {
    ...(isPlainObject(dataSource.sampling_params) ? clone(dataSource.sampling_params) : {}),
    model: dataSource.model || config.defaultModel,
    input,
    store: false,
  };
}

function evalInputForRow(value, item) {
  const input = isPlainObject(value) && value.type === "template" ? value.template : value;
  const rendered = renderTemplateValue(input, { item, sample: {} });
  if (Array.isArray(rendered)) return rendered;
  if (rendered == null || rendered === "") return [];
  return [{ role: "user", content: stringifyContent(rendered) }];
}

function extractResponseOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part?.type === "output_text")
    .map((part) => part.text || "")
    .join("");
}

function addEvalUsage(usageAggregates, model, usage) {
  if (!usage || !isPlainObject(usage)) return;
  const key = model || "unknown";
  const existing = usageAggregates.get(key) || {
    model_name: key,
    invocation_count: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cached_tokens: 0,
  };
  existing.invocation_count += 1;
  existing.prompt_tokens += Number(usage.input_tokens || usage.prompt_tokens || 0);
  existing.completion_tokens += Number(usage.output_tokens || usage.completion_tokens || 0);
  existing.total_tokens += Number(usage.total_tokens || 0);
  existing.cached_tokens += Number(usage.input_tokens_details?.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0);
  usageAggregates.set(key, existing);
}

function addCriterionAggregate(criteriaAggregates, result) {
  const existing = criteriaAggregates.get(result.id) || {
    testing_criteria: result.id,
    passed: 0,
    failed: 0,
    errored: 0,
  };
  if (result.status === "passed") existing.passed += 1;
  else if (result.status === "errored") existing.errored += 1;
  else existing.failed += 1;
  criteriaAggregates.set(result.id, existing);
}

async function handleGraderValidate(req, res, config) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("grader validate request body must be a JSON object", {
      code: "invalid_grader_request",
    });
  }
  if (!isPlainObject(body.grader)) {
    throw requestError("grader is required", {
      code: "missing_required_parameter",
      param: "grader",
    });
  }
  const grader = validateGrader(body.grader, { pythonGraderOptions: pythonGraderOptions(config) });
  sendJson(res, 200, { grader });
}

async function handleGraderRun(req, res, config) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("grader run request body must be a JSON object", {
      code: "invalid_grader_request",
    });
  }
  if (!isPlainObject(body.grader)) {
    throw requestError("grader is required", {
      code: "missing_required_parameter",
      param: "grader",
    });
  }
  if (body.item != null && !isPlainObject(body.item)) {
    throw requestError("item must be a JSON object when provided", {
      code: "invalid_grader_item",
      param: "item",
    });
  }
  const grader = validateGrader(body.grader, { pythonGraderOptions: pythonGraderOptions(config) });
  const sample = normalizeRunSample(body.model_sample, body.sample);
  const response = await runGraderAsync(grader, {
    item: isPlainObject(body.item) ? clone(body.item) : {},
    sample,
    scoreModelRunner: (request) => runScoreModelGraderWithProvider(request, config, req.headers),
    pythonGraderOptions: pythonGraderOptions(config),
  });
  sendJson(res, 200, response);
}

function handleOrganizationCosts(res, url) {
  sendJson(res, 200, createOrganizationCostsPage(url));
}

function handleOrganizationUsage(res, kind, url) {
  sendJson(res, 200, createOrganizationUsagePage(kind, url));
}

async function handleFineTuningJobCreate(req, res, fineTuningStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Fine-tuning job request body must be a JSON object", {
      code: "invalid_fine_tuning_job_request",
    });
  }
  if (!stringifyContent(body.training_file).trim()) {
    throw requestError("training_file is required", {
      code: "missing_required_parameter",
      param: "training_file",
    });
  }
  sendJson(res, 200, fineTuningStore.createJob(body));
}

function handleFineTuningJobsList(res, fineTuningStore, url) {
  const jobs = fineTuningStore.listJobs({ metadataFilter: fineTuningMetadataFilter(url) });
  sendJson(res, 200, paginateListWithDefaultOrder(jobs, url, "desc", 20, 100));
}

function handleFineTuningJobGet(res, fineTuningStore, jobId) {
  const job = fineTuningStore.getJob(jobId);
  if (!job) {
    sendError(res, 404, `Fine-tuning job not found: ${jobId}`, {
      code: "fine_tuning_job_not_found",
      param: "fine_tuning_job_id",
    });
    return;
  }
  sendJson(res, 200, job);
}

function handleFineTuningJobAction(res, fineTuningStore, jobId, action) {
  const job = fineTuningStore.transitionJob(jobId, action);
  if (!job) {
    sendError(res, 404, `Fine-tuning job not found: ${jobId}`, {
      code: "fine_tuning_job_not_found",
      param: "fine_tuning_job_id",
    });
    return;
  }
  sendJson(res, 200, job);
}

function handleFineTuningJobEventsList(res, fineTuningStore, jobId, url) {
  const events = fineTuningStore.listEvents(jobId);
  if (!events) {
    sendError(res, 404, `Fine-tuning job not found: ${jobId}`, {
      code: "fine_tuning_job_not_found",
      param: "fine_tuning_job_id",
    });
    return;
  }
  sendJson(res, 200, paginateListWithDefaultOrder(events, url, "desc", 20, 100));
}

function handleFineTuningJobCheckpointsList(res, fineTuningStore, jobId, url) {
  const checkpoints = fineTuningStore.listCheckpoints(jobId);
  if (!checkpoints) {
    sendError(res, 404, `Fine-tuning job not found: ${jobId}`, {
      code: "fine_tuning_job_not_found",
      param: "fine_tuning_job_id",
    });
    return;
  }
  sendJson(res, 200, paginateListWithDefaultOrder(checkpoints, url, "desc", 10, 100));
}

async function handleFineTuningCheckpointPermissionsCreate(req, res, fineTuningStore, checkpoint) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("checkpoint permission request body must be a JSON object", {
      code: "invalid_checkpoint_permission_request",
    });
  }
  const projectIds = Array.isArray(body.project_ids)
    ? body.project_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!projectIds.length) {
    throw requestError("project_ids is required", {
      code: "missing_required_parameter",
      param: "project_ids",
    });
  }
  sendJson(res, 200, fineTuningStore.createCheckpointPermissions(checkpoint, projectIds));
}

function handleFineTuningCheckpointPermissionsList(res, fineTuningStore, checkpoint, url) {
  const permissions = fineTuningStore.listCheckpointPermissions(checkpoint, {
    projectId: url.searchParams.get("project_id") || null,
  });
  sendJson(res, 200, paginateListWithDefaultOrder(permissions, url, "desc", 10, 100));
}

function handleFineTuningCheckpointPermissionDelete(res, fineTuningStore, checkpoint, permissionId) {
  const deleted = fineTuningStore.deleteCheckpointPermission(checkpoint, permissionId);
  if (!deleted) {
    sendError(res, 404, `Fine-tuning checkpoint permission not found: ${permissionId}`, {
      code: "fine_tuning_checkpoint_permission_not_found",
      param: "permission_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleRealtimeSessionCreate(req, res, realtimeStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Realtime session request body must be a JSON object", {
      code: "invalid_realtime_session_request",
    });
  }
  sendJson(res, 200, realtimeStore.createSession(body));
}

async function handleRealtimeClientSecretCreate(req, res, realtimeStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Realtime client secret request body must be a JSON object", {
      code: "invalid_realtime_client_secret_request",
    });
  }
  sendJson(res, 200, realtimeStore.createClientSecret(body));
}

async function handleRealtimeTranscriptionSessionCreate(req, res, realtimeStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Realtime transcription session request body must be a JSON object", {
      code: "invalid_realtime_transcription_session_request",
    });
  }
  sendJson(res, 200, realtimeStore.createTranscriptionSession(body));
}

async function handleRealtimeTranslationClientSecretCreate(req, res, realtimeStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Realtime translation client secret request body must be a JSON object", {
      code: "invalid_realtime_translation_client_secret_request",
    });
  }
  sendJson(res, 200, realtimeStore.createTranslationClientSecret(body));
}

async function handleRealtimeCallCreate(req, res, realtimeStore) {
  const request = await readRealtimeCallRequest(req);
  const call = realtimeStore.createCall(request);
  res.writeHead(201, {
    "content-type": "application/sdp",
    "cache-control": "no-store",
    location: `/v1/realtime/calls/${encodeURIComponent(call.id)}`,
    "x-open-codex-realtime-call-id": call.id,
  });
  res.end(call.sdp_answer || "");
}

async function handleRealtimeCallAction(req, res, realtimeStore, callId, action) {
  const body = await readOptionalJsonObject(req, `Realtime call ${action} request body must be a JSON object`);
  const call = realtimeStore.updateCall(callId, action, body);
  if (!call) {
    sendError(res, 404, `Realtime call not found: ${callId}`, {
      code: "realtime_call_not_found",
      param: "call_id",
    });
    return;
  }
  sendJson(res, 200, call);
}

async function readOptionalJsonObject(req, message) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const body = JSON.parse(raw);
  if (!isPlainObject(body)) {
    throw requestError(message, {
      code: "invalid_realtime_call_request",
    });
  }
  return body;
}

async function readRealtimeCallRequest(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (/^multipart\/form-data\b/i.test(contentType)) {
    const form = parseMultipartFormBinary(await readRawBody(req, 4 * 1024 * 1024), contentType);
    const sdpFile = form.files.find((file) => file.name === "sdp") || form.files[0];
    const session = parseRealtimeSessionField(form.fields.session);
    return {
      sdp: sdpFile ? sdpFile.content.toString("utf8") : String(form.fields.sdp || ""),
      session,
      client_secret: form.fields.client_secret,
      metadata: parseRealtimeSessionField(form.fields.metadata),
    };
  }
  if (/^application\/sdp\b/i.test(contentType)) {
    return { sdp: await readBody(req, 4 * 1024 * 1024) };
  }
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("Realtime call request body must be JSON, SDP, or multipart form data", {
      code: "invalid_realtime_call_request",
    });
  }
  return body;
}

function parseRealtimeSessionField(value) {
  if (isPlainObject(value)) return value;
  if (value == null || value === "") return {};
  const parsed = parseJsonOrNull(String(value));
  return isPlainObject(parsed) ? parsed : {};
}

async function handleChatKitSessionCreate(req, res, chatKitStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("ChatKit session request body must be a JSON object", {
      code: "invalid_chatkit_session_request",
    });
  }
  if (!body.user) {
    throw requestError("user is required", {
      code: "missing_required_parameter",
      param: "user",
    });
  }
  if (!isPlainObject(body.workflow) || !body.workflow.id) {
    throw requestError("workflow.id is required", {
      code: "missing_required_parameter",
      param: "workflow.id",
    });
  }
  sendJson(res, 200, chatKitStore.createSession(body));
}

function handleChatKitSessionCancel(res, chatKitStore, sessionId) {
  const session = chatKitStore.cancelSession(sessionId);
  if (!session) {
    sendError(res, 404, `ChatKit session not found: ${sessionId}`, {
      code: "chatkit_session_not_found",
      param: "session_id",
    });
    return;
  }
  sendJson(res, 200, session);
}

function handleChatKitThreadsList(res, chatKitStore, url) {
  const user = url.searchParams.get("user");
  const threads = chatKitStore.listThreads()
    .filter((thread) => !user || thread.user === user);
  sendJson(res, 200, paginateChatKitThreads(threads, url));
}

async function handleChatKitThreadCreate(req, res, chatKitStore) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("ChatKit thread request body must be a JSON object", {
      code: "invalid_chatkit_thread_request",
    });
  }
  if (body.session_id && !chatKitStore.getSession(body.session_id)) {
    throw requestError(`ChatKit session not found: ${body.session_id}`, {
      status: 404,
      code: "chatkit_session_not_found",
      param: "session_id",
    });
  }
  sendJson(res, 200, chatKitStore.createThread(body));
}

function handleChatKitThreadGet(res, chatKitStore, threadId) {
  const thread = chatKitStore.getThread(threadId);
  if (!thread) {
    sendError(res, 404, `ChatKit thread not found: ${threadId}`, {
      code: "chatkit_thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, thread);
}

async function handleChatKitThreadUpdate(req, res, chatKitStore, threadId) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("ChatKit thread update body must be a JSON object", {
      code: "invalid_chatkit_thread_request",
    });
  }
  const thread = chatKitStore.updateThread(threadId, body);
  if (!thread) {
    sendError(res, 404, `ChatKit thread not found: ${threadId}`, {
      code: "chatkit_thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, thread);
}

function handleChatKitThreadDelete(res, chatKitStore, threadId) {
  const deleted = chatKitStore.deleteThread(threadId);
  if (!deleted) {
    sendError(res, 404, `ChatKit thread not found: ${threadId}`, {
      code: "chatkit_thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

function handleChatKitThreadItemsList(res, chatKitStore, threadId, url) {
  const items = chatKitStore.listItems(threadId);
  if (!items) {
    sendError(res, 404, `ChatKit thread not found: ${threadId}`, {
      code: "chatkit_thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(items, url));
}

async function handleChatKitThreadItemsCreate(req, res, chatKitStore, threadId) {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    throw requestError("ChatKit thread item request body must be a JSON object", {
      code: "invalid_chatkit_thread_item_request",
    });
  }
  const created = chatKitStore.createItems(threadId, body);
  if (!created) {
    sendError(res, 404, `ChatKit thread not found: ${threadId}`, {
      code: "chatkit_thread_not_found",
      param: "thread_id",
    });
    return;
  }
  if (Array.isArray(body.items)) {
    sendJson(res, 200, paginateList(created, new URL("http://local/?limit=100")));
    return;
  }
  sendJson(res, 200, created[0]);
}

function pythonGraderOptions(config) {
  return {
    provider: config.pythonGraderProvider,
    stateDir: config.pythonGraderStateDir,
    timeoutMs: config.pythonGraderTimeoutMs,
    maxSourceBytes: config.pythonGraderMaxSourceBytes,
    diskBytes: config.pythonGraderDiskBytes,
    memoryBytes: config.pythonGraderMemoryBytes,
    pythonBin: config.pythonGraderBin,
  };
}

async function runScoreModelGraderWithProvider(request, config, incomingHeaders = {}) {
  const model = request.model || config.defaultModel;
  const sampling = isPlainObject(request.sampling_params) ? request.sampling_params : {};
  const chatRequest = {
    model,
    messages: [
      scoreModelCompatibilitySystemMessage(request.range),
      ...(Array.isArray(request.messages) ? request.messages : []),
    ],
    response_format: { type: "json_object" },
    store: false,
  };
  copyScoreModelSamplingParam(chatRequest, sampling, "temperature");
  copyScoreModelSamplingParam(chatRequest, sampling, "top_p");
  copyScoreModelSamplingParam(chatRequest, sampling, "seed");
  copyScoreModelSamplingParam(chatRequest, sampling, "reasoning_effort");
  const maxTokens = sampling.max_completion_tokens ?? sampling.max_completions_tokens;
  if (maxTokens != null) chatRequest.max_completion_tokens = maxTokens;

  const { upstreamBody } = chatPassthroughUpstreamBody(chatRequest, config);
  const upstream = await fetchProvider(config, config.chatCompletionsPath, upstreamBody, incomingHeaders);
  const text = await upstream.text();
  const json = parseJsonOrNull(text);
  const usage = scoreModelTokenUsage(json?.usage);
  const sampledModelName = json?.model || model;

  if (!upstream.ok) {
    const error = new Error(json?.error?.message || text || "score_model provider call failed");
    error.status = upstream.status;
    error.code = "model_grader_server_error";
    error.token_usage = usage;
    error.sampled_model_name = sampledModelName;
    error.model_grader_token_usage_per_model = usage.total_tokens > 0 ? { [sampledModelName]: usage } : {};
    throw error;
  }

  const outputText = extractChatCompletionText(json);
  const parsed = parseScoreModelResult(outputText);
  return {
    score: parsed.score,
    output_text: outputText,
    token_usage: usage,
    sampled_model_name: sampledModelName,
  };
}

function scoreModelCompatibilitySystemMessage(range = [0, 1]) {
  const [min, max] = Array.isArray(range) && range.length === 2 ? range : [0, 1];
  return {
    role: "system",
    content: [
      "You are executing a score_model grader.",
      `Return a JSON object with a numeric result field between ${min} and ${max}.`,
      "Use the compact shape {\"result\": number, \"steps\": []}.",
      "Do not include markdown, prose outside JSON, hidden analysis text, or extra top-level fields.",
    ].join(" "),
  };
}

function copyScoreModelSamplingParam(target, source, field) {
  if (source[field] !== undefined && source[field] !== null) target[field] = source[field];
}

function parseScoreModelResult(text) {
  const raw = stringifyContent(text).trim();
  const parsed = parseJsonOrNull(raw) || parseJsonOrNull(extractJsonObject(raw));
  if (isPlainObject(parsed)) {
    const result = Number(parsed.result ?? parsed.score ?? parsed.reward);
    return { score: Number.isFinite(result) ? result : NaN, parsed };
  }
  const number = raw.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/i);
  return { score: number ? Number(number[0]) : NaN, parsed: null };
}

function extractJsonObject(text) {
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return String(text).slice(start, end + 1);
}

function scoreModelTokenUsage(usage) {
  if (!isPlainObject(usage)) {
    return {
      prompt_tokens: 0,
      total_tokens: 0,
      completion_tokens: 0,
      cached_tokens: 0,
    };
  }
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    prompt_tokens: promptTokens,
    total_tokens: Number(usage.total_tokens ?? promptTokens + completionTokens),
    completion_tokens: completionTokens,
    cached_tokens: Number(
      usage.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.prompt_cache_hit_tokens
      ?? 0,
    ),
  };
}

function handleBatchesList(res, store, url) {
  const batches = store.list()
    .filter((record) => record?.batch)
    .map((record) => clone(record.batch))
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  sendJson(res, 200, paginateList(batches, url));
}

function handleBatchGet(res, store, batchId) {
  const record = store.get(batchId);
  if (!record?.batch) {
    sendError(res, 404, `batch not found: ${batchId}`, { code: "batch_not_found" });
    return;
  }
  sendJson(res, 200, record.batch);
}

function handleBatchCancel(res, store, batchId) {
  const record = store.get(batchId);
  if (!record?.batch) {
    sendError(res, 404, `batch not found: ${batchId}`, { code: "batch_not_found" });
    return;
  }
  const batch = clone(record.batch);
  if (["completed", "failed", "cancelled", "expired"].includes(batch.status)) {
    batch.metadata = {
      ...(batch.metadata || {}),
      compatibility_cancel: "local Batch execution is synchronous; terminal batches are returned as a no-op",
    };
    sendJson(res, 200, batch);
    return;
  }
  const now = nowSeconds();
  batch.status = "cancelled";
  batch.cancelling_at = batch.cancelling_at || now;
  batch.cancelled_at = now;
  store.put(batchId, { ...record, batch });
  sendJson(res, 200, batch);
}

function handleResponseGet(res, store, responseId, url) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  sendJson(res, 200, projectResponseForIncludes(record.response, url));
}

async function handleResponseUpdate(req, res, store, responseId, url) {
  const body = await readJson(req);
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  const keys = Object.keys(isPlainObject(body) ? body : {});
  const unsupported = keys.filter((key) => key !== "metadata");
  if (!keys.includes("metadata") || unsupported.length || !isPlainObject(body.metadata)) {
    sendError(res, 400, "only metadata updates are supported for stored responses", {
      type: "invalid_request_error",
      param: unsupported[0] || "metadata",
      code: "unsupported_response_update",
    });
    return;
  }

  const metadata = clone(body.metadata);
  const existingMetadata = isPlainObject(record.response.metadata) ? record.response.metadata : {};
  if (isPlainObject(existingMetadata.compatibility) || isPlainObject(metadata.compatibility)) {
    metadata.compatibility = mergeCompatibility(metadata.compatibility, existingMetadata.compatibility);
  }
  if (Object.prototype.hasOwnProperty.call(existingMetadata, "upstream_object") && !Object.prototype.hasOwnProperty.call(metadata, "upstream_object")) {
    metadata.upstream_object = existingMetadata.upstream_object;
  }

  const updatedRecord = {
    ...record,
    response: {
      ...record.response,
      metadata,
    },
    request: record.request
      ? {
        ...record.request,
        metadata: clone(body.metadata),
      }
      : record.request,
  };
  store.put(responseId, updatedRecord);
  sendJson(res, 200, projectResponseForIncludes(updatedRecord.response, url));
}

function handleResponseDelete(res, store, responseId, backgroundJobs) {
  const job = backgroundJobs?.get(responseId);
  if (job) {
    job.deleted = true;
    job.controller.abort();
    backgroundJobs.delete(responseId);
  }

  const deleted = store.delete(responseId);
  if (!deleted) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  sendJson(res, 200, {
    id: responseId,
    object: "response.deleted",
    deleted: true,
  });
}

function handleResponseCancel(res, store, responseId, backgroundJobs, url) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  if (record.response.status === "in_progress") {
    const job = backgroundJobs?.get(responseId);
    if (job) {
      job.controller.abort();
      backgroundJobs.delete(responseId);
    }
    const response = storeCancelledBackgroundResponse(store, responseId, job ? "background job aborted" : "background job marked cancelled");
    sendJson(res, 200, projectResponseForIncludes(response || store.get(responseId)?.response || record.response, url));
    return;
  }

  const response = clone(record.response);
  response.metadata = {
    ...(response.metadata || {}),
    compatibility_cancel: "local store only contains terminal responses; completed responses are returned as a no-op",
  };
  sendJson(res, 200, projectResponseForIncludes(response, url));
}

function handleResponseInputItems(res, store, responseId, url) {
  const record = store.get(responseId);
  if (!record?.response) {
    sendError(res, 404, `response not found: ${responseId}`, { code: "response_not_found" });
    return;
  }

  const items = Array.isArray(record.input_items)
    ? record.input_items
    : normalizeStoredInputItems(record.request?.input);
  sendJson(res, 200, paginateInputItems(projectInputItemsForIncludes(items, url), url));
}

function handleChatCompletionGet(res, store, completionId) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  sendJson(res, 200, record.chat_completion);
}

async function handleChatCompletionUpdate(req, res, store, completionId) {
  const body = await readJson(req);
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const keys = Object.keys(isPlainObject(body) ? body : {});
  const unsupported = keys.filter((key) => key !== "metadata");
  if (!keys.includes("metadata") || unsupported.length || !isPlainObject(body.metadata)) {
    sendError(res, 400, "only metadata updates are supported for stored chat completions", {
      type: "invalid_request_error",
      param: unsupported[0] || "metadata",
      code: "unsupported_chat_completion_update",
    });
    return;
  }

  const metadata = clone(body.metadata);
  const updatedRecord = {
    ...record,
    chat_completion: {
      ...record.chat_completion,
      metadata,
    },
    chat_request: {
      ...(record.chat_request || {}),
      metadata,
    },
  };
  store.put(completionId, updatedRecord);
  sendJson(res, 200, updatedRecord.chat_completion);
}

function handleChatCompletionDelete(res, store, completionId) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const deleted = store.delete(completionId);
  if (!deleted) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  sendJson(res, 200, {
    id: completionId,
    object: "chat.completion.deleted",
    deleted: true,
  });
}

function handleChatCompletionsList(res, store, url) {
  const model = url.searchParams.get("model");
  const metadataFilters = metadataFiltersFromUrl(url);
  const completions = store.list()
    .filter((record) => record?.chat_completion)
    .map((record) => normalizeListedChatCompletion(record))
    .filter((completion) => !model || completion.model === model)
    .filter((completion) => matchesMetadataFilters(completion.metadata || {}, metadataFilters));
  sendJson(res, 200, paginateList(completions, url));
}

function normalizeListedChatCompletion(record) {
  const completion = clone(record.chat_completion);
  if (!completion.model && record.chat_request?.model) completion.model = record.chat_request.model;
  const requestMetadata = record.chat_request?.metadata;
  if (!completion.metadata && requestMetadata && typeof requestMetadata === "object" && !Array.isArray(requestMetadata)) {
    completion.metadata = clone(requestMetadata);
  }
  if (!completion.metadata) completion.metadata = {};
  return completion;
}

function metadataFiltersFromUrl(url) {
  const filters = [];
  for (const [key, value] of url.searchParams.entries()) {
    const bracket = key.match(/^metadata\[([^\]]+)\]$/);
    if (bracket) filters.push([bracket[1], value]);
  }
  return filters;
}

function matchesMetadataFilters(metadata, filters) {
  if (!filters.length) return true;
  return filters.every(([key, expected]) => String(metadata?.[key] ?? "") === expected);
}

function handleChatCompletionMessages(res, store, completionId, url) {
  const record = store.get(completionId);
  if (!record?.chat_completion) {
    sendError(res, 404, `chat completion not found: ${completionId}`, { code: "chat_completion_not_found" });
    return;
  }

  const messages = Array.isArray(record.chat_messages) ? record.chat_messages : [];
  sendJson(res, 200, paginateList(messages, url));
}

async function handleConversationCreate(req, res, conversationStore) {
  const body = await readJson(req);
  sendJson(res, 200, conversationStore.create(body));
}

function handleConversationGet(res, conversationStore, conversationId) {
  const record = conversationStore.get(conversationId);
  if (!record) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, {
    id: record.id,
    object: "conversation",
    created_at: record.created_at,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
  });
}

async function handleConversationUpdate(req, res, conversationStore, conversationId) {
  const body = await readJson(req);
  const keys = Object.keys(isPlainObject(body) ? body : {});
  const unsupported = keys.filter((key) => key !== "metadata");
  if (unsupported.length || (keys.length && !isPlainObject(body.metadata))) {
    sendError(res, 400, "only metadata updates are supported for conversations", {
      type: "invalid_request_error",
      param: unsupported[0] || "metadata",
      code: "unsupported_conversation_update",
    });
    return;
  }
  const conversation = conversationStore.update(conversationId, body);
  if (!conversation) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, conversation);
}

function handleConversationDelete(res, conversationStore, conversationId) {
  const deleted = conversationStore.delete(conversationId);
  if (!deleted) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

async function handleConversationItemsCreate(req, res, conversationStore, conversationId) {
  const body = await readJson(req);
  const inputItems = Object.prototype.hasOwnProperty.call(body, "items")
    ? body.items
    : Object.prototype.hasOwnProperty.call(body, "item")
      ? body.item
      : body;
  const items = conversationStore.appendItems(conversationId, inputItems);
  if (!items) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, Array.isArray(inputItems) ? paginateList(items, new URL("http://local/?limit=100")) : items[0]);
}

function handleConversationItemsList(res, conversationStore, conversationId, url) {
  const items = conversationStore.listItems(conversationId);
  if (!items) {
    sendError(res, 404, `conversation not found: ${conversationId}`, { code: "conversation_not_found" });
    return;
  }
  sendJson(res, 200, paginateList(projectInputItemsForIncludes(items, url), url));
}

function handleConversationItemGet(res, conversationStore, conversationId, itemId, url) {
  const item = conversationStore.getItem(conversationId, itemId);
  if (!item) {
    sendError(res, 404, `conversation item not found: ${itemId}`, { code: "conversation_item_not_found" });
    return;
  }
  sendJson(res, 200, projectInputItemsForIncludes([item], url)[0]);
}

function handleConversationItemDelete(res, conversationStore, conversationId, itemId) {
  const deleted = conversationStore.deleteItem(conversationId, itemId);
  if (!deleted) {
    sendError(res, 404, `conversation item not found: ${itemId}`, { code: "conversation_item_not_found" });
    return;
  }
  sendJson(res, 200, deleted);
}

function normalizeStoredInputItems(input) {
  if (input == null) return [];
  if (typeof input === "string") {
    return [{
      id: "in_000000",
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: input }],
    }];
  }

  const items = Array.isArray(input) ? input : [input];
  return items.map((item, index) => normalizeStoredInputItem(item, index));
}

function normalizeStoredInputItem(item, index) {
  const id = `in_${String(index).padStart(6, "0")}`;
  if (typeof item === "string") {
    return {
      id,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: item }],
    };
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return {
      id,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: stringifyContent(item) }],
    };
  }

  const stored = clone(item);
  if (!stored.id) stored.id = id;
  if (!stored.type && stored.role) stored.type = "message";
  return stored;
}

function projectResponseForRequestIncludes(response, request = {}) {
  return projectResponseForIncludeSet(response, includeValuesFromRequest(request));
}

function projectResponseForIncludes(response, url) {
  return projectResponseForIncludeSet(response, includeValuesFromUrl(url));
}

function projectResponseForIncludeSet(response, includes = new Set()) {
  let projected = clone(response);
  if (!includes.has("message.output_text.logprobs")) {
    projected = redactOutputTextLogprobs(projected);
  }
  if (!includes.has("reasoning.encrypted_content")) {
    projected = redactReasoningEncryptedContent(projected);
  }
  if (!includes.has("code_interpreter_call.outputs")) {
    projected = redactCodeInterpreterCallOutputs(projected);
  }
  if (!includes.has("web_search_call.action.sources")) {
    projected = redactWebSearchActionSources(projected);
  }
  if (!includes.has("file_search_call.results")) {
    projected = redactFileSearchCallResults(projected);
  }
  return projected;
}

function redactCodeInterpreterCallOutputs(response) {
  if (!Array.isArray(response?.output)) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "code_interpreter_call") return item;
    const cloned = { ...item };
    delete cloned.outputs;
    return cloned;
  });
  return response;
}

function redactOutputTextLogprobs(response) {
  if (!Array.isArray(response?.output)) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "message" || !Array.isArray(item.content)) return item;
    const content = item.content.map((part) => {
      if (part?.type !== "output_text" || !Object.prototype.hasOwnProperty.call(part, "logprobs")) return part;
      const cloned = { ...part };
      delete cloned.logprobs;
      return cloned;
    });
    return { ...item, content };
  });
  return response;
}

function redactReasoningEncryptedContent(response) {
  if (!Array.isArray(response?.output)) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "reasoning") return item;
    const cloned = { ...item };
    delete cloned.encrypted_content;
    return cloned;
  });
  return response;
}

function redactFileSearchCallResults(response) {
  if (!Array.isArray(response?.output)) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "file_search_call") return item;
    const cloned = { ...item };
    delete cloned.results;
    return cloned;
  });
  return response;
}

function redactWebSearchActionSources(response) {
  if (!Array.isArray(response?.output)) return response;
  response.output = response.output.map((item) => {
    if (item?.type !== "web_search_call" || !isPlainObject(item.action)) return item;
    const cloned = { ...item, action: { ...item.action } };
    delete cloned.action.sources;
    return cloned;
  });
  return response;
}

function projectInputItemsForIncludes(items, url) {
  const includes = includeValuesFromUrl(url);
  const includeInputImageUrls = includes.has("message.input_image.image_url");
  const includeComputerOutputImageUrls = includes.has("computer_call_output.output.image_url");
  return (Array.isArray(items) ? items : [items])
    .map((item) => projectInputItemForIncludes(item, {
      includeInputImageUrls,
      includeComputerOutputImageUrls,
    }));
}

function projectInputItemForIncludes(item, options = {}) {
  let projected = clone(item);
  if (!options.includeInputImageUrls) projected = redactInputImageUrls(projected);
  if (!options.includeComputerOutputImageUrls) projected = redactComputerOutputImageUrls(projected);
  return projected;
}

function redactInputImageUrls(value) {
  if (Array.isArray(value)) return value.map(redactInputImageUrls);
  if (!isPlainObject(value)) return value;
  if (isInputImageItem(value)) return redactInputImageUrlPart(value);
  const cloned = { ...value };
  if (Array.isArray(cloned.content)) cloned.content = cloned.content.map(redactInputImageUrls);
  return cloned;
}

function redactInputImageUrlPart(part) {
  const cloned = { ...part };
  const detail = cloned.detail
    ?? (isPlainObject(cloned.image_url) ? cloned.image_url.detail : undefined);
  delete cloned.image_url;
  delete cloned.url;
  if (detail != null && cloned.detail == null) cloned.detail = detail;
  return cloned;
}

function redactComputerOutputImageUrls(value) {
  if (Array.isArray(value)) return value.map(redactComputerOutputImageUrls);
  if (!isPlainObject(value)) return value;
  if (value.type === "computer_call_output") return redactComputerOutputImageUrlItem(value);
  const cloned = { ...value };
  if (Array.isArray(cloned.content)) cloned.content = cloned.content.map(redactComputerOutputImageUrls);
  if (Array.isArray(cloned.input)) cloned.input = cloned.input.map(redactComputerOutputImageUrls);
  return cloned;
}

function redactComputerOutputImageUrlItem(item) {
  const cloned = { ...item };
  if (isPlainObject(cloned.output)) {
    const output = { ...cloned.output };
    const detail = output.detail
      ?? (isPlainObject(output.image_url) ? output.image_url.detail : undefined);
    delete output.image_url;
    delete output.url;
    if (detail != null && output.detail == null) output.detail = detail;
    cloned.output = output;
  }
  return cloned;
}

function includeValuesFromUrl(url) {
  const values = [];
  for (const key of ["include", "include[]"]) {
    for (const value of url?.searchParams?.getAll?.(key) || []) {
      values.push(...String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
    }
  }
  return new Set(values);
}

function includeValuesFromRequest(request = {}) {
  const raw = Array.isArray(request.include)
    ? request.include
    : request.include == null
      ? []
      : [request.include];
  return new Set(raw
    .flatMap((value) => String(value || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean));
}

const ASSISTANT_RUN_STEP_FILE_SEARCH_CONTENT_INCLUDE = "step_details.tool_calls[*].file_search.results[*].content";

function projectAssistantRunStepsForIncludes(steps, url) {
  const includes = includeValuesFromUrl(url);
  return (Array.isArray(steps) ? steps : []).map((step) => projectAssistantRunStepForIncludeSet(step, includes));
}

function projectAssistantRunStepForIncludes(step, url) {
  return projectAssistantRunStepForIncludeSet(step, includeValuesFromUrl(url));
}

function projectAssistantRunStepForIncludeSet(step, includes = new Set()) {
  const projected = clone(step || {});
  if (includes.has(ASSISTANT_RUN_STEP_FILE_SEARCH_CONTENT_INCLUDE)) return projected;
  return redactAssistantRunStepFileSearchResultContent(projected);
}

function redactAssistantRunStepFileSearchResultContent(step) {
  const toolCalls = step?.step_details?.tool_calls;
  if (!Array.isArray(toolCalls)) return step;
  for (const toolCall of toolCalls) {
    if (toolCall?.type !== "file_search" || !Array.isArray(toolCall.file_search?.results)) continue;
    toolCall.file_search.results = toolCall.file_search.results.map((result) => {
      if (!isPlainObject(result) || !Object.prototype.hasOwnProperty.call(result, "content")) return result;
      const cloned = { ...result };
      delete cloned.content;
      return cloned;
    });
  }
  return step;
}

function isInputImageItem(value) {
  return isPlainObject(value)
    && (value.type === "input_image"
      || value.type === "image_url"
      || Object.prototype.hasOwnProperty.call(value, "image_url"));
}

function paginateInputItems(items, url) {
  return paginateList(items, url);
}

function paginateChatKitThreads(items, url) {
  const localUrl = new URL(url.toString());
  if (!localUrl.searchParams.has("order")) localUrl.searchParams.set("order", "desc");
  return paginateList(items, localUrl);
}

function paginateListWithDefaultOrder(items, url, order, fallbackLimit = 20, maxLimit = 100) {
  const localUrl = new URL(url.toString());
  if (!localUrl.searchParams.has("order")) localUrl.searchParams.set("order", order);
  const result = paginateList(items, localUrl);
  const limit = parseLimit(localUrl.searchParams.get("limit"), fallbackLimit, maxLimit);
  if (result.data.length > limit) {
    result.data = result.data.slice(0, limit);
    result.first_id = result.data[0]?.id || null;
    result.last_id = result.data.at(-1)?.id || null;
    result.has_more = true;
  }
  return result;
}

function paginateList(items, url) {
  const order = String(url.searchParams.get("order") || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const limit = parseLimit(url.searchParams.get("limit"), 20, 100);
  let data = items.map((item) => clone(item));
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

function fineTuningMetadataFilter(url) {
  if (url.searchParams.get("metadata") === "null") return { none: true };
  const values = {};
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^metadata\[([^\]]+)\]$/);
    if (match) values[match[1]] = value;
  }
  return Object.keys(values).length ? { values } : null;
}

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function handleAssistantsList(res, assistantStore, url) {
  sendJson(res, 200, paginateList(assistantStore.listAssistants(), url));
}

async function handleAssistantCreate(req, res, assistantStore) {
  const body = await readJson(req);
  if (!stringifyContent(body.model).trim()) {
    sendError(res, 400, "model is required", {
      type: "invalid_request_error",
      code: "missing_required_parameter",
      param: "model",
    });
    return;
  }
  sendJson(res, 200, assistantStore.createAssistant(body));
}

function handleAssistantGet(res, assistantStore, assistantId) {
  const assistant = assistantStore.getAssistant(assistantId);
  if (!assistant) {
    sendError(res, 404, `No assistant found for id '${assistantId}'`, {
      type: "invalid_request_error",
      code: "assistant_not_found",
      param: "assistant_id",
    });
    return;
  }
  sendJson(res, 200, assistant);
}

async function handleAssistantUpdate(req, res, assistantStore, assistantId) {
  const updated = assistantStore.updateAssistant(assistantId, await readJson(req));
  if (!updated) {
    sendError(res, 404, `No assistant found for id '${assistantId}'`, {
      type: "invalid_request_error",
      code: "assistant_not_found",
      param: "assistant_id",
    });
    return;
  }
  sendJson(res, 200, updated);
}

function handleAssistantDelete(res, assistantStore, assistantId) {
  const deleted = assistantStore.deleteAssistant(assistantId);
  if (!deleted) {
    sendError(res, 404, `No assistant found for id '${assistantId}'`, {
      type: "invalid_request_error",
      code: "assistant_not_found",
      param: "assistant_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

function materializeAssistantThreadMessageAttachments({ assistantStore, fileSearchStore, threadId }) {
  const messages = assistantStore.listMessages(threadId) || [];
  for (const message of messages) {
    const validation = validateAssistantMessageAttachmentFiles({ fileSearchStore, message });
    if (!validation.ok) return validation;
  }
  let latestThread = assistantStore.getThread(threadId);
  for (const message of messages) {
    const materialized = materializeAssistantMessageAttachments({
      assistantStore,
      fileSearchStore,
      threadId,
      message,
    });
    if (!materialized.ok) return materialized;
    latestThread = materialized.thread || latestThread;
  }
  return { ok: true, thread: latestThread };
}

function materializeAssistantMessageAttachments({ assistantStore, fileSearchStore, threadId, message }) {
  const validation = validateAssistantMessageAttachmentFiles({ fileSearchStore, message });
  if (!validation.ok) return validation;
  const relevantAttachments = validation.relevantAttachments || [];
  if (!relevantAttachments.length) {
    return { ok: true, thread: assistantStore.getThread(threadId) };
  }

  let thread = assistantStore.getThread(threadId);
  if (!thread) {
    return {
      ok: false,
      status: 404,
      error: openAiError(`No thread found for id '${threadId}'`, {
        type: "invalid_request_error",
        code: "thread_not_found",
        param: "thread_id",
      }),
    };
  }

  const resources = isPlainObject(thread.tool_resources) ? clone(thread.tool_resources) : {};
  let changed = false;
  let threadVectorStoreId = firstLocalThreadVectorStoreId(resources, fileSearchStore);

  for (const attachment of relevantAttachments) {
    const { fileId, usesFileSearch, usesCodeInterpreter } = attachment;
    if (usesFileSearch) {
      if (!threadVectorStoreId) {
        const store = fileSearchStore.createVectorStore({
          name: `Thread ${threadId} message attachments`,
          metadata: {
            source: "assistant_message_attachment",
            thread_id: threadId,
          },
          expires_after: { anchor: "last_active_at", days: 7 },
        });
        threadVectorStoreId = store.id;
        const existingIds = assistantResourceIds(resources, "file_search", "vector_store_ids");
        resources.file_search = {
          ...(isPlainObject(resources.file_search) ? resources.file_search : {}),
          vector_store_ids: uniqStrings([...existingIds, threadVectorStoreId]),
        };
        changed = true;
      }
      if (!fileSearchStore.getVectorStoreFile(threadVectorStoreId, fileId)) {
        fileSearchStore.attachFile(threadVectorStoreId, {
          file_id: fileId,
          attributes: {
            source: "assistant_message_attachment",
            thread_id: threadId,
            message_id: message.id,
          },
        });
      }
    }

    if (usesCodeInterpreter) {
      const existingIds = assistantResourceIds(resources, "code_interpreter", "file_ids");
      const nextIds = uniqStrings([...existingIds, fileId]);
      if (nextIds.length !== existingIds.length) {
        resources.code_interpreter = {
          ...(isPlainObject(resources.code_interpreter) ? resources.code_interpreter : {}),
          file_ids: nextIds,
        };
        changed = true;
      }
    }
  }

  if (changed) {
    thread = assistantStore.updateThread(threadId, { tool_resources: resources }) || thread;
  }
  return { ok: true, thread };
}

function validateAssistantMessageAttachmentFiles({ fileSearchStore, message }) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const relevantAttachments = [];

  for (const attachment of attachments) {
    if (!isPlainObject(attachment)) continue;
    const fileId = stringifyContent(attachment.file_id).trim();
    const toolTypes = assistantAttachmentToolTypes(attachment);
    const usesFileSearch = toolTypes.includes("file_search");
    const usesCodeInterpreter = toolTypes.includes("code_interpreter");
    if (!usesFileSearch && !usesCodeInterpreter) continue;
    if (!fileId) {
      return {
        ok: false,
        status: 400,
        error: openAiError("message attachment file_id is required", {
          type: "invalid_request_error",
          code: "missing_required_parameter",
          param: "attachments.file_id",
        }),
      };
    }
    if (!fileSearchStore.getFile(fileId)) {
      return {
        ok: false,
        status: 404,
        error: openAiError(`No file found for id '${fileId}'`, {
          type: "invalid_request_error",
          code: "file_not_found",
          param: "attachments.file_id",
        }),
      };
    }
    relevantAttachments.push({ fileId, usesFileSearch, usesCodeInterpreter });
  }
  return { ok: true, relevantAttachments };
}

function assistantAttachmentToolTypes(attachment) {
  if (!Array.isArray(attachment?.tools)) return [];
  return uniqStrings(attachment.tools
    .filter(isPlainObject)
    .map((tool) => tool.type)
    .filter((type) => type === "file_search" || type === "code_interpreter"));
}

function firstLocalThreadVectorStoreId(resources, fileSearchStore) {
  const ids = assistantResourceIds(resources, "file_search", "vector_store_ids");
  return ids.find((id) => fileSearchStore.getVectorStore(id)) || "";
}

function assistantRunAdditionalMessages(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, "additional_messages")) {
    return { ok: true, messages: [] };
  }
  if (!Array.isArray(body.additional_messages)) {
    return {
      ok: false,
      status: 400,
      error: openAiError("additional_messages must be an array", {
        type: "invalid_request_error",
        code: "invalid_type",
        param: "additional_messages",
      }),
    };
  }
  for (const [index, message] of body.additional_messages.entries()) {
    if (!isPlainObject(message)) {
      return {
        ok: false,
        status: 400,
        error: openAiError("additional_messages entries must be objects", {
          type: "invalid_request_error",
          code: "invalid_type",
          param: `additional_messages[${index}]`,
        }),
      };
    }
  }
  return { ok: true, messages: body.additional_messages };
}

function appendAssistantRunAdditionalMessages({ assistantStore, fileSearchStore, threadId, body }) {
  const additional = assistantRunAdditionalMessages(body);
  if (!additional.ok || !additional.messages.length) {
    return additional.ok ? { ok: true, thread: assistantStore.getThread(threadId), messages: [] } : additional;
  }

  for (const message of additional.messages) {
    const validation = validateAssistantMessageAttachmentFiles({ fileSearchStore, message });
    if (!validation.ok) return validation;
  }

  const createdMessages = [];
  let latestThread = assistantStore.getThread(threadId);
  for (const messageBody of additional.messages) {
    const message = assistantStore.createMessage(threadId, messageBody);
    if (!message) {
      for (const created of createdMessages) assistantStore.deleteMessage(threadId, created.id);
      return {
        ok: false,
        status: 404,
        error: openAiError(`No thread found for id '${threadId}'`, {
          type: "invalid_request_error",
          code: "thread_not_found",
          param: "thread_id",
        }),
      };
    }
    createdMessages.push(message);
    const materialized = materializeAssistantMessageAttachments({
      assistantStore,
      fileSearchStore,
      threadId,
      message,
    });
    if (!materialized.ok) {
      for (const created of createdMessages) assistantStore.deleteMessage(threadId, created.id);
      return materialized;
    }
    latestThread = materialized.thread || latestThread;
  }
  return { ok: true, thread: latestThread, messages: createdMessages };
}

const ASSISTANT_TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled", "expired", "incomplete"]);

function assistantRunIsTerminal(run) {
  return ASSISTANT_TERMINAL_RUN_STATUSES.has(String(run?.status || ""));
}

function assistantRunExpiresAt(run) {
  const expiresAt = Number(run?.expires_at || 0);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0;
}

function expireAssistantRunIfNeeded(assistantStore, run, now = nowSeconds()) {
  if (!run || assistantRunIsTerminal(run)) return run || null;
  const expiresAt = assistantRunExpiresAt(run);
  if (!expiresAt || expiresAt > now) return run;
  return assistantStore.updateRun(run.thread_id, run.id, (existing) => {
    if (!existing || assistantRunIsTerminal(existing)) return existing;
    const currentExpiresAt = assistantRunExpiresAt(existing);
    if (!currentExpiresAt || currentExpiresAt > now) return existing;
    return {
      ...existing,
      status: "expired",
      expires_at: null,
      expired_at: now,
      required_action: null,
      last_error: {
        code: "run_expired",
        message: "Run expired before required tool outputs were submitted.",
      },
      metadata: {
        ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
        compatibility: mergeCompatibility(existing.metadata?.compatibility, {
          local_assistants: {
            provider: "local",
            expiration: "expires_at_elapsed",
            expired_expires_at: currentExpiresAt,
          },
        }),
      },
    };
  }) || { ...run, status: "expired", expires_at: null, expired_at: now, required_action: null };
}

function refreshAssistantThreadRuns(assistantStore, threadId) {
  const runs = assistantStore.listRuns(threadId);
  if (!runs) return null;
  const now = nowSeconds();
  return runs.map((run) => expireAssistantRunIfNeeded(assistantStore, run, now)).filter(Boolean);
}

function refreshAssistantRunState(assistantStore, threadId, runId) {
  const run = assistantStore.getRun(threadId, runId);
  return expireAssistantRunIfNeeded(assistantStore, run);
}

function activeAssistantRunForThread(assistantStore, threadId) {
  const runs = refreshAssistantThreadRuns(assistantStore, threadId);
  if (!runs) return null;
  return runs.find((run) => run && !assistantRunIsTerminal(run)) || null;
}

function assistantThreadLockedError(threadId, run, operation) {
  const action = operation === "message" ? "add messages" : "create another run";
  return openAiError(`Thread '${threadId}' already has an active run '${run.id}'. Wait until the run reaches a terminal status before you ${action}.`, {
    type: "invalid_request_error",
    code: "thread_locked",
    param: "thread_id",
  });
}

async function handleAssistantThreadCreate(req, res, assistantStore, fileSearchStore) {
  const thread = assistantStore.createThread(await readJson(req));
  const materialized = materializeAssistantThreadMessageAttachments({
    assistantStore,
    fileSearchStore,
    threadId: thread.id,
  });
  if (!materialized.ok) {
    assistantStore.deleteThread(thread.id);
    sendJson(res, materialized.status, materialized.error);
    return;
  }
  sendJson(res, 200, materialized.thread || thread);
}

function handleAssistantThreadGet(res, assistantStore, threadId) {
  const thread = assistantStore.getThread(threadId);
  if (!thread) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, thread);
}

async function handleAssistantThreadUpdate(req, res, assistantStore, threadId) {
  const thread = assistantStore.updateThread(threadId, await readJson(req));
  if (!thread) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, thread);
}

function handleAssistantThreadDelete(res, assistantStore, threadId) {
  const deleted = assistantStore.deleteThread(threadId);
  if (!deleted) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

function handleAssistantMessagesList(res, assistantStore, threadId, url) {
  const messages = assistantStore.listMessages(threadId);
  if (!messages) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(messages, url));
}

async function handleAssistantMessageCreate(req, res, assistantStore, fileSearchStore, threadId) {
  const thread = assistantStore.getThread(threadId);
  if (!thread) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  const activeRun = activeAssistantRunForThread(assistantStore, threadId);
  if (activeRun) {
    sendJson(res, 400, assistantThreadLockedError(threadId, activeRun, "message"));
    return;
  }
  const message = assistantStore.createMessage(threadId, await readJson(req));
  if (!message) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  const materialized = materializeAssistantMessageAttachments({
    assistantStore,
    fileSearchStore,
    threadId,
    message,
  });
  if (!materialized.ok) {
    assistantStore.deleteMessage(threadId, message.id);
    sendJson(res, materialized.status, materialized.error);
    return;
  }
  sendJson(res, 200, message);
}

function handleAssistantMessageGet(res, assistantStore, threadId, messageId) {
  const message = assistantStore.getMessage(threadId, messageId);
  if (!message) {
    sendError(res, 404, `No message found for id '${messageId}'`, {
      type: "invalid_request_error",
      code: "message_not_found",
      param: "message_id",
    });
    return;
  }
  sendJson(res, 200, message);
}

async function handleAssistantMessageUpdate(req, res, assistantStore, threadId, messageId) {
  const message = assistantStore.updateMessage(threadId, messageId, await readJson(req));
  if (!message) {
    sendError(res, 404, `No message found for id '${messageId}'`, {
      type: "invalid_request_error",
      code: "message_not_found",
      param: "message_id",
    });
    return;
  }
  sendJson(res, 200, message);
}

function handleAssistantMessageDelete(res, assistantStore, threadId, messageId) {
  const deleted = assistantStore.deleteMessage(threadId, messageId);
  if (!deleted) {
    sendError(res, 404, `No message found for id '${messageId}'`, {
      type: "invalid_request_error",
      code: "message_not_found",
      param: "message_id",
    });
    return;
  }
  sendJson(res, 200, deleted);
}

function handleAssistantRunsList(res, assistantStore, threadId, url) {
  const runs = refreshAssistantThreadRuns(assistantStore, threadId);
  if (!runs) {
    sendError(res, 404, `No thread found for id '${threadId}'`, {
      type: "invalid_request_error",
      code: "thread_not_found",
      param: "thread_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(runs, url));
}

async function handleAssistantRunCreate(req, res, config, assistantStore, threadId, fileSearchStore, containerStore, skillStore, url) {
  const body = await readJson(req);
  if (body.stream === true) {
    await streamNewAssistantRun({
      body,
      config,
      assistantStore,
      fileSearchStore,
      containerStore,
      skillStore,
      threadId,
      incomingHeaders: req.headers,
      res,
      streamOptions: { includeThreadCreated: false, stepIncludes: includeValuesFromUrl(url) },
    });
    return;
  }
  const result = await createAndCompleteAssistantRun({
    body,
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    threadId,
    incomingHeaders: req.headers,
  });
  if (!result.ok) {
    sendJson(res, result.status, result.error);
    return;
  }
  sendJson(res, 200, result.run);
}

async function handleAssistantThreadAndRunCreate(req, res, config, assistantStore, fileSearchStore, containerStore, skillStore, url) {
  const body = await readJson(req);
  const thread = assistantStore.createThread(isPlainObject(body.thread) ? body.thread : {});
  const materialized = materializeAssistantThreadMessageAttachments({
    assistantStore,
    fileSearchStore,
    threadId: thread.id,
  });
  if (!materialized.ok) {
    assistantStore.deleteThread(thread.id);
    sendJson(res, materialized.status, materialized.error);
    return;
  }
  const runThread = materialized.thread || thread;
  if (body.stream === true) {
    await streamNewAssistantRun({
      body,
      config,
      assistantStore,
      fileSearchStore,
      containerStore,
      skillStore,
      threadId: thread.id,
      incomingHeaders: req.headers,
      res,
      streamOptions: { thread: runThread, stepIncludes: includeValuesFromUrl(url) },
    });
    return;
  }
  const result = await createAndCompleteAssistantRun({
    body,
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    threadId: thread.id,
    incomingHeaders: req.headers,
  });
  if (!result.ok) {
    sendJson(res, result.status, result.error);
    return;
  }
  sendJson(res, 200, result.run);
}

function handleAssistantRunGet(res, assistantStore, threadId, runId) {
  const run = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!run) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, run);
}

async function handleAssistantRunUpdate(req, res, assistantStore, threadId, runId) {
  const body = await readJson(req);
  const currentRun = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!currentRun) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  const run = assistantStore.updateRun(threadId, runId, (existing) => ({
    ...existing,
    metadata: isPlainObject(body.metadata) ? body.metadata : existing.metadata || {},
  }));
  if (!run) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, run);
}

function handleAssistantRunCancel(res, assistantStore, threadId, runId) {
  const currentRun = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!currentRun) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  if (assistantRunIsTerminal(currentRun)) {
    sendJson(res, 200, currentRun);
    return;
  }
  const run = assistantStore.cancelRun(threadId, runId);
  if (!run) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, run);
}

async function handleAssistantRunSubmitToolOutputs(req, res, config, assistantStore, threadId, runId, fileSearchStore, containerStore, skillStore) {
  const body = await readJson(req);
  if (body.stream === true) {
    await streamAssistantToolOutputs({
      body,
      config,
      assistantStore,
      fileSearchStore,
      containerStore,
      skillStore,
      threadId,
      runId,
      incomingHeaders: req.headers,
      res,
    });
    return;
  }
  const result = await submitAssistantToolOutputs({
    body,
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    threadId,
    runId,
    incomingHeaders: req.headers,
  });
  if (!result.ok) {
    sendJson(res, result.status, result.error);
    return;
  }
  sendJson(res, 200, result.run);
}

function handleAssistantRunStepsList(res, assistantStore, threadId, runId, url) {
  const run = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!run) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  const steps = assistantStore.listRunSteps(threadId, runId);
  if (!steps) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  sendJson(res, 200, paginateList(projectAssistantRunStepsForIncludes(steps, url), url));
}

function handleAssistantRunStepGet(res, assistantStore, threadId, runId, stepId, url) {
  const run = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!run) {
    sendError(res, 404, `No run found for id '${runId}'`, {
      type: "invalid_request_error",
      code: "run_not_found",
      param: "run_id",
    });
    return;
  }
  const step = assistantStore.getRunStep(threadId, runId, stepId);
  if (!step) {
    sendError(res, 404, `No run step found for id '${stepId}'`, {
      type: "invalid_request_error",
      code: "run_step_not_found",
      param: "step_id",
    });
    return;
  }
  sendJson(res, 200, projectAssistantRunStepForIncludes(step, url));
}

async function createAndCompleteAssistantRun({
  body,
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  threadId,
  incomingHeaders,
}) {
  const prepared = prepareAssistantRunStart({ body, assistantStore, fileSearchStore, threadId });
  if (!prepared.ok) return prepared;
  return runAssistantChatTurn({
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    thread: prepared.thread,
    initialRun: prepared.initialRun,
    run: prepared.run,
    messages: prepared.messages,
    incomingHeaders,
  });
}

async function streamNewAssistantRun({
  body,
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  threadId,
  incomingHeaders,
  res,
  streamOptions = {},
}) {
  const prepared = prepareAssistantRunStart({ body, assistantStore, fileSearchStore, threadId });
  if (!prepared.ok) {
    sendJson(res, prepared.status, prepared.error);
    return;
  }
  await streamAssistantChatTurn({
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    thread: streamOptions.thread || prepared.thread,
    initialRun: prepared.initialRun,
    run: prepared.run,
    messages: prepared.messages,
    incomingHeaders,
    res,
    streamOptions,
  });
}

function prepareAssistantRunStart({ body, assistantStore, fileSearchStore, threadId }) {
  const assistantId = stringifyContent(body.assistant_id).trim();
  if (!assistantId) {
    return {
      ok: false,
      status: 400,
      error: openAiError("assistant_id is required", {
        type: "invalid_request_error",
        code: "missing_required_parameter",
        param: "assistant_id",
      }),
    };
  }
  const assistant = assistantStore.getAssistant(assistantId);
  if (!assistant) {
    return {
      ok: false,
      status: 404,
      error: openAiError(`No assistant found for id '${assistantId}'`, {
        type: "invalid_request_error",
        code: "assistant_not_found",
        param: "assistant_id",
      }),
    };
  }
  let thread = assistantStore.getThread(threadId);
  if (!thread) {
    return {
      ok: false,
      status: 404,
      error: openAiError(`No thread found for id '${threadId}'`, {
        type: "invalid_request_error",
        code: "thread_not_found",
        param: "thread_id",
      }),
    };
  }
  const activeRun = activeAssistantRunForThread(assistantStore, threadId);
  if (activeRun) {
    return {
      ok: false,
      status: 400,
      error: assistantThreadLockedError(threadId, activeRun, "run"),
    };
  }
  const additionalMessages = appendAssistantRunAdditionalMessages({
    assistantStore,
    fileSearchStore,
    threadId,
    body,
  });
  if (!additionalMessages.ok) return additionalMessages;
  thread = additionalMessages.thread || thread;

  const assistantForRun = {
    ...assistant,
    tool_resources: assistantRunToolResources(
      assistant.tool_resources,
      thread.tool_resources,
      body.tool_resources,
    ),
  };
  const initialRun = assistantStore.createRun(threadId, {
    ...body,
    tool_resources: assistantForRun.tool_resources,
  }, assistantForRun);
  const startedAt = nowSeconds();
  const inProgressRun = assistantStore.updateRun(threadId, initialRun.id, {
    ...initialRun,
    status: "in_progress",
    started_at: startedAt,
  });
  const messages = assistantStore.listMessages(threadId) || [];
  return {
    ok: true,
    assistant,
    thread,
    initialRun,
    run: inProgressRun || { ...initialRun, status: "in_progress", started_at: startedAt },
    messages,
  };
}

function assistantRunToolResources(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [toolName, resource] of Object.entries(source)) {
      if (isPlainObject(resource)) {
        merged[toolName] = {
          ...(isPlainObject(merged[toolName]) ? merged[toolName] : {}),
          ...clone(resource),
        };
      } else if (resource !== undefined) {
        merged[toolName] = clone(resource);
      }
    }
  }

  const vectorStoreIds = uniqStrings(sources.flatMap((source) => (
    assistantResourceIds(source, "file_search", "vector_store_ids")
  )));
  if (vectorStoreIds.length) {
    merged.file_search = {
      ...(isPlainObject(merged.file_search) ? merged.file_search : {}),
      vector_store_ids: vectorStoreIds,
    };
  }

  const codeFileIds = uniqStrings(sources.flatMap((source) => (
    assistantResourceIds(source, "code_interpreter", "file_ids")
  )));
  if (codeFileIds.length) {
    merged.code_interpreter = {
      ...(isPlainObject(merged.code_interpreter) ? merged.code_interpreter : {}),
      file_ids: codeFileIds,
    };
  }

  return merged;
}

function assistantResourceIds(resources, toolName, key) {
  if (!isPlainObject(resources)) return [];
  const values = resources[toolName]?.[key];
  if (!Array.isArray(values)) return [];
  return values.map((value) => stringifyContent(value).trim()).filter(Boolean);
}

function uniqStrings(values = []) {
  return Array.from(new Set(values.map((value) => stringifyContent(value).trim()).filter(Boolean)));
}

async function submitAssistantToolOutputs({
  body,
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  threadId,
  runId,
  incomingHeaders,
}) {
  const prepared = prepareAssistantToolOutputSubmission({ body, assistantStore, threadId, runId });
  if (!prepared.ok) return prepared;
  if (prepared.noOp) return prepared;
  return runAssistantChatTurn({
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    thread: prepared.thread,
    initialRun: prepared.initialRun,
    run: prepared.run,
    messages: prepared.messages,
    incomingHeaders,
    chatOptions: prepared.chatOptions,
  });
}

async function streamAssistantToolOutputs({
  body,
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  threadId,
  runId,
  incomingHeaders,
  res,
}) {
  const prepared = prepareAssistantToolOutputSubmission({ body, assistantStore, threadId, runId });
  if (!prepared.ok) {
    sendJson(res, prepared.status, prepared.error);
    return;
  }
  if (prepared.noOp) {
    writeAssistantRunStream(res, prepared.thread, prepared.initialRun, prepared.run, null, null, {
      includeThreadCreated: false,
      includeRunCreated: false,
    });
    return;
  }
  await streamAssistantChatTurn({
    config,
    assistantStore,
    fileSearchStore,
    containerStore,
    skillStore,
    thread: prepared.thread,
    initialRun: prepared.initialRun,
    run: prepared.run,
    messages: prepared.messages,
    incomingHeaders,
    res,
    chatOptions: prepared.chatOptions,
    streamOptions: {
      includeThreadCreated: false,
      includeRunCreated: false,
    },
  });
}

function prepareAssistantToolOutputSubmission({ body, assistantStore, threadId, runId }) {
  const thread = assistantStore.getThread(threadId);
  const existingRun = refreshAssistantRunState(assistantStore, threadId, runId);
  if (!existingRun) {
    return {
      ok: false,
      status: 404,
      error: openAiError(`No run found for id '${runId}'`, {
        type: "invalid_request_error",
        code: "run_not_found",
        param: "run_id",
      }),
    };
  }

  const requiredToolCalls = assistantRequiredActionToolCalls(existingRun);
  const toolOutputs = normalizeAssistantSubmittedToolOutputs(body.tool_outputs);
  if (existingRun.status !== "requires_action" || !requiredToolCalls.length) {
    const run = assistantStore.updateRun(threadId, runId, (existing) => ({
      ...existing,
      metadata: {
        ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
        compatibility: mergeCompatibility(existing.metadata?.compatibility, {
          local_assistants: {
            provider: "local",
            submit_tool_outputs: "no_op_without_required_action",
            tool_output_count: toolOutputs.length,
          },
        }),
      },
    }));
    return { ok: true, thread, initialRun: existingRun, run, message: null, step: null, noOp: true };
  }

  const outputsById = new Map(toolOutputs.map((output) => [output.tool_call_id, output]));
  const missingIds = requiredToolCalls
    .map((toolCall) => toolCall.id)
    .filter((id) => !outputsById.has(id));
  if (missingIds.length) {
    return {
      ok: false,
      status: 400,
      error: openAiError(`Missing tool outputs for tool calls: ${missingIds.join(", ")}`, {
        type: "invalid_request_error",
        code: "missing_tool_outputs",
        param: "tool_outputs",
      }),
    };
  }

  const startedAt = existingRun.started_at || nowSeconds();
  const inProgressRun = assistantStore.updateRun(threadId, runId, (existing) => ({
    ...existing,
    status: "in_progress",
    started_at: startedAt,
    required_action: null,
    last_error: null,
    metadata: {
      ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
      compatibility: mergeCompatibility(existing.metadata?.compatibility, {
        local_assistants: {
          provider: "local",
          submit_tool_outputs: "accepted",
          tool_output_count: toolOutputs.length,
        },
      }),
    },
  })) || { ...existingRun, status: "in_progress", started_at: startedAt, required_action: null };

  const messages = assistantStore.listMessages(threadId) || [];
  return {
    ok: true,
    thread,
    initialRun: existingRun,
    run: inProgressRun,
    messages,
    chatOptions: {
      requiredToolCalls,
      toolOutputs,
    },
  };
}

async function runAssistantChatTurn({
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  thread,
  initialRun,
  run,
  messages,
  incomingHeaders,
  chatOptions = {},
}) {
  const preparedChat = await prepareAssistantChatRequest({
    run,
    messages,
    config,
    chatOptions,
    fileSearchStore,
    containerStore,
    skillStore,
  });
  createAssistantHostedToolRunStep(assistantStore, run, preparedChat.hostedToolCalls);
  const { upstreamBody, compatibility } = chatPassthroughUpstreamBody(preparedChat.chat, config);
  const upstream = await fetchProvider(config, config.chatCompletionsPath, upstreamBody, incomingHeaders);
  const text = await upstream.text();
  const upstreamJson = parseJsonOrNull(text);
  if (!upstream.ok) {
    const failedAt = nowSeconds();
    const failedRun = assistantStore.updateRun(run.thread_id, run.id, {
      ...run,
      status: "failed",
      started_at: run.started_at || nowSeconds(),
      failed_at: failedAt,
      expires_at: null,
      last_error: {
        code: upstreamJson?.error?.code || "upstream_provider_error",
        message: upstreamJson?.error?.message || text || "assistant run provider call failed",
      },
    });
    return {
      ok: false,
      status: upstream.status,
      error: upstreamJson || openAiError(failedRun?.last_error?.message || "assistant run provider call failed", {
        type: "upstream_provider_error",
        code: upstream.status,
      }),
    };
  }

  const usage = assistantRunUsage(upstreamJson?.usage);
  const aggregateUsage = aggregateAssistantRunUsage(run.usage, usage);
  const budgetState = assistantRunTokenBudgetState(run, aggregateUsage, upstreamJson);
  const toolCalls = assistantChatToolCallsFromCompletion(upstreamJson);
  if (toolCalls.length) {
    const step = assistantStore.createToolCallsStep(run, toolCalls, usage);
    if (budgetState) {
      const incompleteAt = nowSeconds();
      const incompleteRun = assistantStore.updateRun(run.thread_id, run.id, (existing) => ({
        ...existing,
        status: "incomplete",
        started_at: existing.started_at || nowSeconds(),
        expires_at: null,
        required_action: null,
        incomplete_at: incompleteAt,
        incomplete_details: budgetState.incomplete_details,
        usage: aggregateUsage,
        metadata: {
          ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
          compatibility: mergeCompatibility(existing.metadata?.compatibility, preparedChat.compatibility, {
            local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
              ...preparedChat.assistantCompatibility,
              run_mode: chatOptions.toolOutputs ? "incomplete_submit_tool_outputs" : "incomplete_required_action",
              token_budget: budgetState.compatibility,
              tool_call_count: toolCalls.length,
              ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
            }),
          }),
        },
      }));
      return {
        ok: true,
        thread,
        initialRun,
        run: incompleteRun,
        message: null,
        step,
      };
    }
    const pendingRun = assistantStore.updateRun(run.thread_id, run.id, (existing) => ({
      ...existing,
      status: "requires_action",
      expires_at: existing.expires_at || nowSeconds() + 600,
      required_action: assistantRequiredAction(toolCalls),
      usage: aggregateUsage,
      metadata: {
        ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
        compatibility: mergeCompatibility(existing.metadata?.compatibility, preparedChat.compatibility, {
          local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
            ...preparedChat.assistantCompatibility,
            run_mode: "required_action",
            required_action: "submit_tool_outputs",
            tool_call_count: toolCalls.length,
            ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
          }),
        }),
      },
    }));
    return {
      ok: true,
      thread,
      initialRun,
      run: pendingRun,
      message: null,
      step,
    };
  }

  const assistantText = extractChatCompletionText(upstreamJson) || "";
  const message = assistantStore.createMessage(run.thread_id, {
    role: "assistant",
    content: assistantMessageContentWithLocalToolAnnotations(assistantText, preparedChat.contexts),
  }, {
    assistant_id: run.assistant_id,
    run_id: run.id,
  });
  const step = assistantStore.createMessageCreationStep(run, message.id, usage);
  const terminalAt = nowSeconds();
  const completedRun = assistantStore.updateRun(run.thread_id, run.id, {
    ...run,
    status: budgetState ? "incomplete" : "completed",
    started_at: run.started_at || nowSeconds(),
    expires_at: null,
    completed_at: budgetState ? null : terminalAt,
    incomplete_at: budgetState ? terminalAt : null,
    incomplete_details: budgetState?.incomplete_details || null,
    usage: aggregateUsage,
    metadata: {
      ...(isPlainObject(run.metadata) ? run.metadata : {}),
      compatibility: mergeCompatibility(run.metadata?.compatibility, preparedChat.compatibility, {
        local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
          ...preparedChat.assistantCompatibility,
          run_mode: budgetState
            ? (chatOptions.toolOutputs ? "incomplete_submit_tool_outputs" : "incomplete")
            : (chatOptions.toolOutputs ? "submit_tool_outputs" : "synchronous"),
          ...(budgetState ? { token_budget: budgetState.compatibility } : {}),
          ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
        }),
      }),
    },
  });
  return {
    ok: true,
    thread,
    initialRun,
    run: completedRun,
    message,
    step,
  };
}

async function streamAssistantChatTurn({
  config,
  assistantStore,
  fileSearchStore,
  containerStore,
  skillStore,
  thread,
  initialRun,
  run,
  messages,
  incomingHeaders,
  res,
  chatOptions = {},
  streamOptions = {},
}) {
  const preparedChat = await prepareAssistantChatRequest({
    run,
    messages,
    config,
    chatOptions,
    fileSearchStore,
    containerStore,
    skillStore,
  });
  const chat = preparedChat.chat;
  chat.stream = true;
  chat.stream_options = { ...(isPlainObject(chat.stream_options) ? chat.stream_options : {}), include_usage: true };
  const { upstreamBody, compatibility } = chatPassthroughUpstreamBody(chat, config);
  const hostedToolStep = createAssistantHostedToolRunStep(assistantStore, run, preparedChat.hostedToolCalls);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  if (streamOptions.includeThreadCreated !== false && thread) writeSse(res, "thread.created", thread);
  if (streamOptions.includeRunCreated !== false && initialRun) {
    writeSse(res, "thread.run.created", initialRun);
    writeSse(res, "thread.run.queued", initialRun);
  }
  writeSse(res, "thread.run.in_progress", run);
  if (hostedToolStep) {
    const projectedHostedToolStep = projectAssistantRunStepForIncludeSet(
      hostedToolStep,
      streamOptions.stepIncludes instanceof Set ? streamOptions.stepIncludes : new Set(),
    );
    writeSse(res, "thread.run.step.created", projectedHostedToolStep);
    writeSse(res, "thread.run.step.completed", projectedHostedToolStep);
  }

  const streamState = createAssistantStreamState(run);
  let upstream = null;
  try {
    upstream = await fetchProvider(config, config.chatCompletionsPath, upstreamBody, incomingHeaders);
    if (!upstream.ok) {
      const text = await upstream.text();
      const failedRun = failAssistantStreamRun(assistantStore, run, parseJsonOrNull(text), text, upstream.status);
      writeSse(res, "error", openAiError(failedRun?.last_error?.message || text || "assistant run provider call failed", {
        type: "upstream_provider_error",
        code: upstream.status,
      }));
      if (failedRun) writeSse(res, "thread.run.failed", failedRun);
      writeAssistantStreamDone(res);
      return;
    }

    const accumulator = createChatStreamAccumulator(upstreamBody);
    for await (const payload of iterateSseJson(upstream.body)) {
      if (payload === "[DONE]") break;
      applyChatCompletionStreamChunk(accumulator, payload);
      emitAssistantStreamChunkDeltas(res, assistantStore, run, streamState, payload);
    }

    const upstreamJson = finalizeChatStreamCompletion(accumulator) || {
      choices: [],
      model: upstreamBody.model,
      usage: streamState.usage,
    };
    const usage = assistantRunUsage(upstreamJson?.usage);
    const aggregateUsage = aggregateAssistantRunUsage(run.usage, usage);
    const budgetState = assistantRunTokenBudgetState(run, aggregateUsage, upstreamJson);
    const toolCalls = assistantChatToolCallsFromCompletion(upstreamJson);
    if (toolCalls.length) {
      completeAssistantTextStreamContext(res, assistantStore, run, streamState);
      const step = streamState.toolStep
        ? assistantStore.completeRunStep(run.thread_id, run.id, streamState.toolStep.id, usage, assistantToolCallsStepDetails(toolCalls))
        : assistantStore.createToolCallsStep(run, toolCalls, usage);
      if (step) writeSse(res, "thread.run.step.completed", step);
      if (budgetState) {
        const incompleteAt = nowSeconds();
        const incompleteRun = assistantStore.updateRun(run.thread_id, run.id, (existing) => ({
          ...existing,
          status: "incomplete",
          started_at: existing.started_at || nowSeconds(),
          expires_at: null,
          required_action: null,
          incomplete_at: incompleteAt,
          incomplete_details: budgetState.incomplete_details,
          usage: aggregateUsage,
          metadata: {
            ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
            compatibility: mergeCompatibility(existing.metadata?.compatibility, preparedChat.compatibility, {
              local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
                ...preparedChat.assistantCompatibility,
                run_mode: chatOptions.toolOutputs ? "streaming_incomplete_submit_tool_outputs" : "streaming_incomplete_required_action",
                token_budget: budgetState.compatibility,
                tool_call_count: toolCalls.length,
                streaming_supported: "chat_stream_delta_relay",
                ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
              }),
            }),
          },
        }));
        writeSse(res, "thread.run.incomplete", incompleteRun);
        writeAssistantStreamDone(res);
        return;
      }
      const pendingRun = assistantStore.updateRun(run.thread_id, run.id, (existing) => ({
        ...existing,
        status: "requires_action",
        expires_at: existing.expires_at || nowSeconds() + 600,
        required_action: assistantRequiredAction(toolCalls),
        usage: aggregateUsage,
        metadata: {
          ...(isPlainObject(existing.metadata) ? existing.metadata : {}),
          compatibility: mergeCompatibility(existing.metadata?.compatibility, preparedChat.compatibility, {
            local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
              ...preparedChat.assistantCompatibility,
              run_mode: "streaming_required_action",
              required_action: "submit_tool_outputs",
              tool_call_count: toolCalls.length,
              streaming_supported: "chat_stream_delta_relay",
              ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
            }),
          }),
        },
      }));
      writeSse(res, "thread.run.requires_action", pendingRun);
      writeAssistantStreamDone(res);
      return;
    }

    const assistantText = extractChatCompletionText(upstreamJson) || streamState.text || "";
    const textContext = ensureAssistantTextStreamContext(res, assistantStore, run, streamState);
    const message = assistantStore.completeMessage(run.thread_id, textContext.message.id, {
      content: assistantMessageContentWithLocalToolAnnotations(assistantText, preparedChat.contexts),
    });
    const step = assistantStore.completeRunStep(run.thread_id, run.id, textContext.step.id, usage);
    const terminalAt = nowSeconds();
    const completedRun = assistantStore.updateRun(run.thread_id, run.id, {
      ...run,
      status: budgetState ? "incomplete" : "completed",
      started_at: run.started_at || nowSeconds(),
      expires_at: null,
      completed_at: budgetState ? null : terminalAt,
      incomplete_at: budgetState ? terminalAt : null,
      incomplete_details: budgetState?.incomplete_details || null,
      usage: aggregateUsage,
      metadata: {
        ...(isPlainObject(run.metadata) ? run.metadata : {}),
        compatibility: mergeCompatibility(run.metadata?.compatibility, preparedChat.compatibility, {
          local_assistants: assistantRunCompatibility(run, upstreamJson, compatibility, {
            ...preparedChat.assistantCompatibility,
            run_mode: budgetState
              ? (chatOptions.toolOutputs ? "streaming_incomplete_submit_tool_outputs" : "streaming_incomplete")
              : (chatOptions.toolOutputs ? "streaming_submit_tool_outputs" : "streaming"),
            streaming_supported: "chat_stream_delta_relay",
            ...(budgetState ? { token_budget: budgetState.compatibility } : {}),
            ...(chatOptions.toolOutputs ? { submitted_tool_output_count: chatOptions.toolOutputs.length } : {}),
          }),
        }),
      },
    });
    writeSse(res, "thread.message.completed", message);
    writeSse(res, "thread.run.step.completed", step);
    writeSse(res, `thread.run.${completedRun.status || "completed"}`, completedRun);
    writeAssistantStreamDone(res);
  } catch (error) {
    const failedRun = failAssistantStreamRun(assistantStore, run, null, error.message, 500);
    writeSse(res, "error", openAiError(error.message || "assistant run stream failed", {
      type: "server_error",
      code: 500,
    }));
    if (failedRun) writeSse(res, "thread.run.failed", failedRun);
    writeAssistantStreamDone(res);
  }
}

async function prepareAssistantChatRequest({
  run,
  messages,
  config,
  chatOptions = {},
  fileSearchStore,
  containerStore,
  skillStore,
}) {
  const messageTruncation = assistantRunThreadMessagesForChat(run, messages);
  const chat = assistantRunToChatRequest(run, messageTruncation.messages, config, chatOptions);
  const contexts = {};
  const compatibility = {};
  const input = assistantLocalToolInput(messageTruncation.messages, chatOptions);
  const localHostedToolTypes = assistantLocalHostedToolTypes(run);

  const fileSearchTools = assistantFileSearchTools(run);
  if (fileSearchTools.length) {
    const localFileSearch = await prepareFileSearchContext({
      model: run.model || config.defaultModel,
      input,
      tools: fileSearchTools,
      tool_resources: run.tool_resources || {},
      include: ["file_search_call.results"],
    }, config, fileSearchStore);
    if (localFileSearch) {
      contexts.file_search = localFileSearch;
      applyLocalFileSearchToChat(chat, compatibility, localFileSearch, config);
    }
  }

  const codeInterpreterTools = assistantCodeInterpreterTools(run);
  if (codeInterpreterTools.length) {
    const localShell = await prepareShellContext({
      model: run.model || config.defaultModel,
      input,
      tools: codeInterpreterTools,
      include: ["code_interpreter_call.outputs"],
    }, config, containerStore, { skillStore, fileSearchStore });
    if (localShell) {
      contexts.shell = localShell;
      applyLocalShellToChat(chat, compatibility, localShell, config);
    }
  }

  const hostedToolCalls = assistantHostedToolCalls(contexts);
  return {
    chat,
    contexts,
    compatibility,
    hostedToolCalls,
    assistantCompatibility: {
      hosted_tools_supported: true,
      local_hosted_tool_types: localHostedToolTypes,
      local_hosted_tool_call_count: hostedToolCalls.length,
      ...(messageTruncation.compatibility ? { truncation: messageTruncation.compatibility } : {}),
      ...(contexts.file_search ? { local_file_search_status: fileSearchCompatibility(contexts.file_search).local_file_search?.status } : {}),
      ...(contexts.shell ? { local_code_interpreter_status: shellCompatibility(contexts.shell).local_shell?.status } : {}),
    },
  };
}

function assistantRunThreadMessagesForChat(run, threadMessages = []) {
  const originalMessages = Array.isArray(threadMessages) ? threadMessages : [];
  let selected = originalMessages.slice();
  const strategy = isPlainObject(run?.truncation_strategy)
    ? run.truncation_strategy
    : { type: "auto", last_messages: null };
  const compatibility = {
    original_message_count: originalMessages.length,
    included_message_count: selected.length,
  };

  const lastMessages = Number(strategy.last_messages);
  if (strategy.type === "last_messages" && Number.isInteger(lastMessages) && lastMessages >= 0) {
    selected = lastMessages === 0 ? [] : selected.slice(-lastMessages);
    Object.assign(compatibility, {
      strategy: "last_messages",
      last_messages: lastMessages,
      dropped_message_count: originalMessages.length - selected.length,
      included_message_count: selected.length,
    });
  } else if (strategy.type && strategy.type !== "auto") {
    Object.assign(compatibility, {
      strategy: stringifyContent(strategy.type),
      unsupported_strategy: true,
      reason: "unknown_truncation_strategy_preserved",
    });
  }

  const maxPromptTokens = Number(run?.max_prompt_tokens);
  if (Number.isFinite(maxPromptTokens) && maxPromptTokens > 0) {
    const estimatedBefore = assistantRunPromptTokenEstimate(run, selected);
    let estimatedAfter = estimatedBefore;
    let budgetDropped = 0;
    const budgetDroppedRoles = {};
    while (selected.length && estimatedAfter > maxPromptTokens) {
      const [dropped] = selected.splice(0, 1);
      budgetDropped += 1;
      const role = dropped?.role === "assistant" ? "assistant" : "user";
      budgetDroppedRoles[role] = (budgetDroppedRoles[role] || 0) + 1;
      estimatedAfter = assistantRunPromptTokenEstimate(run, selected);
    }
    Object.assign(compatibility, {
      max_prompt_tokens: maxPromptTokens,
      prompt_token_estimate_source: "json_chars_div4",
      estimated_prompt_tokens_before_budget: estimatedBefore,
      estimated_prompt_tokens_after_budget: estimatedAfter,
      max_prompt_tokens_budget_status: estimatedAfter <= maxPromptTokens ? "applied" : "exceeded",
      budget_dropped_message_count: budgetDropped,
      budget_dropped_roles: budgetDroppedRoles,
      included_message_count: selected.length,
    });
  }

  const changed = compatibility.strategy === "last_messages"
    || compatibility.dropped_message_count
    || compatibility.budget_dropped_message_count
    || compatibility.unsupported_strategy
    || compatibility.max_prompt_tokens;
  return {
    messages: selected,
    compatibility: changed ? compatibility : null,
  };
}

function assistantRunPromptTokenEstimate(run, threadMessages = []) {
  const chatMessages = [];
  const instructions = stringifyContent(run?.instructions).trim();
  if (instructions) chatMessages.push({ role: "system", content: instructions });
  for (const message of threadMessages) {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = assistantMessageContentText(message?.content);
    if (content) chatMessages.push({ role, content });
  }
  return Math.ceil(estimateChatMessagesChars(chatMessages) / 4);
}

function assistantLocalToolInput(messages = [], chatOptions = {}) {
  const lines = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = assistantMessageContentText(message.content);
    if (content) lines.push(`${role}:\n${content}`);
  }
  if (Array.isArray(chatOptions.requiredToolCalls) && chatOptions.requiredToolCalls.length) {
    for (const toolCall of chatOptions.requiredToolCalls) {
      lines.push(`assistant tool_call ${toolCall.id || ""}:\n${stringifyContent(toolCall.function?.name || toolCall.type || "")}`);
    }
  }
  if (Array.isArray(chatOptions.toolOutputs) && chatOptions.toolOutputs.length) {
    for (const output of chatOptions.toolOutputs) {
      lines.push(`tool ${output.tool_call_id || ""}:\n${stringifyContent(output.output || "")}`);
    }
  }
  return lines.join("\n\n") || "Continue the assistant thread.";
}

function assistantLocalHostedToolTypes(run) {
  return uniqStrings((Array.isArray(run.tools) ? run.tools : [])
    .map((tool) => tool?.type)
    .filter((type) => type === "file_search" || type === "code_interpreter"));
}

function assistantFileSearchTools(run) {
  const vectorStoreIds = assistantResourceIds(run.tool_resources, "file_search", "vector_store_ids");
  return (Array.isArray(run.tools) ? run.tools : [])
    .filter((tool) => isPlainObject(tool) && tool.type === "file_search")
    .map((tool) => {
      const mapped = clone(tool);
      const explicitIds = Array.isArray(mapped.vector_store_ids) ? mapped.vector_store_ids : [];
      const ids = uniqStrings([...explicitIds, ...vectorStoreIds]);
      if (ids.length) mapped.vector_store_ids = ids;
      mapped.tool_resources = {
        ...(isPlainObject(mapped.tool_resources) ? mapped.tool_resources : {}),
        file_search: {
          ...(isPlainObject(mapped.tool_resources?.file_search) ? mapped.tool_resources.file_search : {}),
          ...(ids.length ? { vector_store_ids: ids } : {}),
        },
      };
      return mapped;
    });
}

function assistantCodeInterpreterTools(run) {
  const fileIds = assistantResourceIds(run.tool_resources, "code_interpreter", "file_ids");
  return (Array.isArray(run.tools) ? run.tools : [])
    .filter((tool) => isPlainObject(tool) && tool.type === "code_interpreter")
    .map((tool) => {
      const mapped = clone(tool);
      const explicitIds = Array.isArray(mapped.file_ids) ? mapped.file_ids : [];
      const ids = uniqStrings([...explicitIds, ...fileIds]);
      if (ids.length) mapped.file_ids = ids;
      mapped.container = isPlainObject(mapped.container) ? mapped.container : { type: "auto" };
      mapped.tool_resources = {
        ...(isPlainObject(mapped.tool_resources) ? mapped.tool_resources : {}),
        code_interpreter: {
          ...(isPlainObject(mapped.tool_resources?.code_interpreter) ? mapped.tool_resources.code_interpreter : {}),
          ...(ids.length ? { file_ids: ids } : {}),
        },
      };
      return mapped;
    });
}

function assistantHostedToolCalls(contexts = {}) {
  const calls = [];
  for (const item of fileSearchOutputItems(contexts.file_search, { includeResults: true })) {
    calls.push({
      id: item.id,
      type: "file_search",
      file_search: {
        queries: item.queries || [],
        vector_store_ids: item.vector_store_ids || [],
        ...(item.ranking_options ? { ranking_options: item.ranking_options } : {}),
        results: item.results || [],
      },
    });
  }
  for (const item of shellOutputItems(contexts.shell, { includeCodeInterpreterOutputs: true })) {
    if (item.type !== "code_interpreter_call") continue;
    calls.push({
      id: item.id,
      type: "code_interpreter",
      code_interpreter: {
        input: stringifyContent(item.code || ""),
        outputs: Array.isArray(item.outputs) ? item.outputs : [],
      },
    });
  }
  return calls;
}

function createAssistantHostedToolRunStep(assistantStore, run, hostedToolCalls = []) {
  if (!hostedToolCalls.length) return null;
  return assistantStore.createToolCallsStep(run, hostedToolCalls, null);
}

function assistantMessageContentWithLocalToolAnnotations(text, contexts = {}) {
  const withSources = assistantFileSourceMarkers(text, contexts.file_search?.results || []);
  return [{
    type: "text",
    text: {
      value: withSources.text,
      annotations: withSources.annotations,
    },
  }];
}

function assistantFileSourceMarkers(text, results = []) {
  let output = stringifyContent(text || "");
  const annotations = [];
  const cited = [];

  results.forEach((result, index) => {
    const marker = `[${index + 1}]`;
    const markerIndex = output.indexOf(marker);
    if (markerIndex !== -1) cited.push({ result, marker, index: markerIndex });
  });

  if (!cited.length && results.length) {
    const sources = results.map((result, index) => `[${index + 1}] ${result.filename}`).join("\n");
    output = `${output.trimEnd()}\n\nSources:\n${sources}`;
    results.forEach((result, index) => {
      const marker = `[${index + 1}]`;
      const markerIndex = output.indexOf(marker, output.indexOf("Sources:"));
      if (markerIndex !== -1) cited.push({ result, marker, index: markerIndex });
    });
  }

  for (const citation of cited) {
    annotations.push({
      type: "file_citation",
      text: citation.marker,
      index: citation.index,
      start_index: citation.index,
      end_index: citation.index + citation.marker.length,
      file_id: citation.result.file_id,
      filename: citation.result.filename,
      file_citation: {
        file_id: citation.result.file_id,
      },
    });
  }

  return { text: output, annotations };
}

function createAssistantStreamState(run) {
  return {
    run,
    text: "",
    textContext: null,
    toolStep: null,
    usage: null,
  };
}

function emitAssistantStreamChunkDeltas(res, assistantStore, run, streamState, payload) {
  if (payload?.usage) streamState.usage = payload.usage;
  for (const choice of payload?.choices || []) {
    const delta = choice.delta || {};
    const textDelta = assistantStreamTextDelta(delta);
    if (textDelta) {
      const context = ensureAssistantTextStreamContext(res, assistantStore, run, streamState);
      streamState.text += textDelta;
      writeSse(res, "thread.message.delta", {
        id: context.message.id,
        object: "thread.message.delta",
        delta: {
          content: [{
            index: 0,
            type: "text",
            text: {
              value: textDelta,
              annotations: [],
            },
          }],
        },
      });
    }
    for (const deltaToolCall of delta.tool_calls || []) {
      const step = ensureAssistantToolStreamContext(res, assistantStore, run, streamState);
      writeSse(res, "thread.run.step.delta", {
        id: step.id,
        object: "thread.run.step.delta",
        delta: {
          step_details: {
            type: "tool_calls",
            tool_calls: [assistantToolCallStreamDelta(deltaToolCall)],
          },
        },
      });
    }
    if (isPlainObject(delta.function_call)) {
      const step = ensureAssistantToolStreamContext(res, assistantStore, run, streamState);
      writeSse(res, "thread.run.step.delta", {
        id: step.id,
        object: "thread.run.step.delta",
        delta: {
          step_details: {
            type: "tool_calls",
            tool_calls: [assistantToolCallStreamDelta({
              index: 0,
              type: "function",
              function: delta.function_call,
            })],
          },
        },
      });
    }
  }
}

function ensureAssistantTextStreamContext(res, assistantStore, run, streamState) {
  if (streamState.textContext) return streamState.textContext;
  const message = assistantStore.createMessage(run.thread_id, {
    role: "assistant",
    content: [],
  }, {
    assistant_id: run.assistant_id,
    run_id: run.id,
    status: "in_progress",
  });
  const step = assistantStore.createMessageCreationStep(run, message.id, null, { status: "in_progress" });
  streamState.textContext = { message, step };
  writeSse(res, "thread.run.step.created", step);
  writeSse(res, "thread.run.step.in_progress", step);
  writeSse(res, "thread.message.created", message);
  writeSse(res, "thread.message.in_progress", message);
  return streamState.textContext;
}

function completeAssistantTextStreamContext(res, assistantStore, run, streamState) {
  const context = streamState.textContext;
  if (!context || context.completed) return context || null;
  const completedMessage = assistantStore.completeMessage(run.thread_id, context.message.id, {
    content: streamState.text || "",
  });
  const completedStep = assistantStore.completeRunStep(run.thread_id, run.id, context.step.id);
  if (completedMessage) writeSse(res, "thread.message.completed", completedMessage);
  if (completedStep) writeSse(res, "thread.run.step.completed", completedStep);
  streamState.textContext = {
    ...context,
    message: completedMessage || context.message,
    step: completedStep || context.step,
    completed: true,
  };
  return streamState.textContext;
}

function ensureAssistantToolStreamContext(res, assistantStore, run, streamState) {
  if (streamState.toolStep) return streamState.toolStep;
  const step = assistantStore.createToolCallsStep(run, [], null, { status: "in_progress" });
  streamState.toolStep = step;
  writeSse(res, "thread.run.step.created", step);
  writeSse(res, "thread.run.step.in_progress", step);
  return step;
}

function assistantStreamTextDelta(delta) {
  if (!isPlainObject(delta)) return "";
  if (delta.content !== undefined && delta.content !== null) return chatContentToText(delta.content);
  if (delta.refusal !== undefined && delta.refusal !== null) return chatContentToText(delta.refusal);
  return "";
}

function assistantToolCallStreamDelta(deltaToolCall) {
  const item = {
    index: Number.isFinite(Number(deltaToolCall.index)) ? Number(deltaToolCall.index) : 0,
    type: stringifyContent(deltaToolCall.type || "function") || "function",
  };
  if (deltaToolCall.id) item.id = stringifyContent(deltaToolCall.id);
  if (isPlainObject(deltaToolCall.function)) {
    item.function = {};
    if (deltaToolCall.function.name !== undefined) item.function.name = stringifyContent(deltaToolCall.function.name);
    if (deltaToolCall.function.arguments !== undefined) item.function.arguments = stringifyContent(deltaToolCall.function.arguments);
    if (deltaToolCall.function.output !== undefined) item.function.output = deltaToolCall.function.output;
  }
  return item;
}

function assistantToolCallsStepDetails(toolCalls = []) {
  return {
    type: "tool_calls",
    tool_calls: toolCalls.map((toolCall) => ({
      id: stringifyContent(toolCall.id || ""),
      type: stringifyContent(toolCall.type || "function") || "function",
      function: {
        name: stringifyContent(toolCall.function?.name || ""),
        arguments: stringifyContent(toolCall.function?.arguments ?? ""),
        output: null,
      },
    })),
  };
}

function failAssistantStreamRun(assistantStore, run, upstreamJson, text, status) {
  const failedAt = nowSeconds();
  return assistantStore.updateRun(run.thread_id, run.id, {
    ...run,
    status: "failed",
    started_at: run.started_at || nowSeconds(),
    failed_at: failedAt,
    expires_at: null,
    last_error: {
      code: upstreamJson?.error?.code || "upstream_provider_error",
      message: upstreamJson?.error?.message || text || `assistant run provider stream failed (${status || 500})`,
    },
  });
}

function writeAssistantStreamDone(res) {
  res.write("event: done\n");
  res.write("data: [DONE]\n\n");
  res.end();
}

function assistantRunToChatRequest(run, threadMessages, config, options = {}) {
  const messages = [];
  const instructions = stringifyContent(run.instructions).trim();
  if (instructions) messages.push({ role: "system", content: instructions });
  for (const message of threadMessages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = assistantMessageContentText(message.content);
    if (content) messages.push({ role, content });
  }
  if (Array.isArray(options.requiredToolCalls) && options.requiredToolCalls.length) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: options.requiredToolCalls.map(assistantToolCallToChatToolCall),
    });
    for (const output of options.toolOutputs || []) {
      messages.push({
        role: "tool",
        tool_call_id: output.tool_call_id,
        content: output.output,
      });
    }
  }
  if (!messages.some((message) => message.role !== "system")) {
    messages.push({ role: "user", content: "Continue the assistant thread." });
  }
  const chat = {
    model: run.model || config.defaultModel,
    messages,
    temperature: run.temperature,
    top_p: run.top_p,
    stream: false,
  };
  if (run.max_completion_tokens != null) chat.max_completion_tokens = run.max_completion_tokens;
  if (run.reasoning_effort != null) chat.reasoning_effort = run.reasoning_effort;
  if (run.response_format && run.response_format !== "auto") chat.response_format = run.response_format;
  const toolMapping = assistantFunctionToolMapping(run.tools);
  if (toolMapping.tools.length) {
    chat.tools = toolMapping.tools;
    const toolChoice = assistantChatToolChoice(run.tool_choice);
    if (toolChoice !== undefined) chat.tool_choice = toolChoice;
    if (run.parallel_tool_calls !== undefined) chat.parallel_tool_calls = run.parallel_tool_calls;
  }
  return chat;
}

function assistantFunctionToolMapping(tools = []) {
  const mapped = [];
  const unsupported = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!isPlainObject(tool)) continue;
    if (tool.type !== "function") {
      unsupported.push(stringifyContent(tool.type || "unknown"));
      continue;
    }
    const fn = isPlainObject(tool.function) ? tool.function : tool;
    const name = stringifyContent(fn.name || "");
    if (!name) {
      unsupported.push("function_without_name");
      continue;
    }
    mapped.push({
      type: "function",
      function: {
        name,
        description: stringifyContent(fn.description || ""),
        parameters: isPlainObject(fn.parameters) ? clone(fn.parameters) : { type: "object", properties: {} },
        ...(fn.strict != null ? { strict: fn.strict } : {}),
      },
    });
  }
  return { tools: mapped, unsupported };
}

function assistantChatToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  if (!isPlainObject(toolChoice)) return undefined;
  if (toolChoice.type === "function") {
    const name = stringifyContent(toolChoice.function?.name || toolChoice.name || "");
    if (name) return { type: "function", function: { name } };
  }
  return toolChoice;
}

function assistantChatToolCallsFromCompletion(completion) {
  const calls = [];
  for (const choice of completion?.choices || []) {
    const message = choice?.message || {};
    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const normalized = normalizeAssistantToolCall(toolCall);
        if (normalized) calls.push(normalized);
      }
    } else if (isPlainObject(message.function_call) && message.function_call.name) {
      const normalized = normalizeAssistantToolCall({
        id: prefixedId("call"),
        type: "function",
        function: message.function_call,
      });
      if (normalized) calls.push(normalized);
    }
  }
  return calls;
}

function normalizeAssistantToolCall(toolCall) {
  if (!isPlainObject(toolCall)) return null;
  const fn = isPlainObject(toolCall.function) ? toolCall.function : {};
  const name = stringifyContent(fn.name || "");
  if (!name) return null;
  return {
    id: stringifyContent(toolCall.id || prefixedId("call")),
    type: stringifyContent(toolCall.type || "function") || "function",
    function: {
      name,
      arguments: stringifyContent(fn.arguments ?? ""),
    },
  };
}

function assistantToolCallToChatToolCall(toolCall) {
  return {
    id: stringifyContent(toolCall.id || prefixedId("call")),
    type: stringifyContent(toolCall.type || "function") || "function",
    function: {
      name: stringifyContent(toolCall.function?.name || ""),
      arguments: stringifyContent(toolCall.function?.arguments ?? ""),
    },
  };
}

function assistantRequiredAction(toolCalls = []) {
  return {
    type: "submit_tool_outputs",
    submit_tool_outputs: {
      tool_calls: toolCalls.map((toolCall) => ({
        id: stringifyContent(toolCall.id || ""),
        type: stringifyContent(toolCall.type || "function") || "function",
        function: {
          name: stringifyContent(toolCall.function?.name || ""),
          arguments: stringifyContent(toolCall.function?.arguments ?? ""),
        },
      })),
    },
  };
}

function assistantRequiredActionToolCalls(run) {
  const toolCalls = run?.required_action?.submit_tool_outputs?.tool_calls;
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map(normalizeAssistantToolCall)
    .filter(Boolean);
}

function normalizeAssistantSubmittedToolOutputs(toolOutputs) {
  return (Array.isArray(toolOutputs) ? toolOutputs : [])
    .filter(isPlainObject)
    .map((output) => ({
      tool_call_id: stringifyContent(output.tool_call_id || ""),
      output: stringifyContent(output.output ?? ""),
    }))
    .filter((output) => output.tool_call_id);
}

function aggregateAssistantRunUsage(previous, next) {
  if (!previous) return next || null;
  if (!next) return previous;
  const promptTokens = Number(previous.prompt_tokens || 0) + Number(next.prompt_tokens || 0);
  const completionTokens = Number(previous.completion_tokens || 0) + Number(next.completion_tokens || 0);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: Number(previous.total_tokens || 0) + Number(next.total_tokens || 0),
  };
}

function assistantRunTokenBudgetState(run, usage, upstreamJson) {
  if (!usage) return null;
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const finishReasons = assistantChatFinishReasons(upstreamJson);
  const maxPromptTokens = Number(run?.max_prompt_tokens);
  const maxCompletionTokens = Number(run?.max_completion_tokens);

  if (Number.isFinite(maxPromptTokens) && maxPromptTokens > 0 && promptTokens > maxPromptTokens) {
    return assistantRunTokenBudgetResult("max_prompt_tokens", {
      maxPromptTokens,
      maxCompletionTokens,
      promptTokens,
      completionTokens,
      finishReasons,
      trigger: "usage_exceeded_budget",
    });
  }

  const completionExceeded = Number.isFinite(maxCompletionTokens)
    && maxCompletionTokens > 0
    && completionTokens > maxCompletionTokens;
  const lengthStopped = Number.isFinite(maxCompletionTokens)
    && maxCompletionTokens > 0
    && finishReasons.some((reason) => ["length", "max_tokens", "max_output_tokens"].includes(reason));
  if (completionExceeded || lengthStopped) {
    return assistantRunTokenBudgetResult("max_completion_tokens", {
      maxPromptTokens,
      maxCompletionTokens,
      promptTokens,
      completionTokens,
      finishReasons,
      trigger: completionExceeded ? "usage_exceeded_budget" : "finish_reason_length",
    });
  }

  return null;
}

function assistantRunTokenBudgetResult(reason, details = {}) {
  const compatibility = {
    status: "incomplete",
    reason,
    trigger: details.trigger,
    prompt_tokens: details.promptTokens,
    completion_tokens: details.completionTokens,
    ...(Number.isFinite(details.maxPromptTokens) && details.maxPromptTokens > 0
      ? { max_prompt_tokens: details.maxPromptTokens }
      : {}),
    ...(Number.isFinite(details.maxCompletionTokens) && details.maxCompletionTokens > 0
      ? { max_completion_tokens: details.maxCompletionTokens }
      : {}),
    ...(details.finishReasons?.length ? { finish_reasons: details.finishReasons } : {}),
  };
  return {
    incomplete_details: { reason },
    compatibility,
  };
}

function assistantChatFinishReasons(upstreamJson) {
  return (Array.isArray(upstreamJson?.choices) ? upstreamJson.choices : [])
    .map((choice) => stringifyContent(choice?.finish_reason || "").trim())
    .filter(Boolean);
}

function assistantRunCompatibility(run, upstreamJson, chatPassthrough, extra = {}) {
  const toolMapping = assistantFunctionToolMapping(run.tools);
  const localHostedToolTypes = new Set(Array.isArray(extra.local_hosted_tool_types) ? extra.local_hosted_tool_types : []);
  const unsupported = toolMapping.unsupported.filter((type) => !localHostedToolTypes.has(type));
  return {
    provider: "local",
    upstream: "chat_completions",
    upstream_model: upstreamJson?.model || null,
    run_mode: "synchronous",
    tool_count: Array.isArray(run.tools) ? run.tools.length : 0,
    function_tool_count: toolMapping.tools.length,
    ...(unsupported.length ? { unsupported_tool_types: Array.from(new Set(unsupported)) } : {}),
    tool_calls_supported: true,
    streaming_supported: "event_shape_only",
    ...(chatPassthrough ? { chat_passthrough: chatPassthrough } : {}),
    ...extra,
  };
}

function assistantMessageContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyContent(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isPlainObject(part)) return stringifyContent(part);
      if (part.type === "text") return stringifyContent(part.text?.value ?? part.text ?? "");
      if (part.type === "image_file") return `[image_file:${stringifyContent(part.image_file?.file_id || "")}]`;
      if (part.type === "image_url") return `[image_url]`;
      return stringifyContent(part.text ?? part.content ?? "");
    })
    .filter(Boolean)
    .join("\n");
}

function assistantRunUsage(usage) {
  if (!usage) return null;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.total_tokens ?? promptTokens + completionTokens,
  };
}

function writeAssistantRunStream(res, thread, initialRun, completedRun, message, step, options = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  if (options.includeThreadCreated !== false && thread) writeSse(res, "thread.created", thread);
  if (options.includeRunCreated !== false && initialRun) {
    writeSse(res, "thread.run.created", initialRun);
    writeSse(res, "thread.run.queued", initialRun);
  }
  if (initialRun) {
    writeSse(res, "thread.run.in_progress", {
      ...initialRun,
      status: "in_progress",
      started_at: completedRun.started_at,
    });
  }
  if (message) writeSse(res, "thread.message.completed", message);
  if (step) writeSse(res, "thread.run.step.completed", step);
  writeSse(res, `thread.run.${completedRun.status || "completed"}`, completedRun);
  res.write("event: done\n");
  res.write("data: [DONE]\n\n");
  res.end();
}

function openAiError(message, details = {}) {
  return {
    error: {
      message,
      type: details.type || "invalid_request_error",
      param: details.param || null,
      code: details.code || null,
    },
  };
}

function createServer(config = loadConfig()) {
  config = {
    ...config,
    backgroundLeaseOwner: config.backgroundLeaseOwner || createBackgroundLeaseOwner(),
    backgroundLeaseTtlMs: normalizeBackgroundLeaseTtlMs(config),
  };
  const store = config.store || new FileResponseStore({ dir: config.stateDir });
  const conversationStore = config.conversationStore || new FileConversationStore({ dir: config.conversationStateDir });
  const fileSearchStore = config.fileSearchStore || new LocalFileSearchStore(config);
  const imageGenerationStore = config.imageGenerationStore || new FileImageGenerationStore({
    dir: config.imageGenerationStateDir,
    maxRecords: config.imageGenerationMaxStoredImages,
    ttlMs: config.imageGenerationStoreTtlMs,
  });
  const audioVoiceStore = config.audioVoiceStore || new FileAudioVoiceStore({
    dir: config.audioVoiceStateDir,
    maxVoices: config.audioVoiceMaxVoices,
  });
  const assistantStore = config.assistantStore || new FileAssistantStore({
    dir: config.assistantStateDir || path.join(config.stateDir || process.cwd(), "local-assistants"),
    maxRecords: config.assistantMaxRecords,
  });
  const chatKitStore = config.chatKitStore || new FileChatKitStore({
    dir: config.chatKitStateDir || path.join(config.stateDir || process.cwd(), "local-chatkit"),
    maxRecords: config.chatKitMaxRecords,
  });
  const realtimeStore = config.realtimeStore || new FileRealtimeStore({
    dir: config.realtimeStateDir || path.join(config.stateDir || process.cwd(), "local-realtime"),
    maxRecords: config.realtimeMaxRecords,
  });
  const fineTuningStore = config.fineTuningStore || new LocalFineTuningStore({
    dir: config.fineTuningStateDir || path.join(config.stateDir || process.cwd(), "local-fine-tuning"),
    maxRecords: config.fineTuningMaxRecords,
  });
  const uploadStore = config.uploadStore || new LocalUploadStore(config);
  const containerStore = config.containerStore || new LocalContainerStore(config);
  const skillStore = config.skillStore || new LocalSkillStore(config);
  const evalStore = config.evalStore || new LocalEvalStore(config);
  const backgroundJobs = new Map();
  const backgroundRestart = resumeStaleBackgroundResponses({
    config,
    store,
    backgroundJobs,
    fileSearchStore,
    imageGenerationStore,
    containerStore,
    conversationStore,
    skillStore,
  });
  if (backgroundRestart.resumed || backgroundRestart.reconciled || backgroundRestart.skipped) {
    log("processed stale background responses after startup", backgroundRestart);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
        sendJson(res, 200, {
          ok: true,
          service: "open-codex-responses-bridge",
          provider_base_url: config.providerBaseUrl,
          default_model: config.defaultModel,
          has_provider_key: !!config.providerApiKey,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/organization/costs") {
        handleOrganizationCosts(res, url);
        return;
      }

      const organizationUsageRoute = url.pathname.match(/^\/v1\/organization\/usage\/([^/]+)$/);
      if (organizationUsageRoute && req.method === "GET") {
        handleOrganizationUsage(res, decodeURIComponent(organizationUsageRoute[1]), url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        await handleModels(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/embeddings") {
        await handleEmbeddings(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/moderations") {
        await handleModerations(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/fine_tuning/alpha/graders/validate") {
        await handleGraderValidate(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/fine_tuning/alpha/graders/run") {
        await handleGraderRun(req, res, config);
        return;
      }

      if (url.pathname === "/v1/fine_tuning/jobs") {
        if (req.method === "GET") {
          handleFineTuningJobsList(res, fineTuningStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleFineTuningJobCreate(req, res, fineTuningStore);
          return;
        }
      }

      const fineTuningJobRoute = url.pathname.match(/^\/v1\/fine_tuning\/jobs\/([^/]+)(?:\/(cancel|pause|resume|events|checkpoints))?$/);
      if (fineTuningJobRoute) {
        const jobId = decodeURIComponent(fineTuningJobRoute[1]);
        const action = fineTuningJobRoute[2] || "";
        if (!action && req.method === "GET") {
          handleFineTuningJobGet(res, fineTuningStore, jobId);
          return;
        }
        if (["cancel", "pause", "resume"].includes(action) && req.method === "POST") {
          handleFineTuningJobAction(res, fineTuningStore, jobId, action);
          return;
        }
        if (action === "events" && req.method === "GET") {
          handleFineTuningJobEventsList(res, fineTuningStore, jobId, url);
          return;
        }
        if (action === "checkpoints" && req.method === "GET") {
          handleFineTuningJobCheckpointsList(res, fineTuningStore, jobId, url);
          return;
        }
      }

      const fineTuningCheckpointPermissionRoute = url.pathname.match(/^\/v1\/fine_tuning\/checkpoints\/(.+)\/permissions(?:\/([^/]+))?$/);
      if (fineTuningCheckpointPermissionRoute) {
        const checkpoint = decodeURIComponent(fineTuningCheckpointPermissionRoute[1]);
        const permissionId = fineTuningCheckpointPermissionRoute[2]
          ? decodeURIComponent(fineTuningCheckpointPermissionRoute[2])
          : "";
        if (!permissionId && req.method === "GET") {
          handleFineTuningCheckpointPermissionsList(res, fineTuningStore, checkpoint, url);
          return;
        }
        if (!permissionId && req.method === "POST") {
          await handleFineTuningCheckpointPermissionsCreate(req, res, fineTuningStore, checkpoint);
          return;
        }
        if (permissionId && req.method === "DELETE") {
          handleFineTuningCheckpointPermissionDelete(res, fineTuningStore, checkpoint, permissionId);
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/realtime/sessions") {
        await handleRealtimeSessionCreate(req, res, realtimeStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/realtime/client_secrets") {
        await handleRealtimeClientSecretCreate(req, res, realtimeStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/realtime/transcription_sessions") {
        await handleRealtimeTranscriptionSessionCreate(req, res, realtimeStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/realtime/translations/client_secrets") {
        await handleRealtimeTranslationClientSecretCreate(req, res, realtimeStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/realtime/calls") {
        await handleRealtimeCallCreate(req, res, realtimeStore);
        return;
      }

      const realtimeCallActionRoute = url.pathname.match(/^\/v1\/realtime\/calls\/([^/]+)\/(accept|reject|hangup|refer)$/);
      if (realtimeCallActionRoute && req.method === "POST") {
        await handleRealtimeCallAction(req, res, realtimeStore, decodeURIComponent(realtimeCallActionRoute[1]), realtimeCallActionRoute[2]);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/chatkit/sessions") {
        await handleChatKitSessionCreate(req, res, chatKitStore);
        return;
      }

      const chatKitSessionCancelRoute = url.pathname.match(/^\/v1\/chatkit\/sessions\/([^/]+)\/cancel$/);
      if (chatKitSessionCancelRoute && req.method === "POST") {
        handleChatKitSessionCancel(res, chatKitStore, decodeURIComponent(chatKitSessionCancelRoute[1]));
        return;
      }

      if (url.pathname === "/v1/chatkit/threads") {
        if (req.method === "GET") {
          handleChatKitThreadsList(res, chatKitStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleChatKitThreadCreate(req, res, chatKitStore);
          return;
        }
      }

      const chatKitThreadItemsRoute = url.pathname.match(/^\/v1\/chatkit\/threads\/([^/]+)\/items$/);
      if (chatKitThreadItemsRoute) {
        const threadId = decodeURIComponent(chatKitThreadItemsRoute[1]);
        if (req.method === "GET") {
          handleChatKitThreadItemsList(res, chatKitStore, threadId, url);
          return;
        }
        if (req.method === "POST") {
          await handleChatKitThreadItemsCreate(req, res, chatKitStore, threadId);
          return;
        }
      }

      const chatKitThreadRoute = url.pathname.match(/^\/v1\/chatkit\/threads\/([^/]+)$/);
      if (chatKitThreadRoute) {
        const threadId = decodeURIComponent(chatKitThreadRoute[1]);
        if (req.method === "GET") {
          handleChatKitThreadGet(res, chatKitStore, threadId);
          return;
        }
        if (req.method === "POST") {
          await handleChatKitThreadUpdate(req, res, chatKitStore, threadId);
          return;
        }
        if (req.method === "DELETE") {
          handleChatKitThreadDelete(res, chatKitStore, threadId);
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
        await handleAudioSpeech(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
        await handleAudioTranscriptions(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/audio/translations") {
        await handleAudioTranslations(req, res, config);
        return;
      }

      if (url.pathname === "/v1/audio/voice_consents") {
        if (req.method === "GET") {
          handleAudioVoiceConsentsList(res, audioVoiceStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleAudioVoiceConsentsCreate(req, res, config, audioVoiceStore);
          return;
        }
      }

      const voiceConsentRoute = url.pathname.match(/^\/v1\/audio\/voice_consents\/([^/]+)$/);
      if (voiceConsentRoute && req.method === "GET") {
        handleAudioVoiceConsentGet(res, audioVoiceStore, decodeURIComponent(voiceConsentRoute[1]));
        return;
      }

      if (url.pathname === "/v1/audio/voices") {
        if (req.method === "GET") {
          handleAudioVoicesList(res, audioVoiceStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleAudioVoicesCreate(req, res, config, audioVoiceStore);
          return;
        }
      }

      const audioVoiceRoute = url.pathname.match(/^\/v1\/audio\/voices\/([^/]+)$/);
      if (audioVoiceRoute && req.method === "GET") {
        handleAudioVoiceGet(res, audioVoiceStore, decodeURIComponent(audioVoiceRoute[1]));
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/images/generations") {
        await handleImagesGenerations(req, res, config);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/images/edits") {
        await handleImagesEdits(req, res, config, fileSearchStore, imageGenerationStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/images/variations") {
        await handleImagesVariations(req, res, config, fileSearchStore, imageGenerationStore);
        return;
      }

      if (url.pathname === "/v1/videos") {
        if (req.method === "GET") {
          handleVideosList(res, store, url);
          return;
        }
        if (req.method === "POST") {
          await handleVideosCreate(req, res, config, store, { operation: "create" });
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/videos/characters") {
        await handleVideoCharacterCreate(req, res, config, store);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/videos/edits") {
        await handleVideosCreate(req, res, config, store, { operation: "edit" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/videos/extensions") {
        await handleVideosCreate(req, res, config, store, { operation: "extend" });
        return;
      }

      const videoEditRoute = url.pathname.match(/^\/v1\/videos\/([^/]+)\/edits$/);
      if (videoEditRoute && req.method === "POST") {
        await handleVideosCreate(req, res, config, store, {
          operation: "edit",
          sourceVideoId: decodeURIComponent(videoEditRoute[1]),
        });
        return;
      }

      const videoRemixRoute = url.pathname.match(/^\/v1\/videos\/([^/]+)\/remix$/);
      if (videoRemixRoute && req.method === "POST") {
        await handleVideosCreate(req, res, config, store, {
          operation: "remix",
          sourceVideoId: decodeURIComponent(videoRemixRoute[1]),
        });
        return;
      }

      const videoContentRoute = url.pathname.match(/^\/v1\/videos\/([^/]+)\/content$/);
      if (videoContentRoute && req.method === "GET") {
        handleVideoContent(res, store, decodeURIComponent(videoContentRoute[1]), url);
        return;
      }

      const videoCharacterRoute = url.pathname.match(/^\/v1\/videos\/characters\/([^/]+)$/);
      if (videoCharacterRoute) {
        const characterId = decodeURIComponent(videoCharacterRoute[1]);
        if (req.method === "GET") {
          handleVideoCharacterGet(res, store, characterId);
          return;
        }
        if (req.method === "DELETE") {
          handleVideoCharacterDelete(res, store, characterId);
          return;
        }
      }

      const videoRoute = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
      if (videoRoute) {
        const videoId = decodeURIComponent(videoRoute[1]);
        if (req.method === "GET") {
          handleVideoGet(res, store, videoId);
          return;
        }
        if (req.method === "DELETE") {
          handleVideoDelete(res, store, videoId);
          return;
        }
      }

      if (url.pathname === "/v1/batches") {
        if (req.method === "GET") {
          handleBatchesList(res, store, url);
          return;
        }
        if (req.method === "POST") {
          await handleBatchCreate(req, res, config, store, fileSearchStore, imageGenerationStore, backgroundJobs, containerStore, conversationStore, skillStore);
          return;
        }
      }

      const batchRoute = url.pathname.match(/^\/v1\/batches\/([^/]+)(?:\/(cancel))?$/);
      if (batchRoute) {
        const batchId = decodeURIComponent(batchRoute[1]);
        const action = batchRoute[2] || "";
        if (!action && req.method === "GET") {
          handleBatchGet(res, store, batchId);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleBatchCancel(res, store, batchId);
          return;
        }
      }

      if (url.pathname === "/v1/evals") {
        if (req.method === "GET") {
          handleEvalsList(res, evalStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleEvalCreate(req, res, evalStore);
          return;
        }
      }

      const evalRunOutputItemsRoute = url.pathname.match(/^\/v1\/evals\/([^/]+)\/runs\/([^/]+)\/output_items(?:\/([^/]+))?$/);
      if (evalRunOutputItemsRoute) {
        const evalId = decodeURIComponent(evalRunOutputItemsRoute[1]);
        const runId = decodeURIComponent(evalRunOutputItemsRoute[2]);
        const outputItemId = evalRunOutputItemsRoute[3] ? decodeURIComponent(evalRunOutputItemsRoute[3]) : "";
        if (!outputItemId && req.method === "GET") {
          handleEvalRunOutputItemsList(res, evalStore, evalId, runId, url);
          return;
        }
        if (outputItemId && req.method === "GET") {
          handleEvalRunOutputItemGet(res, evalStore, evalId, runId, outputItemId);
          return;
        }
      }

      const evalRunsRoute = url.pathname.match(/^\/v1\/evals\/([^/]+)\/runs(?:\/([^/]+)(?:\/(cancel))?)?$/);
      if (evalRunsRoute) {
        const evalId = decodeURIComponent(evalRunsRoute[1]);
        const runId = evalRunsRoute[2] ? decodeURIComponent(evalRunsRoute[2]) : "";
        const action = evalRunsRoute[3] || "";
        if (!runId && req.method === "GET") {
          handleEvalRunsList(res, evalStore, evalId, url);
          return;
        }
        if (!runId && req.method === "POST") {
          await handleEvalRunCreate(req, res, config, store, fileSearchStore, imageGenerationStore, backgroundJobs, containerStore, conversationStore, skillStore, evalStore, evalId);
          return;
        }
        if (runId && !action && req.method === "GET") {
          handleEvalRunGet(res, evalStore, evalId, runId);
          return;
        }
        if (runId && action === "cancel" && req.method === "POST") {
          handleEvalRunCancel(res, evalStore, evalId, runId);
          return;
        }
      }

      const evalRoute = url.pathname.match(/^\/v1\/evals\/([^/]+)$/);
      if (evalRoute) {
        const evalId = decodeURIComponent(evalRoute[1]);
        if (req.method === "GET") {
          handleEvalGet(res, evalStore, evalId);
          return;
        }
        if (req.method === "POST") {
          await handleEvalUpdate(req, res, evalStore, evalId);
          return;
        }
        if (req.method === "DELETE") {
          handleEvalDelete(res, evalStore, evalId);
          return;
        }
      }

      if (url.pathname === "/v1/assistants") {
        if (req.method === "GET") {
          handleAssistantsList(res, assistantStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleAssistantCreate(req, res, assistantStore);
          return;
        }
      }

      const assistantRoute = url.pathname.match(/^\/v1\/assistants\/([^/]+)$/);
      if (assistantRoute) {
        const assistantId = decodeURIComponent(assistantRoute[1]);
        if (req.method === "GET") {
          handleAssistantGet(res, assistantStore, assistantId);
          return;
        }
        if (req.method === "POST") {
          await handleAssistantUpdate(req, res, assistantStore, assistantId);
          return;
        }
        if (req.method === "DELETE") {
          handleAssistantDelete(res, assistantStore, assistantId);
          return;
        }
      }

      if (url.pathname === "/v1/threads/runs" && req.method === "POST") {
        await handleAssistantThreadAndRunCreate(req, res, config, assistantStore, fileSearchStore, containerStore, skillStore, url);
        return;
      }

      if (url.pathname === "/v1/threads") {
        if (req.method === "POST") {
          await handleAssistantThreadCreate(req, res, assistantStore, fileSearchStore);
          return;
        }
      }

      const assistantRunStepRoute = url.pathname.match(/^\/v1\/threads\/([^/]+)\/runs\/([^/]+)\/steps(?:\/([^/]+))?$/);
      if (assistantRunStepRoute) {
        const threadId = decodeURIComponent(assistantRunStepRoute[1]);
        const runId = decodeURIComponent(assistantRunStepRoute[2]);
        const stepId = assistantRunStepRoute[3] ? decodeURIComponent(assistantRunStepRoute[3]) : "";
        if (req.method === "GET" && stepId) {
          handleAssistantRunStepGet(res, assistantStore, threadId, runId, stepId, url);
          return;
        }
        if (req.method === "GET") {
          handleAssistantRunStepsList(res, assistantStore, threadId, runId, url);
          return;
        }
      }

      const assistantRunActionRoute = url.pathname.match(/^\/v1\/threads\/([^/]+)\/runs\/([^/]+)\/(cancel|submit_tool_outputs)$/);
      if (assistantRunActionRoute && req.method === "POST") {
        const threadId = decodeURIComponent(assistantRunActionRoute[1]);
        const runId = decodeURIComponent(assistantRunActionRoute[2]);
        const action = assistantRunActionRoute[3];
        if (action === "cancel") {
          handleAssistantRunCancel(res, assistantStore, threadId, runId);
          return;
        }
        await handleAssistantRunSubmitToolOutputs(req, res, config, assistantStore, threadId, runId, fileSearchStore, containerStore, skillStore);
        return;
      }

      const assistantRunsRoute = url.pathname.match(/^\/v1\/threads\/([^/]+)\/runs(?:\/([^/]+))?$/);
      if (assistantRunsRoute) {
        const threadId = decodeURIComponent(assistantRunsRoute[1]);
        const runId = assistantRunsRoute[2] ? decodeURIComponent(assistantRunsRoute[2]) : "";
        if (!runId && req.method === "GET") {
          handleAssistantRunsList(res, assistantStore, threadId, url);
          return;
        }
        if (!runId && req.method === "POST") {
          await handleAssistantRunCreate(req, res, config, assistantStore, threadId, fileSearchStore, containerStore, skillStore, url);
          return;
        }
        if (runId && req.method === "GET") {
          handleAssistantRunGet(res, assistantStore, threadId, runId);
          return;
        }
        if (runId && req.method === "POST") {
          await handleAssistantRunUpdate(req, res, assistantStore, threadId, runId);
          return;
        }
      }

      const assistantMessagesRoute = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages(?:\/([^/]+))?$/);
      if (assistantMessagesRoute) {
        const threadId = decodeURIComponent(assistantMessagesRoute[1]);
        const messageId = assistantMessagesRoute[2] ? decodeURIComponent(assistantMessagesRoute[2]) : "";
        if (!messageId && req.method === "GET") {
          handleAssistantMessagesList(res, assistantStore, threadId, url);
          return;
        }
        if (!messageId && req.method === "POST") {
          await handleAssistantMessageCreate(req, res, assistantStore, fileSearchStore, threadId);
          return;
        }
        if (messageId && req.method === "GET") {
          handleAssistantMessageGet(res, assistantStore, threadId, messageId);
          return;
        }
        if (messageId && req.method === "POST") {
          await handleAssistantMessageUpdate(req, res, assistantStore, threadId, messageId);
          return;
        }
        if (messageId && req.method === "DELETE") {
          handleAssistantMessageDelete(res, assistantStore, threadId, messageId);
          return;
        }
      }

      const assistantThreadRoute = url.pathname.match(/^\/v1\/threads\/([^/]+)$/);
      if (assistantThreadRoute) {
        const threadId = decodeURIComponent(assistantThreadRoute[1]);
        if (req.method === "GET") {
          handleAssistantThreadGet(res, assistantStore, threadId);
          return;
        }
        if (req.method === "POST") {
          await handleAssistantThreadUpdate(req, res, assistantStore, threadId);
          return;
        }
        if (req.method === "DELETE") {
          handleAssistantThreadDelete(res, assistantStore, threadId);
          return;
        }
      }

      if (url.pathname === "/v1/containers") {
        if (req.method === "GET") {
          handleContainersList(res, containerStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleContainerCreate(req, res, containerStore);
          return;
        }
      }

      if (url.pathname === "/v1/skills") {
        if (req.method === "GET") {
          handleSkillsList(res, skillStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleSkillCreate(req, res, config, skillStore);
          return;
        }
      }

      const skillVersionsRoute = url.pathname.match(/^\/v1\/skills\/([^/]+)\/versions(?:\/([^/]+)(?:\/(content))?)?$/);
      if (skillVersionsRoute) {
        const skillId = decodeURIComponent(skillVersionsRoute[1]);
        const version = skillVersionsRoute[2] ? decodeURIComponent(skillVersionsRoute[2]) : "";
        const action = skillVersionsRoute[3] || "";
        if (!version && req.method === "GET") {
          handleSkillVersionsList(res, skillStore, skillId, url);
          return;
        }
        if (!version && req.method === "POST") {
          await handleSkillVersionCreate(req, res, config, skillStore, skillId);
          return;
        }
        if (version && action === "content" && req.method === "GET") {
          handleSkillContent(res, skillStore, skillId, version);
          return;
        }
        if (version && !action && req.method === "GET") {
          handleSkillVersionGet(res, skillStore, skillId, version);
          return;
        }
        if (version && !action && req.method === "DELETE") {
          handleSkillVersionDelete(res, skillStore, skillId, version);
          return;
        }
      }

      const skillRoute = url.pathname.match(/^\/v1\/skills\/([^/]+)(?:\/(content))?$/);
      if (skillRoute) {
        const skillId = decodeURIComponent(skillRoute[1]);
        const action = skillRoute[2] || "";
        if (action === "content" && req.method === "GET") {
          handleSkillContent(res, skillStore, skillId, "default");
          return;
        }
        if (!action && req.method === "GET") {
          handleSkillGet(res, skillStore, skillId);
          return;
        }
        if (!action && req.method === "POST") {
          await handleSkillUpdate(req, res, skillStore, skillId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleSkillDelete(res, skillStore, skillId);
          return;
        }
      }

      const containerFilesRoute = url.pathname.match(/^\/v1\/containers\/([^/]+)\/files(?:\/([^/]+)(?:\/(content))?)?$/);
      if (containerFilesRoute) {
        const containerId = decodeURIComponent(containerFilesRoute[1]);
        const fileId = containerFilesRoute[2] ? decodeURIComponent(containerFilesRoute[2]) : "";
        const action = containerFilesRoute[3] || "";
        if (!fileId && req.method === "GET") {
          handleContainerFilesList(res, containerStore, containerId, url);
          return;
        }
        if (!fileId && req.method === "POST") {
          await handleContainerFileCreate(req, res, config, containerStore, containerId);
          return;
        }
        if (fileId && !action && req.method === "GET") {
          handleContainerFileGet(res, containerStore, containerId, fileId);
          return;
        }
        if (fileId && !action && req.method === "DELETE") {
          handleContainerFileDelete(res, containerStore, containerId, fileId);
          return;
        }
        if (fileId && action === "content" && req.method === "GET") {
          handleContainerFileContent(res, containerStore, containerId, fileId);
          return;
        }
      }

      const containerRoute = url.pathname.match(/^\/v1\/containers\/([^/]+)$/);
      if (containerRoute) {
        const containerId = decodeURIComponent(containerRoute[1]);
        if (req.method === "GET") {
          handleContainerGet(res, containerStore, containerId);
          return;
        }
        if (req.method === "DELETE") {
          handleContainerDelete(res, containerStore, containerId);
          return;
        }
      }

      if (url.pathname === "/v1/uploads" && req.method === "POST") {
        await handleUploadCreate(req, res, uploadStore);
        return;
      }

      const uploadRoute = url.pathname.match(/^\/v1\/uploads\/([^/]+)\/(parts|complete|cancel)$/);
      if (uploadRoute) {
        const uploadId = decodeURIComponent(uploadRoute[1]);
        const action = uploadRoute[2];
        if (action === "parts" && req.method === "POST") {
          await handleUploadPartCreate(req, res, config, uploadStore, uploadId);
          return;
        }
        if (action === "complete" && req.method === "POST") {
          await handleUploadComplete(req, res, uploadStore, fileSearchStore, uploadId);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleUploadCancel(res, uploadStore, uploadId);
          return;
        }
      }

      if (url.pathname === "/v1/files") {
        if (req.method === "GET") {
          handleFilesList(res, fileSearchStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleFileCreate(req, res, config, fileSearchStore);
          return;
        }
      }

      const fileRoute = url.pathname.match(/^\/v1\/files\/([^/]+)(?:\/(content))?$/);
      if (fileRoute) {
        const fileId = decodeURIComponent(fileRoute[1]);
        const action = fileRoute[2] || "";
        if (!action && req.method === "GET") {
          handleFileGet(res, fileSearchStore, fileId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleFileDelete(res, fileSearchStore, fileId);
          return;
        }
        if (action === "content" && req.method === "GET") {
          handleFileContent(res, fileSearchStore, fileId);
          return;
        }
      }

      if (url.pathname === "/v1/vector_stores") {
        if (req.method === "GET") {
          handleVectorStoresList(res, fileSearchStore, url);
          return;
        }
        if (req.method === "POST") {
          await handleVectorStoreCreate(req, res, fileSearchStore);
          return;
        }
      }

      const vectorStoreSearchRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/search$/);
      if (vectorStoreSearchRoute && req.method === "POST") {
        await handleVectorStoreSearch(req, res, fileSearchStore, decodeURIComponent(vectorStoreSearchRoute[1]));
        return;
      }

      const vectorStoreFileBatchesRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/file_batches(?:\/([^/]+)(?:\/(files|cancel))?)?$/);
      if (vectorStoreFileBatchesRoute) {
        const storeId = decodeURIComponent(vectorStoreFileBatchesRoute[1]);
        const batchId = vectorStoreFileBatchesRoute[2] ? decodeURIComponent(vectorStoreFileBatchesRoute[2]) : "";
        const action = vectorStoreFileBatchesRoute[3] || "";
        if (!batchId && req.method === "POST") {
          await handleVectorStoreFileBatchCreate(req, res, fileSearchStore, storeId);
          return;
        }
        if (batchId && !action && req.method === "GET") {
          handleVectorStoreFileBatchGet(res, fileSearchStore, storeId, batchId);
          return;
        }
        if (batchId && action === "files" && req.method === "GET") {
          handleVectorStoreFileBatchFilesList(res, fileSearchStore, storeId, batchId, url);
          return;
        }
        if (batchId && action === "cancel" && req.method === "POST") {
          handleVectorStoreFileBatchCancel(res, fileSearchStore, storeId, batchId);
          return;
        }
      }

      const vectorStoreFilesRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)\/files(?:\/([^/]+)(?:\/(content))?)?$/);
      if (vectorStoreFilesRoute) {
        const storeId = decodeURIComponent(vectorStoreFilesRoute[1]);
        const fileId = vectorStoreFilesRoute[2] ? decodeURIComponent(vectorStoreFilesRoute[2]) : "";
        const action = vectorStoreFilesRoute[3] || "";
        if (!fileId && req.method === "GET") {
          handleVectorStoreFilesList(res, fileSearchStore, storeId, url);
          return;
        }
        if (!fileId && req.method === "POST") {
          await handleVectorStoreFileCreate(req, res, fileSearchStore, storeId);
          return;
        }
        if (fileId && !action && req.method === "GET") {
          handleVectorStoreFileGet(res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && !action && req.method === "POST") {
          await handleVectorStoreFileUpdate(req, res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && !action && req.method === "DELETE") {
          handleVectorStoreFileDelete(res, fileSearchStore, storeId, fileId);
          return;
        }
        if (fileId && action === "content" && req.method === "GET") {
          handleVectorStoreFileContent(res, fileSearchStore, storeId, fileId);
          return;
        }
      }

      const vectorStoreRoute = url.pathname.match(/^\/v1\/vector_stores\/([^/]+)$/);
      if (vectorStoreRoute) {
        const storeId = decodeURIComponent(vectorStoreRoute[1]);
        if (req.method === "GET") {
          handleVectorStoreGet(res, fileSearchStore, storeId);
          return;
        }
        if (req.method === "POST") {
          await handleVectorStoreUpdate(req, res, fileSearchStore, storeId);
          return;
        }
        if (req.method === "DELETE") {
          handleVectorStoreDelete(res, fileSearchStore, storeId);
          return;
        }
      }

      const modelRoute = url.pathname.match(/^\/v1\/models\/([^/]+)$/);
      if (modelRoute && req.method === "GET") {
        await handleModelGet(req, res, config, decodeURIComponent(modelRoute[1]));
        return;
      }

      if (url.pathname === "/v1/conversations") {
        if (req.method === "POST") {
          await handleConversationCreate(req, res, conversationStore);
          return;
        }
      }

      const conversationItemsRoute = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/items(?:\/([^/]+))?$/);
      if (conversationItemsRoute) {
        const conversationId = decodeURIComponent(conversationItemsRoute[1]);
        const itemId = conversationItemsRoute[2] ? decodeURIComponent(conversationItemsRoute[2]) : "";
        if (!itemId && req.method === "GET") {
          handleConversationItemsList(res, conversationStore, conversationId, url);
          return;
        }
        if (!itemId && req.method === "POST") {
          await handleConversationItemsCreate(req, res, conversationStore, conversationId);
          return;
        }
        if (itemId && req.method === "GET") {
          handleConversationItemGet(res, conversationStore, conversationId, itemId, url);
          return;
        }
        if (itemId && req.method === "DELETE") {
          handleConversationItemDelete(res, conversationStore, conversationId, itemId);
          return;
        }
      }

      const conversationRoute = url.pathname.match(/^\/v1\/conversations\/([^/]+)$/);
      if (conversationRoute) {
        const conversationId = decodeURIComponent(conversationRoute[1]);
        if (req.method === "GET") {
          handleConversationGet(res, conversationStore, conversationId);
          return;
        }
        if (req.method === "POST") {
          await handleConversationUpdate(req, res, conversationStore, conversationId);
          return;
        }
        if (req.method === "DELETE") {
          handleConversationDelete(res, conversationStore, conversationId);
          return;
        }
      }

      if (req.method === "POST" && url.pathname === "/v1/responses") {
        await handleResponses(req, res, config, store, backgroundJobs, fileSearchStore, imageGenerationStore, containerStore, conversationStore, skillStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/compact") {
        await handleResponseCompact(req, res, config, store, fileSearchStore, conversationStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/responses/input_tokens") {
        await handleResponseInputTokens(req, res, config, store, fileSearchStore, conversationStore);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/completions") {
        await handleLegacyCompletions(req, res, config);
        return;
      }

      const responseRoute = url.pathname.match(/^\/v1\/responses\/([^/]+)(?:\/([^/]+))?$/);
      if (responseRoute) {
        const responseId = decodeURIComponent(responseRoute[1]);
        const action = responseRoute[2] || "";
        if (!action && req.method === "GET") {
          handleResponseGet(res, store, responseId, url);
          return;
        }
        if (!action && req.method === "POST") {
          await handleResponseUpdate(req, res, store, responseId, url);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleResponseDelete(res, store, responseId, backgroundJobs);
          return;
        }
        if (action === "cancel" && req.method === "POST") {
          handleResponseCancel(res, store, responseId, backgroundJobs, url);
          return;
        }
        if (action === "input_items" && req.method === "GET") {
          handleResponseInputItems(res, store, responseId, url);
          return;
        }
      }

      if (url.pathname === "/v1/chat/completions") {
        if (req.method === "GET") {
          handleChatCompletionsList(res, store, url);
          return;
        }
        if (req.method === "POST") {
          await handleChatPassthrough(req, res, config, store);
          return;
        }
      }

      const chatRoute = url.pathname.match(/^\/v1\/chat\/completions\/([^/]+)(?:\/([^/]+))?$/);
      if (chatRoute) {
        const completionId = decodeURIComponent(chatRoute[1]);
        const action = chatRoute[2] || "";
        if (!action && req.method === "GET") {
          handleChatCompletionGet(res, store, completionId);
          return;
        }
        if (!action && req.method === "POST") {
          await handleChatCompletionUpdate(req, res, store, completionId);
          return;
        }
        if (!action && req.method === "DELETE") {
          handleChatCompletionDelete(res, store, completionId);
          return;
        }
        if (action === "messages" && req.method === "GET") {
          handleChatCompletionMessages(res, store, completionId, url);
          return;
        }
      }

      sendError(res, 404, "not found");
    } catch (error) {
      sendError(res, error.status || 500, error.message || "internal server error", {
        code: error.code,
        param: error.param,
        type: error.type,
      });
    }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

if (require.main === module) {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    log(`listening on http://${config.host}:${config.port}`, {
      provider_base_url: config.providerBaseUrl,
      default_model: config.defaultModel,
      provider_api_key_env: config.providerApiKeyEnv,
      has_provider_key: !!config.providerApiKey,
    });
  });
}

module.exports = {
  createServer,
  iterateSseJson,
  loadConfig,
};
