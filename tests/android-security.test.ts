import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ANDROID_SHARE_CACHE_DIR } from "../client/src/lib/nativeShare.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BACKUP_DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
] as const;

const APP_LINK_PATHS = [
  'android:path="/"',
  'android:path="/vote"',
  'android:path="/predict"',
  'android:pathPrefix="/person/"',
  'android:pathPrefix="/polls/"',
  'android:pathPrefix="/vote/matchups/"',
  'android:pathPrefix="/vote/opinion-polls/"',
  'android:pathPrefix="/predict/updown/"',
  'android:pathPrefix="/predict/h2h/"',
  'android:pathPrefix="/predict/race/"',
  'android:pathPrefix="/markets/"',
  'android:pathPrefix="/share/bet/"',
  'android:pathPrefix="/u/"',
] as const;

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

function pluginManifestRels(): string[] {
  const settings = read("android/capacitor.settings.gradle");
  const rels: string[] = [];
  const re = /projectDir = new File\('([^']+)'\)/g;
  for (const match of settings.matchAll(re)) {
    const projectDir = match[1];
    if (!projectDir) continue;
    rels.push(join("android", projectDir, "src/main/AndroidManifest.xml"));
  }
  return rels;
}

function excludeDomains(block: string): string[] {
  const domains: string[] = [];
  const re = /<exclude\b([^>]*?)\/>/g;
  for (const match of block.matchAll(re)) {
    const attrs = match[1] ?? "";
    const domain = /domain="([^"]+)"/.exec(attrs)?.[1];
    const path = /path="([^"]+)"/.exec(attrs)?.[1];
    assert.equal(path, ".", `exclude for ${domain ?? "unknown"} must use path="."`);
    assert.ok(domain, "exclude is missing domain");
    domains.push(domain);
  }
  return domains.sort();
}

function section(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  assert.ok(match, `missing <${tag}>`);
  return match[1] ?? "";
}

test("backup is disabled for cloud and device transfer", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /android:allowBackup="true"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);

  const legacy = stripXmlComments(read("android/app/src/main/res/xml/backup_rules.xml"));
  assert.equal(legacy.includes("<include"), false);
  assert.deepEqual(excludeDomains(section(legacy, "full-backup-content")), [...BACKUP_DOMAINS].sort());

  const modern = stripXmlComments(read("android/app/src/main/res/xml/data_extraction_rules.xml"));
  assert.equal(modern.includes("<include"), false);
  assert.equal(modern.includes("<cross-platform-transfer"), false);
  assert.deepEqual(excludeDomains(section(modern, "cloud-backup")), [...BACKUP_DOMAINS].sort());
  assert.deepEqual(excludeDomains(section(modern, "device-transfer")), [...BACKUP_DOMAINS].sort());
});

test("cleartext is off and only system CAs are trusted", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.doesNotMatch(manifest, /android:usesCleartextTraffic="true"/);

  const config = read("android/app/src/main/res/xml/network_security_config.xml");
  assert.match(config, /cleartextTrafficPermitted="false"/);
  assert.doesNotMatch(config, /cleartextTrafficPermitted="true"/);
  assert.match(config, /<certificates src="system" \/>/);
  assert.doesNotMatch(config, /src="user"/);
  assert.equal(config.includes("<debug-overrides"), false);
  assert.equal(config.includes("<domain-config"), false);
});

test("FileProvider is not exported and only covers the share cache directory", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.match(
    manifest,
    /android:name="androidx\.core\.content\.FileProvider"[\s\S]*?android:authorities="\$\{applicationId\}\.fileprovider"[\s\S]*?android:exported="false"[\s\S]*?android:grantUriPermissions="true"/,
  );
  assert.equal((manifest.match(/<provider\b/g) ?? []).length, 1);

  const paths = read("android/app/src/main/res/xml/file_paths.xml");
  assert.equal((paths.match(/<cache-path\b/g) ?? []).length, 1);
  assert.match(paths, new RegExp(`<cache-path\\b[^>]*path="${ANDROID_SHARE_CACHE_DIR}"`));
  for (const tag of [
    "external-path",
    "external-files-path",
    "external-cache-path",
    "external-media-path",
    "files-path",
    "root-path",
  ]) {
    assert.equal(paths.includes(`<${tag}`), false, `file_paths still has <${tag}>`);
  }
  assert.doesNotMatch(paths, /path="\."/);

  const share = read("client/src/lib/nativeShare.ts");
  assert.match(share, /directory:\s*Directory\.Cache/);
  assert.match(share, /\$\{ANDROID_SHARE_CACHE_DIR\}\//);
  assert.equal(share.includes("Directory.External"), false);
  assert.equal(share.includes("Directory.Documents"), false);
  assert.equal(share.includes("Directory.ExternalStorage"), false);
  assert.equal(ANDROID_SHARE_CACHE_DIR, "share");
});

