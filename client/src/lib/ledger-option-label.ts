const RAW_OPTION = /\(\s*(option_a|option_b)\s*\)/gi;

/**
 * The credit-history API appends the stored vote id, so a matchup
 * ledger row arrives as "Elon Musk vs Mark Zuckerberg (option_b)".
 * Option display names are not on the payload. When the title is a
 * two-side matchup, map option_a / option_b onto those names.
 * Otherwise drop the raw suffix.
 */
export function resolveLedgerOptionLabel(title: string): string {
  if (!title || !/option_[ab]/i.test(title)) return title;

  const resolved = title.replace(RAW_OPTION, (full, raw: string, offset: number) => {
    const before = title.slice(0, offset).trimEnd();
    const vsAt = before.toLowerCase().lastIndexOf(" vs ");
    if (vsAt === -1) return "";
    const left = before.slice(0, vsAt).trim();
    const right = before.slice(vsAt + 4).trim();
    if (!left || !right || /\svs\s/i.test(left) || /\svs\s/i.test(right)) return "";
    const name = raw.toLowerCase() === "option_a" ? left : right;
    return `(${name})`;
  });

  return resolved.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}
