import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AtSign, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CommentComposer } from "@/components/comments/CommentComposer";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { PersonSearchPopover, type PersonResult } from "./PersonSearchPopover";
import type { VoicesFeedItem } from "./types";

interface VoicesComposerProps {
  onPosted?: (item: VoicesFeedItem | null) => void;
}

export function VoicesComposer({ onPosted }: VoicesComposerProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [attachPerson, setAttachPerson] = useState<PersonResult | null>(null);

  const isAuthenticated = isLoggedIn || !!user;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: { body: string; attachment?: { type: "person"; idOrSlug: string } } = {
        body: body.trim(),
      };
      if (attachPerson) {
        payload.attachment = { type: "person", idOrSlug: attachPerson.id };
      }
      const res = await apiRequest("POST", "/api/voices/posts", payload);
      return (await res.json()) as { item: VoicesFeedItem | null };
    },
    onSuccess: (data) => {
      toast(attachPerson ? `Posted to ${attachPerson.name}'s profile` : "Posted to Voices");
      setBody("");
      setAttachPerson(null);
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
      onPosted?.(data.item ?? null);
    },
    onError: () => {
      toast.error("Could not post. Please try again.");
    },
  });

  if (!isAuthenticated) {
    return (
      <Card className="p-4 text-center">
        <p className="text-sm text-muted-foreground">
          <button
            className="text-amber-600 underline hover:text-amber-500 dark:text-amber-400"
            onClick={() => navigateToLogin(setLocation)}
            data-testid="voices-login-to-post"
          >
            Sign in
          </button>{" "}
          to share your voice
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-3" data-testid="voices-composer">
      <CommentComposer
        value={body}
        onChange={setBody}
        onSubmit={() => mutation.mutate()}
        placeholder={attachPerson ? `Share a take on ${attachPerson.name}…` : "Share your voice"}
        isPending={mutation.isPending}
        authorAvatarUrl={profile?.avatarUrl ?? null}
        authorDisplayName={profile?.username || user?.email || ""}
        replyTo={null}
        onCancelReply={() => {}}
        supportsFullscreen
        parentExpanded={false}
        scrollIntoViewOnExpand={false}
        variant="card"
        testIds={{ input: "voices-composer-input", submit: "voices-composer-submit" }}
      />
      <div className="mt-2 flex items-center gap-2 pl-11">
        {attachPerson ? (
          <Badge variant="secondary" className="gap-1">
            <AtSign className="h-3 w-3" />
            {attachPerson.name}
            <button
              type="button"
              onClick={() => setAttachPerson(null)}
              className="ml-0.5 rounded-full hover:text-destructive"
              aria-label="Remove attachment"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : (
          <PersonSearchPopover
            closeOnSelect
            onSelect={(p) => setAttachPerson(p)}
            placeholder="Mirror onto a profile…"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                data-testid="voices-composer-attach"
              >
                <AtSign className="h-3.5 w-3.5" />
                Mention a celebrity
              </Button>
            }
          />
        )}
        <span className="text-[11px] text-muted-foreground">
          {attachPerson ? "Mirrors onto their profile" : "Posts to the timeline"}
        </span>
      </div>
    </Card>
  );
}
