#!/usr/bin/env node
/**
 * Release smoke tests:
 * - Pack current repo into a .tgz
 * - Install into a scratch git repo
 * - Validate kernel auto-download (rust) + forced rust run
 * - Validate JS fallback path works without downloads
 *
 * Env:
 * - SMOKE_TAG=vX.Y.Z (optional; informational in logs)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function bin(name) {
  // Let Node resolve platform-specific shims (e.g., npm.cmd/npx.cmd on Windows).
  return name;
}

function run(cmd, args, { cwd, env, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = {
    status: typeof res.status === 'number' ? res.status : 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error ? res.error.message : ''
  };
  if (!allowFail && out.status !== 0) {
    const msg = [
      `${cmd} ${args.join(' ')} failed (exit ${out.status})`,
      out.error ? `error:\n${out.error}` : null,
      out.stdout.trim() ? `stdout:\n${out.stdout.trim()}` : null,
      out.stderr.trim() ? `stderr:\n${out.stderr.trim()}` : null
    ].filter(Boolean).join('\n\n');
    throw new Error(msg);
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function findPackedTgz(packStdout) {
  const lines = String(packStdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tgz = [...lines].reverse().find(l => l.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack output did not include a .tgz filename:\n${packStdout}`);
  return tgz;
}

function ensureManualVerifyOk(repoDir) {
  const cfgPath = path.join(repoDir, '.ecc', 'ecc.json');
  const cfg = readJson(cfgPath);
  cfg.verify = { mode: 'manual', commands: [{ name: 'ok', command: 'node -e "process.exit(0)"' }] };
  writeJson(cfgPath, cfg);
}

function assertEvidence(repoDir, runId) {
  const runRoot = path.join(repoDir, '.ecc', 'runs', runId);
  const expected = [
    'run.json',
    'plan.json',
    'plan.md',
    path.join('apply', 'applied.json'),
    path.join('verify', 'summary.json'),
    'report.md'
  ];
  for (const rel of expected) {
    assert.ok(fs.existsSync(path.join(runRoot, rel)), `missing evidence: .ecc/runs/${runId}/${rel}`);
  }
}

function runDoctorAndAssertKernel(repoDir, env, { expect }) {
  const res = run(bin('npx'), ['ecc', 'doctor'], { cwd: repoDir, env, allowFail: true });
  const out = (res.stdout || '') + (res.stderr || '');
  if (expect === 'rust') {
    assert.ok(out.includes('kernel') && out.includes('rust ('), `doctor did not report rust kernel:\n${out}`);
    assert.ok(out.includes('protocol='), `doctor did not report protocol version:\n${out}`);
  } else if (expect === 'js') {
    assert.ok(out.includes('kernel') && out.includes('js fallback'), `doctor did not report js fallback:\n${out}`);
  } else {
    throw new Error(`unknown kernel expectation: ${expect}`);
  }
}

function retry(fn, { tries, delayMs, onRetry }) {
  function sleepMs(ms) {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, ms);
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= tries) break;
      if (onRetry) onRetry(attempt, err);
      sleepMs(delayMs);
    }
  }
  throw lastErr;
}

function createScratchRepo(baseDir, name) {
  const repoDir = path.join(baseDir, name);
  fs.mkdirSync(repoDir, { recursive: true });

  run(bin('npm'), ['init', '-y'], { cwd: repoDir });

  run('git', ['init'], { cwd: repoDir });
  run('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir });
  run('git', ['config', 'user.name', 'ECC'], { cwd: repoDir });
  run('git', ['add', 'package.json'], { cwd: repoDir });
  run('git', ['commit', '-m', 'init'], { cwd: repoDir });

  return repoDir;
}

function main() {
  const repoRoot = process.env.SMOKE_REPO_ROOT
    ? path.resolve(String(process.env.SMOKE_REPO_ROOT))
    : path.resolve(__dirname, '..', '..');
  const tag = process.env.SMOKE_TAG ? String(process.env.SMOKE_TAG).trim() : '';

  console.log('\n=== ECC Release Smoke ===\n');
  if (tag) console.log(`Tag: ${tag}`);
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}/${process.arch}`);

  const npmVer = run(bin('npm'), ['--version'], { cwd: repoRoot });
  console.log(`npm: ${npmVer.stdout.trim()}`);

  console.log('\nPacking repository...');
  const pack = run(bin('npm'), ['pack'], { cwd: repoRoot });
  const tgzName = findPackedTgz(pack.stdout);
  const tgzPath = path.join(repoRoot, tgzName);
  console.log(`Packed: ${tgzPath}`);

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-release-smoke-'));
  console.log(`Scratch: ${base}`);

  const commonEnv = {
    ...process.env,
    ECC_PROVIDER: 'mock',
    ECC_FIXTURE: 'basic'
  };
  if (process.env.GITHUB_TOKEN && !process.env.ECC_KERNEL_AUTH_TOKEN) {
    commonEnv.ECC_KERNEL_AUTH_TOKEN = process.env.GITHUB_TOKEN;
  }

  try {
    console.log('\nScenario A: default download + rust kernel run');
    const repoA = createScratchRepo(base, 'dogfood-rust');

    retry(() => {
      // Force download in CI (installer normally skips when CI=true).
      const envInstall = { ...commonEnv, ECC_KERNEL_INSTALL: 'required' };
      const res = run(bin('npm'), ['i', '-D', tgzPath], { cwd: repoA, env: envInstall, allowFail: true });
      if (res.status === 0) return;

      const out = (res.stdout || '') + (res.stderr || '');
      // Release assets can be slightly eventual-consistent right after publish.
      if (/HTTP\s+404\b/i.test(out) || /releases\/download\//i.test(out)) {
        throw new Error(`retryable install failure:\n${out}`);
      }
      throw new Error(`non-retryable install failure (exit ${res.status}):\n${out}`);
    }, {
      tries: 12,
      delayMs: 10_000,
      onRetry: (attempt, err) => console.log(`Install failed (attempt ${attempt}/12). Retrying... (${err.message.split('\n')[0]})`)
    });

    run(bin('npx'), ['ecc', 'init'], { cwd: repoA, env: commonEnv });
    ensureManualVerifyOk(repoA);
    runDoctorAndAssertKernel(repoA, commonEnv, { expect: 'rust' });

    const envRunRust = { ...commonEnv, ECC_KERNEL: 'rust' };
    run(bin('npx'), ['ecc', 'run', 'demo', '--run-id', 'smoke'], { cwd: repoA, env: envRunRust });
    assertEvidence(repoA, 'smoke');

    console.log('\nScenario B: install without download + JS fallback run');
    const repoB = createScratchRepo(base, 'dogfood-fallback');

    run(bin('npm'), ['i', '-D', tgzPath], { cwd: repoB, env: { ...commonEnv, ECC_KERNEL_INSTALL: '0' } });
    run(bin('npx'), ['ecc', 'init'], { cwd: repoB, env: commonEnv });
    ensureManualVerifyOk(repoB);
    runDoctorAndAssertKernel(repoB, commonEnv, { expect: 'js' });

    const envRunJs = { ...commonEnv, ECC_KERNEL: 'node' };
    run(bin('npx'), ['ecc', 'run', 'demo', '--run-id', 'smoke-fallback'], { cwd: repoB, env: envRunJs });
    assertEvidence(repoB, 'smoke-fallback');

    console.log('\nSmoke OK');
  } finally {
    try { fs.rmSync(tgzPath, { force: true }); } catch (_err) { /* ignore */ }
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
  }
}

main();
