"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { prefixedId, stringifyContent } = require("./translator");

const DEFAULT_SKILL_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_SKILL_MAX_FILE_COUNT = 500;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

class LocalSkillStore {
  constructor(config = {}) {
    this.dir = path.resolve(config.skillStateDir || path.join(config.stateDir || process.cwd(), "local-skills"));
    this.maxUploadBytes = config.skillMaxUploadBytes || DEFAULT_SKILL_MAX_UPLOAD_BYTES;
    this.maxFileCount = config.skillMaxFileCount || DEFAULT_SKILL_MAX_FILE_COUNT;
  }

  createSkill(upload = {}) {
    const normalized = normalizeSkillUpload(upload, this);
    const now = nowSeconds();
    const skillId = prefixedId("skill");
    const version = createVersionObject(skillId, 1, normalized, now);
    const skill = {
      id: skillId,
      object: "skill",
      created_at: now,
      updated_at: now,
      name: normalized.name,
      description: normalized.description,
      default_version: 1,
      latest_version: 1,
      metadata: isPlainObject(upload.metadata) ? upload.metadata : {},
      version_count: 1,
    };
    this.writeSkillRecord(skillId, skill);
    this.writeVersion(skillId, version, normalized.files);
    return this.hydrateSkill(skillId);
  }

  listSkills({ url } = {}) {
    const skills = this.listJson(this.skillsDir(), "skill.json")
      .map((record) => record.skill)
      .filter(Boolean)
      .map((skill) => this.hydrateSkill(skill.id))
      .filter(Boolean);
    return paginateList(skills, url);
  }

  getSkill(skillId) {
    return this.hydrateSkill(skillId);
  }

