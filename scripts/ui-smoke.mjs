#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const url = String(args.get("url") || process.env.UI_SMOKE_URL || "https://opencodexapp.aialra.online");
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 120000);
const headed = !!args.get("headed");
const marker = String(args.get("marker") || process.env.UI_SMOKE_MARKER || `ui-smoke-${Date.now().toString(36)}`);
const prompt = String(args.get("prompt") || process.env.UI_SMOKE_PROMPT || `Return exactly ${marker}.`);
const exerciseActiveControls = !!args.get("exercise-active-controls") || parseBoolean(process.env.UI_SMOKE_EXERCISE_ACTIVE_CONTROLS, false);
const activeMarker = String(args.get("active-marker") || process.env.UI_SMOKE_ACTIVE_MARKER || `${marker}-active`);
const activePrompt = String(args.get("active-prompt") || process.env.UI_SMOKE_ACTIVE_PROMPT || [
  `For UI smoke active control test ${activeMarker}, write 120 numbered lines.`,
  `Every line must contain ${activeMarker} and at least twelve words.`,
  "Do not summarize; keep writing until every requested line is complete.",
].join(" "));
const outputDir = path.resolve(String(args.get("output-dir") || process.env.UI_SMOKE_OUTPUT_DIR || "output/playwright"));
const stateDir = path.resolve(String(args.get("state-dir") || process.env.UI_SMOKE_STATE_DIR || "state"));
const screenshotPath = path.join(outputDir, `ui-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
const username = process.env.UI_SMOKE_USERNAME || process.env.CODEXAPP_USERNAME || "";
const password = process.env.UI_SMOKE_PASSWORD || process.env.CODEXAPP_PASSWORD || "";

fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: false,
});
const page = await context.newPage();

const result = await runWorkflow(page, {
  url,
  timeoutMs,
  marker,
  prompt,
  exerciseActiveControls,
  activeMarker,
  activePrompt,
  outputDir,
  stateDir,
  screenshotPath,
  username,
  password,
});

await context.close().catch(() => {});
await browser.close().catch(() => {});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(key, true);
    } else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

async function runWorkflow(page, config) {
  const result = {
    ok: false,
    url: config.url,
    marker: config.marker,
    started_at: new Date().toISOString(),
    steps: [],
    console: { errors: [], warnings: [], filtered: [] },
    screenshot: config.screenshotPath || null,
    auth_mode: "unknown",
  };

  page.on("console", (message) => {
    const type = message.type();
    const text = message.text();
    if (isBenignConsoleMessage(text)) {
      result.console.filtered.push({ type, text });
      return;
    }
    if (type === "error") result.console.errors.push(text);
    if (type === "warning") result.console.warnings.push(text);
  });
  page.on("pageerror", (error) => {
    if (isBenignConsoleMessage(error.message)) {
      result.console.filtered.push({ type: "pageerror", text: error.message });
      return;
    }
    result.console.errors.push(error.message);
  });

  async function recordStep(name, fn) {
    const started = Date.now();
    const step = { name, ok: false };
    result.steps.push(step);
    try {
      const details = await fn();
      step.ok = true;
      if (details && typeof details === "object") Object.assign(step, details);
    } catch (error) {
      step.error = error.message;
      throw error;
    } finally {
      step.elapsed_ms = Date.now() - started;
    }
  }

  async function isVisible(locator, timeout = 1000) {
    try {
      return await locator.first().isVisible({ timeout });
    } catch {
      return false;
    }
  }

  async function clickOptional(locator, { timeout = 2500, settleMs = 500 } = {}) {
    if (!(await isVisible(locator, timeout))) return false;
    try {
      await locator.first().click({ timeout });
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      return true;
    } catch {
      return false;
    }
  }

  async function closeTransientOverlays() {
    const overlay = page.locator('[role="dialog"][data-state="open"], [cmdk-dialog][data-state="open"]');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await isVisible(overlay, 250))) return;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    if (await isVisible(overlay, 250)) {
      await page.mouse.click(24, 24);
      await page.waitForTimeout(300);
    }
  }

  async function waitForAppShell() {
    await page.getByRole("button", { name: /新对话|New chat/i }).first().waitFor({
      state: "visible",
      timeout: config.timeoutMs,
    });
  }

  async function ensureSidebarVisible() {
    const plugins = page.getByRole("button", { name: /插件|Plugins/i }).first();
    if (await isVisible(plugins, 500)) return true;
    const toggle = page.getByRole("button", {
      name: /显示\/隐藏侧边栏|显示边栏|隐藏边栏|Show\/hide sidebar|Show sidebar|Hide sidebar/i,
    }).first();
    if (await clickOptional(toggle, { timeout: 3000, settleMs: 700 })) {
      return await isVisible(plugins, 3000);
    }
    return false;
  }

  async function loginIfNeeded() {
    const loginForm = page.locator('form[action="/login"], input[name="username"], input[name="password"]');
    if (!(await isVisible(loginForm))) {
      result.auth_mode = "existing_session_or_public";
      return;
    }

    if (!config.username || !config.password) {
      throw new Error("login page is visible; set UI_SMOKE_USERNAME/UI_SMOKE_PASSWORD or CODEXAPP_USERNAME/CODEXAPP_PASSWORD");
    }

    result.auth_mode = "clean_login";
    await page.locator('input[name="username"]').fill(config.username);
    await page.locator('input[name="password"]').fill(config.password);
    await page.getByRole("button", { name: /登录|Log in|Login|Sign in/i }).click();
  }

  async function findEditor() {
    const roleBox = page.getByRole("textbox").last();
    if (await isVisible(roleBox)) return roleBox;
    const editable = page.locator('[contenteditable="true"]').last();
    await editable.waitFor({ state: "visible", timeout: config.timeoutMs });
    return editable;
  }

  async function fillEditor(text) {
    const editor = await findEditor();
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(text);
    return editor;
  }

  async function mainText() {
    return await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      return main?.innerText || "";
    });
  }

  async function waitForMainText(pattern, timeout = 10000) {
    await page.waitForFunction((source) => {
      const regex = new RegExp(source, "i");
      const main = document.querySelector("main") || document.body;
      return regex.test(main?.innerText || "");
    }, pattern.source, { timeout });
  }

  async function mainSnippet(max = 240) {
    const text = await mainText();
    return text.replace(/\s+/g, " ").trim().slice(0, max);
  }

  async function markerCount() {
    return markerCountFor(config.marker);
  }

  async function markerCountFor(value) {
    return await page.evaluate((value) => {
      const text = document.body?.innerText || "";
      return text.split(value).length - 1;
    }, value);
  }

  async function visibleButtonNames(pattern, { maxNameLength = Infinity } = {}) {
    return await page.getByRole("button").evaluateAll((buttons, params) => {
      const regex = new RegExp(params.source, "i");
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return buttons
        .map((button) => (button.getAttribute("aria-label") || button.getAttribute("title") || button.innerText || button.textContent || "").replace(/\s+/g, " ").trim())
        .filter((name, index) => name && name.length <= params.maxNameLength && regex.test(name) && visible(buttons[index]))
        .slice(0, 12);
    }, { source: pattern.source, maxNameLength });
  }

  async function findVisibleButton(pattern, timeout = 5000, { maxNameLength = Infinity } = {}) {
    const deadline = Date.now() + timeout;
    let lastNames = [];
    do {
      const buttons = await page.getByRole("button").all();
      lastNames = [];
      for (const button of buttons) {
        const visible = await button.isVisible().catch(() => false);
        if (!visible) continue;
        const name = await button.evaluate((element) => (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText ||
          element.textContent ||
          ""
        ).replace(/\s+/g, " ").trim()).catch(() => "");
        if (name && name.length <= maxNameLength) lastNames.push(name);
        if (!name || name.length > maxNameLength) continue;
        const regex = new RegExp(pattern.source, pattern.flags.replace("g", ""));
        if (regex.test(name)) {
          return { locator: button, name };
        }
      }
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(250);
    } while (true);
    return { locator: null, name: null, visible_names: lastNames.slice(0, 20) };
  }

  async function clickFirstVisibleButton(pattern, { timeout = 5000, settleMs = 500, maxNameLength = Infinity } = {}) {
    const found = await findVisibleButton(pattern, timeout, { maxNameLength });
    if (!found.locator) return { clicked: false, name: null, visible_names: found.visible_names || [] };
    await found.locator.click({ timeout: 5000 });
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    return { clicked: true, name: found.name };
  }

  async function waitUntilNoVisibleButton(pattern, timeout = 10000, { maxNameLength = Infinity } = {}) {
    const deadline = Date.now() + timeout;
    do {
      const found = await findVisibleButton(pattern, 250, { maxNameLength });
      if (!found.locator) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(300);
    } while (true);
  }

  async function exerciseActiveInterruptAndRecover() {
    const stopPattern = /停止|Stop|取消|Cancel|中断|Abort/i;
    const retryPattern = /重试|Retry|重新生成|Regenerate|再试|Try again|继续|Continue/i;
    const recoveryMarker = `${config.activeMarker}-recovered`;

    await closeTransientOverlays();
    const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
    if (await isVisible(newChat)) {
      await newChat.click();
      await page.waitForTimeout(1000);
    }

    await fillEditor(config.activePrompt);
    await page.keyboard.press("Enter");

    const stop = await clickFirstVisibleButton(stopPattern, { timeout: Math.min(45000, config.timeoutMs), settleMs: 1200, maxNameLength: 80 });
    if (!stop.clicked) {
      throw new Error(`active stop/interrupt control did not appear; visible buttons: ${(stop.visible_names || []).join(", ")}`);
    }

    const stopCleared = await waitUntilNoVisibleButton(stopPattern, 15000, { maxNameLength: 80 });
    const controlsAfterInterrupt = await visibleButtonNames(/停止|Stop|取消|Cancel|中断|Abort|重试|Retry|重新生成|Regenerate|再试|Try again|继续|Continue/i, { maxNameLength: 80 });

    const retry = await clickFirstVisibleButton(retryPattern, { timeout: 5000, settleMs: 800, maxNameLength: 80 });
    const retryStop = retry.clicked
      ? await clickFirstVisibleButton(stopPattern, { timeout: 15000, settleMs: 1200, maxNameLength: 80 })
      : { clicked: false, name: null };
    const retryStopCleared = retryStop.clicked ? await waitUntilNoVisibleButton(stopPattern, 15000, { maxNameLength: 80 }) : true;

    await closeTransientOverlays();
    await fillEditor(`Return exactly ${recoveryMarker}.`);
    await page.keyboard.press("Enter");
    await page.waitForFunction((value) => {
      const text = document.body?.innerText || "";
      return text.split(value).length - 1 >= 2;
    }, recoveryMarker, { timeout: config.timeoutMs });

    return {
      active_marker: config.activeMarker,
      stop_clicked: stop.clicked,
      stop_control_name: stop.name,
      stop_cleared: stopCleared,
      controls_after_interrupt: controlsAfterInterrupt,
      retry_clicked: retry.clicked,
      retry_control_name: retry.name,
      retry_control_status: retry.clicked ? "clicked" : "not_visible_after_interrupt",
      retry_stop_clicked: retryStop.clicked,
      retry_stop_control_name: retryStop.name,
      retry_stop_cleared: retryStopCleared,
      recovery_marker: recoveryMarker,
      recovery_marker_occurrences: await markerCountFor(recoveryMarker),
    };
  }

  async function exerciseProjectDialog() {
    await closeTransientOverlays();
    if (!(await ensureSidebarVisible())) throw new Error("sidebar is not visible before opening project dialog");
    const projectButton = page.getByRole("button", { name: /项目|Projects/i }).first();
    await projectButton.click({ timeout: 5000 });
    const newBlankProject = page.getByRole("menuitem", { name: /新建空白项目|New blank project|New project/i }).first();
    const existingFolder = page.getByRole("menuitem", { name: /使用现有文件夹|Use existing folder|Open folder/i }).first();
    await newBlankProject.waitFor({ state: "visible", timeout: 5000 });
    const existingFolderVisible = await isVisible(existingFolder, 1000);

    await newBlankProject.click();
    const projectNameBox = page.getByRole("textbox", { name: /项目名称|Project name/i }).first();
    await projectNameBox.waitFor({ state: "visible", timeout: 5000 });
    const projectName = `UI smoke ${safeBridgeId(config.marker)}`;
    await projectNameBox.fill(projectName);
    await page.getByRole("button", { name: /保存|Save/i }).first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: /取消|Cancel/i }).first().click({ timeout: 5000 });
    await closeTransientOverlays();

    return { project_dialog_opened: true, existing_folder_menu_visible: existingFolderVisible, project_name: projectName };
  }

  async function exerciseCorePageNavigation() {
    if (!(await ensureSidebarVisible())) throw new Error("sidebar is not visible before page navigation");
    const visited = [];
    const targets = [
      {
        id: "plugins",
        button: /插件|Plugins/i,
        expected: /让 Codex 按你的方式工作|搜索插件|更多插件|work.*your way|Search plugins|More plugins/i,
      },
      {
        id: "automation",
        button: /自动化|Automation/i,
        expected: /按计划或按需运行聊天|创建首个自动化|每日简报|run chats on a schedule|Create.*automation|Daily brief/i,
      },
      {
        id: "mobile",
        button: /Codex 移动版|Codex mobile/i,
        expected: /扫描二维码|ChatGPT 应用|iOS|安卓|Android|Scan.*QR/i,
      },
    ];

    for (const target of targets) {
      await closeTransientOverlays();
      const control = page.getByRole("button", { name: target.button }).first();
      await control.waitFor({ state: "visible", timeout: 5000 });
      await control.click({ timeout: 5000 });
      await waitForMainText(target.expected, 10000);
      visited.push({ id: target.id, snippet: await mainSnippet() });
    }

    await closeTransientOverlays();
    const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
    await newChat.click({ timeout: 5000 });
    await findEditor();
    await waitForMainText(/我们该做什么|What should we/i, 10000);
    return { page_switches: visited, returned_to_new_chat: true };
  }

  async function exerciseHostProjectAndUploadServices() {
    const safeMarker = safeBridgeId(config.marker);
    const projectId = `ui-smoke-project-${safeMarker}`;
    const projectRoot = path.join(config.outputDir, `project-root-${safeMarker}`);
    fs.mkdirSync(projectRoot, { recursive: true });

    const filename = `ui-smoke-upload-${safeMarker}.txt`;
    const uploadText = `OpenCodexApp UI smoke upload fixture for ${config.marker}\n`;
    const groupId = `ui-smoke-${safeMarker}`;
    const payload = {
      projectId,
      projectRoot,
      groupId,
      filename,
      contentsBase64: Buffer.from(uploadText, "utf8").toString("base64"),
      contentSizeBytes: Buffer.byteLength(uploadText, "utf8"),
    };

    const serviceResult = await page.evaluate(async (params) => {
      const services = window.codexappHostServices || window.codexappHost?.services;
      const uploadFiles = services?.browserUploads?.uploadFiles;
      const writableRoots = services?.projectWritableRoots;
      if (typeof uploadFiles !== "function") {
        return { supported: false, reason: "browserUploads.uploadFiles is unavailable" };
      }
      if (!writableRoots || typeof writableRoots.addRoot !== "function" || typeof writableRoots.clearRoots !== "function") {
        return { supported: false, reason: "projectWritableRoots service is unavailable" };
      }

      const upload = await uploadFiles({
        purpose: "attachment",
        groupId: params.groupId,
        label: "UI smoke upload",
        files: [{
          name: params.filename,
          type: "text/plain",
          size: params.contentSizeBytes,
          relativePath: params.filename,
          contentsBase64: params.contentsBase64,
        }],
      });
      const addRoot = await writableRoots.addRoot({
        projectId: params.projectId,
        root: params.projectRoot,
        label: "UI smoke writable root",
      });
      const clearRoots = await writableRoots.clearRoots({ projectId: params.projectId });
      return { supported: true, upload, addRoot, clearRoots };
    }, payload);

    if (!serviceResult.supported) throw new Error(serviceResult.reason || "host services unavailable");
    if (serviceResult.upload?.success !== true || !Array.isArray(serviceResult.upload.files) || serviceResult.upload.files.length !== 1) {
      throw new Error("browser upload service did not return one uploaded file");
    }
    if (serviceResult.addRoot?.success !== true || serviceResult.clearRoots?.success !== true) {
      throw new Error("project writable root service did not add and clear successfully");
    }

    const uploaded = serviceResult.upload.files[0];
    const expectedUploadPath = path.join(config.stateDir, "browser-uploads", new Date().toISOString().slice(0, 10), groupId, filename);
    const uploadedPath = uploaded.fsPath || uploaded.path || expectedUploadPath;
    let uploadedFileVerified = false;
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      uploadedFileVerified = fs.readFileSync(uploadedPath, "utf8") === uploadText;
      if (!uploadedFileVerified) throw new Error("uploaded fixture file contents did not match");
    }

    return {
      browser_upload_root: serviceResult.upload.root || null,
      browser_upload_file: uploadedPath,
      browser_upload_expected_file: expectedUploadPath,
      browser_upload_file_verified: uploadedFileVerified,
      project_writable_root_added: true,
      project_writable_root_cleared: true,
    };
  }

  try {
    await recordStep("load and authenticate", async () => {
      await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await page.waitForTimeout(1200);
      await loginIfNeeded();
      await waitForAppShell();
      return { title: await page.title(), current_url: page.url(), auth_mode: result.auth_mode };
    });

    await recordStep("exercise sidebar controls", async () => {
      const search = page.getByRole("button", { name: /搜索|Search/i }).first();
      if (await clickOptional(search)) await closeTransientOverlays();

      const hideSidebar = page.getByRole("button", { name: /隐藏边栏|Hide sidebar/i }).first();
      await clickOptional(hideSidebar);

      const settings = page.getByRole("button", { name: /设置|Settings/i }).first();
      if (await clickOptional(settings, { settleMs: 700 })) await closeTransientOverlays();
      await closeTransientOverlays();
    });

    await recordStep("exercise core page navigation", exerciseCorePageNavigation);

    await recordStep("exercise project dialog and host upload services", async () => {
      const dialog = await exerciseProjectDialog();
      const hostServices = await exerciseHostProjectAndUploadServices();
      return { ...dialog, ...hostServices };
    });

    await recordStep("create new conversation and submit prompt", async () => {
      await closeTransientOverlays();
      const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
      if (await isVisible(newChat)) {
        await newChat.click();
        await page.waitForTimeout(1000);
      }
      await fillEditor(config.prompt);
      await page.keyboard.press("Enter");
      await page.waitForFunction((value) => {
        const text = document.body?.innerText || "";
        return text.split(value).length - 1 >= 2;
      }, config.marker, { timeout: config.timeoutMs });
      return { marker_occurrences: await markerCount() };
    });

    await recordStep("discover stop and retry controls", async () => {
      const controls = await visibleButtonNames(/停止|Stop|取消|Cancel|重试|Retry|重新生成|Regenerate|继续|Continue/i, { maxNameLength: 80 });
      return { controls };
    });

    await recordStep("reload preserves conversation", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForAppShell();
      await page.waitForFunction((value) => {
        const text = document.body?.innerText || "";
        return text.includes(value);
      }, config.marker, { timeout: config.timeoutMs });
      return { marker_occurrences_after_reload: await markerCount() };
    });

    if (config.exerciseActiveControls) {
      await recordStep("actively interrupt and recover from a model turn", exerciseActiveInterruptAndRecover);
    }

    if (config.screenshotPath) await page.screenshot({ path: config.screenshotPath, fullPage: true });
    result.ok = result.steps.every((step) => step.ok) && result.console.errors.length === 0;
  } catch (error) {
    result.error = error.message;
    try {
      if (config.screenshotPath) await page.screenshot({ path: config.screenshotPath, fullPage: true });
    } catch {}
  }

  result.finished_at = new Date().toISOString();
  result.current_url = page.url();
  return result;
}

function safeBridgeId(value) {
  const cleaned = String(value || "")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned.length >= 6 ? cleaned : `ui-smoke-${Date.now().toString(36)}`;
}

function isBenignConsoleMessage(text) {
  return [
    /`DialogContent` requires a `DialogTitle`/,
    /Missing `Description` or `aria-describedby/,
  ].some((pattern) => pattern.test(String(text || "")));
}
