"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(value)) return null;
  return value;
}

class FileResponseStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge"));
    this.maxRecords = options.maxRecords || 5000;
    this.ttlMs = options.ttlMs || 14 * 24 * 60 * 60 * 1000;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  filePath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.dir, `${clean}.json`);
  }

  get(id) {
    const filePath = this.filePath(id);
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  getMessages(id) {
    const record = this.get(id);
    return Array.isArray(record?.messages) ? record.messages : [];
  }

  list() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const filePath = path.join(this.dir, name);
          try {
            const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
            return isPlainObject(value) ? value : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
    } catch {
      return [];
    }
  }

  delete(id) {
    const filePath = this.filePath(id);
    if (!filePath) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  put(id, record) {
    const filePath = this.filePath(id);
    if (!filePath) return;
    this.ensureDir();
    const body = {
      id,
      created_at: Date.now(),
      ...record,
    };
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(body, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    this.cleanupSoon();
  }

  cleanupSoon() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      try {
        this.cleanup();
      } catch {
        // Cleanup is opportunistic.
      }
    }, 100).unref?.();
  }

  cleanup() {
    this.ensureDir();
    const now = Date.now();
    const entries = fs.readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const filePath = path.join(this.dir, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of entries) {
      if (now - entry.mtimeMs > this.ttlMs) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }

    for (const entry of entries.slice(this.maxRecords)) {
      try { fs.unlinkSync(entry.filePath); } catch {}
    }
  }
}

class FileConversationStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "conversations"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  filePath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.dir, `${clean}.json`);
  }

  get(id) {
    const filePath = this.filePath(id);
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  create(body = {}) {
    const now = Math.floor(Date.now() / 1000);
    const id = `conv_${randomToken(24)}`;
    const record = {
      id,
      object: "conversation",
      created_at: now,
      metadata: isPlainObject(body.metadata) ? body.metadata : {},
      items: normalizeConversationItems(body.items || []),
    };
    this.put(id, record);
    return conversationResource(record);
  }

  update(id, body = {}) {
    const record = this.get(id);
    if (!record || record.deleted === true) return null;
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      record.metadata = isPlainObject(body.metadata) ? body.metadata : {};
    }
    this.put(id, record);
    return conversationResource(record);
  }

  delete(id) {
    const record = this.get(id);
    if (!record || record.deleted === true) return null;
    record.deleted = true;
    record.deleted_at = Math.floor(Date.now() / 1000);
    this.put(id, record);
    return {
      id,
      object: "conversation.deleted",
      deleted: true,
    };
  }

  listItems(id) {
    const record = this.get(id);
    if (!record) return null;
    return Array.isArray(record.items) ? record.items : [];
  }

  appendItems(id, items) {
    const record = this.get(id);
    if (!record || record.deleted === true) return null;
    const existing = Array.isArray(record.items) ? record.items : [];
    const normalized = normalizeConversationItems(items, existing.length);
    record.items = [...existing, ...normalized];
    this.put(id, record);
    return normalized;
  }

  getItem(id, itemId) {
    const items = this.listItems(id);
    if (!items) return null;
    return items.find((item) => item.id === itemId) || null;
  }

  deleteItem(id, itemId) {
    const record = this.get(id);
    if (!record || record.deleted === true) return null;
    const items = Array.isArray(record.items) ? record.items : [];
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) return null;
    record.items = [...items.slice(0, index), ...items.slice(index + 1)];
    this.put(id, record);
    return conversationResource(record);
  }

  put(id, record) {
    const filePath = this.filePath(id);
    if (!filePath) return;
    this.ensureDir();
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    this.cleanup();
  }

  cleanup() {
    this.ensureDir();
    const entries = fs.readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const filePath = path.join(this.dir, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of entries.slice(this.maxRecords)) {
      try { fs.unlinkSync(entry.filePath); } catch {}
    }
  }
}

class FileAssistantStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-assistants"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.assistantsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.threadsDir(), { recursive: true, mode: 0o700 });
  }

  assistantsDir() {
    return path.join(this.dir, "assistants");
  }

  assistantPath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.assistantsDir(), `${clean}.json`);
  }

  threadsDir() {
    return path.join(this.dir, "threads");
  }

  threadDir(threadId) {
    const clean = safeId(threadId);
    if (!clean) return null;
    return path.join(this.threadsDir(), clean);
  }

  threadPath(threadId) {
    const dir = this.threadDir(threadId);
    return dir ? path.join(dir, "thread.json") : null;
  }

  messagesDir(threadId) {
    const dir = this.threadDir(threadId);
    return dir ? path.join(dir, "messages") : null;
  }

  messagePath(threadId, messageId) {
    const dir = this.messagesDir(threadId);
    const clean = safeId(messageId);
    if (!dir || !clean) return null;
    return path.join(dir, `${clean}.json`);
  }

  runsDir(threadId) {
    const dir = this.threadDir(threadId);
    return dir ? path.join(dir, "runs") : null;
  }

  runDir(threadId, runId) {
    const dir = this.runsDir(threadId);
    const clean = safeId(runId);
    if (!dir || !clean) return null;
    return path.join(dir, clean);
  }

  runPath(threadId, runId) {
    const dir = this.runDir(threadId, runId);
    return dir ? path.join(dir, "run.json") : null;
  }

  stepsDir(threadId, runId) {
    const dir = this.runDir(threadId, runId);
    return dir ? path.join(dir, "steps") : null;
  }

  stepPath(threadId, runId, stepId) {
    const dir = this.stepsDir(threadId, runId);
    const clean = safeId(stepId);
    if (!dir || !clean) return null;
    return path.join(dir, `${clean}.json`);
  }

  createAssistant(body = {}) {
    const now = nowSeconds();
    const assistant = {
      id: `asst_${randomToken(18)}`,
      object: "assistant",
      created_at: now,
      name: nullableString(body.name),
      description: nullableString(body.description),
      model: stringOrDefault(body.model, "gpt-4o"),
      instructions: nullableString(body.instructions),
      tools: Array.isArray(body.tools) ? cloneJson(body.tools) : [],
      tool_resources: isPlainObject(body.tool_resources) ? cloneJson(body.tool_resources) : {},
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      top_p: body.top_p ?? 1,
      temperature: body.temperature ?? 1,
      response_format: body.response_format ?? "auto",
    };
    this.writeJson(this.assistantPath(assistant.id), { assistant });
    this.cleanup();
    return cloneJson(assistant);
  }

  listAssistants() {
    return this.listJson(this.assistantsDir())
      .map((record) => record.assistant)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(cloneJson);
  }

  getAssistant(id) {
    return cloneOrNull(this.readJson(this.assistantPath(id))?.assistant || null);
  }

  updateAssistant(id, body = {}) {
    const record = this.readJson(this.assistantPath(id));
    const assistant = record?.assistant;
    if (!assistant) return null;
    const updated = { ...assistant };
    for (const key of ["name", "description", "instructions"]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) updated[key] = nullableString(body[key]);
    }
    if (Object.prototype.hasOwnProperty.call(body, "model")) updated.model = stringOrDefault(body.model, updated.model);
    if (Object.prototype.hasOwnProperty.call(body, "tools")) updated.tools = Array.isArray(body.tools) ? cloneJson(body.tools) : [];
    if (Object.prototype.hasOwnProperty.call(body, "tool_resources")) {
      updated.tool_resources = isPlainObject(body.tool_resources) ? cloneJson(body.tool_resources) : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) updated.metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    for (const key of ["top_p", "temperature", "response_format"]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) updated[key] = body[key];
    }
    this.writeJson(this.assistantPath(id), { assistant: updated });
    return cloneJson(updated);
  }

  deleteAssistant(id) {
    const assistant = this.getAssistant(id);
    if (!assistant) return null;
    this.deletePath(this.assistantPath(id));
    return {
      id,
      object: "assistant.deleted",
      deleted: true,
    };
  }

  createThread(body = {}) {
    const now = nowSeconds();
    const thread = {
      id: `thread_${randomToken(18)}`,
      object: "thread",
      created_at: now,
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      tool_resources: isPlainObject(body.tool_resources) ? cloneJson(body.tool_resources) : {},
    };
    this.writeJson(this.threadPath(thread.id), { thread });
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of messages) {
      this.createMessage(thread.id, message);
    }
    this.cleanup();
    return cloneJson(thread);
  }

  getThread(threadId) {
    return cloneOrNull(this.readJson(this.threadPath(threadId))?.thread || null);
  }

  updateThread(threadId, body = {}) {
    const record = this.readJson(this.threadPath(threadId));
    const thread = record?.thread;
    if (!thread) return null;
    const updated = { ...thread };
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "tool_resources")) {
      updated.tool_resources = isPlainObject(body.tool_resources) ? cloneJson(body.tool_resources) : {};
    }
    this.writeJson(this.threadPath(threadId), { thread: updated });
    return cloneJson(updated);
  }

  deleteThread(threadId) {
    const thread = this.getThread(threadId);
    if (!thread) return null;
    this.deletePath(this.threadDir(threadId));
    return {
      id: threadId,
      object: "thread.deleted",
      deleted: true,
    };
  }

  createMessage(threadId, body = {}, options = {}) {
    if (!this.getThread(threadId)) return null;
    const now = nowSeconds();
    const status = stringOrDefault(options.status || body.status, "completed");
    const completedAt = status === "completed" ? now : null;
    const message = {
      id: stringOrDefault(options.id, `msg_${randomToken(18)}`),
      object: "thread.message",
      created_at: now,
      assistant_id: options.assistant_id || null,
      thread_id: threadId,
      run_id: options.run_id || null,
      status,
      incomplete_details: null,
      incomplete_at: null,
      completed_at: completedAt,
      role: stringOrDefault(body.role || options.role, "user"),
      content: normalizeAssistantMessageContent(body.content ?? options.content ?? ""),
      attachments: Array.isArray(body.attachments) ? cloneJson(body.attachments) : [],
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
    };
    this.writeJson(this.messagePath(threadId, message.id), { message });
    return cloneJson(message);
  }

  listMessages(threadId) {
    if (!this.getThread(threadId)) return null;
    return this.listJson(this.messagesDir(threadId))
      .map((record) => record.message)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(cloneJson);
  }

  getMessage(threadId, messageId) {
    if (!this.getThread(threadId)) return null;
    return cloneOrNull(this.readJson(this.messagePath(threadId, messageId))?.message || null);
  }

  updateMessage(threadId, messageId, body = {}) {
    const record = this.readJson(this.messagePath(threadId, messageId));
    const message = record?.message;
    if (!message) return null;
    const updated = { ...message };
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    }
    this.writeJson(this.messagePath(threadId, messageId), { message: updated });
    return cloneJson(updated);
  }

  completeMessage(threadId, messageId, body = {}) {
    const record = this.readJson(this.messagePath(threadId, messageId));
    const message = record?.message;
    if (!message) return null;
    const now = nowSeconds();
    const updated = {
      ...message,
      status: "completed",
      incomplete_details: null,
      incomplete_at: null,
      completed_at: now,
    };
    if (Object.prototype.hasOwnProperty.call(body, "content")) {
      updated.content = normalizeAssistantMessageContent(body.content);
    }
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    }
    this.writeJson(this.messagePath(threadId, messageId), { message: updated });
    return cloneJson(updated);
  }

  deleteMessage(threadId, messageId) {
    const message = this.getMessage(threadId, messageId);
    if (!message) return null;
    this.deletePath(this.messagePath(threadId, messageId));
    return {
      id: messageId,
      object: "thread.message.deleted",
      deleted: true,
    };
  }

  createRun(threadId, body = {}, assistant = {}) {
    if (!this.getThread(threadId)) return null;
    const now = nowSeconds();
    const baseInstructions = nullableString(body.instructions ?? assistant.instructions);
    const additionalInstructions = nullableString(body.additional_instructions);
    const runInstructions = additionalInstructions
      ? [baseInstructions, additionalInstructions].filter(Boolean).join("\n\n")
      : baseInstructions;
    const run = {
      id: `run_${randomToken(18)}`,
      object: "thread.run",
      created_at: now,
      assistant_id: stringOrDefault(body.assistant_id || assistant.id, ""),
      thread_id: threadId,
      status: "queued",
      started_at: null,
      expires_at: now + 600,
      cancelled_at: null,
      failed_at: null,
      completed_at: null,
      expired_at: null,
      required_action: null,
      last_error: null,
      model: stringOrDefault(body.model || assistant.model, "gpt-4o"),
      instructions: runInstructions,
      tools: Array.isArray(body.tools) ? cloneJson(body.tools) : Array.isArray(assistant.tools) ? cloneJson(assistant.tools) : [],
      tool_resources: isPlainObject(body.tool_resources)
        ? cloneJson(body.tool_resources)
        : (isPlainObject(assistant.tool_resources) ? cloneJson(assistant.tool_resources) : {}),
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      temperature: body.temperature ?? assistant.temperature ?? 1,
      top_p: body.top_p ?? assistant.top_p ?? 1,
      max_completion_tokens: body.max_completion_tokens ?? null,
      max_prompt_tokens: body.max_prompt_tokens ?? null,
      reasoning_effort: body.reasoning_effort ?? null,
      truncation_strategy: isPlainObject(body.truncation_strategy) ? cloneJson(body.truncation_strategy) : { type: "auto", last_messages: null },
      incomplete_details: null,
      usage: null,
      response_format: body.response_format ?? assistant.response_format ?? "auto",
      tool_choice: body.tool_choice ?? "auto",
      parallel_tool_calls: body.parallel_tool_calls ?? true,
    };
    this.writeJson(this.runPath(threadId, run.id), { run });
    return cloneJson(run);
  }

  listRuns(threadId) {
    if (!this.getThread(threadId)) return null;
    const runsDir = this.runsDir(threadId);
    const records = this.listDirs(runsDir)
      .map((dir) => this.readJson(path.join(dir, "run.json")));
    return records
      .map((record) => record.run)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(cloneJson);
  }

  getRun(threadId, runId) {
    if (!this.getThread(threadId)) return null;
    return cloneOrNull(this.readJson(this.runPath(threadId, runId))?.run || null);
  }

  updateRun(threadId, runId, updater) {
    const record = this.readJson(this.runPath(threadId, runId));
    const run = record?.run;
    if (!run) return null;
    const updated = typeof updater === "function" ? updater(cloneJson(run)) : { ...run, ...cloneJson(updater || {}) };
    this.writeJson(this.runPath(threadId, runId), { run: updated });
    return cloneJson(updated);
  }

  cancelRun(threadId, runId) {
    const run = this.getRun(threadId, runId);
    if (!run) return null;
    if (!["completed", "failed", "cancelled", "expired", "incomplete"].includes(String(run.status || ""))) {
      const now = nowSeconds();
      return this.updateRun(threadId, runId, {
        ...run,
        status: "cancelled",
        cancelled_at: now,
        expires_at: null,
      });
    }
    return run;
  }

  createMessageCreationStep(run, messageId, usage = null, options = {}) {
    const now = nowSeconds();
    const status = stringOrDefault(options.status, "completed");
    const completedAt = status === "completed" ? now : null;
    const step = {
      id: `step_${randomToken(18)}`,
      object: "thread.run.step",
      created_at: now,
      assistant_id: run.assistant_id,
      thread_id: run.thread_id,
      run_id: run.id,
      type: "message_creation",
      status,
      cancelled_at: null,
      completed_at: completedAt,
      expires_at: null,
      failed_at: null,
      last_error: null,
      step_details: {
        type: "message_creation",
        message_creation: { message_id: messageId },
      },
      usage: usage || null,
    };
    this.writeJson(this.stepPath(run.thread_id, run.id, step.id), { step });
    return cloneJson(step);
  }

  createToolCallsStep(run, toolCalls = [], usage = null, options = {}) {
    const now = nowSeconds();
    const status = stringOrDefault(options.status, "completed");
    const completedAt = status === "completed" ? now : null;
    const step = {
      id: `step_${randomToken(18)}`,
      object: "thread.run.step",
      created_at: now,
      assistant_id: run.assistant_id,
      thread_id: run.thread_id,
      run_id: run.id,
      type: "tool_calls",
      status,
      cancelled_at: null,
      completed_at: completedAt,
      expires_at: null,
      failed_at: null,
      last_error: null,
      step_details: {
        type: "tool_calls",
        tool_calls: normalizeAssistantToolCallsForStep(toolCalls),
      },
      usage: usage || null,
    };
    this.writeJson(this.stepPath(run.thread_id, run.id, step.id), { step });
    return cloneJson(step);
  }

  completeRunStep(threadId, runId, stepId, usage = null, details = null) {
    const record = this.readJson(this.stepPath(threadId, runId, stepId));
    const step = record?.step;
    if (!step) return null;
    const now = nowSeconds();
    const updated = {
      ...step,
      status: "completed",
      completed_at: now,
      expires_at: null,
      usage: usage || step.usage || null,
    };
    if (isPlainObject(details)) updated.step_details = cloneJson(details);
    this.writeJson(this.stepPath(threadId, runId, stepId), { step: updated });
    return cloneJson(updated);
  }

  listRunSteps(threadId, runId) {
    if (!this.getRun(threadId, runId)) return null;
    return this.listJson(this.stepsDir(threadId, runId))
      .map((record) => record.step)
      .filter(Boolean)
      .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
      .map(cloneJson);
  }

  getRunStep(threadId, runId, stepId) {
    if (!this.getRun(threadId, runId)) return null;
    return cloneOrNull(this.readJson(this.stepPath(threadId, runId, stepId))?.step || null);
  }

  readJson(filePath) {
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    if (!filePath) return;
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
    if (!dir) return [];
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.readJson(path.join(dir, name)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  listDirs(dir) {
    if (!dir) return [];
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return fs.readdirSync(dir)
        .map((name) => path.join(dir, name))
        .filter((entry) => {
          try {
            return fs.statSync(entry).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }

  deletePath(targetPath) {
    if (!targetPath) return;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {}
  }

  cleanup() {
    this.ensureDir();
    const assistantFiles = fs.readdirSync(this.assistantsDir())
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const filePath = path.join(this.assistantsDir(), name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of assistantFiles.slice(this.maxRecords)) this.deletePath(entry.filePath);

    const threadDirs = fs.readdirSync(this.threadsDir())
      .map((name) => path.join(this.threadsDir(), name))
      .filter((dir) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .map((dir) => ({ dir, mtimeMs: fs.statSync(dir).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of threadDirs.slice(this.maxRecords)) this.deletePath(entry.dir);
  }
}

class FileChatKitStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-chatkit"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.sessionsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.threadsDir(), { recursive: true, mode: 0o700 });
  }

  sessionsDir() {
    return path.join(this.dir, "sessions");
  }

  sessionPath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.sessionsDir(), `${clean}.json`);
  }

  threadsDir() {
    return path.join(this.dir, "threads");
  }

  threadDir(threadId) {
    const clean = safeId(threadId);
    if (!clean) return null;
    return path.join(this.threadsDir(), clean);
  }

  threadPath(threadId) {
    const dir = this.threadDir(threadId);
    return dir ? path.join(dir, "thread.json") : null;
  }

  itemsDir(threadId) {
    const dir = this.threadDir(threadId);
    return dir ? path.join(dir, "items") : null;
  }

  itemPath(threadId, itemId) {
    const dir = this.itemsDir(threadId);
    const clean = safeId(itemId);
    if (!dir || !clean) return null;
    return path.join(dir, `${clean}.json`);
  }

  createSession(body = {}) {
    const now = nowSeconds();
    const expiresAfter = boundedPositiveInteger(body.expires_after, 3600, 60, 24 * 60 * 60);
    const session = {
      id: `csess_${randomToken(18)}`,
      object: "chatkit.session",
      created_at: now,
      client_secret: `chatkit_token_${randomToken(32)}`,
      expires_at: now + expiresAfter,
      workflow: isPlainObject(body.workflow) ? cloneJson(body.workflow) : {},
      scope: isPlainObject(body.scope) ? cloneJson(body.scope) : {},
      user: nullableString(body.user),
      max_requests_per_1_minute: nullablePositiveInteger(body.max_requests_per_1_minute),
      max_requests_per_session: nullablePositiveInteger(body.max_requests_per_session),
      status: "active",
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      compatibility: {
        provider: "local",
        beta: "chatkit_beta=v1",
        reason: "chatkit_session_protocol_compatibility",
      },
    };
    this.writeJson(this.sessionPath(session.id), { session });
    this.cleanup();
    return cloneJson(session);
  }

  getSession(sessionId) {
    return cloneOrNull(this.readJson(this.sessionPath(sessionId))?.session || null);
  }

  cancelSession(sessionId) {
    const record = this.readJson(this.sessionPath(sessionId));
    const session = record?.session;
    if (!session) return null;
    const now = nowSeconds();
    const updated = {
      ...session,
      status: "cancelled",
      cancelled_at: session.cancelled_at || now,
      compatibility: {
        ...(isPlainObject(session.compatibility) ? session.compatibility : {}),
        cancelled_locally: true,
      },
    };
    this.writeJson(this.sessionPath(sessionId), { session: updated });
    return cloneJson(updated);
  }

  createThread(body = {}) {
    const now = nowSeconds();
    const position = this.listDirs(this.threadsDir()).length;
    const session = body.session_id ? this.getSession(body.session_id) : null;
    const thread = {
      id: `cthr_${randomToken(18)}`,
      object: "chatkit.thread",
      created_at: now,
      updated_at: now,
      title: nullableString(body.title),
      user: nullableString(body.user ?? session?.user),
      session_id: nullableString(body.session_id),
      workflow: isPlainObject(body.workflow)
        ? cloneJson(body.workflow)
        : (isPlainObject(session?.workflow) ? cloneJson(session.workflow) : {}),
      scope: isPlainObject(body.scope)
        ? cloneJson(body.scope)
        : (isPlainObject(session?.scope) ? cloneJson(session.scope) : {}),
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      position,
      compatibility: {
        provider: "local",
        beta: "chatkit_beta=v1",
        reason: "chatkit_thread_protocol_compatibility",
      },
    };
    this.writeJson(this.threadPath(thread.id), { thread });
    const items = Array.isArray(body.items) ? body.items : Array.isArray(body.initial_items) ? body.initial_items : [];
    for (const item of items) this.createItem(thread.id, item);
    this.cleanup();
    return cloneJson(thread);
  }

  listThreads() {
    return this.listDirs(this.threadsDir())
      .map((dir) => this.readJson(path.join(dir, "thread.json"))?.thread)
      .filter(Boolean)
      .sort((a, b) => {
        const created = Number(a.created_at || 0) - Number(b.created_at || 0);
        if (created) return created;
        const position = Number(a.position || 0) - Number(b.position || 0);
        if (position) return position;
        return String(a.id || "").localeCompare(String(b.id || ""));
      })
      .map(cloneJson);
  }

  getThread(threadId) {
    return cloneOrNull(this.readJson(this.threadPath(threadId))?.thread || null);
  }

  updateThread(threadId, body = {}) {
    const record = this.readJson(this.threadPath(threadId));
    const thread = record?.thread;
    if (!thread) return null;
    const updated = { ...thread, updated_at: nowSeconds() };
    if (Object.prototype.hasOwnProperty.call(body, "title")) updated.title = nullableString(body.title);
    if (Object.prototype.hasOwnProperty.call(body, "user")) updated.user = nullableString(body.user);
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    }
    this.writeJson(this.threadPath(threadId), { thread: updated });
    return cloneJson(updated);
  }

  deleteThread(threadId) {
    const thread = this.getThread(threadId);
    if (!thread) return null;
    this.deletePath(this.threadDir(threadId));
    return {
      id: threadId,
      object: "chatkit.thread.deleted",
      deleted: true,
    };
  }

  createItem(threadId, body = {}) {
    if (!this.getThread(threadId)) return null;
    const now = nowSeconds();
    const position = this.listJson(this.itemsDir(threadId)).length;
    const source = isPlainObject(body?.item) ? body.item : body;
    const base = isPlainObject(source)
      ? cloneJson(source)
      : { type: "message", role: "user", content: String(source ?? "") };
    const item = {
      ...base,
      id: stringOrDefault(base.id, `citm_${randomToken(18)}`),
      object: stringOrDefault(base.object, "chatkit.thread.item"),
      created_at: base.created_at || now,
      thread_id: threadId,
      type: stringOrDefault(base.type || (base.role ? "message" : ""), "message"),
      status: stringOrDefault(base.status, "completed"),
      position: Number.isInteger(base.position) && base.position >= 0 ? base.position : position,
      metadata: isPlainObject(base.metadata) ? cloneJson(base.metadata) : {},
    };
    this.writeJson(this.itemPath(threadId, item.id), { item });
    this.touchThread(threadId);
    return cloneJson(item);
  }

  createItems(threadId, body = {}) {
    const values = Array.isArray(body?.items) ? body.items : [body?.item ?? body];
    const created = [];
    for (const value of values) {
      const item = this.createItem(threadId, value);
      if (!item) return null;
      created.push(item);
    }
    return created;
  }

  listItems(threadId) {
    if (!this.getThread(threadId)) return null;
    return this.listJson(this.itemsDir(threadId))
      .map((record) => record.item)
      .filter(Boolean)
      .sort((a, b) => {
        const created = Number(a.created_at || 0) - Number(b.created_at || 0);
        if (created) return created;
        const position = Number(a.position || 0) - Number(b.position || 0);
        if (position) return position;
        return String(a.id || "").localeCompare(String(b.id || ""));
      })
      .map(cloneJson);
  }

  touchThread(threadId) {
    const record = this.readJson(this.threadPath(threadId));
    const thread = record?.thread;
    if (!thread) return null;
    const updated = { ...thread, updated_at: nowSeconds() };
    this.writeJson(this.threadPath(threadId), { thread: updated });
    return updated;
  }

  readJson(filePath) {
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    if (!filePath) return;
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
    if (!dir) return [];
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.readJson(path.join(dir, name)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  listDirs(dir) {
    if (!dir) return [];
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return fs.readdirSync(dir)
        .map((name) => path.join(dir, name))
        .filter((entry) => {
          try {
            return fs.statSync(entry).isDirectory();
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }

  deletePath(targetPath) {
    if (!targetPath) return;
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {}
  }

  cleanup() {
    this.ensureDir();
    const sessionFiles = fs.readdirSync(this.sessionsDir())
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const filePath = path.join(this.sessionsDir(), name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of sessionFiles.slice(this.maxRecords)) this.deletePath(entry.filePath);

    const threadDirs = fs.readdirSync(this.threadsDir())
      .map((name) => path.join(this.threadsDir(), name))
      .filter((dir) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .map((dir) => ({ dir, mtimeMs: fs.statSync(dir).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of threadDirs.slice(this.maxRecords)) this.deletePath(entry.dir);
  }
}

class FileRealtimeStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-realtime"));
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(this.sessionsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.clientSecretsDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.callsDir(), { recursive: true, mode: 0o700 });
  }

  sessionsDir() {
    return path.join(this.dir, "sessions");
  }

  clientSecretsDir() {
    return path.join(this.dir, "client_secrets");
  }

  callsDir() {
    return path.join(this.dir, "calls");
  }

  sessionPath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.sessionsDir(), `${clean}.json`);
  }

  clientSecretPath(value) {
    const clean = safeId(value);
    if (!clean) return null;
    return path.join(this.clientSecretsDir(), `${clean}.json`);
  }

  callPath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.callsDir(), `${clean}.json`);
  }

  createSession(body = {}, options = {}) {
    const session = this.buildSession(body, options);
    this.writeJson(this.sessionPath(session.id), { session });
    this.cleanup();
    return cloneJson(session);
  }

  createClientSecret(body = {}, options = {}) {
    const request = isPlainObject(body) ? body : {};
    const sessionBody = isPlainObject(request.session) ? request.session : {};
    const now = nowSeconds();
    const expiresAt = realtimeExpiresAt(request.expires_after, now);
    const session = this.createSession(sessionBody, {
      type: options.type || sessionBody.type || "realtime",
      object: options.object || "realtime.session",
      expiresAt,
      includeClientSecret: false,
    });
    const clientSecret = {
      value: `ek_${randomToken(24)}`,
      expires_at: expiresAt,
      session,
      compatibility: {
        provider: "local",
        reason: `${options.type || "realtime"}_client_secret_protocol_compatibility`,
      },
    };
    this.writeJson(this.clientSecretPath(clientSecret.value), { client_secret: clientSecret });
    this.cleanup();
    return cloneJson(clientSecret);
  }

  createTranscriptionSession(body = {}) {
    return this.createSession(body, {
      type: "transcription",
      object: "realtime.transcription_session",
      defaultModel: "gpt-4o-transcribe",
      includeClientSecret: true,
      compatibilityReason: "realtime_transcription_session_protocol_compatibility",
    });
  }

  createTranslationClientSecret(body = {}) {
    return this.createClientSecret(body, {
      type: "translation",
      object: "realtime.translation_session",
    });
  }

  getSession(id) {
    return cloneOrNull(this.readJson(this.sessionPath(id))?.session || null);
  }

  getClientSecret(value) {
    return cloneOrNull(this.readJson(this.clientSecretPath(value))?.client_secret || null);
  }

  createCall(body = {}) {
    const now = nowSeconds();
    const sessionSource = isPlainObject(body.session) ? body.session : {};
    const clientSecret = typeof body.client_secret === "string" ? this.getClientSecret(body.client_secret) : null;
    const session = clientSecret?.session || this.createSession(sessionSource, {
      type: sessionSource.type || "realtime",
      includeClientSecret: false,
    });
    const call = {
      id: `call_${randomToken(18)}`,
      object: "realtime.call",
      created_at: now,
      updated_at: now,
      status: "active",
      session_id: session.id,
      session,
      sdp_offer_hash: body.sdp ? crypto.createHash("sha256").update(String(body.sdp)).digest("hex") : null,
      sdp_answer: realtimeSdpAnswer(),
      metadata: isPlainObject(body.metadata) ? cloneJson(body.metadata) : {},
      compatibility: {
        provider: "local",
        reason: "realtime_webrtc_call_protocol_compatibility",
        media_transport: "placeholder_sdp_answer",
      },
    };
    this.writeJson(this.callPath(call.id), { call });
    this.cleanup();
    return cloneJson(call);
  }

  updateCall(callId, action, body = {}) {
    const record = this.readJson(this.callPath(callId));
    const call = record?.call;
    if (!call) return null;
    const now = nowSeconds();
    const status = action === "accept"
      ? "accepted"
      : action === "reject"
        ? "rejected"
        : action === "hangup"
          ? "completed"
          : action === "refer"
            ? "referred"
            : call.status;
    const updated = {
      ...call,
      status,
      updated_at: now,
      [`${action}_at`]: call[`${action}_at`] || now,
      compatibility: {
        ...(isPlainObject(call.compatibility) ? call.compatibility : {}),
        last_action: action,
      },
    };
    if (action === "accept" && isPlainObject(body.session)) {
      updated.session = this.createSession(body.session, {
        type: body.session.type || "realtime",
        includeClientSecret: false,
      });
      updated.session_id = updated.session.id;
    }
    if (action === "refer") {
      updated.refer_to = nullableString(body.target_uri ?? body.refer_to ?? body.to);
      updated.refer_metadata = isPlainObject(body.metadata) ? cloneJson(body.metadata) : {};
    }
    if (action === "reject") {
      updated.reject_reason = nullableString(body.reason);
    }
    this.writeJson(this.callPath(callId), { call: updated });
    return cloneJson(updated);
  }

  buildSession(body = {}, options = {}) {
    const source = isPlainObject(body) ? body : {};
    const now = nowSeconds();
    const type = options.type || source.type || "realtime";
    const object = options.object || (type === "translation"
      ? "realtime.translation_session"
      : type === "transcription"
        ? "realtime.transcription_session"
        : "realtime.session");
    const expiresAt = options.expiresAt || now + boundedPositiveInteger(source.expires_after, 3600, 60, 24 * 60 * 60);
    const session = {
      id: `sess_${randomToken(18)}`,
      object,
      type,
      created_at: now,
      expires_at: expiresAt,
      model: stringOrDefault(source.model, options.defaultModel || (type === "translation" ? "gpt-realtime-translate" : "gpt-realtime")),
      output_modalities: normalizeStringArray(source.output_modalities ?? source.modalities, type === "transcription" ? ["text"] : ["audio"]),
      modalities: normalizeStringArray(source.modalities ?? source.output_modalities, type === "transcription" ? ["audio", "text"] : ["audio"]),
      instructions: nullableString(source.instructions),
      tools: Array.isArray(source.tools) ? cloneJson(source.tools) : [],
      tool_choice: source.tool_choice ?? (type === "transcription" ? null : "auto"),
      max_output_tokens: source.max_output_tokens ?? source.max_response_output_tokens ?? "inf",
      max_response_output_tokens: source.max_response_output_tokens ?? source.max_output_tokens ?? "inf",
      tracing: source.tracing ?? null,
      truncation: source.truncation ?? "auto",
      prompt: isPlainObject(source.prompt) ? cloneJson(source.prompt) : null,
      include: Array.isArray(source.include) ? cloneJson(source.include) : null,
      audio: normalizeRealtimeAudio(source.audio, source),
      input_audio_format: source.input_audio_format || "pcm16",
      output_audio_format: source.output_audio_format || "pcm16",
      input_audio_transcription: isPlainObject(source.input_audio_transcription)
        ? cloneJson(source.input_audio_transcription)
        : (type === "transcription" ? { model: options.defaultModel || "gpt-4o-transcribe", language: null, prompt: "" } : null),
      turn_detection: source.turn_detection === undefined ? { type: "server_vad" } : cloneJson(source.turn_detection),
      temperature: source.temperature ?? null,
      voice: source.voice || source.audio?.output?.voice || "alloy",
      speed: source.speed ?? source.audio?.output?.speed ?? 1,
      metadata: isPlainObject(source.metadata) ? cloneJson(source.metadata) : {},
      compatibility: {
        provider: "local",
        reason: options.compatibilityReason || `${type}_session_protocol_compatibility`,
        transport: "rest_handshake_only",
      },
    };
    if (options.includeClientSecret !== false) {
      session.client_secret = {
        value: `ek_${randomToken(24)}`,
        expires_at: expiresAt,
      };
    }
    return session;
  }

  readJson(filePath) {
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  writeJson(filePath, value) {
    if (!filePath) return;
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

  cleanup() {
    this.ensureDir();
    for (const dir of [this.sessionsDir(), this.clientSecretsDir(), this.callsDir()]) {
      const files = fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const filePath = path.join(dir, name);
          return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of files.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
  }
}

class FileImageGenerationStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-image-generations"));
    this.maxRecords = options.maxRecords || 5000;
    this.ttlMs = options.ttlMs || 14 * 24 * 60 * 60 * 1000;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  filePath(id) {
    const clean = safeId(id);
    if (!clean) return null;
    return path.join(this.dir, `${clean}.json`);
  }

  get(id) {
    const filePath = this.filePath(id);
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  put(id, record = {}) {
    const filePath = this.filePath(id);
    if (!filePath) return;
    this.ensureDir();
    const now = Date.now();
    const body = {
      id,
      object: "image_generation.call",
      created_at: now,
      updated_at: now,
      ...record,
    };
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(body, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    this.cleanupSoon();
  }

  cleanupSoon() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      try {
        this.cleanup();
      } catch {
        // Cleanup is opportunistic.
      }
    }, 100).unref?.();
  }

  cleanup() {
    this.ensureDir();
    const now = Date.now();
    const entries = fs.readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const filePath = path.join(this.dir, name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of entries) {
      if (now - entry.mtimeMs > this.ttlMs) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }

    for (const entry of entries.slice(this.maxRecords)) {
      try { fs.unlinkSync(entry.filePath); } catch {}
    }
  }
}

class FileAudioVoiceStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || path.join(process.cwd(), "state", "responses-bridge", "local-audio-voices"));
    this.maxVoices = options.maxVoices || 20;
    this.maxRecords = options.maxRecords || 5000;
  }

  ensureDir() {
    fs.mkdirSync(path.join(this.dir, "consents"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.dir, "voices"), { recursive: true, mode: 0o700 });
  }

  filePath(kind, id) {
    const clean = safeId(id);
    if (!clean || !["consents", "voices"].includes(kind)) return null;
    return path.join(this.dir, kind, `${clean}.json`);
  }

  getConsent(id) {
    return this.read("consents", id)?.voice_consent || null;
  }

  getVoice(id) {
    return this.read("voices", id)?.voice || null;
  }

  listConsents() {
    return this.list("consents", "voice_consent");
  }

  listVoices() {
    return this.list("voices", "voice");
  }

  createConsent({ name, language, recording }) {
    const now = Math.floor(Date.now() / 1000);
    const consent = {
      id: `cons_${randomToken(18)}`,
      object: "audio.voice_consent",
      created_at: now,
      name,
      language,
      status: "active",
      recording,
      compatibility: {
        provider: "local",
        governance: "metadata_only",
        reason: "custom_voice_consent_protocol_compatibility",
      },
    };
    this.write("consents", consent.id, { voice_consent: consent });
    return consent;
  }

  createVoice({ name, consent, audioSample }) {
    const voices = this.listVoices();
    if (voices.length >= this.maxVoices) {
      const error = new Error(`local custom voice limit of ${this.maxVoices} reached`);
      error.status = 400;
      error.code = "custom_voice_limit_exceeded";
      error.param = "voice";
      throw error;
    }
    const now = Math.floor(Date.now() / 1000);
    const voice = {
      id: `voice_${randomToken(18)}`,
      object: "audio.voice",
      created_at: now,
      name,
      consent,
      status: "ready",
      audio_sample: audioSample,
      compatibility: {
        provider: "local",
        governance: "metadata_only",
        reason: "custom_voice_protocol_compatibility",
        synthetic_voice_model_created: false,
      },
    };
    this.write("voices", voice.id, { voice });
    return voice;
  }

  read(kind, id) {
    const filePath = this.filePath(kind, id);
    if (!filePath) return null;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return isPlainObject(value) ? value : null;
    } catch {
      return null;
    }
  }

  list(kind, field) {
    this.ensureDir();
    const dir = path.join(this.dir, kind);
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          try {
            const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
            return value?.[field] || null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
    } catch {
      return [];
    }
  }

  write(kind, id, value) {
    const filePath = this.filePath(kind, id);
    if (!filePath) return;
    this.ensureDir();
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
    this.cleanup();
  }

  cleanup() {
    this.ensureDir();
    for (const kind of ["consents", "voices"]) {
      const dir = path.join(this.dir, kind);
      const entries = fs.readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const filePath = path.join(dir, name);
          const stat = fs.statSync(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const entry of entries.slice(this.maxRecords)) {
        try { fs.unlinkSync(entry.filePath); } catch {}
      }
    }
  }
}

function conversationResource(record) {
  return {
    id: record.id,
    object: "conversation",
    created_at: record.created_at,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
  };
}

function normalizeConversationItems(items, offset = 0) {
  const list = Array.isArray(items) ? items : [items];
  const now = Math.floor(Date.now() / 1000);
  return list.map((item, index) => {
    const normalized = item && typeof item === "object" && !Array.isArray(item)
      ? JSON.parse(JSON.stringify(item))
      : { type: "message", role: "user", content: String(item ?? "") };
    if (!normalized.id) normalized.id = `convitem_${randomToken(18)}_${String(offset + index).padStart(6, "0")}`;
    if (!normalized.object) normalized.object = "conversation.item";
    if (!normalized.type && normalized.role) normalized.type = "message";
    if (!normalized.created_at) normalized.created_at = now;
    return normalized;
  });
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneOrNull(value) {
  return value ? cloneJson(value) : null;
}

function nullableString(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function stringOrDefault(value, fallback) {
  const text = value === undefined || value === null ? "" : String(value);
  return text || fallback;
}

function nullablePositiveInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function boundedPositiveInteger(value, fallback, min, max) {
  const parsed = nullablePositiveInteger(value);
  if (parsed == null) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringArray(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function realtimeExpiresAt(expiresAfter, now = nowSeconds()) {
  if (!isPlainObject(expiresAfter)) return now + 30 * 60;
  const seconds = boundedPositiveInteger(expiresAfter.seconds, 30 * 60, 60, 24 * 60 * 60);
  return now + seconds;
}

function normalizeRealtimeAudio(audio, source = {}) {
  const input = isPlainObject(audio?.input) ? audio.input : {};
  const output = isPlainObject(audio?.output) ? audio.output : {};
  return {
    input: {
      format: isPlainObject(input.format) ? cloneJson(input.format) : { type: "audio/pcm", rate: 24000 },
      transcription: input.transcription === undefined
        ? (isPlainObject(source.input_audio_transcription) ? cloneJson(source.input_audio_transcription) : null)
        : cloneJson(input.transcription),
      noise_reduction: input.noise_reduction === undefined ? null : cloneJson(input.noise_reduction),
      turn_detection: input.turn_detection === undefined
        ? (source.turn_detection === undefined ? { type: "server_vad" } : cloneJson(source.turn_detection))
        : cloneJson(input.turn_detection),
    },
    output: {
      format: isPlainObject(output.format) ? cloneJson(output.format) : { type: "audio/pcm", rate: 24000 },
      voice: output.voice || source.voice || "alloy",
      speed: output.speed ?? source.speed ?? 1,
      ...(output.language ? { language: String(output.language) } : {}),
    },
  };
}

function realtimeSdpAnswer() {
  const ufrag = randomToken(8).replace(/[-_]/g, "");
  const pwd = randomToken(24).replace(/[-_]/g, "");
  return [
    "v=0",
    `o=- ${Date.now()} 1 IN IP4 127.0.0.1`,
    "s=-",
    "c=IN IP4 0.0.0.0",
    "t=0 0",
    "a=group:BUNDLE 0 1",
    "a=msid-semantic:WMS *",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:0",
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    "a=setup:active",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "a=mid:1",
    "a=sctp-port:5000",
    "",
  ].join("\r\n");
}

function normalizeAssistantMessageContent(content) {
  if (Array.isArray(content)) return cloneJson(content);
  if (isPlainObject(content)) return [cloneJson(content)];
  return [{
    type: "text",
    text: {
      value: String(content ?? ""),
      annotations: [],
    },
  }];
}

function normalizeAssistantToolCallsForStep(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .filter(isPlainObject)
    .map((toolCall) => {
      const type = String(toolCall.type || "function") || "function";
      if (type === "file_search") {
        return {
          id: String(toolCall.id || ""),
          type,
          file_search: isPlainObject(toolCall.file_search) ? cloneJson(toolCall.file_search) : {},
        };
      }
      if (type === "code_interpreter") {
        return {
          id: String(toolCall.id || ""),
          type,
          code_interpreter: {
            input: String(toolCall.code_interpreter?.input ?? toolCall.code ?? ""),
            outputs: Array.isArray(toolCall.code_interpreter?.outputs)
              ? cloneJson(toolCall.code_interpreter.outputs)
              : [],
          },
        };
      }
      return {
        id: String(toolCall.id || ""),
        type,
        function: {
          name: String(toolCall.function?.name || ""),
          arguments: String(toolCall.function?.arguments ?? ""),
          output: toolCall.function?.output == null ? null : String(toolCall.function.output),
        },
      };
    });
}

module.exports = {
  FileAssistantStore,
  FileAudioVoiceStore,
  FileChatKitStore,
  FileResponseStore,
  FileRealtimeStore,
  FileConversationStore,
  FileImageGenerationStore,
};
