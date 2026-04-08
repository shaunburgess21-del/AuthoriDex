const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, 'client', 'src', 'components');

const FILES = [
  'PredictTab.tsx',
  'home/PredictDeckView.tsx',
  'home/VoteDeckView.tsx',
  'TrendingNowFeed.tsx',
  'VoxDexPulse.tsx',
  'LeaderboardRow.tsx',
  'UnderratedOverratedCard.tsx',
  'vote/PeoplesVoicePoll.tsx',
  'vote/InductionLeaderboardSlice.tsx',
  'comments/CardComments.tsx',
  'WhyTrendingCard.tsx',
  'UserMenu.tsx',
  'TrendingBarChart.tsx',
  'StakeModal.tsx',
  'MarketCycleHero.tsx',
  'ApprovalViralHook.tsx',
  'TrendChart.tsx',
  'curate/CurateProfileCard.tsx',
  'curate/CurateSection.tsx',
  'curate/CurateViewResultsOverlay.tsx',
  'ValueVoteModal.tsx',
  'WhyTrendingBadge.tsx',
  'MomentumSignals.tsx',
  'snap-scroll/SnapScrollActionRow.tsx',
  'CardDeckContainer.tsx',
  'ApprovalRatingInfo.tsx',
  'OverratedUnderratedWidget.tsx',
  'PlatformBlock.tsx',
  'SourceHealthBanner.tsx',
];

const C = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';

