import { Crown, Flame, MessageCircle, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { UserRankBadge } from "@/components/UserRankBadge";
import { formatTimeAgo } from "@/lib/formatDate";
import { MentionText } from "@/components/comments/MentionText";
import { cn } from "@/lib/utils";
import type { VoicesFeedItem } from "./types";
import { VoiceEntityPreview } from "./VoiceEntityPreview";
import { VOICES_POST_ROW_CLASS } from "./voicesSurface";

const DELETED_USER = "[deleted user]";

interface VoiceCardProps {
  item: VoicesFeedItem;
  onOpen: (item: VoicesFeedItem) => void;
  onVote: (item: VoicesFeedItem) => void;
}

export function VoiceCard({ item, onOpen, onVote }: VoiceCardProps) {
  const isDeleted = Boolean(item.body) === false;
  const hasUpvoted = item.userVote === "up";
  const isTimeline = item.entity.refType === "timeline";

  return (
    <article
      className={cn("cursor-pointer", VOICES_POST_ROW_CLASS)}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item);
        }
      }}
      data-testid={`voice-card-${item.id}`}
    >
      <div className="flex items-start gap-3">
        <UserProfileAvatar
          displayName={item.author.username || ""}
          avatarUrl={item.author.avatarUrl}
          size="md"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          {/* Author row */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold truncate max-w-[55%]">
              {item.author.username || "Anonymous"}
            </span>
            {item.author.rank && <UserRankBadge rank={item.author.rank} size="xs" />}
            <span className="text-xs text-muted-foreground">
              {formatTimeAgo(item.createdAt)}
            </span>
            {item.badges.topTake && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 px-1.5 py-0 text-[10px]"
              >
                <Crown className="h-3 w-3" />
                Top Take
              </Badge>
            )}
            {item.badges.rising && !item.badges.topTake && (
              <Badge
                variant="outline"
                className="border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400 gap-1 px-1.5 py-0 text-[10px]"
              >
                <Flame className="h-3 w-3" />
                Rising
              </Badge>
            )}
          </div>

          {/* Body */}
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground line-clamp-6">
            {isDeleted ? (
              <span className="italic text-muted-foreground">[deleted]</span>
            ) : (
              <MentionText text={item.body} />
            )}
          </p>

          {/* Context preview (deep link to source) */}
          {!isTimeline && <VoiceEntityPreview entity={item.entity} itemId={item.id} />}

          {/* Actions */}
          <div className="mt-3 flex items-center gap-4 text-muted-foreground">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onVote(item);
              }}
              className={cn(
                "flex items-center gap-1 text-xs transition-colors hover:text-amber-600 dark:hover:text-amber-400",
                hasUpvoted && "text-amber-600 dark:text-amber-400",
              )}
              aria-label="Upvote"
              data-testid={`voice-card-upvote-${item.id}`}
            >
              <ThumbsUp className={cn("h-4 w-4", hasUpvoted && "fill-current")} />
              {item.upvotes > 0 && <span>{item.upvotes}</span>}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(item);
              }}
              className="flex items-center gap-1 text-xs transition-colors hover:text-foreground"
              aria-label="View replies"
              data-testid={`voice-card-replies-${item.id}`}
            >
              <MessageCircle className="h-4 w-4" />
              {item.replyCount > 0 && <span>{item.replyCount}</span>}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
