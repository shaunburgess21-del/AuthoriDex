import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { 
  ArrowLeft, 
  Plus, 
  Vote,
  Users,
  Clock,
  Sparkles,
  Camera
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

interface InductionCandidate {
  id: string;
  name: string;
  avatar: string;
  category: string;
  currentVotes: number;
  votesNeeded: number;
}

const inductionCandidates: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", avatar: "", category: "Tech", currentVotes: 850, votesNeeded: 1000 },
  { id: "i2", name: "Charli XCX", avatar: "", category: "Music", currentVotes: 720, votesNeeded: 1000 },
  { id: "i3", name: "Kai Cenat", avatar: "", category: "Entertainment", currentVotes: 945, votesNeeded: 1000 },
  { id: "i4", name: "Sabrina Carpenter", avatar: "", category: "Music", currentVotes: 680, votesNeeded: 1000 },
  { id: "i5", name: "xQc", avatar: "", category: "Entertainment", currentVotes: 590, votesNeeded: 1000 },
];

interface ImagePoll {
  id: string;
  personName: string;
  personId: string;
  category: string;
  photoA: { id: string; votes: number };
  photoB: { id: string; votes: number };
}

const imagePolls: ImagePoll[] = [
  { id: "ip1", personName: "Taylor Swift", personId: "2", category: "Music", photoA: { id: "a", votes: 3456 }, photoB: { id: "b", votes: 2198 } },
  { id: "ip2", personName: "Elon Musk", personId: "1", category: "Tech", photoA: { id: "a", votes: 4521 }, photoB: { id: "b", votes: 3890 } },
  { id: "ip3", personName: "Beyoncé", personId: "7", category: "Music", photoA: { id: "a", votes: 5678 }, photoB: { id: "b", votes: 4321 } },
  { id: "ip4", personName: "MrBeast", personId: "3", category: "Entertainment", photoA: { id: "a", votes: 2890 }, photoB: { id: "b", votes: 2456 } },
];

interface SentimentPerson {
  id: string;
  name: string;
  avatar: string;
  category: string;
  globalAverage: number;
}

const sentimentPeople: SentimentPerson[] = [
  { id: "1", name: "Elon Musk", avatar: "", category: "Tech", globalAverage: 6.8 },
  { id: "2", name: "Taylor Swift", avatar: "", category: "Music", globalAverage: 8.2 },
  { id: "3", name: "MrBeast", avatar: "", category: "Entertainment", globalAverage: 7.9 },
  { id: "4", name: "Donald Trump", avatar: "", category: "Politics", globalAverage: 4.5 },
  { id: "5", name: "Kim Kardashian", avatar: "", category: "Entertainment", globalAverage: 5.3 },
  { id: "6", name: "Cristiano Ronaldo", avatar: "", category: "Sports", globalAverage: 8.7 },
];

function InductionCard({ candidate, onVote }: { candidate: InductionCandidate; onVote: (id: string) => void }) {
  const progress = (candidate.currentVotes / candidate.votesNeeded) * 100;
  const [hasVoted, setHasVoted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const handleVote = () => {
    if (!hasVoted) {
      setHasVoted(true);
      setShowConfetti(true);
      onVote(candidate.id);
      setTimeout(() => setShowConfetti(false), 1000);
    }
  };

  return (
    <div className="px-2">
      <Card 
        className="p-5 hover:translate-y-[-2px] hover:shadow-lg hover:border-cyan-500/40 transition-all duration-200 relative overflow-hidden"
        data-testid={`card-induction-${candidate.id}`}
      >
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-2 left-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-ping" />
            <div className="absolute top-4 right-1/3 w-2 h-2 bg-cyan-300 rounded-full animate-ping delay-100" />
            <div className="absolute top-3 right-1/4 w-2 h-2 bg-cyan-500 rounded-full animate-ping delay-200" />
          </div>
        )}
        
        <div className="flex flex-col items-center text-center mb-4">
          <PersonAvatar name={candidate.name} avatar={candidate.avatar} size="lg" />
          <h3 className="font-semibold mt-3">{candidate.name}</h3>
          <Badge variant="secondary" className="text-xs mt-1">{candidate.category}</Badge>
        </div>
        
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-cyan-400 font-mono">{candidate.currentVotes.toLocaleString()} / {candidate.votesNeeded.toLocaleString()}</span>
          </div>
          <div className="h-3 w-full bg-muted/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        <Button 
          onClick={handleVote}
          disabled={hasVoted}
          className={`w-full ${hasVoted ? 'bg-cyan-600' : 'bg-cyan-500'} text-white`}
          data-testid={`button-induct-${candidate.id}`}
        >
          <Vote className="h-4 w-4 mr-2" />
          {hasVoted ? 'Voted!' : 'Vote to Induct (+1)'}
        </Button>
      </Card>
    </div>
  );
}

