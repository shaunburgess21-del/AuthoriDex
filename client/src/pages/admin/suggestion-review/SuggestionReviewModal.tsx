import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { formatActivityAge } from "@/lib/formatDate";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Eye, EyeOff, Loader2, Check } from "lucide-react";
import { MatchupReviewFields, type MatchupReviewValues } from "./MatchupReviewFields";
import { SentimentPollReviewFields, type SentimentPollReviewValues } from "./SentimentPollReviewFields";
import { OpinionPollReviewFields, type OpinionPollReviewValues, type OpinionOptionValue } from "./OpinionPollReviewFields";
import { InductionReviewFields, type InductionReviewValues } from "./InductionReviewFields";
import { OpenMarketReviewFields, type OpenMarketReviewValues } from "./OpenMarketReviewFields";
import { ProfileImageReviewFields, type ProfileImageReviewValues } from "./ProfileImageReviewFields";

type SuggestionRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  submittedBy: string;
  status: string;
  createdAt: string;
  submitterUsername: string | null;
  submitterAvatar: string | null;
};

const TYPE_BADGE_CLASS: Record<string, string> = {
  matchup: "bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300",
  sentiment_poll: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  opinion_poll: "bg-violet-500/15 border-violet-500/40 text-violet-600 dark:text-violet-300",
  induction: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  open_market: "bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-300",
  profile_image: "bg-slate-500/15 border-slate-500/40 text-slate-600 dark:text-slate-300",
};

const TYPE_LABEL: Record<string, string> = {
  matchup: "Matchup",
  sentiment_poll: "Sentiment Poll",
  opinion_poll: "Opinion Poll",
  induction: "Induction",
  profile_image: "Profile Image",
  open_market: "Open Market",
};

function generateSlug(title: string): string {
  const base = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const suffix = Date.now().toString(36);
  return base ? `${base}-${suffix}` : `item-${suffix}`;
}

