import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SentimentVotingWidget } from "@/components/SentimentVotingWidget";
import { 
  ArrowLeft, 
  Plus, 
  Heart, 
  ImageIcon, 
  UserPlus, 
  CheckSquare,
  Sliders,
  Eye,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
  ExternalLink
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface Person {
  id: string;
  name: string;
  avatar: string;
  category: string;
}

const allSentimentPeople: Person[] = [
  { id: "1", name: "Elon Musk", avatar: "", category: "Tech" },
  { id: "2", name: "Taylor Swift", avatar: "", category: "Music" },
  { id: "3", name: "MrBeast", avatar: "", category: "Entertainment" },
  { id: "4", name: "Donald Trump", avatar: "", category: "Politics" },
  { id: "5", name: "Kim Kardashian", avatar: "", category: "Entertainment" },
  { id: "6", name: "Cristiano Ronaldo", avatar: "", category: "Sports" },
  { id: "7", name: "Beyoncé", avatar: "", category: "Music" },
  { id: "8", name: "Drake", avatar: "", category: "Music" },
];

interface ImageOption {
  id: string;
  url: string;
  votes: number;
}

interface ImageVotingCard {
  id: string;
  personName: string;
  personId: string;
  category: string;
  images: ImageOption[];
  totalVotes: number;
}

const featuredImageVotingCards: ImageVotingCard[] = [
  {
    id: "img-1",
    personName: "Taylor Swift",
    personId: "2",
    category: "Music",
    images: [
      { id: "a", url: "", votes: 1234 },
      { id: "b", url: "", votes: 892 },
      { id: "c", url: "", votes: 567 },
    ],
    totalVotes: 2693,
  },
  {
    id: "img-2",
    personName: "MrBeast",
    personId: "3",
    category: "Entertainment",
    images: [
      { id: "a", url: "", votes: 2341 },
      { id: "b", url: "", votes: 1876 },
      { id: "c", url: "", votes: 943 },
    ],
    totalVotes: 5160,
  },
  {
    id: "img-3",
    personName: "Beyoncé",
    personId: "7",
    category: "Music",
    images: [
      { id: "a", url: "", votes: 3456 },
      { id: "b", url: "", votes: 2198 },
      { id: "c", url: "", votes: 1543 },
    ],
    totalVotes: 7197,
  },
];

const additionalImageVotingCards: ImageVotingCard[] = [
  {
    id: "img-4",
    personName: "Elon Musk",
    personId: "1",
    category: "Tech",
    images: [
      { id: "a", url: "", votes: 4521 },
      { id: "b", url: "", votes: 3890 },
      { id: "c", url: "", votes: 2134 },
    ],
    totalVotes: 10545,
  },
  {
    id: "img-5",
    personName: "Donald Trump",
    personId: "4",
    category: "Politics",
    images: [
      { id: "a", url: "", votes: 5678 },
      { id: "b", url: "", votes: 4321 },
      { id: "c", url: "", votes: 2987 },
    ],
    totalVotes: 12986,
  },
  {
    id: "img-6",
    personName: "Kim Kardashian",
    personId: "5",
    category: "Entertainment",
    images: [
      { id: "a", url: "", votes: 2890 },
      { id: "b", url: "", votes: 2456 },
      { id: "c", url: "", votes: 1876 },
    ],
    totalVotes: 7222,
  },
  {
    id: "img-7",
    personName: "Cristiano Ronaldo",
    personId: "6",
    category: "Sports",
    images: [
      { id: "a", url: "", votes: 8901 },
      { id: "b", url: "", votes: 7654 },
      { id: "c", url: "", votes: 5432 },
    ],
    totalVotes: 21987,
  },
  {
    id: "img-8",
    personName: "Drake",
    personId: "8",
    category: "Music",
    images: [
      { id: "a", url: "", votes: 3456 },
      { id: "b", url: "", votes: 2987 },
      { id: "c", url: "", votes: 2345 },
    ],
    totalVotes: 8788,
  },
];

interface SuggestedPerson {
  id: string;
  name: string;
  category: string;
  suggestedBy: number;
  upvotes: number;
  downvotes: number;
}

const suggestedPeople: SuggestedPerson[] = [
  { id: "s1", name: "Jensen Huang", category: "Tech", suggestedBy: 234, upvotes: 189, downvotes: 12 },
  { id: "s2", name: "Charli XCX", category: "Music", suggestedBy: 156, upvotes: 142, downvotes: 8 },
  { id: "s3", name: "Kai Cenat", category: "Entertainment", suggestedBy: 312, upvotes: 287, downvotes: 21 },
  { id: "s4", name: "Lionel Messi", category: "Sports", suggestedBy: 567, upvotes: 534, downvotes: 15 },
];

function StepCard({ step, icon: Icon, title, subtitle }: { step: number; icon: typeof CheckSquare; title: string; subtitle: string }) {
  return (
    <div className="flex-1 flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="text-xs text-muted-foreground mb-1">Step {step}</div>
      <h4 className="font-semibold text-sm mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function SentimentVoteRow({ person, onRowClick, isFeatured = false }: { person: Person; onRowClick: (person: Person) => void; isFeatured?: boolean }) {
  return (
    <Card 
      className={`p-3 hover-elevate transition-all cursor-pointer ${isFeatured ? 'border-primary/30 bg-primary/5' : ''}`} 
      onClick={() => onRowClick(person)}
      data-testid={`card-sentiment-${person.id}`}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={person.name} avatar={person.avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium truncate">{person.name}</h4>
            {isFeatured && (
              <Badge variant="secondary" className="text-xs">Featured</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{person.category}</p>
        </div>
        <Button 
          size="sm" 
          onClick={(e) => {
            e.stopPropagation();
            onRowClick(person);
          }}
          data-testid={`button-vote-${person.id}`}
        >
          <Heart className="h-4 w-4 mr-1" />
          Vote
        </Button>
      </div>
    </Card>
  );
}

function ImageVotingCardComponent({ card }: { card: ImageVotingCard }) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const handleVote = (imageId: string) => {
    setSelectedImage(imageId);
    console.log(`Voted for image ${imageId} for ${card.personName}`);
  };

  return (
    <Card className="p-4 hover-elevate transition-all" data-testid={`card-imagevote-${card.id}`}>
      <div className="flex items-center gap-3 mb-4">
        <PersonAvatar name={card.personName} avatar="" size="sm" />
        <div className="flex-1">
          <h4 className="font-medium">{card.personName}</h4>
          <p className="text-xs text-muted-foreground">{card.category} · {card.totalVotes.toLocaleString()} votes</p>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-2 mb-3">
        {card.images.map((img, i) => (
          <button
            key={img.id}
            onClick={() => handleVote(img.id)}
            className={`aspect-square rounded-lg bg-muted flex items-center justify-center border-2 transition-all ${
              selectedImage === img.id 
                ? 'border-primary ring-2 ring-primary/20' 
                : 'border-transparent hover:border-muted-foreground/30'
            }`}
            data-testid={`button-image-${card.id}-${img.id}`}
          >
            <div className="text-center">
              <ImageIcon className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
              <span className="text-xs text-muted-foreground">Option {i + 1}</span>
            </div>
          </button>
        ))}
      </div>
      
      <div className="flex justify-between text-xs text-muted-foreground">
        {card.images.map((img) => (
          <span key={img.id}>{((img.votes / card.totalVotes) * 100).toFixed(0)}%</span>
        ))}
      </div>
    </Card>
  );
}

function SuggestedPersonCard({ person }: { person: SuggestedPerson }) {
  const [votes, setVotes] = useState({ up: person.upvotes, down: person.downvotes });
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(null);

  const handleVote = (type: 'up' | 'down') => {
    if (userVote === type) {
      return;
    }
    if (userVote) {
      setVotes(prev => ({ ...prev, [userVote]: prev[userVote] - 1 }));
    }
    setUserVote(type);
    setVotes(prev => ({ ...prev, [type]: prev[type] + 1 }));
  };

  return (
    <Card className="p-4 hover-elevate transition-all" data-testid={`card-suggested-${person.id}`}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <UserPlus className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium truncate">{person.name}</h4>
          <p className="text-xs text-muted-foreground">{person.category} · Suggested by {person.suggestedBy}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={userVote === 'up' ? 'default' : 'outline'}
            onClick={() => handleVote('up')}
            className={`gap-1 ${userVote === 'up' ? 'bg-green-600 hover:bg-green-700 border-green-600' : 'text-green-600 border-green-600/50 hover:bg-green-600/10'}`}
            data-testid={`button-upvote-${person.id}`}
          >
            <ThumbsUp className="h-3 w-3" />
            {votes.up}
          </Button>
          <Button
            size="sm"
            variant={userVote === 'down' ? 'destructive' : 'outline'}
            onClick={() => handleVote('down')}
            className={`gap-1 ${userVote !== 'down' ? 'text-red-500 border-red-500/50 hover:bg-red-500/10' : ''}`}
            data-testid={`button-downvote-${person.id}`}
          >
            <ThumbsDown className="h-3 w-3" />
            {votes.down}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function VotePage() {
  const [, setLocation] = useLocation();
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [voteModalPerson, setVoteModalPerson] = useState<Person | null>(null);
  
  const [showAllSentiment, setShowAllSentiment] = useState(false);
  const [showAllImageVotes, setShowAllImageVotes] = useState(false);
  
  const DEFAULT_SENTIMENT_COUNT = 5;
  
  const displayedSentimentPeople = showAllSentiment 
    ? allSentimentPeople 
    : allSentimentPeople.slice(0, DEFAULT_SENTIMENT_COUNT);

  const handleRowClick = (person: Person) => {
    setVoteModalPerson(person);
  };

  const handleVisitProfile = () => {
    if (voteModalPerson) {
      setVoteModalPerson(null);
      setLocation(`/person/${voteModalPerson.id}`);
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
                <Button variant="ghost" size="sm">Home</Button>
              </Link>
              <Link href="/vote">
                <Button variant="ghost" size="sm" className="text-primary">Vote</Button>
              </Link>
              <Link href="/predict">
                <Button variant="ghost" size="sm">Predict</Button>
              </Link>
              <Link href="/me">
                <Button variant="ghost" size="sm">Me</Button>
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Heart className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-serif font-bold" data-testid="text-vote-title">
              Vote on Global Influence
            </h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Shape how the world sees its most influential people. Rate them, choose their profile image, and tell us who should appear on FameDex next.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <StepCard 
            step={1} 
            icon={Sliders} 
            title="Pick a vote type" 
            subtitle="Sentiment, profile images, or new people to add."
          />
          <StepCard 
            step={2} 
            icon={CheckSquare} 
            title="Cast your vote" 
            subtitle="Use sliders and Upvote / Downvote buttons."
          />
          <StepCard 
            step={3} 
            icon={Eye} 
            title="See your impact" 
            subtitle="Your choices will appear in your Me profile in a future version."
          />
        </div>

        <section className="mb-10" data-testid="section-sentiment-votes">
          <div className="mb-4">
            <h2 className="text-xl font-serif font-bold mb-1">Sentiment Votes</h2>
            <p className="text-sm text-muted-foreground">
              Rate how you feel about each person from 1 (Hate) to 10 (Love).
            </p>
          </div>
          
          <div className="space-y-2">
            {displayedSentimentPeople.map((person, index) => (
              <SentimentVoteRow 
                key={person.id} 
                person={person} 
                onRowClick={handleRowClick}
                isFeatured={index === 0}
              />
            ))}
          </div>
          
          {allSentimentPeople.length > DEFAULT_SENTIMENT_COUNT && (
            <button
              onClick={() => setShowAllSentiment(!showAllSentiment)}
              className="mt-4 text-sm text-primary hover:underline flex items-center gap-1"
              data-testid="button-view-all-sentiment"
            >
              {showAllSentiment ? 'Show less' : `View all ${allSentimentPeople.length} people to rate`}
              <ChevronRight className={`h-4 w-4 transition-transform ${showAllSentiment ? 'rotate-90' : ''}`} />
            </button>
          )}
        </section>

        <section className="mb-10" data-testid="section-image-voting">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-serif font-bold mb-1">Profile Image Voting</h2>
              <p className="text-sm text-muted-foreground">
                Help decide which image best represents each person on FameDex.
              </p>
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setImageModalOpen(true)}
              data-testid="button-add-image"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featuredImageVotingCards.map((card) => (
              <ImageVotingCardComponent key={card.id} card={card} />
            ))}
          </div>
          
          {showAllImageVotes && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {additionalImageVotingCards.map((card) => (
                <ImageVotingCardComponent key={card.id} card={card} />
              ))}
            </div>
          )}
          
          <button
            onClick={() => setShowAllImageVotes(!showAllImageVotes)}
            className="mt-4 text-sm text-primary hover:underline flex items-center gap-1"
            data-testid="button-view-all-images"
          >
            {showAllImageVotes ? 'Show less' : 'View all profile image votes'}
            <ChevronRight className={`h-4 w-4 transition-transform ${showAllImageVotes ? 'rotate-90' : ''}`} />
          </button>
        </section>

        <section className="mb-10" data-testid="section-suggest-people">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-serif font-bold mb-1">Suggest New People</h2>
              <p className="text-sm text-muted-foreground">
                Vote on who should be added to FameDex next.
              </p>
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setSuggestModalOpen(true)}
              data-testid="button-add-suggestion"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="space-y-2">
            {suggestedPeople.map((person) => (
              <SuggestedPersonCard key={person.id} person={person} />
            ))}
          </div>
        </section>

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            More voting opportunities coming soon. Your votes help shape the FameDex community.
          </p>
        </div>
      </div>

      <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggest Profile Images</DialogTitle>
            <DialogDescription>
              In a future version, you'll be able to suggest profile images for people on FameDex.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setImageModalOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={suggestModalOpen} onOpenChange={setSuggestModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggest a Person</DialogTitle>
            <DialogDescription>
              In a future version, you'll be able to suggest new people to add to FameDex.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSuggestModalOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!voteModalPerson} onOpenChange={(open) => !open && setVoteModalPerson(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {voteModalPerson && (
                <>
                  <PersonAvatar name={voteModalPerson.name} avatar={voteModalPerson.avatar} size="sm" />
                  <span>Rate {voteModalPerson.name}</span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {voteModalPerson && (
            <div className="space-y-4">
              <SentimentVotingWidget 
                personId={voteModalPerson.id} 
                personName={voteModalPerson.name}
                onVoteSubmitted={() => {
                  setTimeout(() => setVoteModalPerson(null), 1500);
                }}
              />
              <div className="flex justify-end pt-2 border-t">
                <button
                  onClick={handleVisitProfile}
                  className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                  data-testid="button-visit-profile"
                >
                  Visit full profile
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
