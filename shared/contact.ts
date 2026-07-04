import { z } from "zod";

/**
 * Topics surfaced in the /contact page dropdown. Order here is the
 * order shown to users — keep "general" first so it's the safe
 * default for visitors who aren't sure where their question fits.
 */
export const CONTACT_TOPICS = [
  "general",
  "support",
  "billing",
  "bug",
  "feature",
  "partnership",
  "legal",
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/**
 * Human-readable labels for each topic. Centralized so the email
 * subject line on the server and the dropdown label on the client
 * stay in sync — the team inbox uses these to triage.
 */
export const CONTACT_TOPIC_LABELS: Record<ContactTopic, string> = {
  general: "General question",
  support: "Account or product support",
  // Free-to-play launch: no payments accepted, so the user-facing label
  // drops "Billing". The `billing` id is kept for enum stability (server
  // email triage + any stored submissions) and for when payments return.
  billing: "Vox / credits",
  bug: "Report a bug",
  feature: "Feature suggestion",
  partnership: "Partnership / press",
  legal: "Legal / privacy",
};

/**
 * Shared validation schema for POST /api/contact. The same schema
 * runs on the client (for inline field errors) and on the server
 * (as the authoritative check) so the two can never drift.
 *
 * Limits chosen to be generous for legitimate use but tight enough
 * to bound the email payload size and discourage spam.
 */
export const contactSubmissionSchema = z.object({
  // Optional — visitors don't have to identify themselves to ask a
  // question, and logged-in users can leave it blank since their
  // username is already on file.
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal("")),

  // Required so the team can actually reply. 254 is the RFC-5321
  // max for an email address.
  email: z.string().trim().email().max(254),

  topic: z.enum(CONTACT_TOPICS),

  subject: z.string().trim().min(2).max(120),

  message: z.string().trim().min(10).max(4000),

  // Honeypot. Real users never see this field; bots that fill every
  // input get silently dropped server-side. Must be empty to pass.
  website: z.string().max(0).optional(),
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
