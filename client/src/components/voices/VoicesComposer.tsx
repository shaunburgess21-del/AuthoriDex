import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommentComposer } from "@/components/comments/CommentComposer";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { PersonSearchPopover, type PersonResult } from "./PersonSearchPopover";
import type { VoicesFeedItem } from "./types";
import {
  VOICES_COMPOSER_INPUT_CLASS,
  VOICES_COMPOSER_SURFACE_CLASS,
  VOICES_FEED_SURFACE_CLASS,
} from "./voicesSurface";

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
    mutationFn: async (serializedBody: string) => {
      const payload: { body: string; attachment?: { type: "person"; idOrSlug: string } } = {
        body: serializedBody,
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

  const timelineAccessory = attachPerson ? (
    <div className="flex h-9 w-full items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-sm">
      <span className="truncate text-amber-800 dark:text-amber-200">
        {attachPerson.name}&apos;s timeline
      </span>
      <button
        type="button"
        onClick={() => setAttachPerson(null)}
        className="ml-2 shrink-0 rounded-full text-amber-800 hover:text-destructive dark:text-amber-200"
        aria-label="Remove celebrity timeline"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (
    <PersonSearchPopover
      closeOnSelect
      onSelect={(p) => setAttachPerson(p)}
      placeholder="Search celebrities…"
      trigger={
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-between gap-2 border-dashed font-normal text-muted-foreground hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-foreground"
          data-testid="voices-composer-attach"
        >
          <span className="flex items-center gap-2">
            <UserRound className="h-4 w-4 shrink-0" />
            Post to celebrity timeline
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      }
    />
  );

  if (!isAuthenticated) {
    return (
      <Card className={cn("p-4 text-center", VOICES_FEED_SURFACE_CLASS)}>
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
    <Card className={cn("p-3", VOICES_COMPOSER_SURFACE_CLASS)} data-testid="voices-composer">
      <CommentComposer
        value={body}
        onChange={setBody}
        onSubmit={(serializedBody) => mutation.mutate(serializedBody)}
        placeholder={attachPerson ? `Share a take on ${attachPerson.name}…` : "Share your voice"}
        isPending={mutation.isPending}
        authorAvatarUrl={profile?.avatarUrl ?? null}
        authorDisplayName={profile?.username || user?.email || ""}
        replyTo={null}
        onCancelReply={() => {}}
        supportsFullscreen
        parentExpanded={false}
        scrollIntoViewOnExpand={false}
        hideTopBorder
        inputClassName={VOICES_COMPOSER_INPUT_CLASS}
        variant="card"
        accessory={timelineAccessory}
        testIds={{ input: "voices-composer-input", submit: "voices-composer-submit" }}
      />
    </Card>
  );
}
