#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  `For UI smoke active control test ${activeMarker}, reply in the chat only and do not create files or attachments.`,
  `Write 260 numbered lines. Every line must contain ${activeMarker}, the line number, and at least eighteen words.`,
  "Do not summarize, do not use markdown tables, and do not stop until all lines are visible in this chat.",
].join(" "));
const outputDir = path.resolve(String(args.get("output-dir") || process.env.UI_SMOKE_OUTPUT_DIR || "output/playwright"));
const stateDir = path.resolve(String(args.get("state-dir") || process.env.UI_SMOKE_STATE_DIR || "state"));
const codexHome = path.resolve(String(args.get("codex-home") || process.env.UI_SMOKE_CODEX_HOME || defaultUiSmokeCodexHome()));
const codexStateDb = path.resolve(String(args.get("codex-state-db") || process.env.UI_SMOKE_CODEX_STATE_DB || path.join(codexHome, "state_5.sqlite")));
const screenshotPath = path.join(outputDir, `ui-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
const username = process.env.UI_SMOKE_USERNAME || process.env.CODEXAPP_USERNAME || "";
const password = process.env.UI_SMOKE_PASSWORD || process.env.CODEXAPP_PASSWORD || "";
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  codexHome,
  codexStateDb,
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

function defaultUiSmokeCodexHome() {
  const deploymentCodexHome = "/srv/aialra/state/opencodexapp-codex-home";
  if (fs.existsSync(deploymentCodexHome)) return deploymentCodexHome;
  return process.env.CODEXAPP_CODEX_HOME || process.env.CODEX_HOME || path.join(process.env.HOME || "/tmp", ".codex");
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

  async function findThreadRecordForMarker(markerValue, timeout = 15000) {
    const deadline = Date.now() + timeout;
    do {
      const thread = queryThreadRecordForMarker(config.codexStateDb, markerValue);
      if (thread?.rollout_path) return thread;
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(500);
    } while (true);
    return null;
  }

  async function openSidebarThreadByMarker(markerValue) {
    if (!(await ensureSidebarVisible())) throw new Error("sidebar is not visible before opening generated artifact thread");
    const opened = await page.evaluate((marker) => {
      const main = document.querySelector("main");
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none";
      };
      const labelFor = (element) => (
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.innerText
        || element.textContent
        || ""
      ).replace(/\s+/g, " ").trim();
      const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"))
        .filter((element) => (!main || !main.contains(element)) && visible(element))
        .map((element) => ({ element, label: labelFor(element), rect: element.getBoundingClientRect() }))
        .filter((entry) => entry.label.includes(marker));
      if (candidates.length === 0) return null;
      candidates.sort((left, right) => left.rect.top - right.rect.top);
      const target = candidates[0].element;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      target.click();
      return {
        tag: target.tagName.toLowerCase(),
        role: target.getAttribute("role") || "",
        label: labelFor(target).slice(0, 160),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      };
    }, markerValue);
    if (!opened) throw new Error(`thread with marker ${markerValue} was not visible in sidebar`);
    await page.waitForTimeout(1000);
    return opened;
  }

  async function clickSidebarButtonAndWait(target) {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await closeTransientOverlays();
      if (!(await ensureSidebarVisible())) throw new Error(`sidebar is not visible before opening ${target.id}`);
      const control = page.getByRole("button", { name: target.button }).first();
      await control.waitFor({ state: "visible", timeout: 5000 });
      await control.scrollIntoViewIfNeeded().catch(() => {});
      await control.click({ timeout: 5000 });
      try {
        await waitForMainText(target.expected, 10000);
        return { id: target.id, snippet: await mainSnippet() };
      } catch (error) {
        lastError = error;
        await page.waitForTimeout(500);
      }
    }
    throw new Error(`opening ${target.id} did not show expected content: ${lastError?.message || "unknown error"}; snippet=${await mainSnippet()}`);
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

  async function visibleButtonNames(pattern, { maxNameLength = Infinity, viewportOnly = false } = {}) {
    return await page.getByRole("button").evaluateAll((buttons, params) => {
      const regex = new RegExp(params.source, "i");
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (!params.viewportOnly) return true;
        return rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
      };
      return buttons
        .map((button) => (button.getAttribute("aria-label") || button.getAttribute("title") || button.innerText || button.textContent || "").replace(/\s+/g, " ").trim())
        .filter((name, index) => name && name.length <= params.maxNameLength && regex.test(name) && visible(buttons[index]))
        .slice(0, 12);
    }, { source: pattern.source, maxNameLength, viewportOnly });
  }

  async function findVisibleButton(pattern, timeout = 5000, { maxNameLength = Infinity, viewportOnly = false } = {}) {
    const deadline = Date.now() + timeout;
    let lastNames = [];
    do {
      const found = await page.getByRole("button").evaluateAll((buttons, params) => {
        const regex = new RegExp(params.source, params.flags);
        const names = [];
        for (let index = 0; index < buttons.length; index += 1) {
          const button = buttons[index];
          const rect = button.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && (
            !params.viewportOnly ||
            (rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth)
          );
          if (!visible) continue;
          const name = (
            button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            button.innerText ||
            button.textContent ||
            ""
          ).replace(/\s+/g, " ").trim();
          if (name && name.length <= params.maxNameLength) names.push(name);
          if (name && name.length <= params.maxNameLength && regex.test(name)) {
            return {
              index,
              name,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              rect: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
              visible_names: names.slice(0, 20),
            };
          }
        }
        return { index: -1, name: null, x: null, y: null, rect: null, visible_names: names.slice(0, 20) };
      }, {
        source: pattern.source,
        flags: pattern.flags.replace("g", ""),
        maxNameLength,
        viewportOnly,
      });
      lastNames = found.visible_names || [];
      if (found.index >= 0) {
        return {
          locator: page.getByRole("button").nth(found.index),
          name: found.name,
          x: found.x,
          y: found.y,
          rect: found.rect,
          visible_names: lastNames,
        };
      }
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(250);
    } while (true);
    return { locator: null, name: null, visible_names: lastNames.slice(0, 20) };
  }

  async function clickFirstVisibleButton(pattern, { timeout = 5000, settleMs = 500, maxNameLength = Infinity, viewportOnly = false } = {}) {
    const found = await findVisibleButton(pattern, timeout, { maxNameLength, viewportOnly });
    if (!found.locator) return { clicked: false, name: null, visible_names: found.visible_names || [] };
    if (Number.isFinite(found.x) && Number.isFinite(found.y)) {
      await page.mouse.click(found.x, found.y);
    } else {
      await found.locator.click({ timeout: 5000 });
    }
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    return { clicked: true, name: found.name, rect: found.rect || null };
  }

  async function clickNewChatIfVisible({ timeout = 5000, settleMs = 1000 } = {}) {
    return await clickFirstVisibleButton(/新对话|New chat/i, {
      timeout,
      settleMs,
      maxNameLength: 120,
      viewportOnly: true,
    });
  }

  async function waitUntilNoVisibleButton(pattern, timeout = 10000, { maxNameLength = Infinity, viewportOnly = false } = {}) {
    const deadline = Date.now() + timeout;
    do {
      const found = await findVisibleButton(pattern, 250, { maxNameLength, viewportOnly });
      if (!found.locator) return true;
      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(300);
    } while (true);
  }

  async function waitForCurrentTurnSettled(timeout = 30000) {
    const stopPattern = /^(停止|停止生成|取消|中断|Stop|Stop generating|Stop response|Cancel|Abort)$/i;
    const stopCleared = await waitUntilNoVisibleButton(stopPattern, timeout, { maxNameLength: 80, viewportOnly: true });
    await page.waitForTimeout(1200);
    return stopCleared;
  }

  async function clickComposerActionButton({ timeout = 5000, settleMs = 800 } = {}) {
    const deadline = Date.now() + timeout;
    do {
      const candidate = await page.locator("button").evaluateAll((buttons) => {
        const candidates = [];
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          const name = (
            button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            button.innerText ||
            button.textContent ||
            ""
          ).replace(/\s+/g, " ").trim();
          const squareEnough = rect.width >= 24 && rect.width <= 64 && rect.height >= 24 && rect.height <= 64;
          const inComposerCorner = rect.left >= window.innerWidth * 0.75 && rect.top >= window.innerHeight * 0.55;
          if (rect.width > 0 && rect.height > 0 && squareEnough && inComposerCorner) {
            candidates.push({
              name,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              rect: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
            });
          }
        }
        return candidates.at(-1) || null;
      });
      if (candidate) {
        await page.mouse.click(candidate.x, candidate.y);
        if (settleMs > 0) await page.waitForTimeout(settleMs);
        return { clicked: true, name: candidate.name || "composer action button", rect: candidate.rect };
      }
      if (Date.now() >= deadline) break;
      await page.waitForTimeout(250);
    } while (true);
    return { clicked: false, name: null };
  }

  async function hoverCompletedTurnTargets(markerValue) {
    const targets = await page.evaluate((marker) => {
      const main = document.querySelector("main") || document.body;
      const seen = new Set();
      const targetFor = (element, kind) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${kind}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          kind,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          label: (
            element.getAttribute("aria-label")
            || element.getAttribute("title")
            || element.innerText
            || element.textContent
            || ""
          ).replace(/\s+/g, " ").trim().slice(0, 160),
          x: rect.left + Math.min(Math.max(rect.width / 2, 2), Math.max(rect.width - 2, 2)),
          y: rect.top + Math.min(Math.max(rect.height / 2, 2), Math.max(rect.height - 2, 2)),
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        };
      };
      const candidates = Array.from(main.querySelectorAll("*")).filter((element) => {
        const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        if (!text.includes(marker)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const userBubble = candidates.find((element) => element.getAttribute("role") === "button" && /编辑用户消息|Edit user message/i.test(
        element.getAttribute("aria-label")
          || element.getAttribute("title")
          || element.innerText
          || element.textContent
          || "",
      ));
      const exactAssistant = candidates
        .filter((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim() === marker)
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
        })[0];
      const broadTurn = candidates
        .slice()
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
        })[0];
      return [
        targetFor(userBubble, "user_message"),
        targetFor(exactAssistant, "assistant_output"),
        targetFor(broadTurn, "completed_turn"),
      ].filter(Boolean);
    }, markerValue);

    for (const target of targets) {
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(400);
    }
    return targets.map(({ x, y, ...target }) => target);
  }

  async function visibleMainControlDetails(pattern, { maxNameLength = 120 } = {}) {
    return await page.evaluate((params) => {
      const main = document.querySelector("main") || document.body;
      const regex = new RegExp(params.source, params.flags);
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none";
      };
      const labelFor = (element) => (
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.innerText
        || element.textContent
        || ""
      ).replace(/\s+/g, " ").trim();
      return Array.from(main.querySelectorAll("button, [role='button'], a"))
        .filter(visible)
        .map((element) => {
          const label = labelFor(element);
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || "",
            label: label.slice(0, params.maxNameLength),
            rect: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            },
          };
        })
        .filter((control) => control.label && regex.test(control.label))
        .slice(0, 20);
    }, {
      source: pattern.source,
      flags: pattern.flags.replace("g", ""),
      maxNameLength,
    });
  }

  async function visibleAssistantActionIconDetails(markerValue) {
    return await page.evaluate((marker) => {
      const main = document.querySelector("main") || document.body;
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== "hidden"
          && style.display !== "none";
      };
      const labelFor = (element) => (
        element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.innerText
        || element.textContent
        || ""
      ).replace(/\s+/g, " ").trim();
      const assistantText = Array.from(main.querySelectorAll("p, div, span"))
        .filter((element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim() === marker)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height))[0];
      if (!assistantText) return [];
      const anchor = assistantText.rect;
      return Array.from(main.querySelectorAll("button, [role='button'], a"))
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { element, rect, label: labelFor(element) };
        })
        .filter(({ rect }) => {
          const compact = rect.width >= 18 && rect.width <= 42 && rect.height >= 18 && rect.height <= 42;
          const belowAssistant = rect.top >= anchor.bottom - 8 && rect.top <= anchor.bottom + 90;
          const nearAssistantStart = rect.left >= anchor.left - 24 && rect.left <= anchor.left + 120;
          return compact && belowAssistant && nearAssistantStart;
        })
        .map(({ element, rect, label }) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          label: label.slice(0, 120),
          rect: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        }))
        .slice(0, 8);
    }, markerValue);
  }

  async function exerciseCompletedTurnActions() {
    const completedActionPattern = /复制消息|Copy message|编辑消息|Edit message|编辑用户消息|Edit user message|^复制$|^Copy$|从此处开始分叉|Fork from here|Branch from here|Start from here|重试|Retry|重新生成|Regenerate|继续|Continue/i;
    await closeTransientOverlays();
    const hoveredTargets = await hoverCompletedTurnTargets(config.marker);
    const controls = await visibleMainControlDetails(completedActionPattern, { maxNameLength: 120 });
    const assistantActionIcons = await visibleAssistantActionIconDetails(config.marker);
    const labels = controls.map((control) => control.label);
    const hasUserEdit = labels.some((label) => /编辑用户消息|Edit user message|编辑消息|Edit message/i.test(label));
    const hasUserCopy = labels.some((label) => /复制消息|Copy message/i.test(label));
    const hasAssistantCopy = labels.some((label) => /^复制$|^Copy$/i.test(label)) || assistantActionIcons.length >= 1;
    const hasBranch = labels.some((label) => /从此处开始分叉|Fork from here|Branch from here|Start from here/i.test(label));
    const retryRegenerateControls = labels.filter((label) => /重试|Retry|重新生成|Regenerate|继续|Continue/i.test(label));

    const conversationAction = page.getByRole("button", { name: /对话操作|Conversation actions/i }).first();
    let conversationMenuItems = [];
    if (await isVisible(conversationAction, 1000)) {
      await conversationAction.click({ timeout: 5000 });
      await page.waitForTimeout(400);
      conversationMenuItems = await page.getByRole("menuitem").evaluateAll((items) => items
        .filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((item) => (item.getAttribute("aria-label") || item.innerText || item.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 12));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    const hasAssistantContinuation = hasBranch || retryRegenerateControls.length > 0 || assistantActionIcons.length >= 2;
    if (!hasUserEdit || !hasUserCopy || !hasAssistantCopy || !hasAssistantContinuation) {
      throw new Error(`completed turn actions missing expected controls: labels=${labels.join(", ")} assistant_icons=${JSON.stringify(assistantActionIcons)}`);
    }
    if (conversationMenuItems.length === 0) {
      throw new Error("conversation action menu did not expose any menu items");
    }

    return {
      completed_turn_hover_targets: hoveredTargets,
      completed_turn_controls: controls,
      completed_turn_assistant_action_icons: assistantActionIcons,
      completed_turn_user_edit_visible: hasUserEdit,
      completed_turn_user_copy_visible: hasUserCopy,
      completed_turn_assistant_copy_visible: hasAssistantCopy,
      completed_turn_branch_visible: hasBranch,
      completed_turn_retry_regenerate_visible: retryRegenerateControls.length > 0,
      completed_turn_retry_regenerate_controls: retryRegenerateControls,
      conversation_action_menu_items: conversationMenuItems,
    };
  }

  async function exerciseActiveInterruptAndRecover() {
    const stopPattern = /^(停止|停止生成|取消|中断|Stop|Stop generating|Stop response|Cancel|Abort)$/i;
    const retryPattern = /^(重试|Retry|重新生成|Regenerate|再试|Try again|继续|Continue)$/i;
    const recoveryMarker = `${config.activeMarker}-recovered`;

    await closeTransientOverlays();
    const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
    if (await isVisible(newChat)) {
      await newChat.click();
      await page.waitForTimeout(1000);
    }

    await fillEditor(config.activePrompt);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    const stop = await clickFirstVisibleButton(stopPattern, {
      timeout: Math.min(12000, config.timeoutMs),
      settleMs: 1200,
      maxNameLength: 80,
      viewportOnly: true,
    });
    const composerInterrupt = stop.clicked
      ? { clicked: false, name: null }
      : await clickComposerActionButton({ timeout: 5000, settleMs: 1200 });
    const interruptRequested = stop.clicked || composerInterrupt.clicked;
    if (!interruptRequested) {
      throw new Error(`active interrupt control did not appear; visible buttons: ${(stop.visible_names || []).join(", ")}`);
    }

    const stopCleared = stop.clicked ? await waitUntilNoVisibleButton(stopPattern, 15000, { maxNameLength: 80, viewportOnly: true }) : true;
    const controlsAfterInterrupt = await visibleButtonNames(/^(停止|Stop|取消|Cancel|中断|Abort|重试|Retry|重新生成|Regenerate|再试|Try again|继续|Continue)$/i, {
      maxNameLength: 80,
      viewportOnly: true,
    });

    const retry = await clickFirstVisibleButton(retryPattern, { timeout: 5000, settleMs: 800, maxNameLength: 80, viewportOnly: true });
    const retryStop = retry.clicked
      ? await clickFirstVisibleButton(stopPattern, { timeout: 15000, settleMs: 1200, maxNameLength: 80, viewportOnly: true })
      : { clicked: false, name: null };
    const retryStopCleared = retryStop.clicked ? await waitUntilNoVisibleButton(stopPattern, 15000, { maxNameLength: 80, viewportOnly: true }) : true;

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
      stop_control_rect: stop.rect || null,
      composer_interrupt_clicked: composerInterrupt.clicked,
      composer_interrupt_control_name: composerInterrupt.name,
      composer_interrupt_control_rect: composerInterrupt.rect || null,
      interrupt_requested: interruptRequested,
      interrupt_method: stop.clicked ? "named_stop_control" : (composerInterrupt.clicked ? "composer_action_button" : "none"),
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
      visited.push(await clickSidebarButtonAndWait(target));
    }

    await closeTransientOverlays();
    const newChat = page.getByRole("button", { name: /新对话|New chat/i }).first();
    await newChat.click({ timeout: 5000 });
    await findEditor();
    await waitForMainText(/我们该做什么|What should we/i, 10000);
    return { page_switches: visited, returned_to_new_chat: true };
  }

  async function exerciseGeneratedImageArtifactDisplay() {
    const thread = await findThreadRecordForMarker(config.marker);
    if (!thread?.rollout_path) throw new Error(`no thread rollout found for marker ${config.marker}`);

    const rolloutPath = path.resolve(thread.rollout_path);
    const sessionsRoot = path.resolve(config.codexHome, "sessions");
    if (!isPathWithin(rolloutPath, sessionsRoot)) {
      throw new Error(`thread rollout is outside Codex sessions root: ${rolloutPath}`);
    }
    const stat = fs.statSync(rolloutPath);
    if (!stat.isFile()) throw new Error(`thread rollout is not a file: ${rolloutPath}`);
    const originalSize = stat.size;
    const imageCallId = `ui_smoke_generated_image_${safeBridgeId(config.marker)}`;
    const event = {
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: {
        type: "image_generation_end",
        call_id: imageCallId,
        status: "completed",
        revised_prompt: `UI smoke generated image ${config.marker}`,
        result: tinyPngBase64,
      },
    };

    let details = null;
    let cleanup = { rollout_truncated: false, original_size: originalSize };
    try {
      fs.appendFileSync(rolloutPath, `${JSON.stringify(event)}\n`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForAppShell();
      await page.waitForTimeout(750);
      const openedThread = await openSidebarThreadByMarker(config.marker);
      await page.waitForFunction(() => {
        const main = document.querySelector("main") || document.body;
        return Array.from(main.querySelectorAll("img")).some((img) => {
          const src = img.getAttribute("src") || "";
          const alt = img.getAttribute("alt") || "";
          const rect = img.getBoundingClientRect();
          return src.startsWith("data:image/")
            && /已生成图像|generated image/i.test(alt)
            && rect.width > 0
            && rect.height > 0;
        });
      }, undefined, { timeout: 15000 });

      const artifact = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body;
        const images = Array.from(main.querySelectorAll("img")).map((img) => {
          const rect = img.getBoundingClientRect();
          return {
            alt: img.getAttribute("alt") || "",
            src_prefix: (img.getAttribute("src") || "").slice(0, 30),
            natural_width: img.naturalWidth || 0,
            natural_height: img.naturalHeight || 0,
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            },
          };
        }).filter((img) => img.src_prefix.startsWith("data:image/"));
        const generated = images.find((img) => /已生成图像|generated image/i.test(img.alt)) || images[0] || null;
        return {
          image_count: images.length,
          generated_image: generated,
          snippet: (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
        };
      });

      details = {
        generated_artifact_displayed: true,
        generated_artifact_call_id: imageCallId,
        generated_artifact_thread_id: thread.id,
        generated_artifact_opened_thread: openedThread,
        generated_artifact_rollout: rolloutPath,
        generated_artifact_image_count: artifact.image_count,
        generated_artifact_image: artifact.generated_image,
        generated_artifact_snippet: artifact.snippet,
        generated_artifact_cleanup: cleanup,
      };
    } finally {
      try {
        fs.truncateSync(rolloutPath, originalSize);
        cleanup.rollout_truncated = true;
      } catch (error) {
        cleanup.error = error.message;
      }
      if (cleanup.rollout_truncated) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs }).catch(() => {});
        await waitForAppShell().catch(() => {});
      }
    }
    return details;
  }

  async function exerciseSavedProjectOpen() {
    const projectName = `UI smoke saved ${safeBridgeId(config.marker)}`;
    let savedProjectSnippet = "";
    let reopenedProjectSnippet = "";
    try {
      await closeTransientOverlays();
      if (!(await ensureSidebarVisible())) throw new Error("sidebar is not visible before saving project");
      if ((await clickNewChatIfVisible({ timeout: 5000 })).clicked) await findEditor();

      const projectButton = page.getByRole("button", { name: /项目|Projects/i }).first();
      await projectButton.click({ timeout: 5000 });
      const newBlankProject = page.getByRole("menuitem", { name: /新建空白项目|New blank project|New project/i }).first();
      await newBlankProject.waitFor({ state: "visible", timeout: 5000 });
      await newBlankProject.click();

      const projectNameBox = page.getByRole("textbox", { name: /项目名称|Project name/i }).first();
      await projectNameBox.waitFor({ state: "visible", timeout: 5000 });
      await projectNameBox.fill(projectName);
      await page.getByRole("button", { name: /保存|Save/i }).first().click({ timeout: 5000 });
      await page.getByText(projectName, { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
      await waitForMainText(new RegExp(escapeRegExp(projectName)), 10000).catch(() => {});
      savedProjectSnippet = await mainSnippet();

      const plugins = page.getByRole("button", { name: /插件|Plugins/i }).first();
      await plugins.click({ timeout: 5000 });
      await waitForMainText(/让 Codex 按你的方式工作|搜索插件|更多插件|work.*your way|Search plugins|More plugins/i, 10000);

      const savedProjectText = page.getByText(projectName, { exact: true }).first();
      await savedProjectText.waitFor({ state: "visible", timeout: 5000 });
      await savedProjectText.hover({ timeout: 5000 }).catch(() => {});
      const startProjectChat = page.getByRole("button", {
        name: new RegExp(`在 ${escapeRegExp(projectName)} 中开始新对话|Start.*${escapeRegExp(projectName)}|New chat.*${escapeRegExp(projectName)}`, "i"),
      }).first();
      await startProjectChat.waitFor({ state: "visible", timeout: 5000 });
      await startProjectChat.click({ timeout: 5000 });
      await waitForMainText(new RegExp(escapeRegExp(projectName)), 15000);
      reopenedProjectSnippet = await mainSnippet();

      const cleanup = await cleanupSavedUiSmokeProject(page, config.stateDir, projectName);
      await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForAppShell();
      const newChatAfterCleanup = await clickNewChatIfVisible({ timeout: 5000 });
      if (!newChatAfterCleanup.clicked) {
        throw new Error(`new chat button is not clickable after saved project cleanup; visible=${JSON.stringify(newChatAfterCleanup.visible_names || [])}`);
      }
      await findEditor();

      return {
        saved_project_name: projectName,
        saved_project_created: true,
        saved_project_reopened: true,
        saved_project_snippet: savedProjectSnippet,
        reopened_project_snippet: reopenedProjectSnippet,
        cleanup,
      };
    } catch (error) {
      const cleanup = await cleanupSavedUiSmokeProject(page, config.stateDir, projectName);
      error.message = `${error.message}; cleanup=${JSON.stringify(cleanup)}`;
      throw error;
    }
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
      await clickNewChatIfVisible({ timeout: 5000, settleMs: 1000 });
      await fillEditor(config.prompt);
      await page.keyboard.press("Enter");
      await page.waitForFunction((value) => {
        const main = document.querySelector("main") || document.body;
        const text = main?.innerText || "";
        return text.split(value).length - 1 >= 2;
      }, config.marker, { timeout: config.timeoutMs });
      const turnSettled = await waitForCurrentTurnSettled(Math.min(30000, config.timeoutMs));
      return { marker_occurrences: await markerCount(), turn_settled_before_completed_actions: turnSettled };
    });

    await recordStep("discover stop and retry controls", async () => {
      const controls = await visibleButtonNames(/^(停止|Stop|取消|Cancel|重试|Retry|重新生成|Regenerate|继续|Continue)$/i, { maxNameLength: 80, viewportOnly: true });
      return { controls };
    });

    await recordStep("exercise completed turn actions", exerciseCompletedTurnActions);

    await recordStep("reload preserves conversation", async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForAppShell();
      let reopenedFromSidebar = false;
      const mainHasMarker = await page.waitForFunction((value) => {
        const main = document.querySelector("main") || document.body;
        const text = main?.innerText || "";
        return text.includes(value);
      }, config.marker, { timeout: 3000 }).then(() => true).catch(() => false);
      if (!mainHasMarker) {
        await openSidebarThreadByMarker(config.marker);
        reopenedFromSidebar = true;
      }
      await waitForMainText(new RegExp(escapeRegExp(config.marker)), config.timeoutMs);
      return { marker_occurrences_after_reload: await markerCount(), reopened_from_sidebar_after_reload: reopenedFromSidebar };
    });

    await recordStep("inject and display generated image artifact", exerciseGeneratedImageArtifactDisplay);

    if (config.exerciseActiveControls) {
      await recordStep("actively interrupt and recover from a model turn", exerciseActiveInterruptAndRecover);
    }

    await recordStep("create, reopen, and clean up saved project", exerciseSavedProjectOpen);

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function queryThreadRecordForMarker(dbPath, markerValue) {
  if (!fs.existsSync(dbPath)) return null;
  const like = `%${String(markerValue)}%`;
  const sql = [
    "SELECT id, rollout_path, title, preview, first_user_message, updated_at_ms",
    "FROM threads",
    "WHERE title LIKE", sqlString(like),
    "OR preview LIKE", sqlString(like),
    "OR first_user_message LIKE", sqlString(like),
    "ORDER BY updated_at_ms DESC, id DESC",
    "LIMIT 1",
  ].join(" ");
  try {
    const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const rows = JSON.parse(output || "[]");
    return rows[0] || null;
  } catch {
    return null;
  }
}

function isPathWithin(candidate, root) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

async function cleanupSavedUiSmokeProject(page, stateDir, projectName) {
  const statePath = path.join(stateDir, "host-state.json");
  const workspaceRoot = path.resolve(stateDir, "browser-workspaces");
  const result = { attempted: false, removed_roots: [], state_file_updated: false, bridge_updated: false };
  if (!fs.existsSync(statePath)) return result;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    return { ...result, error: error.message };
  }
  if (!state || typeof state !== "object") return result;

  const labels = state["electron-workspace-root-labels"] && typeof state["electron-workspace-root-labels"] === "object"
    ? { ...state["electron-workspace-root-labels"] }
    : {};
  const rootsToRemove = Object.entries(labels)
    .filter(([root, label]) => label === projectName && path.resolve(root).startsWith(`${workspaceRoot}${path.sep}`))
    .map(([root]) => path.resolve(root));
  result.attempted = true;
  if (rootsToRemove.length === 0) return result;

  const removeSet = new Set(rootsToRemove);
  const remainingSavedRoots = Array.isArray(state["electron-saved-workspace-roots"])
    ? state["electron-saved-workspace-roots"].filter((root) => !removeSet.has(path.resolve(root)))
    : [];
  const remainingLabels = {};
  for (const [root, label] of Object.entries(labels)) {
    if (!removeSet.has(path.resolve(root))) remainingLabels[root] = label;
  }

  try {
    await page.evaluate(({ roots, labels: nextLabels }) => {
      window.electronBridge?.sendMessageFromView?.({
        type: "electron-update-workspace-root-options",
        roots,
        labels: nextLabels,
      });
    }, { roots: remainingSavedRoots, labels: remainingLabels });
    await page.waitForTimeout(500);
    result.bridge_updated = true;
  } catch (error) {
    result.bridge_error = error.message;
  }

  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    result.error = error.message;
    state = null;
  }
  if (!state || typeof state !== "object") return result;

  for (const key of ["active-workspace-roots", "electron-saved-workspace-roots"]) {
    if (Array.isArray(state[key])) {
      state[key] = state[key].filter((root) => !removeSet.has(path.resolve(root)));
    }
  }
  const currentLabels = state["electron-workspace-root-labels"] && typeof state["electron-workspace-root-labels"] === "object"
    ? { ...state["electron-workspace-root-labels"] }
    : {};
  for (const root of rootsToRemove) delete currentLabels[root];
  state["electron-workspace-root-labels"] = currentLabels;

  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  result.state_file_updated = true;

  for (const root of rootsToRemove) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      result.removed_roots.push(root);
    } catch (error) {
      result.error = error.message;
    }
  }
  return result;
}

function isBenignConsoleMessage(text) {
  return [
    /`DialogContent` requires a `DialogTitle`/,
    /Missing `Description` or `aria-describedby/,
  ].some((pattern) => pattern.test(String(text || "")));
}
