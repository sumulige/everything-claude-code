const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_err) {
    return false;
  }
}

function getKernelMode() {
  // ECC_KERNEL:
  // - "auto" (default): use ecc-kernel if available, else fallback to JS
  // - "rust": require ecc-kernel, error if missing
  // - "node": force JS implementation
  const raw = process.env.ECC_KERNEL ? String(process.env.ECC_KERNEL).trim().toLowerCase() : 'auto';
  if (!raw || raw === 'auto') return 'auto';
  if (raw === 'rust' || raw === 'kernel') return 'rust';
  if (raw === 'node' || raw === 'js' || raw === 'off' || raw === 'disable') return 'node';
  return 'auto';
}

function binName() {
  return process.platform === 'win32' ? 'ecc-kernel.exe' : 'ecc-kernel';
}

function platformArchKey() {
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
  return `${os}-${cpu}`;
}

function tryKernelFromPath() {
  const res = spawnSync('ecc-kernel', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.error) return null;
  if (res.status === 0) return 'ecc-kernel';
  return null;
}

function findKernelBinary() {
  if (process.env.ECC_KERNEL_PATH) {
    const p = path.resolve(String(process.env.ECC_KERNEL_PATH));
    if (isFile(p)) return p;
  }

  // Preferred location for prebuilt binaries installed via postinstall.
  const key = platformArchKey();
  if (key) {
    const packaged = path.join(__dirname, 'bin', key, binName());
    if (isFile(packaged)) return packaged;
  }

  const fromPath = tryKernelFromPath();
  if (fromPath) return fromPath;

  const root = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(root, 'crates', 'ecc-kernel', 'target', 'release', binName()),
    path.join(root, 'crates', 'ecc-kernel', 'target', 'debug', binName())
  ];
  for (const p of candidates) {
    if (isFile(p)) return p;
  }
  return null;
}

let _cached = null;

function getKernel() {
  if (_cached) return _cached;

  const mode = getKernelMode();
  if (mode === 'node') {
    _cached = { mode, enabled: false, bin: null };
    return _cached;
  }

  const bin = findKernelBinary();
  if (mode === 'rust' && !bin) {
    throw new Error(
      'ECC kernel required but not found. Build it with:\n' +
        '  cargo build --release --manifest-path crates/ecc-kernel/Cargo.toml\n' +
        'Then re-run, or set ECC_KERNEL=node to force JS fallback.'
    );
  }

  _cached = { mode, enabled: !!bin, bin };
  return _cached;
}

function runKernel(command, inputObj) {
  const kernel = getKernel();
  if (!kernel.enabled) return null;

  const res = spawnSync(kernel.bin, [command], {
    encoding: 'utf8',
    input: JSON.stringify(inputObj),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (res.error) {
    throw new Error(`ecc-kernel spawn failed: ${res.error.message}`);
  }
  const stdout = (res.stdout || '').trim();
  const stderr = (res.stderr || '').trim();
  if (res.status !== 0) {
    const msg = [
      `ecc-kernel ${command} failed (exit ${res.status})`,
      stderr ? `stderr:\n${stderr}` : null,
      stdout ? `stdout:\n${stdout}` : null
    ]
      .filter(Boolean)
      .join('\n\n');
    throw new Error(msg);
  }

  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    throw new Error(`ecc-kernel returned non-JSON output (${detail}). Raw:\n${stdout.slice(0, 2000)}`);
  }
}

module.exports = {
  getKernel,
  runKernel
};
