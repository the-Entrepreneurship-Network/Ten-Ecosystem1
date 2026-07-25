"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!token) { console.error("GITHUB_PERSONAL_ACCESS_TOKEN not set"); process.exit(1); }

// Remove stale git lock files if present
const lockFiles = [".git/config.lock", ".git/index.lock", ".git/HEAD.lock", ".git/FETCH_HEAD.lock"];
for (const lf of lockFiles) {
  const p = path.join(process.cwd(), lf);
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log("Removed stale lock:", lf); } } catch (_) {}
}

const remote = `https://${token}@github.com/vishal20034/InternshipManagementSystem-Final.git`;

try {
  console.log("Fetching from GitHub...");
  execSync(`git fetch "${remote}" main`, { stdio: "inherit" });

  console.log("Checking for differences...");
  const diff = execSync("git rev-list HEAD..FETCH_HEAD --count").toString().trim();
  console.log(`Commits behind remote: ${diff}`);

  if (diff === "0") {
    console.log("✅ Already up to date. Nothing to pull.");
    process.exit(0);
  }

  console.log("Pulling (merge) from GitHub...");
  execSync(`git -c user.email="agent@replit.com" -c user.name="Replit Agent" merge FETCH_HEAD`, { stdio: "inherit" });
  console.log("✅ Successfully pulled latest code from GitHub.");
} catch (err) {
  console.error("Pull failed:", err.message);
  process.exit(1);
}
