import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Image, ArrowUpDown, X, Plus, Trash2, Loader2, ThumbsUp, Crown, Edit
} from "lucide-react";

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

interface CelebrityImageData {
  id: string;
  personId: string;
  imageUrl: string;
  source: string | null;
  isPrimary: boolean;
  votesUp: number;
  votesDown: number;
  addedAt: string;
}

export function AdminCurateProfile() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editingCard, setEditingCard] = useState<CurateCard | null>(null);
  const [seedVoteInputs, setSeedVoteInputs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ data: CurateCard[]; totalCount: number }>({
    queryKey: ['/api/admin/vote/curate-profile'],
  });

  const { data: imagesData, isLoading: imagesLoading } = useQuery<{ data: CelebrityImageData[] }>({
    queryKey: ['/api/admin/vote/curate-profile', editingCard?.id, 'images'],
    enabled: !!editingCard,
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ id, visibility }: { id: string; visibility: string }) =>
      apiRequest('PATCH', `/api/admin/vote/curate-profile/${id}/visibility`, { visibility }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile'] });
    },
  });

  const seedVoteMutation = useMutation({
    mutationFn: ({ imageId, votesUp }: { imageId: string; votesUp: number }) =>
      apiRequest('PATCH', `/api/admin/vote/curate-profile/images/${imageId}/seed-votes`, { votesUp }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile', editingCard?.id, 'images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile'] });
      toast({ title: "Seed votes updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update votes", variant: "destructive" });
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: string) =>
      apiRequest('DELETE', `/api/admin/vote/curate-profile/images/${imageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile', editingCard?.id, 'images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile'] });
      toast({ title: "Image deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete image", variant: "destructive" });
    },
  });

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingCard || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source', 'admin_upload');
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/admin/vote/curate-profile/${editingCard.id}/images`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile', editingCard.id, 'images'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/vote/curate-profile'] });
      toast({ title: "Image uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [editingCard, toast]);

  const cards = data?.data || [];
  const filteredCards = cards.filter(c => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (visibilityFilter !== "all" && c.curateVisibility !== visibilityFilter) return false;
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    return true;
  });

  const categories = Array.from(new Set(cards.map(c => c.category))).sort();

  const images = imagesData?.data || [];
  const highestVoteImage = images.length > 0 ? images.reduce((max, img) => img.votesUp > max.votesUp ? img : max, images[0]) : null;

  const getVisibilityBadge = (vis: string) => {
    switch (vis) {
      case 'live': return <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>;
      case 'inactive': return <Badge variant="secondary">Inactive</Badge>;
      case 'archived': return <Badge variant="outline" className="text-muted-foreground">Archived</Badge>;
      default: return <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Live</Badge>;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Curate Profile</CardTitle>
            <CardDescription>Manage celebrity profile image curation and voting visibility. Click a row to manage images and seed votes.</CardDescription>
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
                    <th className="text-center p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCards.map((card) => (
                    <tr
                      key={card.id}
                      className="border-b last:border-b-0 hover-elevate cursor-pointer"
                      onClick={() => setEditingCard(card)}
                      data-testid={`row-curate-${card.id}`}
                    >
                      <td className="p-3 text-muted-foreground">#{card.rank || '\u2014'}</td>
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
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
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
                      <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingCard(card)}
                          data-testid={`button-edit-curate-${card.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editingCard && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditingCard(null)}>
          <div
            className="bg-background border rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-curate-edit"
          >
            <div className="flex items-center justify-between gap-3 p-5 border-b">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={editingCard.avatar || undefined} />
                  <AvatarFallback className="text-sm">{editingCard.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold truncate" data-testid="text-modal-name">{editingCard.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {editingCard.category} &middot; Rank #{editingCard.rank || '\u2014'}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditingCard(null)} data-testid="button-close-curate-modal">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b bg-muted/30">
              <div className="text-sm text-muted-foreground">
                {images.length} image{images.length !== 1 ? 's' : ''} &middot; {images.reduce((sum, img) => sum + img.votesUp, 0)} total votes
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="input-upload-image"
                />
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-add-image"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                  Add Photo
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 overflow-y-auto">
              <div className="p-5">
                {imagesLoading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Loading images...
                  </div>
                ) : images.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Image className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>No images yet. Click "Add Photo" to upload one.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {images.map((img) => {
                      const isWinner = highestVoteImage?.id === img.id && img.votesUp > 0;
                      return (
                        <Card
                          key={img.id}
                          className={`overflow-visible ${isWinner ? 'border-amber-500/50' : ''}`}
                          data-testid={`card-image-${img.id}`}
                        >
                          <div className="relative">
                            <img
                              src={img.imageUrl}
                              alt="Celebrity"
                              className="w-full h-48 object-cover rounded-t-md"
                              data-testid={`img-preview-${img.id}`}
                            />
                            {isWinner && (
                              <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/90 text-xs font-semibold text-black">
                                <Crown className="h-3 w-3" />
                                Active Profile
                              </div>
                            )}
                          </div>
                          <div className="p-3 space-y-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5 text-sm">
                                <ThumbsUp className="h-3.5 w-3.5 text-emerald-400" />
                                <span className="font-mono font-semibold" data-testid={`text-votes-${img.id}`}>{img.votesUp}</span>
                                <span className="text-muted-foreground">votes</span>
                              </div>
                              {img.source && (
                                <Badge variant="outline" className="text-[10px]">{img.source}</Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground whitespace-nowrap">Set votes:</label>
                              <Input
                                type="number"
                                min={0}
                                value={seedVoteInputs[img.id] ?? String(img.votesUp)}
                                onChange={(e) => setSeedVoteInputs(prev => ({ ...prev, [img.id]: e.target.value }))}
                                className="h-8 w-20 text-xs font-mono"
                                data-testid={`input-seed-votes-${img.id}`}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={seedVoteMutation.isPending}
                                onClick={() => {
                                  const val = parseInt(seedVoteInputs[img.id] ?? String(img.votesUp), 10);
                                  if (isNaN(val) || val < 0) {
                                    toast({ title: "Invalid number", variant: "destructive" });
                                    return;
                                  }
                                  seedVoteMutation.mutate({ imageId: img.id, votesUp: val });
                                }}
                                data-testid={`button-save-votes-${img.id}`}
                              >
                                {seedVoteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                              </Button>
                            </div>

                            <div className="flex items-center justify-end pt-1 border-t border-border/30">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  if (confirm("Delete this image? This cannot be undone.")) {
                                    deleteImageMutation.mutate(img.id);
                                  }
                                }}
                                disabled={deleteImageMutation.isPending}
                                data-testid={`button-delete-image-${img.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  );
}
