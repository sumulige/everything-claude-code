/**
 * ECC validators (dependency-free)
 *
 * These validators are intentionally strict on required fields/types and
 * provide a stable internal contract independent of external JSON Schema libs.
 */

function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v) {
  return typeof v === 'string';
}

function isBool(v) {
  return typeof v === 'boolean';
}

function isInt(v) {
  return Number.isInteger(v);
}

function pushErr(errors, path, message) {
  errors.push({ path, message });
}

function validateString(errors, path, v, { minLength = 1 } = {}) {
  if (!isStr(v)) {
    pushErr(errors, path, 'expected string');
    return;
  }
  if (v.length < minLength) pushErr(errors, path, `expected string length >= ${minLength}`);
}

function validateStringArray(errors, path, v, { minItems = 0 } = {}) {
  if (!Array.isArray(v)) {
    pushErr(errors, path, 'expected array');
    return;
  }
  if (v.length < minItems) pushErr(errors, path, `expected array length >= ${minItems}`);
  for (let i = 0; i < v.length; i++) validateString(errors, `${path}[${i}]`, v[i]);
}

function validateConfig(cfg) {
  const errors = [];
  if (!isObj(cfg)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }

  if (cfg.version !== 1) pushErr(errors, '$.version', 'expected 1');
  if (!['codex', 'claude'].includes(cfg.backend)) {
    pushErr(errors, '$.backend', 'expected "codex" or "claude"');
  }

  validateStringArray(errors, '$.packs', cfg.packs, { minItems: 1 });
  validateString(errors, '$.createdAt', cfg.createdAt);

  if (!isObj(cfg.verify)) {
    pushErr(errors, '$.verify', 'expected object');
  } else {
    if (!['auto', 'manual'].includes(cfg.verify.mode)) {
      pushErr(errors, '$.verify.mode', 'expected "auto" or "manual"');
    }
    if (cfg.verify.commands !== undefined) {
      if (!Array.isArray(cfg.verify.commands)) {
        pushErr(errors, '$.verify.commands', 'expected array');
      } else {
        for (let i = 0; i < cfg.verify.commands.length; i++) {
          const c = cfg.verify.commands[i];
          const base = `$.verify.commands[${i}]`;
          if (!isObj(c)) {
            pushErr(errors, base, 'expected object');
            continue;
          }
          validateString(errors, `${base}.name`, c.name);
          validateString(errors, `${base}.command`, c.command);
        }
      }
    }
  }

  return errors;
}

function validateLock(lock) {
  const errors = [];
  if (!isObj(lock)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }

  if (lock.version !== 1) pushErr(errors, '$.version', 'expected 1');
  validateString(errors, '$.lockedAt', lock.lockedAt);
  validateStringArray(errors, '$.packs', lock.packs, { minItems: 1 });

  if (!isObj(lock.engine)) {
    pushErr(errors, '$.engine', 'expected object');
  } else {
    if (lock.engine.name !== 'ecc') pushErr(errors, '$.engine.name', 'expected "ecc"');
    if (lock.engine.version !== undefined) validateString(errors, '$.engine.version', lock.engine.version);
  }

  if (!isObj(lock.catalog)) {
    pushErr(errors, '$.catalog', 'expected object');
  } else {
    if (lock.catalog.type !== 'embedded') pushErr(errors, '$.catalog.type', 'expected "embedded"');
    validateString(errors, '$.catalog.digest', lock.catalog.digest);
  }

  return errors;
}

function validatePlan(plan) {
  const errors = [];
  if (!isObj(plan)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }

  if (plan.version !== 1) pushErr(errors, '$.version', 'expected 1');
  validateString(errors, '$.intent', plan.intent);

  if (!Array.isArray(plan.tasks)) {
    pushErr(errors, '$.tasks', 'expected array');
    return errors;
  }
  if (plan.tasks.length < 1) pushErr(errors, '$.tasks', 'expected at least 1 task');

  const ids = new Set();
  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    const base = `$.tasks[${i}]`;
    if (!isObj(t)) {
      pushErr(errors, base, 'expected object');
      continue;
    }
    validateString(errors, `${base}.id`, t.id);
    validateString(errors, `${base}.title`, t.title);
    if (t.kind !== 'patch') pushErr(errors, `${base}.kind`, 'expected "patch"');
    validateStringArray(errors, `${base}.dependsOn`, t.dependsOn || []);
    validateStringArray(errors, `${base}.allowedPathPrefixes`, t.allowedPathPrefixes, { minItems: 1 });
    validateString(errors, `${base}.prompt`, t.prompt);

    if (isStr(t.id)) {
      if (ids.has(t.id)) pushErr(errors, `${base}.id`, 'duplicate task id');
      ids.add(t.id);
    }
  }

  // Validate dependsOn references and DAG (only if basic task objects passed)
  const tasksById = new Map();
  for (const t of plan.tasks) {
    if (isObj(t) && isStr(t.id)) tasksById.set(t.id, t);
  }
  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    if (!isObj(t) || !isStr(t.id)) continue;
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (let j = 0; j < deps.length; j++) {
      const dep = deps[j];
      if (!tasksById.has(dep)) pushErr(errors, `$.tasks[${i}].dependsOn[${j}]`, 'unknown task id');
    }
  }

  // Cycle detection
  const visiting = new Set();
  const visited = new Set();
  function dfs(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      pushErr(errors, '$.tasks', `cycle detected at task "${id}"`);
      return;
    }
    visiting.add(id);
    const t = tasksById.get(id);
    if (t) {
      const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      for (const dep of deps) dfs(dep);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasksById.keys()) dfs(id);

  return errors;
}

