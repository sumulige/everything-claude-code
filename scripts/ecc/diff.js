const fs = require('fs');
const path = require('path');

const { spawnSync } = require('child_process');

const { runKernel } = require('./kernel');

function runGit(args, opts = {}) {
  const res = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trimEnd(),
    stderr: (res.stderr || '').trimEnd()
  };
}

function normalizeRepoPath(p) {
  const posix = String(p || '').replace(/\\/g, '/');
  // Prevent sneaky absolute paths and traversal.
  if (posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)) return null;
  const norm = path.posix.normalize(posix);
  if (norm === '.' || norm.startsWith('../') || norm.includes('/../')) return null;
  return norm;
}

function touchedFilesFromUnifiedDiff(patchText) {
  const files = [];
  const seen = new Set();
  const lines = String(patchText || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('diff --git ')) continue;
    // Typical: diff --git a/foo/bar b/foo/bar
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!m) continue;
    const aPath = m[1];
    const bPath = m[2];
    const file = bPath === '/dev/null' ? aPath : bPath;
    const normalized = normalizeRepoPath(file);
    if (!normalized) {
      files.push({ path: file, invalid: true });
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    files.push({ path: normalized, invalid: false });
  }
  return files;
}

function ensureOwned({ touchedFiles, allowedPathPrefixes }) {
  const allowed = (Array.isArray(allowedPathPrefixes) ? allowedPathPrefixes : [])
    .map(p => String(p || '').replace(/\\/g, '/'))
    .map(p => (p.endsWith('/') ? p : `${p}/`))
    .filter(Boolean);

  if (!allowed.length) throw new Error('allowedPathPrefixes is empty');

  const violations = [];
  for (const f of touchedFiles) {
    if (f.invalid) {
      violations.push(`invalid path in patch: ${f.path}`);
      continue;
    }
    const ok = allowed.some(prefix => f.path === prefix.slice(0, -1) || f.path.startsWith(prefix));
    if (!ok) violations.push(`unauthorized path: ${f.path}`);
  }

  if (violations.length) {
    throw new Error(`patch ownership check failed:\n- ${violations.join('\n- ')}`);
  }
}

function applyPatch({ worktreePath, patchPath, allowedPathPrefixes }) {
  const kernelOut = runKernel('patch.apply', {
    worktreePath,
    patchPath,
    allowedPathPrefixes: Array.isArray(allowedPathPrefixes) ? allowedPathPrefixes : []
  });
  if (kernelOut && Array.isArray(kernelOut.touchedFiles)) {
    return { touchedFiles: kernelOut.touchedFiles };
  }

  const patchText = fs.readFileSync(patchPath, 'utf8');
  const trimmed = patchText.trim();
  if (!trimmed) {
    return { touchedFiles: [] };
  }

  const touched = touchedFilesFromUnifiedDiff(patchText);
  if (!touched.length) {
    throw new Error('patch has content but no "diff --git" headers (not a unified diff?)');
  }

  ensureOwned({ touchedFiles: touched, allowedPathPrefixes });

  let res = runGit(['-C', worktreePath, 'apply', '--check', patchPath]);
  if (!res.ok) throw new Error(res.stderr || 'git apply --check failed');

  res = runGit(['-C', worktreePath, 'apply', patchPath]);
  if (!res.ok) throw new Error(res.stderr || 'git apply failed');

  return { touchedFiles: touched.map(t => t.path) };
}

module.exports = {
  touchedFilesFromUnifiedDiff,
  applyPatch
};
