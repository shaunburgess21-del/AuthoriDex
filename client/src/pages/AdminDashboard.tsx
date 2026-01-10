import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
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
  Plus,
  Edit,
  Trash2,
  Eye,
  MoreHorizontal,
  Loader2,
  MessageSquare,
  Star,
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

// Helper function to get auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
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
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

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
                  <SelectItem value="Music">Music</SelectItem>
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
                deleteInsightMutation.isPending || 
                deleteCommentMutation.isPending
              }
              data-testid="button-confirm-delete"
            >
              {(deleteCelebrityMutation.isPending || deleteFaceOffMutation.isPending || deleteInsightMutation.isPending || deleteCommentMutation.isPending) ? (
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
