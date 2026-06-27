import { Link } from "wouter";
import {
  Crown,
  Flame,
  MessageCircle,
  ThumbsUp,
  Vote as VoteIcon,
  BarChart3,
  Globe,
  User as UserIcon,
  MessagesSquare,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { UserRankBadge } from "@/components/UserRankBadge";
import { formatTimeAgo } from "@/lib/formatDate";
import { cn } from "@/lib/utils";
import type { VoicesEntity, VoicesFeedItem } from "./types";

const SURFACE_ICON: Record<VoicesEntity["refType"], typeof VoteIcon> = {
  matchup: VoteIcon,
  trending_poll: BarChart3,
  opinion_poll: BarChart3,
  open_market: Globe,
  person: UserIcon,
  timeline: MessagesSquare,
};

const DELETED_USER = "[deleted user]";

interface VoiceCardProps {
  item: VoicesFeedItem;
  onOpen: (item: VoicesFeedItem) => void;
  onVote: (item: VoicesFeedItem) => void;
}

export function VoiceCard({ item, onOpen, onVote }: VoiceCardProps) {
  const isDeleted = Boolean(item.body) === false;
  const net = item.upvotes - item.downvotes;
  const hasUpvoted = item.userVote === "up";
  const SurfaceIcon = SURFACE_ICON[item.entity.refType] ?? MessagesSquare;
  const isTimeline = item.entity.refType === "timeline";

  return (
    <Card
      className="p-4 transition-colors hover:bg-muted/30 cursor-pointer"
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
          size="sm"
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
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
            {isDeleted ? <span className="italic text-muted-foreground">[deleted]</span> : item.body}
          </p>

          {/* Context chip (deep link to source) */}
          {!isTimeline && (
            <Link
              href={item.entity.href}
              onClick={(e) => e.stopPropagation()}
              className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground"
              data-testid={`voice-card-entity-${item.id}`}
            >
              {item.entity.imageUrl ? (
                <img
                  src={item.entity.imageUrl}
                  alt=""
                  className="h-4 w-4 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <SurfaceIcon className="h-3.5 w-3.5 shrink-0" />
              )}
              {item.entity.subtitle && (
                <span className="shrink-0 font-medium text-foreground/70">{item.entity.subtitle}</span>
              )}
              <span className="truncate">{item.entity.title}</span>
            </Link>
          )}

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

            {net !== 0 && (
              <span
                className={cn(
                  "text-[11px] font-mono",
                  net > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                {net > 0 ? `+${net}` : net}
              </span>
            )}

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
    </Card>
  );
}
