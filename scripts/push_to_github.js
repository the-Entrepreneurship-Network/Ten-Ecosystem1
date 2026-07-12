"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!token) { console.error("GITHUB_PERSONAL_ACCESS_TOKEN not set"); process.exit(1); }

// Remove stale git lock files if present
const lockFiles = [".git/config.lock", ".git/index.lock", ".git/HEAD.lock"];
for (const lf of lockFiles) {
  const p = path.join(process.cwd(), lf);
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log("Removed stale lock:", lf); } } catch (_) {}
}

const remote = `https://${token}@github.com/vishal20034/InternshipManagementSystem-Final.git`;

function run(cmd, desc) {
  console.log(desc || cmd);
  execSync(cmd, { stdio: "inherit" });
}

try {
  run('git -c user.email="agent@replit.com" -c user.name="Replit Agent" add -A', "Staging all changes...");

  // Check if there's anything to commit
  const status = execSync("git status --porcelain").toString().trim();
  if (!status) {
    console.log("Nothing to commit — pushing existing HEAD.");
  } else {
    run('git -c user.email="agent@replit.com" -c user.name="Replit Agent" commit -m "fix: 2-tab my-documents + fellowship mystery card + watermark removal"', "Committing...");
  }

  run(`git push "${remote}" main`, "Pushing to GitHub...");
  console.log("✅ Pushed to GitHub successfully.");
} catch (err) {
  console.error("Push failed:", err.message);
  process.exit(1);
}
