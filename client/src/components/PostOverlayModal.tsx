import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThumbsUp, ThumbsDown, MessageCircle, X, Send, Loader2, ChevronDown, ChevronUp } from "lucide-react";
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

interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  username: string;
  content: string;
  sentimentVote?: number | null;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

function getSentimentColor(vote: number): string {
  const colors = [
    "#dc2626", "#e63946", "#f97316", "#fa9c3c", "#fbbf24",
    "#c1d42d", "#84cc16", "#5bca30", "#22c55e", "#22c55e",
  ];
  return colors[vote - 1] || colors[4];
}

interface PostOverlayModalProps {
  insight: CommunityInsight | null;
  isOpen: boolean;
  onClose: () => void;
  userVote?: string;
  onVote: (insightId: string, voteType: "up" | "down") => void;
}

export function PostOverlayModal({ insight, isOpen, onClose, userVote, onVote }: PostOverlayModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [userCommentVotes, setUserCommentVotes] = useState<Record<string, string>>({});
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: [`/api/insight-comments/${insight?.id}`],
    enabled: isOpen && !!insight?.id,
  });

  useEffect(() => {
    if (!user || !isOpen || !insight?.id) return;

    async function fetchUserVotes() {
      try {
        const supabase = await import("@/lib/supabase").then(m => m.getSupabase());
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) return;

        const response = await fetch(`/api/insight-comments/${insight!.id}/votes`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (response.ok) {
          const votes = await response.json();
          setUserCommentVotes(votes);
        }
      } catch (error) {
        console.error("Error fetching user comment votes:", error);
      }
    }

    fetchUserVotes();
  }, [insight?.id, user, isOpen]);

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
          insightId: insight?.id,
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
      queryClient.invalidateQueries({ queryKey: [`/api/insight-comments/${insight?.id}`] });
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
      setUserCommentVotes(prev => {
        if (prev[variables.commentId] === variables.voteType) {
          const newVotes = { ...prev };
          delete newVotes[variables.commentId];
          return newVotes;
        }
        return { ...prev, [variables.commentId]: variables.voteType };
      });
      queryClient.invalidateQueries({ queryKey: [`/api/insight-comments/${insight?.id}`] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to vote",
        variant: "destructive",
      });
    },
  });

  const handleCommentVote = (commentId: string, voteType: "up" | "down") => {
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

  const startReply = (comment: Comment) => {
    setReplyingTo({ id: comment.id, username: comment.username });
    setReplyContent(`@${comment.username} `);
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

  if (!isOpen || !insight) return null;

  const netVotes = insight.upvotes - insight.downvotes;
  const topLevelComments = comments.filter(c => !c.parentId);
  const getReplies = (parentId: string) => comments.filter(c => c.parentId === parentId);

  const renderComment = (comment: Comment, depth: number = 0) => {
    const replies = getReplies(comment.id);
    const hasReplies = replies.length > 0;
    const isRepliesExpanded = expandedReplies.has(comment.id);
    const commentVote = userCommentVotes[comment.id];
    const commentNetVotes = comment.upvotes - comment.downvotes;
    const maxDepth = 3;

    return (
      <div 
        key={comment.id} 
        className={`${depth > 0 ? 'ml-6 border-l-2 border-border pl-4' : ''}`}
        data-testid={`overlay-comment-${comment.id}`}
      >
        <div className="py-3">
          <div className="flex items-start gap-3">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="text-xs">
                {comment.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{comment.username}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm mt-1 break-words">{comment.content}</p>
              
              <div className="flex items-center gap-1 mt-2">
                <button
                  onClick={() => handleCommentVote(comment.id, "up")}
                  disabled={!user}
                  className={`p-1.5 rounded transition-colors ${
                    commentVote === "up" 
                      ? "text-green-500 bg-green-500/10" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`button-overlay-comment-upvote-${comment.id}`}
                >
                  <ThumbsUp className={`h-4 w-4 ${commentVote === "up" ? "fill-current" : ""}`} />
                </button>

                <span className={`text-sm font-medium min-w-[2rem] text-center ${
                  commentNetVotes > 0 ? "text-green-500" : commentNetVotes < 0 ? "text-red-500" : "text-muted-foreground"
                }`}>
                  {commentNetVotes > 0 ? `+${commentNetVotes}` : commentNetVotes}
                </span>

                <button
                  onClick={() => handleCommentVote(comment.id, "down")}
                  disabled={!user}
                  className={`p-1.5 rounded transition-colors ${
                    commentVote === "down" 
                      ? "text-red-500 bg-red-500/10" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid={`button-overlay-comment-downvote-${comment.id}`}
                >
                  <ThumbsDown className={`h-4 w-4 ${commentVote === "down" ? "fill-current" : ""}`} />
                </button>

                {depth < maxDepth && (
                  <button
                    onClick={() => startReply(comment)}
                    className="flex items-center gap-1 ml-2 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    data-testid={`button-overlay-comment-reply-${comment.id}`}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                )}

                {hasReplies && (
                  <button
                    onClick={() => toggleReplies(comment.id)}
                    className="flex items-center gap-1 ml-2 text-xs text-primary hover:underline"
                  >
                    {isRepliesExpanded ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>Hide {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {replyingTo?.id === comment.id && (
                <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">
                    Replying to @{replyingTo.username}
                  </div>
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Write a reply..."
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                      data-testid={`textarea-overlay-reply-${comment.id}`}
                    />
                    <div className="flex flex-col gap-1">
                      <Button
                        size="icon"
                        onClick={() => handleSubmitReply(comment.id)}
                        disabled={createCommentMutation.isPending || !replyContent.trim()}
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
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
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
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
      data-testid="post-overlay-modal"
    >
      <div 
        className="relative w-full max-w-2xl my-8 mx-4 bg-background rounded-xl shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur-sm">
          <h2 className="text-lg font-semibold">Post</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            data-testid="button-close-overlay"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-12 w-12 flex-shrink-0">
              <AvatarFallback>
                {insight.username.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{insight.username}</span>
                {insight.sentimentVote && (
                  <span 
                    className="text-xs px-2 py-0.5 rounded-full backdrop-blur-sm border"
                    style={{
                      backgroundColor: `${getSentimentColor(insight.sentimentVote)}15`,
                      color: getSentimentColor(insight.sentimentVote),
                      borderColor: `${getSentimentColor(insight.sentimentVote)}40`,
                    }}
                  >
                    Voted {insight.sentimentVote}/10
                  </span>
                )}
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(insight.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="mt-3 text-base leading-relaxed break-words whitespace-pre-wrap">
                {insight.content}
              </p>

              <div className="flex items-center gap-1 mt-4 pt-4 border-t border-border">
                <button
                  onClick={() => onVote(insight.id, "up")}
                  disabled={!user}
                  className={`p-2 rounded-lg transition-colors ${
                    userVote === "up" 
                      ? "text-green-500 bg-green-500/10" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid="button-overlay-upvote"
                >
                  <ThumbsUp className={`h-5 w-5 ${userVote === "up" ? "fill-current" : ""}`} />
                </button>

                <span className={`text-base font-semibold min-w-[3rem] text-center ${
                  netVotes > 0 ? "text-green-500" : netVotes < 0 ? "text-red-500" : "text-muted-foreground"
                }`}>
                  {netVotes > 0 ? `+${netVotes}` : netVotes}
                </span>

                <button
                  onClick={() => onVote(insight.id, "down")}
                  disabled={!user}
                  className={`p-2 rounded-lg transition-colors ${
                    userVote === "down" 
                      ? "text-red-500 bg-red-500/10" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  } ${!user ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  data-testid="button-overlay-downvote"
                >
                  <ThumbsDown className={`h-5 w-5 ${userVote === "down" ? "fill-current" : ""}`} />
                </button>

                <div className="flex items-center gap-1 ml-4 text-muted-foreground">
                  <MessageCircle className="h-5 w-5" />
                  <span className="text-sm">{comments.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border">
          <div className="p-4">
            <h3 className="font-semibold mb-4">
              {comments.length} {comments.length === 1 ? 'Reply' : 'Replies'}
            </h3>

            {user && (
              <div className="flex gap-3 mb-6">
                <Avatar className="h-8 w-8 flex-shrink-0">
                  <AvatarFallback className="text-xs">
                    {(user.email?.substring(0, 2) || "U").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 flex gap-2">
                  <Textarea
                    placeholder="Add a reply..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={2}
                    className="resize-none"
                    data-testid="textarea-overlay-new-comment"
                  />
                  <Button
                    size="icon"
                    onClick={handleSubmitComment}
                    disabled={createCommentMutation.isPending || !newComment.trim()}
                    data-testid="button-overlay-submit-comment"
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
              <p className="text-sm text-muted-foreground mb-4">
                Log in to add a reply.
              </p>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-muted-foreground">Loading replies...</span>
              </div>
            ) : topLevelComments.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No replies yet. Be the first to reply!
              </p>
            ) : (
              <div className="divide-y divide-border">
                {topLevelComments.map(comment => renderComment(comment))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
