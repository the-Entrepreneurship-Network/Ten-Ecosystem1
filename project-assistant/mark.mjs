import pw from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import fs from "node:fs";
fs.mkdirSync("/home/claude/mark", { recursive: true });
const b = await chromium.launch();
for (const t of [700, 1250, 1800, 2450]) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, reducedMotion: "no-preference" });
  const p = await ctx.newPage();
  await p.goto("http://localhost:3210/", { waitUntil: "commit" });
  const t0 = Date.now();
  const w = t0 + t - Date.now();
  if (w > 0) await p.waitForTimeout(w);
  await p.screenshot({ path: `/home/claude/mark/t${t}.png` });
  await ctx.close();
}
await b.close();
console.log("ok");
