import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { 
  LayoutDashboard, 
  Users, 
  Gamepad2, 
  Gavel, 
  Settings, 
  RefreshCw,
  TrendingUp,
  Vote,
  Trophy,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Search,
  Ban,
  Coins,
  Play,
  Database,
  Camera,
  ChevronRight,
  Shield,
  Activity,
  Clock,
  UserCheck,
  ArrowUpDown,
  ThumbsUp,
  Plus,
  Edit,
  Trash2,
  Eye,
  MoreHorizontal,
  Loader2,
  MessageSquare,
  Star,
  Copy,
  Check,
  ArrowRight,
  X,
  CheckCircle,
  XCircle,
  BarChart3,
  Megaphone,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { TrendingPoll } from "@shared/schema";

type AdminSection = "overview" | "celebrities" | "predictions" | "voting" | "moderation" | "settlement" | "users" | "tools";

interface AdminStats {
  totalUsers: number;
  totalCelebrities: number;
  totalVotes: number;
  totalPredictions: number;
  lastDataRefresh: string | null;
}

interface TrafficStats {
  total: number;
  today: number;
  last7Days: number;
  last30Days: number;
  topPages: { path: string; views: number }[];
}

interface UserProfile {
  id: string;
  username: string | null;
  fullName: string | null;
  role: string;
  rank: string;
  xpPoints: number;
  predictCredits: number;
  totalVotes: number;
  totalPredictions: number;
  createdAt: string;
  isBanned?: boolean;
}

interface PredictionMarket {
  id: string;
  marketType: string;
  openMarketType: string | null;
  status: string;
  title: string;
  slug: string;
  teaser: string | null;
  summary: string | null;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  coverImageUrl: string | null;
  sourceUrl: string | null;
  featured: boolean | null;
  timezone: string | null;
  resolutionCriteria: string[] | null;
  resolutionSources: { label: string; url?: string }[] | null;
  resolutionNotes: string | null;
  resolveMethod: string | null;
  seedParticipants: number | null;
  seedVolume: string | null;
  underlying: string | null;
  metric: string | null;
  strike: string | null;
  unit: string | null;
  closeAt: string | null;
  endAt: string;
  startAt: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  settledBy: string | null;
  resolvedAt: string | null;
  voidReason: string | null;
  rules: string | null;
  metadata: any;
}

interface MarketEntryForm {
  label: string;
  description: string;
  seedCount: number;
}

interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  actionType: string;
  targetTable: string;
  targetId: string | null;
  previousData: any;
  newData: any;
  metadata: any;
  createdAt: string;
}

interface Celebrity {
  id: string;
  name: string;
  category: string;
  status: string;
  avatar: string | null;
  wikiSlug: string | null;
  xHandle: string | null;
  searchQueryOverride: string | null;
  displayOrder: number;
}

interface FaceOff {
  id: string;
  title: string;
  category: string;
  optionAText: string;
  optionAImage: string | null;
  optionBText: string;
  optionBImage: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
}

interface CommunityInsight {
  id: string;
  personId: string;
  userId: string;
  content: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
}

interface InsightComment {
  id: string;
  insightId: string;
  userId: string;
  content: string;
  createdAt: string;
}

interface ScoreBreakdownData {
  celebrity: {
    id: string;
    name: string;
    category: string;
    avatar: string | null;
  };
  snapshotTimestamp: string;
  rawInputs: {
    wikiPageviews: number;
    newsCount: number;
    searchVolume: number;
  };
  baselines: {
    wiki: number;
    news: number;
    search: number;
  };
  normalizedPercentiles: {
    wiki: number;
    news: number;
    search: number;
  };
  spikeStatus: {
    wiki: boolean;
    news: boolean;
    search: boolean;
  };
  stabilizationParams: {
    spikingSourceCount: number;
    effectiveRateCap: number;
    effectiveAlpha: number;
    isRecalibrationActive: boolean;
  };
  scoreBreakdown: {
    massScore: number;
    velocityScore: number;
    velocityAdjusted: number;
    diversityMultiplier: number;
    trendScore: number;
    fameIndex: number;
    momentum: string;
    drivers: string[];
  };
  weights: {
    mass: number;
    velocity: number;
    velocityBreakdown: {
      wiki: number;
      news: number;
      search: number;
      x: number;
    };
  };
  populationStats: {
    wiki: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
    news: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
    search: { min: number; max: number; p25: number; p50: number; p75: number; p90: number; mean: number; count: number };
  };
  historicalSnapshots: Array<{
    timestamp: string;
    fameIndex: number;
    trendScore: number;
    wikiPageviews: number;
    newsCount: number;
    searchVolume: number;
  }>;
  previousHourComparison: {
    previousFameIndex: number;
    rawFameIndexBeforeStabilization: number;
    currentFameIndex: number;
    rawChangePercent: number;
    finalChangePercent: number;
    wasRateLimited: boolean;
    previousRank: number;
    currentRank: number;
  } | null;
  sourceFreshness: {
    wiki: { lastUpdated: string; value: number; isStale: boolean };
    news: { lastUpdated: string; value: number; isStale: boolean };
    search: { lastUpdated: string; value: number; isStale: boolean };
  };
  currentRank: number;
}

// Helper function to get auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  const client = await supabase;
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };
}

// Fetch with auth helper
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
    credentials: "include",
  });
}

// Copy Debug Summary Button Component
function CopyDebugSummaryButton({ scoreBreakdown }: { scoreBreakdown: ScoreBreakdownData }) {
  const [copied, setCopied] = useState(false);
  
  const copyDebugSummary = () => {
    const prev = scoreBreakdown.previousHourComparison;
    const spikes = [
      scoreBreakdown.spikeStatus.wiki && "Wiki",
      scoreBreakdown.spikeStatus.news && "News",
      scoreBreakdown.spikeStatus.search && "Search"
    ].filter(Boolean).join("+") || "None";
    
    const rankChange = prev ? 
      (prev.previousRank !== prev.currentRank ? `#${prev.previousRank}→#${prev.currentRank}` : `#${prev.currentRank}`) : 
      `#${scoreBreakdown.currentRank}`;
    
    const changeStr = prev && prev.finalChangePercent !== 0 ? 
      `(${prev.finalChangePercent >= 0 ? "+" : ""}${prev.finalChangePercent.toFixed(1)}%)` : "";
    
    const summary = `${scoreBreakdown.celebrity.name} ${rankChange} | Fame: ${scoreBreakdown.scoreBreakdown.fameIndex.toLocaleString()} ${changeStr} | Spikes: ${spikes} (${scoreBreakdown.stabilizationParams.spikingSourceCount}) | Cap: ${(scoreBreakdown.stabilizationParams.effectiveRateCap * 100).toFixed(0)}% | Alpha: ${scoreBreakdown.stabilizationParams.effectiveAlpha.toFixed(2)}${scoreBreakdown.stabilizationParams.isRecalibrationActive ? " | RECAL" : ""}`;
    
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: create temporary textarea for copying
      const textarea = document.createElement('textarea');
      textarea.value = summary;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copyDebugSummary}
      className="h-7 text-xs gap-1"
      data-testid="button-copy-debug"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : "Copy Summary"}
    </Button>
  );
}

