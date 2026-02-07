const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureDir } = require('../lib/utils');
const { writeJson, writeText } = require('./json');
const { validateVerifySummary, throwIfErrors } = require('./validate');
const { runKernel } = require('./kernel');

const { getPackageManager } = require('../lib/package-manager');

function nowIso() {
  return new Date().toISOString();
}

function safeName(name) {
  return String(name || 'command')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'command';
}

function runCommand(command, { cwd }) {
  const res = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const status = typeof res.status === 'number' ? res.status : 1;
  return { status, stdout, stderr };
}

function detectAutoCommands(worktreePath) {
  const pkgPath = path.join(worktreePath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (_err) {
    return [];
  }

  const scripts = (pkg && pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
  const wanted = ['lint', 'test', 'build'].filter(k => typeof scripts[k] === 'string' && scripts[k].trim());
  if (!wanted.length) return [];

  const pm = getPackageManager({ projectDir: worktreePath });
  const runCmd = pm && pm.config && pm.config.runCmd ? pm.config.runCmd : 'npm run';

  return wanted.map(name => ({ name, command: `${runCmd} ${name}` }));
}

function getVerifyCommands(verifyConfig, worktreePath) {
  if (verifyConfig && verifyConfig.mode === 'manual') {
    return Array.isArray(verifyConfig.commands) ? verifyConfig.commands : [];
  }
  return detectAutoCommands(worktreePath);
}

function runVerify({ worktreePath, verifyConfig, outDir }) {
  ensureDir(outDir);

  const commands = getVerifyCommands(verifyConfig || { mode: 'auto' }, worktreePath);

  const kernelOut = runKernel('verify.run', {
    worktreePath,
    outDir,
    commands: commands.map(c => ({ name: String(c.name), command: String(c.command) }))
  });
  if (kernelOut !== null) {
    if (!kernelOut || kernelOut.version !== 1) {
      throw new Error('ecc-kernel verify.run returned invalid output');
    }
    throwIfErrors(validateVerifySummary(kernelOut), 'verify summary');
    const sumPath = path.join(outDir, 'summary.json');
    if (!fs.existsSync(sumPath)) writeJson(sumPath, kernelOut);
    return kernelOut;
  }

  const results = [];

  let ok = true;

  for (const c of commands) {
    const name = safeName(c.name);
    const cmd = String(c.command || '');
    const outputPath = path.join(outDir, `${name}.txt`);

    const { status, stdout, stderr } = runCommand(cmd, { cwd: worktreePath });
    const entryOk = status === 0;
    if (!entryOk) ok = false;

    writeText(outputPath, stdout + (stderr ? (stdout.endsWith('\n') ? '' : '\n') + stderr : ''));

    results.push({
      name: String(c.name),
      command: cmd,
      ok: entryOk,
      exitCode: status,
      outputPath
    });
  }

  const summary = {
    version: 1,
    ranAt: nowIso(),
    commands: results,
    ok
  };

  throwIfErrors(validateVerifySummary(summary), 'verify summary');
  writeJson(path.join(outDir, 'summary.json'), summary);

  return summary;
}

module.exports = {
  runVerify
};
