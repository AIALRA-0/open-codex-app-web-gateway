"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { reserveToolCall } = require("./local_tool_budget");
const { prefixedId, stringifyContent } = require("./translator");

const SHELL_TOOL_TYPES = new Set(["shell", "code_interpreter"]);

function isShellTool(tool) {
  return !!tool && typeof tool === "object" && SHELL_TOOL_TYPES.has(tool.type);
}

function localShellToolTypes(tools = [], config = {}) {
  if (!canUseLocalShell(config)) return [];
  return Array.from(new Set((tools || [])
    .filter(isShellTool)
    .map((tool) => tool.type)));
}

function canUseLocalShell(config = {}) {
  return String(config.shellProvider || "local").toLowerCase() !== "disabled";
}

class LocalContainerStore {
  constructor(config = {}) {
    this.dir = path.resolve(config.shellStateDir || path.join(config.stateDir || process.cwd(), "local-containers"));
    this.defaultMemoryLimit = config.shellMemoryLimit || "1g";
    this.maxFileBytes = config.shellMaxFileBytes || 16 * 1024 * 1024;
  }

  createContainer(body = {}) {
    const now = nowSeconds();
    const container = {
      id: prefixedId("cntr"),
      object: "container",
      created_at: now,
      status: "running",
      expires_after: isPlainObject(body.expires_after)
        ? body.expires_after
        : { anchor: "last_active_at", minutes: 20 },
      last_active_at: now,
      memory_limit: body.memory_limit || this.defaultMemoryLimit,
      name: body.name || null,
      network_policy: isPlainObject(body.network_policy) ? body.network_policy : null,
      metadata: isPlainObject(body.metadata) ? body.metadata : {},
    };
    this.writeJson(this.containerJsonPath(container.id), { container });
    fs.mkdirSync(this.workdir(container.id), { recursive: true, mode: 0o700 });
    return container;
  }

  listContainers({ url, name } = {}) {
    const containers = this.listJson(this.containersDir())
      .map((record) => record.container)
      .filter(Boolean)
      .map((container) => this.hydrateContainer(container.id))
      .filter(Boolean)
      .filter((container) => !name || container.name === name);
    return paginateList(containers, url);
  }

  getContainer(containerId) {
    return this.hydrateContainer(containerId);
  }

  deleteContainer(containerId) {
    const container = this.getContainer(containerId);
    if (!container) return null;
    this.deletePath(this.containerDir(containerId));
    return { id: containerId, object: "container.deleted", deleted: true };
  }

  ensureContainer(tool = {}) {
    const environment = tool.environment || tool.container || {};
    const referenceId = environment.container_id
      || environment.id
      || (typeof tool.container === "string" && tool.container !== "auto" ? tool.container : "");
    if (referenceId) {
      const container = this.getContainer(referenceId);
      if (container) {
        this.markActive(referenceId);
        return this.getContainer(referenceId);
      }
    }
    return this.createContainer({
      name: tool.name || "local-shell-auto",
      memory_limit: environment.memory_limit,
      network_policy: environment.network_policy,
    });
  }

  markActive(containerId) {
    const record = this.readJson(this.containerJsonPath(containerId));
    if (!record?.container) return null;
    record.container.last_active_at = nowSeconds();
    this.writeJson(this.containerJsonPath(containerId), record);
    return record.container;
  }

  createContainerFile(containerId, { filename, path: filePath, content = "" } = {}) {
    const container = this.getContainer(containerId);
    if (!container) return null;
    const body = Buffer.isBuffer(content) ? content : Buffer.from(stringifyContent(content), "utf8");
    if (body.length > this.maxFileBytes) {
      const error = new Error(`container file exceeds local limit of ${this.maxFileBytes} bytes`);
      error.status = 413;
      throw error;
    }
    const relativePath = sanitizeRelativePath(filePath || filename || "upload.txt");
    const target = path.join(this.workdir(containerId), relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, body, { mode: 0o600 });
    this.markActive(containerId);
    return this.containerFileObject(containerId, relativePath);
  }

  listContainerFiles(containerId, { url } = {}) {
    if (!this.getContainer(containerId)) return null;
    const files = this.scanContainerFiles(containerId);
    return paginateList(files, url);
  }

  getContainerFile(containerId, fileId) {
    if (!this.getContainer(containerId)) return null;
    return this.scanContainerFiles(containerId).find((file) => file.id === fileId) || null;
  }

