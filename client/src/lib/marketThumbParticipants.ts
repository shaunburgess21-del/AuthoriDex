import type { ThumbParticipant } from "@/components/predict/MarketThumbCollage";
import { getTopRaceEntries } from "@/lib/nativeRaceLeaders";

export type MarketThumbVariant = "single" | "split" | "grid";

export interface MarketThumbProps {
  variant: MarketThumbVariant;
  participants: ThumbParticipant[];
}

function h2hEntryParticipant(entry: {
  label?: string | null;
  person?: { name?: string | null; avatar?: string | null } | null;
}): ThumbParticipant {
  const person = entry?.person;
  return {
    name: person?.name ?? entry?.label ?? "?",
    avatar: person?.avatar?.trim() ? person.avatar : null,
  };
}

/** Build collage props for an Up/Down native market row. */
export function marketThumbFromUpdown(m: {
  person?: { name?: string | null; avatar?: string | null } | null;
  personName?: string | null;
}): MarketThumbProps {
  const personName: string = m.person?.name ?? m.personName ?? "Unknown";
  return {
    variant: "single",
    participants: [
      {
        name: personName,
        avatar: m.person?.avatar?.trim() ? m.person.avatar : null,
      },
    ],
  };
}

/** Build collage props for an H2H native market row. */
export function marketThumbFromH2h(m: {
  entries?: Array<{
    label?: string | null;
    person?: { name?: string | null; avatar?: string | null } | null;
  }> | null;
}): MarketThumbProps {
  const entries = m.entries ?? [];
  const p1 = h2hEntryParticipant(entries[0] ?? {});
  const p2 = h2hEntryParticipant(entries[1] ?? {});
  return {
    variant: "split",
    participants: [p1, p2],
  };
}

/** Build collage props for a Gainer / Race native market row. */
export function marketThumbFromGainer(m: {
  category?: string | null;
  categoryLabel?: string | null;
  entries?: Array<{
    label?: string | null;
    person?: { name?: string | null; avatar?: string | null } | null;
  }> | null;
  metadata?: unknown;
}): MarketThumbProps {
  const categoryLabel: string = m.categoryLabel ?? m.category ?? "Race";
  const topEntries = getTopRaceEntries(
    m.entries as Parameters<typeof getTopRaceEntries>[0],
    m.metadata as Parameters<typeof getTopRaceEntries>[1],
    4,
  );
  return {
    variant: topEntries.length > 1 ? "grid" : "single",
    participants:
      topEntries.length > 0
        ? topEntries
        : [{ name: categoryLabel, avatar: null }],
  };
}

/** Build collage props for a community / world market row. */
export function marketThumbFromCommunity(m: {
  title?: string | null;
  coverImageUrl?: string | null;
  linkedPersonAvatar?: string | null;
}): MarketThumbProps {
  const title: string = m.title ?? "Untitled market";
  const avatar = m.coverImageUrl ?? m.linkedPersonAvatar ?? null;
  return {
    variant: "single",
    participants: [
      {
        name: title,
        avatar: avatar?.trim() ? avatar : null,
      },
    ],
  };
}

/** Resolve collage props from a market row by type. */
export function marketThumbFromMarket(
  marketType: string,
  m: Record<string, unknown>,
): MarketThumbProps {
  if (marketType === "updown") {
    return marketThumbFromUpdown(m as Parameters<typeof marketThumbFromUpdown>[0]);
  }
  if (marketType === "h2h") {
    return marketThumbFromH2h(m as Parameters<typeof marketThumbFromH2h>[0]);
  }
  if (marketType === "gainer") {
    return marketThumbFromGainer(m as Parameters<typeof marketThumbFromGainer>[0]);
  }
  if (marketType === "community") {
    return marketThumbFromCommunity(m as Parameters<typeof marketThumbFromCommunity>[0]);
  }
  return {
    variant: "single",
    participants: [{ name: String(m.title ?? "Market"), avatar: null }],
  };
}
