const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { promptsDir, schemasDir } = require('../paths');

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function runCodexJson({ repoRoot, prompt, schemaPath }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-'));
  const outPath = path.join(tmpDir, 'last-message.json');

  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--cd',
    repoRoot,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outPath,
    '-'
  ];

  const res = spawnSync('codex', args, {
    cwd: repoRoot,
    input: prompt,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const stdout = (res.stdout || '').trimEnd();
  const stderr = (res.stderr || '').trimEnd();

  if (res.status !== 0) {
    const msg = [
      `codex exec failed (exit ${res.status})`,
      stdout ? `stdout:\n${stdout}` : null,
      stderr ? `stderr:\n${stderr}` : null
    ]
      .filter(Boolean)
      .join('\n\n');
    throw new Error(msg);
  }

  if (!fs.existsSync(outPath)) {
    throw new Error('codex exec did not write --output-last-message file');
  }

  const raw = fs.readFileSync(outPath, 'utf8').trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    throw new Error(`codex output is not valid JSON (${detail}). Raw:\n${raw.slice(0, 2000)}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_err) {
      // ignore cleanup failures
    }
  }
}

function planTemplate() {
  return readText(path.join(promptsDir(), 'plan.md'));
}

function patchTemplate() {
  return readText(path.join(promptsDir(), 'patch.md'));
}

function planSchemaPath() {
  return path.join(schemasDir(), 'ecc.plan.schema.json');
}

function patchSchemaPath() {
  return path.join(schemasDir(), 'ecc.patch.schema.json');
}

function buildPlanPrompt({ intent, repoRoot, packs }) {
  return [
    planTemplate(),
    '',
    '## Caller Input',
    `generatedAt: ${nowIso()}`,
    `projectRoot: ${repoRoot}`,
    `packs: ${Array.isArray(packs) ? packs.join(', ') : ''}`,
    `intent: ${String(intent || '').trim()}`,
    '',
    'Return JSON only.'
  ].join('\n');
}

function buildPatchPrompt({ task, repoRoot, packs }) {
  const taskSummary = {
    id: task.id,
    title: task.title,
    prompt: task.prompt
  };
  return [
    patchTemplate(),
    '',
    '## Caller Input',
    `generatedAt: ${nowIso()}`,
    `projectRoot: ${repoRoot}`,
    `packs: ${Array.isArray(packs) ? packs.join(', ') : ''}`,
    `task: ${JSON.stringify(taskSummary, null, 2)}`,
    `allowedPathPrefixes: ${Array.isArray(task.allowedPathPrefixes) ? task.allowedPathPrefixes.join(', ') : ''}`,
    '',
    'Patch rules:',
    '- If patch is non-empty, it should be a raw unified diff starting with "diff --git".',
    '- Do not wrap diffs in code fences.',
    '',
    'Return JSON only.'
  ].join('\n');
}

async function generatePlan({ intent, repoRoot, packs }) {
  const prompt = buildPlanPrompt({ intent, repoRoot, packs });
  return runCodexJson({ repoRoot, prompt, schemaPath: planSchemaPath() });
}

async function generatePatch({ task, repoRoot, packs }) {
  const prompt = buildPatchPrompt({ task, repoRoot, packs });
  return runCodexJson({ repoRoot, prompt, schemaPath: patchSchemaPath() });
}

module.exports = {
  name: 'codex',
  generatePlan,
  generatePatch
};

