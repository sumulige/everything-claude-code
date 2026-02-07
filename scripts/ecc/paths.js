const path = require('path');

// Engine root is the repo root in this repository layout:
//   <root>/scripts/ecc.js
//   <root>/scripts/ecc/*
//   <root>/packs/*
//   <root>/prompts/ecc/*
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');

function packsDir() {
  return path.join(ENGINE_ROOT, 'packs');
}

function promptsDir() {
  return path.join(ENGINE_ROOT, 'prompts', 'ecc');
}

function schemasDir() {
  return path.join(ENGINE_ROOT, 'schemas');
}

module.exports = {
  ENGINE_ROOT,
  packsDir,
  promptsDir,
  schemasDir
};

