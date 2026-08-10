import { useState, useMemo } from "react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { matchesCategoryFilter, CATEGORY_FILTER_SELECT_OPTIONS } from "@shared/constants";
import { PersonAvatar } from "@/components/PersonAvatar";
import { OverlayFilterBar } from "@/components/OverlayFilterBar";
import { ViewAllOverlayHeader } from "@/components/ViewAllOverlayHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Crown, ImageIcon, Users } from "lucide-react";
import { type FilterCategory } from "@shared/constants";
import type { CuratePerson } from "./CurateProfileCard";
import { selectCurateDisplayImages } from "./selectCurateDisplayImages";

interface TrendingPerson {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
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
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}

const CURATE_CATEGORIES = CATEGORY_FILTER_SELECT_OPTIONS;

function CelebCard({ 
  person, 
  onClick,
  rank,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: { 
  person: TrendingPerson; 
  onClick: () => void;
  rank: number;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}) {
  const { data: images = [] } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', person.id, 'images'],
  });

  const displayImages = useMemo(
    () => selectCurateDisplayImages(person.id, images, 0),
    [images, person.id],
  );

  const crownImageId = useMemo(() => {
    if (displayImages.length === 0) return null;
    let best = displayImages[0];
    for (const img of displayImages) {
      if (img.votesUp > best.votesUp) best = img;
    }
    return best.votesUp > 0 ? best.id : null;
  }, [displayImages]);

  const winningAvatar = useMemo(() => {
    const sorted = [...images].sort((a, b) => b.votesUp - a.votesUp);
    if (sorted.length > 0 && sorted[0].votesUp > 0) return sorted[0].imageUrl;
    return person.avatar || person.imageUrl || "";
  }, [images, person.avatar, person.imageUrl]);

  const totalVotes = images.reduce((sum, img) => sum + img.votesUp, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.02 }}
      className="hub-card-hover lb-row-neutral bg-muted/30 rounded-lg cursor-pointer"
      onClick={onClick}
      data-testid={`view-all-card-${person.id}`}
    >
      <div className="p-3 relative">
        <div className="absolute top-3 right-3 z-10 hidden md:block">
          <InteractiveCategoryPill
            category={person.category}
            onFilter={() => onFilterCategory?.(person.category)}
            leaderboardCategories={leaderboardCategories}
          />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <PersonAvatar name={person.name} avatar={winningAvatar} size="sm" />
          <div className="min-w-0 flex flex-col justify-center">
            <p className="font-medium text-sm truncate">{person.name}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{totalVotes.toLocaleString('en-US')} votes</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          {displayImages.length > 0 ? (
            displayImages.map((img, idx) => (
              <div 
                key={img.id} 
                className="relative aspect-square rounded-md overflow-hidden bg-slate-800"
              >
                <img 
                  src={getDisplayImageUrl(img.imageUrl, { width: 400 })} 
                  alt={`${person.name} photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                {img.id === crownImageId && (
                  <div className="absolute top-1 right-1 bg-yellow-500/20 rounded-full p-0.5">
                    <Crown className="h-2.5 w-2.5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                )}
              </div>
            ))
          ) : (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-square rounded-md bg-slate-800/50 flex items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-slate-600" />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function CurateViewAllOverlay({ 
  onClose, 
  onSelectPerson,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: CurateViewAllOverlayProps) {
  const { user } = useAuth();
  const { favoriteIds } = useFavorites();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("all");

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
    const matchesSearch = (person: TrendingPerson) =>
      !searchQuery || person.name?.toLowerCase().includes(searchQuery.toLowerCase());
    // "favorites" is a UI-only filter that matchesCategoryFilter can't satisfy
    // (it isn't a real category) — gate on the user's favorite ids instead.
    if (categoryFilter === "favorites") {
      return celebrities.filter((person) => favoriteIds.has(person.id) && matchesSearch(person));
    }
    return celebrities.filter((person) => {
      const matchesCategory = matchesCategoryFilter(
        person.category,
        (person as any).secondaryCategories,
        categoryFilter,
      );
      return matchesCategory && matchesSearch(person);
    }).sort((a: any, b: any) => categoryFilter === "trending" ? ((b.fameScore ?? b.score ?? 0) - (a.fameScore ?? a.score ?? 0)) : 0);
  }, [celebrities, categoryFilter, searchQuery, favoriteIds]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
    >
      <ViewAllOverlayHeader
        onClose={onClose}
        closeTestId="button-close-view-all"
        backTestId="button-back-view-all"
        className="flex items-center justify-between gap-2 p-4 border-b"
      >
        <div className="min-w-0">
          <h2 className="text-xl font-serif font-bold">All Profiles</h2>
          <p className="text-sm text-muted-foreground">Vote on which photos best represent each celebrity</p>
        </div>
      </ViewAllOverlayHeader>
      
      <OverlayFilterBar
        value={categoryFilter}
        onChange={(v) => setCategoryFilter(v as FilterCategory)}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        categories={CURATE_CATEGORIES}
        allValue="all"
        placeholder="Search..."
        testIdPrefix="curate-overlay"
        variant="vote"
        user={user}
        onAuthRequired={() => navigateToLogin(setLocation)}
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
                onFilterCategory={onFilterCategory}
                categoryRaceMap={categoryRaceMap}
                leaderboardCategories={leaderboardCategories}
                onClick={() => onSelectPerson({
                  id: person.id,
                  name: person.name,
                  category: person.category,
                  imageUrl: person.avatar || person.imageUrl || null,
                })}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
