import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CardCommentsFocusOverlay } from "@/components/comments/CardComments";
import { PostOverlayModal } from "@/components/PostOverlayModal";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "sonner";
import { VoicesPostOverlay } from "./VoicesPostOverlay";
import { CARD_ENTITY_TYPE, type VoicesFeedItem } from "./types";

interface VoiceDetailOverlayProps {
  item: VoicesFeedItem | null;
  onClose: () => void;
}

/**
 * Opens the right detail surface for a selected Voices feed item:
 * - card comment  → CardCommentsFocusOverlay (mirrors the source card thread)
 * - profile post  → PostOverlayModal (mirrors the community insight thread)
 * - timeline post → VoicesPostOverlay (standalone voices_post thread)
 */
export function VoiceDetailOverlay({ item, onClose }: VoiceDetailOverlayProps) {
  if (!item) return null;

  if (item.parentType === "voices_post") {
    return <VoicesPostOverlay item={item} onClose={onClose} />;
  }

  if (item.source === "insight") {
    return <InsightOverlay item={item} onClose={onClose} />;
  }

  const entityType = CARD_ENTITY_TYPE[item.entity.refType];
  if (entityType && item.entity.slug) {
    return <CardCommentOverlay item={item} entityType={entityType} slug={item.entity.slug} onClose={onClose} />;
  }

  // Unresolvable card (e.g. deleted slug) — nothing to focus on.
  return null;
}

function CardCommentOverlay({
  item,
  entityType,
  slug,
  onClose,
}: {
  item: VoicesFeedItem;
  entityType: "matchup" | "poll" | "opinion-poll" | "open-market";
  slug: string;
  onClose: () => void;
}) {
  // Deep-link the selected comment so the focus overlay highlights it. The
  // hash is read by useCommentDeepLink inside CardCommentsFocusInner.
  useEffect(() => {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}#comment-${item.id}`);
    return () => {
      window.history.replaceState(null, "", `${pathname}${search}`);
    };
  }, [item.id]);

  return (
    <CardCommentsFocusOverlay
      open
      onClose={onClose}
      entityType={entityType}
      slug={slug}
      contextTitle={item.entity.title}
    />
  );
}

function InsightOverlay({ item, onClose }: { item: VoicesFeedItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [userVote, setUserVote] = useState<"up" | undefined>(item.userVote === "up" ? "up" : undefined);
  const [deleted, setDeleted] = useState(false);

  const insight = {
    id: item.id,
    personId: item.entity.refId,
    userId: item.author.userId,
    username: item.author.username,
    avatarUrl: item.author.avatarUrl,
    content: deleted ? "" : item.body,
    sentimentVote: null,
    deletedAt: deleted ? new Date().toISOString() : null,
    createdAt: item.createdAt,
    upvotes: item.upvotes,
    downvotes: item.downvotes,
    parentVoteLabel: item.parentVoteLabel ?? null,
  };

  // After the community_insights → comments merge, profile posts are comments
  // rows — vote and delete go through the standard /api/comments endpoints.
  const voteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/comments/${item.id}/vote`, { voteType: "up" });
      return res.json();
    },
    onSuccess: () => {
      setUserVote((prev) => (prev === "up" ? undefined : "up"));
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/comments/${item.id}`);
      return res.json();
    },
    onSuccess: () => {
      setDeleted(true);
      toast("Post deleted");
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      onClose();
    },
  });

  return (
    <PostOverlayModal
      insight={insight}
      isOpen
      onClose={onClose}
      userVote={userVote}
      onVote={() => voteMutation.mutate()}
      onDeleteInsight={() => deleteMutation.mutate()}
      isDeletingInsight={deleteMutation.isPending}
    />
  );
}
