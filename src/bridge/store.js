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

module.exports = { FileResponseStore, FileConversationStore, FileImageGenerationStore };
