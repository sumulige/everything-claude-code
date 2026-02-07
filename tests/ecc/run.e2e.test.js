/**
 * E2E tests for ecc run (mock provider)
 *
 * Run with: node tests/ecc/run.e2e.test.js
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-e2e-'));
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
  console.log('\n=== Testing ecc run (e2e) ===\n');

  let passed = 0;
  let failed = 0;

  const engineRoot = path.resolve(__dirname, '..', '..');
  const eccScript = path.join(engineRoot, 'scripts', 'ecc.js');

  if (test('run creates full evidence chain and succeeds (mock basic)', () => {
    const { base, repo, worktrees } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'basic' };

      assert.strictEqual(run('node', [eccScript, 'init'], { cwd: repo, env }).status, 0);
      setManualVerify(repo, [{ name: 'ok', command: 'node -e "process.exit(0)"' }]);

      const runId = 'e2e';
      const res = run('node', [eccScript, 'run', 'demo', '--run-id', runId, '--worktree-root', worktrees], { cwd: repo, env });
      assert.strictEqual(res.status, 0, res.stderr);

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      assert.ok(fs.existsSync(path.join(runRoot, 'run.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'plan.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'plan.md')));
      assert.ok(fs.existsSync(path.join(runRoot, 'patches', 'impl-core.diff')));
      assert.ok(fs.existsSync(path.join(runRoot, 'apply', 'applied.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'verify', 'summary.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'report.md')));

      const runJson = readJson(path.join(runRoot, 'run.json'));
      assert.strictEqual(runJson.status, 'succeeded');
      assert.ok(runJson.endedAt);
      assert.ok(runJson.worktree && runJson.worktree.path);
      assert.ok(fs.existsSync(runJson.worktree.path));

      const summary = readJson(path.join(runRoot, 'verify', 'summary.json'));
      assert.strictEqual(summary.ok, true);

      // Main repo should NOT have applied code changes
      assert.ok(!fs.existsSync(path.join(repo, 'src', 'ecc-demo.txt')));
      assert.ok(!fs.existsSync(path.join(repo, 'tests', 'ecc-demo.txt')));
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

