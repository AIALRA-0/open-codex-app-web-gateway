#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const url = String(args.get("url") || process.env.UI_SMOKE_URL || "https://opencodexapp.aialra.online");
const timeoutMs = parsePositiveInt(args.get("timeout-ms"), 120000);
const session = String(args.get("session") || process.env.UI_SMOKE_SESSION || "opencodex-ui-smoke");
const keepOpen = !!args.get("keep-open");
const headed = !!args.get("headed");
const marker = String(args.get("marker") || process.env.UI_SMOKE_MARKER || `ui-smoke-${Date.now().toString(36)}`);
const prompt = String(args.get("prompt") || process.env.UI_SMOKE_PROMPT || `Return exactly ${marker}.`);
const outputDir = path.resolve(String(args.get("output-dir") || process.env.UI_SMOKE_OUTPUT_DIR || "output/playwright"));
const screenshotPath = path.join(outputDir, `ui-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
const codexHome = process.env.CODEX_HOME || path.join(process.env.HOME || process.cwd(), ".codex");
const pwcli = process.env.PWCLI || path.join(codexHome, "skills", "playwright", "scripts", "playwright_cli.sh");

fs.mkdirSync(outputDir, { recursive: true });

if (!fs.existsSync(pwcli)) {
  console.error(`Playwright CLI wrapper not found: ${pwcli}`);
  process.exit(2);
}

const env = {
  ...process.env,
  PLAYWRIGHT_CLI_SESSION: session,
  UI_SMOKE_URL: url,
  UI_SMOKE_TIMEOUT_MS: String(timeoutMs),
  UI_SMOKE_MARKER: marker,
  UI_SMOKE_PROMPT: prompt,
  UI_SMOKE_SCREENSHOT: screenshotPath,
};

runPwcli(["close"], { allowFailure: true });
runPwcli(["open", url, ...(headed ? ["--headed"] : [])]);
const result = runCode(browserWorkflowSource());
if (!keepOpen) runPwcli(["close"], { allowFailure: true });

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

function runPwcli(commandArgs, options = {}) {
  const completed = spawnSync("bash", [pwcli, ...commandArgs], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (completed.status !== 0 && !options.allowFailure) {
    process.stderr.write(completed.stdout || "");
    process.stderr.write(completed.stderr || "");
    process.exit(completed.status || 1);
  }
  return completed;
}

function runCode(source) {
  const completed = spawnSync("bash", [pwcli, "--json", "run-code", source], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (completed.status !== 0) {
    process.stderr.write(completed.stdout || "");
    process.stderr.write(completed.stderr || "");
    process.exit(completed.status || 1);
  }

  let wrapped = null;
  try {
    wrapped = JSON.parse(completed.stdout);
  } catch (error) {
    console.error("Could not parse playwright-cli JSON output");
    console.error(completed.stdout);
    throw error;
  }

  if (wrapped.result && typeof wrapped.result === "object") return wrapped.result;
  if (typeof wrapped.result === "string") {
    try {
      return JSON.parse(wrapped.result);
    } catch {
      return { ok: false, error: "playwright-cli result was not JSON", raw: wrapped.result };
    }
  }
  return { ok: false, error: "playwright-cli returned no result", raw: wrapped };
}

function browserWorkflowSource() {
  const config = {
    timeoutMs,
    appUrl: url,
    marker,
    prompt,
    screenshotPath,
  };
  return String.raw`async (page) => {
    const config = ` + JSON.stringify(config) + String.raw`;
    const timeoutMs = config.timeoutMs;
    const appUrl = config.appUrl;
    const marker = config.marker;
    const prompt = config.prompt;
    const screenshotPath = config.screenshotPath;
    const result = {
      ok: false,
      url: appUrl,
      marker,
      started_at: new Date().toISOString(),
      steps: [],
      console: { errors: [], warnings: [] },
      screenshot: screenshotPath || null,
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

    async function isVisible(locator) {
      try {
        return await locator.first().isVisible({ timeout: 1000 });
      } catch {
        return false;
      }
    }

    async function waitForAppShell() {
      await page.getByRole("button", { name: /新对话|New chat/i }).first().waitFor({
        state: "visible",
        timeout: timeoutMs,
      });
    }

    async function findEditor() {
      const roleBox = page.getByRole("textbox").last();
      if (await isVisible(roleBox)) return roleBox;
      const editable = page.locator('[contenteditable="true"]').last();
      await editable.waitFor({ state: "visible", timeout: timeoutMs });
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
      }, marker);
    }

    try {
      await recordStep("load and authenticate", async () => {
        await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForTimeout(1200);
        const loginForm = page.locator('form[action="/login"], input[name="username"], input[name="password"]');
        if (await isVisible(loginForm)) {
          throw new Error("login page is visible; pre-authenticate the Playwright session before running ui-smoke");
        }
        await waitForAppShell();
        return { title: await page.title(), current_url: page.url() };
      });

      await recordStep("exercise sidebar controls", async () => {
        const search = page.getByRole("button", { name: /搜索|Search/i }).first();
        if (await isVisible(search)) {
          await search.click();
          await page.waitForTimeout(500);
          await page.keyboard.press("Escape");
        }

        const hideSidebar = page.getByRole("button", { name: /隐藏边栏|Hide sidebar/i }).first();
        if (await isVisible(hideSidebar)) {
          await hideSidebar.click();
          await page.waitForTimeout(500);
          const showSidebar = page.getByRole("button", { name: /显示\/隐藏侧边栏|Show\/hide sidebar|sidebar/i }).first();
          if (await isVisible(showSidebar)) await showSidebar.click();
        }

        const settings = page.getByRole("button", { name: /设置|Settings/i }).first();
        if (await isVisible(settings)) {
          await settings.click();
          await page.waitForTimeout(700);
          await page.keyboard.press("Escape");
        }
      });

      await recordStep("create new conversation and submit prompt", async () => {
        const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
        if (await isVisible(newChat)) {
          await newChat.click();
          await page.waitForTimeout(1000);
        }
        await fillEditor(prompt);
        await page.keyboard.press("Enter");
        await page.waitForFunction((value) => {
          const text = document.body?.innerText || "";
          return text.split(value).length - 1 >= 2;
        }, marker, { timeout: timeoutMs });
        return { marker_occurrences: await markerCount() };
      });

      await recordStep("reload preserves conversation", async () => {
        await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
        await waitForAppShell();
        await page.waitForFunction((value) => {
          const text = document.body?.innerText || "";
          return text.includes(value);
        }, marker, { timeout: timeoutMs });
        return { marker_occurrences_after_reload: await markerCount() };
      });

      if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
      result.ok = result.steps.every((step) => step.ok) && result.console.errors.length === 0;
    } catch (error) {
      result.error = error.message;
      try {
        if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {}
    }

    result.finished_at = new Date().toISOString();
    result.current_url = page.url();
    return result;
  }`;
}
