import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { FIRST_TO_PREDICT, OPENING_ODDS_NOTE, traderCountLabel } from "@/lib/market-trust-copy";

export interface ParticipantPreview {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export function ParticipantAvatarStack({
  participants = [],
  totalCount = 0,
  engine = "amm",
}: {
  participants?: ParticipantPreview[];
  totalCount?: number;
  /**
   * AMM markets label this stack "traders" (continuous buy/sell).
   * Jackpot markets pass `"parimutuel"` to keep the "participants"
   * framing (one-shot entries, no resale).
   */
  engine?: "amm" | "parimutuel";
}) {
  const count = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;

  if (count <= 0) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="market-zero-traders">
        <p>{FIRST_TO_PREDICT}</p>
        <p className="mt-0.5">{OPENING_ODDS_NOTE}</p>
      </div>
    );
  }

  const noun = engine === "amm" ? "trader" : "participant";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex -space-x-2">
        {participants.slice(0, 3).map((participant) => (
          <UserProfileAvatar
            key={`${participant.userId}-${participant.username || participant.displayName}`}
            displayName={participant.displayName}
            avatarUrl={participant.avatarUrl}
            size="xs"
            className="border-2 border-background"
          />
        ))}
      </div>
      <span>{traderCountLabel(count, noun)}</span>
    </div>
  );
}
