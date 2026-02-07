/**
 * Tests for docs/ecc.md install instructions.
 *
 * Run with: node tests/ecc/docs-install.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  console.log('\n=== Testing docs/ecc.md install instructions ===\n');

  let passed = 0;
  let failed = 0;

  const repoRoot = path.resolve(__dirname, '..', '..');
  const docPath = path.join(repoRoot, 'docs', 'ecc.md');

  if (test('docs/ecc.md exists', () => {
    assert.ok(fs.existsSync(docPath), `missing: ${docPath}`);
  })) passed++; else failed++;

  const doc = fs.readFileSync(docPath, 'utf8');

  if (test('mentions npm package name ecc-conveyor', () => {
    assert.ok(/ecc-conveyor/.test(doc), 'expected ecc-conveyor to be mentioned');
  })) passed++; else failed++;

  if (test('includes project-local install via npm -D and npx ecc', () => {
    assert.ok(/npm\s+(i|install)\s+-D\s+ecc-conveyor\b/.test(doc), 'missing: npm install -D ecc-conveyor');
    assert.ok(/\bnpx\s+ecc\b/.test(doc), 'missing: npx ecc');
  })) passed++; else failed++;

  if (test('includes global install via npm -g', () => {
    assert.ok(/npm\s+(i|install)\s+-g\s+ecc-conveyor\b/.test(doc), 'missing: npm install -g ecc-conveyor');
  })) passed++; else failed++;

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();

