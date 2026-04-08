import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ImageIcon, ChevronRight } from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Virtual } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/virtual";
import { WindowedDotIndicator } from "@/components/WindowedDotIndicator";
import { CurateProfileCard, type CuratePerson } from "./CurateProfileCard";
import { CurateViewResultsOverlay } from "./CurateViewResultsOverlay";
import { CurateViewAllOverlay } from "./CurateViewAllOverlay";
import type { FilterCategory } from "@shared/constants";

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
  compact?: boolean;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}

export function CurateSection({ 
  categoryFilter,
  compact = false,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: CurateSectionProps) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [viewResultsPerson, setViewResultsPerson] = useState<CuratePerson | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const swiperRef = useRef<SwiperType | null>(null);

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
    if (categoryFilter === "All") return allCelebrities;
    if (categoryFilter === "Trending") return [...allCelebrities].sort((a: any, b: any) => ((b.fameScore ?? b.score ?? 0) - (a.fameScore ?? a.score ?? 0)));
    if (categoryFilter === "Favorites") return allCelebrities;
    return allCelebrities.filter(
      person => person.category?.toLowerCase() === categoryFilter.toLowerCase()
    );
  }, [allCelebrities, categoryFilter]);

  const curatePersons: CuratePerson[] = useMemo(() => {
    return filteredCelebrities.map(person => ({
      id: person.id,
      name: person.name || 'Unknown',
      category: person.category || 'Music',
      imageUrl: person.avatar || person.imageUrl || null,
    }));
  }, [filteredCelebrities]);

  useEffect(() => {
    setCarouselIndex(0);
    swiperRef.current?.slideTo(0, 0);
  }, [curatePersons.length]);

  const handleVote = useCallback(() => {}, []);

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
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
          </div>
        ) : filteredCelebrities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-border">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No celebrities match this filter</p>
          </div>
        ) : (
          <>
            {/* Desktop: grid layout */}
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-5">
              {curatePersons.slice(0, 9).map((person) => (
                <CurateProfileCard
                  key={person.id}
                  person={person}
                  onVote={handleVote}
                  onComplete={handleComplete}
                  onViewResults={handleViewResults}
                  cycleNumber={0}
                  onFilterCategory={onFilterCategory}
                  categoryRaceMap={categoryRaceMap}
                  leaderboardCategories={leaderboardCategories}
                />
              ))}
            </div>

            {/* Mobile: Swiper carousel */}
            <div className="md:hidden relative w-full">
              <Swiper
                modules={[A11y, Virtual]}
                spaceBetween={0}
                slidesPerView={1}
                threshold={10}
                touchAngle={45}
                resistanceRatio={0.85}
                speed={300}
                cssMode={false}
                virtual
                pagination={false}
                onSwiper={(s) => {
                  swiperRef.current = s;
                }}
                onSlideChange={(s) => setCarouselIndex(s.activeIndex)}
                a11y={{
                  enabled: true,
                  prevSlideMessage: "Previous slide",
                  nextSlideMessage: "Next slide",
                }}
                className="py-2"
                data-testid="section-curate-carousel"
              >
                {curatePersons.map((person, i) => (
                  <SwiperSlide key={person.id} virtualIndex={i}>
                    <div className="w-full px-1.5 md:px-0">
                      <CurateProfileCard
                        person={person}
                        onVote={handleVote}
                        onComplete={handleComplete}
                        onViewResults={handleViewResults}
                        cycleNumber={0}
                        onFilterCategory={onFilterCategory}
                        categoryRaceMap={categoryRaceMap}
                        leaderboardCategories={leaderboardCategories}
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
              <WindowedDotIndicator
                totalSlides={curatePersons.length}
                activeIndex={carouselIndex}
                accent="cyan"
                testIdPrefix="section-curate-dots"
                onDotClick={(idx) => swiperRef.current?.slideTo(idx)}
              />
            </div>
          </>
        )}
        
        {!isLoading && filteredCelebrities.length > 0 && (
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
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewResultsPerson && (
          <CurateViewResultsOverlay
            person={viewResultsPerson}
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
