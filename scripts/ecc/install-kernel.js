#!/usr/bin/env node
/**
 * Postinstall helper: fetch prebuilt ecc-kernel from the GitHub release matching package.json version.
 *
 * Default behavior:
 * - If ECC_KERNEL_INSTALL is unset and CI=true, skip (avoid noisy 404s in repo CI).
 * - Otherwise attempt download; failures are non-fatal unless ECC_KERNEL_INSTALL=required.
 *
 * Env:
 * - ECC_KERNEL_INSTALL=0|false|off            disable download
 * - ECC_KERNEL_INSTALL=required|force        fail install if download fails
 * - ECC_KERNEL_BASE_URL=...                  override base URL (defaults to GitHub releases URL)
 * - ECC_KERNEL_DEBUG=1                       verbose logs
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { URL } = require('url');

function debugEnabled() {
  return !!(process.env.ECC_KERNEL_DEBUG && String(process.env.ECC_KERNEL_DEBUG).trim());
}

function logDebug(msg) {
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.error(`[ecc-kernel] ${msg}`);
  }
}

function parseInstallMode() {
  const raw = process.env.ECC_KERNEL_INSTALL;
  const envSet = raw !== undefined;
  const s = raw ? String(raw).trim().toLowerCase() : '';
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(s)) return { mode: 'off', envSet };
  if (['required', 'require', 'force'].includes(s)) return { mode: 'required', envSet };
  return { mode: 'auto', envSet };
}

function binName() {
  return process.platform === 'win32' ? 'ecc-kernel.exe' : 'ecc-kernel';
}

function platformArch() {
  const platform = process.platform;
  const arch = process.arch;

  const os =
    platform === 'darwin' ? 'darwin' :
      platform === 'linux' ? 'linux' :
        platform === 'win32' ? 'windows' :
          null;

  const cpu =
    arch === 'x64' ? 'x64' :
      arch === 'arm64' ? 'arm64' :
        null;

  if (!os || !cpu) return null;
  return { os, cpu };
}

function readPackageJson() {
  const root = path.resolve(__dirname, '..', '..');
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return { root, pkg };
}

function normalizeRepoUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (u.startsWith('git+')) u = u.slice('git+'.length);
  if (u.endsWith('.git')) u = u.slice(0, -'.git'.length);
  return u;
}

function defaultBaseUrl(pkgVersion, pkg) {
  const envBase = process.env.ECC_KERNEL_BASE_URL ? String(process.env.ECC_KERNEL_BASE_URL).trim() : '';
  if (envBase) return envBase.replace(/\/+$/, '');

  const repo = pkg && pkg.repository ? pkg.repository : null;
  const repoUrl = normalizeRepoUrl(typeof repo === 'string' ? repo : (repo && repo.url));
  const m = repoUrl && repoUrl.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+/);
  const baseRepo = m ? m[0] : 'https://github.com/sumulige/everything-claude-code';
  return `${baseRepo}/releases/download/v${pkgVersion}`;
}

function assetName({ os, cpu }) {
  const ext = os === 'windows' ? '.exe' : '';
  return `ecc-kernel-${os}-${cpu}${ext}`;
}

function joinUrl(base, file) {
  const b = String(base || '').replace(/\/+$/, '');
  return `${b}/${file}`;
}

function request(url, { headers, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        method: 'GET',
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': 'ecc-kernel-installer',
          ...(headers || {})
        }
      },
      res => resolve(res)
    );

    req.on('error', reject);
    req.setTimeout(timeoutMs || 10_000, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs || 10_000}ms`));
    });
    req.end();
  });
}

async function downloadText(url, { headers, timeoutMs, maxBytes = 1024 * 1024 } = {}) {
  let current = url;
  for (let redirects = 0; redirects < 10; redirects++) {
    const res = await request(current, { headers, timeoutMs });
    const code = res.statusCode || 0;
    const loc = res.headers && res.headers.location ? String(res.headers.location) : '';

    if ([301, 302, 303, 307, 308].includes(code) && loc) {
      current = new URL(loc, current).toString();
      continue;
    }

    if (code !== 200) {
      const chunks = [];
      let size = 0;
      for await (const chunk of res) {
        size += chunk.length;
        if (size > 4096) break;
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const err = new Error(`HTTP ${code} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
      err.statusCode = code;
      throw err;
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`response too large for ${url}`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error(`too many redirects for ${url}`);
}

async function downloadToFile(url, destPath, { headers, timeoutMs } = {}) {
  let current = url;
  for (let redirects = 0; redirects < 10; redirects++) {
    const res = await request(current, { headers, timeoutMs });
    const code = res.statusCode || 0;
    const loc = res.headers && res.headers.location ? String(res.headers.location) : '';

    if ([301, 302, 303, 307, 308].includes(code) && loc) {
      current = new URL(loc, current).toString();
      continue;
    }

    if (code !== 200) {
      const chunks = [];
      let size = 0;
      for await (const chunk of res) {
        size += chunk.length;
        if (size > 4096) break;
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const err = new Error(`HTTP ${code} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
      err.statusCode = code;
      throw err;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.tmp`;
    try { fs.rmSync(tmpPath, { force: true }); } catch (_err) {}

    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmpPath);
      res.pipe(out);
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
    });

    fs.renameSync(tmpPath, destPath);
    return;
  }
  throw new Error(`too many redirects for ${url}`);
}

function parseSha256(text) {
  const m = String(text || '').trim().match(/([a-fA-F0-9]{64})/);
  return m ? m[1].toLowerCase() : null;
}

function sha256FileSync(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function ensureExecutable(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (_err) {
    // ignore
  }
}

function validateRuns(filePath) {
  const res = spawnSync(filePath, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error) throw new Error(`kernel failed to run: ${res.error.message}`);
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    throw new Error(`kernel failed to run (exit ${res.status})${stderr ? `: ${stderr}` : ''}`);
  }
}

async function main() {
  const { mode, envSet } = parseInstallMode();
  if (mode === 'off') return;

  // Skip in CI unless explicitly enabled (avoid repeated 404s in repo CI).
  if (!envSet && process.env.CI) {
    logDebug('CI detected and ECC_KERNEL_INSTALL not set; skipping download');
    return;
  }

  const target = platformArch();
  if (!target) {
    logDebug(`unsupported platform/arch: ${process.platform}/${process.arch}`);
    return;
  }

  const { pkg } = readPackageJson();
  const version = String(pkg.version || '').trim();
  if (!version) throw new Error('package.json missing version');

  const eccDir = path.resolve(__dirname);
  const destDir = path.join(eccDir, 'bin', `${target.os}-${target.cpu}`);
  const destBin = path.join(destDir, binName());

  if (fs.existsSync(destBin)) {
    logDebug(`kernel already present: ${destBin}`);
    return;
  }

  const baseUrl = defaultBaseUrl(version, pkg);
  const asset = assetName(target);
  const urlBin = joinUrl(baseUrl, asset);
  const urlSha = joinUrl(baseUrl, `${asset}.sha256`);

  const headers = {};
  if (process.env.ECC_KERNEL_AUTH_TOKEN) {
    headers.Authorization = `token ${String(process.env.ECC_KERNEL_AUTH_TOKEN).trim()}`;
  }

  logDebug(`downloading ${urlBin}`);

  let expectedSha = null;
  try {
    const shaText = await downloadText(urlSha, { headers, timeoutMs: 10_000, maxBytes: 64 * 1024 });
    expectedSha = parseSha256(shaText);
    if (expectedSha) logDebug(`checksum: ${expectedSha}`);
  } catch (err) {
    const code = err && typeof err.statusCode === 'number' ? err.statusCode : null;
    if (code === 404) {
      logDebug('checksum missing (404), continuing without verification');
    } else {
      logDebug(`checksum download failed, continuing without verification: ${err.message}`);
    }
  }

  try {
    await downloadToFile(urlBin, destBin, { headers, timeoutMs: 30_000 });
  } catch (err) {
    const code = err && typeof err.statusCode === 'number' ? err.statusCode : null;
    if (mode === 'required') throw err;

    if (code === 404) {
      logDebug('no prebuilt kernel asset for this version/platform; skipping');
      return;
    }
    logDebug(`kernel download failed, skipping: ${err.message}`);
    return;
  }

  try {
    ensureExecutable(destBin);

    if (expectedSha) {
      const actualSha = sha256FileSync(destBin);
      if (actualSha !== expectedSha) {
        throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actualSha}`);
      }
    }

    validateRuns(destBin);
  } catch (err) {
    try { fs.rmSync(destBin, { force: true }); } catch (_err) {}
    if (mode === 'required') throw err;
    logDebug(`downloaded kernel invalid, removed: ${err.message}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`ecc: installed ecc-kernel (${target.os}-${target.cpu})`);
}

main().catch(err => {
  const msg = err && err.message ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`ecc: kernel install failed: ${msg}`);
  process.exit(1);
});

