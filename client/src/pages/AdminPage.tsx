import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, Users, Database, TrendingUp, Settings, RefreshCw, Play, AlertTriangle, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AdminStats {
  totalUsers: number;
  totalCelebrities: number;
  totalVotes: number;
  totalPredictions: number;
  lastDataRefresh: string | null;
}

export default function AdminPage() {
  const { user, isAdmin, profileLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!isAdmin,
  });

  useEffect(() => {
    if (!profileLoading && !isAdmin) {
      setLocation("/");
    }
  }, [isAdmin, profileLoading, setLocation]);

  const handleRefreshData = async () => {
    try {
      toast({ title: "Refreshing data...", description: "This may take a moment." });
      await apiRequest("POST", "/api/admin/refresh-data");
      toast({ title: "Data refreshed", description: "All celebrity data has been updated." });
    } catch (error) {
      toast({ title: "Refresh failed", description: "Could not refresh data.", variant: "destructive" });
    }
  };

  const handleRunScoring = async () => {
    try {
      toast({ title: "Running scoring...", description: "Calculating trend scores." });
      await apiRequest("POST", "/api/admin/run-scoring");
      toast({ title: "Scoring complete", description: "All scores have been recalculated." });
    } catch (error) {
      toast({ title: "Scoring failed", description: "Could not run scoring.", variant: "destructive" });
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-destructive" />
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

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-red-500/10 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/me")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-400" />
              <span className="font-semibold text-red-400">Admin Panel</span>
            </div>
          </div>
          <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30">
            {user?.email}
          </Badge>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statsLoading ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </>
          ) : (
            <>
              <Card className="p-4 text-center">
                <Users className="h-6 w-6 mx-auto mb-2 text-cyan-400" />
                <p className="text-2xl font-bold">{stats?.totalUsers || 0}</p>
                <p className="text-xs text-muted-foreground">Users</p>
              </Card>
              <Card className="p-4 text-center">
                <Database className="h-6 w-6 mx-auto mb-2 text-violet-400" />
                <p className="text-2xl font-bold">{stats?.totalCelebrities || 0}</p>
                <p className="text-xs text-muted-foreground">Celebrities</p>
              </Card>
              <Card className="p-4 text-center">
                <TrendingUp className="h-6 w-6 mx-auto mb-2 text-green-400" />
                <p className="text-2xl font-bold">{stats?.totalVotes || 0}</p>
                <p className="text-xs text-muted-foreground">Total Votes</p>
              </Card>
              <Card className="p-4 text-center">
                <TrendingUp className="h-6 w-6 mx-auto mb-2 text-amber-400" />
                <p className="text-2xl font-bold">{stats?.totalPredictions || 0}</p>
                <p className="text-xs text-muted-foreground">Predictions</p>
              </Card>
            </>
          )}
        </div>

        <div className="grid gap-6">
          <Card className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Data Management
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">Refresh Celebrity Data</p>
                  <p className="text-xs text-muted-foreground">
                    Fetch latest data from Wikipedia, GDELT, and other sources
                  </p>
                  {stats?.lastDataRefresh && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last refresh: {new Date(stats.lastDataRefresh).toLocaleString()}
                    </p>
                  )}
                </div>
                <Button onClick={handleRefreshData} data-testid="button-refresh-data">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">Run Scoring Engine</p>
                  <p className="text-xs text-muted-foreground">
                    Recalculate trend scores for all celebrities
                  </p>
                </div>
                <Button variant="secondary" onClick={handleRunScoring} data-testid="button-run-scoring">
                  <Play className="h-4 w-4 mr-2" />
                  Run
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">View All Users</p>
                  <p className="text-xs text-muted-foreground">
                    Manage user accounts, roles, and permissions
                  </p>
                </div>
                <Button variant="outline" onClick={() => setLocation("/admin/users")} data-testid="button-view-users">
                  View Users
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Database className="h-5 w-5" />
              Celebrity Management
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">Manage Celebrities</p>
                  <p className="text-xs text-muted-foreground">
                    Add, edit, or remove celebrities from the leaderboard
                  </p>
                </div>
                <Button variant="outline" onClick={() => setLocation("/admin/celebrities")} data-testid="button-manage-celebrities">
                  Manage
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">Induction Queue</p>
                  <p className="text-xs text-muted-foreground">
                    Review and approve new celebrity candidates
                  </p>
                </div>
                <Button variant="outline" onClick={() => setLocation("/admin/induction")} data-testid="button-induction-queue">
                  Review
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Settings
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">XP Configuration</p>
                  <p className="text-xs text-muted-foreground">
                    Configure XP rewards and daily caps
                  </p>
                </div>
                <Button variant="outline" data-testid="button-xp-config">
                  Configure
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">Rank Thresholds</p>
                  <p className="text-xs text-muted-foreground">
                    Adjust XP requirements for each rank tier
                  </p>
                </div>
                <Button variant="outline" data-testid="button-rank-config">
                  Configure
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
