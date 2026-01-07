import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Vote, ThumbsUp, ThumbsDown, Filter } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function VotesPage() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();

  const { data: votes, isLoading } = useQuery({
    queryKey: ["/api/me/votes"],
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your votes</h2>
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
            onClick={() => setLocation("/me")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Votes</h1>
            <p className="text-xs text-muted-foreground">{profile?.totalVotes || 0} total votes cast</p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Badge variant="outline">All Votes</Badge>
          </div>
          <Button variant="outline" size="sm" data-testid="button-filter-votes">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : votes && Array.isArray(votes) && votes.length > 0 ? (
          <div className="space-y-3">
            {votes.map((vote: any) => (
              <Card key={vote.id} className="p-4" data-testid={`vote-item-${vote.id}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {vote.value > 0 ? (
                      <ThumbsUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <ThumbsDown className="h-5 w-5 text-red-400" />
                    )}
                    <div>
                      <p className="font-medium">{vote.targetName || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{vote.voteType}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={vote.value > 0 ? "default" : "secondary"}>
                      {vote.value > 0 ? "+" : ""}{vote.value}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(vote.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">No votes yet</h2>
            <p className="text-muted-foreground mb-4">
              Start voting on celebrities and polls to see your activity here.
            </p>
            <Button onClick={() => setLocation("/vote")} data-testid="button-start-voting">
              Start Voting
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
