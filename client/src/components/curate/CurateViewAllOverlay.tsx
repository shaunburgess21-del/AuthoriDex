import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { X, Crown, ImageIcon, Users } from "lucide-react";
import { type FilterCategory } from "@shared/constants";
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

const CURATE_CATEGORIES = [
  { value: "All", label: "All Categories" },
  { value: "Favorites", label: "Favorites" },
  { value: "Trending", label: "Trending" },
  { value: "Tech", label: "Tech" },
  { value: "Business", label: "Business" },
  { value: "Politics", label: "Politics" },
  { value: "Music", label: "Music" },
  { value: "Sports", label: "Sports" },
  { value: "Film & TV", label: "Film & TV" },
  { value: "Gaming", label: "Gaming" },
  { value: "Creator", label: "Creator" },
  { value: "Food & Drink", label: "Food & Drink" },
  { value: "Lifestyle", label: "Lifestyle" },
];

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
      <div className="p-3 relative">
        <div className="absolute top-3 right-3 z-10 hidden md:block">
          <CategoryPill category={person.category} />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <PersonAvatar name={person.name} avatar={person.imageUrl || ""} size="sm" />
          <div className="min-w-0 flex flex-col justify-center">
            <p className="font-medium text-sm truncate">{person.name}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{totalVotes.toLocaleString('en-US')} votes</span>
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
      
      <OverlayFilterBar
        value={categoryFilter}
        onChange={(v) => setCategoryFilter(v as FilterCategory)}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        categories={CURATE_CATEGORIES}
        allValue="All"
        placeholder="Search..."
        testIdPrefix="curate-overlay"
        variant="vote"
        user={user}
        onAuthRequired={() => setLocation("/login")}
      />
      
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
