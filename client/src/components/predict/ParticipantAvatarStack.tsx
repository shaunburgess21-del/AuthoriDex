import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  AGENT_AVATAR_FALLBACK_CLASS,
  getAvatarGradient,
  getAvatarInitials,
  HUMAN_AVATAR_FALLBACK_CLASS,
} from "@/lib/avatar";

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
          <Avatar
            key={`${participant.userId}-${participant.username || participant.displayName}`}
            className="h-6 w-6 border-2 border-background"
          >
            {participant.avatarUrl && !participant.isAgent ? (
              <AvatarImage src={participant.avatarUrl} alt={participant.displayName} />
            ) : (
              <AvatarFallback
                className={`text-[10px] ${getAvatarGradient(participant.displayName)} ${
                  participant.isAgent ? AGENT_AVATAR_FALLBACK_CLASS : HUMAN_AVATAR_FALLBACK_CLASS
                }`}
              >
                {getAvatarInitials(participant.displayName)}
              </AvatarFallback>
            )}
          </Avatar>
        ))}
      </div>
      <span>
        {totalCount} participant{totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
