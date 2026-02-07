const codex = require('./codex');
const mock = require('./mock');

function getProvider({ backend }) {
  const env = String(process.env.ECC_PROVIDER || '').trim().toLowerCase();
  if (env) {
    if (env === 'mock') return mock;
    if (env === 'codex') return codex;
    throw new Error(`Unknown ECC_PROVIDER: ${env}`);
  }

  if (backend === 'codex') return codex;
  if (backend === 'claude') {
    throw new Error('ECC P0: backend "claude" is not implemented yet (use backend "codex")');
  }

  throw new Error(`Unknown backend: ${backend}`);
}

module.exports = {
  getProvider
};

