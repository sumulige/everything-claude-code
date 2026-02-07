/**
 * Tests for scripts/ecc.js (CLI)
 *
 * Run with: node tests/ecc/ecc.test.js
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

function runTests() {
  console.log('\n=== Testing ecc.js ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const eccScript = path.join(repoRoot, 'scripts', 'ecc.js');

  if (test('ecc.js exists', () => {
    assert.ok(fs.existsSync(eccScript));
  })) passed++; else failed++;

  if (test('packs lists known packs', () => {
    const res = run('node', [eccScript, 'packs'], { cwd: repoRoot });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('blueprint'));
    assert.ok(res.stdout.includes('forge'));
    assert.ok(res.stdout.includes('proof'));
    assert.ok(res.stdout.includes('sentinel'));
  })) passed++; else failed++;

  if (test('init creates .ecc/ecc.json with defaults in empty dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-test-'));
    try {
      const res = run('node', [eccScript, 'init'], { cwd: tmp });
      assert.strictEqual(res.status, 0);
      const cfgPath = path.join(tmp, '.ecc', 'ecc.json');
      assert.ok(fs.existsSync(cfgPath));

      const cfg = readJson(cfgPath);
      assert.strictEqual(cfg.version, 1);
      assert.strictEqual(cfg.backend, 'codex');
      assert.deepStrictEqual(cfg.packs, ['blueprint', 'forge', 'proof', 'sentinel']);
      assert.ok(cfg.verify);
      assert.strictEqual(cfg.verify.mode, 'auto');

      const gitignorePath = path.join(tmp, '.ecc', '.gitignore');
      assert.ok(fs.existsSync(gitignorePath));
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      assert.ok(gitignore.includes('runs/'));

      const lockPath = path.join(tmp, '.ecc', 'locks', 'registry.lock.json');
      assert.ok(fs.existsSync(lockPath));
      const lock = readJson(lockPath);
      assert.strictEqual(lock.version, 1);
      assert.ok(lock.catalog);
      assert.strictEqual(lock.catalog.type, 'embedded');
      assert.ok(String(lock.catalog.digest).startsWith('sha256:'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('init is idempotent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-test-'));
    try {
      const first = run('node', [eccScript, 'init'], { cwd: tmp });
      assert.strictEqual(first.status, 0);
      const second = run('node', [eccScript, 'init'], { cwd: tmp });
      assert.strictEqual(second.status, 0);
      const cfgPath = path.join(tmp, '.ecc', 'ecc.json');
      assert.ok(fs.existsSync(cfgPath));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
