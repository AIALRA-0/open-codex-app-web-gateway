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
const outputDir = path.resolve(String(args.get("output-dir") || process.env.UI_SMOKE_OUTPUT_DIR || "output/playwright"));
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

async function runWorkflow(page, config) {
  const result = {
    ok: false,
    url: config.url,
    marker: config.marker,
    started_at: new Date().toISOString(),
    steps: [],
    console: { errors: [], warnings: [] },
    screenshot: config.screenshotPath || null,
    auth_mode: "unknown",
  };

  page.on("console", (message) => {
    const type = message.type();
    if (type === "error") result.console.errors.push(message.text());
    if (type === "warning") result.console.warnings.push(message.text());
  });
  page.on("pageerror", (error) => {
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

  async function markerCount() {
    return await page.evaluate((value) => {
      const text = document.body?.innerText || "";
      return text.split(value).length - 1;
    }, config.marker);
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

    await recordStep("reload preserves conversation", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForAppShell();
      await page.waitForFunction((value) => {
        const text = document.body?.innerText || "";
        return text.includes(value);
      }, config.marker, { timeout: config.timeoutMs });
      return { marker_occurrences_after_reload: await markerCount() };
    });

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
