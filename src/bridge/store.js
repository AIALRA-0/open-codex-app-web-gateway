"use strict";

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

module.exports = { FileResponseStore };
