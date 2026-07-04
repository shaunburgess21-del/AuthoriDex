import { Loader2, User as UserIcon } from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";

export interface MentionPersonResult {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
}

export interface MentionUserResult {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface MentionSuggestionItem {
  type: "person" | "user";
  id: string;
  display: string;
  avatarUrl: string | null;
  subtitle?: string | null;
}

interface MentionSuggestionsProps {
  people: MentionPersonResult[];
  users: MentionUserResult[];
  isLoading: boolean;
  query: string;
  activeIndex: number;
  onSelect: (item: MentionSuggestionItem) => void;
  onHoverIndex: (index: number) => void;
}

function toItems(people: MentionPersonResult[], users: MentionUserResult[]): MentionSuggestionItem[] {
  const personItems: MentionSuggestionItem[] = people.map((p) => ({
    type: "person",
    id: p.id,
    display: p.name,
    avatarUrl: p.avatar,
    subtitle: p.category,
  }));
  const userItems: MentionSuggestionItem[] = users.map((u) => ({
    type: "user",
    id: u.id,
    display: u.username,
    avatarUrl: u.avatarUrl,
    subtitle: "VoxDex user",
  }));
  return [...personItems, ...userItems];
}

export function MentionSuggestions({
  people,
  users,
  isLoading,
  query,
  activeIndex,
  onSelect,
  onHoverIndex,
}: MentionSuggestionsProps) {
  const items = toItems(people, users);

  if (query.length < 2) {
    return (
      <div
        className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-popover p-3 text-xs text-muted-foreground shadow-lg"
        role="listbox"
        aria-label="Mention suggestions"
      >
        Type at least 2 characters to search
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div
        className="absolute left-0 right-0 top-full z-50 mt-1 flex items-center gap-2 rounded-xl border border-border bg-popover p-3 text-xs text-muted-foreground shadow-lg"
        role="listbox"
        aria-label="Mention suggestions"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Searching…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border bg-popover p-3 text-xs text-muted-foreground shadow-lg"
        role="listbox"
        aria-label="Mention suggestions"
      >
        No matches for &ldquo;{query}&rdquo;
      </div>
    );
  }

  let personHeaderShown = false;
  let userHeaderShown = false;

  return (
    <div
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {items.map((item, index) => {
        const showPersonHeader = item.type === "person" && !personHeaderShown;
        const showUserHeader = item.type === "user" && !userHeaderShown;
        if (showPersonHeader) personHeaderShown = true;
        if (showUserHeader) userHeaderShown = true;

        return (
          <div key={`${item.type}:${item.id}`}>
            {showPersonHeader && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Celebrities
              </p>
            )}
            {showUserHeader && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                VoxDex users
              </p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                index === activeIndex ? "bg-muted/60" : ""
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHoverIndex(index)}
              onClick={() => onSelect(item)}
            >
              {item.type === "person" ? (
                item.avatarUrl ? (
                  <img src={item.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserIcon className="h-3.5 w-3.5" />
                  </div>
                )
              ) : (
                <UserProfileAvatar
                  displayName={item.display}
                  avatarUrl={item.avatarUrl}
                  className="h-7 w-7 shrink-0"
                  fallbackClassName="text-[10px]"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.display}</span>
                {item.subtitle && (
                  <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                )}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
