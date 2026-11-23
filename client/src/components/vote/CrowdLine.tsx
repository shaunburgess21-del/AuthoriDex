import { Share2 } from "lucide-react";
import { useReferralLink } from "@/hooks/useReferralLink";
import { shareVoteCard, voteCrowdShareText } from "@/lib/voteCardShare";
import type { ShareSurface } from "@/lib/share";

export interface CrowdLineShare {
  headline: string;
  percent: number;
  path: string;
  surface: ShareSurface;
}

/**
 * One quiet line under result bars. The box is always one line tall
 * so the post-vote layout does not jump when the copy resolves.
 * The share control sits on that same line. Its hit target is 32px
 * and does not add height.
 */
export function CrowdLine({
  text,
  testId = "crowd-line",
  share = null,
}: {
  text: string | null;
  testId?: string;
  share?: CrowdLineShare | null;
}) {
  return (
    <div className="mt-2 flex h-5 min-w-0 items-center gap-0.5" data-testid={testId}>
      <p
        className="min-w-0 truncate text-[11px] leading-5 text-muted-foreground"
        aria-hidden={text == null}
      >
        {text ?? "\u00a0"}
      </p>
      {text && share ? <CrowdLineShareButton share={share} testId={`${testId}-share`} /> : null}
    </div>
  );
}

function CrowdLineShareButton({ share, testId }: { share: CrowdLineShare; testId: string }) {
  const { referralCode } = useReferralLink();
  const label = `Share. ${voteCrowdShareText(share.percent, share.headline)}`;
  return (
    <button
      type="button"
      className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:left-1/2 before:top-1/2 before:h-8 before:w-8 before:-translate-x-1/2 before:-translate-y-1/2"
      aria-label={label}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void shareVoteCard({
          headline: share.headline,
          percent: share.percent,
          path: share.path,
          surface: share.surface,
          referralCode,
        });
      }}
    >
      <Share2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
