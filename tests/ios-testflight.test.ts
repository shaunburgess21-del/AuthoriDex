import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

type Png = {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  pixels: Buffer;
};

function readPng(rel: string): Png {
  const buf = readFileSync(join(root, rel));
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${rel} is not a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  let hasTrns = false;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? -1;
      colorType = data[9] ?? -1;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "tRNS") {
      hasTrns = true;
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(bitDepth, 8, `${rel} bit depth`);
  assert.equal(hasTrns, false, `${rel} has a tRNS chunk`);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : -1;
  assert.ok(channels > 0, `${rel} color type ${colorType} is not RGB or RGBA`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src];
    src += 1;
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    if (filter === 1) {
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? row[x - channels]! : 0;
        row[x] = (row[x]! + left) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) row[x] = (row[x]! + prev[x]!) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? row[x - channels]! : 0;
        row[x] = (row[x]! + Math.floor((left + prev[x]!) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? row[x - channels]! : 0;
        const b = prev[x]!;
        const c = x >= channels ? prev[x - channels]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[x] = (row[x]! + pr) & 255;
      }
    } else if (filter !== 0) {
      assert.fail(`${rel} unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  return { width, height, colorType, channels, pixels };
}

function pixel(png: Png, x: number, y: number): number[] {
  const i = (y * png.width + x) * png.channels;
  return Array.from(png.pixels.subarray(i, i + png.channels));
}

function buildConfig(pbx: string, id: string): string {
  const marker = `${id} /*`;
  const start = pbx.indexOf(marker);
  assert.ok(start >= 0, `missing build config ${id}`);
  const end = pbx.indexOf("\n\t\t};", start);
  assert.ok(end > start, `unclosed build config ${id}`);
  return pbx.slice(start, end);
}

test("App Store icon is the opaque 1024 VoxDex mark", () => {
  const png = readPng("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");
  assert.equal(png.width, 1024);
  assert.equal(png.height, 1024);
  assert.equal(png.colorType, 2, "App Store rejects an alpha channel");
  assert.deepEqual(pixel(png, 0, 0), [6, 182, 212]);
  assert.deepEqual(pixel(png, 1023, 1023), [37, 99, 235]);
  const center = pixel(png, 512, 512);
  assert.ok(center[0]! > 230 && center[1]! > 240 && center[2]! > 240, "cube highlight");
  const contents = read("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json");
  assert.match(contents, /AppIcon-1024\.png/);
  assert.doesNotMatch(contents, /AppIcon-512@2x\.png/);
});

test("launch screen centers the brand mark on the dark splash color", () => {
  for (const [rel, size] of [
    ["ios/App/App/Assets.xcassets/Splash.imageset/splash-logo.png", 160],
    ["ios/App/App/Assets.xcassets/Splash.imageset/splash-logo@2x.png", 320],
    ["ios/App/App/Assets.xcassets/Splash.imageset/splash-logo@3x.png", 480],
  ] as const) {
    const png = readPng(rel);
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    assert.equal(png.colorType, 2, "launch image is opaque RGB");
    assert.deepEqual(pixel(png, 0, 0), [15, 23, 42]);
    const center = pixel(png, Math.floor(size / 2), Math.floor(size / 2));
    assert.ok(center[0]! > 230 && center[1]! > 240 && center[2]! > 240, "cube is centered");
  }
  const contents = read("ios/App/App/Assets.xcassets/Splash.imageset/Contents.json");
  assert.match(contents, /"idiom" : "universal"/);
  assert.match(contents, /"idiom" : "ipad"/);
  assert.match(contents, /splash-logo@2x\.png/);
  const storyboard = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
  assert.match(storyboard, /image="Splash"/);
  assert.match(storyboard, /centerX/);
  assert.match(storyboard, /centerY/);
  assert.match(storyboard, /constant="160"/);
  assert.match(storyboard, /red="0\.058823529411764705"/);
  assert.match(storyboard, /green="0\.09019607843137255"/);
  assert.match(storyboard, /blue="0\.16470588235294117"/);
  assert.doesNotMatch(storyboard, /systemBackgroundColor/);
  assert.doesNotMatch(storyboard, /name="SplashBackground"/);
  const ids = [...storyboard.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "");
  const objectIds = ids.filter((id) => id.includes("-"));
  assert.ok(objectIds.length >= 8);
  for (const id of objectIds) {
    assert.match(id, /^[A-Za-z0-9]{3}-[A-Za-z0-9]{2,3}-[A-Za-z0-9]{3}$/, id);
  }
  const colorset = read("ios/App/App/Assets.xcassets/SplashBackground.colorset/Contents.json");
  assert.equal(colorset.match(/"red" : "0x0F"/g)?.length, 2);
  assert.equal(colorset.match(/"green" : "0x17"/g)?.length, 2);
  assert.equal(colorset.match(/"blue" : "0x2A"/g)?.length, 2);
  assert.match(colorset, /"value" : "dark"/);
});

test("version, encryption, portrait iPhone, and camera purpose string", () => {
  const plist = read("ios/App/App/Info.plist");
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>VoxDex<\/string>/);
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(plist, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>/);
  assert.doesNotMatch(plist, /armv7/);
  assert.match(
    plist,
    /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/,
  );
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
  assert.match(plist, /attach an image to a poll or a custom contender/);
  for (const unused of [
    "NSPhotoLibraryUsageDescription",
    "NSPhotoLibraryAddUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
    "NSUserTrackingUsageDescription",
    "NSContactsUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSAppTransportSecurity",
    "NSAllowsArbitraryLoads",
    "NSAllowsLocalNetworking",
    "NSExceptionDomains",
    "localhost",
  ]) {
    assert.equal(plist.includes(unused), false, unused);
  }
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const release = buildConfig(pbx, "504EC3181FED79650016851F");
  assert.match(release, /MARKETING_VERSION = 1\.0;/);
  assert.match(release, /CURRENT_PROJECT_VERSION = 1;/);
  assert.match(release, /PRODUCT_BUNDLE_IDENTIFIER = com\.voxdex\.app;/);
  assert.match(release, /CAPACITOR_DEBUG = false;/);
  const debug = buildConfig(pbx, "504EC3171FED79650016851F");
  assert.match(debug, /MARKETING_VERSION = 1\.0;/);
  assert.match(debug, /debug\.xcconfig/);
  assert.doesNotMatch(release, /debug\.xcconfig/);
  assert.equal(pbx.includes("DEVELOPMENT_TEAM"), false);
  assert.equal(pbx.includes("PROVISIONING_PROFILE"), false);
  assert.equal(pbx.includes("CODE_SIGN_ENTITLEMENTS"), false);
  assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/);
});

test("privacy manifest lists account data and the filesystem timestamp reason", () => {
  const privacy = read("ios/App/App/PrivacyInfo.xcprivacy");
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  for (const type of [
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypeUserID",
    "NSPrivacyCollectedDataTypeOtherUserContent",
  ]) {
    assert.ok(privacy.includes(type), type);
  }
  assert.equal(privacy.match(/NSPrivacyCollectedDataTypePurposeAppFunctionality/g)?.length, 3);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryFileTimestamp/);
  assert.match(privacy, /<string>C617\.1<\/string>/);
  assert.equal(privacy.includes("NSPrivacyAccessedAPICategoryUserDefaults"), false);
  assert.equal(privacy.includes("CA92.1"), false);
});

test("Capacitor config has no release server or cleartext override", () => {
  const config = read("capacitor.config.ts");
  assert.match(config, /appId:\s*"com\.voxdex\.app"/);
  assert.match(config, /androidScheme:\s*"https"/);
  assert.match(config, /backgroundColor:\s*"#0F172A"/);
  assert.match(config, /ios:\s*\{[^}]*backgroundColor:\s*"#0F172A"/s);
  assert.doesNotMatch(config, /url\s*:/);
  assert.doesNotMatch(config, /cleartext/);
  assert.doesNotMatch(config, /iosScheme/);
  assert.doesNotMatch(config, /allowNavigation/);
  assert.equal(read("ios/debug.xcconfig").trim(), "CAPACITOR_DEBUG = true");

  const html = read("client/index.html");
  const vite = read("vite.config.ts");
  assert.match(vite, /native-first-paint/);
  assert.match(vite, /background-color: #0F172A/);
  assert.match(vite, /if \(!capacitorBuild\) return html/);
  assert.match(html, /if \(saved !== "light"\)/);
  const css = read("client/src/index.css");
  assert.match(css, /html \{\s*background-color: hsl\(var\(--background\)\);/);
  assert.match(css, /html\[data-quick-vote-nudge="open"\] \.home-shell/);
});