function ImagePollCard({ poll, onVote }: { poll: ImagePoll; onVote: (pollId: string, choice: 'a' | 'b') => void }) {
  const [selectedChoice, setSelectedChoice] = useState<'a' | 'b' | null>(null);
  const totalVotes = poll.photoA.votes + poll.photoB.votes;
  const percentA = Math.round((poll.photoA.votes / totalVotes) * 100);
  const percentB = 100 - percentA;

  const handlePick = (choice: 'a' | 'b') => {
    if (!selectedChoice) {
      setSelectedChoice(choice);
      onVote(poll.id, choice);
    }
  };

  return (
    <div className="px-2">
      <Card 
        className="p-4 hover:translate-y-[-2px] hover:shadow-lg hover:border-cyan-500/40 transition-all duration-200"
        data-testid={`card-imagepoll-${poll.id}`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Best Look for {poll.personName}?</h3>
          <Badge variant="secondary" className="text-xs">{poll.category}</Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => handlePick('a')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg bg-muted flex items-center justify-center border-2 transition-all group ${
              selectedChoice === 'a' 
                ? 'border-cyan-500 ring-2 ring-cyan-500/20' 
                : selectedChoice === 'b'
                ? 'border-muted opacity-60'
                : 'border-transparent hover:border-cyan-500/50'
            }`}
            data-testid={`button-photo-a-${poll.id}`}
          >
            <div className="text-center">
              <Camera className="h-8 w-8 text-muted-foreground mx-auto mb-1" />
              <span className="text-xs text-muted-foreground">Photo A</span>
            </div>
            {!selectedChoice && (
              <div className="absolute inset-0 bg-cyan-500/0 group-hover:bg-cyan-500/10 rounded-lg flex items-center justify-center transition-all">
                <span className="opacity-0 group-hover:opacity-100 text-cyan-400 text-sm font-medium transition-opacity">Pick This</span>
              </div>
            )}
          </button>
          
          <button
            onClick={() => handlePick('b')}
            disabled={!!selectedChoice}
            className={`relative aspect-square rounded-lg bg-muted flex items-center justify-center border-2 transition-all group ${
              selectedChoice === 'b' 
                ? 'border-cyan-500 ring-2 ring-cyan-500/20' 
                : selectedChoice === 'a'
                ? 'border-muted opacity-60'
                : 'border-transparent hover:border-cyan-500/50'
            }`}
            data-testid={`button-photo-b-${poll.id}`}
          >
            <div className="text-center">
              <Camera className="h-8 w-8 text-muted-foreground mx-auto mb-1" />
              <span className="text-xs text-muted-foreground">Photo B</span>
            </div>
            {!selectedChoice && (
              <div className="absolute inset-0 bg-cyan-500/0 group-hover:bg-cyan-500/10 rounded-lg flex items-center justify-center transition-all">
                <span className="opacity-0 group-hover:opacity-100 text-cyan-400 text-sm font-medium transition-opacity">Pick This</span>
              </div>
            )}
          </button>
        </div>
        
        {selectedChoice && (
          <div className="text-center">
            <p className="text-sm">
              <span className="text-cyan-400 font-semibold">{selectedChoice === 'a' ? percentA : percentB}%</span>
              <span className="text-muted-foreground"> prefer Photo {selectedChoice.toUpperCase()}</span>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function SentimentCard({ person, onSubmit }: { person: SentimentPerson; onSubmit: (personId: string, rating: number) => void }) {
  const [rating, setRating] = useState(5);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!submitted) {
      setSubmitted(true);
      onSubmit(person.id, rating);
    }
  };

  const getRatingColor = (value: number) => {
    if (value <= 2) return "text-red-500";
    if (value <= 4) return "text-orange-500";
    if (value <= 6) return "text-yellow-500";
    if (value <= 8) return "text-lime-500";
    return "text-green-500";
  };

  return (
    <div className="px-2">
      <Card 
        className="p-4 hover:translate-y-[-2px] hover:shadow-lg hover:border-cyan-500/40 transition-all duration-200"
        data-testid={`card-sentiment-${person.id}`}
      >
        <div className="flex items-center gap-3 mb-4">
          <PersonAvatar name={person.name} avatar={person.avatar} size="md" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">{person.name}</h3>
            <Badge variant="secondary" className="text-xs">{person.category}</Badge>
          </div>
        </div>
        
        {!submitted ? (
          <>
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Your Rating</span>
                <span className={`font-mono font-bold ${getRatingColor(rating)}`}>{rating}/10</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={rating}
                onChange={(e) => setRating(parseInt(e.target.value))}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-500"
                data-testid={`slider-rating-${person.id}`}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Hate</span>
                <span>Love</span>
              </div>
            </div>
            <Button 
              onClick={handleSubmit}
              className="w-full bg-cyan-500 text-white"
              data-testid={`button-submit-rating-${person.id}`}
            >
              Submit Rating
            </Button>
          </>
        ) : (
          <div className="text-center py-2">
            <p className="text-sm text-muted-foreground mb-1">Your vote recorded!</p>
            <p className="text-lg">
              <span className="text-muted-foreground">Global Average: </span>
              <span className={`font-bold ${getRatingColor(person.globalAverage)}`}>{person.globalAverage.toFixed(1)}</span>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function CarouselSection({ 
  title, 
  subtitle, 
  children,
  icon: Icon
}: { 
  title: string; 
  subtitle: string; 
  children: React.ReactNode;
  icon: typeof Vote;
}) {
  const sliderSettings = {
    dots: false,
    infinite: false,
    speed: 300,
    slidesToShow: 3,
    slidesToScroll: 1,
    arrows: true,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 2,
        }
      },
      {
        breakpoint: 640,
        settings: {
          slidesToShow: 1,
          centerMode: true,
          centerPadding: '20px',
        }
      }
    ]
  };

  return (
    <section className="mb-10">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-serif font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      
      <div className="predict-carousel -mx-2">
        <Slider {...sliderSettings}>
          {children}
        </Slider>
      </div>
    </section>
  );
}

export default function VotePage() {
  const [, setLocation] = useLocation();
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestCategory, setSuggestCategory] = useState("");
  const [totalVotes] = useState(127843);
  const [countdown, setCountdown] = useState("2d 14h 32m");

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(prev => {
        const parts = prev.match(/(\d+)d (\d+)h (\d+)m/);
        if (parts) {
          let days = parseInt(parts[1]);
          let hours = parseInt(parts[2]);
          let mins = parseInt(parts[3]);
          mins--;
          if (mins < 0) { mins = 59; hours--; }
          if (hours < 0) { hours = 23; days--; }
          if (days < 0) return "0d 0h 0m";
          return `${days}d ${hours}h ${mins}m`;
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleInductionVote = (candidateId: string) => {
    console.log(`Voted to induct: ${candidateId}`);
  };

  const handleImageVote = (pollId: string, choice: 'a' | 'b') => {
    console.log(`Voted for photo ${choice} on poll ${pollId}`);
  };

  const handleSentimentSubmit = (personId: string, rating: number) => {
    console.log(`Submitted rating ${rating} for person ${personId}`);
  };

  const handleSuggestSubmit = () => {
    if (suggestName && suggestCategory) {
      console.log(`Suggested: ${suggestName} (${suggestCategory})`);
      setSuggestModalOpen(false);
      setSuggestName("");
      setSuggestCategory("");
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              className="md:hidden"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">FameDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="link-nav-home">Home</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm" className="text-cyan-400" data-testid="link-nav-vote">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm" data-testid="link-nav-predict">Predict</Button>
              </Link>
              <Link href="/me">
                <Button variant="ghost" size="sm" data-testid="link-nav-me">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent" />
        <div className="container mx-auto px-4 py-12 max-w-5xl relative">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-4">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <span className="text-sm text-cyan-400 font-medium">Community Governance</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-serif font-bold mb-3" data-testid="text-vote-title">
              Shape the FameDex
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Vote on new inductees, curate profile images, and rate global sentiment. Your opinion powers the index.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row justify-center gap-6 mb-8">
            <div className="flex items-center gap-3 px-6 py-3 rounded-lg bg-muted/50 border border-border">
              <Users className="h-5 w-5 text-cyan-400" />
              <div>
                <p className="text-xs text-muted-foreground">Total Votes Cast</p>
                <p className="text-lg font-bold font-mono text-cyan-400" data-testid="text-total-votes">{totalVotes.toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-6 py-3 rounded-lg bg-muted/50 border border-border">
              <Clock className="h-5 w-5 text-cyan-400" />
              <div>
                <p className="text-xs text-muted-foreground">Next Induction In</p>
                <p className="text-lg font-bold font-mono text-cyan-400" data-testid="text-countdown">{countdown}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <CarouselSection
          title="The Induction Queue"
          subtitle="Vote on which celebrity joins the main leaderboard next."
          icon={Vote}
        >
          {inductionCandidates.map((candidate) => (
            <InductionCard key={candidate.id} candidate={candidate} onVote={handleInductionVote} />
          ))}
        </CarouselSection>

        <CarouselSection
          title="Paparazzi Pit"
          subtitle="Select the best profile photo for existing celebrities."
          icon={Camera}
        >
          {imagePolls.map((poll) => (
            <ImagePollCard key={poll.id} poll={poll} onVote={handleImageVote} />
          ))}
        </CarouselSection>

        <CarouselSection
          title="Global Sentiment Pulse"
          subtitle="Quick 1-10 approval ratings. How do you feel about them?"
          icon={Sparkles}
        >
          {sentimentPeople.map((person) => (
            <SentimentCard key={person.id} person={person} onSubmit={handleSentimentSubmit} />
          ))}
        </CarouselSection>
      </div>

      <button
        onClick={() => setSuggestModalOpen(true)}
        className="fixed bottom-24 md:bottom-8 right-6 h-14 w-14 rounded-full bg-cyan-500 text-white shadow-lg flex items-center justify-center hover:bg-cyan-600 transition-colors z-40"
        data-testid="fab-suggest-candidate"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Dialog open={suggestModalOpen} onOpenChange={setSuggestModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-cyan-400" />
              Suggest a Candidate
            </DialogTitle>
            <DialogDescription>
              Who are we missing? Suggest someone to be added to FameDex.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Name</label>
              <Input 
                placeholder="Enter celebrity name..."
                value={suggestName}
                onChange={(e) => setSuggestName(e.target.value)}
                data-testid="input-suggest-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Category</label>
              <Select value={suggestCategory} onValueChange={setSuggestCategory}>
                <SelectTrigger data-testid="select-suggest-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Music">Music</SelectItem>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Entertainment">Entertainment</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSuggestModalOpen(false)} data-testid="button-cancel-suggestion">Cancel</Button>
            <Button 
              onClick={handleSuggestSubmit}
              disabled={!suggestName || !suggestCategory}
              className="bg-cyan-500 text-white"
              data-testid="button-submit-suggestion"
            >
              Submit Suggestion
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
