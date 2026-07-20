import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CommentComposer } from "@/components/comments/CommentComposer";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { PersonSearchPopover, type PersonResult } from "./PersonSearchPopover";
import type { VoicesFeedItem } from "./types";
import { VOICES_COMPOSER_INPUT_CLASS } from "./voicesSurface";

interface VoicesComposerProps {
  onPosted?: (item: VoicesFeedItem | null) => void;
}

export function VoicesComposer({ onPosted }: VoicesComposerProps) {
  const { user, isLoggedIn, profile } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [attachPerson, setAttachPerson] = useState<PersonResult | null>(null);
  const [timelinePickerOpen, setTimelinePickerOpen] = useState(false);

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
      setTimelinePickerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/voices/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profile/me"] });
      onPosted?.(data.item ?? null);
    },
    onError: () => {
      toast.error("Could not post. Please try again.");
    },
  });

  const timelineFooterAccessory = attachPerson ? (
    <div className="flex h-8 max-w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 text-xs">
      <span className="min-w-0 truncate text-amber-800 dark:text-amber-200">
        Also on {attachPerson.name}
      </span>
      <button
        type="button"
        onClick={() => setAttachPerson(null)}
        className="shrink-0 rounded-full text-amber-800 hover:text-destructive dark:text-amber-200"
        aria-label="Remove also-on-profile"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : (
    <Tooltip>
      <PersonSearchPopover
        closeOnSelect
        onSelect={(p) => setAttachPerson(p)}
        onOpenChange={setTimelinePickerOpen}
        placeholder="Search celebrities…"
        hint="Also posts to their profile timeline."
        trigger={
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 max-w-full gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
              data-testid="voices-composer-attach"
            >
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Also on profile</span>
            </Button>
          </TooltipTrigger>
        }
      />
      <TooltipContent side="top" sideOffset={6} className="max-w-[240px]">
        Also publish this post on a celebrity&apos;s profile timeline.
      </TooltipContent>
    </Tooltip>
  );

  if (!isAuthenticated) {
    return (
      <div className="px-1.5 py-4 text-center sm:px-4">
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
      </div>
    );
  }

  return (
    <div className="px-1.5 py-3 sm:px-4" data-testid="voices-composer">
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
        onCancel={() => {
          setAttachPerson(null);
          setTimelinePickerOpen(false);
        }}
        supportsFullscreen
        parentExpanded={false}
        scrollIntoViewOnExpand={false}
        hideTopBorder
        inputClassName={VOICES_COMPOSER_INPUT_CLASS}
        variant="card"
        footerAccessory={timelineFooterAccessory}
        keepActionsVisible={Boolean(attachPerson) || timelinePickerOpen}
        testIds={{ input: "voices-composer-input", submit: "voices-composer-submit" }}
      />
    </div>
  );
}
