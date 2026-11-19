/**
 * Pure helpers for the help chat: reply parsing, link safety, and error
 * copy. Kept free of JSX so tests can import them directly.
 */

export type HelpBlock =
  | { type: "p"; lines: string[] }
  | { type: "ul" | "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Relative in-app paths only, so a reply can never send someone off-site. */
export function safeHelpHref(raw: string): string | null {
  const href = raw.trim();
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  if (!/^\/[A-Za-z0-9\-._~/?#=&%]*$/.test(href)) return null;
  return href;
}

/** Paragraphs and "- " / "1. " lists. Blank lines end a block. */
export function parseHelpBlocks(text: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  let current: HelpBlock | null = null;

  const close = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const listType = bullet ? "ul" : numbered ? "ol" : null;
    const item = bullet?.[1] ?? numbered?.[1];

    if (listType && item != null) {
      if (!current || current.type !== listType) {
        close();
        current = { type: listType, items: [] };
      }
      current.items.push(item);
      continue;
    }

    if (!current || current.type !== "p") {
      close();
      current = { type: "p", lines: [] };
    }
    current.lines.push(line.trim());
  }
  close();
  return blocks;
}

/** `apiRequest` throws "<status>: <body>"; surface the server's `{ error }` copy when there is one. */
export function friendlyHelpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const match = msg.match(/^\d{3}: ([\s\S]+)$/);
  if (!match) return "Couldn't reach the help chat. Check your connection and try again.";
  try {
    const body = JSON.parse(match[1]) as { error?: unknown };
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Body was plain text.
  }
  return match[1].trim().slice(0, 240) || "The help chat couldn't answer just now.";
}