function validateRun(run) {
  const errors = [];
  if (!isObj(run)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }
  if (run.version !== 1) pushErr(errors, '$.version', 'expected 1');
  validateString(errors, '$.runId', run.runId);
  validateString(errors, '$.intent', run.intent);
  if (!['codex', 'claude'].includes(run.backend)) pushErr(errors, '$.backend', 'expected "codex" or "claude"');
  validateStringArray(errors, '$.packs', run.packs, { minItems: 1 });
  if (!['planned', 'executing', 'verifying', 'succeeded', 'failed'].includes(run.status)) {
    pushErr(errors, '$.status', 'invalid status');
  }
  validateString(errors, '$.startedAt', run.startedAt);
  if (run.endedAt !== undefined) validateString(errors, '$.endedAt', run.endedAt);

  if (!isObj(run.base)) {
    pushErr(errors, '$.base', 'expected object');
  } else {
    validateString(errors, '$.base.repoRoot', run.base.repoRoot);
    if (run.base.branch === undefined) pushErr(errors, '$.base.branch', 'missing');
    else if (!isStr(run.base.branch)) pushErr(errors, '$.base.branch', 'expected string');
    if (run.base.sha === undefined) pushErr(errors, '$.base.sha', 'missing');
    else if (!isStr(run.base.sha)) pushErr(errors, '$.base.sha', 'expected string');
  }

  if (!isObj(run.worktree)) {
    pushErr(errors, '$.worktree', 'expected object');
  } else {
    if (run.worktree.path === undefined) pushErr(errors, '$.worktree.path', 'missing');
    else if (!isStr(run.worktree.path)) pushErr(errors, '$.worktree.path', 'expected string');
    if (run.worktree.branch === undefined) pushErr(errors, '$.worktree.branch', 'missing');
    else if (!isStr(run.worktree.branch)) pushErr(errors, '$.worktree.branch', 'expected string');
  }

  if (!isObj(run.artifacts)) {
    pushErr(errors, '$.artifacts', 'expected object');
  } else {
    validateString(errors, '$.artifacts.planJson', run.artifacts.planJson);
    validateString(errors, '$.artifacts.planMd', run.artifacts.planMd);
    validateString(errors, '$.artifacts.patchesDir', run.artifacts.patchesDir);
    validateString(errors, '$.artifacts.applyJson', run.artifacts.applyJson);
    validateString(errors, '$.artifacts.verifyDir', run.artifacts.verifyDir);
    validateString(errors, '$.artifacts.reportMd', run.artifacts.reportMd);
  }

  return errors;
}

function validateApplyResult(applyResult) {
  const errors = [];
  if (!isObj(applyResult)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }
  if (applyResult.version !== 1) pushErr(errors, '$.version', 'expected 1');
  validateString(errors, '$.appliedAt', applyResult.appliedAt);
  validateString(errors, '$.baseSha', applyResult.baseSha);

  if (!Array.isArray(applyResult.tasks)) {
    pushErr(errors, '$.tasks', 'expected array');
  } else {
    for (let i = 0; i < applyResult.tasks.length; i++) {
      const t = applyResult.tasks[i];
      const base = `$.tasks[${i}]`;
      if (!isObj(t)) {
        pushErr(errors, base, 'expected object');
        continue;
      }
      validateString(errors, `${base}.id`, t.id);
      validateString(errors, `${base}.patchPath`, t.patchPath);
      if (!isBool(t.ok)) pushErr(errors, `${base}.ok`, 'expected boolean');
      if (t.error !== undefined) validateString(errors, `${base}.error`, t.error);
    }
  }

  if (applyResult.commit !== undefined) {
    if (!isObj(applyResult.commit)) {
      pushErr(errors, '$.commit', 'expected object');
    } else {
      validateString(errors, '$.commit.sha', applyResult.commit.sha);
      validateString(errors, '$.commit.message', applyResult.commit.message);
    }
  }

  return errors;
}

function validateVerifySummary(summary) {
  const errors = [];
  if (!isObj(summary)) {
    pushErr(errors, '$', 'expected object');
    return errors;
  }
  if (summary.version !== 1) pushErr(errors, '$.version', 'expected 1');
  validateString(errors, '$.ranAt', summary.ranAt);
  if (!isBool(summary.ok)) pushErr(errors, '$.ok', 'expected boolean');

  if (!Array.isArray(summary.commands)) {
    pushErr(errors, '$.commands', 'expected array');
  } else {
    for (let i = 0; i < summary.commands.length; i++) {
      const c = summary.commands[i];
      const base = `$.commands[${i}]`;
      if (!isObj(c)) {
        pushErr(errors, base, 'expected object');
        continue;
      }
      validateString(errors, `${base}.name`, c.name);
      validateString(errors, `${base}.command`, c.command);
      if (!isBool(c.ok)) pushErr(errors, `${base}.ok`, 'expected boolean');
      if (!isInt(c.exitCode)) pushErr(errors, `${base}.exitCode`, 'expected integer');
      validateString(errors, `${base}.outputPath`, c.outputPath);
    }
  }

  return errors;
}

function throwIfErrors(errors, label = 'validation') {
  if (!errors.length) return;
  const lines = errors.map(e => `- ${e.path}: ${e.message}`).join('\n');
  throw new Error(`${label} failed:\n${lines}`);
}

module.exports = {
  validateConfig,
  validateLock,
  validatePlan,
  validateRun,
  validateApplyResult,
  validateVerifySummary,
  throwIfErrors
};

