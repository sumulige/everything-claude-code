#!/usr/bin/env node
/**
 * ECC (Engineering Change Conveyor) - Codex-first engineering delivery engine.
 *
 * P0 goals:
 * - Patch-only code sovereignty (providers output JSON/patch only; engine applies)
 * - External worktree isolation for exec/verify
 * - Evidence chain on disk under .ecc/runs/<runId>/
 *
 * Dependency-free by design.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureDir } = require('./lib/utils');

const catalog = require('./ecc/catalog');
const configMod = require('./ecc/config');
const lockMod = require('./ecc/lock');
const project = require('./ecc/project');
const runMod = require('./ecc/run');
const idMod = require('./ecc/id');
const planMod = require('./ecc/plan');
const execMod = require('./ecc/exec');
const verifyMod = require('./ecc/verify');
const reportMod = require('./ecc/report');
const git = require('./ecc/git');
const { readJson } = require('./ecc/json');
const { validateLock, throwIfErrors } = require('./ecc/validate');
const { getProvider } = require('./ecc/providers');
const kernel = require('./ecc/kernel');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
        continue;
      }
      args[key] = next;
      i++;
      continue;
    }
    args._.push(a);
  }
  return args;
}

function usage(exitCode = 0) {
  // eslint-disable-next-line no-console
  console.log(`
ecc (Engineering Change Conveyor)

Usage:
  ecc <command> [args...]
  node scripts/ecc.js <command> [args...]   # fallback if not installed

Commands (P0):
  packs
  init [--backend codex|claude] [--packs a,b,c]
  doctor
  plan   "<intent>" [--run-id <id>]
  exec   <runId> [--commit] [--worktree-root <path>] [--keep-worktree]
  verify <runId> [--worktree-root <path>]
  run    "<intent>" [--commit] [--run-id <id>] [--worktree-root <path>] [--keep-worktree]

Environment:
  ECC_PROVIDER=mock|codex    Override provider selection (tests use mock)
  ECC_FIXTURE=basic|unauthorized (mock provider fixtures)
`.trim());
  process.exit(exitCode);
}

function resolveProjectRoot(cwd) {
  try {
    return git.getRepoRoot(cwd) || cwd;
  } catch (_err) {
    return cwd;
  }
}

function ensureEccGitignore(projectRoot) {
  const content = [
    '# ECC runtime artifacts (do not commit)',
    'runs/',
    'cache/',
    'tmp/',
    ''
  ].join('\n');
  ensureDir(project.eccDir(projectRoot));
  fs.writeFileSync(project.gitignorePath(projectRoot), content, 'utf8');
}

function listPacks() {
  const packs = catalog.loadPacks();
  if (!packs.length) {
    // eslint-disable-next-line no-console
    console.log('No packs found.');
    return;
  }

  // eslint-disable-next-line no-console
  console.log('Packs\n=====\n');
  for (const p of packs) {
    const tags = p.tags.length ? ` [${p.tags.join(', ')}]` : '';
    // eslint-disable-next-line no-console
    console.log(`- ${p.id}: ${p.name}${tags}\n  ${p.description}`);
  }
}

function parsePacksArg(arg) {
  if (!arg) return null;
  return String(arg)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function validateSelectedPacks(selected) {
  const known = new Set(catalog.loadPacks().map(p => p.id));
  const unknown = selected.filter(p => !known.has(p));
  if (unknown.length) throw new Error(`Unknown packs: ${unknown.join(', ')}`);
}

function cmdInit(args) {
  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);

  const backend = args.backend ? String(args.backend) : 'codex';
  if (!['codex', 'claude'].includes(backend)) {
    throw new Error('init: --backend must be "codex" or "claude"');
  }

  const packsArg = parsePacksArg(args.packs);
  const selected = packsArg && packsArg.length ? packsArg : catalog.getDefaultPacks();
  validateSelectedPacks(selected);

  let cfg = configMod.loadConfig(projectRoot);
  const cfgPath = project.configPath(projectRoot);
  const existed = !!cfg;
  if (!cfg) {
    cfg = configMod.createConfig({ backend, packs: selected });
    configMod.saveConfig(projectRoot, cfg);
  }

  ensureEccGitignore(projectRoot);
  ensureDir(project.locksDir(projectRoot));
  lockMod.writeRegistryLock(projectRoot, { packs: cfg.packs, overwrite: false });

  // eslint-disable-next-line no-console
  console.log(`${existed ? 'Already initialized' : 'Initialized'} ECC: ${path.relative(projectRoot, cfgPath)}`);
  // eslint-disable-next-line no-console
  console.log(`Backend: ${cfg.backend}`);
  // eslint-disable-next-line no-console
  console.log(`Packs:   ${cfg.packs.join(', ')}`);
}

function runCmd(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trimEnd(),
    stderr: (res.stderr || '').trimEnd()
  };
}

function cmdDoctor() {
  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const checks = [];

  checks.push({ name: 'node', ok: true, detail: process.version });

  try {
    const k = kernel.getKernel();
    const detail = k.enabled ? `rust (${k.bin})` : 'js fallback';
    checks.push({ name: 'kernel', ok: true, detail });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    checks.push({ name: 'kernel', ok: false, detail: msg });
  }

  const gitVer = runCmd('git', ['--version']);
  checks.push({ name: 'git', ok: gitVer.ok, detail: gitVer.ok ? gitVer.stdout : gitVer.stderr });

  const repoRoot = gitVer.ok ? git.getRepoRoot(projectRoot) : null;
  checks.push({ name: 'repo', ok: !!repoRoot, detail: repoRoot ? repoRoot : 'not a git repo' });

  if (repoRoot) {
    let clean = false;
    let detail = '';
    try {
      clean = git.isClean(repoRoot);
      detail = clean ? 'clean' : 'dirty';
    } catch (err) {
      clean = false;
      detail = err && err.message ? err.message : String(err);
    }
    checks.push({ name: 'clean', ok: clean, detail });
  }

  const codex = runCmd('codex', ['--version']);
  checks.push({ name: 'codex', ok: codex.ok, detail: codex.ok ? codex.stdout : codex.stderr });

  const claude = runCmd('claude', ['--version']);
  checks.push({ name: 'claude', ok: claude.ok, detail: claude.ok ? claude.stdout : claude.stderr });

  const cfg = configMod.loadConfig(projectRoot);
  checks.push({
    name: 'ecc',
    ok: !!cfg,
    detail: cfg ? `initialized (${path.relative(projectRoot, project.configPath(projectRoot))})` : 'not initialized'
  });

  if (cfg) {
    try {
      validateSelectedPacks(cfg.packs);
      checks.push({ name: 'packs', ok: true, detail: cfg.packs.join(', ') });
    } catch (err) {
      checks.push({ name: 'packs', ok: false, detail: err.message });
    }
  }

  const lockPath = project.registryLockPath(projectRoot);
  if (fs.existsSync(lockPath)) {
    try {
      const lock = readJson(lockPath);
      throwIfErrors(validateLock(lock), 'registry lock');
      checks.push({ name: 'lock', ok: true, detail: path.relative(projectRoot, lockPath) });
    } catch (err) {
      checks.push({ name: 'lock', ok: false, detail: err.message });
    }
  } else {
    checks.push({ name: 'lock', ok: false, detail: `missing (${path.relative(projectRoot, lockPath)})` });
  }

  // eslint-disable-next-line no-console
  console.log('ECC Doctor\n==========\n');
  for (const c of checks) {
    const mark = c.ok ? 'OK ' : 'BAD';
    // eslint-disable-next-line no-console
    console.log(`${mark}  ${c.name.padEnd(8)}  ${c.detail}`);
  }

  const failed = checks.filter(c => !c.ok);
  if (failed.length) process.exit(1);
}

async function cmdPlan(args) {
  const intent = args._[1];
  if (!intent) throw new Error('plan: missing <intent>');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);

  const cfg = configMod.loadConfig(projectRoot);
  if (!cfg) throw new Error('ECC is not initialized (run: ecc init)');

  const requestedRunId = args['run-id'] ? String(args['run-id']) : null;
  const runIdBase = requestedRunId || idMod.defaultRunId(intent);
  const runId = requestedRunId ? idMod.ensureUniqueRunId(projectRoot, requestedRunId) : idMod.ensureUniqueRunId(projectRoot, runIdBase);

  const repoRoot = git.getRepoRoot(projectRoot);
  const base = repoRoot
    ? { repoRoot, branch: git.getCurrentBranch(repoRoot), sha: git.getHeadSha(repoRoot) }
    : { repoRoot: projectRoot, branch: '', sha: '' };

  const { run } = runMod.initRun({
    projectRoot,
    runId,
    intent,
    backend: cfg.backend,
    packs: cfg.packs,
    base
  });

  const provider = getProvider({ backend: cfg.backend });
  await planMod.generatePlan({ projectRoot, run, provider });
  reportMod.writeReport({ projectRoot, runId });

  // eslint-disable-next-line no-console
  console.log(`Planned runId: ${runId}`);
  // eslint-disable-next-line no-console
  console.log(`Artifacts: ${path.relative(projectRoot, runMod.runPaths(projectRoot, runId).root)}`);
}

async function cmdExec(args) {
  const runId = args._[1];
  if (!runId) throw new Error('exec: missing <runId>');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);

  const cfg = configMod.loadConfig(projectRoot);
  if (!cfg) throw new Error('ECC is not initialized (run: ecc init)');

  const provider = getProvider({ backend: cfg.backend });
  const worktreeRoot = args['worktree-root'] ? path.resolve(String(args['worktree-root'])) : null;
  const keepWorktree = !!args['keep-worktree'];
  const commit = !!args.commit;

  let execResult;
  try {
    execResult = await execMod.execRun({ projectRoot, runId, provider, worktreeRoot });
  } catch (err) {
    const run = runMod.loadRun(projectRoot, runId);
    if (run) runMod.saveRun(projectRoot, runId, runMod.markRunEnded(run, 'failed'));
    reportMod.writeReport({ projectRoot, runId });
    throw err;
  }

  const { worktreePath, applyResult, repoRoot } = execResult;

  // eslint-disable-next-line no-console
  console.log(`Worktree: ${worktreePath}`);

  if (commit) {
    const run = runMod.loadRun(projectRoot, runId);
    if (!run) throw new Error(`unknown runId: ${runId}`);

    run.status = 'verifying';
    runMod.saveRun(projectRoot, runId, run);

    const summary = verifyMod.runVerify({
      worktreePath,
      verifyConfig: cfg.verify,
      outDir: runMod.runPaths(projectRoot, runId).verifyDir
    });

    if (!summary.ok) {
      runMod.saveRun(projectRoot, runId, runMod.markRunEnded(run, 'failed'));
      reportMod.writeReport({ projectRoot, runId });
      process.exit(1);
    }

    const sha = git.commitAll({ repoRoot: worktreePath, message: `ecc: ${runId}` });
    applyResult.commit = { sha, message: `ecc: ${runId}` };
    throwIfErrors(require('./ecc/validate').validateApplyResult(applyResult), 'apply result');
    require('./ecc/json').writeJson(runMod.runPaths(projectRoot, runId).applyJson, applyResult);

    runMod.saveRun(projectRoot, runId, runMod.markRunEnded(run, 'succeeded'));

    if (!keepWorktree) {
      try {
        git.removeWorktree({ repoRoot, worktreePath });
        run.worktree.path = '';
        runMod.saveRun(projectRoot, runId, run);
      } catch (_err) {
        // ignore cleanup failures
      }
    }
  }

  reportMod.writeReport({ projectRoot, runId });
}

function cmdVerify(args) {
  const runId = args._[1];
  if (!runId) throw new Error('verify: missing <runId>');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);
  const worktreeRoot = args['worktree-root'] ? path.resolve(String(args['worktree-root'])) : null;

  const cfg = configMod.loadConfig(projectRoot);
  if (!cfg) throw new Error('ECC is not initialized (run: ecc init)');

  const run = runMod.loadRun(projectRoot, runId);
  if (!run) throw new Error(`unknown runId: ${runId}`);

  if (!run.worktree.path || !fs.existsSync(run.worktree.path)) {
    const applyPath = runMod.runPaths(projectRoot, runId).applyJson;
    const apply = fs.existsSync(applyPath) ? readJson(applyPath) : null;
    const hasCommit = !!(apply && apply.commit && apply.commit.sha);
    if (!hasCommit) {
      throw new Error(
        'verify: missing worktree and changes were not committed. Re-run: ecc exec <runId> (or use --commit to persist changes).'
      );
    }

    const repoRoot = git.getRepoRoot(projectRoot);
    if (!repoRoot) throw new Error('verify: requires a git repository');

    const wt = git.ensureWorktree({
      repoRoot,
      worktreePath: git.defaultWorktreePath({ repoRoot, runId, worktreeRoot }),
      branch: run.worktree.branch,
      baseSha: run.base.sha || git.getHeadSha(repoRoot)
    });
    run.worktree.path = wt;
    runMod.saveRun(projectRoot, runId, run);
  }

  run.status = 'verifying';
  runMod.saveRun(projectRoot, runId, run);

  const summary = verifyMod.runVerify({
    worktreePath: run.worktree.path,
    verifyConfig: cfg.verify,
    outDir: runMod.runPaths(projectRoot, runId).verifyDir
  });

  if (!summary.ok) {
    runMod.saveRun(projectRoot, runId, runMod.markRunEnded(run, 'failed'));
    reportMod.writeReport({ projectRoot, runId });
    process.exit(1);
  }

  runMod.saveRun(projectRoot, runId, runMod.markRunEnded(run, 'succeeded'));
  reportMod.writeReport({ projectRoot, runId });
}

async function cmdRun(args) {
  const intent = args._[1];
  if (!intent) throw new Error('run: missing <intent>');

  const cwd = process.cwd();
  const projectRoot = resolveProjectRoot(cwd);

  const cfg = configMod.loadConfig(projectRoot);
  if (!cfg) throw new Error('ECC is not initialized (run: ecc init)');

  const requestedRunId = args['run-id'] ? String(args['run-id']) : null;
  const runIdBase = requestedRunId || idMod.defaultRunId(intent);
  const runId = requestedRunId ? idMod.ensureUniqueRunId(projectRoot, requestedRunId) : idMod.ensureUniqueRunId(projectRoot, runIdBase);

  const repoRoot = git.getRepoRoot(projectRoot);
  const base = repoRoot
    ? { repoRoot, branch: git.getCurrentBranch(repoRoot), sha: git.getHeadSha(repoRoot) }
    : { repoRoot: projectRoot, branch: '', sha: '' };

  const { run } = runMod.initRun({
    projectRoot,
    runId,
    intent,
    backend: cfg.backend,
    packs: cfg.packs,
    base
  });

  const provider = getProvider({ backend: cfg.backend });
  await planMod.generatePlan({ projectRoot, run, provider });
  reportMod.writeReport({ projectRoot, runId });

  const worktreeRoot = args['worktree-root'] ? path.resolve(String(args['worktree-root'])) : null;
  const keepWorktree = !!args['keep-worktree'];
  const commit = !!args.commit;

  let execResult;
  try {
    execResult = await execMod.execRun({ projectRoot, runId, provider, worktreeRoot });
  } catch (err) {
    const loaded = runMod.loadRun(projectRoot, runId);
    if (loaded) runMod.saveRun(projectRoot, runId, runMod.markRunEnded(loaded, 'failed'));
    reportMod.writeReport({ projectRoot, runId });
    throw err;
  }

  {
    const loaded = runMod.loadRun(projectRoot, runId);
    if (loaded) {
      loaded.status = 'verifying';
      runMod.saveRun(projectRoot, runId, loaded);
    }
  }

  const summary = verifyMod.runVerify({
    worktreePath: execResult.worktreePath,
    verifyConfig: cfg.verify,
    outDir: runMod.runPaths(projectRoot, runId).verifyDir
  });

  if (!summary.ok) {
    const loaded = runMod.loadRun(projectRoot, runId);
    if (loaded) runMod.saveRun(projectRoot, runId, runMod.markRunEnded(loaded, 'failed'));
    reportMod.writeReport({ projectRoot, runId });
    process.exit(1);
  }

  if (commit) {
    const sha = git.commitAll({ repoRoot: execResult.worktreePath, message: `ecc: ${runId}` });
    execResult.applyResult.commit = { sha, message: `ecc: ${runId}` };
    require('./ecc/json').writeJson(runMod.runPaths(projectRoot, runId).applyJson, execResult.applyResult);
  }

  const loaded = runMod.loadRun(projectRoot, runId);
  if (loaded) runMod.saveRun(projectRoot, runId, runMod.markRunEnded(loaded, 'succeeded'));
  reportMod.writeReport({ projectRoot, runId });

  // eslint-disable-next-line no-console
  console.log(`RunId: ${runId}`);
  // eslint-disable-next-line no-console
  console.log(`Worktree: ${execResult.worktreePath}`);

  if (commit && !keepWorktree) {
    try {
      git.removeWorktree({ repoRoot: execResult.repoRoot, worktreePath: execResult.worktreePath });
      const loaded2 = runMod.loadRun(projectRoot, runId);
      if (loaded2) {
        loaded2.worktree.path = '';
        runMod.saveRun(projectRoot, runId, loaded2);
      }
    } catch (_err) {
      // ignore cleanup failures
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) usage(0);

  const cmd = args._[0];
  if (!cmd) usage(1);

  if (cmd === 'packs') return listPacks();
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'doctor') return cmdDoctor();
  if (cmd === 'plan') return cmdPlan(args);
  if (cmd === 'exec') return cmdExec(args);
  if (cmd === 'verify') return cmdVerify(args);
  if (cmd === 'run') return cmdRun(args);

  usage(1);
}

main().catch(err => {
  const msg = err && err.message ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`ERROR: ${msg}`);
  process.exit(1);
});
