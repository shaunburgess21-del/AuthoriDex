import { useState } from "react";
import { Drawer } from "vaul";
import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { useXpBurst } from "@/components/XpBurstProvider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SuggestCategorySelect } from "@/components/suggest/SuggestCategorySelect";
import {
  SUGGEST_DRAWER_OVERLAY,
  SUGGEST_DRAWER_CONTENT,
  SUGGEST_DRAWER_HANDLE,
  SUGGEST_DRAWER_HEADER,
  SUGGEST_DRAWER_BODY,
  SUGGEST_DRAWER_FOOTER,
  SUGGEST_DRAWER_TITLE,
  SUGGEST_DRAWER_DESCRIPTION,
} from "@/components/suggest/drawerStyles";
import { CATEGORIES_LEADERBOARD } from "@shared/constants";

interface SuggestCandidateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback fired after a successful submission (e.g. to invalidate queries). */
  onSubmitted?: () => void;
}

/**
 * Reusable "Suggest a Candidate" drawer for the Induction Queue.
 * Owns its own form + submission state so it can be dropped into any page
 * (Vote page sections, Induction Queue page) without lifting state.
 */
export function SuggestCandidateModal({ open, onOpenChange, onSubmitted }: SuggestCandidateModalProps) {
  const { trigger: triggerXpBurst } = useXpBurst();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const suggestRes = await apiRequest("POST", "/api/suggestions", {
        type: "induction",
        payload: {
          displayName: name,
          socialUrl: url,
          category: category || undefined,
          reason: reason || undefined,
        },
      });
      const suggestData = await suggestRes.json();
      if (suggestData?.xp?.xpAwarded) {
        triggerXpBurst(suggestData.xp.xpAwarded, undefined, suggestData.xp.reason);
      }
      setName("");
      setUrl("");
      setCategory("");
      setReason("");
      onOpenChange(false);
      onSubmitted?.();
      toast("Candidate suggested!", { description: "We'll review it shortly. You earned 5 XP!" });
    } catch (err: any) {
      toast.error("Submission failed", { description: err?.message ?? "Something went wrong. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className={SUGGEST_DRAWER_OVERLAY} />
        <Drawer.Content className={SUGGEST_DRAWER_CONTENT}>
          <div className={SUGGEST_DRAWER_HANDLE} />
          <div className={SUGGEST_DRAWER_HEADER}>
            <div>
              <Drawer.Title className={SUGGEST_DRAWER_TITLE}>
                <UserPlus className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                Suggest a Candidate
              </Drawer.Title>
              <Drawer.Description className={SUGGEST_DRAWER_DESCRIPTION}>
                Who are we missing? Suggest someone NEW to be added to VoxDex.
              </Drawer.Description>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors" aria-label="Close">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className={SUGGEST_DRAWER_BODY}>
            <div>
              <label className="text-sm font-medium mb-1 block">Candidate Name *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter the person's name"
                data-testid="input-induction-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Social/Profile URL *</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://twitter.com/... or https://instagram.com/..."
                data-testid="input-induction-url"
                className={url && !url.startsWith('http') ? 'border-red-500' : ''}
              />
              {url && !url.startsWith('http') ? (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">Please enter a valid URL starting with http:// or https://</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Required for verification</p>
              )}
            </div>
            <SuggestCategorySelect value={category} onChange={setCategory} categories={CATEGORIES_LEADERBOARD} label="Category (optional)" data-testid="select-induction-category" />
            <div>
              <label className="text-sm font-medium mb-1 block">Why should they be on VoxDex? (optional)</label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief reason..."
                data-testid="input-induction-reason"
              />
            </div>
          </div>
          <div className={`${SUGGEST_DRAWER_FOOTER} justify-end`}>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-induction">Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !name || !url || !url.startsWith('http')}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-induction"
            >
              {isSubmitting ? "Submitting…" : "Submit Suggestion"}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