test("deep links stay on the OAuth host and the Phase 7 App Link paths", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  assert.equal((manifest.match(/android:exported="true"/g) ?? []).length, 1);
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
  assert.equal((manifest.match(/<activity\b/g) ?? []).length, 1);
  assert.equal(manifest.includes("<service"), false);
  assert.equal(manifest.includes("<receiver"), false);
  assert.equal(manifest.includes("android:debuggable"), false);

  assert.match(manifest, /<data android:scheme="com\.voxdex\.app" android:host="login" \/>/);
  assert.equal((manifest.match(/android:scheme="com\.voxdex\.app"/g) ?? []).length, 1);
  assert.equal(manifest.includes('android:scheme="http"'), false);
  assert.equal(manifest.includes('android:host="*"'), false);
  assert.equal(manifest.includes("pathPrefix=\"/\""), false);
  assert.equal(manifest.includes('android:host="www.voxdex.com"'), false);

  const verified = /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/.exec(manifest)?.[1];
  assert.ok(verified, "missing autoVerify App Link filter");
  assert.equal((manifest.match(/android:autoVerify="true"/g) ?? []).length, 1);
  const dataTags = [...verified.matchAll(/<data\b([^>]*?)\/>/g)].map((match) => (match[1] ?? "").trim());
  assert.equal(dataTags.length, APP_LINK_PATHS.length);
  for (const [index, attrs] of dataTags.entries()) {
    assert.match(attrs, /android:scheme="https"/);
    assert.match(attrs, /android:host="voxdex\.com"/);
    const expected = APP_LINK_PATHS[index];
    assert.ok(expected);
    assert.equal(attrs.endsWith(expected), true, attrs);
  }
});

test("Capacitor config does not opt into cleartext, mixed content, or release debugging", () => {
  const config = read("capacitor.config.ts");
  assert.match(config, /androidScheme:\s*"https"/);
  assert.equal(config.includes("url:"), false);
  assert.equal(config.includes("allowNavigation"), false);
  assert.equal(config.includes("allowMixedContent"), false);
  assert.equal(config.includes("webContentsDebuggingEnabled"), false);

  const activity = read("android/app/src/main/java/com/voxdex/app/MainActivity.java");
  for (const call of [
    "setWebContentsDebuggingEnabled",
    "setAllowFileAccessFromFileURLs",
    "setAllowUniversalAccessFromFileURLs",
    "setMixedContentMode",
    "setAllowFileAccess(",
  ]) {
    assert.equal(activity.includes(call), false, `MainActivity calls ${call}`);
  }
});

test("release minify stays off and the Android tree has no embedded secrets", () => {
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /minifyEnabled false/);
  assert.equal(gradle.includes("debuggable true"), false);
  assert.equal(gradle.includes("storePassword"), false);
  assert.equal(gradle.includes("keyPassword"), false);
  assert.equal(gradle.includes("signingConfig"), false);

  const secret =
    /AIza[0-9A-Za-z_-]{20,}|-----BEGIN |sk_live_|service_role|storePassword|keyPassword/;
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === "build" || entry === ".gradle") continue;
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(xml|gradle|properties|java|pro|md)$/.test(entry)) continue;
      const text = readFileSync(abs, "utf8");
      if (secret.test(text)) hits.push(abs);
    }
  }

  walk(join(root, "android"));
  assert.deepEqual(hits, []);
});

test("Capacitor plugin manifests do not export components or allow cleartext", () => {
  const rels = pluginManifestRels();
  assert.ok(rels.length >= 8, `expected Capacitor plugin manifests, found ${rels.length}`);
  for (const rel of rels) {
    const xml = read(rel);
    assert.equal(xml.includes('android:exported="true"'), false, `${rel} exports a component`);
    assert.equal(xml.includes('android:usesCleartextTraffic="true"'), false, rel);
    assert.equal(xml.includes("android:debuggable"), false, rel);
    assert.equal(xml.includes("<service"), false, rel);
    assert.equal(xml.includes("<receiver"), false, rel);
  }
});