function buildTransformations() {
  return [
    // ── TEXT (opacity variants first, then hover, then plain; -500 before -300) ──

    // text-COLOR-400/80
    { p: new RegExp(`(?<![\\w:-])text-(${C})-400\\/80\\b`, 'g'),
      dk: 'dark:text-', r: (_,c) => `text-${c}-600/80 dark:text-${c}-400/80` },
    // text-COLOR-400/70
    { p: new RegExp(`(?<![\\w:-])text-(${C})-400\\/70\\b`, 'g'),
      dk: 'dark:text-', r: (_,c) => `text-${c}-600/70 dark:text-${c}-400/70` },

    // hover:text-COLOR-500
    { p: new RegExp(`(?<![\\w:-])hover:text-(${C})-500\\b`, 'g'),
      dk: 'dark:hover:text-', r: (_,c) => `hover:text-${c}-700 dark:hover:text-${c}-500` },
    // hover:text-COLOR-400
    { p: new RegExp(`(?<![\\w:-])hover:text-(${C})-400\\b`, 'g'),
      dk: 'dark:hover:text-', r: (_,c) => `hover:text-${c}-600 dark:hover:text-${c}-400` },
    // hover:text-COLOR-300
    { p: new RegExp(`(?<![\\w:-])hover:text-(${C})-300\\b`, 'g'),
      dk: 'dark:hover:text-', r: (_,c) => `hover:text-${c}-500 dark:hover:text-${c}-300` },

    // text-COLOR-500 (before -300, since -300→-500)
    { p: new RegExp(`(?<![\\w:-])text-(${C})-500\\b(?!\\/\\d)`, 'g'),
      dk: 'dark:text-', r: (_,c) => `text-${c}-700 dark:text-${c}-500` },
    // text-COLOR-400 (plain, no /opacity)
    { p: new RegExp(`(?<![\\w:-])text-(${C})-400\\b(?!\\/\\d)`, 'g'),
      dk: 'dark:text-', r: (_,c) => `text-${c}-600 dark:text-${c}-400` },
    // text-COLOR-300
    { p: new RegExp(`(?<![\\w:-])text-(${C})-300\\b(?!\\/\\d)`, 'g'),
      dk: 'dark:text-', r: (_,c) => `text-${c}-500 dark:text-${c}-300` },

    // ── BACKGROUNDS ──

    // hover:bg-COLOR-500/20
    { p: new RegExp(`(?<![\\w:-])hover:bg-(${C})-500\\/20\\b`, 'g'),
      dk: 'dark:hover:bg-', r: (_,c) => `hover:bg-${c}-500/25 dark:hover:bg-${c}-500/20` },
    // hover:bg-COLOR-500/10
    { p: new RegExp(`(?<![\\w:-])hover:bg-(${C})-500\\/10\\b`, 'g'),
      dk: 'dark:hover:bg-', r: (_,c) => `hover:bg-${c}-500/15 dark:hover:bg-${c}-500/10` },
    // bg-COLOR-500/20
    { p: new RegExp(`(?<![\\w:-])bg-(${C})-500\\/20\\b`, 'g'),
      dk: 'dark:bg-', r: (_,c) => `bg-${c}-500/25 dark:bg-${c}-500/20` },
    // bg-COLOR-500/15 (skip — this is already a light value)
    // bg-COLOR-500/10
    { p: new RegExp(`(?<![\\w:-])bg-(${C})-500\\/10\\b`, 'g'),
      dk: 'dark:bg-', r: (_,c) => `bg-${c}-500/15 dark:bg-${c}-500/10` },
    // bg-COLOR-500/8 (skip — already a light value produced by /5 rule)
    // bg-COLOR-500/5
    { p: new RegExp(`(?<![\\w:-])bg-(${C})-500\\/5\\b`, 'g'),
      dk: 'dark:bg-', r: (_,c) => `bg-${c}-500/8 dark:bg-${c}-500/5` },
    // bg-COLOR-400 (standalone, no /opacity)
    { p: new RegExp(`(?<![\\w:-])bg-(${C})-400\\b(?!\\/\\d)`, 'g'),
      dk: 'dark:bg-', r: (_,c) => `bg-${c}-600 dark:bg-${c}-400` },

    // ── BORDERS (highest opacity first to prevent cascading) ──

    // border-COLOR-500/50
    { p: new RegExp(`(?<![\\w:-])border-(${C})-500\\/50\\b`, 'g'),
      dk: 'dark:border-', r: (_,c) => `border-${c}-500/60 dark:border-${c}-500/50` },
    // border-COLOR-500/40
    { p: new RegExp(`(?<![\\w:-])border-(${C})-500\\/40\\b`, 'g'),
      dk: 'dark:border-', r: (_,c) => `border-${c}-500/50 dark:border-${c}-500/40` },
    // border-COLOR-500/30
    { p: new RegExp(`(?<![\\w:-])border-(${C})-500\\/30\\b`, 'g'),
      dk: 'dark:border-', r: (_,c) => `border-${c}-500/40 dark:border-${c}-500/30` },
    // border-COLOR-400/40
    { p: new RegExp(`(?<![\\w:-])border-(${C})-400\\/40\\b`, 'g'),
      dk: 'dark:border-', r: (_,c) => `border-${c}-500/50 dark:border-${c}-400/40` },

    // ── SHADOWS ──

    // shadow-COLOR-500/20
    { p: new RegExp(`(?<![\\w:-])shadow-(${C})-500\\/20\\b`, 'g'),
      dk: 'dark:shadow-', r: (_,c) => `shadow-${c}-500/30 dark:shadow-${c}-500/20` },
  ];
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const transforms = buildTransformations();
  const lines = content.split('\n');
  let totalReplacements = 0;

  const newLines = lines.map(originalLine => {
    let line = originalLine;

    for (const t of transforms) {
      line = line.replace(t.p, (fullMatch, color) => {
        const darkCheck = `${t.dk}${color}-`;
        if (originalLine.includes(darkCheck)) {
          return fullMatch;
        }
        totalReplacements++;
        return t.r(fullMatch, color);
      });
    }

    return line;
  });

  const result = newLines.join('\n');
  if (result !== content) {
    fs.writeFileSync(filePath, result, 'utf8');
  }
  return totalReplacements;
}

const results = {};
let grandTotal = 0;

for (const file of FILES) {
  const filePath = path.join(BASE, file);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP (missing): ${file}`);
    results[file] = 0;
    continue;
  }
  const count = processFile(filePath);
  results[file] = count;
  grandTotal += count;
  console.log(`${file}: ${count} replacements`);
}

console.log(`\n=== TOTAL: ${grandTotal} replacements across ${FILES.length} files ===\n`);
console.log(JSON.stringify(results, null, 2));
