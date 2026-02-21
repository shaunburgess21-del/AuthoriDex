import { useState, useMemo } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CardDeckContainer } from "@/components/CardDeckContainer";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  Swords, 
  MessageSquare, 
  UserPlus, 
  ImageIcon, 
  ChevronRight, 
  Search, 
  Users, 
  ThumbsUp, 
  ThumbsDown, 
  Minus,
  Check,
  Star,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Cpu,
  Landmark,
  Briefcase,
  Music2,
  Trophy,
  Video,
  LayoutGrid
} from "lucide-react";
import {
  DISCOURSE_TOPICS,
  INDUCTION_CANDIDATES,
  type MatchupData,
  type DiscourseTopicData,
  type InductionCandidate,
} from "@/data/vote";
import { CurateSection } from "@/components/curate";
import { HomeSectionHeader } from "@/components/home/HomeSectionHeader";
import { getFilterCategories, type FilterCategory } from "@shared/constants";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ValueVotePerson } from "@/components/UnderratedOverratedCard";

type VoteSection = "All" | "Matchups" | "Trending Polls" | "Underrated / Overrated" | "Induction Queue" | "Curate Profile";
const SECTION_TOGGLES: VoteSection[] = ["All", "Matchups", "Trending Polls", "Underrated / Overrated", "Induction Queue", "Curate Profile"];

interface VoteDeckViewProps {
  onExplore: () => void;
}

