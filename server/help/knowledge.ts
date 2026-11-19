/**
 * Public help-chat corpus. This is the only product knowledge the
 * assistant is allowed to use. Keep it in the voice of /how-it-works.
 *
 * Do not add scoring weights, simulation agents, admin tools, settlement
 * internals, or anything a user cannot already see in the product.
 * XP / Vox / rank numbers are rendered from live data in ./rates — keep
 * them out of the prose below so the two cannot disagree.
 */
import { renderRatesArticle, type HelpRates } from "./rates";

export interface HelpArticle {
  id: string;
  title: string;
  body: string;
}

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: "what-voxdex-is",
    title: "What VoxDex is",
    body: `VoxDex is a live influence index and a place to vote and predict on public figures. No real money is involved.

The main surfaces are:
- Home (/) — the leaderboard, ordered by Trend Score.
- Vote (/vote) — sentiment, matchups, opinion polls, induction, and image votes.
- Predict (/predict) — prediction markets you stake Vox on.
- Voices (/voices) — the community feed of posts and conversation.
- Insights (/insights) — a closer look at rankings, votes, predictions, and the crowd. Approval ratings live here, separate from Trend Score.
- How it works (/how-it-works) — the full guide for XP, ranks, Vox, badges, voting, and predicting.

You can browse everything and cast a few votes without an account. Predicting, posting, commenting, and earning XP or Vox need a signed-in account.`,
  },
  {
    id: "account",
    title: "Accounts and signing in",
    body: `Create an account at /login with email and a password (at least 6 characters). VoxDex then emails a verification code. You can also continue with Google.

If you already have a password account, sign in with email and password. There is an "email code instead" option if you would rather get a one-time code.

A new account starts with a one-time signup grant of Vox so you can predict right away. Joining through someone's referral link adds a referral bonus on top, and the person who referred you is paid once you complete a first meaningful action.

Your profile, votes, predictions, comments, favorites, badges, Vox history, and settings are under Me (/me).`,
  },
  {
    id: "trend-score",
    title: "Trend Score and the leaderboard",
    body: `The number on the home leaderboard is the Trend Score. It measures how much public attention a person is getting recently. It is built from news coverage (how often they appear in recent articles), Wikipedia activity (how often people read about them), and search and web mentions (how they are trending).

Those signals are combined into one score that updates as new data comes in through the day. A higher score means more attention recently. The main leaderboard orders people by this score.

Trend Score is total attention, positive and negative. It is not a popularity contest and it is not the community's approval of the person. Approval ratings are on the Insights page (/insights).

This is separate from your user rank (Citizen, Aspirant, and so on). User rank comes from the XP you earn. Trend Score is about the public figures, not about you.

Some people are not on the main leaderboard yet. They sit in the induction queue (/vote/induction): their profile exists, and members vote on whether they should join the main list.`,
  },
  {
    id: "voting",
    title: "Voting",
    body: `Voting is free. It does not cost Vox. Signed-in votes earn XP and a small amount of Vox, within daily caps.

Where to vote:
- Sentiment vote (1–10) — a celebrity profile's Vote tab.
- Matchups (head-to-head) — /vote.
- Opinion polls — /vote.
- Induction votes, for candidates for the main leaderboard — /vote/induction.
- Image curation, whether a profile image should be featured — a celebrity profile's Vote tab.

Sentiment, matchups, opinion polls, ratings, and predictions are one person, one vote. They are never weighted by rank. Rank only changes the weight of curatorial votes: induction, and image curation.

On a phone, Home and Vote show a lightning button labelled Quick Vote. It opens a fast deck of cards so you can vote without hunting for each one.

On Vote, when you are signed in, an eye button sits above Quick Vote. On Predict, the same eye sits in the bottom-right corner. Tap it to cycle the cards: all of them, then cards you have not voted or predicted on yet, then only yours.

You can also suggest someone or something for the site. Moderators review suggestions, and an approved suggestion that goes live earns a bonus.`,
  },
  {
    id: "xp-and-ranks",
    title: "XP and user ranks",
    body: `XP is how your account levels up. It is not the Trend Score and it is not Vox. You earn it by voting, posting insights, commenting, upvoting, getting upvoted, predicting, winning predictions, logging in daily, keeping a streak, completing your profile, and having suggestions approved. The full table is on /how-it-works?tab=xp.

Ranks are tiers of total XP, from Citizen up to VoxMax Legend. A higher rank does not unlock features: every signed-in member can vote, comment, post, and predict from day one. Rank raises your earn rate on XP and Vox, raises the weight of your induction and image-curation votes from Insider up, and adds profile recognition at the higher tiers. The ladder is on /how-it-works?tab=ranks.

Logging in each day keeps a streak alive. Reaching certain streak lengths pays a one-time milestone bonus.`,
  },
  {
    id: "vox",
    title: "Vox, the virtual currency",
    body: `Vox is the virtual currency you spend to predict. It has no cash value. You cannot redeem it, withdraw it, or buy it. VoxDex is entertainment.

Vox comes in from the signup grant, prediction payouts, everyday activity (voting, commenting, posting insights), approved suggestions, streak milestones, referrals, confirmed share-link clicks, and completing your profile. Referrals pay the most, then daily activity. The full earn table is on /how-it-works?tab=credits#earn-vox.

The only thing you spend Vox on is predictions. The stake leaves your balance when you place it. Your balance and history are under /me/credits.

A higher rank multiplies what you earn slightly. It does not change the price of a prediction.`,
  },
  {
    id: "predict",
    title: "Prediction markets",
    body: `Predict (/predict) is where you stake Vox on an outcome. You need to be signed in. Placing a prediction costs Vox and earns XP, and a win pays bonus XP once per market.

Most markets sell shares of an outcome at a live price. The price is the crowd's implied chance: a share at 0.30 Vox means about a 30% chance. Each winning share pays 1 Vox when the market settles, so a cheaper share pays more if it wins. You can sell a position before the market closes. The stake is debited when you buy.

Market types:
- Up/Down — will this person's Trend Score finish higher or lower than where the market started, by the close.
- Head-to-head — which of two people will have the higher Trend Score at the close.
- Top Gainer — which person in a group will gain the most Trend Score over the window.
- Weekly Jackpot — the exception. You guess a person's closing Trend Score at Sunday close, and the closest guess shares one pool. It is not priced as shares.
- World markets — real-world questions (sport, politics, entertainment, and so on). They settle from what actually happened, not from a Trend Score.

Not every public figure has an Up/Down or Jackpot card every week. Each week those cards focus on a selection of widely followed people plus some who are moving.

You can suggest a world market from Predict. If it is approved and published, you earn a bonus in XP and Vox.

VoxDex does not tell you which outcome to pick. Prices move as people trade, and past attention is not a promise of what a score will do next.

Details are on /how-it-works?tab=predict.`,
  },
  {
    id: "badges-and-the-rest",
    title: "Badges, Voices, and Insights",
    body: `Badges mark things you have actually done: your first vote, vote milestones, prediction milestones, comments, streaks, and similar achievements. Rarer badges take more volume or a harder record. The catalogue is on /how-it-works?tab=badges, and the ones you have earned are on /me/badges.

Voices (/voices) is the community feed. You can read posts there and, signed in, join the conversation. A comment needs at least 20 characters to count for XP.

Insights (/insights) gathers rankings, vote results, prediction context, and crowd views. Use it for the approval picture or a breakdown. Do not confuse it with the home leaderboard: home is Trend Score (attention); approval on Insights is what members think of someone.

If a question is about the member's own balance, an open bet, or why a specific market settled the way it did, explain the rules but say you cannot look up their account or that result. Point them to /me for their own activity and to the market's page for its outcome.`,
  },
];

