import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ImageIcon, ChevronRight } from "lucide-react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, A11y, Virtual } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import "swiper/css/virtual";
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
}

export function CurateSection({ 
  categoryFilter,
  compact = false
}: CurateSectionProps) {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [viewResultsPerson, setViewResultsPerson] = useState<CuratePerson | null>(null);

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
                />
              ))}
            </div>

            {/* Mobile: Swiper carousel */}
            <div className="md:hidden authoridex-swiper w-screen relative left-1/2 -ml-[50vw]" data-dot-active="cyan">
              <Swiper
                modules={[Pagination, A11y, Virtual]}
                spaceBetween={0}
                slidesPerView={1}
                threshold={10}
                touchAngle={45}
                resistanceRatio={0.85}
                speed={300}
                cssMode={false}
                virtual
                pagination={{
                  clickable: true,
                  dynamicBullets: true,
                  dynamicMainBullets: 3,
                }}
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
                    <div className="w-full px-0">
                      <CurateProfileCard
                        person={person}
                        onVote={handleVote}
                        onComplete={handleComplete}
                        onViewResults={handleViewResults}
                        cycleNumber={0}
                      />
                    </div>
                  </SwiperSlide>
                ))}
              </Swiper>
            </div>
          </>
        )}
        
        {!isLoading && filteredCelebrities.length > 0 && (
          <div className="text-center mt-2 md:mt-6">
            <Button
              variant="ghost"
              onClick={() => setViewAllOpen(true)}
              className="text-cyan-400 hover:text-cyan-300"
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
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewResultsPerson && (
          <CurateViewResultsOverlay
            person={viewResultsPerson}
            onClose={() => setViewResultsPerson(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
