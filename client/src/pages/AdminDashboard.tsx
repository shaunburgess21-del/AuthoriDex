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

type AdminSection = "overview" | "celebrities" | "cms" | "moderation" | "settlement" | "users" | "tools";

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
  status: string;
  title: string;
  summary: string | null;
  endAt: string;
  createdAt: string;
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
    enabled: isAdmin && (activeSection === "cms" || activeSection === "settlement"),
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
    enabled: isAdmin && activeSection === "cms",
  });

  const { data: trendingPollsList, isLoading: pollsLoading } = useQuery<TrendingPoll[]>({
    queryKey: ["/api/admin/trending-polls"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/trending-polls");
      if (!res.ok) throw new Error("Failed to fetch trending polls");
      return res.json();
    },
    enabled: isAdmin && activeSection === "cms",
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
      setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "" });
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
      setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "" });
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
    { id: "cms" as const, label: "Game CMS", icon: Gamepad2 },
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
                  onClick={() => setActiveSection("cms")}
                  data-testid="quick-action-cms"
                >
                  <Gamepad2 className="h-4 w-4 mr-2" />
                  Game CMS
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
                  setCelebrityForm({ name: "", category: "Tech", status: "main_leaderboard", wikiSlug: "", xHandle: "" });
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

        {/* Game CMS Section */}
        {activeSection === "cms" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Game CMS</h2>
                <p className="text-muted-foreground">Manage prediction markets and voting content</p>
              </div>
              <Button data-testid="button-create-market">
                <Plus className="h-4 w-4 mr-2" />
                New Market
              </Button>
            </div>

            <Tabs defaultValue="markets" className="w-full">
              <TabsList>
                <TabsTrigger value="markets" data-testid="tab-markets">
                  Prediction Markets
                </TabsTrigger>
                <TabsTrigger value="faceoffs" data-testid="tab-faceoffs">
                  Face-Offs
                </TabsTrigger>
                <TabsTrigger value="polls" data-testid="tab-polls">
                  Trending Polls
                </TabsTrigger>
                <TabsTrigger value="induction" data-testid="tab-induction">
                  Induction Queue
                </TabsTrigger>
              </TabsList>

              <TabsContent value="markets" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Prediction Markets</CardTitle>
                    <CardDescription>Create and manage prediction markets</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : markets && markets.length > 0 ? (
                      <div className="space-y-3">
                        {markets.map((market) => (
                          <div
                            key={market.id}
                            className="flex items-center justify-between p-3 rounded-lg border"
                          >
                            <div>
                              <p className="font-medium">{market.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline">{market.marketType}</Badge>
                                <Badge
                                  variant={
                                    market.status === "OPEN"
                                      ? "default"
                                      : market.status === "RESOLVED"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                >
                                  {market.status}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="icon">
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Gamepad2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No prediction markets yet</p>
                        <Button className="mt-4" data-testid="button-create-first-market">
                          <Plus className="h-4 w-4 mr-2" />
                          Create First Market
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
            <div>
              <h2 className="text-2xl font-bold">System Tools</h2>
              <p className="text-muted-foreground">Control data pipelines and scoring engine</p>
            </div>

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
