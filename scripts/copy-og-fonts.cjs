/**
 * Copy OG font assets into dist/og-fonts for Railway (fc-cache fallback).
 * Run as part of npm run build.
 */
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "server", "assets", "fonts");
const destDir = path.join(__dirname, "..", "dist", "og-fonts");

if (!fs.existsSync(srcDir)) {
  console.warn("[copy-og-fonts] No source fonts at", srcDir);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
let count = 0;
for (const name of fs.readdirSync(srcDir)) {
  if (!/\.(woff2?|ttf|otf)$/i.test(name)) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  count++;
}
console.log(`[copy-og-fonts] Copied ${count} file(s) to ${destDir}`);
