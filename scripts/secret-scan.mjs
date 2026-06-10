#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const patterns = [
  "sk-[A-Za-z0-9_-]{20,}",
  "ghp_[A-Za-z0-9_]{20,}",
  "github_pat_[A-Za-z0-9_]{40,}",
  "(?i)(api[_-]?key|secret|password|token)\\s*[:=]\\s*[\"'][A-Za-z0-9_./+=-]{32,}[\"']",
  "^[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)\\s*=\\s*[A-Za-z0-9_./+=-]{32,}",
];

const args = [
  "--hidden",
  "--no-ignore",
  "--glob", "!node_modules/**",
  "--glob", "!state/**",
  "--glob", "!output/**",
  "--glob", "!.git/**",
  "--glob", "!.playwright-cli/**",
  "-n",
  "-e",
  patterns.join("|"),
  ".",
];

if (!existsSync(".gitignore")) {
  console.error("Run this script from the repository root.");
  process.exit(2);
}

const result = spawnSync("rg", args, { stdio: "inherit" });
if (result.status === 0) {
  console.error("Potential secret material found. Remove it or add a documented false-positive suppression.");
  process.exit(1);
}
if (result.status === 1) process.exit(0);
process.exit(result.status ?? 2);