function CreateMarketModal({ open, onClose, onSubmit, isPending }: { 
  open: boolean; 
  onClose: () => void; 
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [openMarketType, setOpenMarketType] = useState<"binary" | "multi" | "updown">("binary");
  const [teaser, setTeaser] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("misc");
  const [endAt, setEndAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [featured, setFeatured] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resolveMethod, setResolveMethod] = useState("admin_manual");
  const [resolutionCriteria, setResolutionCriteria] = useState<string[]>([""]);
  const [underlying, setUnderlying] = useState("");
  const [metric, setMetric] = useState("");
  const [strike, setStrike] = useState("");
  const [unit, setUnit] = useState("$");
  const [entries, setEntries] = useState<MarketEntryForm[]>([
    { label: "Yes", description: "", seedCount: 0 },
    { label: "No", description: "", seedCount: 0 },
  ]);

  useEffect(() => {
    const generated = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    setSlug(generated);
  }, [title]);

  useEffect(() => {
    if (openMarketType === "binary") {
      setEntries([
        { label: "Yes", description: "", seedCount: 0 },
        { label: "No", description: "", seedCount: 0 },
      ]);
    } else if (openMarketType === "updown") {
      setEntries([
        { label: "Above", description: "", seedCount: 0 },
        { label: "Below", description: "", seedCount: 0 },
      ]);
    } else {
      setEntries([
        { label: "", description: "", seedCount: 0 },
        { label: "", description: "", seedCount: 0 },
        { label: "", description: "", seedCount: 0 },
      ]);
    }
  }, [openMarketType]);

  const addEntry = () => {
    if (entries.length < 20) {
      setEntries([...entries, { label: "", description: "", seedCount: 0 }]);
    }
  };

  const removeEntry = (idx: number) => {
    if (entries.length > 3) {
      setEntries(entries.filter((_, i) => i !== idx));
    }
  };

  const updateEntry = (idx: number, field: keyof MarketEntryForm, value: string | number) => {
    const updated = [...entries];
    (updated[idx] as any)[field] = value;
    setEntries(updated);
  };

  const canSubmit = () => {
    if (!title.trim() || !slug.trim() || !endAt) return false;
    if (openMarketType === "updown" && (!underlying.trim() || !strike.trim())) return false;
    if (openMarketType === "multi" && entries.some(e => !e.label.trim())) return false;
    return true;
  };

  const handleSubmit = () => {
    onSubmit({
      title,
      slug,
      openMarketType,
      teaser: teaser || undefined,
      summary: summary || undefined,
      category,
      endAt: new Date(endAt).toISOString(),
      closeAt: closeAt ? new Date(closeAt).toISOString() : undefined,
      featured,
      sourceUrl: sourceUrl || undefined,
      resolveMethod,
      resolutionCriteria: resolutionCriteria.filter(c => c.trim()),
      underlying: openMarketType === "updown" ? underlying : undefined,
      metric: openMarketType === "updown" ? metric : undefined,
      strike: openMarketType === "updown" ? strike : undefined,
      unit: openMarketType === "updown" ? unit : undefined,
      entries: entries.map((e, i) => ({
        label: e.label,
        description: e.description || undefined,
        displayOrder: i,
        seedCount: e.seedCount,
      })),
    });
  };

  const CATEGORIES = [
    { value: "politics", label: "Politics" },
    { value: "tech", label: "Tech" },
    { value: "entertainment", label: "Entertainment" },
    { value: "sports", label: "Sports" },
    { value: "business", label: "Business" },
    { value: "creator", label: "Creator" },
    { value: "misc", label: "Misc" },
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Real-World Market</DialogTitle>
          <DialogDescription>Create a new prediction market for real-world events</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label>Market Type</Label>
            <Select value={openMarketType} onValueChange={(v) => setOpenMarketType(v as any)}>
              <SelectTrigger data-testid="select-market-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="binary">Binary (Yes / No)</SelectItem>
                <SelectItem value="multi">Multi-Option (3-20 choices)</SelectItem>
                <SelectItem value="updown">Up/Down (Above / Below strike)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label>Title / Question</Label>
              <Input 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                placeholder="Will Bitcoin reach $100k by end of 2026?"
                data-testid="input-market-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input 
                value={slug} 
                onChange={(e) => setSlug(e.target.value)} 
                placeholder="bitcoin-100k-2026"
                data-testid="input-market-slug"
              />
              <p className="text-xs text-muted-foreground">/markets/{slug}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Teaser (short tagline for card)</Label>
            <Input 
              value={teaser} 
              onChange={(e) => setTeaser(e.target.value)} 
              placeholder="Bitcoin nears all-time high..."
              data-testid="input-market-teaser"
            />
          </div>
          <div className="space-y-2">
            <Label>Summary</Label>
            <Textarea 
              value={summary} 
              onChange={(e) => setSummary(e.target.value)} 
              placeholder="Additional context about this market..."
              className="resize-none"
              data-testid="input-market-summary"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-market-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Featured</Label>
              <div className="flex items-center gap-2 h-9">
                <Switch checked={featured} onCheckedChange={setFeatured} data-testid="switch-market-featured" />
                <span className="text-sm text-muted-foreground">{featured ? "Yes" : "No"}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Resolution Date</Label>
              <Input 
                type="datetime-local" 
                value={endAt} 
                onChange={(e) => setEndAt(e.target.value)} 
                data-testid="input-market-end-at"
              />
            </div>
            <div className="space-y-2">
              <Label>Betting Closes (optional)</Label>
              <Input 
                type="datetime-local" 
                value={closeAt} 
                onChange={(e) => setCloseAt(e.target.value)} 
                data-testid="input-market-close-at"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Source URL (optional)</Label>
            <Input 
              value={sourceUrl} 
              onChange={(e) => setSourceUrl(e.target.value)} 
              placeholder="https://..."
              data-testid="input-market-source-url"
            />
          </div>

          <div className="space-y-2">
            <Label>Resolution Method</Label>
            <Select value={resolveMethod} onValueChange={setResolveMethod}>
              <SelectTrigger data-testid="select-resolve-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin_manual">Admin Manual</SelectItem>
                <SelectItem value="oracle">Oracle / External</SelectItem>
                <SelectItem value="api">API Automated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Resolution Criteria</Label>
            {resolutionCriteria.map((criterion, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input 
                  value={criterion}
                  onChange={(e) => {
                    const updated = [...resolutionCriteria];
                    updated[idx] = e.target.value;
                    setResolutionCriteria(updated);
                  }}
                  placeholder={`Criterion ${idx + 1}`}
                  data-testid={`input-criterion-${idx}`}
                />
                {resolutionCriteria.length > 1 && (
                  <Button 
                    variant="ghost" 
                    size="icon"
                    onClick={() => setResolutionCriteria(resolutionCriteria.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setResolutionCriteria([...resolutionCriteria, ""])}
              data-testid="button-add-criterion"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Criterion
            </Button>
          </div>

          {openMarketType === "updown" && (
            <div className="space-y-4 p-4 rounded-lg border border-violet-500/20 bg-violet-500/5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-violet-500" />
                Strike Configuration
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Underlying Asset</Label>
                  <Input 
                    value={underlying} 
                    onChange={(e) => setUnderlying(e.target.value)} 
                    placeholder="Bitcoin"
                    data-testid="input-underlying"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Metric</Label>
                  <Input 
                    value={metric} 
                    onChange={(e) => setMetric(e.target.value)} 
                    placeholder="price"
                    data-testid="input-metric"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Strike Value</Label>
                  <Input 
                    type="number"
                    value={strike} 
                    onChange={(e) => setStrike(e.target.value)} 
                    placeholder="100000"
                    data-testid="input-strike"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input 
                    value={unit} 
                    onChange={(e) => setUnit(e.target.value)} 
                    placeholder="$"
                    data-testid="input-unit"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Outcomes</Label>
              {openMarketType === "multi" && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={addEntry}
                  disabled={entries.length >= 20}
                  data-testid="button-add-entry"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Option
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {openMarketType === "binary" ? "Binary markets always have exactly 2 outcomes (Yes/No)." :
               openMarketType === "updown" ? "Up/Down markets always have exactly 2 outcomes (Above/Below)." :
               `Multi-option: ${entries.length} of 3-20 outcomes.`}
            </p>
            {entries.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2 p-3 rounded-lg border">
                <div className="flex-1 space-y-2">
                  <Input
                    value={entry.label}
                    onChange={(e) => updateEntry(idx, "label", e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                    disabled={openMarketType === "binary" || openMarketType === "updown"}
                    data-testid={`input-entry-label-${idx}`}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Input
                    type="number"
                    value={entry.seedCount}
                    onChange={(e) => updateEntry(idx, "seedCount", parseInt(e.target.value) || 0)}
                    placeholder="Seed"
                    data-testid={`input-entry-seed-${idx}`}
                  />
                  <p className="text-[10px] text-muted-foreground text-center">seed</p>
                </div>
                {openMarketType === "multi" && entries.length > 3 && (
                  <Button variant="ghost" size="icon" onClick={() => removeEntry(idx)} data-testid={`button-remove-entry-${idx}`}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={handleSubmit} 
            disabled={!canSubmit() || isPending}
            data-testid="button-submit-market"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Create Market
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettleMarketModal({ market, entries, open, onClose, onSettle, isPending }: {
  market: PredictionMarket | null;
  entries: { id: string; label: string; totalStake: number }[];
  open: boolean;
  onClose: () => void;
  onSettle: (winnerEntryId: string, notes: string) => void;
  isPending: boolean;
}) {
  const [winnerId, setWinnerId] = useState("");
  const [notes, setNotes] = useState("");

  if (!market) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settle Market</DialogTitle>
          <DialogDescription>Select the winning outcome for: {market.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Winning Outcome</Label>
            {entries.map(entry => (
              <div 
                key={entry.id}
                className={cn(
                  "flex items-center justify-between gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                  winnerId === entry.id ? "border-green-500 bg-green-500/10" : "hover-elevate"
                )}
                onClick={() => setWinnerId(entry.id)}
                data-testid={`settle-entry-${entry.id}`}
              >
                <span className="font-medium">{entry.label}</span>
                <Badge variant="outline">{entry.totalStake} staked</Badge>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Resolution Notes (optional)</Label>
            <Textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
              placeholder="Why was this outcome selected?"
              className="resize-none"
              data-testid="input-settle-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            onClick={() => onSettle(winnerId, notes)}
            disabled={!winnerId || isPending}
            data-testid="button-confirm-settle"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Settle Market
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAdmin, profileLoading, profile } = useAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [celebritySearch, setCelebritySearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [creditAdjustment, setCreditAdjustment] = useState({ amount: 0, reason: "" });
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  
  const [showCelebrityModal, setShowCelebrityModal] = useState(false);
  const [editingCelebrity, setEditingCelebrity] = useState<Celebrity | null>(null);
  const [celebrityForm, setCelebrityForm] = useState({
    name: "",
    category: "Tech",
    status: "main_leaderboard",
    wikiSlug: "",
    xHandle: "",
    searchQueryOverride: "",
  });
  
  const [showFaceOffModal, setShowFaceOffModal] = useState(false);
  const [editingFaceOff, setEditingFaceOff] = useState<FaceOff | null>(null);
  const [faceOffForm, setFaceOffForm] = useState({
    title: "",
    category: "Tech",
    optionAText: "",
    optionBText: "",
    isActive: true,
  });
  
  const [showPollModal, setShowPollModal] = useState(false);
  const [editingPoll, setEditingPoll] = useState<TrendingPoll | null>(null);
  const [pollFilter, setPollFilter] = useState<string>("all");
  const [pollCategoryFilter, setPollCategoryFilter] = useState<string>("all");
  const [pollForm, setPollForm] = useState({
    status: "draft" as "draft" | "live" | "archived",
    category: "Tech",
    headline: "",
    subjectText: "",
    personId: "",
    description: "",
    timeline: "",
    deadlineAt: "",
    imageUrl: "",
    seedSupportCount: 0,
    seedNeutralCount: 0,
    seedOpposeCount: 0,
  });
  
  const [celebritySearchInput, setCelebritySearchInput] = useState("");
  const [celebritySearchResults, setCelebritySearchResults] = useState<Celebrity[]>([]);
  const [showCelebrityDropdown, setShowCelebrityDropdown] = useState(false);
  const [selectedCelebrityName, setSelectedCelebrityName] = useState("");
  const celebritySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);
  
  // Score Breakdown Modal state
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [scoreBreakdownCelebrity, setScoreBreakdownCelebrity] = useState<string | null>(null);

  // Entity Diagnostic state
  const [entityDiagResults, setEntityDiagResults] = useState<any[] | null>(null);
  const [entityDiagLoading, setEntityDiagLoading] = useState(false);
  const [entityDiagFilter, setEntityDiagFilter] = useState<string>("all");

  const [createMarketOpen, setCreateMarketOpen] = useState(false);
  const [editMarketId, setEditMarketId] = useState<string | null>(null);
  const [settleMarketId, setSettleMarketId] = useState<string | null>(null);
  const [voidMarketId, setVoidMarketId] = useState<string | null>(null);

  // ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS (React rules of hooks)
  
  // Fetch admin stats - only when user is admin
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/stats");
      if (!res.ok) throw new Error("Failed to fetch admin stats");
      return res.json();
    },
    retry: false,
    enabled: isAdmin,
  });

  // Fetch users for moderation - only when admin and on users section
  const { data: users, isLoading: usersLoading } = useQuery<UserProfile[]>({
    queryKey: ["/api/admin/users", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      const url = `/api/admin/users${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: isAdmin && activeSection === "users",
  });

  // Fetch prediction markets - only when admin and on relevant sections
  const { data: markets, isLoading: marketsLoading } = useQuery<PredictionMarket[]>({
    queryKey: ["/api/admin/markets"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/markets");
      if (!res.ok) throw new Error("Failed to fetch markets");
      return res.json();
    },
    enabled: isAdmin && (activeSection === "predictions" || activeSection === "settlement"),
  });

  // Fetch traffic stats - only when admin and on overview section
  const { data: trafficStats, isLoading: trafficLoading, refetch: refetchTraffic } = useQuery<TrafficStats>({
    queryKey: ["/api/admin/traffic"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/traffic");
      if (!res.ok) throw new Error("Failed to fetch traffic stats");
      return res.json();
    },
    enabled: isAdmin && activeSection === "overview",
  });

  // Fetch audit logs - only when admin and on overview section
  const { data: auditLogs, isLoading: auditLogsLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/admin/audit-log"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/audit-log");
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
    enabled: isAdmin && activeSection === "overview",
  });

  // Fetch celebrities - only when admin and on celebrities section
  const { data: celebrities, isLoading: celebritiesLoading } = useQuery<Celebrity[]>({
    queryKey: ["/api/admin/celebrities"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/celebrities");
      if (!res.ok) throw new Error("Failed to fetch celebrities");
      return res.json();
    },
    enabled: isAdmin && activeSection === "celebrities",
  });

  // Fetch score breakdown for a celebrity
  const { data: scoreBreakdown, isLoading: scoreBreakdownLoading } = useQuery<ScoreBreakdownData>({
    queryKey: ["/api/admin/celebrities", scoreBreakdownCelebrity, "score-breakdown"],
    queryFn: async () => {
      if (!scoreBreakdownCelebrity) throw new Error("No celebrity selected");
      const res = await fetchWithAuth(`/api/admin/celebrities/${scoreBreakdownCelebrity}/score-breakdown`);
      if (!res.ok) throw new Error("Failed to fetch score breakdown");
      return res.json();
    },
    enabled: isAdmin && showScoreBreakdown && !!scoreBreakdownCelebrity,
  });

  // Fetch face-offs - only when admin and on cms section
  const { data: faceOffs, isLoading: faceOffsLoading } = useQuery<FaceOff[]>({
    queryKey: ["/api/admin/face-offs"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/face-offs");
      if (!res.ok) throw new Error("Failed to fetch face-offs");
      return res.json();
    },
    enabled: isAdmin && activeSection === "voting",
  });

  const { data: trendingPollsList, isLoading: pollsLoading } = useQuery<TrendingPoll[]>({
    queryKey: ["/api/admin/trending-polls"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/trending-polls");
      if (!res.ok) throw new Error("Failed to fetch trending polls");
      return res.json();
    },
    enabled: isAdmin && activeSection === "voting",
  });

  // Fetch insights for moderation
  const { data: moderationInsights, isLoading: insightsLoading } = useQuery<CommunityInsight[]>({
    queryKey: ["/api/admin/moderation/insights"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/moderation/insights");
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json();
    },
    enabled: isAdmin && activeSection === "moderation",
  });

  // Fetch comments for moderation
  const { data: moderationComments, isLoading: commentsLoading } = useQuery<InsightComment[]>({
    queryKey: ["/api/admin/moderation/comments"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/moderation/comments");
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: isAdmin && activeSection === "moderation",
  });

  // Fetch engine health diagnostics - only on tools section
  const { data: engineHealth, isLoading: engineHealthLoading, refetch: refetchEngineHealth } = useQuery<any>({
    queryKey: ["/api/admin/engine-health"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/engine-health");
      if (!res.ok) throw new Error("Failed to fetch engine health");
      return res.json();
    },
    enabled: isAdmin && activeSection === "tools",
    refetchInterval: 60000,
  });

  const settleMarket = settleMarketId ? markets?.find(m => m.id === settleMarketId) : null;
  const { data: settleMarketDetail } = useQuery<{ entries: { id: string; label: string; totalStake: number }[] }>({
    queryKey: ["/api/open-markets", settleMarket?.slug],
    queryFn: async () => {
      if (!settleMarket?.slug) return { entries: [] };
      const res = await fetch(`/api/open-markets/${settleMarket.slug}`);
      if (!res.ok) return { entries: [] };
      return res.json();
    },
    enabled: !!settleMarket?.slug,
  });

  const createMarketMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetchWithAuth("/api/admin/open-markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create market");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setCreateMarketOpen(false);
      toast({ title: "Market Created", description: "Real-world market created successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const settleMarketMutation = useMutation({
    mutationFn: async ({ id, winnerEntryId, resolutionNotes }: { id: string; winnerEntryId: string; resolutionNotes?: string }) => {
      const res = await fetchWithAuth(`/api/admin/open-markets/${id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerEntryId, resolutionNotes }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to settle market");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setSettleMarketId(null);
      toast({ title: "Market Settled", description: "Market has been resolved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const voidMarketMutation = useMutation({
    mutationFn: async ({ id, voidReason }: { id: string; voidReason: string }) => {
      const res = await fetchWithAuth(`/api/admin/open-markets/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voidReason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to void market");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setVoidMarketId(null);
      toast({ title: "Market Voided", description: "Market has been voided." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // System tool mutations
  const refreshDataMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/refresh-data", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh data");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Data Refreshed",
        description: `Processed ${data.processed} celebrities in ${data.duration}ms`,
      });
      refetchStats();
    },
    onError: (error: any) => {
      toast({
        title: "Refresh Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const runScoringMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/run-scoring", { method: "POST" });
      if (!res.ok) throw new Error("Failed to run scoring");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Scoring Complete",
        description: `Updated rankings for ${data.processed} celebrities`,
      });
      refetchStats();
    },
    onError: (error: any) => {
      toast({
        title: "Scoring Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const captureSnapshotsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/capture-snapshots", { method: "POST" });
      if (!res.ok) throw new Error("Failed to capture snapshots");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Snapshots Captured",
        description: `Captured ${data.captured} trend snapshots`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Snapshot Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Seed approval data mutation
  const seedApprovalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/seed-approval", { method: "POST" });
      if (!res.ok) throw new Error("Failed to seed approval data");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Approval Data Seeded",
        description: `Seeded ${data.seeded} celebrities, skipped ${data.skipped}`,
      });
      refetchStats();
    },
    onError: (error: any) => {
      toast({
        title: "Seeding Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Credit adjustment mutation
  const adjustCreditsMutation = useMutation({
    mutationFn: async (params: { userId: string; amount: number; reason: string }) => {
      const res = await fetchWithAuth("/api/admin/adjust-credits", { 
        method: "POST", 
        body: JSON.stringify(params) 
      });
      if (!res.ok) throw new Error("Failed to adjust credits");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Credits Adjusted",
        description: `Successfully adjusted credits for user`,
      });
      setShowCreditModal(false);
      setSelectedUser(null);
      setCreditAdjustment({ amount: 0, reason: "" });
      setConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Adjustment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Ban user mutation
  const banUserMutation = useMutation({
    mutationFn: async (params: { userId: string; reason: string }) => {
      const res = await fetchWithAuth("/api/admin/ban-user", { 
        method: "POST", 
        body: JSON.stringify(params) 
      });
      if (!res.ok) throw new Error("Failed to ban user");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "User Banned",
        description: "User has been banned from the platform",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Ban Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Celebrity mutations
  const createCelebrityMutation = useMutation({
    mutationFn: async (data: typeof celebrityForm) => {
      const res = await fetchWithAuth("/api/admin/celebrities", { 
        method: "POST", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to create celebrity");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Celebrity Created", description: "New celebrity added successfully" });
      setShowCelebrityModal(false);
      setEditingCelebrity(null);
      setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "", searchQueryOverride: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
    },
    onError: (error: any) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const updateCelebrityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof celebrityForm }) => {
      const res = await fetchWithAuth(`/api/admin/celebrities/${id}`, { 
        method: "PATCH", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to update celebrity");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Celebrity Updated", description: "Celebrity updated successfully" });
      setShowCelebrityModal(false);
      setEditingCelebrity(null);
      setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "", searchQueryOverride: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteCelebrityMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/celebrities/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete celebrity");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Celebrity Deleted", description: "Celebrity removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  // Face-Off mutations
  const createFaceOffMutation = useMutation({
    mutationFn: async (data: typeof faceOffForm) => {
      const res = await fetchWithAuth("/api/admin/face-offs", { 
        method: "POST", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to create face-off");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Face-Off Created", description: "New face-off added successfully" });
      setShowFaceOffModal(false);
      setEditingFaceOff(null);
      setFaceOffForm({ title: "", category: "Tech", optionAText: "", optionBText: "", isActive: true });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/face-offs"] });
    },
    onError: (error: any) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const updateFaceOffMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof faceOffForm }) => {
      const res = await fetchWithAuth(`/api/admin/face-offs/${id}`, { 
        method: "PATCH", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to update face-off");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Face-Off Updated", description: "Face-off updated successfully" });
      setShowFaceOffModal(false);
      setEditingFaceOff(null);
      setFaceOffForm({ title: "", category: "Tech", optionAText: "", optionBText: "", isActive: true });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/face-offs"] });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteFaceOffMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/face-offs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete face-off");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Face-Off Deleted", description: "Face-off removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/face-offs"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const createPollMutation = useMutation({
    mutationFn: async (data: typeof pollForm) => {
      const cleanData = {
        ...data,
        personId: data.personId || null,
        timeline: data.timeline || null,
        deadlineAt: data.deadlineAt || null,
        imageUrl: data.imageUrl || null,
        description: data.description || null,
      };
      const res = await fetchWithAuth("/api/admin/trending-polls", {
        method: "POST",
        body: JSON.stringify(cleanData),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Create poll error:", res.status, errBody);
        throw new Error(errBody.error || errBody.details || `Server error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Poll Created", description: "New trending poll added successfully" });
      setShowPollModal(false);
      setEditingPoll(null);
      resetPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast({ title: "Create Failed", description: error.message, variant: "destructive" });
    },
  });

  const updatePollMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const cleanData = {
        ...data,
        personId: data.personId || null,
        timeline: data.timeline || null,
        deadlineAt: data.deadlineAt || null,
        imageUrl: data.imageUrl || null,
        description: data.description || null,
      };
      const res = await fetchWithAuth(`/api/admin/trending-polls/${id}`, {
        method: "PATCH",
        body: JSON.stringify(cleanData),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Update poll error:", res.status, errBody);
        throw new Error(errBody.error || errBody.details || `Server error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Poll Updated", description: "Trending poll updated successfully" });
      setShowPollModal(false);
      setEditingPoll(null);
      resetPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    },
  });

  const deletePollMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/trending-polls/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete poll");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Poll Deleted", description: "Trending poll removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  // Moderation mutations
  const deleteInsightMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/moderation/insights/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete insight");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Insight Deleted", description: "Insight removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/insights"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/moderation/comments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete comment");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Comment Deleted", description: "Comment removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/comments"] });
    },
    onError: (error: any) => {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    },
  });

  const runEntityDiagnostics = useCallback(async (personIds?: string[]) => {
    setEntityDiagLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/diagnostics/entity-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds }),
      });
      if (!res.ok) throw new Error("Failed to run diagnostics");
      const data = await res.json();
      setEntityDiagResults(data.results);
      toast({
        title: "Entity Diagnostics Complete",
        description: `Analyzed ${data.total} celebrities`,
      });
    } catch (error: any) {
      toast({
        title: "Diagnostics Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setEntityDiagLoading(false);
    }
  }, [toast]);

  const searchCelebrities = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setCelebritySearchResults([]);
      setShowCelebrityDropdown(false);
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/admin/celebrities?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const results = await res.json();
        setCelebritySearchResults(results.slice(0, 10));
        setShowCelebrityDropdown(true);
      }
    } catch (e) {
      console.error("Celebrity search failed:", e);
    }
  }, []);

  // ============ CONDITIONAL RENDERING (after all hooks) ============
  
  // Show loading while auth is initializing
  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Checking admin access...</p>
        </div>
      </div>
    );
  }

  // If user is not logged in, prompt them to sign in
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign In Required</h2>
          <p className="text-muted-foreground mb-4">
            Please sign in to access the admin panel.
          </p>
          <Button onClick={() => setLocation("/")} data-testid="button-go-home">
            Go to Homepage
          </Button>
        </Card>
      </div>
    );
  }

  // User is logged in but profile hasn't loaded yet
  if (profile === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  // Check if user is admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            You do not have permission to access the admin panel.
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Debug: Role = "{profile?.role}" | Expected = "admin"
          </p>
          <Button onClick={() => setLocation("/")} data-testid="button-go-home">
            Go to Homepage
          </Button>
        </Card>
      </div>
    );
  }

  // ============ ADMIN DASHBOARD UI ============

  const sidebarItems = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "celebrities" as const, label: "Celebrities", icon: Star },
    { id: "predictions" as const, label: "Prediction CMS", icon: BarChart3 },
    { id: "voting" as const, label: "Voting CMS", icon: Megaphone },
    { id: "moderation" as const, label: "Moderation", icon: Shield },
    { id: "settlement" as const, label: "Settlement", icon: Gavel },
    { id: "users" as const, label: "Users", icon: Users },
    { id: "tools" as const, label: "System Tools", icon: Settings },
  ];

  const handleCreditAdjustment = () => {
    if (!selectedUser || confirmText !== "ADJUST") return;
    adjustCreditsMutation.mutate({
      userId: selectedUser.id,
      amount: creditAdjustment.amount,
      reason: creditAdjustment.reason,
    });
  };

  const openEditCelebrity = (celebrity: Celebrity) => {
    setEditingCelebrity(celebrity);
    setCelebrityForm({
      name: celebrity.name,
      category: celebrity.category,
      status: celebrity.status,
      wikiSlug: celebrity.wikiSlug || "",
      xHandle: celebrity.xHandle || "",
      searchQueryOverride: celebrity.searchQueryOverride || "",
    });
    setShowCelebrityModal(true);
  };

  const openEditFaceOff = (faceOff: FaceOff) => {
    setEditingFaceOff(faceOff);
    setFaceOffForm({
      title: faceOff.title,
      category: faceOff.category,
      optionAText: faceOff.optionAText,
      optionBText: faceOff.optionBText,
      isActive: faceOff.isActive,
    });
    setShowFaceOffModal(true);
  };

  const handleSaveCelebrity = () => {
    if (editingCelebrity) {
      updateCelebrityMutation.mutate({ id: editingCelebrity.id, data: celebrityForm });
    } else {
      createCelebrityMutation.mutate(celebrityForm);
    }
  };

  const handleSaveFaceOff = () => {
    if (editingFaceOff) {
      updateFaceOffMutation.mutate({ id: editingFaceOff.id, data: faceOffForm });
    } else {
      createFaceOffMutation.mutate(faceOffForm);
    }
  };

  const resetPollForm = () => {
    setPollForm({
      status: "draft",
      category: "Tech",
      headline: "",
      subjectText: "",
      personId: "",
      description: "",
      timeline: "",
      deadlineAt: "",
      imageUrl: "",
      seedSupportCount: 0,
      seedNeutralCount: 0,
      seedOpposeCount: 0,
    });
    setCelebritySearchInput("");
    setSelectedCelebrityName("");
    setCelebritySearchResults([]);
    setShowCelebrityDropdown(false);
  };

  const handleCelebritySearchChange = (value: string) => {
    setCelebritySearchInput(value);
    if (!value) {
      setPollForm(prev => ({ ...prev, personId: "" }));
      setSelectedCelebrityName("");
      setCelebritySearchResults([]);
      setShowCelebrityDropdown(false);
      return;
    }
    if (celebritySearchTimer.current) clearTimeout(celebritySearchTimer.current);
    celebritySearchTimer.current = setTimeout(() => searchCelebrities(value), 300);
  };

  const selectCelebrity = (celeb: Celebrity) => {
    setPollForm(prev => ({ ...prev, personId: celeb.id }));
    setSelectedCelebrityName(celeb.name);
    setCelebritySearchInput(celeb.name);
    setShowCelebrityDropdown(false);
    setCelebritySearchResults([]);
  };

  const clearCelebrity = () => {
    setPollForm(prev => ({ ...prev, personId: "" }));
    setSelectedCelebrityName("");
    setCelebritySearchInput("");
    setShowCelebrityDropdown(false);
    setCelebritySearchResults([]);
  };

  const openEditPoll = (poll: TrendingPoll) => {
    setEditingPoll(poll);
    setPollForm({
      status: poll.status as "draft" | "live" | "archived",
      category: poll.category,
      headline: poll.headline,
      subjectText: poll.subjectText,
      personId: poll.personId || "",
      description: poll.description || "",
      timeline: poll.timeline || "",
      deadlineAt: poll.deadlineAt ? new Date(poll.deadlineAt).toISOString().slice(0, 16) : "",
      imageUrl: poll.imageUrl || "",
      seedSupportCount: poll.seedSupportCount,
      seedNeutralCount: poll.seedNeutralCount,
      seedOpposeCount: poll.seedOpposeCount,
    });
    if (poll.personId) {
      const pid = poll.personId;
      setCelebritySearchInput("Loading...");
      setSelectedCelebrityName("Loading...");
      fetchWithAuth(`/api/admin/celebrities?search=`).then(r => r.ok ? r.json() : []).then((celebs: Celebrity[]) => {
        const found = celebs.find(c => c.id === pid);
        if (found) {
          setCelebritySearchInput(found.name);
          setSelectedCelebrityName(found.name);
        } else {
          setCelebritySearchInput(pid.slice(0, 8) + "...");
          setSelectedCelebrityName(pid.slice(0, 8) + "...");
        }
      }).catch(() => {
        setCelebritySearchInput(pid.slice(0, 8) + "...");
        setSelectedCelebrityName(pid.slice(0, 8) + "...");
      });
    } else {
      setCelebritySearchInput("");
      setSelectedCelebrityName("");
    }
    setShowPollModal(true);
  };

  const handleSavePoll = () => {
    if (editingPoll) {
      updatePollMutation.mutate({ id: editingPoll.id, data: pollForm });
    } else {
      createPollMutation.mutate(pollForm);
    }
  };

  const filteredPolls = trendingPollsList?.filter((poll) => {
    if (pollFilter === "missing_image") {
      return poll.status === "draft" && !poll.personId && !poll.imageUrl;
    }
    if (pollFilter !== "all" && poll.status !== pollFilter) return false;
    if (pollCategoryFilter !== "all" && poll.category !== pollCategoryFilter) return false;
    return true;
  });

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "celebrity") {
      deleteCelebrityMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "faceoff") {
      deleteFaceOffMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "insight") {
      deleteInsightMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "comment") {
      deleteCommentMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "poll") {
      deletePollMutation.mutate(deleteTarget.id);
    }
  };

  const filteredCelebrities = celebrities?.filter(c => 
    celebritySearch === "" || 
    c.name.toLowerCase().includes(celebritySearch.toLowerCase()) ||
    c.category.toLowerCase().includes(celebritySearch.toLowerCase())
  );

  const getActionBadgeColor = (actionType: string) => {
    if (actionType.startsWith("CREATE")) return "bg-emerald-500/20 text-emerald-400";
    if (actionType.startsWith("UPDATE")) return "bg-amber-500/20 text-amber-400";
    if (actionType.startsWith("DELETE")) return "bg-red-500/20 text-red-400";
    return "bg-violet-500/20 text-violet-400";
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 p-4 hidden md:block">
        <div className="flex items-center gap-2 mb-8 px-2">
          <Shield className="h-6 w-6 text-violet-500" />
          <h1 className="text-xl font-bold">Admin Panel</h1>
        </div>
        
        <nav className="space-y-1">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              data-testid={`nav-${item.id}`}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeSection === item.id
                  ? "bg-violet-500/20 text-violet-300 border border-violet-400/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-4 left-4 right-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-site"
          >
            Back to Site
          </Button>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border p-2 z-50">
        <div className="flex justify-around">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-lg text-xs",
                activeSection === item.id
                  ? "text-violet-400"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 p-6 pb-24 md:pb-6 overflow-auto">
        {/* Overview Section */}
        {activeSection === "overview" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Dashboard Overview</h2>
                <p className="text-muted-foreground">Platform analytics and key metrics</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { refetchStats(); refetchTraffic(); }}
                data-testid="button-refresh-stats"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="stat-total-users">
                    {statsLoading ? "..." : stats?.totalUsers || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Registered accounts</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Celebrities</CardTitle>
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="stat-celebrities">
                    {statsLoading ? "..." : stats?.totalCelebrities || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Tracked individuals</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total Votes</CardTitle>
                  <Vote className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="stat-total-votes">
                    {statsLoading ? "..." : stats?.totalVotes || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">All vote types</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Predictions</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="stat-predictions">
                    {statsLoading ? "..." : stats?.totalPredictions || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Active stakes</p>
                </CardContent>
              </Card>
            </div>

            {/* Traffic Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Website Traffic
                </CardTitle>
                <CardDescription>Page views and visitor analytics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-cyan-400" data-testid="stat-traffic-today">
                      {trafficLoading ? "..." : trafficStats?.today || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Today</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-violet-400" data-testid="stat-traffic-week">
                      {trafficLoading ? "..." : trafficStats?.last7Days || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Last 7 Days</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-emerald-400" data-testid="stat-traffic-month">
                      {trafficLoading ? "..." : trafficStats?.last30Days || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Last 30 Days</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-amber-400" data-testid="stat-traffic-total">
                      {trafficLoading ? "..." : trafficStats?.total || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">All Time</p>
                  </div>
                </div>
                
                {trafficStats?.topPages && trafficStats.topPages.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h4 className="text-sm font-medium mb-2">Top Pages (7 days)</h4>
                    <div className="space-y-2">
                      {trafficStats.topPages.map((page, i) => (
                        <div key={page.path} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[200px]">
                            {page.path === "/" ? "Homepage" : page.path}
                          </span>
                          <Badge variant="secondary">{page.views} views</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common administrative tasks</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => setActiveSection("tools")}
                  data-testid="quick-action-tools"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  System Tools
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setActiveSection("users")}
                  data-testid="quick-action-users"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Manage Users
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setActiveSection("predictions")}
                  data-testid="quick-action-predictions"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Prediction CMS
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setActiveSection("voting")}
                  data-testid="quick-action-voting"
                >
                  <Megaphone className="h-4 w-4 mr-2" />
                  Voting CMS
                </Button>
              </CardContent>
            </Card>

            {/* Audit Log Viewer */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Admin Activity</CardTitle>
                <CardDescription>Latest actions from admin audit log</CardDescription>
              </CardHeader>
              <CardContent>
                {auditLogsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : auditLogs && auditLogs.length > 0 ? (
                  <div className="space-y-3" data-testid="audit-log-list">
                    {auditLogs.slice(0, 10).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`audit-log-${log.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <Badge className={cn("text-xs", getActionBadgeColor(log.actionType))}>
                            {log.actionType}
                          </Badge>
                          <div>
                            <p className="text-sm font-medium">{log.targetTable}</p>
                            <p className="text-xs text-muted-foreground">
                              Admin: {log.adminEmail || log.adminId}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No audit log entries yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Celebrities Section */}
        {activeSection === "celebrities" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Celebrities</h2>
                <p className="text-muted-foreground">Manage tracked celebrities and influencers</p>
              </div>
              <Button 
                onClick={() => {
                  setEditingCelebrity(null);
                  setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "", searchQueryOverride: "" });
                  setShowCelebrityModal(true);
                }}
                data-testid="button-add-celebrity"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Celebrity
              </Button>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or category..."
                  value={celebritySearch}
                  onChange={(e) => setCelebritySearch(e.target.value)}
                  className="pl-10"
                  data-testid="input-celebrity-search"
                />
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Celebrity List</CardTitle>
                <CardDescription>
                  {filteredCelebrities ? `${filteredCelebrities.length} celebrities found` : "Loading..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {celebritiesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredCelebrities && filteredCelebrities.length > 0 ? (
                  <div className="space-y-3" data-testid="celebrity-list">
                    {filteredCelebrities.map((celebrity) => (
                      <div
                        key={celebrity.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`celebrity-row-${celebrity.id}`}
                      >
                        <div className="flex items-center gap-3">
                          {celebrity.avatar ? (
                            <img 
                              src={celebrity.avatar} 
                              alt={celebrity.name} 
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <Star className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium">{celebrity.name}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Badge variant="outline" className="text-xs">{celebrity.category}</Badge>
                              <Badge 
                                variant={celebrity.status === "main_leaderboard" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {celebrity.status === "main_leaderboard" ? "Main" : "Induction"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setScoreBreakdownCelebrity(celebrity.id);
                              setShowScoreBreakdown(true);
                            }}
                            title="Score Breakdown"
                            data-testid={`button-score-breakdown-${celebrity.id}`}
                          >
                            <Activity className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditCelebrity(celebrity)}
                            data-testid={`button-edit-celebrity-${celebrity.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeleteTarget({ type: "celebrity", id: celebrity.id, name: celebrity.name });
                              setShowDeleteConfirm(true);
                            }}
                            data-testid={`button-delete-celebrity-${celebrity.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Star className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No celebrities found</p>
                    <Button 
                      className="mt-4" 
                      onClick={() => {
                        setEditingCelebrity(null);
                        setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "" });
                        setShowCelebrityModal(true);
                      }}
                      data-testid="button-create-first-celebrity"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Celebrity
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Prediction CMS Section */}
        {activeSection === "predictions" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Prediction CMS</h2>
                <p className="text-muted-foreground">Manage prediction markets</p>
              </div>
              <Button onClick={() => setCreateMarketOpen(true)} data-testid="button-create-market">
                <Plus className="h-4 w-4 mr-2" />
                New Market
              </Button>
            </div>

            <Tabs defaultValue="real-world" className="w-full">
              <TabsList className="flex-wrap">
                <TabsTrigger value="real-world" data-testid="tab-real-world-markets">
                  Real-World Markets
                </TabsTrigger>
                <TabsTrigger value="weekly-jackpot" data-testid="tab-weekly-jackpot">
                  Weekly Jackpot
                </TabsTrigger>
                <TabsTrigger value="weekly-updown" data-testid="tab-weekly-updown">
                  Weekly Up/Down
                </TabsTrigger>
                <TabsTrigger value="head-to-head" data-testid="tab-head-to-head">
                  Head-to-Head Battles
                </TabsTrigger>
                <TabsTrigger value="top-gainer" data-testid="tab-top-gainer">
                  Top Gainer Predictions
                </TabsTrigger>
              </TabsList>

              <TabsContent value="real-world" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Real-World Markets</CardTitle>
                      <CardDescription>Community prediction markets for real-world events</CardDescription>
                    </div>
                    <Button onClick={() => setCreateMarketOpen(true)} size="sm" data-testid="button-create-rw-market">
                      <Plus className="h-4 w-4 mr-1" />
                      Create
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : (() => {
                      const rwMarkets = (markets || []).filter(m => m.marketType === "community");
                      return rwMarkets.length > 0 ? (
                        <div className="space-y-3">
                          {rwMarkets.map((market) => (
                            <div
                              key={market.id}
                              className="flex items-center justify-between p-3 rounded-lg border gap-3"
                              data-testid={`market-row-${market.id}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{market.title}</p>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {market.openMarketType && (
                                    <Badge variant="outline" className="text-xs">
                                      {market.openMarketType === "binary" ? "Yes/No" : 
                                       market.openMarketType === "multi" ? "Multi" : "Up/Down"}
                                    </Badge>
                                  )}
                                  <Badge
                                    variant={
                                      market.status === "OPEN" ? "default" :
                                      market.status === "RESOLVED" ? "secondary" : "destructive"
                                    }
                                  >
                                    {market.status}
                                  </Badge>
                                  {market.category && (
                                    <Badge variant="outline" className="text-xs capitalize">{market.category}</Badge>
                                  )}
                                  {market.featured && (
                                    <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-500">
                                      <Star className="h-3 w-3 mr-1" />
                                      Featured
                                    </Badge>
                                  )}
                                  <span className="text-xs text-muted-foreground">
                                    Ends: {new Date(market.endAt).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {market.status === "OPEN" && (
                                  <>
                                    <Button 
                                      variant="ghost" 
                                      size="icon"
                                      onClick={() => {
                                        setSettleMarketId(market.id);
                                      }}
                                      data-testid={`button-settle-${market.id}`}
                                    >
                                      <Gavel className="h-4 w-4" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon"
                                      onClick={() => setVoidMarketId(market.id)}
                                      data-testid={`button-void-${market.id}`}
                                    >
                                      <XCircle className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Gamepad2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No real-world markets yet</p>
                          <Button className="mt-4" onClick={() => setCreateMarketOpen(true)} data-testid="button-create-first-market">
                            <Plus className="h-4 w-4 mr-2" />
                            Create First Market
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="weekly-jackpot" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Weekly Jackpot</CardTitle>
                    <CardDescription>Predict exact fame scores for weekly prizes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Weekly Jackpot predictions coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="weekly-updown" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Weekly Up/Down</CardTitle>
                    <CardDescription>Will a celebrity's fame score go up or down this week?</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Weekly Up/Down predictions coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="head-to-head" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Head-to-Head Battles</CardTitle>
                    <CardDescription>Predict which celebrity will have a higher fame score</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Head-to-Head Battle predictions coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="top-gainer" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Top Gainer Predictions</CardTitle>
                    <CardDescription>Predict which celebrity will gain the most fame this week</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Top Gainer predictions coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Voting CMS Section */}
        {activeSection === "voting" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Voting CMS</h2>
                <p className="text-muted-foreground">Manage voting content</p>
              </div>
            </div>

            <Tabs defaultValue="polls" className="w-full">
              <TabsList className="flex-wrap">
                <TabsTrigger value="polls" data-testid="tab-polls">
                  Trending Polls
                </TabsTrigger>
                <TabsTrigger value="faceoffs" data-testid="tab-faceoffs">
                  Face-Offs
                </TabsTrigger>
                <TabsTrigger value="underrated-overrated" data-testid="tab-underrated-overrated">
                  Underrated / Overrated
                </TabsTrigger>
                <TabsTrigger value="induction" data-testid="tab-induction">
                  Induction Queue
                </TabsTrigger>
                <TabsTrigger value="curate-profile" data-testid="tab-curate-profile">
                  Curate Profile
                </TabsTrigger>
              </TabsList>

              <TabsContent value="polls" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Trending Polls</CardTitle>
                      <CardDescription>Manage community polling questions</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingPoll(null);
                        resetPollForm();
                        setShowPollModal(true);
                      }}
                      data-testid="button-add-poll"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Poll
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Select value={pollFilter} onValueChange={setPollFilter}>
                        <SelectTrigger className="w-[140px]" data-testid="select-poll-status-filter">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                          <SelectItem value="missing_image">Missing Image</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={pollCategoryFilter} onValueChange={setPollCategoryFilter}>
                        <SelectTrigger className="w-[140px]" data-testid="select-poll-category-filter">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          <SelectItem value="Tech">Tech</SelectItem>
                          <SelectItem value="Entertainment">Entertainment</SelectItem>
                          <SelectItem value="Sports">Sports</SelectItem>
                          <SelectItem value="Politics">Politics</SelectItem>
                          <SelectItem value="Business">Business</SelectItem>
                          <SelectItem value="Creator">Creator</SelectItem>
                          <SelectItem value="Custom Topic">Custom Topic</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {pollsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredPolls && filteredPolls.length > 0 ? (
                      <div className="space-y-3" data-testid="poll-list">
                        {filteredPolls.map((poll) => (
                          <div
                            key={poll.id}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            data-testid={`poll-row-${poll.id}`}
                          >
                            <div className="flex-1">
                              <p className="font-medium">{poll.headline}</p>
                              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{poll.subjectText}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <Badge variant="outline" className="text-xs">{poll.category}</Badge>
                                <Badge
                                  variant={
                                    poll.status === "live"
                                      ? "default"
                                      : poll.status === "draft"
                                      ? "secondary"
                                      : "outline"
                                  }
                                  className="text-xs"
                                >
                                  {poll.status}
                                </Badge>
                                {poll.personId && (
                                  <Badge variant="outline" className="text-xs">
                                    <Users className="h-3 w-3 mr-1" />
                                    Linked
                                  </Badge>
                                )}
                                {!poll.personId && !poll.imageUrl && poll.status === "draft" && (
                                  <Badge variant="destructive" className="text-xs">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    No Image
                                  </Badge>
                                )}
                                {poll.deadlineAt && (
                                  <span className="text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3 inline mr-1" />
                                    {new Date(poll.deadlineAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {poll.status !== "archived" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    fetchWithAuth(`/api/admin/trending-polls/${poll.id}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({ status: "archived" }),
                                    }).then(() => {
                                      toast({ title: "Poll Archived" });
                                      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
                                    });
                                  }}
                                  title="Archive"
                                  data-testid={`button-archive-poll-${poll.id}`}
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditPoll(poll)}
                                data-testid={`button-edit-poll-${poll.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  setDeleteTarget({ type: "poll", id: poll.id, name: poll.headline });
                                  setShowDeleteConfirm(true);
                                }}
                                data-testid={`button-delete-poll-${poll.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Vote className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No trending polls yet</p>
                        <Button
                          className="mt-4"
                          onClick={() => {
                            setEditingPoll(null);
                            resetPollForm();
                            setShowPollModal(true);
                          }}
                          data-testid="button-create-first-poll"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create First Poll
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="faceoffs" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Face-Off Queue</CardTitle>
                      <CardDescription>Manage Face-Off voting questions</CardDescription>
                    </div>
                    <Button 
                      size="sm"
                      onClick={() => {
                        setEditingFaceOff(null);
                        setFaceOffForm({ title: "", category: "Tech", optionAText: "", optionBText: "", isActive: true });
                        setShowFaceOffModal(true);
                      }}
                      data-testid="button-add-faceoff"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Face-Off
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {faceOffsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : faceOffs && faceOffs.length > 0 ? (
                      <div className="space-y-3" data-testid="faceoff-list">
                        {faceOffs.map((faceOff) => (
                          <div
                            key={faceOff.id}
                            className="flex items-center justify-between p-3 rounded-lg border"
                            data-testid={`faceoff-row-${faceOff.id}`}
                          >
                            <div className="flex-1">
                              <p className="font-medium">{faceOff.title}</p>
                              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                <Badge variant="outline" className="text-xs">{faceOff.category}</Badge>
                                <span>{faceOff.optionAText} vs {faceOff.optionBText}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant={faceOff.isActive ? "default" : "secondary"}>
                                {faceOff.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditFaceOff(faceOff)}
                                data-testid={`button-edit-faceoff-${faceOff.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  setDeleteTarget({ type: "faceoff", id: faceOff.id, name: faceOff.title });
                                  setShowDeleteConfirm(true);
                                }}
                                data-testid={`button-delete-faceoff-${faceOff.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No face-offs yet</p>
                        <Button 
                          className="mt-4" 
                          onClick={() => {
                            setEditingFaceOff(null);
                            setFaceOffForm({ title: "", category: "Tech", optionAText: "", optionBText: "", isActive: true });
                            setShowFaceOffModal(true);
                          }}
                          data-testid="button-create-first-faceoff"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create First Face-Off
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="underrated-overrated" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Underrated / Overrated</CardTitle>
                    <CardDescription>Manage approval rating voting options</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <ThumbsUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Underrated/Overrated voting management coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="induction" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Induction Queue</CardTitle>
                    <CardDescription>Approve or reject new celebrity nominations</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No pending induction candidates</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="curate-profile" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Curate Profile</CardTitle>
                    <CardDescription>Manage celebrity profile curation and data quality</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <Star className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Profile curation tools coming soon</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Moderation Section */}
        {activeSection === "moderation" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Content Moderation</h2>
              <p className="text-muted-foreground">Review and moderate user-generated content</p>
            </div>

            <Tabs defaultValue="insights" className="w-full">
              <TabsList>
                <TabsTrigger value="insights" data-testid="tab-insights">
                  Insights
                </TabsTrigger>
                <TabsTrigger value="comments" data-testid="tab-comments">
                  Comments
                </TabsTrigger>
              </TabsList>

              <TabsContent value="insights" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Community Insights</CardTitle>
                    <CardDescription>User-generated insights and posts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {insightsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : moderationInsights && moderationInsights.length > 0 ? (
                      <div className="space-y-3" data-testid="insights-list">
                        {moderationInsights.map((insight) => (
                          <div
                            key={insight.id}
                            className="flex items-start justify-between p-3 rounded-lg border"
                            data-testid={`insight-row-${insight.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm line-clamp-2">{insight.content}</p>
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <span>User: {insight.userId}</span>
                                <span>•</span>
                                <span>{new Date(insight.createdAt).toLocaleString()}</span>
                                <span>•</span>
                                <span className="text-emerald-500">+{insight.upvotes}</span>
                                <span className="text-red-500">-{insight.downvotes}</span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive ml-2"
                              onClick={() => {
                                setDeleteTarget({ type: "insight", id: insight.id, name: "this insight" });
                                setShowDeleteConfirm(true);
                              }}
                              data-testid={`button-delete-insight-${insight.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No insights to moderate</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="comments" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Comments</CardTitle>
                    <CardDescription>Comments on insights and posts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {commentsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : moderationComments && moderationComments.length > 0 ? (
                      <div className="space-y-3" data-testid="comments-list">
                        {moderationComments.map((comment) => (
                          <div
                            key={comment.id}
                            className="flex items-start justify-between p-3 rounded-lg border"
                            data-testid={`comment-row-${comment.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm line-clamp-2">{comment.content}</p>
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <span>User: {comment.userId}</span>
                                <span>•</span>
                                <span>{new Date(comment.createdAt).toLocaleString()}</span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive ml-2"
                              onClick={() => {
                                setDeleteTarget({ type: "comment", id: comment.id, name: "this comment" });
                                setShowDeleteConfirm(true);
                              }}
                              data-testid={`button-delete-comment-${comment.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No comments to moderate</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Settlement Section */}
        {activeSection === "settlement" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Settlement Center</h2>
              <p className="text-muted-foreground">Resolve closed markets and distribute payouts</p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Pending Settlements</CardTitle>
                <CardDescription>Markets awaiting resolution</CardDescription>
              </CardHeader>
              <CardContent>
                {marketsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Gavel className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No markets pending settlement</p>
                    <p className="text-sm mt-1">
                      Markets with status "CLOSED_PENDING" will appear here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Settlement History</CardTitle>
                <CardDescription>Recently resolved markets</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No settlement history yet</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Users Section */}
        {activeSection === "users" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Users & Moderation</h2>
              <p className="text-muted-foreground">Manage user accounts and moderation</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-user-search"
                />
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>User Accounts</CardTitle>
                <CardDescription>
                  {users ? `${users.length} users found` : "Loading users..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : users && users.length > 0 ? (
                  <div className="space-y-3">
                    {users.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`user-row-${user.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <Users className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {user.username || user.fullName || "Unknown"}
                            </p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Badge variant="outline" className="text-xs">
                                {user.role}
                              </Badge>
                              <span>{user.xpPoints} XP</span>
                              <span>{user.predictCredits} credits</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUser(user);
                              setShowCreditModal(true);
                            }}
                            data-testid={`button-adjust-credits-${user.id}`}
                          >
                            <Coins className="h-4 w-4 mr-1" />
                            Credits
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-ban-${user.id}`}
                          >
                            <Ban className="h-4 w-4 mr-1" />
                            Ban
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No users found</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* System Tools Section */}
        {activeSection === "tools" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-2xl font-bold">System Tools</h2>
                <p className="text-muted-foreground">Control data pipelines and scoring engine</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchEngineHealth()}
                disabled={engineHealthLoading}
                data-testid="button-refresh-engine-health"
              >
                {engineHealthLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh Health
              </Button>
            </div>

            {engineHealth && (
              <Card data-testid="card-engine-health">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-cyan-500" />
                    Engine Health Dashboard
                  </CardTitle>
                  <CardDescription>Real-time trend score engine diagnostics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const freshnessOk = engineHealth.ingestion?.status === "fresh";
                    const freshnessWarn = engineHealth.ingestion?.status === "aging";
                    const continuityOk = (engineHealth.gaps?.gapsOver2hCount || 0) === 0;
                    const continuityWarn = (engineHealth.gaps?.gapsOver2hCount || 0) <= 2 && !continuityOk;
                    const integrityOk = engineHealth.rankIntegrity?.isCorrect && engineHealth.coverage?.allHaveScores;
                    const integrityWarn = engineHealth.rankIntegrity?.isCorrect && !engineHealth.coverage?.allHaveScores;
                    return (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className={cn("p-4 rounded-lg border-2 text-center",
                          freshnessOk ? "border-green-500/40" : freshnessWarn ? "border-yellow-500/40" : "border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            freshnessOk ? "bg-green-500/10 text-green-500" : freshnessWarn ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {freshnessOk ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                          </div>
                          <div className="text-sm font-bold" data-testid="badge-freshness">FRESHNESS</div>
                          <div className="text-lg font-bold" data-testid="text-last-snapshot">
                            {engineHealth.ingestion?.minutesSinceLastSnapshot != null
                              ? engineHealth.ingestion.minutesSinceLastSnapshot < 60
                                ? `${engineHealth.ingestion.minutesSinceLastSnapshot}m ago`
                                : `${Math.round(engineHealth.ingestion.minutesSinceLastSnapshot / 60)}h ago`
                              : "N/A"}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {engineHealth.ingestion?.currentlyRunning ? (
                              <span className="text-cyan-500 font-medium">Ingestion running now</span>
                            ) : engineHealth.ingestion?.lastSuccessfulFinish ? (
                              <>Last success: {new Date(engineHealth.ingestion.lastSuccessfulFinish).toLocaleTimeString()}</>
                            ) : (
                              "No successful runs recorded"
                            )}
                          </p>
                          {engineHealth.ingestion?.lastSuccessfulDurationMs && (
                            <p className="text-xs text-muted-foreground">
                              Duration: {Math.round(engineHealth.ingestion.lastSuccessfulDurationMs / 1000)}s
                            </p>
                          )}
                        </div>

                        <div className={cn("p-4 rounded-lg border-2 text-center",
                          continuityOk ? "border-green-500/40" : continuityWarn ? "border-yellow-500/40" : "border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            continuityOk ? "bg-green-500/10 text-green-500" : continuityWarn ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {continuityOk ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                          </div>
                          <div className="text-sm font-bold" data-testid="badge-continuity">CONTINUITY</div>
                          <div className="text-lg font-bold" data-testid="text-gap-count">
                            {(engineHealth.gaps?.gapsOver2hCount || 0) === 0 ? "No gaps" : `${engineHealth.gaps.gapsOver2hCount} gap${engineHealth.gaps.gapsOver2hCount > 1 ? 's' : ''}`}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Max gap: {engineHealth.gaps?.maxGapMinutes ? `${Math.round(engineHealth.gaps.maxGapMinutes / 60)}h ${engineHealth.gaps.maxGapMinutes % 60}m` : "0m"}
                          </p>
                          {(engineHealth.backfill?.backfilledHoursCount || 0) > 0 && (
                            <p className="text-xs text-yellow-500 mt-1">
                              {engineHealth.backfill.backfilledHoursCount} backfilled hours detected
                            </p>
                          )}
                        </div>

                        <div className={cn("p-4 rounded-lg border-2 text-center",
                          integrityOk ? "border-green-500/40" : integrityWarn ? "border-yellow-500/40" : "border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            integrityOk ? "bg-green-500/10 text-green-500" : integrityWarn ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"
                          )}>
                            {integrityOk ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                          </div>
                          <div className="text-sm font-bold" data-testid="badge-integrity">INTEGRITY</div>
                          <div className="text-lg font-bold" data-testid="text-rank-integrity">
                            {engineHealth.rankIntegrity?.isCorrect ? "Valid" : `${engineHealth.rankIntegrity?.issueCount} issues`}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1" data-testid="text-people-coverage">
                            {engineHealth.coverage?.withFameScore || 0}/{engineHealth.coverage?.trackedPeople || 0} with scores
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {engineHealth.ingestionRuns && (
                    <div className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground">Ingestion Runs (last 24h)</span>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-green-500">{engineHealth.ingestionRuns.last24h?.completed || 0} ok</Badge>
                          {(engineHealth.ingestionRuns.last24h?.failed || 0) > 0 && (
                            <Badge variant="outline" className="text-red-500">{engineHealth.ingestionRuns.last24h.failed} failed</Badge>
                          )}
                          {(engineHealth.ingestionRuns.last24h?.lockedOut || 0) > 0 && (
                            <Badge variant="outline" className="text-yellow-500">{engineHealth.ingestionRuns.last24h.lockedOut} locked out</Badge>
                          )}
                          {(engineHealth.ingestionRuns.last24h?.currentlyRunning || 0) > 0 && (
                            <Badge variant="outline" className="text-cyan-500">1 running</Badge>
                          )}
                        </div>
                      </div>
                      {engineHealth.ingestionRuns.recentRuns?.length > 0 && (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {engineHealth.ingestionRuns.recentRuns.map((run: any) => (
                            <div key={run.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                              <div className="flex items-center gap-2">
                                <div className={cn("h-2 w-2 rounded-full",
                                  run.status === "completed" ? "bg-green-500" :
                                  run.status === "failed" ? "bg-red-500" :
                                  run.status === "running" ? "bg-cyan-500 animate-pulse" :
                                  "bg-yellow-500"
                                )} />
                                <span className="text-muted-foreground">
                                  {run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "?"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {run.durationMs && <span className="text-muted-foreground">{Math.round(run.durationMs / 1000)}s</span>}
                                <span className="font-medium">{run.snapshotsWritten || 0} snap</span>
                                {run.sourceStatuses && (
                                  <div className="flex items-center gap-1">
                                    <span className={cn("text-[10px]", run.sourceStatuses.wiki === "OK" ? "text-green-500" : "text-red-500")}>W</span>
                                    <span className={cn("text-[10px]", run.sourceStatuses.gdelt === "OK" ? "text-green-500" : run.sourceStatuses.gdelt === "DEGRADED" ? "text-yellow-500" : "text-red-500")}>G</span>
                                    <span className={cn("text-[10px]", run.sourceStatuses.serper === "OK" ? "text-green-500" : run.sourceStatuses.serper === "DEGRADED" ? "text-yellow-500" : "text-red-500")}>S</span>
                                  </div>
                                )}
                                {run.status === "locked_out" && <Badge variant="outline" className="text-[10px] text-yellow-500 py-0">locked</Badge>}
                                {run.status === "failed" && <Badge variant="outline" className="text-[10px] text-red-500 py-0">failed</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(!engineHealth.ingestionRuns.recentRuns || engineHealth.ingestionRuns.recentRuns.length === 0) && (
                        <p className="text-xs text-muted-foreground text-center py-2">No ingestion runs recorded yet. Runs will appear after the next ingestion cycle.</p>
                      )}
                    </div>
                  )}

                  {engineHealth.sourceHealth?.statuses && (
                    <div className="p-3 rounded-lg border">
                      <span className="text-xs font-medium text-muted-foreground">Source Health (from last successful run)</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {Object.entries(engineHealth.sourceHealth.statuses as Record<string, string>).map(([source, status]) => (
                          <div key={source} className="flex items-center justify-between text-sm p-2 rounded border">
                            <span className="font-medium capitalize">{source === "gdelt" ? "News (GDELT)" : source === "serper" ? "Search (Serper)" : "Wikipedia"}</span>
                            <div className="flex items-center gap-2">
                              <div className={cn("h-2 w-2 rounded-full",
                                status === "OK" ? "bg-green-500" : status === "DEGRADED" ? "bg-yellow-500" : "bg-red-500"
                              )} />
                              <span className={cn("text-xs",
                                status === "OK" ? "text-green-500" : status === "DEGRADED" ? "text-yellow-500" : "text-red-500"
                              )}>{status}</span>
                              {engineHealth.sourceHealth.timings?.[source] && (
                                <span className="text-xs text-muted-foreground">({Math.round(engineHealth.sourceHealth.timings[source] / 1000)}s)</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="p-3 rounded-lg border">
                      <span className="text-xs font-medium text-muted-foreground">Signal Quality (latest batch)</span>
                      <div className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Batch size</span>
                          <span className="font-medium">{engineHealth.signalQuality?.batchSize || 0}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Zero wiki</span>
                          <span className={cn("font-medium", (engineHealth.signalQuality?.zeroWiki || 0) > 0 ? "text-yellow-500" : "text-green-500")}>
                            {engineHealth.signalQuality?.zeroWiki || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Zero news</span>
                          <span className={cn("font-medium", (engineHealth.signalQuality?.zeroNews || 0) > 20 ? "text-red-500" : (engineHealth.signalQuality?.zeroNews || 0) > 10 ? "text-yellow-500" : "text-muted-foreground")}>
                            {engineHealth.signalQuality?.zeroNews || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Zero search</span>
                          <span className={cn("font-medium", (engineHealth.signalQuality?.zeroSearch || 0) > 0 ? "text-yellow-500" : "text-green-500")}>
                            {engineHealth.signalQuality?.zeroSearch || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Avg confidence</span>
                          <span className={cn("font-medium", (engineHealth.signalQuality?.avgConfidence || 0) >= 0.8 ? "text-green-500" : "text-yellow-500")}>
                            {engineHealth.signalQuality?.avgConfidence || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border">
                      <span className="text-xs font-medium text-muted-foreground">Fame Distribution</span>
                      <div className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>Range</span>
                          <span className="font-medium">{(engineHealth.fameDistribution?.min || 0).toLocaleString()} - {(engineHealth.fameDistribution?.max || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Average</span>
                          <span className="font-medium">{(engineHealth.fameDistribution?.average || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Median</span>
                          <span className="font-medium">{(engineHealth.fameDistribution?.median || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Std Dev</span>
                          <span className="font-medium">{(engineHealth.fameDistribution?.stddev || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border">
                      <span className="text-xs font-medium text-muted-foreground">Reference Stats</span>
                      <div className="mt-2 space-y-1 text-sm">
                        {engineHealth.sourceStatsReference ? (
                          <>
                            <div className="flex justify-between">
                              <span>Last computed</span>
                              <span className="font-medium">
                                {engineHealth.sourceStatsReference.minutesSinceComputed < 60
                                  ? `${engineHealth.sourceStatsReference.minutesSinceComputed}m ago`
                                  : `${Math.round(engineHealth.sourceStatsReference.minutesSinceComputed / 60)}h ago`}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Status</span>
                              <Badge variant="outline" className="text-xs">
                                {engineHealth.sourceStatsReference.minutesSinceComputed < 1440 ? "Current" : "Stale"}
                              </Badge>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">No reference data found</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {engineHealth.gaps?.gapDetails?.length > 0 && (
                    <div className="p-3 rounded-lg border border-yellow-500/30">
                      <span className="text-xs font-medium text-yellow-500">Detected Gaps (&gt;2 hours)</span>
                      <div className="mt-2 space-y-1">
                        {engineHealth.gaps.gapDetails.map((gap: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {new Date(gap.from).toLocaleString()} to {new Date(gap.to).toLocaleString()}
                            </span>
                            <Badge variant="outline" className="text-xs">{Math.round(gap.gapMinutes / 60)}h gap</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!engineHealth.rankIntegrity?.isCorrect && engineHealth.rankIntegrity?.issues?.length > 0 && (
                    <div className="p-3 rounded-lg border border-red-500/30">
                      <span className="text-xs font-medium text-red-500">Rank Integrity Issues</span>
                      <div className="mt-2 space-y-1">
                        {engineHealth.rankIntegrity.issues.map((issue: string, i: number) => (
                          <p key={i} className="text-xs text-muted-foreground">{issue}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="p-3 rounded-lg border">
                    <span className="text-xs font-medium text-muted-foreground">Spot Check (random sample)</span>
                    <div className="mt-2 space-y-1">
                      {engineHealth.spotCheck?.map((person: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span>{person.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">Fame: {person.fameIndex?.toLocaleString()}</span>
                            <Badge variant="outline" className="text-xs">Rank #{person.rank}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {engineHealthLoading && !engineHealth && (
              <Card>
                <CardContent className="py-8">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">Loading engine diagnostics...</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-cyan-500" />
                    Refresh External Data
                  </CardTitle>
                  <CardDescription>
                    Fetch latest data from Wikipedia, GDELT, Serper, and X APIs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => refreshDataMutation.mutate()}
                    disabled={refreshDataMutation.isPending}
                    data-testid="button-refresh-data"
                  >
                    {refreshDataMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Run Data Ingestion
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-violet-500" />
                    Force Trend Update
                  </CardTitle>
                  <CardDescription>
                    Recalculate trend scores and update rankings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => runScoringMutation.mutate()}
                    disabled={runScoringMutation.isPending}
                    data-testid="button-run-scoring"
                  >
                    {runScoringMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Scoring...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Run Scoring Engine
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Camera className="h-5 w-5 text-amber-500" />
                    Capture Snapshots
                  </CardTitle>
                  <CardDescription>
                    Save current trend data for historical charts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => captureSnapshotsMutation.mutate()}
                    disabled={captureSnapshotsMutation.isPending}
                    data-testid="button-capture-snapshots"
                  >
                    {captureSnapshotsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Capturing...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Capture Snapshots
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ThumbsUp className="h-5 w-5 text-green-500" />
                    Seed Approval Data
                  </CardTitle>
                  <CardDescription>
                    Populate Approval leaderboard with base voting data
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => seedApprovalMutation.mutate()}
                    disabled={seedApprovalMutation.isPending}
                    data-testid="button-seed-approval"
                  >
                    {seedApprovalMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Seeding...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Seed Approval Data
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Cron Job Status</CardTitle>
                <CardDescription>
                  Status of automated background jobs
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span>Hourly Snapshots</span>
                    </div>
                    <span className="text-sm text-muted-foreground">Every hour</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span>Data Ingestion</span>
                    </div>
                    <span className="text-sm text-muted-foreground">Every 8 hours</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-yellow-500" />
                      <span>Market Settlement</span>
                    </div>
                    <span className="text-sm text-muted-foreground">Manual trigger</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Search className="h-5 w-5 text-orange-500" />
                      Entity Resolution Diagnostics
                    </CardTitle>
                    <CardDescription>
                      Verify Serper search results match the correct person for each celebrity
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => runEntityDiagnostics()}
                    disabled={entityDiagLoading}
                    data-testid="button-run-entity-diagnostics"
                  >
                    {entityDiagLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Run Full Scan
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!entityDiagResults && !entityDiagLoading && (
                  <p className="text-sm text-muted-foreground" data-testid="text-entity-diag-empty">
                    Click "Run Full Scan" to analyze all celebrities. This queries Serper for each person and checks if the search results match the expected entity.
                  </p>
                )}
                {entityDiagLoading && (
                  <div className="flex items-center justify-center py-8" data-testid="loader-entity-diag">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="ml-3 text-muted-foreground">Querying Serper for all celebrities (this may take a minute)...</span>
                  </div>
                )}
                {entityDiagResults && !entityDiagLoading && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={entityDiagFilter === "all" ? "default" : "outline"}
                        className="cursor-pointer toggle-elevate"
                        onClick={() => setEntityDiagFilter("all")}
                        data-testid="badge-filter-all"
                      >
                        All ({entityDiagResults.length})
                      </Badge>
                      <Badge
                        variant={entityDiagFilter === "mismatch" ? "destructive" : "outline"}
                        className="cursor-pointer toggle-elevate"
                        onClick={() => setEntityDiagFilter("mismatch")}
                        data-testid="badge-filter-mismatch"
                      >
                        Possible Mismatch ({entityDiagResults.filter((r: any) => r.conclusion === "POSSIBLE_MISMATCH").length})
                      </Badge>
                      <Badge
                        variant={entityDiagFilter === "ok" ? "default" : "outline"}
                        className="cursor-pointer toggle-elevate"
                        onClick={() => setEntityDiagFilter("ok")}
                        data-testid="badge-filter-ok"
                      >
                        Match OK ({entityDiagResults.filter((r: any) => r.conclusion === "ENTITY_MATCH_OK").length})
                      </Badge>
                    </div>

                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {entityDiagResults
                        .filter((r: any) => {
                          if (entityDiagFilter === "mismatch") return r.conclusion === "POSSIBLE_MISMATCH" || r.conclusion === "NO_DATA";
                          if (entityDiagFilter === "ok") return r.conclusion === "ENTITY_MATCH_OK";
                          return true;
                        })
                        .map((result: any) => (
                          <div
                            key={result.personId}
                            className={cn(
                              "p-4 rounded-lg border space-y-2",
                              result.conclusion === "POSSIBLE_MISMATCH" && "border-red-500/30 bg-red-500/5",
                              result.conclusion === "ENTITY_MATCH_OK" && "border-green-500/20",
                              result.conclusion === "NO_DATA" && "border-yellow-500/30 bg-yellow-500/5"
                            )}
                            data-testid={`entity-diag-result-${result.personId}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{result.name}</span>
                                {result.latestRank && (
                                  <Badge variant="outline">#{result.latestRank}</Badge>
                                )}
                                <Badge
                                  variant={
                                    result.conclusion === "ENTITY_MATCH_OK" ? "default" :
                                    result.conclusion === "POSSIBLE_MISMATCH" ? "destructive" :
                                    "secondary"
                                  }
                                  data-testid={`badge-conclusion-${result.personId}`}
                                >
                                  {result.conclusion === "ENTITY_MATCH_OK" && <CheckCircle className="h-3 w-3 mr-1" />}
                                  {result.conclusion === "POSSIBLE_MISMATCH" && <XCircle className="h-3 w-3 mr-1" />}
                                  {result.conclusion === "ENTITY_MATCH_OK" ? "Match OK" :
                                   result.conclusion === "POSSIBLE_MISMATCH" ? "Possible Mismatch" : "No Data"}
                                </Badge>
                              </div>
                              <span className="text-sm text-muted-foreground font-mono">
                                Fame: {result.latestFameIndex?.toLocaleString() ?? "N/A"}
                              </span>
                            </div>

                            <div className="text-sm text-muted-foreground">
                              Query: <span className="font-mono">{result.searchQueryUsed}</span>
                              {result.wikiSlug && (
                                <span className="ml-2">| Wiki: <span className="font-mono">{result.wikiSlug}</span></span>
                              )}
                            </div>

                            {result.mismatchReasons.length > 0 && (
                              <div className="text-sm space-y-1">
                                {result.mismatchReasons.map((reason: string, i: number) => (
                                  <div key={i} className="flex items-center gap-1 text-red-400">
                                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                                    {reason}
                                  </div>
                                ))}
                              </div>
                            )}

                            {result.topResults.length > 0 && (
                              <div className="text-sm space-y-1 mt-2">
                                <span className="text-muted-foreground font-medium">Top Results:</span>
                                {result.topResults.map((r: any, i: number) => (
                                  <div key={i} className="ml-4 text-muted-foreground">
                                    #{r.position}. <span className="text-foreground">{r.title}</span>
                                    {r.url ? (
                                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-400 hover:underline text-xs" data-testid={`link-entity-result-${i}`}>({r.domain})</a>
                                    ) : (
                                      <span className="ml-1 text-muted-foreground/60">({r.domain})</span>
                                    )}
                                    {r.snippet && <div className="text-xs text-muted-foreground/50 ml-4 truncate max-w-[400px]" title={r.snippet}>{r.snippet}</div>}
                                  </div>
                                ))}
                              </div>
                            )}

                            {result.knowledgeGraph && (
                              <div className="text-sm ml-4 text-muted-foreground">
                                KG: <span className="text-foreground">{result.knowledgeGraph.title}</span>
                                {result.knowledgeGraph.type && (
                                  <span className="ml-1 text-muted-foreground/60">({result.knowledgeGraph.type})</span>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2 pt-2 border-t">
                              <span>Wiki: {result.rawInputs.wikiPageviews.toLocaleString()} views (p{(result.percentiles.wikiPercentile * 100).toFixed(0)})</span>
                              <span>News: {result.rawInputs.newsCount} articles (p{(result.percentiles.newsPercentile * 100).toFixed(0)})</span>
                              <span>Search: {result.rawInputs.searchVolume.toFixed(1)} score (p{(result.percentiles.searchPercentile * 100).toFixed(0)})</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Credit Adjustment Modal */}
      <Dialog open={showCreditModal} onOpenChange={setShowCreditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Credits</DialogTitle>
            <DialogDescription>
              Modify credits for {selectedUser?.username || selectedUser?.fullName || "user"}
              <br />
              Current balance: {selectedUser?.predictCredits || 0} credits
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (+ to add, - to subtract)</Label>
              <Input
                id="amount"
                type="number"
                value={creditAdjustment.amount}
                onChange={(e) =>
                  setCreditAdjustment({ ...creditAdjustment, amount: parseInt(e.target.value) || 0 })
                }
                data-testid="input-credit-amount"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (required)</Label>
              <Textarea
                id="reason"
                value={creditAdjustment.reason}
                onChange={(e) =>
                  setCreditAdjustment({ ...creditAdjustment, reason: e.target.value })
                }
                placeholder="Explain why you're adjusting this user's credits..."
                data-testid="input-credit-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Type "ADJUST" to confirm</Label>
              <Input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="ADJUST"
                data-testid="input-confirm-adjust"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreditModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreditAdjustment}
              disabled={
                confirmText !== "ADJUST" ||
                !creditAdjustment.reason ||
                creditAdjustment.amount === 0 ||
                adjustCreditsMutation.isPending
              }
              data-testid="button-confirm-adjustment"
            >
              {adjustCreditsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adjusting...
                </>
              ) : (
                "Confirm Adjustment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Celebrity Modal */}
      <Dialog open={showCelebrityModal} onOpenChange={setShowCelebrityModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCelebrity ? "Edit Celebrity" : "Add Celebrity"}</DialogTitle>
            <DialogDescription>
              {editingCelebrity ? "Update celebrity information" : "Add a new celebrity to track"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="celeb-name">Name</Label>
              <Input
                id="celeb-name"
                value={celebrityForm.name}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, name: e.target.value })}
                placeholder="Celebrity name"
                data-testid="input-celebrity-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-category">Category</Label>
              <Select 
                value={celebrityForm.category} 
                onValueChange={(value) => setCelebrityForm({ ...celebrityForm, category: value })}
              >
                <SelectTrigger data-testid="select-celebrity-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Entertainment">Entertainment</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Science">Science</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-status">Status</Label>
              <Select 
                value={celebrityForm.status} 
                onValueChange={(value) => setCelebrityForm({ ...celebrityForm, status: value })}
              >
                <SelectTrigger data-testid="select-celebrity-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main_leaderboard">Main Leaderboard</SelectItem>
                  <SelectItem value="induction_queue">Induction Queue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-wiki">Wikipedia Slug (optional)</Label>
              <Input
                id="celeb-wiki"
                value={celebrityForm.wikiSlug}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, wikiSlug: e.target.value })}
                placeholder="e.g., Elon_Musk"
                data-testid="input-celebrity-wiki"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-x">X Handle (optional)</Label>
              <Input
                id="celeb-x"
                value={celebrityForm.xHandle}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, xHandle: e.target.value })}
                placeholder="e.g., @elonmusk"
                data-testid="input-celebrity-xhandle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-search-override">Search Query Override (optional)</Label>
              <Input
                id="celeb-search-override"
                value={celebrityForm.searchQueryOverride}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, searchQueryOverride: e.target.value })}
                placeholder='e.g., "Brian Armstrong" Coinbase CEO'
                data-testid="input-celebrity-search-override"
              />
              <p className="text-xs text-muted-foreground">
                Custom search query for Serper. Use this to disambiguate common names.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCelebrityModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveCelebrity}
              disabled={!celebrityForm.name || createCelebrityMutation.isPending || updateCelebrityMutation.isPending}
              data-testid="button-save-celebrity"
            >
              {(createCelebrityMutation.isPending || updateCelebrityMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                editingCelebrity ? "Update Celebrity" : "Add Celebrity"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Score Breakdown Modal */}
      <Dialog open={showScoreBreakdown} onOpenChange={(open) => {
        setShowScoreBreakdown(open);
        if (!open) setScoreBreakdownCelebrity(null);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Score Breakdown
              {scoreBreakdown && (
                <span className="text-muted-foreground font-normal">- {scoreBreakdown.celebrity.name}</span>
              )}
            </DialogTitle>
            <DialogDescription>
              Why did this celebrity's score change? Detailed scoring breakdown and spike detection analysis.
            </DialogDescription>
          </DialogHeader>
          
          {scoreBreakdownLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : scoreBreakdown ? (
            <div className="space-y-6">
              {/* Current Score & Timestamp */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold text-violet-500">
                    {scoreBreakdown.scoreBreakdown.fameIndex.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Fame Index (Final)</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-2xl font-bold">{scoreBreakdown.scoreBreakdown.trendScore.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Raw Score (0-1)</p>
                </Card>
                <Card className="p-4 text-center">
                  <Badge className={cn(
                    "text-sm",
                    scoreBreakdown.scoreBreakdown.momentum === "Breakout" && "bg-green-500",
                    scoreBreakdown.scoreBreakdown.momentum === "Sustained" && "bg-blue-500",
                    scoreBreakdown.scoreBreakdown.momentum === "Cooling" && "bg-amber-500",
                    scoreBreakdown.scoreBreakdown.momentum === "Stable" && "bg-gray-500"
                  )}>
                    {scoreBreakdown.scoreBreakdown.momentum}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-2">Momentum</p>
                </Card>
                <Card className="p-4 text-center">
                  <p className="text-lg font-medium">
                    {new Date(scoreBreakdown.snapshotTimestamp).toLocaleTimeString()}
                  </p>
                  <p className="text-xs text-muted-foreground">Last Update</p>
                </Card>
              </div>

              {/* Previous Hour Comparison - Quick Debug Panel */}
              {scoreBreakdown.previousHourComparison && (
                <Card className="p-4 border-violet-500/30 bg-violet-500/5" data-testid="card-prev-hour">
                  <h3 className="font-semibold mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Previous Hour Comparison
                    </span>
                    <CopyDebugSummaryButton scoreBreakdown={scoreBreakdown} />
                  </h3>
                  <div className="grid grid-cols-3 gap-4 items-center text-center">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="text-lg font-bold">{scoreBreakdown.previousHourComparison.previousFameIndex.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Previous</p>
                      {scoreBreakdown.previousHourComparison.previousRank !== scoreBreakdown.previousHourComparison.currentRank && (
                        <Badge variant="outline" className="mt-1 text-xs">
                          #{scoreBreakdown.previousHourComparison.previousRank}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                      <Badge className={cn(
                        "text-xs",
                        scoreBreakdown.previousHourComparison.finalChangePercent > 0 ? "bg-green-500" : 
                        scoreBreakdown.previousHourComparison.finalChangePercent < 0 ? "bg-red-500" : "bg-gray-500"
                      )}>
                        {scoreBreakdown.previousHourComparison.finalChangePercent >= 0 ? "+" : ""}
                        {scoreBreakdown.previousHourComparison.finalChangePercent.toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="p-3 bg-violet-500/20 rounded-lg border border-violet-500/30">
                      <p className="text-lg font-bold text-violet-400">{scoreBreakdown.previousHourComparison.currentFameIndex.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Current</p>
                      <Badge variant="outline" className="mt-1 text-xs">
                        #{scoreBreakdown.currentRank}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 justify-center text-xs">
                    <Badge variant="outline">
                      Spikes: {[
                        scoreBreakdown.spikeStatus.wiki && "Wiki",
                        scoreBreakdown.spikeStatus.news && "News",
                        scoreBreakdown.spikeStatus.search && "Search"
                      ].filter(Boolean).join("+") || "None"} ({scoreBreakdown.stabilizationParams.spikingSourceCount})
                    </Badge>
                    <Badge variant="outline">
                      Cap: {(scoreBreakdown.stabilizationParams.effectiveRateCap * 100).toFixed(0)}%
                    </Badge>
                    <Badge variant="outline">
                      Alpha: {scoreBreakdown.stabilizationParams.effectiveAlpha.toFixed(2)}
                    </Badge>
                    {scoreBreakdown.stabilizationParams.isRecalibrationActive && (
                      <Badge className="bg-amber-500">RECAL</Badge>
                    )}
                  </div>
                </Card>
              )}

              {/* 24h Fame Score Chart */}
              {scoreBreakdown.historicalSnapshots && scoreBreakdown.historicalSnapshots.length > 0 && (
                <Card className="p-4" data-testid="card-fame-chart">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    24h Fame Score History
                  </h3>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={scoreBreakdown.historicalSnapshots.map(s => ({
                        ...s,
                        time: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      }))}>
                        <XAxis 
                          dataKey="time" 
                          tick={{ fontSize: 10 }} 
                          interval="preserveStartEnd"
                          stroke="hsl(var(--muted-foreground))"
                        />
                        <YAxis 
                          tick={{ fontSize: 10 }}
                          tickFormatter={(val) => val >= 1000 ? `${(val / 1000).toFixed(0)}K` : val}
                          stroke="hsl(var(--muted-foreground))"
                          domain={['auto', 'auto']}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--popover))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px',
                            fontSize: '12px'
                          }}
                          formatter={(value: number) => [value.toLocaleString(), "Fame Index (Final)"]}
                          labelFormatter={(label) => `Time: ${label}`}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="fameIndex" 
                          stroke="hsl(263, 70%, 50%)" 
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}

              {/* Raw Inputs & Spike Status */}
              <Card className="p-4" data-testid="card-raw-inputs">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Raw Inputs & Spike Detection
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Source</th>
                        <th className="text-right py-2 px-2">Current</th>
                        <th className="text-right py-2 px-2">7d Baseline</th>
                        <th className="text-right py-2 px-2">Percentile</th>
                        <th className="text-center py-2 px-2">Spiking</th>
                        <th className="text-right py-2 px-2">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 px-2 font-medium">Wikipedia</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.rawInputs.wikiPageviews.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{Math.round(scoreBreakdown.baselines.wiki).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">
                          <Badge variant="outline">{(scoreBreakdown.normalizedPercentiles.wiki * 100).toFixed(0)}%</Badge>
                        </td>
                        <td className="text-center py-2 px-2">
                          {scoreBreakdown.spikeStatus.wiki ? (
                            <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                          )}
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{(scoreBreakdown.weights.velocityBreakdown.wiki * 100).toFixed(0)}%</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-2 font-medium">News</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.rawInputs.newsCount.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{scoreBreakdown.baselines.news.toFixed(1)}</td>
                        <td className="text-right py-2 px-2">
                          <Badge variant="outline">{(scoreBreakdown.normalizedPercentiles.news * 100).toFixed(0)}%</Badge>
                        </td>
                        <td className="text-center py-2 px-2">
                          {scoreBreakdown.spikeStatus.news ? (
                            <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                          )}
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{(scoreBreakdown.weights.velocityBreakdown.news * 100).toFixed(0)}%</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-2 font-medium">Search</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.rawInputs.searchVolume.toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{Math.round(scoreBreakdown.baselines.search).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">
                          <Badge variant="outline">{(scoreBreakdown.normalizedPercentiles.search * 100).toFixed(0)}%</Badge>
                        </td>
                        <td className="text-center py-2 px-2">
                          {scoreBreakdown.spikeStatus.search ? (
                            <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                          )}
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{(scoreBreakdown.weights.velocityBreakdown.search * 100).toFixed(0)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Source Freshness Row */}
                <div className="mt-3 pt-3 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="font-medium">Source Freshness:</span>
                  <span>
                    Wiki: {new Date(scoreBreakdown.sourceFreshness.wiki.lastUpdated).toLocaleTimeString()}
                    {scoreBreakdown.sourceFreshness.wiki.isStale && <Badge variant="destructive" className="ml-1 text-[10px]">STALE</Badge>}
                  </span>
                  <span>
                    News: {new Date(scoreBreakdown.sourceFreshness.news.lastUpdated).toLocaleTimeString()}
                    {scoreBreakdown.sourceFreshness.news.isStale && <Badge variant="destructive" className="ml-1 text-[10px]">STALE</Badge>}
                  </span>
                  <span>
                    Search: {new Date(scoreBreakdown.sourceFreshness.search.lastUpdated).toLocaleTimeString()}
                    {scoreBreakdown.sourceFreshness.search.isStale && <Badge variant="destructive" className="ml-1 text-[10px]">STALE</Badge>}
                  </span>
                </div>
              </Card>

              {/* Stabilization Parameters */}
              <Card className="p-4" data-testid="card-stabilization">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Stabilization Parameters
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-xl font-bold">{scoreBreakdown.stabilizationParams.spikingSourceCount}</p>
                    <p className="text-xs text-muted-foreground">Sources Spiking</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-xl font-bold">{(scoreBreakdown.stabilizationParams.effectiveRateCap * 100).toFixed(0)}%</p>
                    <p className="text-xs text-muted-foreground">Rate Cap</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-xl font-bold">{scoreBreakdown.stabilizationParams.effectiveAlpha.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">EMA Alpha</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    {scoreBreakdown.stabilizationParams.isRecalibrationActive ? (
                      <Badge className="bg-amber-500">ACTIVE</Badge>
                    ) : (
                      <Badge variant="secondary">OFF</Badge>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">Recalibration</p>
                  </div>
                </div>
              </Card>

              {/* Score Calculation */}
              <Card className="p-4" data-testid="card-score-calculation">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Score Calculation
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.massScore.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Mass ({(scoreBreakdown.weights.mass * 100).toFixed(0)}%)</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.velocityScore.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Velocity (raw)</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.velocityAdjusted.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Velocity ({(scoreBreakdown.weights.velocity * 100).toFixed(0)}%)</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.diversityMultiplier.toFixed(2)}x</p>
                    <p className="text-xs text-muted-foreground">Diversity</p>
                  </div>
                  <div className="text-center p-3 bg-violet-500/20 rounded-lg border border-violet-500/30">
                    <p className="text-lg font-bold text-violet-400">{scoreBreakdown.scoreBreakdown.fameIndex.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Final Score</p>
                  </div>
                </div>
                {scoreBreakdown.scoreBreakdown.drivers && scoreBreakdown.scoreBreakdown.drivers.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">Drivers:</span>
                    {scoreBreakdown.scoreBreakdown.drivers.map((driver, i) => (
                      <Badge key={i} variant="outline">{driver}</Badge>
                    ))}
                  </div>
                )}
              </Card>

              {/* Population Stats Context */}
              <Card className="p-4" data-testid="card-population-stats">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Population Stats (7-day)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs">
                        <th className="text-left py-2 px-2">Source</th>
                        <th className="text-right py-2 px-2">Min</th>
                        <th className="text-right py-2 px-2">P25</th>
                        <th className="text-right py-2 px-2">P50</th>
                        <th className="text-right py-2 px-2">P75</th>
                        <th className="text-right py-2 px-2">P90</th>
                        <th className="text-right py-2 px-2">Max</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      <tr className="border-b">
                        <td className="py-2 px-2 font-medium">Wiki</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.min).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.p25).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.p50).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.p75).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.p90).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.wiki.max).toLocaleString()}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 px-2 font-medium">News</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.min.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.p25.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.p50.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.p75.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.p90.toFixed(0)}</td>
                        <td className="text-right py-2 px-2">{scoreBreakdown.populationStats.news.max.toFixed(0)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-2 font-medium">Search</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.min).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.p25).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.p50).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.p75).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.p90).toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{Math.round(scoreBreakdown.populationStats.search.max).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Based on {scoreBreakdown.populationStats.wiki.count} snapshots across all celebrities
                </p>
              </Card>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Failed to load score breakdown</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Face-Off Modal */}
      <Dialog open={showFaceOffModal} onOpenChange={setShowFaceOffModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingFaceOff ? "Edit Face-Off" : "Create Face-Off"}</DialogTitle>
            <DialogDescription>
              {editingFaceOff ? "Update face-off details" : "Create a new face-off voting question"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="faceoff-title">Title</Label>
              <Input
                id="faceoff-title"
                value={faceOffForm.title}
                onChange={(e) => setFaceOffForm({ ...faceOffForm, title: e.target.value })}
                placeholder="Face-off title"
                data-testid="input-faceoff-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="faceoff-category">Category</Label>
              <Select 
                value={faceOffForm.category} 
                onValueChange={(value) => setFaceOffForm({ ...faceOffForm, category: value })}
              >
                <SelectTrigger data-testid="select-faceoff-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Tech">Tech</SelectItem>
                  <SelectItem value="Entertainment">Entertainment</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Politics">Politics</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="faceoff-option-a">Option A</Label>
              <Input
                id="faceoff-option-a"
                value={faceOffForm.optionAText}
                onChange={(e) => setFaceOffForm({ ...faceOffForm, optionAText: e.target.value })}
                placeholder="First option"
                data-testid="input-faceoff-option-a"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="faceoff-option-b">Option B</Label>
              <Input
                id="faceoff-option-b"
                value={faceOffForm.optionBText}
                onChange={(e) => setFaceOffForm({ ...faceOffForm, optionBText: e.target.value })}
                placeholder="Second option"
                data-testid="input-faceoff-option-b"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="faceoff-active"
                checked={faceOffForm.isActive}
                onCheckedChange={(checked) => setFaceOffForm({ ...faceOffForm, isActive: checked })}
                data-testid="switch-faceoff-active"
              />
              <Label htmlFor="faceoff-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFaceOffModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveFaceOff}
              disabled={
                !faceOffForm.title || 
                !faceOffForm.optionAText || 
                !faceOffForm.optionBText || 
                createFaceOffMutation.isPending || 
                updateFaceOffMutation.isPending
              }
              data-testid="button-save-faceoff"
            >
              {(createFaceOffMutation.isPending || updateFaceOffMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                editingFaceOff ? "Update Face-Off" : "Create Face-Off"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Poll Create/Edit Dialog */}
      <Dialog open={showPollModal} onOpenChange={setShowPollModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPoll ? "Edit Poll" : "Create Poll"}</DialogTitle>
            <DialogDescription>
              {editingPoll ? "Update trending poll details" : "Create a new trending poll question"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="poll-status">Status</Label>
                <Select
                  value={pollForm.status}
                  onValueChange={(value) => setPollForm({ ...pollForm, status: value as "draft" | "live" | "archived" })}
                >
                  <SelectTrigger data-testid="select-poll-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poll-category">Category</Label>
                <Select
                  value={pollForm.category}
                  onValueChange={(value) => setPollForm({ ...pollForm, category: value })}
                >
                  <SelectTrigger data-testid="select-poll-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Tech">Tech</SelectItem>
                    <SelectItem value="Entertainment">Entertainment</SelectItem>
                    <SelectItem value="Sports">Sports</SelectItem>
                    <SelectItem value="Politics">Politics</SelectItem>
                    <SelectItem value="Business">Business</SelectItem>
                    <SelectItem value="Creator">Creator</SelectItem>
                    <SelectItem value="Custom Topic">Custom Topic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="poll-headline">Headline</Label>
              <Input
                id="poll-headline"
                value={pollForm.headline}
                onChange={(e) => setPollForm({ ...pollForm, headline: e.target.value })}
                placeholder="Short title for the poll"
                data-testid="input-poll-headline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poll-subject">Subject / Question</Label>
              <Textarea
                id="poll-subject"
                value={pollForm.subjectText}
                onChange={(e) => setPollForm({ ...pollForm, subjectText: e.target.value })}
                placeholder="The main question shown on the poll card"
                className="resize-none"
                data-testid="input-poll-subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poll-description">Description (optional)</Label>
              <Textarea
                id="poll-description"
                value={pollForm.description}
                onChange={(e) => setPollForm({ ...pollForm, description: e.target.value })}
                placeholder="Additional context or details"
                className="resize-none"
                data-testid="input-poll-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 relative">
                <Label htmlFor="poll-person">Linked Celebrity (optional)</Label>
                {pollForm.personId && selectedCelebrityName ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/30">
                    <span className="text-sm flex-1 truncate">{selectedCelebrityName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={clearCelebrity}
                      data-testid="button-clear-celebrity"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Input
                    id="poll-person"
                    value={celebritySearchInput}
                    onChange={(e) => handleCelebritySearchChange(e.target.value)}
                    onFocus={() => { if (celebritySearchResults.length > 0) setShowCelebrityDropdown(true); }}
                    onBlur={() => { setTimeout(() => setShowCelebrityDropdown(false), 200); }}
                    placeholder="Search by name..."
                    autoComplete="off"
                    data-testid="input-poll-person-search"
                  />
                )}
                {showCelebrityDropdown && celebritySearchResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="celebrity-search-dropdown">
                    {celebritySearchResults.map((celeb) => (
                      <button
                        key={celeb.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2"
                        onMouseDown={(e) => { e.preventDefault(); selectCelebrity(celeb); }}
                        data-testid={`celebrity-option-${celeb.id}`}
                      >
                        {celeb.avatar && <img src={celeb.avatar} alt="" className="h-6 w-6 rounded object-cover" />}
                        <span>{celeb.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{celeb.category}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {pollForm.personId ? `ID: ${pollForm.personId.slice(0, 8)}...` : "Search and select a celebrity"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poll-image">Image URL (optional)</Label>
                <Input
                  id="poll-image"
                  value={pollForm.imageUrl}
                  onChange={(e) => setPollForm({ ...pollForm, imageUrl: e.target.value })}
                  placeholder="Custom image URL (when no celebrity linked)"
                  disabled={!!pollForm.personId}
                  data-testid="input-poll-image-url"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="poll-timeline">Timeline</Label>
                <Select
                  value={pollForm.timeline || "no_deadline"}
                  onValueChange={(value) => setPollForm({ ...pollForm, timeline: value })}
                >
                  <SelectTrigger data-testid="select-poll-timeline">
                    <SelectValue placeholder="Select timeline" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_deadline">No Deadline</SelectItem>
                    <SelectItem value="1_week">1 Week</SelectItem>
                    <SelectItem value="1_month">1 Month</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poll-deadline">Deadline (optional)</Label>
                <Input
                  id="poll-deadline"
                  type="datetime-local"
                  value={pollForm.deadlineAt}
                  onChange={(e) => setPollForm({ ...pollForm, deadlineAt: e.target.value })}
                  data-testid="input-poll-deadline"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seed Vote Counts</Label>
              <p className="text-xs text-muted-foreground">Pre-populate display counts (not real vote rows)</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="poll-seed-support" className="text-xs">Support</Label>
                  <Input
                    id="poll-seed-support"
                    type="number"
                    min="0"
                    value={pollForm.seedSupportCount}
                    onChange={(e) => setPollForm({ ...pollForm, seedSupportCount: parseInt(e.target.value) || 0 })}
                    data-testid="input-poll-seed-support"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="poll-seed-neutral" className="text-xs">Neutral</Label>
                  <Input
                    id="poll-seed-neutral"
                    type="number"
                    min="0"
                    value={pollForm.seedNeutralCount}
                    onChange={(e) => setPollForm({ ...pollForm, seedNeutralCount: parseInt(e.target.value) || 0 })}
                    data-testid="input-poll-seed-neutral"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="poll-seed-oppose" className="text-xs">Oppose</Label>
                  <Input
                    id="poll-seed-oppose"
                    type="number"
                    min="0"
                    value={pollForm.seedOpposeCount}
                    onChange={(e) => setPollForm({ ...pollForm, seedOpposeCount: parseInt(e.target.value) || 0 })}
                    data-testid="input-poll-seed-oppose"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPollModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePoll}
              disabled={
                !pollForm.headline ||
                !pollForm.subjectText ||
                !pollForm.category ||
                createPollMutation.isPending ||
                updatePollMutation.isPending
              }
              data-testid="button-save-poll"
            >
              {(createPollMutation.isPending || updatePollMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                editingPoll ? "Update Poll" : "Create Poll"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateMarketModal
        open={createMarketOpen}
        onClose={() => setCreateMarketOpen(false)}
        onSubmit={(data) => createMarketMutation.mutate(data)}
        isPending={createMarketMutation.isPending}
      />

      <SettleMarketModal
        market={settleMarket || null}
        entries={settleMarketDetail?.entries || []}
        open={!!settleMarketId}
        onClose={() => setSettleMarketId(null)}
        onSettle={(winnerEntryId, notes) => {
          if (settleMarketId) {
            settleMarketMutation.mutate({ id: settleMarketId, winnerEntryId, resolutionNotes: notes || undefined });
          }
        }}
        isPending={settleMarketMutation.isPending}
      />

      <Dialog open={!!voidMarketId} onOpenChange={(isOpen) => !isOpen && setVoidMarketId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void Market</DialogTitle>
            <DialogDescription>This will void the market and refund all bets. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Reason for voiding</Label>
            <Textarea 
              id="void-reason"
              placeholder="Explain why this market is being voided..."
              className="mt-2 resize-none"
              data-testid="input-void-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidMarketId(null)}>Cancel</Button>
            <Button 
              variant="destructive"
              onClick={() => {
                const reason = (document.getElementById("void-reason") as HTMLTextAreaElement)?.value || "Voided by admin";
                if (voidMarketId) {
                  voidMarketMutation.mutate({ id: voidMarketId, voidReason: reason });
                }
              }}
              disabled={voidMarketMutation.isPending}
              data-testid="button-confirm-void"
            >
              {voidMarketMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
              Void Market
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteTarget?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={
                deleteCelebrityMutation.isPending || 
                deleteFaceOffMutation.isPending || 
                deletePollMutation.isPending ||
                deleteInsightMutation.isPending || 
                deleteCommentMutation.isPending
              }
              data-testid="button-confirm-delete"
            >
              {(deleteCelebrityMutation.isPending || deleteFaceOffMutation.isPending || deletePollMutation.isPending || deleteInsightMutation.isPending || deleteCommentMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
