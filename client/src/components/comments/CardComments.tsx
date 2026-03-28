import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatTimeAgo } from "@/lib/formatDate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageSquare,
  ArrowUpDown,
  Clock,
  Send,
  Loader2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

export type CommentEntityType = "matchup" | "poll" | "opinion-poll";

interface CardComment {
  id: string;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  body: string;
  parentId: string | null;
  upvotes: number;
  downvotes: number;
  createdAt: string;
}

const API_BASE: Record<CommentEntityType, string> = {
  matchup: "/api/matchups",
  poll: "/api/polls",
  "opinion-poll": "/api/opinion-polls",
};

interface CardCommentsProps {
  entityType: CommentEntityType;
  slug: string;
  /** 'card' wraps in a headed Card (for detail pages), 'inline' renders bare list (for bottom sheet) */
  variant?: "card" | "inline";
  /** Override max height of the scrollable comments area */
  maxHeight?: string;
  placeholder?: string;
}

export function CardComments({
  entityType,
  slug,
  variant = "card",
  maxHeight = "500px",
  placeholder = "Share your thoughts...",
}: CardCommentsProps) {
  const { user, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [commentBody, setCommentBody] = useState("");
  const [commentSort, setCommentSort] = useState<"top" | "newest">("top");

  const base = API_BASE[entityType];
  const queryKey = [base, slug, "comments"];

  const { data: comments = [] } = useQuery<CardComment[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`${base}/${slug}/comments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug,
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `${base}/${slug}/comments`, { body });
      return res.json();
    },
    onSuccess: () => {
      setCommentBody("");
      queryClient.invalidateQueries({ queryKey });
      if (entityType === "opinion-poll") {
        queryClient.invalidateQueries({ queryKey: [base, slug] });
      }
      toast({ title: "Comment Posted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post comment. Please sign in.", variant: "destructive" });
    },
  });

  const commentVoteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: "up" | "down" }) => {
      const res = await apiRequest("POST", `${base}/comments/${commentId}/vote`, { voteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to vote. Please sign in.", variant: "destructive" });
    },
  });

  const sortedComments = useMemo(() => {
    if (!comments.length) return [];
    const sorted = [...comments];
    if (commentSort === "top") {
      sorted.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));
    } else {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return sorted;
  }, [comments, commentSort]);

  const handlePost = () => {
    if (!commentBody.trim()) return;
    commentMutation.mutate(commentBody.trim());
  };

  const isAuthenticated = isLoggedIn || !!user;

  const sortBar = (
    <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
      {variant === "card" && (
        <h2 className="text-lg font-serif font-bold flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-cyan-500" />
          Discussion ({comments.length})
        </h2>
      )}
      {variant === "inline" && (
        <span className="text-sm font-semibold text-muted-foreground">
          {comments.length} {comments.length === 1 ? "comment" : "comments"}
        </span>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant={commentSort === "top" ? "default" : "ghost"}
          size="sm"
          onClick={() => setCommentSort("top")}
          data-testid="button-sort-top"
        >
          <ArrowUpDown className="h-3.5 w-3.5 mr-1" />
          Top
        </Button>
        <Button
          variant={commentSort === "newest" ? "default" : "ghost"}
          size="sm"
          onClick={() => setCommentSort("newest")}
          data-testid="button-sort-newest"
        >
          <Clock className="h-3.5 w-3.5 mr-1" />
          Newest
        </Button>
      </div>
    </div>
  );

  const inputArea = isAuthenticated ? (
    <div className="mb-5">
      <Textarea
        placeholder={placeholder}
        value={commentBody}
        onChange={(e) => setCommentBody(e.target.value)}
        className="mb-2 bg-background/50 resize-none"
        rows={3}
        data-testid="input-comment"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!commentBody.trim() || commentMutation.isPending}
          onClick={handlePost}
          data-testid="button-submit-comment"
        >
          {commentMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-1.5" />
          )}
          Post
        </Button>
      </div>
    </div>
  ) : (
    <div className="text-center py-3 mb-4 rounded-lg border border-dashed border-border/50">
      <p className="text-sm text-muted-foreground">
        <Button
          variant="ghost"
          className="p-0 h-auto text-cyan-400 underline"
          onClick={() => setLocation("/login")}
          data-testid="link-login-to-comment"
        >
          Sign in
        </Button>{" "}
        to join the discussion
      </p>
    </div>
  );

  const commentsList = sortedComments.length > 0 ? (
    <ScrollArea style={{ maxHeight }}>
      <div className="space-y-4">
        {sortedComments.map((comment, idx) => {
          const netVotes = (comment.upvotes || 0) - (comment.downvotes || 0);
          const isTopComment = commentSort === "top" && idx === 0 && netVotes > 0;
          return (
            <div
              key={comment.id}
              className={`flex gap-3 p-3 rounded-lg ${isTopComment ? "bg-cyan-500/5 border border-cyan-500/20" : ""}`}
              data-testid={`comment-${comment.id}`}
            >
              <Avatar className="h-8 w-8 shrink-0">
                {comment.avatarUrl && <AvatarImage src={comment.avatarUrl} alt={comment.username || ""} />}
                <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs font-semibold">
                  {(comment.username || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" data-testid={`text-comment-user-${comment.id}`}>
                    {comment.username || "Anonymous"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTimeAgo(comment.createdAt)}
                  </span>
                  {isTopComment && (
                    <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400 py-0">
                      Top Take
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap" data-testid={`text-comment-body-${comment.id}`}>
                  {comment.body}
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "up" })}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-400 transition-colors"
                    data-testid={`button-upvote-${comment.id}`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    {(comment.upvotes || 0) > 0 && <span>{comment.upvotes}</span>}
                  </button>
                  <button
                    onClick={() => commentVoteMutation.mutate({ commentId: comment.id, voteType: "down" })}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-rose-400 transition-colors"
                    data-testid={`button-downvote-${comment.id}`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    {(comment.downvotes || 0) > 0 && <span>{comment.downvotes}</span>}
                  </button>
                  {netVotes !== 0 && (
                    <span className={`text-xs font-mono ${netVotes > 0 ? "text-cyan-400" : "text-rose-400"}`}>
                      {netVotes > 0 ? `+${netVotes}` : netVotes}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  ) : (
    <p className="text-sm text-muted-foreground text-center py-6">
      No comments yet. Be the first to share your thoughts!
    </p>
  );

  if (variant === "inline") {
    return (
      <div className="flex flex-col h-full">
        {sortBar}
        {inputArea}
        <div className="flex-1 min-h-0">{commentsList}</div>
      </div>
    );
  }

  return (
    <div className="p-5 mb-6 rounded-xl border bg-card text-card-foreground shadow" data-testid="section-comments">
      {sortBar}
      {inputArea}
      {commentsList}
    </div>
  );
}

export function useCommentCount(entityType: CommentEntityType, slug: string): number {
  const base = API_BASE[entityType];
  const { data: comments = [] } = useQuery<CardComment[]>({
    queryKey: [base, slug, "comments"],
    queryFn: async () => {
      const res = await fetch(`${base}/${slug}/comments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!slug,
  });
  return comments.length;
}