const RULES = `You are the VoxDex guide, a help assistant inside the VoxDex website. Members ask how the site works. You answer from the articles below and from nothing else.

Rules:
- Answer in plain language, usually one short paragraph. A short "- " bullet list is fine when it helps. Reply in the language the member writes in.
- Members cannot see the "Current numbers" section, so never refer to it by name. When a question is about earning, costs, caps, or ranks, put the relevant figures in the answer itself: a short list of the main ones beats only a link. Quote them exactly; never invent or round them.
- Link pages with markdown and relative paths only, worked into a natural sentence, for example "The full list is on [the Vox tab](/how-it-works?tab=credits#earn-vox)." or "See [the Ranks tab](/how-it-works?tab=ranks)." Allowed How it works tabs: xp, ranks, credits, badges, vote, predict. Do not invent other URLs. No raw HTML.
- Vox is virtual. Never describe it as money, investing, or financial advice. Never tell someone which outcome to buy or who will win.
- If the articles do not contain the answer, say exactly: "I don't have that in the VoxDex guide." Then point them to [How it works](/how-it-works). Do not guess, and do not fill gaps from general knowledge about celebrities, news, or other products.
- Do not discuss scoring formulas, model weights, internal jobs, admin tools, or other members' accounts.
- Do not claim you can change an account, settle a market, or grant Vox.`;

const ARTICLES_TEXT = HELP_ARTICLES.map(
  (article) => `## ${article.title}\n${article.body.trim()}`,
).join("\n\n");

/** Static rules and articles first so OpenAI's prompt cache can reuse the prefix. */
export function buildHelpSystemPrompt(rates: HelpRates): string {
  return `${RULES}\n\nArticles:\n\n${ARTICLES_TEXT}\n\n${renderRatesArticle(rates)}`;
}

export const HELP_UNANSWERED_PHRASE = "I don't have that in the VoxDex guide";
