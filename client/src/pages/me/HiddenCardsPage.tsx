import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryPill } from "@/components/CategoryPill";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { HIDDEN_CARDS_QUERY_KEY } from "@/lib/hiddenCardCache";
import { useUnhideCard, type HideCardTarget } from "@/hooks/useHideCard";
import type { CardReactionSurface } from "@shared/constants";

interface HiddenCardRow {
  cardType: CardReactionSurface;
  cardId: string;
  createdAt: string;
  title: string;
  category: string | null;
  href: string;
  typeLabel: string;
}

interface HiddenCardsResponse {
  data?: HiddenCardRow[];
}

export default function HiddenCardsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const unhide = useUnhideCard();

  const cardsQuery = useQuery<HiddenCardsResponse>({
    queryKey: HIDDEN_CARDS_QUERY_KEY,
    enabled: !!user,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/hidden-cards");
      return res.json();
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-8 text-center max-w-md w-full">
          <EyeOff className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to see hidden cards</h2>
          <p className="text-sm text-muted-foreground">
            Hidden cards stay on VoxDex for everyone else. Only you stop seeing them.
          </p>
          <Button
            onClick={() => navigateToLogin(setLocation)}
            className="mt-4"
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const cards = (cardsQuery.data?.data ?? []).filter((card) => card.title);
  const unavailable = cardsQuery.error instanceof ApiError && cardsQuery.error.status === 503;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-2 sm:px-4 h-14 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/me")}
            data-testid="button-back"
            aria-label="Back to My Account"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">Hidden cards</h1>
            <p className="text-xs text-muted-foreground truncate">Only you don't see these</p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-3xl">
        {cardsQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : cardsQuery.isError ? (
          <Card className="p-6" data-testid="hidden-cards-error">
            <p className="text-sm text-muted-foreground">
              {unavailable
                ? "Hiding cards isn't available yet. This will work once the latest update is finished."
                : "Couldn't load hidden cards."}
            </p>
          </Card>
        ) : cards.length === 0 ? (
          <Card className="p-6" data-testid="hidden-cards-empty">
            <EyeOff className="h-8 w-8 mb-3 text-muted-foreground" />
            <h2 className="font-semibold mb-1">You haven't hidden any cards</h2>
            <p className="text-sm text-muted-foreground">
              On a card, open the category chip and choose Hide card. It leaves your feeds and stays visible to everyone else.
            </p>
          </Card>
        ) : (
          <ul className="space-y-2" data-testid="hidden-cards-list">
            {cards.map((card) => (
              <li
                key={`${card.cardType}:${card.cardId}`}
                className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={card.href}
                    className="font-medium break-words hover:text-cyan-600 dark:hover:text-cyan-400"
                    data-testid={`link-hidden-${card.cardType}-${card.cardId}`}
                  >
                    {card.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{card.typeLabel}</span>
                    {card.category ? (
                      <CategoryPill category={card.category} size="sm" />
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto shrink-0"
                  disabled={unhide.isPending}
                  data-testid={`button-unhide-${card.cardType}-${card.cardId}`}
                  onClick={() => {
                    const target: HideCardTarget = {
                      cardType: card.cardType,
                      cardId: card.cardId,
                    };
                    unhide.mutate(target);
                  }}
                >
                  Unhide
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