  getContainerFileContent(containerId, fileId) {
    const file = this.getContainerFile(containerId, fileId);
    if (!file) return null;
    const target = path.join(this.workdir(containerId), sanitizeRelativePath(file.path));
    return fs.readFileSync(target);
  }

  deleteContainerFile(containerId, fileId) {
    const file = this.getContainerFile(containerId, fileId);
    if (!file) return null;
    this.deletePath(path.join(this.workdir(containerId), sanitizeRelativePath(file.path)));
    return { id: fileId, object: "container.file.deleted", deleted: true };
  }

  scanContainerFiles(containerId) {
    const root = this.workdir(containerId);
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
        else if (entry.isFile()) files.push(this.containerFileObject(containerId, relative));
      }
    };
    visit(root);
    return files;
  }

  containerFileObject(containerId, relativePath) {
    const target = path.join(this.workdir(containerId), sanitizeRelativePath(relativePath));
    const stat = fs.statSync(target);
    return {
      id: containerFileId(containerId, relativePath),
      object: "container.file",
      container_id: containerId,
      path: `/${relativePath.replace(/^\/+/, "")}`,
      bytes: stat.size,
      created_at: Math.floor(stat.birthtimeMs / 1000) || Math.floor(stat.mtimeMs / 1000) || nowSeconds(),
    };
  }

  hydrateContainer(containerId) {
    const record = this.readJson(this.containerJsonPath(containerId));
    const container = record?.container;
    if (!container) return null;
    return { ...container };
  }

  containersDir() {
    return this.dir;
  }

  containerDir(containerId) {
    return path.join(this.containersDir(), safeId(containerId));
  }

  containerJsonPath(containerId) {
    return path.join(this.containerDir(containerId), "container.json");
  }

  workdir(containerId) {
    return path.join(this.containerDir(containerId), "mnt", "data");
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

  listJson(dir) {
    try {
      return fs.readdirSync(dir)
        .map((name) => this.readJson(path.join(dir, name, "container.json")))
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

async function prepareShellContext(request = {}, config = {}, containerStore, options = {}) {
  const tools = (request.tools || []).filter(isShellTool);
  if (!tools.length || !canUseLocalShell(config) || !containerStore) return null;

  const commands = extractShellCommands(request.input, tools, config);
  const context = {
    provider: "local",
    status: commands.length ? "completed" : "skipped",
    tool_types: Array.from(new Set(tools.map((tool) => tool.type))),
    include_code_interpreter_outputs: Array.isArray(request.include)
      && request.include.includes("code_interpreter_call.outputs"),
    calls: [],
    outputs: [],
    executions: [],
    artifacts: [],
    mounted_skills: [],
    skipped_calls: [],
  };

  if (!commands.length) {
    context.warning = "No explicit shell command was found. Local shell compatibility did not execute anything.";
    return context;
  }

  const maxCommands = Math.max(1, Math.min(Number(config.shellMaxCommands || 1), 5));
  for (const command of commands.slice(0, maxCommands)) {
    const tool = tools[0];
    const codeInterpreter = tool.type === "code_interpreter";
    if (!reserveToolCall(options.toolBudget, {
      type: codeInterpreter ? "code_interpreter_call" : "shell_call",
      tool_type: tool.type || "shell",
      action: "exec",
      command,
    })) {
      context.skipped_calls.push({
        action: "exec",
        command,
        reason: "max_tool_calls_exhausted",
      });
      if (!context.calls.length) {
        context.status = "skipped";
        context.warning = "max_tool_calls was exhausted before local shell compatibility could execute a command.";
      }
      continue;
    }
    const container = containerStore.ensureContainer(tool);
    const mountedSkills = mountToolSkills(tool, container, containerStore, options.skillStore);
    const mountedFiles = mountToolFiles(tool, container, containerStore, options.fileSearchStore);
    for (const skill of mountedSkills) {
      if (!context.mounted_skills.some((item) => item.skill_id === skill.skill_id && item.version === skill.version)) {
        context.mounted_skills.push(skill);
      }
    }
    for (const file of mountedFiles) {
      if (!context.mounted_files?.some((item) => item.file_id === file.file_id && item.path === file.path)) {
        context.mounted_files = [...(context.mounted_files || []), file];
      }
    }
    const callId = prefixedId("call");
    const call = {
      id: prefixedId(codeInterpreter ? "ci" : "sh"),
      type: codeInterpreter ? "code_interpreter_call" : "shell_call",
      status: "completed",
      container_id: container.id,
      ...(codeInterpreter ? {
        code: command,
      } : {
        call_id: callId,
        action: {
          type: "exec",
          command,
          timeout_ms: config.shellCommandTimeoutMs || 10000,
          max_output_length: config.shellMaxOutputBytes || 20000,
        },
      }),
    };

    const result = await runShellCommand(command, container, containerStore, config);
    if (result.timed_out || result.exit_code !== 0) {
      call.status = result.timed_out ? "incomplete" : "failed";
      context.status = "failed";
    }

    const artifacts = containerStore.scanContainerFiles(container.id);
    const output = codeInterpreter
      ? null
      : {
        id: prefixedId("sho"),
        type: "shell_call_output",
        status: result.timed_out || result.exit_code !== 0 ? "failed" : "completed",
        call_id: callId,
        shell_call_id: call.id,
        container_id: container.id,
        output: [{
          type: "logs",
          stdout: result.stdout,
          stderr: result.stderr,
        }],
        outcome: {
          type: result.timed_out ? "timeout" : "exit",
          exit_code: result.exit_code,
        },
      };
    if (codeInterpreter && context.include_code_interpreter_outputs) {
      call.outputs = codeInterpreterOutputs(result, artifacts);
    }

    context.calls.push(call);
    if (output) context.outputs.push(output);
    context.executions.push({ command, container, result });
    context.artifacts = artifacts;
  }

  return context;
}

function injectShellMessages(chat, context) {
  if (!context) return;
  chat.messages.push({
    role: "system",
    content: shellPrompt(context),
  });
}

function attachShellOutput(response, context, options = {}) {
  if (!context) return response;
  response.output = [
    ...shellOutputItems(context, options),
    ...(response.output || []),
  ];
  return response;
}

function shellOutputItems(context, options = {}) {
  const items = [];
  const includeCodeInterpreterOutputs = options.includeCodeInterpreterOutputs
    ?? !!context?.include_code_interpreter_outputs;
  for (let index = 0; index < (context?.calls || []).length; index += 1) {
    const call = clone(context.calls[index]);
    if (call.type === "code_interpreter_call") {
      if (includeCodeInterpreterOutputs) {
        const execution = context.executions?.[index];
        if (!Array.isArray(call.outputs) && execution?.result) {
          call.outputs = codeInterpreterOutputs(execution.result, context.artifacts || []);
        }
      } else {
        delete call.outputs;
      }
    }
    items.push(call);
    if (context.outputs[index]) items.push(context.outputs[index]);
  }
  return items;
}

function shellCompatibility(context) {
  if (!context) return {};
  const first = context.executions?.[0];
  return {
    local_shell: {
      provider: context.provider || "local",
      status: context.status || "completed",
      tool_types: context.tool_types || [],
      command_count: context.calls?.length || 0,
      skipped_count: context.skipped_calls?.length || 0,
      artifact_count: context.artifacts?.length || 0,
      mounted_skill_count: context.mounted_skills?.length || 0,
      mounted_file_count: context.mounted_files?.length || 0,
      include_code_interpreter_outputs: !!context.include_code_interpreter_outputs,
      ...(context.mounted_skills?.length ? { mounted_skills: context.mounted_skills } : {}),
      ...(context.mounted_files?.length ? { mounted_files: context.mounted_files } : {}),
      ...(first ? {
        container_id: first.container.id,
        exit_code: first.result.exit_code,
        timed_out: !!first.result.timed_out,
      } : {}),
      ...(context.warning ? { warning: context.warning } : {}),
    },
  };
}

function codeInterpreterOutputs(result = {}, artifacts = []) {
  const logs = [
    result.stdout ? result.stdout : "",
    result.stderr ? `STDERR:\n${result.stderr}` : "",
  ].filter(Boolean).join("\n").trim();
  const outputs = [];
  if (logs || !artifacts.length) {
    outputs.push({
      type: "logs",
      logs,
    });
  }
  return outputs;
}

function shellPrompt(context) {
  if (context.warning) {
    return [
      "Local Responses shell compatibility was requested but did not execute a command.",
      context.warning,
      context.skipped_calls?.length ? `Skipped commands: ${context.skipped_calls.length}` : null,
      "Do not invent command output. Ask for an explicit command or answer from visible context.",
    ].filter(Boolean).join("\n");
  }

  const sections = [];
  for (const execution of context.executions || []) {
    sections.push([
      `Container: ${execution.container.id}`,
      `Command: ${execution.command}`,
      `Exit code: ${execution.result.exit_code}`,
      `Timed out: ${execution.result.timed_out ? "true" : "false"}`,
      `STDOUT:\n${execution.result.stdout || ""}`,
      `STDERR:\n${execution.result.stderr || ""}`,
    ].join("\n"));
  }

  const artifacts = (context.artifacts || [])
    .map((file) => `- /mnt/data${file.path} (${file.bytes} bytes, id ${file.id})`)
    .join("\n");
  const skills = (context.mounted_skills || [])
    .map((skill) => `- ${skill.name} v${skill.version}: ${skill.description} (${skill.path})`)
    .join("\n");
  const files = (context.mounted_files || [])
    .map((file) => `- ${file.filename}: ${file.path} (${file.bytes} bytes, file_id ${file.file_id})`)
    .join("\n");

  return [
    "Local Responses shell compatibility executed command output follows.",
    "The hosted-container path /mnt/data maps to the local container workspace for this bridge.",
    "Use the command output as tool evidence. Preserve exact stdout when the user asks for exact output.",
    "Do not rename, reinterpret, or invent artifact paths; use only the listed /mnt/data paths.",
    skills ? `Mounted skills:\n${skills}` : "Mounted skills: none",
    files ? `Mounted files:\n${files}` : "Mounted files: none",
    ...sections,
    artifacts ? `Artifacts:\n${artifacts}` : "Artifacts: none",
  ].join("\n\n");
}

function mountToolSkills(tool, container, containerStore, skillStore) {
  if (!skillStore) return [];
  const references = extractSkillReferences(tool);
  const mounted = [];
  for (const reference of references) {
    const materialized = skillStore.materializeSkillVersion(reference.skill_id, reference.version || "default");
    if (!materialized) {
      const error = new Error(`skill not found: ${reference.skill_id}`);
      error.status = 404;
      error.code = "skill_not_found";
      error.param = "tools.environment.skills";
      throw error;
    }
    const mountName = sanitizeSkillMountName(materialized.skill.name || materialized.skill.id);
    const mountRoot = path.posix.join(".skills", mountName, `v${materialized.version.version}`);
    for (const file of materialized.files) {
      containerStore.createContainerFile(container.id, {
        path: path.posix.join(mountRoot, sanitizeRelativePath(file.path)),
        content: file.content,
      });
    }
    mounted.push({
      type: "skill_reference",
      skill_id: materialized.skill.id,
      version: materialized.version.version,
      name: materialized.skill.name,
      description: materialized.skill.description,
      path: `/mnt/data/${mountRoot}`,
      file_count: materialized.files.length,
    });
  }
  return mounted;
}

function mountToolFiles(tool, container, containerStore, fileSearchStore) {
  if (!fileSearchStore || !tool || !container || !containerStore) return [];
  const mounted = [];
  for (const fileId of extractToolFileIds(tool)) {
    const file = fileSearchStore.getFile?.(fileId);
    const buffer = fileSearchStore.getFileContentBuffer?.(fileId);
    if (!file || !Buffer.isBuffer(buffer)) continue;
    const filename = sanitizeRelativePath(file.filename || `${fileId}.txt`);
    const mountedFile = containerStore.createContainerFile(container.id, {
      path: filename,
      content: buffer,
    });
    if (mountedFile) {
      mounted.push({
        type: "file_reference",
        file_id: file.id,
        filename: file.filename || filename,
        path: `/mnt/data${mountedFile.path}`,
        bytes: mountedFile.bytes,
      });
    }
  }
  return mounted;
}

function extractToolFileIds(tool = {}) {
  const resources = tool.tool_resources?.code_interpreter || tool.resources?.code_interpreter || {};
  const candidates = [
    ...(Array.isArray(tool.file_ids) ? tool.file_ids : []),
    ...(Array.isArray(tool.files) ? tool.files.map((file) => file?.file_id || file?.id || file) : []),
    ...(Array.isArray(resources.file_ids) ? resources.file_ids : []),
  ];
  return Array.from(new Set(candidates.map((item) => stringifyContent(item).trim()).filter(Boolean)));
}

function extractSkillReferences(tool = {}) {
  const environment = tool.environment || tool.container || {};
  const skills = [
    ...(Array.isArray(environment.skills) ? environment.skills : []),
    ...(Array.isArray(tool.skills) ? tool.skills : []),
  ];
  return skills
    .filter((skill) => isPlainObject(skill) && skill.type === "skill_reference" && typeof skill.skill_id === "string")
    .map((skill) => ({ skill_id: skill.skill_id, version: skill.version || "default" }));
}

async function runShellCommand(command, container, store, config = {}) {
  const timeoutMs = config.shellCommandTimeoutMs || 10000;
  const maxOutputBytes = config.shellMaxOutputBytes || 20000;
  const workdir = store.workdir(container.id);
  fs.mkdirSync(workdir, { recursive: true, mode: 0o700 });

  const rewritten = rewriteMountedDataPath(command, workdir);
  const child = spawn("bash", ["-lc", rewritten], {
    cwd: workdir,
    env: minimalShellEnv(workdir),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timedOut = false;
  const append = (current, chunk) => {
    const combined = Buffer.concat([current, chunk]);
    return combined.length > maxOutputBytes ? combined.subarray(0, maxOutputBytes) : combined;
  };

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 500).unref?.();
  }, timeoutMs);

  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(Number.isFinite(code) ? code : 1));
  }).finally(() => clearTimeout(timer));

  store.markActive(container.id);
  return {
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    exit_code: timedOut ? 124 : exitCode,
    timed_out: timedOut,
  };
}

