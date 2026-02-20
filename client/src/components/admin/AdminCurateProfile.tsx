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
import { Search, Image, ArrowUpDown } from "lucide-react";

interface CurateCard {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
  rank: number | null;
  curateVisibility: string;
  imageCount: number;
  totalVotes: number;
}

export function AdminCurateProfile() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<{ data: CurateCard[]; totalCount: number }>({
    queryKey: ['/api/admin/vote/curate-profile'],
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: string }) =>
      apiRequest('PATCH', `/api/admin/vote/curate-profile/${id}/visibility`, { visibility }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile'] });
    },
  });

  const cards = data?.data || [];
  const filteredCards = cards.filter(c => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (visibilityFilter !== "all" && c.curateVisibility !== visibilityFilter) return false;
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

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Curate Profile</CardTitle>
          <CardDescription>Manage celebrity profile image curation and voting visibility</CardDescription>
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
              data-testid="input-curate-admin-search"
            />
          </div>
          <Select value={visibilityFilter} onValueChange={setVisibilityFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-curate-vis-filter">
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
            <SelectTrigger className="w-[140px]" data-testid="select-curate-cat-filter">
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
          Showing {filteredCards.length} of {cards.length} profiles
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading profiles...</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Rank</th>
                  <th className="text-left p-3 font-medium">Celebrity</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">
                    <span className="flex items-center justify-end gap-1"><Image className="h-3 w-3" /> Images</span>
                  </th>
                  <th className="text-right p-3 font-medium">
                    <span className="flex items-center justify-end gap-1">Total Votes <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Visibility</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((card) => (
                  <tr key={card.id} className="border-b last:border-b-0 hover-elevate" data-testid={`row-curate-${card.id}`}>
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
                    <td className="p-3 text-right font-mono">{card.imageCount}</td>
                    <td className="p-3 text-right font-mono">{card.totalVotes}</td>
                    <td className="p-3 text-center">
                      {getVisibilityBadge(card.curateVisibility)}
                    </td>
                    <td className="p-3 text-center">
                      <Select
                        value={card.curateVisibility}
                        onValueChange={(vis) => visibilityMutation.mutate({ id: card.id, visibility: vis })}
                      >
                        <SelectTrigger className="w-[110px]" data-testid={`select-curate-vis-${card.id}`}>
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
