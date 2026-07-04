/**
 * Copy email inline assets into dist/email-assets for bundled server runtime.
 * Run as part of npm run build.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "public", "voxdex-logo-email.png");
const destDir = path.join(__dirname, "..", "dist", "email-assets");
const dest = path.join(destDir, "voxdex-logo-email.png");

if (!fs.existsSync(src)) {
  console.warn("[copy-email-assets] No source logo at", src);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[copy-email-assets] Copied logo to ${dest}`);
