/**
 * Help-chat turn. Grounds gpt-5.4 on the public articles in
 * ./knowledge plus live rates, and records the call on llm_daily_spend
 * under "help_chat".
 */
import type { Response } from "express";
import OpenAI from "openai";
import type { AuthRequest } from "../auth-middleware";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { recordLlmUsage } from "../config/ai-cost";
import { loadPersistedSpend } from "../agents/llmSpendStore";
import {
  buildHelpSystemPrompt,
  formatHelpPageContext,
  HELP_UNANSWERED_PHRASE,
} from "./knowledge";
import { getHelpRates } from "./live-rates";
import type { HelpRates } from "./rates";
import { cleanHelpText, sanitizeHelpTranscript, HELP_REPLY_CHAR_CAP } from "./transcript";

const FEATURE = "help_chat";
const DEFAULT_DAILY_BUDGET_USD = 3;
/** Covers reasoning tokens as well as a fuller reply on gpt-5.4. */
const COMPLETION_TOKEN_LIMIT = 1200;

let promptCache: { rates: HelpRates; prompt: string } | null = null;

function systemPromptFor(rates: HelpRates): string {
  if (promptCache?.rates !== rates) {
    promptCache = { rates, prompt: buildHelpSystemPrompt(rates) };
  }
  return promptCache.prompt;
}

function helpChatEnabled(): boolean {
  const raw = process.env.HELP_CHAT_ENABLED;
  if (typeof raw !== "string" || raw.trim() === "") return true;
  const v = raw.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "no" && v !== "off";
}

function dailyBudgetUsd(): number {
  const raw = Number(process.env.HELP_CHAT_DAILY_BUDGET_USD);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_DAILY_BUDGET_USD;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

let openaiClient: { apiKey: string; client: OpenAI } | null = null;

function openaiFor(apiKey: string): OpenAI {
  if (openaiClient?.apiKey !== apiKey) {
    openaiClient = { apiKey, client: new OpenAI({ apiKey }) };
  }
  return openaiClient.client;
}

export async function handleHelpChat(req: AuthRequest, res: Response): Promise<void> {
  if (!helpChatEnabled()) {
    res.status(503).json({
      error: "Help chat is turned off right now. The How it works page covers the same topics.",
    });
    return;
  }

  const transcript = sanitizeHelpTranscript(req.body);
  if (!transcript.ok) {
    res.status(400).json({ error: transcript.error });
    return;
  }

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Help chat isn't available right now." });
    return;
  }

  try {
    const spent = await loadPersistedSpend(FEATURE, todayUtc());
    if ((spent?.spendUsd ?? 0) >= dailyBudgetUsd()) {
      res.status(503).json({
        error: "Help chat is paused until tomorrow. The How it works page covers the same topics.",
      });
      return;
    }
  } catch (err) {
    console.warn(
      "[HelpChat] spend lookup failed; answering anyway:",
      err instanceof Error ? err.message : err,
    );
  }

  const model = getAiModel("helpChat");
  try {
    const rates = await getHelpRates();
    const pageContext = formatHelpPageContext(transcript.pagePath);
    const response = await openaiFor(apiKey).chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPromptFor(rates) },
        ...(pageContext ? [{ role: "system" as const, content: pageContext }] : []),
        ...transcript.turns,
      ],
      ...getChatCompletionTokenLimit(model, COMPLETION_TOKEN_LIMIT),
    });

    recordLlmUsage({
      feature: FEATURE,
      model,
      usage: response.usage,
      detail: req.userId
        ? `auth${transcript.pagePath ? `:${transcript.pagePath}` : ""}`
        : `anon${transcript.pagePath ? `:${transcript.pagePath}` : ""}`,
    });

    const choice = response.choices[0];
    const reply = cleanHelpText(choice?.message?.content ?? "").slice(0, HELP_REPLY_CHAR_CAP);
    if (!reply) {
      console.warn(`[HelpChat] empty reply (finish_reason=${choice?.finish_reason ?? "none"})`);
      res.status(502).json({
        error: "The help chat couldn't put an answer together. Try again, or open How it works.",
      });
      return;
    }
    if (choice?.finish_reason === "length") {
      console.warn("[HelpChat] reply hit the token limit and was cut short");
    }

    if (reply.toLowerCase().includes(HELP_UNANSWERED_PHRASE.toLowerCase())) {
      console.log(`[HelpChat] unanswered: ${transcript.question.slice(0, 240)}`);
    }

    res.json({ data: { reply } });
  } catch (err) {
    console.error("[HelpChat] request failed:", err instanceof Error ? err.message : err);
    res.status(502).json({
      error: "The help chat couldn't answer just now. Try again in a moment.",
    });
  }
}
