"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "..", "scripts", "prune-runtime-state.mjs");

test("runtime prune script dry-runs then applies bounded artifact cleanup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-prune-"));
  try {
    const old = Date.now() - 3 * 60 * 60 * 1000;
    const fresh = Date.now();
    const screenshotDir = path.join(root, "output", "playwright");
    const cliDir = path.join(root, ".playwright-cli");
    const stateDir = path.join(root, "state", "responses-bridge");
    const fileSearchDir = path.join(stateDir, "local-file-search");
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(fileSearchDir, { recursive: true });

    const oldScreenshot = writeFileWithMtime(path.join(screenshotDir, "old.png"), "old", old);
    const freshScreenshot = writeFileWithMtime(path.join(screenshotDir, "fresh.png"), "fresh", fresh);
    const oldCli = writeFileWithMtime(path.join(cliDir, "old.yml"), "old", old);
    const freshCli = writeFileWithMtime(path.join(cliDir, "fresh.yml"), "fresh", fresh);
    const oldResponse = writeFileWithMtime(path.join(stateDir, "old.json"), "{}", old);
    const freshResponse = writeFileWithMtime(path.join(stateDir, "fresh.json"), "{}", fresh);
    const durableFileSearch = writeFileWithMtime(path.join(fileSearchDir, "keep.json"), "{}", old);

    const dryRun = runPrune(root, ["--max-age-hours", "1", "--max-files", "1"]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunReport = JSON.parse(dryRun.stdout);
    assert.equal(dryRunReport.dry_run, true);
    assert.equal(dryRunReport.summary.selected, 3);
    assert.equal(fs.existsSync(oldScreenshot), true);
    assert.equal(fs.existsSync(oldCli), true);
    assert.equal(fs.existsSync(oldResponse), true);

    const applied = runPrune(root, ["--apply", "--max-age-hours", "1", "--max-files", "1"]);
    assert.equal(applied.status, 0, applied.stderr);
    const appliedReport = JSON.parse(applied.stdout);
    assert.equal(appliedReport.dry_run, false);
    assert.equal(appliedReport.summary.deleted, 3);
    assert.equal(fs.existsSync(oldScreenshot), false);
    assert.equal(fs.existsSync(oldCli), false);
    assert.equal(fs.existsSync(oldResponse), false);
    assert.equal(fs.existsSync(freshScreenshot), true);
    assert.equal(fs.existsSync(freshCli), true);
    assert.equal(fs.existsSync(freshResponse), true);
    assert.equal(fs.existsSync(durableFileSearch), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeFileWithMtime(filePath, content, mtimeMs) {
  fs.writeFileSync(filePath, content);
  const date = new Date(mtimeMs);
  fs.utimesSync(filePath, date, date);
  return filePath;
}

function runPrune(root, extraArgs) {
  return spawnSync(process.execPath, [scriptPath, "--root", root, ...extraArgs], {
    encoding: "utf8",
  });
}
