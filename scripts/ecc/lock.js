const fs = require('fs');

const { writeJson } = require('./json');
const { registryLockPath } = require('./project');
const { computeEmbeddedCatalogDigest } = require('./catalog');
const { validateLock, throwIfErrors } = require('./validate');

function nowIso() {
  return new Date().toISOString();
}

function buildRegistryLock({ packs }) {
  const lock = {
    version: 1,
    lockedAt: nowIso(),
    engine: { name: 'ecc' },
    catalog: { type: 'embedded', digest: computeEmbeddedCatalogDigest() },
    packs
  };
  throwIfErrors(validateLock(lock), 'registry lock');
  return lock;
}

function writeRegistryLock(projectRoot, { packs, overwrite = true }) {
  const p = registryLockPath(projectRoot);
  if (!overwrite && fs.existsSync(p)) return p;
  const lock = buildRegistryLock({ packs });
  writeJson(p, lock);
  return p;
}

module.exports = {
  buildRegistryLock,
  writeRegistryLock
};

