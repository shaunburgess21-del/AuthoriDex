import type { ComponentType, SVGProps } from "react";
import {
  Swords,
  BarChart3,
  Globe,
  User as UserIcon,
  MessagesSquare,
  CornerDownRight,
  ThumbsUp,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatTimeAgo } from "@/lib/formatDate";
import { cn } from "@/lib/utils";
import type { MeCommentItem } from "@shared/me-comments";

const REF_ICON: Record<MeCommentItem["entity"]["refType"], ComponentType<SVGProps<SVGSVGElement>>> = {
  matchup: Swords,
  trending_poll: BarChart3,
  opinion_poll: BarChart3,
  open_market: Globe,
  person: UserIcon,
  timeline: MessagesSquare,
};

/**
 * Short, human label describing where a message lives. Mirrors the Voices
 * context chip but written from the author's point of view:
 *   "Timeline post", "Insight on Elon Musk", "Reply on Matchup: ...".
 */
function contextLabel(item: MeCommentItem): string {
  if (item.source === "insight") return `Insight on ${item.entity.title}`;
  if (item.parentType === "voices_post") {
    return item.isReply ? "Reply on the timeline" : "Timeline post";
  }
  const surface = item.entity.subtitle ?? "discussion";
  const prefix = item.isReply ? "Reply on" : "Comment on";
  return `${prefix} ${surface}: ${item.entity.title}`;
}

interface MyCommentCardProps {
  item: MeCommentItem;
  onOpen: (item: MeCommentItem) => void;
}

export function MyCommentCard({ item, onOpen }: MyCommentCardProps) {
  const Icon = item.isReply ? CornerDownRight : REF_ICON[item.entity.refType] ?? MessagesSquare;

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
      data-testid={`my-comment-${item.source}-${item.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{contextLabel(item)}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatTimeAgo(item.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm line-clamp-3">{item.body}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {item.upvotes > 0 && (
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="h-3.5 w-3.5" />
                {item.upvotes}
              </span>
            )}
            <span className={cn("ml-auto inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400")}>
              View thread
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
