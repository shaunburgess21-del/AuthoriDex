import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { X, Search, Crown, ImageIcon, Users } from "lucide-react";
import { getFilterCategories, type FilterCategory } from "@shared/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import type { CuratePerson } from "./CurateProfileCard";

interface TrendingPerson {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  trendScore: number;
  rank: number;
}

interface CelebrityImage {
  id: string;
  personId: string;
  imageUrl: string;
  votesUp: number;
  votesDown: number;
}

interface CurateViewAllOverlayProps {
  onClose: () => void;
  onSelectPerson: (person: CuratePerson) => void;
}

function FilterChip({ 
  category, 
  isActive, 
  onClick,
  showIcon = false
}: { 
  category: string; 
  isActive: boolean; 
  onClick: () => void;
  showIcon?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
        isActive
          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
          : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50'
      }`}
      data-testid={`filter-chip-${category.toLowerCase()}`}
    >
      {showIcon && category === "Favorites" && <span>★</span>}
      {category}
    </button>
  );
}

function CelebCard({ 
  person, 
  onClick,
  rank
}: { 
  person: TrendingPerson; 
  onClick: () => void;
  rank: number;
}) {
  const { data: images = [] } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', person.id, 'images'],
  });

  const topImages = useMemo(() => {
    return [...images]
      .sort((a, b) => b.votesUp - a.votesUp)
      .slice(0, 2);
  }, [images]);

  const totalVotes = images.reduce((sum, img) => sum + img.votesUp, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.02 }}
      className="bg-muted/30 rounded-lg border border-border hover:border-cyan-500/30 transition-all cursor-pointer overflow-hidden hover-elevate"
      onClick={onClick}
      data-testid={`view-all-card-${person.id}`}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <PersonAvatar name={person.name} avatar={person.imageUrl || ""} size="sm" />
          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm truncate">{person.name}</p>
              <CategoryPill category={person.category} />
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{totalVotes.toLocaleString()} votes</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-1.5">
          {topImages.length > 0 ? (
            topImages.map((img, idx) => (
              <div 
                key={img.id} 
                className="relative aspect-square rounded-md overflow-hidden bg-slate-800"
              >
                <img 
                  src={img.imageUrl} 
                  alt={`${person.name} photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                {idx === 0 && (
                  <div className="absolute top-1 right-1 bg-yellow-500/20 rounded-full p-0.5">
                    <Crown className="h-2.5 w-2.5 text-yellow-400" />
                  </div>
                )}
              </div>
            ))
          ) : (
            <>
              <div className="aspect-square rounded-md bg-slate-800/50 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-slate-600" />
              </div>
              <div className="aspect-square rounded-md bg-slate-800/50 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-slate-600" />
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function CurateViewAllOverlay({ 
  onClose, 
  onSelectPerson 
}: CurateViewAllOverlayProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("All");

  const { data: celebritiesResponse, isLoading } = useQuery<{ data: TrendingPerson[] } | TrendingPerson[]>({
    queryKey: ['/api/trending?sort=rank&limit=100'],
  });

  const celebrities = useMemo(() => {
    if (!celebritiesResponse) return [];
    const rawData = Array.isArray(celebritiesResponse) 
      ? celebritiesResponse 
      : (celebritiesResponse as { data: TrendingPerson[] }).data;
    const data = Array.isArray(rawData) ? rawData : [];
    return data.filter((p): p is TrendingPerson => !!p && !!p.id);
  }, [celebritiesResponse]);

  const filteredCelebrities = useMemo(() => {
    return celebrities.filter(person => {
      const matchesCategory = categoryFilter === "All" || categoryFilter === "Trending" ||
        person.category?.toLowerCase() === categoryFilter.toLowerCase();
      const matchesSearch = !searchQuery || 
        person.name?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "Trending" ? ((b.fameScore ?? b.score ?? 0) - (a.fameScore ?? a.score ?? 0)) : 0);
  }, [celebrities, categoryFilter, searchQuery]);

  const handleCategoryClick = (cat: string) => {
    if (cat === "Favorites" && !user) {
      setLocation("/login");
      return;
    }
    setCategoryFilter(cat as FilterCategory);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-xl font-serif font-bold">All Profiles</h2>
          <p className="text-sm text-muted-foreground">Vote on which photos best represent each celebrity</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          data-testid="button-close-view-all"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      
      <div className="sticky top-0 z-10 p-4 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          {getFilterCategories(false).map((cat) => (
            <FilterChip
              key={cat}
              category={cat}
              isActive={categoryFilter === cat}
              onClick={() => handleCategoryClick(cat)}
              showIcon={cat === "Favorites"}
            />
          ))}
          <div className="ml-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search celebrities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-8 w-48 bg-slate-800/30 border-slate-700/40"
                data-testid="input-view-all-search"
              />
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
          </div>
        ) : filteredCelebrities.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No celebrities match your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-5xl mx-auto">
            {filteredCelebrities.map((person, idx) => (
              <CelebCard
                key={person.id}
                person={person}
                rank={idx}
                onClick={() => onSelectPerson({
                  id: person.id,
                  name: person.name,
                  category: person.category,
                  imageUrl: person.imageUrl,
                })}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
