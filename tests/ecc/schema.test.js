/**
 * Tests for ECC schemas + internal validators
 *
 * Run with: node tests/ecc/schema.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const validate = require('../../scripts/ecc/validate');

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

function runTests() {
  console.log('\n=== Testing ECC schemas/validators ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const schemasDir = path.join(repoRoot, 'schemas');

  const schemaFiles = [
    'ecc.config.schema.json',
    'ecc.lock.schema.json',
    'ecc.run.schema.json',
    'ecc.plan.schema.json',
    'ecc.apply.schema.json',
    'ecc.verify.schema.json',
    'ecc.patch.schema.json'
  ];

  if (test('schema files exist and are valid JSON', () => {
    for (const f of schemaFiles) {
      const p = path.join(schemasDir, f);
      assert.ok(fs.existsSync(p), `missing schema: ${f}`);
      JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  })) passed++; else failed++;

  if (test('validateConfig accepts minimal valid config', () => {
    const cfg = {
      version: 1,
      backend: 'codex',
      packs: ['blueprint'],
      verify: { mode: 'auto' },
      createdAt: new Date().toISOString()
    };
    const errors = validate.validateConfig(cfg);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  if (test('validatePlan rejects duplicate task ids', () => {
    const plan = {
      version: 1,
      intent: 'x',
      tasks: [
        { id: 't', title: 'a', kind: 'patch', dependsOn: [], allowedPathPrefixes: ['src/'], prompt: 'p' },
        { id: 't', title: 'b', kind: 'patch', dependsOn: [], allowedPathPrefixes: ['src/'], prompt: 'p2' }
      ]
    };
    const errors = validate.validatePlan(plan);
    assert.ok(errors.some(e => e.path.includes('$.tasks[1].id')));
  })) passed++; else failed++;

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

