import { UserProfileAvatar } from "@/components/UserProfileAvatar";

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
  if (participants.length === 0 && totalCount <= 0) {
    return null;
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
      <span>
        {totalCount} {noun}
        {totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
