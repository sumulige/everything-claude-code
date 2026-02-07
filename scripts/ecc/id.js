const path = require('path');

const { getDateString } = require('../lib/utils');
const { runsDir } = require('./project');

function slugify(s, fallback = 'run') {
  const cleaned = String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function defaultRunId(intent) {
  return `${getDateString()}-${slugify(intent, 'task')}`;
}

function ensureUniqueRunId(projectRoot, runIdBase) {
  const base = slugify(runIdBase);
  const root = runsDir(projectRoot);
  let candidate = base;
  let n = 2;
  while (true) {
    const p = path.join(root, candidate);
    if (!require('fs').existsSync(p)) return candidate;
    candidate = `${base}-${n}`;
    n++;
  }
}

module.exports = {
  slugify,
  defaultRunId,
  ensureUniqueRunId
};

