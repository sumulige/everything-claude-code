const path = require('path');

const ECC_DIRNAME = '.ecc';

function eccDir(projectRoot) {
  return path.join(projectRoot, ECC_DIRNAME);
}

function configPath(projectRoot) {
  return path.join(eccDir(projectRoot), 'ecc.json');
}

function locksDir(projectRoot) {
  return path.join(eccDir(projectRoot), 'locks');
}

function runsDir(projectRoot) {
  return path.join(eccDir(projectRoot), 'runs');
}

function gitignorePath(projectRoot) {
  return path.join(eccDir(projectRoot), '.gitignore');
}

function registryLockPath(projectRoot) {
  return path.join(locksDir(projectRoot), 'registry.lock.json');
}

module.exports = {
  eccDir,
  configPath,
  locksDir,
  runsDir,
  gitignorePath,
  registryLockPath
};

