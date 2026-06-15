"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { prefixedId } = require("./translator");

const OFFICIAL_UPLOAD_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const OFFICIAL_UPLOAD_PART_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 3600;

class LocalUploadStore {
  constructor(config = {}) {
    this.dir = path.resolve(config.uploadStateDir || path.join(config.stateDir || process.cwd(), "local-uploads"));
    this.maxUploadBytes = config.uploadMaxBytes || 64 * 1024 * 1024;
    this.maxPartBytes = config.uploadMaxPartBytes || OFFICIAL_UPLOAD_PART_MAX_BYTES;
    this.retainPartData = config.uploadRetainPartData === true;
  }

  createUpload(body = {}) {
    const filename = requireString(body.filename, "filename");
    const purpose = requireString(body.purpose, "purpose");
    const mimeType = requireString(body.mime_type || body.mimeType, "mime_type");
    const bytes = requireInteger(body.bytes, "bytes");
    if (bytes < 0) throw httpError("bytes must be non-negative", 400, "invalid_upload", "bytes");
    if (bytes > OFFICIAL_UPLOAD_MAX_BYTES || bytes > this.maxUploadBytes) {
      throw httpError(`upload exceeds local limit of ${this.maxUploadBytes} bytes`, 413, "upload_too_large", "bytes");
    }
    const now = nowSeconds();
    const expiresAt = now + normalizeExpirySeconds(body.expires_after);
    const upload = {
      id: prefixedId("upload"),
      object: "upload",
      bytes,
      created_at: now,
      filename: sanitizeFilename(filename),
      purpose,
      mime_type: mimeType,
      status: "pending",
      expires_at: expiresAt,
    };
    this.writeJson(this.uploadJsonPath(upload.id), {
      upload,
      part_ids: [],
      total_part_bytes: 0,
    });
    return publicUpload(upload);
  }