function VersusCard({ 
  matchup, 
  userVote, 
  onVote,
  onRemoveVote 
}: { 
  matchup: MatchupData; 
  userVote: string | null;
  onVote: (matchupId: string, option: 'option_a' | 'option_b') => void;
  onRemoveVote?: (matchupId: string) => void;
}) {
  const hasVoted = userVote !== null;
  const votedA = userVote === 'option_a';
  const votedB = userVote === 'option_b';
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50">
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-teal-500/5 rounded-lg" />
      
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            <span>{matchup.totalVotes.toLocaleString('en-US')} votes</span>
          </div>
          <CategoryPill category={matchup.category} />
        </div>
        
        {!hasVoted && (
          <div className="flex flex-col items-center justify-center gap-1 mb-3" style={{ minHeight: '40px' }}>
            <span className="text-sm font-semibold text-slate-300">
              {matchup.promptText || "Who do you prefer?"}
            </span>
            <span className="text-[11px] text-slate-500">Tap an image to pick your side</span>
          </div>
        )}
        
        <div className="flex items-stretch gap-3">
          <button
            onClick={() => !hasVoted && onVote(matchup.id, 'option_a')}
            disabled={hasVoted}
            className={`flex-1 rounded-lg border transition-all overflow-hidden relative ${
              hasVoted
                ? votedA
                  ? 'border-cyan-500/50 ring-2 ring-cyan-500/30'
                  : 'border-slate-700/30 opacity-60'
                : 'border-slate-700/50 hover:border-cyan-500/50 cursor-pointer'
            }`}
            style={{ minHeight: '260px' }}
            data-testid={`button-vote-a-${matchup.id}`}
          >
            {matchup.optionAImage ? (
              <div className="absolute inset-0">
                <img 
                  src={matchup.optionAImage} 
                  alt={matchup.optionAText}
                  className="w-full h-full object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              </div>
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedA ? 'from-cyan-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
            )}
            <div className="relative h-full flex flex-col items-center justify-end p-3">
              <span className="font-semibold text-sm text-center text-white drop-shadow-lg">{matchup.optionAText}</span>
              {hasVoted && (
                <span className={`text-xl font-bold mt-1 ${votedA ? 'text-cyan-400' : 'text-slate-300'}`}>
                  {matchup.optionAPercent}%
                </span>
              )}
            </div>
          </button>
          
          <div className="flex items-center justify-center w-12 shrink-0">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-500 flex items-center justify-center shadow-lg">
              <span className="text-xs font-bold text-slate-200">VS</span>
            </div>
          </div>
          
          <button
            onClick={() => !hasVoted && onVote(matchup.id, 'option_b')}
            disabled={hasVoted}
            className={`flex-1 rounded-lg border transition-all overflow-hidden relative ${
              hasVoted
                ? votedB
                  ? 'border-teal-500/50 ring-2 ring-teal-500/30'
                  : 'border-slate-700/30 opacity-60'
                : 'border-slate-700/50 hover:border-teal-500/50 cursor-pointer'
            }`}
            style={{ minHeight: '260px' }}
            data-testid={`button-vote-b-${matchup.id}`}
          >
            {matchup.optionBImage ? (
              <div className="absolute inset-0">
                <img 
                  src={matchup.optionBImage} 
                  alt={matchup.optionBText}
                  className="w-full h-full object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              </div>
            ) : (
              <div className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedB ? 'from-teal-600/30 via-slate-800 to-slate-900' : 'from-slate-700 via-slate-800 to-slate-900'}`} />
            )}
            <div className="relative h-full flex flex-col items-center justify-end p-3">
              <span className="font-semibold text-sm text-center text-white drop-shadow-lg">{matchup.optionBText}</span>
              {hasVoted && (
                <span className={`text-xl font-bold mt-1 ${votedB ? 'text-teal-400' : 'text-slate-300'}`}>
                  {matchup.optionBPercent}%
                </span>
              )}
            </div>
          </button>
        </div>
        
        {hasVoted ? (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden flex">
              <div 
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${matchup.optionAPercent}%` }}
              />
              <div 
                className="h-full bg-gradient-to-r from-teal-400 to-teal-500 transition-all duration-500"
                style={{ width: `${matchup.optionBPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function PollCard({
  topic,
  userVote,
  onVote,
}: {
  topic: DiscourseTopicData;
  userVote: string | null;
  onVote: (topicId: string, choice: 'support' | 'neutral' | 'oppose') => void;
}) {
  const hasVoted = userVote !== null;
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50" style={{ minHeight: '340px' }}>
      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            <span>{topic.totalVotes.toLocaleString('en-US')} votes</span>
          </div>
          <CategoryPill category={topic.category} />
        </div>
        
        {topic.avatar && (
          <div className="flex justify-center mb-3">
            <PersonAvatar name={topic.personName || topic.headline} avatar={topic.avatar} size="xl" />
          </div>
        )}
        
        {topic.slug ? (
          <Link href={`/polls/${topic.slug}`} data-testid={`link-poll-detail-${topic.id}`}>
            <h3 className="font-semibold text-base mb-1 text-center hover:text-cyan-400 transition-colors cursor-pointer">{topic.headline}</h3>
          </Link>
        ) : (
          <h3 className="font-semibold text-base mb-1 text-center">{topic.headline}</h3>
        )}
        <p className="text-sm text-muted-foreground mb-4 text-center line-clamp-1">{topic.subjectText || topic.description}</p>
        
        {!hasVoted ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => onVote(topic.id, 'support')}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all duration-300 hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
              data-testid={`button-support-${topic.id}`}
            >
              <ThumbsUp className="h-4 w-4 shrink-0" />
              <span>Support</span>
            </button>
            <button
              onClick={() => onVote(topic.id, 'neutral')}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 border border-white/40 text-white text-sm font-medium transition-all duration-300 hover:border-white/80 hover:bg-white/15"
              data-testid={`button-neutral-${topic.id}`}
            >
              <Minus className="h-4 w-4 shrink-0" />
              <span>Neutral</span>
            </button>
            <button
              onClick={() => onVote(topic.id, 'oppose')}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all duration-300 hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
              data-testid={`button-oppose-${topic.id}`}
            >
              <ThumbsDown className="h-4 w-4 shrink-0" />
              <span>Oppose</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-3 rounded-full overflow-hidden bg-slate-700/50 flex">
                <div className="h-full bg-[#00C853]" style={{ width: `${topic.approvePercent}%` }} />
                <div className="h-full bg-slate-500" style={{ width: `${topic.neutralPercent}%` }} />
                <div className="h-full bg-[#FF0000]" style={{ width: `${topic.disapprovePercent}%` }} />
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className={userVote === 'support' ? 'text-[#00C853] font-semibold' : ''}>
                {topic.approvePercent}% Support
              </span>
              <span className={userVote === 'neutral' ? 'text-slate-300 font-semibold' : ''}>
                {topic.neutralPercent}% Neutral
              </span>
              <span className={userVote === 'oppose' ? 'text-[#FF0000] font-semibold' : ''}>
                {topic.disapprovePercent}% Oppose
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function InductionCard({
  candidate,
  isVoted,
  onVote,
}: {
  candidate: InductionCandidate;
  isVoted: boolean;
  onVote: (id: string) => void;
}) {
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50" style={{ minHeight: '300px' }}>
      <div className="absolute top-3 right-3">
        <CategoryPill category={candidate.category} />
      </div>
      <div className="relative p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <Users className="h-3.5 w-3.5 text-cyan-400" />
          <span>{candidate.votes.toLocaleString('en-US')} votes</span>
        </div>
        
        <div className="flex flex-col items-center text-center mb-4">
          <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="xl" />
          <h3 className="font-semibold text-base mt-3">{candidate.name}</h3>
        </div>
        
        <Button
          className={`w-full ${
            isVoted
              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
              : 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-[0_0_15px_rgba(34,211,238,0.2)]'
          }`}
          onClick={() => onVote(candidate.id)}
          data-testid={`button-induction-vote-${candidate.id}`}
        >
          {isVoted ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              Voted
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-2" />
              Vote to Induct
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

function ValueCard({
  person,
  userVote,
  onVote,
  onChangeVote,
}: {
  person: ValueVotePerson;
  userVote: 'underrated' | 'overrated' | 'fairly_rated' | null;
  onVote: (personId: string, vote: 'underrated' | 'overrated') => void;
  onChangeVote: (personId: string) => void;
}) {
  const hasVoted = userVote !== null;
  const totalVotes = (person.underratedCount || 0) + (person.overratedCount || 0);
  
  return (
    <Card className="relative overflow-visible bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50" style={{ minHeight: '340px' }}>
      <div className="absolute top-3 right-3">
        <CategoryPill category={person.category || "Unknown"} />
      </div>
      <div className="relative p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <BarChart3 className="h-3.5 w-3.5 text-cyan-400" />
          <span>{totalVotes.toLocaleString('en-US')} votes</span>
        </div>
        
        <div className="flex flex-col items-center text-center mb-4">
          <PersonAvatar name={person.name} avatar={person.avatar} size="xl" />
          <h3 className="font-semibold text-base mt-3">{person.name}</h3>
          <div className="text-sm font-mono text-cyan-400 mt-1">
            {person.fameIndex?.toLocaleString('en-US') ?? 'N/A'} Trend Score
          </div>
        </div>
        
        {hasVoted ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <ArrowUp className="h-4 w-4 text-[#00C853] shrink-0" />
              <span className="text-sm text-[#00C853] w-20 shrink-0">Underrated</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#00C853] rounded-full transition-all duration-500"
                  style={{ width: `${person.underratedPct ?? 50}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-10 text-right">{Math.round(person.underratedPct ?? 50)}%</span>
            </div>
            <div className="flex items-center gap-3">
              <ArrowDown className="h-4 w-4 text-[#FF0000] shrink-0" />
              <span className="text-sm text-[#FF0000] w-20 shrink-0">Overrated</span>
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-[#FF0000] rounded-full transition-all duration-500"
                  style={{ width: `${person.overratedPct ?? 50}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-10 text-right">{Math.round(person.overratedPct ?? 50)}%</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex items-center gap-2">
                {userVote === 'underrated' ? (
                  <ArrowUp className="h-4 w-4 text-[#00C853]" />
                ) : (
                  <ArrowDown className="h-4 w-4 text-[#FF0000]" />
                )}
                <span className="text-sm text-muted-foreground">
                  You voted <span className={userVote === 'underrated' ? 'text-[#00C853]' : 'text-[#FF0000]'}>
                    {userVote}
                  </span>
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChangeVote(person.id)}
                className="text-xs text-muted-foreground"
                data-testid={`button-value-change-${person.id}`}
              >
                Change
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 bg-[#00C853]/10 border-[#00C853]/50 text-[#00C853]"
              onClick={() => onVote(person.id, 'underrated')}
              data-testid={`button-value-underrated-${person.id}`}
            >
              <ArrowUp className="h-4 w-4 mr-1" />
              Underrated
            </Button>
            <Button
              variant="outline"
              className="flex-1 bg-[#FF0000]/10 border-[#FF0000]/50 text-[#FF0000]"
              onClick={() => onVote(person.id, 'overrated')}
              data-testid={`button-value-overrated-${person.id}`}
            >
              <ArrowDown className="h-4 w-4 mr-1" />
              Overrated
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function VoteDeckView({ onExplore }: VoteDeckViewProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<VoteSection>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>("All");
  
  const [matchupVotes, setMatchupVotes] = useState<Record<string, string>>({});
  const [pollVotes, setPollVotes] = useState<Record<string, string>>({});
  const [inductionVotes, setInductionVotes] = useState<Set<string>>(new Set());
  const [valueVotes, setValueVotes] = useState<Record<string, 'underrated' | 'overrated'>>({});
  
  const [matchupInteracted, setMatchupInteracted] = useState(false);
  const [pollInteracted, setPollInteracted] = useState(false);
  const [inductionInteracted, setInductionInteracted] = useState(false);
  const [valueInteracted, setValueInteracted] = useState(false);

  // Fetch matchups from API to get real images
  const { data: matchupsData = [] } = useQuery<MatchupData[]>({
    queryKey: ['/api/matchups'],
    staleTime: 60 * 1000,
  });

  const filteredMatchups = useMemo(() => 
    matchupsData.filter(fo => {
      const matchesCategory = categoryFilter === "All" || categoryFilter === "Trending" || fo.category === categoryFilter;
      const matchesSearch = !searchQuery || 
        fo.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fo.optionAText.toLowerCase().includes(searchQuery.toLowerCase()) ||
        fo.optionBText.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "Trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0),
    [categoryFilter, searchQuery]
  );

  const filteredPolls = useMemo(() =>
    DISCOURSE_TOPICS.filter(t => {
      const matchesCategory = categoryFilter === "All" || categoryFilter === "Trending" || t.category === categoryFilter;
      const matchesSearch = !searchQuery ||
        t.headline.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "Trending" ? ((b.totalVotes ?? 0) - (a.totalVotes ?? 0)) : 0),
    [categoryFilter, searchQuery]
  );

  const filteredInduction = useMemo(() =>
    INDUCTION_CANDIDATES.filter(c => {
      const matchesCategory = categoryFilter === "All" || categoryFilter === "Trending" || c.category === categoryFilter;
      const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "Trending" ? ((b.votes ?? 0) - (a.votes ?? 0)) : 0),
    [categoryFilter, searchQuery]
  );

  interface ValueLeaderboardResponse {
    tab: string;
    sortDir: string;
    total: number;
    data: ValueVotePerson[];
  }
  
  const { data: valueResponse } = useQuery<ValueLeaderboardResponse>({
    queryKey: ['/api/leaderboard?tab=value&limit=20'],
    staleTime: 60 * 1000,
  });
  
  const valueCelebrities = valueResponse?.data || [];

  const filteredValue = useMemo(() =>
    valueCelebrities.filter((c: ValueVotePerson) => {
      const matchesCategory = categoryFilter === "All" || categoryFilter === "Trending" || c.category?.toLowerCase() === categoryFilter.toLowerCase();
      const matchesSearch = !searchQuery || c.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a: any, b: any) => categoryFilter === "Trending" ? ((b.approvalScore ?? 0) - (a.approvalScore ?? 0)) : 0),
    [valueCelebrities, categoryFilter, searchQuery]
  );

  const { toast } = useToast();
  
  const valueVoteMutation = useMutation({
    mutationFn: async ({ personId, vote }: { personId: string; vote: 'underrated' | 'overrated' }) => {
      return apiRequest('POST', `/api/celebrity/${personId}/value-vote`, { vote });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/celebrity', variables.personId, 'value-vote'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard?tab=value&limit=20'] });
    },
    onError: (error: any, variables) => {
      setValueVotes(prev => {
        const next = { ...prev };
        delete next[variables.personId];
        return next;
      });
      toast({
        title: "Vote failed",
        description: error.message?.includes("401") ? "Please sign in to vote" : (error.message || "Failed to submit vote"),
        variant: "destructive",
      });
    },
  });

  const handleMatchupVote = (id: string, option: 'option_a' | 'option_b') => {
    setMatchupVotes(prev => ({ ...prev, [id]: option }));
  };

  const handlePollVote = (id: string, choice: 'support' | 'neutral' | 'oppose') => {
    setPollVotes(prev => ({ ...prev, [id]: choice }));
  };

  const handleInductionVote = (id: string) => {
    setInductionVotes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleValueVote = (personId: string, vote: 'underrated' | 'overrated') => {
    setValueVotes(prev => ({ ...prev, [personId]: vote }));
    valueVoteMutation.mutate({ personId, vote });
  };

  const handleValueChangeVote = (personId: string) => {
    setValueVotes(prev => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
  };

  const dragScrollRef1 = useDragScroll<HTMLDivElement>();
  const dragScrollRef2 = useDragScroll<HTMLDivElement>();

  const showMatchups = activeSection === "All" || activeSection === "Matchups";
  const showPolls = activeSection === "All" || activeSection === "Trending Polls";
  const showInduction = activeSection === "All" || activeSection === "Induction Queue";
  const showCurate = activeSection === "All" || activeSection === "Curate Profile";
  const showValue = activeSection === "All" || activeSection === "Underrated / Overrated";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto space-y-4"
    >
      <div ref={dragScrollRef1} className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
        {SECTION_TOGGLES.map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeSection === section
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-400/40"
                : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
            }`}
            data-testid={`toggle-vote-section-${section.toLowerCase().replace(/['\s]/g, '-')}`}
          >
            {section === "Matchups" && <Swords className="h-3 w-3" />}
            {section === "Trending Polls" && <MessageSquare className="h-3 w-3" />}
            {section === "Induction Queue" && <UserPlus className="h-3 w-3" />}
            {section === "Curate Profile" && <ImageIcon className="h-3 w-3" />}
            {section === "Underrated / Overrated" && <BarChart3 className="h-3 w-3" />}
            {section}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search votes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-vote-search"
        />
      </div>

      <div ref={dragScrollRef2} className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {getFilterCategories(false).map((cat) => (
          <button
            key={cat}
            onClick={() => {
              if (cat === "Favorites" && !user) {
                setLocation("/login");
                return;
              }
              setCategoryFilter(cat as FilterCategory);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
              categoryFilter === cat
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50'
            }`}
            data-testid={`chip-vote-category-${cat.toLowerCase()}`}
            aria-label={cat === "Favorites" ? "Favorites" : undefined}
          >
            {cat === "All" && <LayoutGrid className="h-3.5 w-3.5" />}
            {cat === "Favorites" && <Star className="h-3.5 w-3.5" />}
            {cat === "Tech" && <Cpu className="h-3.5 w-3.5" />}
            {cat === "Politics" && <Landmark className="h-3.5 w-3.5" />}
            {cat === "Business" && <Briefcase className="h-3.5 w-3.5" />}
            {cat === "Music" && <Music2 className="h-3.5 w-3.5" />}
            {cat === "Sports" && <Trophy className="h-3.5 w-3.5" />}
            {cat === "Creator" && <Video className="h-3.5 w-3.5" />}
            {cat === "Favorites" ? <span className="hidden md:inline">{cat}</span> : cat}
          </button>
        ))}
      </div>

      {showMatchups && filteredMatchups.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="vote"
            icon={Swords}
            title="Matchups"
            subtitle="Vote on A vs B matchups."
            help={{ title: "How Matchups Work", bullets: ["Pick your side in head-to-head matchups between celebrities.", "Each vote earns XP and contributes to the community consensus.", "Results update in real time as the community weighs in."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredMatchups}
            viewType="vote"
            hasInteracted={matchupInteracted}
            onAdvance={() => setMatchupInteracted(false)}
            renderCard={(fo) => (
              <VersusCard
                matchup={fo}
                userVote={matchupVotes[fo.id] || null}
                onVote={(id, opt) => {
                  handleMatchupVote(id, opt);
                  setMatchupInteracted(true);
                }}
              />
            )}
            emptyMessage="No matchups match your filters"
          />
        </div>
      )}

      {showPolls && filteredPolls.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="vote"
            icon={MessageSquare}
            title="Trending Polls"
            subtitle="Weigh in on current topics."
            help={{ title: "How Trending Polls Work", bullets: ["The ultimate community pulse check on current events.", "Evergreen polls remain open; timed polls resolve at a deadline.", "Your vote updates the results in real time."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredPolls}
            viewType="vote"
            hasInteracted={pollInteracted}
            onAdvance={() => setPollInteracted(false)}
            renderCard={(topic) => (
              <PollCard
                topic={topic}
                userVote={pollVotes[topic.id] || null}
                onVote={(id, choice) => {
                  handlePollVote(id, choice);
                  setPollInteracted(true);
                }}
              />
            )}
            emptyMessage="No polls match your filters"
          />
        </div>
      )}

      {showValue && filteredValue.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="vote"
            icon={BarChart3}
            title="Underrated / Overrated"
            subtitle="Rate public perception vs reality."
            help={{ title: "How It Works", bullets: ["Vote Underrated if you think they deserve more recognition.", "Vote Overrated if you think they get more attention than deserved.", "Compare your view with the community results in real time."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredValue}
            viewType="vote"
            hasInteracted={valueInteracted}
            onAdvance={() => setValueInteracted(false)}
            renderCard={(person: ValueVotePerson) => (
              <ValueCard
                person={person}
                userVote={person.userValueVote ?? valueVotes[person.id] ?? null}
                onVote={(id, vote) => {
                  handleValueVote(id, vote);
                  setValueInteracted(true);
                }}
                onChangeVote={handleValueChangeVote}
              />
            )}
            emptyMessage="No celebrities match your filters"
          />
        </div>
      )}

      {showInduction && filteredInduction.length > 0 && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="vote"
            icon={UserPlus}
            title="Induction Queue"
            subtitle="Vote who joins the leaderboard next."
            help={{ title: "Induction Queue Rules", bullets: ["Candidates with the most votes at end of cycle join the main leaderboard.", "Your vote helps shape who defines the future of fame.", "Each vote earns XP toward your profile rank."] }}
            onViewAll={onExplore}
          />
          <CardDeckContainer
            items={filteredInduction}
            viewType="vote"
            hasInteracted={inductionInteracted}
            onAdvance={() => setInductionInteracted(false)}
            renderCard={(candidate) => (
              <InductionCard
                candidate={candidate}
                isVoted={inductionVotes.has(candidate.id)}
                onVote={(id) => {
                  handleInductionVote(id);
                  setInductionInteracted(true);
                }}
              />
            )}
            emptyMessage="No candidates match your filters"
          />
        </div>
      )}

      {showCurate && (
        <div className="space-y-2">
          <HomeSectionHeader
            theme="vote"
            icon={ImageIcon}
            title="Curate The Profile"
            subtitle="Pick the best profile photo set."
            help={{ title: "Curate Profile Rules", bullets: ["Choose which image best represents each celebrity.", "The winning look becomes the primary profile image platform-wide.", "Only the highest quality looks make it to the index."] }}
            onViewAll={onExplore}
          />
          <CurateSection categoryFilter={categoryFilter} compact />
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <Button 
          size="lg"
          className="bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-semibold px-8 shadow-lg shadow-cyan-500/20"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            onExplore();
          }}
          data-testid="button-explore-governance"
        >
          Go to Full Governance Hub
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </motion.div>
  );
}
