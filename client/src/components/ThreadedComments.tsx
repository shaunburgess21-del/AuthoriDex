import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, ThumbsDown, MessageCircle, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Comment {
  id: string;
  insightId: string;
  parentId: string | null;
  userId: string;
  username: string;
  content: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

interface ThreadedCommentsProps {
  insightId: string;
  isOpen: boolean;
  onToggle: () => void;
  commentCount?: number;
}

export function ThreadedComments({ insightId, isOpen, onToggle, commentCount = 0 }: ThreadedCommentsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  const { data: comments = [], isLoading, refetch } = useQuery<Comment[]>({
    queryKey: [`/api/insight-comments/${insightId}`],
    enabled: isOpen,
  });

  useEffect(() => {
    if (!user || !isOpen) return;

    async function fetchUserVotes() {
      try {
        const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) return;

        const response = await fetch(`/api/insight-comments/${insightId}/votes`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (response.ok) {
          const votes = await response.json();
          setUserVotes(votes);
        }
      } catch (error) {
        console.error("Error fetching user comment votes:", error);
      }
    }

    fetchUserVotes();
  }, [insightId, user, isOpen]);

  const createCommentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string }) => {
      if (!user) throw new Error("Must be logged in to comment");
      
      const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) throw new Error("No active session");

      const response = await fetch("/api/insight-comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          insightId,
          parentId: parentId || null,
          username: user.email?.split('@')[0] || user.id.substring(0, 8),
          content,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create comment");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/insight-comments/${insightId}`] });
      setNewComment("");
      setReplyContent("");
      setReplyingTo(null);
      toast({
        title: "Comment posted",
        description: "Your comment has been added.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to post comment",
        variant: "destructive",
      });
    },
  });

  const voteMutation = useMutation({
    mutationFn: async ({ commentId, voteType }: { commentId: string; voteType: string }) => {
      if (!user) throw new Error("Must be logged in to vote");

      const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) throw new Error("No active session");

      const response = await fetch(`/api/insight-comments/${commentId}/vote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ voteType }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to vote");
      }

      return { commentId, voteType };
    },
    onSuccess: (_, variables) => {
      setUserVotes(prev => {
        if (prev[variables.commentId] === variables.voteType) {
          const newVotes = { ...prev };
          delete newVotes[variables.commentId];
          return newVotes;
        }
        return {
          ...prev,
          [variables.commentId]: variables.voteType,
        };
      });
      queryClient.invalidateQueries({ queryKey: [`/api/insight-comments/${insightId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (commentId: string, voteType: "up" | "down") => {
    if (!user) {
      toast({
        title: "Login Required",
        description: "Please log in to vote on comments",
        variant: "destructive",
      });
      return;
    }
    voteMutation.mutate({ commentId, voteType });
  };

  const handleSubmitComment = () => {
    if (!newComment.trim()) return;
    createCommentMutation.mutate({ content: newComment });
  };

  const handleSubmitReply = (parentId: string) => {
    if (!replyContent.trim()) return;
    createCommentMutation.mutate({ content: replyContent, parentId });
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commentId)) {
        newSet.delete(commentId);
      } else {
        newSet.add(commentId);
      }
      return newSet;
    });
  };

  const topLevelComments = comments.filter(c => !c.parentId);
  const getReplies = (parentId: string) => comments.filter(c => c.parentId === parentId);
  const displayedCount = comments.length || commentCount;

  const renderComment = (comment: Comment, depth: number = 0) => {
    const replies = getReplies(comment.id);
    const hasReplies = replies.length > 0;
    const isRepliesExpanded = expandedReplies.has(comment.id);
    const userVote = userVotes[comment.id];
    const netVotes = comment.upvotes - comment.downvotes;
    const maxDepth = 3;

    return (
      <div 
        key={comment.id} 
        className={`${depth > 0 ? 'ml-6 border-l-2 border-border pl-4' : ''}`}
        data-testid={`comment-${comment.id}`}
      >
        <div className="py-2">
          <div className="flex items-start gap-2">
            <Avatar className="h-6 w-6 flex-shrink-0">
              <AvatarFallback className="text-xs">
                {comment.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium" data-testid={`comment-username-${comment.id}`}>
                  {comment.username}
                </span>
                <span className="text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm mt-1 break-words" data-testid={`comment-content-${comment.id}`}>
                {comment.content}
              </p>
              
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => handleVote(comment.id, "up")}
                  disabled={!user}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    userVote === "up" 
                      ? "text-green-500" 
                      : "text-muted-foreground hover:text-foreground"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`button-comment-upvote-${comment.id}`}
                >
                  <ThumbsUp className={`h-3.5 w-3.5 ${userVote === "up" ? "fill-current" : ""}`} />
                  <span>{comment.upvotes}</span>
                </button>

                <button
                  onClick={() => handleVote(comment.id, "down")}
                  disabled={!user}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    userVote === "down" 
                      ? "text-red-500" 
                      : "text-muted-foreground hover:text-foreground"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`button-comment-downvote-${comment.id}`}
                >
                  <ThumbsDown className={`h-3.5 w-3.5 ${userVote === "down" ? "fill-current" : ""}`} />
                  <span>{comment.downvotes}</span>
                </button>

                {depth < maxDepth && (
                  <button
                    onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`button-comment-reply-${comment.id}`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Reply</span>
                  </button>
                )}

                {hasReplies && (
                  <button
                    onClick={() => toggleReplies(comment.id)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    data-testid={`button-toggle-replies-${comment.id}`}
                  >
                    {isRepliesExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>Hide {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>Show {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {replyingTo === comment.id && (
                <div className="mt-3 flex gap-2">
                  <Textarea
                    placeholder="Write a reply..."
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                    data-testid={`textarea-reply-${comment.id}`}
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      size="icon"
                      onClick={() => handleSubmitReply(comment.id)}
                      disabled={createCommentMutation.isPending || !replyContent.trim()}
                      data-testid={`button-submit-reply-${comment.id}`}
                    >
                      {createCommentMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyContent("");
                      }}
                      data-testid={`button-cancel-reply-${comment.id}`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {hasReplies && isRepliesExpanded && (
          <div className="mt-1">
            {replies.map(reply => renderComment(reply, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pl-11" data-testid={`comments-section-${insightId}`}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all"
        data-testid={`button-toggle-comments-${insightId}`}
      >
        <MessageCircle className="h-4 w-4" />
        <span>{displayedCount > 0 ? `${displayedCount} Comments` : "Comment"}</span>
        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3" data-testid={`comments-expanded-${insightId}`}>
          {user && (
            <div className="flex gap-2">
              <Avatar className="h-6 w-6 flex-shrink-0">
                <AvatarFallback className="text-xs">
                  {(user.email?.substring(0, 2) || "U").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 flex gap-2">
                <Textarea
                  placeholder="Write a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={2}
                  className="resize-none text-sm"
                  data-testid={`textarea-new-comment-${insightId}`}
                />
                <Button
                  size="icon"
                  onClick={handleSubmitComment}
                  disabled={createCommentMutation.isPending || !newComment.trim()}
                  data-testid={`button-submit-comment-${insightId}`}
                >
                  {createCommentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {!user && (
            <p className="text-xs text-muted-foreground">
              Log in to comment on this insight.
            </p>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Loading comments...</span>
            </div>
          ) : topLevelComments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No comments yet. Be the first to comment!
            </p>
          ) : (
            <div className="divide-y divide-border">
              {topLevelComments.map(comment => renderComment(comment))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
