const fs = require('fs');

const { writeJson, writeText } = require('./json');
const { validatePlan, throwIfErrors } = require('./validate');
const { runPaths, saveRun } = require('./run');

function renderPlanMd(plan) {
  const lines = [];
  lines.push(`# ECC Plan`);
  lines.push('');
  lines.push(`Intent: ${plan.intent}`);
  lines.push('');
  lines.push('## Tasks');
  lines.push('');
  for (const t of plan.tasks) {
    lines.push(`### ${t.id}: ${t.title}`);
    lines.push('');
    lines.push(`- kind: ${t.kind}`);
    lines.push(`- dependsOn: ${t.dependsOn.length ? t.dependsOn.join(', ') : '(none)'}`);
    lines.push(`- allowedPathPrefixes: ${t.allowedPathPrefixes.join(', ')}`);
    lines.push('');
    lines.push('Prompt:');
    lines.push('');
    lines.push('```');
    lines.push(t.prompt.trim());
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

async function generatePlan({ projectRoot, run, provider }) {
  const paths = runPaths(projectRoot, run.runId);

  const plan = await provider.generatePlan({
    intent: run.intent,
    repoRoot: projectRoot,
    packs: run.packs
  });

  throwIfErrors(validatePlan(plan), 'plan');

  writeJson(paths.planJson, plan);
  writeText(paths.planMd, renderPlanMd(plan));

  // Ensure run.json stays valid and points to artifacts already.
  // We also set worktree branch early for discoverability.
  if (!fs.existsSync(paths.runJson)) saveRun(projectRoot, run.runId, run);

  return { plan, paths };
}

module.exports = {
  generatePlan,
  renderPlanMd
};

