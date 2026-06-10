const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("swebench runner dry-run writes compact report and official predictions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swebench-runner-"));
  const datasetPath = path.join(tempDir, "tasks.jsonl");
  const reportPath = path.join(tempDir, "report.json");
  const predictionsPath = path.join(tempDir, "predictions.jsonl");
  const record = {
    instance_id: "demo__project-1",
    repo: "demo/project",
    base_commit: "0123456789abcdef0123456789abcdef01234567",
    problem_statement: "Fix parse_value so it trims whitespace.",
    hints_text: "The function lives in parser.py.",
    patch: "gold patch must not appear in the report",
    test_patch: "gold test patch must not appear in the report",
    FAIL_TO_PASS: ["tests/test_parser.py::test_trim"],
    PASS_TO_PASS: ["tests/test_parser.py::test_existing"],
  };
  fs.writeFileSync(datasetPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

  const result = spawnSync(process.execPath, [
    "scripts/swebench-runner.mjs",
    "--dataset-jsonl", datasetPath,
    "--limit", "1",
    "--dry-run",
    "--output", reportPath,
    "--predictions", predictionsPath,
    "--run-id", "unit-test-run",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.kind, "swebench_prediction_report");
  assert.equal(report.dry_run, true);
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.predictions_written, 1);
  assert.equal(report.summary.empty_patches, 1);
  assert.equal(report.results[0].instance_id, record.instance_id);
  assert.equal(report.results[0].metadata.gold_patch_present, true);
  assert.equal(report.results[0].metadata.test_patch_present, true);
  assert.equal(report.results[0].metadata.fail_to_pass_count, 1);
  assert.equal(report.results[0].metadata.pass_to_pass_count, 1);
  assert.match(report.official_evaluation.command, /swebench\.harness\.run_evaluation/);
  assert.match(report.official_evaluation.command, /--instance_ids demo__project-1/);
  assert.doesNotMatch(result.stdout, /gold patch must not appear/);
  assert.doesNotMatch(result.stdout, /gold test patch must not appear/);

  const prediction = JSON.parse(fs.readFileSync(predictionsPath, "utf8").trim());
  assert.deepEqual(prediction, {
    instance_id: record.instance_id,
    model_name_or_path: "deepseek-v4-pro",
    model_patch: "",
  });
});
