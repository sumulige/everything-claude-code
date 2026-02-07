const fs = require('fs');
const path = require('path');

function fixtureRoot() {
  const name = String(process.env.ECC_FIXTURE || 'basic').trim() || 'basic';
  return path.resolve(__dirname, '..', 'fixtures', name);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

async function generatePlan({ intent }) {
  const root = fixtureRoot();
  const planPath = path.join(root, 'plan.json');
  if (!fs.existsSync(planPath)) {
    throw new Error(`mock provider fixture missing plan.json: ${planPath}`);
  }
  const plan = readJson(planPath);
  // Keep fixtures deterministic but align plan.intent with the caller intent.
  plan.intent = String(intent || plan.intent || '').trim() || 'intent';
  return plan;
}

async function generatePatch({ task }) {
  const root = fixtureRoot();
  const patchPath = path.join(root, 'patches', `${task.id}.diff`);
  if (!fs.existsSync(patchPath)) {
    throw new Error(`mock provider fixture missing patch: ${patchPath}`);
  }
  return { patch: readText(patchPath), meta: { provider: 'mock', fixture: path.basename(root) } };
}

module.exports = {
  name: 'mock',
  generatePlan,
  generatePatch
};

