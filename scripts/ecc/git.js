const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function getRepoRoot(cwd) {
  const res = runGit(['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (!res.ok) return null;
  return res.stdout.trim();
}

function getHeadSha(repoRoot) {
  const res = runGit(['-C', repoRoot, 'rev-parse', 'HEAD']);
  if (!res.ok) throw new Error(res.stderr || 'git rev-parse HEAD failed');
  return res.stdout.trim();
}

function getCurrentBranch(repoRoot) {
  const res = runGit(['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (!res.ok) throw new Error(res.stderr || 'git rev-parse --abbrev-ref HEAD failed');
  return res.stdout.trim();
}

function isClean(repoRoot) {
  const res = runGit(['-C', repoRoot, 'status', '--porcelain']);
  if (!res.ok) throw new Error(res.stderr || 'git status --porcelain failed');
  return res.stdout.trim().length === 0;
}

function branchExists(repoRoot, branch) {
  const res = runGit(['-C', repoRoot, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return res.status === 0;
}

function ensureBranchAt(repoRoot, branch, baseSha) {
  if (branchExists(repoRoot, branch)) return;
  const res = runGit(['-C', repoRoot, 'branch', branch, baseSha]);
  if (!res.ok) throw new Error(res.stderr || `git branch ${branch} ${baseSha} failed`);
}

function defaultWorktreePath({ repoRoot, runId, worktreeRoot }) {
  const repoName = path.basename(repoRoot);
  const root = worktreeRoot || path.join(os.tmpdir(), 'ecc-worktrees');
  return path.join(root, repoName, runId);
}

function assertExternalWorktreePath({ repoRoot, worktreePath }) {
  const rel = path.relative(repoRoot, worktreePath);
  const isInside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (isInside) {
    throw new Error(
      `Refusing to create worktree inside repo root (would recurse): repoRoot=${repoRoot} worktreePath=${worktreePath}`
    );
  }
}

function isGitWorktree(dir) {
  if (!fs.existsSync(dir)) return false;
  const res = runGit(['-C', dir, 'rev-parse', '--is-inside-work-tree']);
  return res.ok && res.stdout.trim() === 'true';
}

function ensureWorktree({ repoRoot, worktreePath, branch, baseSha }) {
  assertExternalWorktreePath({ repoRoot, worktreePath });
  ensureBranchAt(repoRoot, branch, baseSha);

  if (fs.existsSync(worktreePath)) {
    if (!isGitWorktree(worktreePath)) {
      throw new Error(`Worktree path exists but is not a git worktree: ${worktreePath}`);
    }
    return worktreePath;
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const res = runGit(['-C', repoRoot, 'worktree', 'add', worktreePath, branch]);
  if (!res.ok) throw new Error(res.stderr || `git worktree add failed: ${worktreePath}`);
  return worktreePath;
}

function removeWorktree({ repoRoot, worktreePath, force = true }) {
  const args = ['-C', repoRoot, 'worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  const res = runGit(args);
  if (!res.ok) throw new Error(res.stderr || `git worktree remove failed: ${worktreePath}`);
}

function commitAll({ repoRoot, message }) {
  let res = runGit(['-C', repoRoot, 'add', '-A']);
  if (!res.ok) throw new Error(res.stderr || 'git add failed');

  res = runGit(['-C', repoRoot, 'commit', '-m', message]);
  if (!res.ok) throw new Error(res.stderr || 'git commit failed');

  const sha = getHeadSha(repoRoot);
  return sha;
}

module.exports = {
  runGit,
  getRepoRoot,
  getHeadSha,
  getCurrentBranch,
  isClean,
  defaultWorktreePath,
  assertExternalWorktreePath,
  isGitWorktree,
  ensureBranchAt,
  ensureWorktree,
  removeWorktree,
  commitAll
};