function g(payload: Record<string, unknown>, key: string): string {
  const v = payload?.[key];
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function extractXHandle(url: string): string {
  try {
    const u = new URL(url);
    if (!/^(www\.)?(x|twitter)\.com$/i.test(u.hostname)) return "";
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length > 0 ? parts[0].replace(/^@+/, "") : "";
  } catch {
    return "";
  }
}

function dateToLocal(value: unknown): string {
  if (!value) return "";
  try {
    const d = new Date(value as string | number);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function resolveTimelineToDate(timeline: unknown, deadlineAt: unknown): string {
  if (deadlineAt) return dateToLocal(deadlineAt);
  if (timeline === "1_week" || timeline === "1week") return dateToLocal(new Date(Date.now() + 7 * 86400000));
  if (timeline === "1_month" || timeline === "1month") return dateToLocal(new Date(Date.now() + 30 * 86400000));
  return "";
}

function arraysEqual(a: OpinionOptionValue[], b: OpinionOptionValue[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.name === b[i].name && item.imageUrl === b[i].imageUrl && item.personId === b[i].personId);
}

export function SuggestionReviewModal({
  open,
  onClose,
  suggestion,
  onApproved,
}: {
  open: boolean;
  onClose: () => void;
  suggestion: SuggestionRow | null;
  onApproved: () => void;
}) {  const [showRaw, setShowRaw] = useState(false);
  const payload = suggestion?.payload ?? {};
  const type = suggestion?.type ?? "";

  // --- Per-type initial values (memoised on suggestion id) ---
  const initMatchup = useMemo((): MatchupReviewValues => ({
    title: g(payload, "title"),
    category: g(payload, "category") || "misc",
    optionAText: g(payload, "optionAText"),
    optionBText: g(payload, "optionBText"),
    slug: generateSlug(g(payload, "title") || "matchup"),
    visibility: "live",
  }), [suggestion?.id]);

  const initSentiment = useMemo((): SentimentPollReviewValues => ({
    headline: g(payload, "headline"),
    subjectText: g(payload, "subjectText"),
    category: g(payload, "category") || "misc",
    slug: generateSlug(g(payload, "headline") || "poll"),
    visibility: "draft",
    deadlineAt: resolveTimelineToDate(payload.timeline, payload.deadlineAt),
  }), [suggestion?.id]);

  const initOpinionOptions = useMemo((): OpinionOptionValue[] => {
    const raw = Array.isArray(payload.options) ? payload.options : [];
    return raw.map((o: any) => ({
      name: o?.name ?? "",
      imageUrl: o?.imageUrl ?? undefined,
      personId: o?.personId ?? undefined,
    }));
  }, [suggestion?.id]);

  const initOpinion = useMemo((): OpinionPollReviewValues => ({
    title: g(payload, "title"),
    category: g(payload, "category") || "misc",
    summary: g(payload, "summary"),
    slug: generateSlug(g(payload, "title") || "opinion-poll"),
    visibility: "draft",
    options: initOpinionOptions,
  }), [suggestion?.id]);

  const initInduction = useMemo((): InductionReviewValues => ({
    displayName: g(payload, "displayName"),
    category: g(payload, "category") || "misc",
    xHandle: extractXHandle(g(payload, "socialUrl")),
  }), [suggestion?.id]);

  const resolvedEndAt = useMemo(() => {
    const endAt = payload.endAt;
    if (!endAt || endAt === "no_deadline") return dateToLocal(new Date(Date.now() + 7 * 86400000));
    if (endAt === "1_week" || endAt === "1week") return dateToLocal(new Date(Date.now() + 7 * 86400000));
    if (endAt === "1_month" || endAt === "1month") return dateToLocal(new Date(Date.now() + 30 * 86400000));
    return dateToLocal(endAt);
  }, [suggestion?.id]);

  const initOpenMarket = useMemo((): OpenMarketReviewValues => ({
    title: g(payload, "title"),
    category: g(payload, "category") || "misc",
    slug: generateSlug(g(payload, "title") || "market"),
    visibility: "live",
    endAt: resolvedEndAt,
    underlying: g(payload, "underlying"),
    metric: g(payload, "metric"),
    strike: g(payload, "strike"),
    unit: g(payload, "unit") || "$",
  }), [suggestion?.id]);

  // --- Editable state ---
  const [matchup, setMatchup] = useState<MatchupReviewValues>(initMatchup);
  const [sentiment, setSentiment] = useState<SentimentPollReviewValues>(initSentiment);
  const [opinion, setOpinion] = useState<OpinionPollReviewValues>(initOpinion);
  const [induction, setInduction] = useState<InductionReviewValues>(initInduction);
  const [openMarket, setOpenMarket] = useState<OpenMarketReviewValues>(initOpenMarket);
  const [profileImage, setProfileImage] = useState<ProfileImageReviewValues>({ sourceCredit: "" });

  // Reset state when a new suggestion opens.
  useMemo(() => {
    setMatchup(initMatchup);
    setSentiment(initSentiment);
    setOpinion(initOpinion);
    setInduction(initInduction);
    setOpenMarket(initOpenMarket);
    setProfileImage({ sourceCredit: "" });
    setShowRaw(false);
  }, [suggestion?.id]);

  // --- Build sparse adminOverrides ---
  function getOverrides(): Record<string, unknown> {
    const ov: Record<string, unknown> = {};

    if (type === "matchup") {
      const init = initMatchup;
      if (matchup.title !== init.title) ov.title = matchup.title;
      if (matchup.category !== init.category) ov.category = matchup.category;
      if (matchup.optionAText !== init.optionAText) ov.optionAText = matchup.optionAText;
      if (matchup.optionBText !== init.optionBText) ov.optionBText = matchup.optionBText;
      // Slug is admin-only — always include.
      ov.slug = matchup.slug;
      if (matchup.visibility !== init.visibility) ov.visibility = matchup.visibility;
    } else if (type === "sentiment_poll") {
      const init = initSentiment;
      if (sentiment.headline !== init.headline) ov.headline = sentiment.headline;
      if (sentiment.subjectText !== init.subjectText) ov.subjectText = sentiment.subjectText;
      if (sentiment.category !== init.category) ov.category = sentiment.category;
      ov.slug = sentiment.slug;
      if (sentiment.visibility !== init.visibility) ov.visibility = sentiment.visibility;
      if (sentiment.deadlineAt) ov.deadlineAt = sentiment.deadlineAt;
    } else if (type === "opinion_poll") {
      const init = initOpinion;
      if (opinion.title !== init.title) ov.title = opinion.title;
      if (opinion.category !== init.category) ov.category = opinion.category;
      if (opinion.summary !== init.summary) ov.summary = opinion.summary;
      ov.slug = opinion.slug;
      if (opinion.visibility !== init.visibility) ov.visibility = opinion.visibility;
      if (!arraysEqual(opinion.options, initOpinionOptions)) ov.options = opinion.options;
    } else if (type === "induction") {
      const init = initInduction;
      if (induction.displayName !== init.displayName) ov.displayName = induction.displayName;
      if (induction.category !== init.category) ov.category = induction.category;
      if (induction.xHandle !== init.xHandle) ov.xHandle = induction.xHandle;
    } else if (type === "open_market") {
      const init = initOpenMarket;
      if (openMarket.title !== init.title) ov.title = openMarket.title;
      if (openMarket.category !== init.category) ov.category = openMarket.category;
      ov.slug = openMarket.slug;
      if (openMarket.visibility !== init.visibility) ov.visibility = openMarket.visibility;
      if (openMarket.endAt !== init.endAt && openMarket.endAt) ov.endAt = new Date(openMarket.endAt).toISOString();
      if (openMarket.underlying !== init.underlying) ov.underlying = openMarket.underlying;
      if (openMarket.metric !== init.metric) ov.metric = openMarket.metric;
      if (openMarket.strike !== init.strike) ov.strike = Number(openMarket.strike);
      if (openMarket.unit !== init.unit) ov.unit = openMarket.unit;
    } else if (type === "profile_image") {
      if (profileImage.sourceCredit) ov.sourceCredit = profileImage.sourceCredit;
    }

    return ov;
  }

  const approveMutation = useMutation({
    mutationFn: async () => {
      const overrides = getOverrides();
      const body = Object.keys(overrides).length > 0 ? { adminOverrides: overrides } : {};
      const res = await apiRequest("POST", `/api/admin/suggestions/${suggestion!.id}/approve`, body);
      return res.json();
    },
    onSuccess: () => {
      toast("Suggestion approved!", { description: "Content is now live." });
      onApproved();
      onClose();
    },
    onError: (err: any) => {
      toast.error("Approval failed", { description: err?.message ?? "Something went wrong." });
    },
  });

  if (!suggestion) return null;

  const typeBadgeClass = TYPE_BADGE_CLASS[type] ?? "bg-muted text-foreground";
  const entriesCount = Array.isArray(payload.entries) ? (payload.entries as unknown[]).length : 0;
  const openMarketType = g(payload, "openMarketType") || "binary";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Review & Approve
            <Badge variant="outline" className={typeBadgeClass}>{TYPE_LABEL[type] ?? type}</Badge>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Avatar className="h-5 w-5">
              {suggestion.submitterAvatar && <AvatarImage src={suggestion.submitterAvatar} />}
              <AvatarFallback className="text-[10px]">{(suggestion.submitterUsername ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            @{suggestion.submitterUsername ?? "unknown"} · {formatActivityAge(suggestion.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 pr-2 -mr-2">
          <>
            {type === "matchup" && <MatchupReviewFields values={matchup} onChange={setMatchup} />}
            {type === "sentiment_poll" && <SentimentPollReviewFields values={sentiment} onChange={setSentiment} />}
            {type === "opinion_poll" && <OpinionPollReviewFields values={opinion} onChange={setOpinion} />}
            {type === "induction" && <InductionReviewFields values={induction} onChange={setInduction} socialUrl={g(payload, "socialUrl") || null} />}
            {type === "open_market" && <OpenMarketReviewFields values={openMarket} onChange={setOpenMarket} openMarketType={openMarketType} entriesCount={entriesCount} />}
            {type === "profile_image" && (
              <ProfileImageReviewFields
                values={profileImage}
                onChange={setProfileImage}
                personName={g(payload, "personName") || g(payload, "personId")}
                imageUrl={g(payload, "imageUrl")}
              />
            )}
          </>

          <div>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showRaw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showRaw ? "Hide original submission" : "View original submission"}
            </button>
            {showRaw && (
              <pre className="mt-2 p-3 rounded-md bg-muted/50 border text-xs overflow-x-auto font-mono max-h-48">
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={approveMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {approveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            Approve & Publish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
