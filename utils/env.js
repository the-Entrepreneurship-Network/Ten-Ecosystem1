const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function findProjectRoot(startDir) {
  let current = startDir;
  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Fallback: repository structure in this project has utils/ under root
      return path.resolve(__dirname, '..');
    }
    current = parent;
  }
}

function loadEnvironment() {
  const projectRoot = findProjectRoot(__dirname);
  const envPath = path.join(projectRoot, '.env');

  // dotenv.config returns { parsed } on success, or { error } when file is missing/invalid
  const result = dotenv.config({ path: envPath });

  return {
    path: envPath,
    ...result,
  };
}

module.exports = {
  loadEnvironment,
};
