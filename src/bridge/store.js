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
    if (!record) return null;
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      record.metadata = isPlainObject(body.metadata) ? body.metadata : {};
    }
    this.put(id, record);
    return conversationResource(record);
  }

  delete(id) {
    const record = this.get(id);
    if (!record) return null;
    const filePath = this.filePath(id);
    if (!filePath) return null;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
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
    if (!record) return null;
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
    if (!record) return null;
    const items = Array.isArray(record.items) ? record.items : [];
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) return null;
    record.items = [...items.slice(0, index), ...items.slice(index + 1)];
    this.put(id, record);
    return {
      id: itemId,
      object: "conversation.item.deleted",
      deleted: true,
    };
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
  FileResponseStore,
  FileConversationStore,
  FileImageGenerationStore,
};
