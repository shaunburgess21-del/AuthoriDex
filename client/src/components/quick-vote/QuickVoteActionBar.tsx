/**
 * Quick Vote card action bar — translucent icon buttons hovering below each
 * card in the Quick Vote snap deck: discussion (full-screen comments),
 * like / dislike (card_reactions personalization signals), and share
 * (card detail-page link).
 *
 * Rendered per snap page via VoteSnapScrollView's renderPageFooter slot, so
 * it scrolls and snaps as one unit with its card.
 */
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { MessageCircle, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  CardCommentsFocusOverlay,
  type CommentEntityType,
} from "@/components/comments/CardComments";
import { useAuth } from "@/contexts/AuthContext";
import { signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import {
  cardReactionKey,
  useCardReactionMutation,
  useCardReactionsMap,
} from "@/hooks/useCardReactions";
import {
  matchupShare,
  opinionPollShare,
  resolveShareUrl,
  sentimentPollShare,
  sharePage,
  type CardShareConfig,
} from "@/lib/share";
import type { CardReactionSurface, CardReactionType } from "@shared/constants";
import { cn } from "@/lib/utils";

export type QuickVoteCardType = "matchup" | "sentiment" | "opinion";

const COMMENT_ENTITY: Record<QuickVoteCardType, CommentEntityType> = {
  matchup: "matchup",
  sentiment: "poll",
  opinion: "opinion-poll",
};

const REACTION_SURFACE: Record<QuickVoteCardType, CardReactionSurface> = {
  matchup: "matchup",
  sentiment: "sentiment_poll",
  opinion: "opinion_poll",
};

const SHARE_CONFIG: Record<
  QuickVoteCardType,
  (slug: string, title: string) => CardShareConfig
> = {
  matchup: matchupShare,
  sentiment: sentimentPollShare,
  opinion: opinionPollShare,
};

function ActionButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      data-interactive="true"
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white/90 ring-1 ring-white/10 backdrop-blur-md transition-transform duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
    >
      {children}
    </button>
  );
}

export interface QuickVoteActionBarProps {
  type: QuickVoteCardType;
  /** Card UUID — reaction target. */
  targetId: string;
  /** Card slug — comments thread + detail-page share link. Empty = no slug. */
  slug: string;
  title: string;
  category: string;
}

export function QuickVoteActionBar({
  type,
  targetId,
  slug,
  title,
  category,
}: QuickVoteActionBarProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const reactionsMap = useCardReactionsMap();
  const reactionMutation = useCardReactionMutation();

  const surfaceType = REACTION_SURFACE[type];
  const reaction = reactionsMap.get(cardReactionKey({ surfaceType, targetId })) ?? null;
  const hasSlug = slug.length > 0;

  const handleReact = (next: CardReactionType) => {
    if (!user) {
      toast(
        "Sign in to personalize your feed",
        signInToVoteToastOptions(() => setLocation("/login")),
      );
      return;
    }
    reactionMutation.mutate({
      surfaceType,
      targetId,
      // Tapping the active reaction toggles it off.
      reaction: reaction === next ? null : next,
      category,
    });
  };

  const handleShare = () => {
    const config = SHARE_CONFIG[type](slug, title);
    void sharePage(config.title, {
      sharerUserId: user?.id ?? null,
      surface: config.surface,
      url: resolveShareUrl(config.path),
    });
  };

  return (
    <>
      <div className="flex items-center gap-4" role="group" aria-label="Card actions">
        {hasSlug && (
          <ActionButton label="Open discussion" onClick={() => setCommentsOpen(true)}>
            <MessageCircle className="h-5 w-5" />
          </ActionButton>
        )}
        <ActionButton
          label="More like this"
          pressed={reaction === "like"}
          onClick={() => handleReact("like")}
        >
          <ThumbsUp
            className={cn("h-5 w-5 transition-colors", reaction === "like" && "text-green-400")}
          />
        </ActionButton>
        <ActionButton
          label="Less like this"
          pressed={reaction === "dislike"}
          onClick={() => handleReact("dislike")}
        >
          <ThumbsDown
            className={cn("h-5 w-5 transition-colors", reaction === "dislike" && "text-red-400")}
          />
        </ActionButton>
        {hasSlug && (
          <ActionButton label="Share" onClick={handleShare}>
            <Share2 className="h-5 w-5" />
          </ActionButton>
        )}
      </div>
      {hasSlug && (
        <CardCommentsFocusOverlay
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          entityType={COMMENT_ENTITY[type]}
          slug={slug}
          contextTitle={title}
        />
      )}
    </>
  );
}
