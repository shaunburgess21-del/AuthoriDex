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
}: {
  participants?: ParticipantPreview[];
  totalCount?: number;
}) {
  if (participants.length === 0 && totalCount <= 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex -space-x-2">
        {participants.slice(0, 3).map((participant) => (
          <UserProfileAvatar
            key={`${participant.userId}-${participant.username || participant.displayName}`}
            displayName={participant.displayName}
            avatarUrl={participant.isAgent ? null : participant.avatarUrl}
            size="xs"
            className="border-2 border-background"
          />
        ))}
      </div>
      <span>
        {totalCount} participant{totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
