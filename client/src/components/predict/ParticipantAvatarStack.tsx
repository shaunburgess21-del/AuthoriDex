import { UserProfileAvatar } from "@/components/UserProfileAvatar";

export interface ParticipantPreview {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
}

export function ParticipantAvatarStack({
  participants = [],
  totalCount = 0,
  engine = "parimutuel",
}: {
  participants?: ParticipantPreview[];
  totalCount?: number;
  /**
   * For AMM markets we relabel "participants" -> "traders" because
   * users open *and* close positions throughout the week (so the
   * parimutuel "participant" framing reads wrong). Phase 12 will
   * replace this with a credit-volume number, at which point this
   * label can be revisited.
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
