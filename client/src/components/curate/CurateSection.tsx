import { useState, useMemo, useCallback, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ImageIcon, ChevronRight } from "lucide-react";
import { CurateProfileCard, type CuratePerson } from "./CurateProfileCard";
import { CurateViewResultsOverlay } from "./CurateViewResultsOverlay";
import { CurateViewAllOverlay } from "./CurateViewAllOverlay";
import { matchesCategoryFilter, type FilterCategory } from "@shared/constants";
import { useFavorites } from "@/hooks/useFavorites";
import { CardSection, type CardSectionHandle } from "@/components/CardSection";
import { HideExitCard } from "@/components/HideExitCard";
import {
  filterCardsByVoteActivity,
  type HubActivityFilter,
} from "@/lib/hub-activity-filter";

interface TrendingPerson {
  id: string;
  name: string;
  category: string;
  avatar: string | null;
  imageUrl: string | null;
  trendScore: number;
  rank: number;
}

interface CurateSectionProps {
  categoryFilter: FilterCategory;
  searchQuery?: string;
  compact?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: (personId: string) => void;
  onVisitProfile?: (personId: string) => void;
  /** Vote-hub activity filter. Defaults to showing every profile. */
  activityFilter?: HubActivityFilter;
  /** Person ids with a saved curate vote. Empty until that query resolves. */
  votedPersonIds?: ReadonlySet<string>;
  /** True while the voted-person query is still in flight and the filter is active. */
  votesPending?: boolean;
  isPersonRetained?: (personId: string) => boolean;
  isPersonHidden?: (personId: string) => boolean;
  isPersonExiting?: (personId: string) => boolean;
  /** A curate vote just saved. Parent starts the hide-exit when filtering to not-voted. */
  onPersonVoted?: (personId: string) => void;
  sectionRef?: Ref<CardSectionHandle>;
  /** Include this person in the desktop grid even past the nine-card slice. */
  revealKey?: string | null;
}

export function CurateSection({ 
  categoryFilter,
  searchQuery = "",
  compact = false,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onBrowseFullScreen,
  onVisitProfile,
  activityFilter = "all",
  votedPersonIds,
  votesPending = false,
  isPersonRetained,
  isPersonHidden,
  isPersonExiting,
  onPersonVoted,
  sectionRef,
  revealKey,
}: CurateSectionProps) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [viewResultsPerson, setViewResultsPerson] = useState<CuratePerson | null>(null);

  const { favoriteIds } = useFavorites();
  const { data: allCelebritiesResponse, isLoading } = useQuery<{ data: TrendingPerson[] } | TrendingPerson[]>({
    queryKey: ['/api/trending?sort=rank&limit=100'],
  });

  const allCelebrities = useMemo(() => {
    if (!allCelebritiesResponse) return [];
    const rawData = Array.isArray(allCelebritiesResponse) 
      ? allCelebritiesResponse 
      : (allCelebritiesResponse as { data: TrendingPerson[] }).data;
    const data = Array.isArray(rawData) ? rawData : [];
    return data.filter((p): p is TrendingPerson => !!p && !!p.id);
  }, [allCelebritiesResponse]);

  const filteredCelebrities = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const matchesSearch = (person: TrendingPerson) =>
      !normalizedSearch || person.name.toLowerCase().includes(normalizedSearch);
    if (categoryFilter === "all") return allCelebrities.filter(matchesSearch);
    if (categoryFilter === "trending") return [...allCelebrities]
      .filter(matchesSearch)
      .sort((a: any, b: any) => ((b.fameScore ?? b.score ?? 0) - (a.fameScore ?? a.score ?? 0)));
    if (categoryFilter === "favorites") {
      return allCelebrities.filter(
        (person) => favoriteIds.has(person.id) && matchesSearch(person),
      );
    }
    return allCelebrities.filter(
      person => matchesCategoryFilter(person.category, (person as any).secondaryCategories, categoryFilter) && matchesSearch(person)
    );
  }, [allCelebrities, categoryFilter, searchQuery, favoriteIds]);

  const curatePersons: CuratePerson[] = useMemo(() => {
    return filteredCelebrities.map(person => ({
      id: person.id,
      name: person.name || 'Unknown',
      category: person.category || 'Music',
      imageUrl: person.avatar || person.imageUrl || null,
    }));
  }, [filteredCelebrities]);

  const visiblePersons = useMemo(
    () =>
      filterCardsByVoteActivity(
        curatePersons,
        activityFilter,
        (person) => votedPersonIds?.has(person.id) ?? false,
        {
          keyOf: (person) => person.id,
          isRetained: isPersonRetained,
          isHidden: isPersonHidden,
        },
      ),
    [curatePersons, activityFilter, votedPersonIds, isPersonRetained, isPersonHidden],
  );

  const handleVote = useCallback((personId: string) => {
    onPersonVoted?.(personId);
  }, [onPersonVoted]);

  const handleComplete = useCallback(() => {}, []);

  const handleViewResults = useCallback((person: CuratePerson) => {
    setViewResultsPerson(person);
  }, []);

  const handleSelectFromViewAll = useCallback((person: CuratePerson) => {
    setViewAllOpen(false);
    setViewResultsPerson(person);
  }, []);

  return (
    <>
      <div className="space-y-3">
        {isLoading || votesPending ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
          </div>
        ) : visiblePersons.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-border">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No celebrities match this filter</p>
          </div>
        ) : (
          <CardSection
            key={activityFilter}
            ref={sectionRef}
            desktopLimit={9}
            gap="gap-5"
            testIdPrefix="section-curate"
            revealKey={revealKey}
          >
            {visiblePersons.map((person) => (
              <HideExitCard
                key={person.id}
                cardKey={`curate:${person.id}`}
                exiting={isPersonExiting?.(person.id) ?? false}
                unvoted={votedPersonIds ? !votedPersonIds.has(person.id) : undefined}
              >
                <CurateProfileCard
                  person={person}
                  onVote={() => handleVote(person.id)}
                  onComplete={handleComplete}
                  onViewResults={handleViewResults}
                  cycleNumber={0}
                  onFilterCategory={onFilterCategory}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                  onBrowseFullScreen={onBrowseFullScreen ? () => onBrowseFullScreen(person.id) : undefined}
                  onVisitProfile={onVisitProfile ? () => onVisitProfile(person.id) : undefined}
                />
              </HideExitCard>
            ))}
          </CardSection>
        )}
        
        {!isLoading && !votesPending && visiblePersons.length > 0 && (
          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => setViewAllOpen(true)}
              className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300"
              data-testid="button-view-full-curation-list"
            >
              View full curation list
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {viewAllOpen && (
          <CurateViewAllOverlay
            onClose={() => setViewAllOpen(false)}
            onSelectPerson={handleSelectFromViewAll}
            onFilterCategory={onFilterCategory}
            categoryRaceMap={categoryRaceMap}
            leaderboardCategories={leaderboardCategories}
            activityFilter={activityFilter}
            isPersonVoted={(id) => votedPersonIds?.has(id) ?? false}
            isPersonRetained={isPersonRetained}
            isPersonHidden={isPersonHidden}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewResultsPerson && (
          <CurateViewResultsOverlay
            person={viewResultsPerson}
            onVoted={() => handleVote(viewResultsPerson.id)}
            onClose={() => setViewResultsPerson(null)}
            onFilterCategory={onFilterCategory}
            categoryRaceMap={categoryRaceMap}
            leaderboardCategories={leaderboardCategories}
          />
        )}
      </AnimatePresence>
    </>
  );
}
