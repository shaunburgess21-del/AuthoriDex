import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Platform permissions declared by the app manifest and Capacitor plugin
 * manifests. The debug APK also contains the signature permission
 * `com.voxdex.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` from
 * androidx.core. That name is not in these sources; `tools:node="remove"`
 * in the app manifest is rejected below so it cannot be stripped.
 */
const ALLOWED = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.VIBRATE",
] as const;

const APP_MANIFEST = "android/app/src/main/AndroidManifest.xml";

interface PermissionTag {
  name: string;
  removed: boolean;
}

function permissionTags(xml: string): PermissionTag[] {
  const tags: PermissionTag[] = [];
  const re = /<uses-permission(?:-sdk-23)?\b([^>]*?)\/?>/g;
  for (const match of xml.matchAll(re)) {
    const attrs = match[1] ?? "";
    const name = /android:name="([^"]+)"/.exec(attrs)?.[1];
    if (!name) continue;
    tags.push({
      name,
      removed: /tools:node="remove"/.test(attrs),
    });
  }
  return tags;
}

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
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

test("the app manifest declares INTERNET and does not strip plugin permissions", () => {
  const tags = permissionTags(read(APP_MANIFEST));
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ["android.permission.INTERNET"],
  );
  assert.equal(tags.some((tag) => tag.removed), false);
  assert.equal(read(APP_MANIFEST).includes('tools:node="remove"'), false);
});

test("Capacitor plugin manifests merge only network state and vibrate", () => {
  const rels = pluginManifestRels();
  assert.ok(rels.length >= 8, `expected Capacitor plugin manifests, found ${rels.length}`);

  const merged = new Set<string>(["android.permission.INTERNET"]);
  for (const rel of rels) {
    for (const tag of permissionTags(read(rel))) {
      assert.equal(tag.removed, false, `${rel} removes ${tag.name}`);
      merged.add(tag.name);
    }
  }

  assert.deepEqual([...merged].sort(), [...ALLOWED].sort());
});

test("client code does not request runtime permissions the shell does not declare", () => {
  const forbidden = [
    "requestPermissions(",
    "navigator.geolocation",
    "getUserMedia",
    "Notification.requestPermission",
    "@capacitor/camera",
    "@capacitor/geolocation",
    "@capacitor/push-notifications",
    "@capacitor/local-notifications",
  ];
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(abs, "utf8");
      for (const needle of forbidden) {
        if (text.includes(needle)) hits.push(`${abs} contains ${needle}`);
      }
    }
  }

  walk(join(root, "client/src"));
  assert.deepEqual(hits, []);
});
