/**
 * Audit all social-media handles on tracked_people and produce two outputs:
 *
 *   tmp/social-audit/all-handles.csv          (+ .md mirror)
 *   tmp/social-audit/suspicious-handles.csv   (+ .md mirror)
 *
 * "All" = every (person, platform, handle) pair currently in the DB, with a
 * direct clickable URL and a column for your verdict.
 *
 * "Suspicious" = the subset auto-flagged by heuristics (fan-account keywords,
 * zero name-token overlap, parody/archive markers, etc.) so a verifier can
 * focus attention where it's most likely needed.
 *
 * YouTube channel IDs and Spotify artist IDs are opaque strings, so we don't
 * auto-flag them — they appear in the all-handles file only, for manual spot
 * checks against the target person.
 *
 * The outputs are intentionally human-editable: add a verdict column
 * (keep / replace / remove) and feed the file back to apply-handle-verdicts
 * (future script) or fix entries one-off via the admin UI.
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/audit-social-handles.ts
 */

import { promises as fs } from "fs";
import path from "path";
import { db, pool } from "../db";
import { trackedPeople } from "@shared/schema";

type PlatformKey = "xHandle" | "instagramHandle" | "tiktokHandle" | "youtubeId" | "spotifyId";

type PlatformConfig = {
  key: PlatformKey;
  label: string;
  urlFor: (handle: string) => string;
  // Whether we can reason about authenticity from the handle string alone.
  heuristicsApply: boolean;
};

const PLATFORMS: PlatformConfig[] = [
  {
    key: "xHandle",
    label: "X",
    urlFor: h => `https://x.com/${h}`,
    heuristicsApply: true,
  },
  {
    key: "instagramHandle",
    label: "Instagram",
    urlFor: h => `https://instagram.com/${h}`,
    heuristicsApply: true,
  },
  {
    key: "tiktokHandle",
    label: "TikTok",
    urlFor: h => `https://www.tiktok.com/@${h}`,
    heuristicsApply: true,
  },
  {
    key: "youtubeId",
    label: "YouTube",
    urlFor: h => `https://www.youtube.com/channel/${h}`,
    heuristicsApply: false,
  },
  {
    key: "spotifyId",
    label: "Spotify",
    urlFor: h => `https://open.spotify.com/artist/${h}`,
    heuristicsApply: false,
  },
];

// ---------- Heuristics ----------

// Substring markers (lowercased) that strongly suggest a fan / parody / archive
// account rather than the person's official profile.
const FAN_MARKERS = [
  "fanpage", "fan_page", "fanclub", "fan_club", "fandom",
  "fans_of", "fansof", "_fans", "fans_", ".fans", "_fan_", "_fan.",
  "unofficial", "notreal", "not_real", "parody",
  "stan_", "_stan", "stans_",
  "daily", "updates_", "_updates", "archive", "archives",
  "tribute", "loveof", "lovers_", "_lovers",
  "pics_", "_pics", "pictures_", "edits_", "_edits",
  "fake", "impersonat",
];

// Generic stopwords that shouldn't count as name tokens.
const NAME_STOPWORDS = new Set([
  "the", "jr", "sr", "ii", "iii", "iv", "dr", "sir", "lord", "lady", "mr", "mrs", "ms",
  "de", "del", "la", "le", "von", "van", "di", "da", "al",
]);

type FlagReason =
  | "fan_marker"
  | "team_prefix"
  | "no_name_overlap"
  | "trailing_digits"
  | "underscore_official"
  | "generic_word";

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

function tokenizeHandle(handle: string): string[] {
  return handle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2);
}

function hasNameOverlap(name: string, handle: string): boolean {
  const nameTokens = tokenizeName(name);
  if (nameTokens.length === 0) return true; // give benefit of the doubt
  const handleTokens = tokenizeHandle(handle);
  if (handleTokens.length === 0) return false;
  const handleJoined = handleTokens.join("");
  for (const nt of nameTokens) {
    // Full token match or substring match (handles initials/smushing).
    if (handleTokens.some(ht => ht === nt || ht.includes(nt) || nt.includes(ht))) return true;
    if (handleJoined.includes(nt)) return true;
  }
  return false;
}

function flagReasons(name: string, handle: string): FlagReason[] {
  const reasons: FlagReason[] = [];
  const lower = handle.toLowerCase();

  if (FAN_MARKERS.some(m => lower.includes(m))) reasons.push("fan_marker");
  // For individuals, "team<name>" is almost always a fan / campaign-shell page
  // (e.g. @teamjdvance, @teamkanye). Official org accounts fit a different
  // pattern and aren't stored against individuals in tracked_people.
  if (/^team[_.]?[a-z]/i.test(handle)) reasons.push("team_prefix");
  if (!hasNameOverlap(name, handle)) reasons.push("no_name_overlap");
  // Trailing digits after an alpha handle often indicate clones/fans.
  if (/^[a-z_][a-z_]*[0-9]{2,}$/i.test(handle)) reasons.push("trailing_digits");
  // "_official" is usually a tell for a tribute/fan page claiming official status.
  if (/official(?!ly)/i.test(handle) && !/^[a-z0-9]+official$/i.test(handle)) {
    reasons.push("underscore_official");
  }
  if (/^(news|update|updates|daily|official|real|the)$/i.test(handle)) reasons.push("generic_word");

  return reasons;
}

// ---------- CSV / Markdown writers ----------