function extractShellCommands(input, tools = [], config = {}) {
  const text = extractInputText(input);
  const maxChars = config.shellMaxCommandChars || 4000;
  const commands = [];

  for (const block of codeBlocks(text, /^(?:bash|sh|shell|zsh)$/i)) {
    commands.push(block);
  }

  if (tools.some((tool) => tool.type === "code_interpreter")) {
    for (const block of codeBlocks(text, /^(?:python|py)$/i)) {
      commands.push(`python3 - <<'PY'\n${block}\nPY`);
    }
  }

  const explicit = text.match(/\b(?:execute|run|command)\s*:\s*([^\n\r]+)/i);
  if (explicit?.[1]) commands.push(explicit[1].trim());

  return Array.from(new Set(commands
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) => command.slice(0, maxChars))));
}

function codeBlocks(text, languagePattern) {
  const blocks = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match = pattern.exec(text);
  while (match) {
    const language = match[1].trim();
    if (languagePattern.test(language)) blocks.push(match[2].trim());
    match = pattern.exec(text);
  }
  return blocks;
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

function rewriteMountedDataPath(command, workdir) {
  const source = String(command || "");
  let rewritten = "";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("/mnt/data", index)) {
      rewritten += quote ? escapeInsideQuote(workdir, quote) : shellQuote(workdir);
      index += "/mnt/data".length - 1;
      continue;
    }
    const char = source[index];
    if ((char === "'" || char === "\"") && !isEscaped(source, index)) {
      quote = quote === char ? null : quote || char;
    }
    rewritten += char;
  }
  return rewritten;
}

function minimalShellEnv(workdir) {
  return {
    HOME: workdir,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    PWD: workdir,
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function escapeInsideQuote(value, quote) {
  const text = String(value);
  if (quote === "\"") {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, "\\\"")
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");
  }
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function containerFileId(containerId, relativePath) {
  const hash = crypto
    .createHash("sha256")
    .update(`${containerId}:${relativePath}`)
    .digest("hex")
    .slice(0, 32);
  return `cfile_${hash}`;
}

function sanitizeRelativePath(value) {
  const normalized = String(value || "upload.txt")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const safe = [];
  for (const part of parts) {
    if (part === "." || part === "..") continue;
    safe.push(part.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "file");
  }
  return safe.join("/") || "upload.txt";
}

function sanitizeSkillMountName(value) {
  return String(value || "skill")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "skill";
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeId(id) {
  const value = String(id || "");
  if (!/^[A-Za-z0-9._:-]{3,200}$/.test(value)) throw new Error(`invalid id: ${value}`);
  return value;
}

module.exports = {
  attachShellOutput,
  injectShellMessages,
  localShellToolTypes,
  LocalContainerStore,
  prepareShellContext,
  shellCompatibility,
  shellOutputItems,
};
