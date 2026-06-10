const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("swebench evaluator dry-run builds official harness command from prediction report", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swebench-evaluate-"));
  const datasetPath = path.join(tempDir, "tasks.jsonl");
  const predictionsPath = path.join(tempDir, "predictions.jsonl");
  const predictionReportPath = path.join(tempDir, "prediction-report.json");
  const scoreReportPath = path.join(tempDir, "score-report.json");
  const summaryMdPath = path.join(tempDir, "score-summary.md");

  fs.writeFileSync(datasetPath, `${JSON.stringify({
    instance_id: "demo__project-1",
    problem_statement: "Fix trim_value.",
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(predictionsPath, `${JSON.stringify({
    instance_id: "demo__project-1",
    model_name_or_path: "deepseek-v4-pro",
    model_patch: "diff --git a/parser.py b/parser.py\n--- a/parser.py\n+++ b/parser.py\n@@ -1 +1 @@\n-return value\n+return value.strip()\n",
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(predictionReportPath, JSON.stringify({
    kind: "swebench_prediction_report",
    model: "deepseek-v4-pro",
    dataset: {
      name: "SWE-bench/SWE-bench_Verified",
      split: "test",
      jsonl_path: datasetPath,
      selected_instance_ids: ["demo__project-1"],
    },
    artifacts: {
      predictions_path: predictionsPath,
    },
  }, null, 2), { mode: 0o600 });

  const result = spawnSync(process.execPath, [
    "scripts/swebench-evaluate.mjs",
    "--prediction-report", predictionReportPath,
    "--dry-run",
    "--output", scoreReportPath,
    "--summary-md", summaryMdPath,
    "--report-dir", path.join(tempDir, "harness"),
    "--max-instances", "1",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(scoreReportPath, "utf8"));
  assert.equal(report.kind, "swebench_score_report");
  assert.equal(report.dry_run, true);
  assert.equal(report.harness.status, "dry_run");
  assert.match(report.harness.command, /python3 -m swebench\.harness\.run_evaluation/);
  assert.match(report.harness.command, /--predictions_path/);
  assert.match(report.harness.command, /--dataset_name/);
  assert.match(report.harness.command, /--cache_level env/);
  assert.match(report.harness.command, /--clean True/);
  assert.match(report.harness.command, /--instance_ids demo__project-1/);
  assert.equal(report.predictions.total, 1);
  assert.equal(report.predictions.diff_like_patches, 1);
  assert.equal(report.predictions.empty_patches, 0);
  assert.equal(report.predictions.patch_sha256[0].chars > 0, true);
  assert.equal(report.preflight.selected_instance_count, 1);
  assert.equal(report.scoring.source, "not_available");

  const summary = fs.readFileSync(summaryMdPath, "utf8");
  assert.match(summary, /# SWE-bench Score Summary/);
  assert.match(summary, /Status: dry_run/);
  assert.doesNotMatch(summary, /return value\.strip/);
  assert.doesNotMatch(result.stdout, /return value\.strip/);
});
