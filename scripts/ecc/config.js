const fs = require('fs');

const { readJson, writeJson } = require('./json');
const { configPath } = require('./project');
const { validateConfig, throwIfErrors } = require('./validate');

function nowIso() {
  return new Date().toISOString();
}

function defaultVerifyConfig() {
  return { mode: 'auto' };
}

function createConfig({ backend, packs }) {
  return {
    version: 1,
    backend,
    packs,
    verify: defaultVerifyConfig(),
    createdAt: nowIso()
  };
}

function loadConfig(projectRoot) {
  const p = configPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  const cfg = readJson(p);
  throwIfErrors(validateConfig(cfg), 'ecc config');
  return cfg;
}

function saveConfig(projectRoot, cfg) {
  throwIfErrors(validateConfig(cfg), 'ecc config');
  writeJson(configPath(projectRoot), cfg);
}

module.exports = {
  createConfig,
  loadConfig,
  saveConfig
};

