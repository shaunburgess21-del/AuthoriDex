import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Search, ArrowUpDown } from "lucide-react";

interface UOCard {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
  rank: number | null;
  trendScore: number | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  underratedVotesCount: number | null;
  overratedVotesCount: number | null;
  fairlyRatedVotesCount: number | null;
  valueScore: number | null;
  visibility: string | null;
}

export function AdminUnderratedOverrated() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ data: UOCard[]; totalCount: number }>({
    queryKey: ['/api/admin/vote/underrated'],
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/vote/underrated/sync'),
    onSuccess: async (res) => {
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/underrated'] });
      toast({ title: "Sync Complete", description: `${result.created} new cards created. Total: ${result.total}` });
    },
    onError: () => toast({ title: "Sync Failed", variant: "destructive" }),
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: string }) =>
      apiRequest('PATCH', `/api/admin/vote/underrated/${id}/visibility`, { visibility }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/underrated'] });
    },
  });

  const cards = data?.data || [];
  const filteredCards = cards.filter(c => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (visibilityFilter !== "all" && (c.visibility || 'live') !== visibilityFilter) return false;
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    return true;
  });

  const categories = Array.from(new Set(cards.map(c => c.category))).sort();

  const getVisibilityBadge = (vis: string) => {
    switch (vis) {
      case 'live': return <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>;
      case 'inactive': return <Badge variant="secondary">Inactive</Badge>;
      case 'archived': return <Badge variant="outline" className="text-muted-foreground">Archived</Badge>;
      default: return <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>;
    }
  };

  const getTotalVotes = (c: UOCard) => (c.underratedVotesCount || 0) + (c.overratedVotesCount || 0) + (c.fairlyRatedVotesCount || 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle>Underrated / Overrated</CardTitle>
            <CardDescription>Manage approval rating voting cards for all leaderboard celebrities</CardDescription>
          </div>
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-uo"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sync from Leaderboard
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-uo-admin-search"
            />
          </div>
          <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-uo-vis-filter">
              <SelectValue placeholder="Visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-uo-cat-filter">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground mb-3">
          Showing {filteredCards.length} of {cards.length} cards
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading cards...</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Rank</th>
                  <th className="text-left p-3 font-medium">Celebrity</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">
                    <span className="flex items-center justify-end gap-1">Votes <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-right p-3 font-medium">Underrated</th>
                  <th className="text-right p-3 font-medium">Fairly Rated</th>
                  <th className="text-right p-3 font-medium">Overrated</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Visibility</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((card) => (
                  <tr key={card.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-uo-${card.id}`}>
                    <td className="p-3 text-muted-foreground">#{card.rank || '—'}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={card.avatar || undefined} />
                          <AvatarFallback className="text-xs">{card.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium truncate max-w-[150px]">{card.name}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{card.category}</Badge>
                    </td>
                    <td className="p-3 text-right font-mono">{getTotalVotes(card)}</td>
                    <td className="p-3 text-right">
                      {card.underratedPct != null ? (
                        <span className="text-emerald-400">{card.underratedPct}%</span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {card.fairlyRatedPct != null ? (
                        <span className="text-muted-foreground">{card.fairlyRatedPct}%</span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {card.overratedPct != null ? (
                        <span className="text-red-400">{card.overratedPct}%</span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-center">
                      {getVisibilityBadge(card.visibility || 'live')}
                    </td>
                    <td className="p-3 text-center">
                      <Select
                        value={card.visibility || 'live'}
                        onValueChange={(vis) => visibilityMutation.mutate({ id: card.id, visibility: vis })}
                      >
                        <SelectTrigger className="w-[110px]" data-testid={`select-uo-vis-${card.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
