const fs = require('fs');
const path = require('path');

const { readJson, writeText } = require('./json');
const { runPaths } = require('./run');

function fmtList(items) {
  if (!items || !items.length) return '(none)';
  return items.map(s => `- ${s}`).join('\n');
}

function loadIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return readJson(p);
  } catch (_err) {
    return null;
  }
}

function buildReport({ run, plan, applyResult, verifySummary }) {
  const lines = [];

  lines.push(`# ECC Run Report`);
  lines.push('');
  lines.push(`- runId: \`${run.runId}\``);
  lines.push(`- status: \`${run.status}\``);
  lines.push(`- intent: ${run.intent}`);
  lines.push(`- backend: \`${run.backend}\``);
  lines.push(`- packs: ${run.packs.join(', ')}`);
  lines.push(`- startedAt: ${run.startedAt}`);
  if (run.endedAt) lines.push(`- endedAt: ${run.endedAt}`);
  lines.push('');

  lines.push('## Base');
  lines.push('');
  lines.push(`- repoRoot: \`${run.base.repoRoot}\``);
  lines.push(`- branch: \`${run.base.branch}\``);
  lines.push(`- sha: \`${run.base.sha}\``);
  lines.push('');

  lines.push('## Worktree');
  lines.push('');
  lines.push(`- path: \`${run.worktree.path || '(not created)'}\``);
  lines.push(`- branch: \`${run.worktree.branch}\``);
  lines.push('');

  lines.push('## Plan');
  lines.push('');
  if (!plan) {
    lines.push('(missing plan.json)');
  } else {
    lines.push(`Intent: ${plan.intent}`);
    lines.push('');
    lines.push('Tasks:');
    lines.push('');
    for (const t of plan.tasks) {
      lines.push(`- \`${t.id}\`: ${t.title}`);
      lines.push(`  - allowedPathPrefixes:\n${fmtList(t.allowedPathPrefixes).split('\n').map(l => '    ' + l).join('\n')}`);
    }
  }
  lines.push('');

  lines.push('## Apply');
  lines.push('');
  if (!applyResult) {
    lines.push('(missing apply/applied.json)');
  } else {
    lines.push(`- appliedAt: ${applyResult.appliedAt}`);
    lines.push(`- baseSha: \`${applyResult.baseSha}\``);
    lines.push('');
    lines.push('Tasks:');
    lines.push('');
    for (const t of applyResult.tasks) {
      lines.push(`- \`${t.id}\`: ${t.ok ? 'OK' : 'FAILED'}`);
      lines.push(`  - patch: \`${t.patchPath}\``);
      if (t.error) lines.push(`  - error: ${t.error}`);
    }
    if (applyResult.commit) {
      lines.push('');
      lines.push(`Commit: \`${applyResult.commit.sha}\``);
    }
  }
  lines.push('');

  lines.push('## Verify');
  lines.push('');
  if (!verifySummary) {
    lines.push('(missing verify/summary.json)');
  } else {
    lines.push(`- ok: ${verifySummary.ok ? 'true' : 'false'}`);
    lines.push(`- ranAt: ${verifySummary.ranAt}`);
    lines.push('');
    lines.push('Commands:');
    lines.push('');
    for (const c of verifySummary.commands) {
      lines.push(`- \`${c.name}\`: ${c.ok ? 'OK' : 'FAILED'} (exit ${c.exitCode})`);
      lines.push(`  - command: \`${c.command}\``);
      lines.push(`  - output: \`${c.outputPath}\``);
    }
  }

  lines.push('');
  lines.push('## Next Steps');
  lines.push('');
  lines.push('- Inspect the worktree path above.');
  lines.push('- If verification passed, you can commit/push the worktree branch or open a PR.');

  return lines.join('\n');
}

function writeReport({ projectRoot, runId }) {
  const paths = runPaths(projectRoot, runId);
  const run = loadIfExists(paths.runJson);
  if (!run) throw new Error(`missing run.json for runId=${runId}`);

  const plan = loadIfExists(paths.planJson);
  const applyResult = loadIfExists(paths.applyJson);
  const verifySummary = loadIfExists(paths.verifySummaryJson);

  writeText(paths.reportMd, buildReport({ run, plan, applyResult, verifySummary }) + '\n');
  return paths.reportMd;
}

module.exports = {
  writeReport,
  buildReport
};