const COLUMNS = [
  "person",
  "category",
  "platform",
  "handle",
  "url",
  "auto_flagged",
  "flag_reasons",
  "verdict",
  "replacement_handle",
  "notes",
] as const;

type Row = {
  person: string;
  category: string;
  platform: string;
  handle: string;
  url: string;
  auto_flagged: "yes" | "no";
  flag_reasons: string;
  verdict: "";
  replacement_handle: "";
  notes: "";
};

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: Row[]): string {
  const header = COLUMNS.join(",");
  const body = rows
    .map(r => COLUMNS.map(c => escapeCsv(String((r as Record<string, string>)[c] ?? ""))).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function toMarkdown(rows: Row[], title: string): string {
  const header = `| ${COLUMNS.join(" | ")} |`;
  const divider = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows
    .map(r => `| ${COLUMNS.map(c => escapeMd(String((r as Record<string, string>)[c] ?? ""))).join(" | ")} |`)
    .join("\n");
  return `# ${title}\n\nGenerated ${new Date().toISOString()}\n\nTotal rows: ${rows.length}\n\n${header}\n${divider}\n${body}\n`;
}

// ---------- Main ----------

async function main() {
  const outDir = path.resolve(process.cwd(), "tmp", "social-audit");
  await fs.mkdir(outDir, { recursive: true });

  const people = await db.select().from(trackedPeople);
  console.log(`Auditing ${people.length} tracked people across ${PLATFORMS.length} platforms...`);

  const allRows: Row[] = [];
  const suspiciousRows: Row[] = [];

  for (const person of people) {
    for (const platform of PLATFORMS) {
      const handle = person[platform.key];
      if (!handle) continue;

      let autoFlagged = false;
      let reasons: FlagReason[] = [];
      if (platform.heuristicsApply) {
        reasons = flagReasons(person.name, handle);
        autoFlagged = reasons.length > 0;
      }

      const row: Row = {
        person: person.name,
        category: person.category ?? "",
        platform: platform.label,
        handle,
        url: platform.urlFor(handle),
        auto_flagged: autoFlagged ? "yes" : "no",
        flag_reasons: reasons.join("|"),
        verdict: "",
        replacement_handle: "",
        notes: "",
      };

      allRows.push(row);
      if (autoFlagged) suspiciousRows.push(row);
    }
  }

  // Sort for stable diffs: by person name, then by platform column order.
  const platformOrder = new Map(PLATFORMS.map((p, i) => [p.label, i]));
  const sortFn = (a: Row, b: Row) => {
    const byName = a.person.localeCompare(b.person);
    if (byName !== 0) return byName;
    return (platformOrder.get(a.platform) ?? 0) - (platformOrder.get(b.platform) ?? 0);
  };
  allRows.sort(sortFn);
  suspiciousRows.sort(sortFn);

  // Write CSVs.
  const allCsvPath = path.join(outDir, "all-handles.csv");
  const suspiciousCsvPath = path.join(outDir, "suspicious-handles.csv");
  await fs.writeFile(allCsvPath, toCsv(allRows), "utf8");
  await fs.writeFile(suspiciousCsvPath, toCsv(suspiciousRows), "utf8");

  // Write Markdown mirrors (backup format).
  const allMdPath = path.join(outDir, "all-handles.md");
  const suspiciousMdPath = path.join(outDir, "suspicious-handles.md");
  await fs.writeFile(allMdPath, toMarkdown(allRows, "All social handles"), "utf8");
  await fs.writeFile(
    suspiciousMdPath,
    toMarkdown(suspiciousRows, "Suspicious social handles (auto-flagged)"),
    "utf8",
  );

  // ---------- Summary ----------

  const line = "-".repeat(70);
  console.log(`\n${line}`);
  console.log("AUDIT SUMMARY");
  console.log(line);
  console.log(`People scanned:        ${people.length}`);
  console.log(`Handle rows total:     ${allRows.length}`);
  console.log(`Auto-flagged subset:   ${suspiciousRows.length}`);

  // Per-platform counts.
  console.log(`\nBy platform:`);
  for (const p of PLATFORMS) {
    const total = allRows.filter(r => r.platform === p.label).length;
    const flagged = suspiciousRows.filter(r => r.platform === p.label).length;
    const flaggedLabel = p.heuristicsApply ? `${flagged} flagged` : "heuristics N/A";
    console.log(`  ${p.label.padEnd(10)} ${String(total).padStart(3)} total   ${flaggedLabel}`);
  }

  // Reason frequency.
  if (suspiciousRows.length > 0) {
    const reasonCount = new Map<string, number>();
    for (const r of suspiciousRows) {
      for (const reason of r.flag_reasons.split("|").filter(Boolean)) {
        reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);
      }
    }
    console.log(`\nFlag reason breakdown:`);
    for (const [reason, count] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason.padEnd(22)} ${count}`);
    }
  }

  console.log(`\nOutputs written to: ${outDir}`);
  console.log(`  - all-handles.csv         (${allRows.length} rows)`);
  console.log(`  - all-handles.md          (markdown mirror)`);
  console.log(`  - suspicious-handles.csv  (${suspiciousRows.length} rows)`);
  console.log(`  - suspicious-handles.md   (markdown mirror)`);
  console.log(line);
  console.log("Next: feed suspicious-handles.csv to your verification agent,");
  console.log("fill in the 'verdict' column (keep / replace / remove) and the");
  console.log("'replacement_handle' when relevant, then hand it back to apply.");
  console.log(line);
}

main()
  .catch(err => {
    console.error("Audit failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
