const fs = require('fs');
const path = require('path');

const { readJson, writeJson } = require('./json');
const { runPaths, loadRun, saveRun } = require('./run');
const git = require('./git');
const diff = require('./diff');
const { validateApplyResult, throwIfErrors } = require('./validate');

function nowIso() {
  return new Date().toISOString();
}

function topoSortTasks(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set();
  const visiting = new Set();
  const out = [];

  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`cycle detected at task "${id}"`);
    visiting.add(id);
    const t = byId.get(id);
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const dep of deps) visit(dep);
    visiting.delete(id);
    visited.add(id);
    out.push(t);
  }

  for (const t of tasks) visit(t.id);
  return out;
}

async function execRun({ projectRoot, runId, provider, worktreeRoot }) {
  const run = loadRun(projectRoot, runId);
  if (!run) throw new Error(`unknown runId: ${runId}`);

  const paths = runPaths(projectRoot, runId);
  if (!fs.existsSync(paths.planJson)) throw new Error(`missing plan.json (run ecc plan first): ${paths.planJson}`);
  const plan = readJson(paths.planJson);

  const repoRoot = git.getRepoRoot(projectRoot);
  if (!repoRoot) throw new Error('ecc exec requires a git repository');

  const baseSha = run.base && run.base.sha ? run.base.sha : git.getHeadSha(repoRoot);
  const branch = run.worktree && run.worktree.branch ? run.worktree.branch : `ecc/${runId}`;

  const desiredWorktreePath =
    run.worktree && run.worktree.path && fs.existsSync(run.worktree.path)
      ? run.worktree.path
      : git.defaultWorktreePath({ repoRoot, runId, worktreeRoot });

  const worktreePath = git.ensureWorktree({
    repoRoot,
    worktreePath: desiredWorktreePath,
    branch,
    baseSha
  });

  run.status = 'executing';
  run.worktree.path = worktreePath;
  run.worktree.branch = branch;
  saveRun(projectRoot, runId, run);

  const ordered = topoSortTasks(plan.tasks);

  const applyResult = {
    version: 1,
    appliedAt: nowIso(),
    baseSha,
    tasks: []
  };

  for (const task of ordered) {
    const patchOut = await provider.generatePatch({ task, repoRoot: worktreePath, packs: run.packs });
    const patch = patchOut && typeof patchOut.patch === 'string' ? patchOut.patch : null;
    const patchPath = path.join(paths.patchesDir, `${task.id}.diff`);

    if (patch === null) {
      applyResult.tasks.push({ id: task.id, patchPath, ok: false, error: 'provider returned non-string patch' });
      writeJson(paths.applyJson, applyResult);
      throw new Error(`provider returned non-string patch for task: ${task.id}`);
    }

    fs.writeFileSync(patchPath, patch.endsWith('\n') ? patch : patch + '\n', 'utf8');

    try {
      diff.applyPatch({ worktreePath, patchPath, allowedPathPrefixes: task.allowedPathPrefixes });
      applyResult.tasks.push({ id: task.id, patchPath, ok: true });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      applyResult.tasks.push({ id: task.id, patchPath, ok: false, error: msg });
      writeJson(paths.applyJson, applyResult);
      throw err;
    }
  }

  throwIfErrors(validateApplyResult(applyResult), 'apply result');
  writeJson(paths.applyJson, applyResult);

  return { worktreePath, applyResult, run, plan, paths, repoRoot };
}

module.exports = {
  execRun
};

