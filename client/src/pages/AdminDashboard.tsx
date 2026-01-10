import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type AdminSection = "overview" | "cms" | "settlement" | "users" | "tools";

interface AdminStats {
  totalUsers: number;
  totalCelebrities: number;
  totalVotes: number;
  totalPredictions: number;
  lastDataRefresh: string | null;
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

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAdmin, profileLoading, profile } = useAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [creditAdjustment, setCreditAdjustment] = useState({ amount: 0, reason: "" });
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  // DEBUG LOGGING for admin access
  console.log("[AdminDashboard] Render Check:");
  console.log("[AdminDashboard] - user:", user?.id);
  console.log("[AdminDashboard] - profile:", profile);
  console.log("[AdminDashboard] - profile?.role:", profile?.role);
  console.log("[AdminDashboard] - isAdmin (from useAuth):", isAdmin);
  console.log("[AdminDashboard] - profileLoading:", profileLoading);

  // Show loading while checking auth
  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show access denied for non-admins (no redirect, just display denial)
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            You do not have permission to access the admin panel.
          </p>
          <Button onClick={() => setLocation("/")} data-testid="button-go-home">
            Go to Homepage
          </Button>
        </Card>
      </div>
    );
  }

  // Fetch admin stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    retry: false,
  });

  // Fetch users for moderation
  const { data: users, isLoading: usersLoading } = useQuery<UserProfile[]>({
    queryKey: ["/api/admin/users", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      const url = `/api/admin/users${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: activeSection === "users",
  });

  // Fetch prediction markets
  const { data: markets, isLoading: marketsLoading } = useQuery<PredictionMarket[]>({
    queryKey: ["/api/admin/markets"],
    enabled: activeSection === "cms" || activeSection === "settlement",
  });

  // System tool mutations
  const refreshDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/refresh-data");
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
      const res = await apiRequest("POST", "/api/admin/run-scoring");
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
      const res = await apiRequest("POST", "/api/admin/capture-snapshots");
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
      const res = await apiRequest("POST", "/api/admin/adjust-credits", params);
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
      const res = await apiRequest("POST", "/api/admin/ban-user", params);
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

  const sidebarItems = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "cms" as const, label: "Game CMS", icon: Gamepad2 },
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
                onClick={() => refetchStats()}
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

            {/* Recent Activity Placeholder */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Admin Activity</CardTitle>
                <CardDescription>Latest actions from admin audit log</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Activity log will appear here</p>
                </div>
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
                  <CardHeader>
                    <CardTitle>Face-Off Queue</CardTitle>
                    <CardDescription>Manage and reorder Face-Off voting questions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8 text-muted-foreground">
                      <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Drag and drop to reorder Face-Offs</p>
                      <p className="text-sm mt-1">Feature coming soon</p>
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
    </div>
  );
}
