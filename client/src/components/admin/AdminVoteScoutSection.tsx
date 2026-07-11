import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Check,
  Copy,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Globe,
  Leaf,
} from "lucide-react";

type VoteScoutMode = "evergreen" | "topical";
type VoteScoutStatus = "new" | "kept" | "dismissed";
type VoteScoutContentType = "matchup" | "sentiment_poll" | "opinion_poll";

type MatchupPayload = {
  title: string;
  promptText: string;
  optionAText: string;
  optionBText: string;
  category: string;
  description: string;
  optionAImagePrompt?: string;
  optionBImagePrompt?: string;
};

type SentimentPayload = {
  headline: string;
  subjectText: string;
  category: string;
  description: string;
};

type OpinionPayload = {
  title: string;
  category: string;
  summary: string;
  options: string[];
};

type VoteScoutIdea = {
  id: string;
  contentType: VoteScoutContentType;
  mode: VoteScoutMode;
  payload: MatchupPayload | SentimentPayload | OpinionPayload | Record<string, unknown>;
  imagePrompt: string | null;
  rationale: string | null;
  fitScore: number | null;
  suggestedEndAt: string | null;
  status: VoteScoutStatus;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

type PendingVerdict = {
  id: string;
  status: "kept" | "dismissed";
  title: string;
};

type IdeasResponse = {
  ideas: VoteScoutIdea[];
  statusCounts: { new: number; kept: number; dismissed: number };
  hitRate: number | null;
};

const TYPE_LABEL: Record<VoteScoutContentType, string> = {
  matchup: "Matchup",
  sentiment_poll: "Sentiment",
  opinion_poll: "Opinion",
};

const TYPE_BADGE: Record<VoteScoutContentType, string> = {
  matchup: "bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300",
  sentiment_poll: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  opinion_poll: "bg-violet-500/15 border-violet-500/40 text-violet-600 dark:text-violet-300",
};

function ideaTitle(idea: VoteScoutIdea): string {
  const p = idea.payload as Record<string, unknown>;
  if (typeof p.title === "string" && p.title.trim()) return p.title;
  if (typeof p.headline === "string" && p.headline.trim()) return p.headline;
  return "Untitled idea";
}

function formatIdeaAsText(idea: VoteScoutIdea): string {
  const lines: string[] = [
    `Type: ${TYPE_LABEL[idea.contentType] || idea.contentType}`,
    `Mode: ${idea.mode}`,
    `Fit: ${idea.fitScore ?? "—"}`,
  ];
  if (idea.rationale) lines.push(`Why: ${idea.rationale}`);
  if (idea.suggestedEndAt) {
    lines.push(`Suggested end: ${new Date(idea.suggestedEndAt).toLocaleDateString()}`);
  }

  if (idea.contentType === "matchup") {
    const p = idea.payload as MatchupPayload;
    lines.push(`Title: ${p.title}`);
    lines.push(`Prompt: ${p.promptText}`);
    lines.push(`Option A: ${p.optionAText}`);
    lines.push(`Option B: ${p.optionBText}`);
    lines.push(`Category: ${p.category}`);
    if (p.description) lines.push(`Description:\n${p.description}`);
    if (p.optionAImagePrompt) lines.push(`\nImage prompt A:\n${p.optionAImagePrompt}`);
    if (p.optionBImagePrompt) lines.push(`\nImage prompt B:\n${p.optionBImagePrompt}`);
  } else if (idea.contentType === "sentiment_poll") {
    const p = idea.payload as SentimentPayload;
    lines.push(`Headline: ${p.headline}`);
    lines.push(`Subject:\n${p.subjectText}`);
    lines.push(`Category: ${p.category}`);
    if (p.description) lines.push(`Description:\n${p.description}`);
  } else {
    const p = idea.payload as OpinionPayload;
    lines.push(`Title: ${p.title}`);
    lines.push(`Category: ${p.category}`);
    if (p.summary) lines.push(`Summary:\n${p.summary}`);
    if (Array.isArray(p.options)) {
      lines.push(`Options:\n${p.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
    }
  }

  if (idea.imagePrompt) {
    lines.push(`\nImage prompt:\n${idea.imagePrompt}`);
  }

  return lines.join("\n");
}

async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`);
  }
}

export function AdminVoteScoutSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<VoteScoutStatus | "all">("new");
  const [pendingVerdict, setPendingVerdict] = useState<PendingVerdict | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const queryKey = useMemo(
    () => ["/api/admin/vote-scout/ideas", statusFilter] as const,
    [statusFilter],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async (): Promise<IdeasResponse> => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const qs = params.toString();
      const res = await apiRequest(
        "GET",
        `/api/admin/vote-scout/ideas${qs ? `?${qs}` : ""}`,
      );
      const json = await res.json();
      return json.data as IdeasResponse;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/vote-scout/ideas"] });
  };

  const scanMutation = useMutation({
    mutationFn: async (mode: VoteScoutMode) => {
      const res = await apiRequest("POST", "/api/admin/vote-scout/run", { mode });
      return res.json();
    },
    onSuccess: (json) => {
      const result = json.data as {
        created: number;
        skippedDuplicates: number;
        mode: VoteScoutMode;
      };
      if (result.created === 0) {
        toast.message(
          `No new ideas cleared the bar (${result.mode}). ${result.skippedDuplicates} duplicates skipped.`,
        );
      } else {
        toast.success(
          `Added ${result.created} idea${result.created === 1 ? "" : "s"} (${result.mode})` +
            (result.skippedDuplicates
              ? ` · ${result.skippedDuplicates} duplicates skipped`
              : ""),
        );
      }
      setStatusFilter("new");
      invalidate();
    },
    onError: async (err: any) => {
      const msg =
        err?.message?.includes("409")
          ? "A scan is already running"
          : "Vote scout scan failed";
      toast.error(msg);
    },
  });

  const verdictMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reviewNote,
    }: {
      id: string;
      status: "kept" | "dismissed";
      reviewNote?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/admin/vote-scout/ideas/${id}`, {
        status,
        reviewNote: reviewNote?.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (_json, vars) => {
      toast.success(vars.status === "kept" ? "Marked as kept" : "Dismissed");
      setPendingVerdict(null);
      setFeedbackText("");
      invalidate();
    },
    onError: () => toast.error("Could not update idea"),
  });

  const openVerdictDialog = (id: string, status: "kept" | "dismissed", title: string) => {
    setPendingVerdict({ id, status, title });
    setFeedbackText("");
  };

  const submitVerdict = () => {
    if (!pendingVerdict) return;
    verdictMutation.mutate({
      id: pendingVerdict.id,
      status: pendingVerdict.status,
      reviewNote: feedbackText,
    });
  };

  const counts = data?.statusCounts ?? { new: 0, kept: 0, dismissed: 0 };
  const hitRate = data?.hitRate;
  const ideas = data?.ideas ?? [];
  const scanning = scanMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Idea Scout
            </CardTitle>
            <CardDescription>
              Dinner-party quality Matchup, Sentiment, and Opinion ideas.
              Quality over quantity — the model may return fewer than 5, or zero.
              Keep or Dismiss with optional feedback; notes steer future scans.
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => scanMutation.mutate("evergreen")}
              disabled={scanning}
              data-testid="button-vote-scout-evergreen"
            >
              {scanning && scanMutation.variables === "evergreen" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Leaf className="h-4 w-4 mr-2" />
              )}
              Scan (Evergreen)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => scanMutation.mutate("topical")}
              disabled={scanning}
              title="Uses web search — costs more; best for current debates"
              data-testid="button-vote-scout-topical"
            >
              {scanning && scanMutation.variables === "topical" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              Scan Topical
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Evergreen uses world knowledge only (cents). Topical adds web search
            (costs more — use occasionally). Optional feedback on Keep/Dismiss
            is injected into the next scan so the model learns your taste — e.g.
            &quot;title is muddy&quot; or &quot;too niche&quot;. Hit rate =
            Kept ÷ (Kept + Dismissed).
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" data-testid="chip-vote-scout-new">
              New {counts.new}
            </Badge>
            <Badge variant="secondary" data-testid="chip-vote-scout-kept">
              Kept {counts.kept}
            </Badge>
            <Badge variant="secondary" data-testid="chip-vote-scout-dismissed">
              Dismissed {counts.dismissed}
            </Badge>
            <Badge variant="outline" data-testid="chip-vote-scout-hit-rate">
              Hit rate{" "}
              {hitRate === null || hitRate === undefined ? "—" : `${hitRate}%`}
            </Badge>
            {isFetching && !isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {(["new", "kept", "dismissed", "all"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                className="h-8 capitalize"
                onClick={() => setStatusFilter(value)}
                data-testid={`chip-vote-scout-filter-${value}`}
              >
                {value}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : ideas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No ideas in this filter yet. Run a scan to generate candidates.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ideas.map((idea) => {
            const title = ideaTitle(idea);
            const payload = idea.payload as Record<string, unknown>;
            return (
              <Card key={idea.id} data-testid={`card-vote-scout-idea-${idea.id}`}>
                <CardContent className="pt-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={TYPE_BADGE[idea.contentType]}
                        >
                          {TYPE_LABEL[idea.contentType]}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {idea.mode}
                        </Badge>
                        {typeof idea.fitScore === "number" ? (
                          <Badge variant="secondary">Fit {idea.fitScore}</Badge>
                        ) : null}
                        {idea.status !== "new" ? (
                          <Badge variant="outline" className="capitalize">
                            {idea.status}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="font-semibold text-base leading-snug">{title}</h3>
                      {idea.rationale ? (
                        <p className="text-sm text-muted-foreground">{idea.rationale}</p>
                      ) : null}
                      {idea.reviewNote ? (
                        <p className="text-sm text-primary/90 border-l-2 border-primary/40 pl-3">
                          Your feedback: {idea.reviewNote}
                        </p>
                      ) : null}
                    </div>
                    {idea.status === "new" ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verdictMutation.isPending}
                          onClick={() => openVerdictDialog(idea.id, "dismissed", title)}
                          data-testid={`button-vote-scout-dismiss-${idea.id}`}
                        >
                          <ThumbsDown className="h-4 w-4 mr-1" />
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          disabled={verdictMutation.isPending}
                          onClick={() => openVerdictDialog(idea.id, "kept", title)}
                          data-testid={`button-vote-scout-keep-${idea.id}`}
                        >
                          <ThumbsUp className="h-4 w-4 mr-1" />
                          Keep
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {idea.contentType === "matchup" ? (
                    <div className="text-sm space-y-1">
                      <p>
                        <span className="text-muted-foreground">Prompt:</span>{" "}
                        {String(payload.promptText || "")}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Sides:</span>{" "}
                        {String(payload.optionAText || "")} vs{" "}
                        {String(payload.optionBText || "")}
                      </p>
                      <p className="text-muted-foreground">
                        Category: {String(payload.category || "")}
                      </p>
                      {payload.description ? (
                        <p className="text-muted-foreground whitespace-pre-wrap">
                          {String(payload.description)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {idea.contentType === "sentiment_poll" ? (
                    <div className="text-sm space-y-1">
                      <p className="whitespace-pre-wrap">
                        {String(payload.subjectText || "")}
                      </p>
                      <p className="text-muted-foreground">
                        Category: {String(payload.category || "")}
                      </p>
                    </div>
                  ) : null}

                  {idea.contentType === "opinion_poll" ? (
                    <div className="text-sm space-y-2">
                      {payload.summary ? (
                        <p className="text-muted-foreground whitespace-pre-wrap">
                          {String(payload.summary)}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground">
                        Category: {String(payload.category || "")}
                      </p>
                      {Array.isArray(payload.options) ? (
                        <ul className="list-disc pl-5 space-y-0.5">
                          {(payload.options as string[]).map((opt) => (
                            <li key={opt}>{opt}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  {idea.suggestedEndAt ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Suggested end date:{" "}
                      {new Date(idea.suggestedEndAt).toLocaleDateString()}
                    </p>
                  ) : null}

                  {idea.contentType === "matchup" &&
                  (payload.optionAImagePrompt || payload.optionBImagePrompt) ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {payload.optionAImagePrompt ? (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Image A — {String(payload.optionAText || "Option A")}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() =>
                                copyText(
                                  "Image prompt A",
                                  String(payload.optionAImagePrompt || ""),
                                )
                              }
                            >
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Copy
                            </Button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {String(payload.optionAImagePrompt)}
                          </p>
                        </div>
                      ) : null}
                      {payload.optionBImagePrompt ? (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Image B — {String(payload.optionBText || "Option B")}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() =>
                                copyText(
                                  "Image prompt B",
                                  String(payload.optionBImagePrompt || ""),
                                )
                              }
                            >
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Copy
                            </Button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {String(payload.optionBImagePrompt)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {idea.imagePrompt ? (
                    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {idea.contentType === "matchup"
                            ? "Shared art direction"
                            : "Image prompt"}
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => copyText("Image prompt", idea.imagePrompt || "")}
                          data-testid={`button-vote-scout-copy-image-${idea.id}`}
                        >
                          <Copy className="h-3.5 w-3.5 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{idea.imagePrompt}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyText("Idea", formatIdeaAsText(idea))}
                      data-testid={`button-vote-scout-copy-idea-${idea.id}`}
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy as text
                    </Button>
                    {idea.status === "kept" ? (
                      <span className="inline-flex items-center text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Paste into the normal create form when ready
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!pendingVerdict}
        onOpenChange={(open) => {
          if (!open && !verdictMutation.isPending) {
            setPendingVerdict(null);
            setFeedbackText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingVerdict?.status === "kept" ? "Keep this idea?" : "Dismiss this idea?"}
            </DialogTitle>
            <DialogDescription className="line-clamp-3">
              {pendingVerdict?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vote-scout-feedback">
              Feedback for future scans{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="vote-scout-feedback"
              placeholder={
                pendingVerdict?.status === "kept"
                  ? "e.g. Great topic — just reword the title to be clearer"
                  : "e.g. Too niche, or title is ambiguous"
              }
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={3}
              maxLength={500}
              data-testid="input-vote-scout-feedback"
            />
            <p className="text-xs text-muted-foreground">
              Notes are included in the next scan prompt so the model learns what you
              want more or less of.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setPendingVerdict(null);
                setFeedbackText("");
              }}
              disabled={verdictMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submitVerdict} disabled={verdictMutation.isPending}>
              {verdictMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : pendingVerdict?.status === "kept" ? (
                <ThumbsUp className="h-4 w-4 mr-2" />
              ) : (
                <ThumbsDown className="h-4 w-4 mr-2" />
              )}
              Confirm {pendingVerdict?.status === "kept" ? "Keep" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