  addPart(uploadId, data, options = {}) {
    const record = this.requireUploadRecord(uploadId);
    const upload = this.requirePendingUpload(record);
    const content = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ""), "utf8");
    if (!content.length) throw httpError("part data is required", 400, "missing_part_data", "data");
    if (content.length > OFFICIAL_UPLOAD_PART_MAX_BYTES || content.length > this.maxPartBytes) {
      throw httpError(`part exceeds local limit of ${this.maxPartBytes} bytes`, 413, "upload_part_too_large", "data");
    }
    const checksum = sha256Hex(content);
    const expectedSha256 = expectedSha256FromOptions(options);
    if (expectedSha256 && expectedSha256 !== checksum) {
      throw httpError("upload part checksum does not match content", 400, "upload_part_checksum_mismatch", "sha256");
    }
    const totalPartBytes = Number(record.total_part_bytes || 0);
    if (totalPartBytes + content.length > upload.bytes) {
      throw httpError("uploaded part bytes exceed the Upload bytes value", 400, "upload_bytes_exceeded", "bytes");
    }

    const part = {
      id: prefixedId("part"),
      object: "upload.part",
      created_at: nowSeconds(),
      upload_id: upload.id,
      bytes: content.length,
    };
    this.writeBuffer(this.partDataPath(upload.id, part.id), content);
    this.writeJson(this.partJsonPath(upload.id, part.id), {
      part,
      checksum: {
        type: "sha256",
        value: checksum,
      },
    });
    this.writeJson(this.uploadJsonPath(upload.id), {
      ...record,
      upload,
      part_ids: [...(record.part_ids || []), part.id],
      part_checksums: {
        ...(record.part_checksums || {}),
        [part.id]: checksum,
      },
      total_part_bytes: totalPartBytes + content.length,
    });
    return part;
  }

  completeUpload(uploadId, body = {}, fileSearchStore) {
    const record = this.requireUploadRecord(uploadId);
    const upload = this.requirePendingUpload(record);
    if (!fileSearchStore || typeof fileSearchStore.createFile !== "function") {
      throw httpError("file store is unavailable", 500, "file_store_unavailable");
    }
    if (!Array.isArray(body.part_ids)) {
      throw httpError("part_ids must be an ordered array", 400, "missing_part_ids", "part_ids");
    }

    const seen = new Set();
    const buffers = [];
    const orderedPartChecksums = [];
    for (const rawPartId of body.part_ids) {
      const partId = safeId(rawPartId);
      if (seen.has(partId)) throw httpError(`duplicate part_id: ${partId}`, 400, "duplicate_part_id", "part_ids");
      seen.add(partId);
      const partRecord = this.readJson(this.partJsonPath(upload.id, partId));
      const part = partRecord?.part;
      if (!part) throw httpError(`upload part not found: ${partId}`, 404, "upload_part_not_found", "part_ids");
      const partContent = this.readBuffer(this.partDataPath(upload.id, partId));
      buffers.push(partContent);
      orderedPartChecksums.push({
        id: partId,
        sha256: partRecord?.checksum?.value || sha256Hex(partContent),
      });
    }

    const content = Buffer.concat(buffers);
    if (content.length !== upload.bytes) {
      throw httpError(
        `uploaded bytes ${content.length} do not match expected ${upload.bytes}`,
        400,
        "upload_bytes_mismatch",
        "part_ids",
      );
    }
    const checksum = sha256Hex(content);
    const expectedSha256 = expectedSha256FromOptions(body);
    if (expectedSha256 && expectedSha256 !== checksum) {
      throw httpError("upload checksum does not match completed content", 400, "upload_checksum_mismatch", "sha256");
    }

    const file = fileSearchStore.createFile({
      filename: upload.filename,
      purpose: upload.purpose,
      content,
      mime_type: upload.mime_type,
      metadata: {
        upload_id: upload.id,
        mime_type: upload.mime_type,
        upload_checksum_algorithm: "sha256",
        upload_sha256: checksum,
        upload_part_count: String(body.part_ids.length),
      },
    });
    const completed = {
      ...upload,
      status: "completed",
      completed_at: nowSeconds(),
    };
    const partDataCleanup = this.cleanupPartData(upload.id, body.part_ids);
    this.writeJson(this.uploadJsonPath(upload.id), {
      ...record,
      upload: completed,
      file_id: file.id,
      checksum: {
        type: "sha256",
        value: checksum,
      },
      completed_part_checksums: orderedPartChecksums,
      part_data_cleanup: partDataCleanup,
    });
    return publicUpload(completed, file);
  }

  cancelUpload(uploadId) {
    const record = this.requireUploadRecord(uploadId);
    const upload = record.upload;
    if (!upload) throw httpError(`upload not found: ${uploadId}`, 404, "upload_not_found");
    if (upload.status === "completed") {
      throw httpError("completed uploads cannot be cancelled", 400, "upload_already_completed");
    }
    if (upload.status === "cancelled") return publicUpload(upload);
    this.requirePendingUpload(record);
    const cancelled = {
      ...upload,
      status: "cancelled",
      cancelled_at: nowSeconds(),
    };
    const partDataCleanup = this.cleanupPartData(upload.id, record.part_ids || []);
    this.writeJson(this.uploadJsonPath(upload.id), {
      ...record,
      upload: cancelled,
      part_data_cleanup: partDataCleanup,
    });
    return publicUpload(cancelled);
  }

  requireUploadRecord(uploadId) {
    const record = this.readJson(this.uploadJsonPath(uploadId));
    if (!record?.upload) throw httpError(`upload not found: ${uploadId}`, 404, "upload_not_found");
    return record;
  }

  requirePendingUpload(recordOrUpload) {
    const record = recordOrUpload?.upload ? recordOrUpload : null;
    const upload = record?.upload || recordOrUpload;
    if (!upload) throw httpError("upload not found", 404, "upload_not_found");
    if (upload.status === "cancelled") throw httpError("upload has been cancelled", 400, "upload_cancelled");
    if (upload.status === "completed") throw httpError("upload has already completed", 400, "upload_already_completed");
    if (upload.status === "expired") throw httpError("upload has expired", 400, "upload_expired");
    if (upload.expires_at && upload.expires_at <= nowSeconds()) {
      this.expireUploadRecord(record, upload);
      throw httpError("upload has expired", 400, "upload_expired");
    }
    return upload;
  }

  expireUploadRecord(record, upload) {
    if (!record || !upload?.id) return null;
    const expired = {
      ...upload,
      status: "expired",
      expired_at: nowSeconds(),
    };
    const partDataCleanup = this.cleanupPartData(upload.id, record.part_ids || []);
    this.writeJson(this.uploadJsonPath(upload.id), {
      ...record,
      upload: expired,
      part_data_cleanup: partDataCleanup,
    });
    return expired;
  }

  cleanupPartData(uploadId, partIds = []) {
    const uniquePartIds = Array.from(new Set((partIds || []).map((partId) => safeId(partId))));
    if (this.retainPartData) {
      return {
        retained: true,
        reason: "upload_retain_part_data",
        part_count: uniquePartIds.length,
      };
    }
    const cleanup = {
      retained: false,
      pruned_at: nowSeconds(),
      part_count: uniquePartIds.length,
      deleted_count: 0,
      deleted_bytes: 0,
      errors: [],
    };
    for (const partId of uniquePartIds) {
      const filePath = this.partDataPath(uploadId, partId);
      try {
        const stat = fs.statSync(filePath);
        fs.rmSync(filePath, { force: true });
        cleanup.deleted_count += 1;
        cleanup.deleted_bytes += stat.size;
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        cleanup.errors.push({
          part_id: partId,
          code: error?.code || "cleanup_failed",
          message: String(error?.message || error),
        });
      }
    }
    return cleanup;
  }

  uploadsDir() {
    return path.join(this.dir, "uploads");
  }

  uploadDir(uploadId) {
    return path.join(this.uploadsDir(), safeId(uploadId));
  }

  uploadJsonPath(uploadId) {
    return path.join(this.uploadDir(uploadId), "upload.json");
  }

  partsDir(uploadId) {
    return path.join(this.uploadDir(uploadId), "parts");
  }

  partJsonPath(uploadId, partId) {
    return path.join(this.partsDir(uploadId), `${safeId(partId)}.json`);
  }

  partDataPath(uploadId, partId) {
    return path.join(this.partsDir(uploadId), `${safeId(partId)}.bin`);
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

  readBuffer(filePath) {
    try {
      return fs.readFileSync(filePath);
    } catch {
      throw httpError(`upload part content not found: ${path.basename(filePath, ".bin")}`, 404, "upload_part_not_found");
    }
  }

  writeBuffer(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, filePath);
  }
}

