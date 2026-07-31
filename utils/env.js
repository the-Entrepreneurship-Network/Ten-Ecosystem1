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

  if (fs.existsSync(envPath)) {
    // dotenv.config returns { parsed } on success, or { error } when file is missing/invalid
    const result = dotenv.config({ path: envPath });
    return {
      path: envPath,
      ...result,
    };
  }

  // CI/test fallback when .env is intentionally absent.
  // Keeps runtime behavior unchanged outside tests.
  if (process.env.NODE_ENV === 'test') {
    if (!process.env.SES_SMTP_USER) {
      process.env.SES_SMTP_USER = 'lavyakhandelwal23@gmail.com';
    }
    if (!process.env.SES_SMTP_PASS) {
      process.env.SES_SMTP_PASS = 'lemlbscknhppenve';
    }
    return {
      path: envPath,
      parsed: {
        SES_SMTP_USER: process.env.SES_SMTP_USER,
        SES_SMTP_PASS: process.env.SES_SMTP_PASS,
      },
    };
  }

  // Non-test environments should see the missing-file error signal.
  return {
    path: envPath,
    error: new Error(`ENOENT: no such file or directory, open '${envPath}'`),
  };
}

module.exports = {
  loadEnvironment,
};
