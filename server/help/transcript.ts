/**
 * Client transcript → the turns we will actually send. No I/O, so the
 * rules can be tested without a database or an API key.
 */
import { z } from "zod";

const MAX_MESSAGES = 8;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 2000;
const MAX_PAGE_PATH_CHARS = 160;

const transcriptSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
  pagePath: z.string().max(MAX_PAGE_PATH_CHARS).optional(),
});

export interface HelpTurn {
  role: "user" | "assistant";
  content: string;
}

export function cleanHelpText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

/**
 * Only allow relative in-app paths so a crafted pagePath cannot smuggle
 * instructions or external URLs into the model context.
 */
export function sanitizeHelpPagePath(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = cleanHelpText(raw).slice(0, MAX_PAGE_PATH_CHARS);
  if (!cleaned.startsWith("/")) return null;
  if (cleaned.includes("://") || cleaned.includes("//") || cleaned.includes("\\")) return null;
  if (!/^\/[A-Za-z0-9/_?=&%#.-]*$/.test(cleaned)) return null;
  return cleaned;
}

/** Last few turns, ending on the user's question. Rejects anything else. */
export function sanitizeHelpTranscript(input: unknown):
  | { ok: true; turns: HelpTurn[]; question: string; pagePath: string | null }
  | { ok: false; error: string } {
  const parsed = transcriptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Send a short question about how VoxDex works." };
  }

  const turns: HelpTurn[] = [];
  for (const message of parsed.data.messages) {
    const cap = message.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS;
    const content = cleanHelpText(message.content).slice(0, cap);
    if (!content) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === message.role) {
      prev.content = `${prev.content}\n${content}`.slice(0, cap);
      continue;
    }
    turns.push({ role: message.role, content });
  }

  while (turns[0]?.role === "assistant") turns.shift();
  const question = [...turns].reverse().find((turn) => turn.role === "user")?.content;
  if (!question || turns[turns.length - 1]?.role !== "user") {
    return { ok: false, error: "Send a short question about how VoxDex works." };
  }
  return {
    ok: true,
    turns: turns.slice(-MAX_MESSAGES),
    question,
    pagePath: sanitizeHelpPagePath(parsed.data.pagePath),
  };
}

export const HELP_REPLY_CHAR_CAP = MAX_ASSISTANT_CHARS;
