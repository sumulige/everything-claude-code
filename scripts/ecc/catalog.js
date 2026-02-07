const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { packsDir, promptsDir, ENGINE_ROOT } = require('./paths');

function listJsonFiles(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.json'))
    .map(e => path.join(dirAbs, e.name))
    .sort();
}

function listPromptFiles(dirAbs) {
  if (!fs.existsSync(dirAbs)) return [];
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => path.join(dirAbs, e.name))
    .sort();
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function loadPacks() {
  const files = listJsonFiles(packsDir());
  const packs = [];

  for (const filePath of files) {
    const data = readJson(filePath);
    packs.push({
      id: String(data.id || '').trim(),
      name: String(data.name || '').trim(),
      description: String(data.description || '').trim(),
      tags: Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string') : [],
      modules: Array.isArray(data.modules) ? data.modules.filter(m => typeof m === 'string') : [],
      path: filePath
    });
  }

  packs.sort((a, b) => a.id.localeCompare(b.id));
  return packs;
}

function getDefaultPacks() {
  return ['blueprint', 'forge', 'proof', 'sentinel'];
}

/**
 * Compute a digest for the embedded catalog.
 *
 * P0 definition: hash packs/*.json + prompts/ecc/*.md.
 */
function computeEmbeddedCatalogDigest() {
  const hash = crypto.createHash('sha256');

  const packFiles = listJsonFiles(packsDir());
  const promptFiles = listPromptFiles(promptsDir());
  const all = [...packFiles, ...promptFiles].sort();

  for (const filePath of all) {
    const rel = path.relative(ENGINE_ROOT, filePath).split(path.sep).join('/');
    hash.update(rel);
    hash.update('\n');
    hash.update(fs.readFileSync(filePath));
    hash.update('\n');
  }

  return `sha256:${hash.digest('hex')}`;
}

module.exports = {
  loadPacks,
  getDefaultPacks,
  computeEmbeddedCatalogDigest
};

