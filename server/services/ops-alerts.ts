/**
 * Channel-agnostic operations alert dispatcher.
 *
 * One place every ops/admin alert flows through. Today it dispatches via
 * email (Resend, through the shared `sendEmail()` pipeline). It is built
 * channel-agnostic on purpose: adding Discord/Slack later is a single new
 * branch in `dispatch()` + one env var — callers and the alert shape never
 * change.
 *
 * Used by:
 *   - server/jobs/market-ops-digest.ts  (daily World Market reminders)
 *   - server/jobs/market-resolver.ts    (instant "needs resolution" ping)
 *   - server/jobs/resolution-scout.ts   (AI early-resolution proposals)
 *   - server/services/ingest-provider-alert-runner.ts (news API outage alerts)
 *
 * Recipients come from OPS_ALERT_EMAILS (comma-separated). If unset, the
 * dispatcher logs a warning and no-ops — alerts must never throw into the
 * jobs that call them.
 */

import * as React from "react";

import { log } from "../log";
import { sendEmail } from "../emails/send";
import {
  OpsAlertEmail,
  type OpsAlertSection,
  type OpsAlertItem,
  type OpsAlertSeverity,
} from "../emails/templates/lifecycle/OpsAlertEmail";

export type { OpsAlertSection, OpsAlertItem, OpsAlertSeverity };

export interface OpsAlert {
  /** Stable identifier for the alert type, e.g. "market_ops_digest". */
  kind: string;
  severity: OpsAlertSeverity;
  /** Short headline (also used as the email subject after the prefix). */
  title: string;
  /** One-line summary / inbox preview. */
  summary?: string;
  sections?: OpsAlertSection[];
  /** Primary call-to-action link (defaults to the admin dashboard). */
  ctaUrl?: string;
  ctaLabel?: string;
  /**
   * Base for per-recipient email idempotency keys. Include a date for
   * daily digests (e.g. "market_ops_digest:2026-06-24") so the same digest
   * can't double-send across replicas / cron retries on the same day.
   */
  idempotencyKeyBase?: string;
}

export interface OpsAlertResult {
  delivered: number;
  skipped: number;
  failed: number;
  channels: string[];
}

const SUBJECT_PREFIX = "[VoxDex Ops]";

/** Recipients for ops alerts. Comma/space/semicolon separated. */
export function getOpsAlertRecipients(): string[] {
  const raw = process.env.OPS_ALERT_EMAILS ?? "";
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const addr = part.trim();
    if (!addr || !addr.includes("@")) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(addr);
  }
  return recipients;
}

/** Base URL for admin deep-links in alerts. */
export function getAdminBaseUrl(): string {
  const base =
    process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://voxdex.com";
  return base.replace(/\/+$/, "");
}

/** Convenience: deep link to the admin dashboard (Settlement lives there). */
export function adminDashboardUrl(): string {
  return `${getAdminBaseUrl()}/admin`;
}

/** Deep link to the World Markets tab of the Prediction CMS. */
export function adminWorldMarketsUrl(): string {
  return `${getAdminBaseUrl()}/admin?section=predictions&tab=real-world`;
}

/**
 * Deep link that opens the admin panel with the resolve dialog already open
 * for the given market — one tap from the ops email to settling on a phone.
 */
export function adminResolveMarketUrl(marketId: string): string {
  return `${adminWorldMarketsUrl()}&resolve=${encodeURIComponent(marketId)}`;
}

/** Plain-text rendering — used as the email text fallback and by future
 *  chat channels (Discord/Slack). */
export function renderOpsAlertText(alert: OpsAlert): string {
  const lines: string[] = [];
  lines.push(`${SUBJECT_PREFIX} ${alert.title}`);
  if (alert.summary) lines.push(alert.summary);
  for (const section of alert.sections ?? []) {
    lines.push("");
    const count = section.items.length;
    lines.push(
      `${section.emoji ? `${section.emoji} ` : ""}${section.heading}${count ? ` (${count})` : ""}`,
    );
    if (count === 0) {
      lines.push(`  ${section.emptyText || "Nothing here right now."}`);
      continue;
    }
    for (const item of section.items) {
      lines.push(`  • ${item.text}${item.detail ? ` — ${item.detail}` : ""}`);
      if (item.url) lines.push(`    ${item.url}`);
    }
  }
  if (alert.ctaUrl) {
    lines.push("");
    lines.push(`${alert.ctaLabel || "Open admin dashboard"}: ${alert.ctaUrl}`);
  }
  return lines.join("\n");
}

async function dispatchEmail(alert: OpsAlert): Promise<OpsAlertResult> {
  const result: OpsAlertResult = {
    delivered: 0,
    skipped: 0,
    failed: 0,
    channels: ["email"],
  };

  const recipients = getOpsAlertRecipients();
  if (recipients.length === 0) {
    log(
      `[OpsAlerts] No recipients configured (set OPS_ALERT_EMAILS) — dropping "${alert.kind}".`,
    );
    result.skipped += 1;
    return result;
  }

  const ctaUrl = alert.ctaUrl ?? adminDashboardUrl();
  const subject = `${SUBJECT_PREFIX} ${alert.title}`.slice(0, 180);
  const text = renderOpsAlertText(alert);
  const generatedAt = new Date().toISOString();

  for (const to of recipients) {
    try {
      const res = await sendEmail({
        to,
        subject,
        category: "lifecycle",
        templateName: "ops_alert",
        skipMarketingChecks: true,
        idempotencyKey: alert.idempotencyKeyBase
          ? `${alert.idempotencyKeyBase}:${to}`
          : undefined,
        text,
        template: React.createElement(OpsAlertEmail, {
          title: alert.title,
          severity: alert.severity,
          summary: alert.summary,
          sections: alert.sections,
          ctaUrl,
          ctaLabel: alert.ctaLabel,
          generatedAt,
        }),
      });

      if (res.ok && !res.skipped) result.delivered += 1;
      else if (res.ok && res.skipped) result.skipped += 1;
      else result.failed += 1;
    } catch (err) {
      result.failed += 1;
      log(
        `[OpsAlerts] Email send threw for "${alert.kind}" → ${to}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

/** Optional Discord mirror. Off unless MARKET_OPS_DISCORD_WEBHOOK_URL is set.
 *  Deliberately does NOT fall back to DISCORD_WEBHOOK_URL (the staleness
 *  monitor's webhook) so enabling it here is an explicit, separate choice. */
async function dispatchDiscord(alert: OpsAlert): Promise<boolean> {
  const webhookUrl = process.env.MARKET_OPS_DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return false;
  try {
    const content = renderOpsAlertText(alert).slice(0, 1900); // Discord 2000-char cap
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return true;
  } catch (err) {
    log(
      `[OpsAlerts] Discord webhook failed for "${alert.kind}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Send an ops alert across all configured channels. Best-effort: never
 * throws — failures are logged and reflected in the returned counts so the
 * calling job continues regardless of alert delivery.
 */
export async function sendOpsAlert(alert: OpsAlert): Promise<OpsAlertResult> {
  try {
    const result = await dispatchEmail(alert);
    const discordSent = await dispatchDiscord(alert);
    if (discordSent) result.channels.push("discord");
    log(
      `[OpsAlerts] "${alert.kind}" → channels=[${result.channels.join(", ")}] ` +
        `delivered=${result.delivered} skipped=${result.skipped} failed=${result.failed}`,
    );
    return result;
  } catch (err) {
    log(
      `[OpsAlerts] Unexpected failure dispatching "${alert.kind}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return { delivered: 0, skipped: 0, failed: 1, channels: [] };
  }
}