function publicUpload(upload, file = null) {
  const value = {
    id: upload.id,
    object: "upload",
    bytes: upload.bytes,
    created_at: upload.created_at,
    filename: upload.filename,
    purpose: upload.purpose,
    status: upload.status,
    expires_at: upload.expires_at,
  };
  if (file) value.file = file;
  return value;
}

function normalizeExpirySeconds(expiresAfter) {
  if (expiresAfter == null) return DEFAULT_UPLOAD_EXPIRY_SECONDS;
  if (!isPlainObject(expiresAfter)) {
    throw httpError("expires_after must be an object", 400, "invalid_expires_after", "expires_after");
  }
  if (expiresAfter.anchor && expiresAfter.anchor !== "created_at") {
    throw httpError("expires_after.anchor must be created_at", 400, "invalid_expires_after", "expires_after.anchor");
  }
  const seconds = expiresAfter.seconds == null ? DEFAULT_UPLOAD_EXPIRY_SECONDS : Number(expiresAfter.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw httpError("expires_after.seconds must be positive", 400, "invalid_expires_after", "expires_after.seconds");
  }
  return Math.min(Math.trunc(seconds), DEFAULT_UPLOAD_EXPIRY_SECONDS);
}

function requireString(value, param) {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(`${param} is required`, 400, "invalid_upload", param);
  }
  return value.trim();
}

function requireInteger(value, param) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw httpError(`${param} must be an integer`, 400, "invalid_upload", param);
  }
  return parsed;
}

function expectedSha256FromOptions(options = {}) {
  if (!isPlainObject(options)) return "";
  const checksum = options.sha256
    || options.checksum_sha256
    || options.checksumSha256
    || (isPlainObject(options.checksum) ? options.checksum.sha256 || options.checksum.value : options.checksum);
  return normalizeSha256(checksum);
}

function normalizeSha256(value) {
  if (value == null || value === "") return "";
  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^(?:sha256[:=])?([a-f0-9]{64})$/);
  if (!match) throw httpError("sha256 checksum must be a 64 character hex string", 400, "invalid_upload_checksum", "sha256");
  return match[1];
}

function sha256Hex(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function httpError(message, status = 400, code = null, param = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.param = param;
  return error;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) throw httpError(`invalid id: ${value}`, 400, "invalid_id");
  return value;
}

function sanitizeFilename(value) {
  return String(value || "upload.txt").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200) || "upload.txt";
}

module.exports = {
  LocalUploadStore,
  OFFICIAL_UPLOAD_MAX_BYTES,
  OFFICIAL_UPLOAD_PART_MAX_BYTES,
};
