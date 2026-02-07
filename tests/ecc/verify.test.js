/**
 * Tests for ecc verify (manual mode)
 *
 * Run with: node tests/ecc/verify.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function git(cwd, args) {
  const res = run('git', args, { cwd });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
}

function initTempGitRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-verify-'));
  const repo = path.join(base, 'repo');
  const worktrees = path.join(base, 'worktrees');
  fs.mkdirSync(repo, { recursive: true });

  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'ecc@example.com']);
  git(repo, ['config', 'user.name', 'ECC']);

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'base.txt'), 'base\n', 'utf8');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init']);

  return { base, repo, worktrees };
}

function setManualVerify(repo, commands) {
  const cfgPath = path.join(repo, '.ecc', 'ecc.json');
  const cfg = readJson(cfgPath);
  cfg.verify = { mode: 'manual', commands };
  writeJson(cfgPath, cfg);
}

function runTests() {
  console.log('\n=== Testing ecc verify ===\n');

  let passed = 0;
  let failed = 0;

  const engineRoot = path.resolve(__dirname, '..', '..');
  const eccScript = path.join(engineRoot, 'scripts', 'ecc.js');

  if (test('verify succeeds with manual ok command', () => {
    const { base, repo, worktrees } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'basic' };

      assert.strictEqual(run('node', [eccScript, 'init'], { cwd: repo, env }).status, 0);
      setManualVerify(repo, [{ name: 'ok', command: 'node -e "process.exit(0)"' }]);

      const runId = 'verify-ok';
      assert.strictEqual(run('node', [eccScript, 'plan', 'demo', '--run-id', runId], { cwd: repo, env }).status, 0);
      assert.strictEqual(run('node', [eccScript, 'exec', runId, '--worktree-root', worktrees], { cwd: repo, env }).status, 0);

      const verRes = run('node', [eccScript, 'verify', runId], { cwd: repo, env });
      assert.strictEqual(verRes.status, 0, verRes.stderr);

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      const summary = readJson(path.join(runRoot, 'verify', 'summary.json'));
      assert.strictEqual(summary.ok, true);
      assert.strictEqual(summary.commands.length, 1);
      assert.ok(fs.existsSync(path.join(runRoot, 'verify', 'ok.txt')));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('verify fails with manual failing command (exit code non-zero)', () => {
    const { base, repo, worktrees } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'basic' };

      assert.strictEqual(run('node', [eccScript, 'init'], { cwd: repo, env }).status, 0);
      setManualVerify(repo, [{ name: 'fail', command: 'node -e "process.exit(1)"' }]);

      const runId = 'verify-fail';
      assert.strictEqual(run('node', [eccScript, 'plan', 'demo', '--run-id', runId], { cwd: repo, env }).status, 0);
      assert.strictEqual(run('node', [eccScript, 'exec', runId, '--worktree-root', worktrees], { cwd: repo, env }).status, 0);

      const verRes = run('node', [eccScript, 'verify', runId], { cwd: repo, env });
      assert.notStrictEqual(verRes.status, 0);

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      const summary = readJson(path.join(runRoot, 'verify', 'summary.json'));
      assert.strictEqual(summary.ok, false);
      assert.strictEqual(summary.commands[0].exitCode, 1);
      assert.ok(fs.existsSync(path.join(runRoot, 'verify', 'fail.txt')));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

