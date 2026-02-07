/**
 * Tests for ecc plan (mock provider)
 *
 * Run with: node tests/ecc/plan.test.js
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
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res;
}

function initTempGitRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plan-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });

  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'ecc@example.com']);
  git(repo, ['config', 'user.name', 'ECC']);

  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'base.txt'), 'base\n', 'utf8');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'init']);

  return { base, repo };
}

function runTests() {
  console.log('\n=== Testing ecc plan ===\n');

  let passed = 0;
  let failed = 0;

  const engineRoot = path.resolve(__dirname, '..', '..');
  const eccScript = path.join(engineRoot, 'scripts', 'ecc.js');

  if (test('plan creates run directory + plan artifacts (mock provider)', () => {
    const { base, repo } = initTempGitRepo();
    try {
      const env = { ...process.env, ECC_PROVIDER: 'mock', ECC_FIXTURE: 'basic' };

      const initRes = run('node', [eccScript, 'init'], { cwd: repo, env });
      assert.strictEqual(initRes.status, 0, initRes.stderr);

      const runId = 'demo-plan';
      const planRes = run('node', [eccScript, 'plan', 'demo', '--run-id', runId], { cwd: repo, env });
      assert.strictEqual(planRes.status, 0, planRes.stderr);

      const runRoot = path.join(repo, '.ecc', 'runs', runId);
      assert.ok(fs.existsSync(path.join(runRoot, 'run.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'plan.json')));
      assert.ok(fs.existsSync(path.join(runRoot, 'plan.md')));

      const runJson = readJson(path.join(runRoot, 'run.json'));
      assert.strictEqual(runJson.runId, runId);
      assert.strictEqual(runJson.status, 'planned');
      assert.ok(runJson.base && runJson.base.sha);

      const planJson = readJson(path.join(runRoot, 'plan.json'));
      assert.strictEqual(planJson.version, 1);
      assert.strictEqual(planJson.intent, 'demo');
      assert.ok(Array.isArray(planJson.tasks) && planJson.tasks.length >= 1);
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

