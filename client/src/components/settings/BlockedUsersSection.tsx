import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

interface BlockedUserRow {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  blockedAt: string;
}

interface BlocksResponse {
  data?: { blocks?: BlockedUserRow[] };
}

/** Unblock list for people hidden from the signed-in user's comment threads. */
export function BlockedUsersSection() {
  const queryClient = useQueryClient();
  const blocksQuery = useQuery({
    queryKey: ["/api/me/blocks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/blocks");
      const json = (await res.json()) as BlocksResponse;
      return json.data?.blocks ?? [];
    },
  });

  const unblock = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/users/${encodeURIComponent(userId)}/block`);
      return res.json();
    },
    onSuccess: () => {
      toast("User unblocked", { description: "Their comments will show in your threads again." });
      void queryClient.invalidateQueries({ queryKey: ["/api/me/blocks"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/voices/post"] });
    },
    onError: () => {
      toast.error("Couldn't unblock user", { description: "Please try again." });
    },
  });

  const blocks = blocksQuery.data ?? [];

  return (
    <div className="pt-4 border-t border-border/60 space-y-3" data-testid="section-blocked-users">
      <div className="space-y-1">
        <p className="text-sm font-medium">Blocked users</p>
        <p className="text-xs text-muted-foreground">
          People you block are hidden from comment threads you load. Their comments stay visible to everyone else.
        </p>
      </div>
      {blocksQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading
        </div>
      ) : blocksQuery.isError ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load blocked users.</p>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-blocked-users">
          You haven&apos;t blocked anyone.
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((block) => (
            <li
              key={block.userId}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">
                {block.username?.trim() || "User"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unblock.isPending}
                data-testid={`button-unblock-${block.userId}`}
                onClick={() => unblock.mutate(block.userId)}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
