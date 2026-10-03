import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiRequest } from "@/lib/queryClient";

/** Persist a one-way block and refresh comment threads the viewer is looking at. */
export function useBlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (blockedUserId: string) => {
      const res = await apiRequest("POST", `/api/users/${encodeURIComponent(blockedUserId)}/block`);
      return res.json();
    },
    onSuccess: () => {
      toast("User blocked", {
        description: "Their comments are hidden from you. Unblock them in Settings → Privacy.",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/comments"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/voices/post"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/me/blocks"] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        toast.error("Sign in required", { description: "Sign in to block a user." });
        return;
      }
      const message = error instanceof ApiError ? error.message : "";
      if (message.includes("cannot block yourself")) {
        toast.error("You can't block yourself");
        return;
      }
      toast.error("Couldn't block user", { description: "Please try again." });
    },
  });
}
