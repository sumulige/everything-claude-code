const fs = require('fs');
const path = require('path');

const { writeJson, readJson, writeText } = require('./json');
const { runsDir } = require('./project');
const { validateRun, throwIfErrors } = require('./validate');

function nowIso() {
  return new Date().toISOString();
}

function runRoot(projectRoot, runId) {
  return path.join(runsDir(projectRoot), runId);
}

function runPaths(projectRoot, runId) {
  const root = runRoot(projectRoot, runId);
  return {
    root,
    intentTxt: path.join(root, 'intent.txt'),
    runJson: path.join(root, 'run.json'),
    planJson: path.join(root, 'plan.json'),
    planMd: path.join(root, 'plan.md'),
    patchesDir: path.join(root, 'patches'),
    applyDir: path.join(root, 'apply'),
    applyJson: path.join(root, 'apply', 'applied.json'),
    verifyDir: path.join(root, 'verify'),
    verifySummaryJson: path.join(root, 'verify', 'summary.json'),
    reportMd: path.join(root, 'report.md')
  };
}

function initRun({ projectRoot, runId, intent, backend, packs, base }) {
  const paths = runPaths(projectRoot, runId);

  if (fs.existsSync(paths.runJson)) {
    throw new Error(`Run already exists: ${runId}`);
  }

  fs.mkdirSync(paths.root, { recursive: true });
  fs.mkdirSync(paths.patchesDir, { recursive: true });
  fs.mkdirSync(paths.applyDir, { recursive: true });
  fs.mkdirSync(paths.verifyDir, { recursive: true });

  writeText(paths.intentTxt, intent + '\n');

  const run = {
    version: 1,
    runId,
    intent,
    backend,
    packs,
    status: 'planned',
    base: {
      repoRoot: base.repoRoot,
      branch: base.branch,
      sha: base.sha
    },
    worktree: {
      path: '',
      branch: `ecc/${runId}`
    },
    artifacts: {
      planJson: paths.planJson,
      planMd: paths.planMd,
      patchesDir: paths.patchesDir,
      applyJson: paths.applyJson,
      verifyDir: paths.verifyDir,
      reportMd: paths.reportMd
    },
    startedAt: nowIso()
  };

  throwIfErrors(validateRun(run), 'run');
  writeJson(paths.runJson, run);
  return { run, paths };
}

function loadRun(projectRoot, runId) {
  const p = runPaths(projectRoot, runId).runJson;
  if (!fs.existsSync(p)) return null;
  const run = readJson(p);
  throwIfErrors(validateRun(run), 'run');
  return run;
}

function saveRun(projectRoot, runId, run) {
  throwIfErrors(validateRun(run), 'run');
  writeJson(runPaths(projectRoot, runId).runJson, run);
}

function markRunEnded(run, status) {
  run.status = status;
  run.endedAt = nowIso();
  return run;
}

module.exports = {
  runPaths,
  initRun,
  loadRun,
  saveRun,
  markRunEnded
};