  updateSkill(skillId, body = {}) {
    const record = this.readJson(this.skillJsonPath(skillId));
    const skill = record?.skill;
    if (!skill) return null;
    const updated = { ...skill };
    if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
      updated.metadata = isPlainObject(body.metadata) ? body.metadata : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, "default_version")) {
      const version = this.resolveVersionNumber(skillId, body.default_version);
      if (!version) {
        const error = new Error(`skill version not found: ${body.default_version}`);
        error.status = 404;
        error.code = "skill_version_not_found";
        throw error;
      }
      updated.default_version = version;
    }
    updated.updated_at = nowSeconds();
    this.writeSkillRecord(skillId, updated);
    return this.hydrateSkill(skillId);
  }

  deleteSkill(skillId) {
    const skill = this.getSkill(skillId);
    if (!skill) return null;
    this.deletePath(this.skillDir(skillId));
    return { id: skillId, object: "skill.deleted", deleted: true };
  }

  createSkillVersion(skillId, upload = {}) {
    const record = this.readJson(this.skillJsonPath(skillId));
    const skill = record?.skill;
    if (!skill) return null;
    const normalized = normalizeSkillUpload(upload, this, {
      name: skill.name,
      description: skill.description,
    });
    const nextVersion = Math.max(0, ...this.listVersionNumbers(skillId)) + 1;
    const version = createVersionObject(skillId, nextVersion, normalized, nowSeconds());
    const updated = {
      ...skill,
      updated_at: nowSeconds(),
      name: normalized.name,
      description: normalized.description,
      latest_version: nextVersion,
      version_count: this.listVersionNumbers(skillId).length + 1,
    };
    this.writeVersion(skillId, version, normalized.files);
    this.writeSkillRecord(skillId, updated);
    return this.getSkillVersion(skillId, nextVersion);
  }

  listSkillVersions(skillId, { url } = {}) {
    if (!this.getSkill(skillId)) return null;
    const versions = this.listVersionNumbers(skillId)
      .map((version) => this.getSkillVersion(skillId, version))
      .filter(Boolean);
    return paginateList(versions, url);
  }

  getSkillVersion(skillId, versionRef = "default") {
    const version = this.resolveVersionNumber(skillId, versionRef);
    if (!version) return null;
    return this.readJson(this.versionJsonPath(skillId, version))?.skill_version || null;
  }

  deleteSkillVersion(skillId, versionRef) {
    const skill = this.getSkill(skillId);
    if (!skill) return null;
    const version = this.resolveVersionNumber(skillId, versionRef);
    if (!version) return null;
    const versions = this.listVersionNumbers(skillId);
    if (versions.length <= 1) {
      this.deleteSkill(skillId);
      return { id: `${skillId}:v${version}`, object: "skill.version.deleted", deleted: true, skill_deleted: true };
    }
    if (version === skill.default_version) {
      const error = new Error("cannot delete the default skill version");
      error.status = 400;
      error.code = "default_skill_version";
      error.param = "version";
      throw error;
    }
    this.deletePath(this.versionDir(skillId, version));
    const remaining = this.listVersionNumbers(skillId);
    const updated = {
      ...skill,
      latest_version: Math.max(...remaining),
      version_count: remaining.length,
      updated_at: nowSeconds(),
    };
    this.writeSkillRecord(skillId, updated);
    return { id: `${skillId}:v${version}`, object: "skill.version.deleted", deleted: true };
  }

  getSkillContentZip(skillId, versionRef = "default") {
    const materialized = this.materializeSkillVersion(skillId, versionRef);
    if (!materialized) return null;
    return {
      skill: materialized.skill,
      version: materialized.version,
      content: zipFiles(materialized.files),
    };
  }

  materializeSkillVersion(skillId, versionRef = "default") {
    const skill = this.getSkill(skillId);
    if (!skill) return null;
    const version = this.getSkillVersion(skillId, versionRef);
    if (!version) return null;
    const files = this.readVersionFiles(skillId, version.version);
    return { skill, version, files };
  }

  resolveVersionNumber(skillId, versionRef = "default") {
    const skill = this.readJson(this.skillJsonPath(skillId))?.skill;
    if (!skill) return null;
    if (versionRef == null || versionRef === "" || versionRef === "default") return skill.default_version;
    if (versionRef === "latest") return skill.latest_version;
    const version = Number(versionRef);
    if (!Number.isInteger(version) || version <= 0) return null;
    return fs.existsSync(this.versionJsonPath(skillId, version)) ? version : null;
  }

  listVersionNumbers(skillId) {
    try {
      return fs.readdirSync(this.versionsDir(skillId), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
        .map((entry) => Number(entry.name.slice(1)))
        .filter((version) => Number.isInteger(version))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  hydrateSkill(skillId) {
    const record = this.readJson(this.skillJsonPath(skillId));
    const skill = record?.skill;
    if (!skill) return null;
    const versions = this.listVersionNumbers(skillId);
    return {
      ...skill,
      version_count: versions.length,
      latest_version: versions.length ? Math.max(...versions) : skill.latest_version,
    };
  }

  writeSkillRecord(skillId, skill) {
    this.writeJson(this.skillJsonPath(skillId), { skill });
  }

  writeVersion(skillId, version, files) {
    const versionDir = this.versionDir(skillId, version.version);
    const filesDir = this.versionFilesDir(skillId, version.version);
    this.deletePath(versionDir);
    this.writeJson(this.versionJsonPath(skillId, version.version), { skill_version: version });
    for (const file of files) {
      const relativePath = sanitizeRelativePath(file.path);
      const target = path.join(filesDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, file.content, { mode: 0o600 });
    }
  }

  readVersionFiles(skillId, version) {
    const root = this.versionFilesDir(skillId, version);
    const files = [];
    const visit = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        const relative = path.relative(root, absolute).replace(/\\/g, "/");
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) files.push({ path: relative, content: fs.readFileSync(absolute) });
      }
    };
    visit(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  skillsDir() {
    return this.dir;
  }

  skillDir(skillId) {
    return path.join(this.skillsDir(), safeId(skillId));
  }

  skillJsonPath(skillId) {
    return path.join(this.skillDir(skillId), "skill.json");
  }

  versionsDir(skillId) {
    return path.join(this.skillDir(skillId), "versions");
  }

  versionDir(skillId, version) {
    return path.join(this.versionsDir(skillId), `v${Number(version)}`);
  }

  versionJsonPath(skillId, version) {
    return path.join(this.versionDir(skillId, version), "version.json");
  }

  versionFilesDir(skillId, version) {
    return path.join(this.versionDir(skillId, version), "files");
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
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  listJson(dir, filename) {
    try {
      return fs.readdirSync(dir)
        .map((name) => this.readJson(path.join(dir, name, filename)))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  deletePath(targetPath) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

function normalizeSkillUpload(upload = {}, store, fallback = {}) {
  let files = normalizeInputFiles(upload);
  const zipFile = files.length === 1 && /\.zip$/i.test(files[0].path) ? files[0] : null;
  if (zipFile) files = unzipFiles(zipFile.content, store.maxFileCount, store.maxUploadBytes);
  if (!files.length) {
    files = [makeSkillMdFile({
      name: upload.name || fallback.name || "local-skill",
      description: upload.description || fallback.description || "Local compatibility skill.",
      instructions: upload.instructions || upload.content || "Follow this skill's instructions when it is mounted.",
    })];
  }
  files = dedupeAndValidateFiles(files, store.maxFileCount, store.maxUploadBytes);
  const manifest = findSkillManifest(files);
  const parsed = parseSkillManifest(manifest.content.toString("utf8"));
  const name = stringifyContent(upload.name || parsed.name || fallback.name || "local-skill").trim();
  const description = stringifyContent(upload.description || parsed.description || fallback.description || "Local compatibility skill.").trim();
  if (!name || !description) {
    const error = new Error("SKILL.md must include non-empty name and description");
    error.status = 400;
    error.code = "invalid_skill_manifest";
    throw error;
  }
  return { name, description, files };
}

function normalizeInputFiles(upload = {}) {
  if (Array.isArray(upload.files)) {
    return upload.files.map((file, index) => normalizeInputFile(file, index));
  }
  if (upload.file) return [normalizeInputFile(upload.file, 0)];
  if (upload.skill_md || upload.skillMd) {
    return [{ path: "SKILL.md", content: Buffer.from(stringifyContent(upload.skill_md || upload.skillMd), "utf8") }];
  }
  if (upload.name || upload.description || upload.instructions || upload.content) {
    return [makeSkillMdFile(upload)];
  }
  return [];
}

function normalizeInputFile(file, index) {
  if (Buffer.isBuffer(file)) return { path: index === 0 ? "SKILL.md" : `file-${index}.txt`, content: file };
  if (typeof file === "string") return { path: index === 0 ? "SKILL.md" : `file-${index}.txt`, content: Buffer.from(file, "utf8") };
  if (!isPlainObject(file)) {
    return { path: `file-${index}.txt`, content: Buffer.from(stringifyContent(file), "utf8") };
  }
  const relativePath = file.path || file.filename || file.name || (index === 0 ? "SKILL.md" : `file-${index}.txt`);
  let content;
  if (typeof file.content_base64 === "string") content = Buffer.from(file.content_base64, "base64");
  else if (typeof file.base64 === "string") content = Buffer.from(file.base64, "base64");
  else content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(stringifyContent(file.content || ""), "utf8");
  return { path: relativePath, content };
}

function makeSkillMdFile(upload = {}) {
  const name = stringifyContent(upload.name || "local-skill").trim() || "local-skill";
  const description = stringifyContent(upload.description || "Local compatibility skill.").trim() || "Local compatibility skill.";
  const instructions = stringifyContent(upload.instructions || upload.content || "").trim()
    || "Follow this skill's instructions when it is mounted.";
  return {
    path: "SKILL.md",
    content: Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n${instructions}\n`, "utf8"),
  };
}

function dedupeAndValidateFiles(files, maxFileCount, maxUploadBytes) {
  const byPath = new Map();
  let total = 0;
  for (const file of files) {
    const relativePath = sanitizeRelativePath(file.path);
    if (!relativePath || relativePath.endsWith("/")) continue;
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(stringifyContent(file.content), "utf8");
    total += content.length;
    byPath.set(relativePath, { path: relativePath, content });
  }
  if (byPath.size > maxFileCount) {
    const error = new Error(`skill upload cannot contain more than ${maxFileCount} files`);
    error.status = 400;
    error.code = "too_many_skill_files";
    throw error;
  }
  if (total > maxUploadBytes) {
    const error = new Error(`skill upload exceeds local limit of ${maxUploadBytes} bytes`);
    error.status = 413;
    error.code = "skill_upload_too_large";
    throw error;
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function findSkillManifest(files) {
  const matches = files.filter((file) => file.path.split("/").at(-1)?.toLowerCase() === "skill.md");
  if (matches.length !== 1) {
    const error = new Error("skill upload must include exactly one SKILL.md manifest");
    error.status = 400;
    error.code = "invalid_skill_manifest";
    error.param = "files";
    throw error;
  }
  return matches[0];
}

function parseSkillManifest(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    value = value.replace(/^['"]|['"]$/g, "");
    result[field[1]] = value;
  }
  return result;
}

function createVersionObject(skillId, version, normalized, createdAt) {
  const bytes = normalized.files.reduce((sum, file) => sum + file.content.length, 0);
  return {
    id: `${skillId}:v${version}`,
    object: "skill.version",
    skill_id: skillId,
    version,
    created_at: createdAt,
    name: normalized.name,
    description: normalized.description,
    status: "processed",
    file_count: normalized.files.length,
    bytes,
  };
}

function unzipFiles(buffer, maxFileCount, maxUploadBytes) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) {
    const error = new Error("invalid skill zip upload");
    error.status = 400;
    error.code = "invalid_skill_zip";
    throw error;
  }
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const files = [];
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    const relativePath = sanitizeRelativePath(name);
    if (!relativePath) continue;
    if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) continue;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else {
      const error = new Error(`unsupported skill zip compression method ${method}`);
      error.status = 400;
      error.code = "unsupported_skill_zip";
      throw error;
    }
    if (content.length !== uncompressedSize) {
      const error = new Error("invalid skill zip entry size");
      error.status = 400;
      error.code = "invalid_skill_zip";
      throw error;
    }
    totalBytes += content.length;
    if (files.length >= maxFileCount || totalBytes > maxUploadBytes) {
      const error = new Error("skill zip exceeds local limits");
      error.status = 413;
      error.code = "skill_upload_too_large";
      throw error;
    }
    files.push({ path: relativePath, content });
  }
  return files;
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) return -1;
  const min = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(sanitizeRelativePath(file.path), "utf8");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(stringifyContent(file.content), "utf8");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function sanitizeRelativePath(value) {
  const normalized = String(value || "SKILL.md")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const safe = [];
  for (const part of parts) {
    if (part === "." || part === "..") continue;
    safe.push(part.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 160) || "file");
  }
  return safe.join("/") || "SKILL.md";
}

function paginateList(items, url) {
  const order = String(url?.searchParams?.get("order") || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const after = url?.searchParams?.get("after");
  const before = url?.searchParams?.get("before");
  const limit = parseLimit(url?.searchParams?.get("limit"), 20, 100);
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

function parseLimit(value, fallback, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,240}$/.test(value)) throw new Error(`invalid id: ${value}`);
  return value;
}

module.exports = {
  LocalSkillStore,
  normalizeSkillUpload,
  unzipFiles,
  zipFiles,
};
