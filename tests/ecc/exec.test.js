/**
 * Tests for ecc exec (mock provider)
 *
 * Run with: node tests/ecc/exec.test.js
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

function git(cwd, args) {
  const res = run('git', args, { cwd });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
}

function initTempGitRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-exec-'));
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

function runTests() {
  console.log('\n=== Testing ecc exec ===\n');

  let passed = 0;
  let failed = 0;

  const engineRoot = path.resolve(__dirname, '..', '..');
  const eccScript = path.join(engineRoot, 'scripts', 'ecc.js');

  if (test('exec applies patches in external worktree (mock basic)', () => {
    const { base, repo, worktrees } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'basic' };

      assert.strictEqual(run('node', [eccScript, 'init'], { cwd: repo, env }).status, 0);
      const runId = 'demo-exec';
      assert.strictEqual(run('node', [eccScript, 'plan', 'demo', '--run-id', runId], { cwd: repo, env }).status, 0);

      const execRes = run('node', [eccScript, 'exec', runId, '--worktree-root', worktrees], { cwd: repo, env });
      assert.strictEqual(execRes.status, 0, execRes.stderr);

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      const applied = readJson(path.join(runRoot, 'apply', 'applied.json'));
      assert.strictEqual(applied.version, 1);
      assert.ok(applied.tasks.every(t => t.ok));

      const runJson = readJson(path.join(runRoot, 'run.json'));
      assert.ok(runJson.worktree && runJson.worktree.path);
      const wt = runJson.worktree.path;
      assert.ok(fs.existsSync(wt));

      // Worktree has changes
      assert.ok(fs.existsSync(path.join(wt, 'src', 'ecc-demo.txt')));
      assert.ok(fs.existsSync(path.join(wt, 'tests', 'ecc-demo.txt')));

      // Main repo should NOT have applied code changes
      assert.ok(!fs.existsSync(path.join(repo, 'src', 'ecc-demo.txt')));
      assert.ok(!fs.existsSync(path.join(repo, 'tests', 'ecc-demo.txt')));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('exec blocks unauthorized patch (mock unauthorized)', () => {
    const { base, repo, worktrees } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'unauthorized' };

      assert.strictEqual(run('node', [eccScript, 'init'], { cwd: repo, env }).status, 0);
      const runId = 'unauth';
      assert.strictEqual(run('node', [eccScript, 'plan', 'unauthorized-demo', '--run-id', runId], { cwd: repo, env }).status, 0);

      const execRes = run('node', [eccScript, 'exec', runId, '--worktree-root', worktrees], { cwd: repo, env });
      assert.notStrictEqual(execRes.status, 0);
      assert.ok(execRes.stderr.includes('ownership') || execRes.stderr.includes('unauthorized'));

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      const applied = readJson(path.join(runRoot, 'apply', 'applied.json'));
      assert.strictEqual(applied.tasks.length, 1);
      assert.strictEqual(applied.tasks[0].ok, false);

      const runJson = readJson(path.join(runRoot, 'run.json'));
      const wt = runJson.worktree.path;
      assert.ok(wt && fs.existsSync(wt), 'worktree should exist for debugging');

      // Unauthorized patch should not have been applied.
      assert.ok(!fs.existsSync(path.join(wt, 'README.md')));
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

