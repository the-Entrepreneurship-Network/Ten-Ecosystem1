const fs = require("fs");
const path = require("path");

function findProjectRoot(startDir = process.cwd()) {
  const candidateDirs = new Set();
  const resolvedStartDir = path.resolve(startDir);
  const moduleRoot = path.resolve(__dirname, "..");

  [resolvedStartDir, moduleRoot].forEach((dir) => {
    let currentDir = path.resolve(dir);
    while (true) {
      candidateDirs.add(currentDir);
      const envPath = path.join(currentDir, ".env");
      if (fs.existsSync(envPath)) {
        return currentDir;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  });

  for (const dir of candidateDirs) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      return dir;
    }
  }

  return null;
}

function loadEnvironment(startDir = process.cwd()) {
  const projectRoot = findProjectRoot(startDir);

  if (!projectRoot) {
    return { error: "No project .env file found" };
  }

  const envPath = path.join(projectRoot, ".env");
  const envContents = fs.readFileSync(envPath, "utf8");

  for (const line of envContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }

  return { projectRoot, envPath };
}

module.exports = {
  loadEnvironment,
  findProjectRoot,
};
