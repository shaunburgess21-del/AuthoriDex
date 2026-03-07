import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Star, Heart, TrendingUp, Search } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export default function FavoritesPage() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: favorites, isLoading } = useQuery({
    queryKey: ["/api/me/favorites"],
    enabled: !!user,
  });

  const handleUnfavorite = async (e: React.MouseEvent, celebrityId: string, name: string) => {
    e.stopPropagation();
    if (!session?.access_token) return;
    try {
      const res = await fetch(`/api/me/favorites/${celebrityId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/me/favorites"] });
      toast({ title: "Removed from favorites", description: `${name} removed` });
    } catch {
      toast({ title: "Error", description: "Failed to remove favorite", variant: "destructive" });
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Star className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your favorites</h2>
          <Button onClick={() => setLocation("/login")} className="mt-4" data-testid="button-sign-in">
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/me");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Favorites</h1>
            <p className="text-xs text-muted-foreground">Celebrities you're tracking</p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search favorites..." 
            className="pl-10"
            data-testid="input-search-favorites"
          />
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : favorites && Array.isArray(favorites) && favorites.length > 0 ? (
          <div className="space-y-3">
            {favorites.map((fav: any) => (
              <Card 
                key={fav.id} 
                className="p-4 hover-elevate cursor-pointer" 
                onClick={() => setLocation(`/celebrity/${fav.celebrityId}`)}
                data-testid={`favorite-item-${fav.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      {fav.imageUrl ? (
                        <AvatarImage src={fav.imageUrl} alt={fav.name} />
                      ) : (
                        <AvatarFallback>{fav.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                      )}
                    </Avatar>
                    <div>
                      <p className="font-medium">{fav.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{fav.category}</Badge>
                        <span className="text-xs text-muted-foreground">#{fav.rank}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1">
                      <TrendingUp className={`h-4 w-4 ${fav.change > 0 ? "text-green-400" : "text-red-400"}`} />
                      <span className={`font-mono ${fav.change > 0 ? "text-green-400" : "text-red-400"}`}>
                        {fav.change > 0 ? "+" : ""}{fav.change}%
                      </span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="mt-1"
                      onClick={(e) => handleUnfavorite(e, fav.celebrityId, fav.name)}
                      data-testid={`button-unfavorite-${fav.id}`}
                    >
                      <Heart className="h-4 w-4 text-red-400 fill-red-400" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Star className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">No favorites yet</h2>
            <p className="text-muted-foreground mb-4">
              Add celebrities to your favorites to track their rankings.
            </p>
            <Button onClick={() => setLocation("/")} data-testid="button-browse-leaderboard">
              Browse Leaderboard
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
