import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { useVisualViewportOffset } from "@/hooks/useVisualViewportOffset";
import { formatVox } from "@/lib/currency";
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
  ChevronLeft,
  ChevronRight,
  Shield,
  Activity,
  Clock,
  UserCheck,
  ArrowUpDown,
  ArrowDownToLine,
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
  Pencil,
  ImagePlus,
  ChevronDown,
  ChevronUp,
  Upload,
  Sparkles,
  LayoutList,
  Table2,
  Save,
  Inbox,
  Layers,
  ExternalLink,
  Palette,
  Bot,
  Bell,
  CreditCard,
  Award,
  Server,
} from "lucide-react";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { AdminSortableCardList } from "@/components/admin/AdminSortableCardList";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// Heavy section components are code-split so opening /admin only downloads
// the dashboard shell; each section's chunk is fetched on first visit
// (Phase 3+4 B6). All render inside <SectionSuspense> below.
const AdminUnderratedOverrated = lazyWithRetry(() =>
  import("@/components/admin/AdminUnderratedOverrated").then((m) => ({ default: m.AdminUnderratedOverrated })),
);
const AdminCurateProfile = lazyWithRetry(() =>
  import("@/components/admin/AdminCurateProfile").then((m) => ({ default: m.AdminCurateProfile })),
);
const AdminInductionQueue = lazyWithRetry(() =>
  import("@/components/admin/AdminInductionQueue").then((m) => ({ default: m.AdminInductionQueue })),
);
const AdminOptionSuggestionsSection = lazyWithRetry(() =>
  import("@/components/admin/AdminOptionSuggestionsSection").then((m) => ({ default: m.AdminOptionSuggestionsSection })),
);
const AdminVoteScoutSection = lazyWithRetry(() =>
  import("@/components/admin/AdminVoteScoutSection").then((m) => ({ default: m.AdminVoteScoutSection })),
);
const AdminSettlementCenter = lazyWithRetry(() =>
  import("@/components/admin/AdminSettlementCenter").then((m) => ({ default: m.AdminSettlementCenter })),
);
const AdminAmmSection = lazyWithRetry(() =>
  import("@/components/admin/AdminAmmSection").then((m) => ({ default: m.AdminAmmSection })),
);
const AdminUserCreditHistory = lazyWithRetry(() =>
  import("@/components/admin/AdminUserCreditHistory").then((m) => ({ default: m.AdminUserCreditHistory })),
);
const AdminGamificationSection = lazyWithRetry(() =>
  import("@/components/admin/AdminGamificationSection").then((m) => ({ default: m.AdminGamificationSection })),
);
const AdminLeaderboardDiff = lazyWithRetry(() =>
  import("@/components/admin/AdminLeaderboardDiff").then((m) => ({ default: m.AdminLeaderboardDiff })),
);
const AdminCategoriesSection = lazyWithRetry(() =>
  import("@/components/admin/AdminCategoriesSection").then((m) => ({ default: m.AdminCategoriesSection })),
);
const AdminScoreInspector = lazyWithRetry(() =>
  import("@/components/admin/AdminScoreInspector").then((m) => ({ default: m.AdminScoreInspector })),
);
const AdminAgentsSection = lazyWithRetry(() =>
  import("@/components/admin/AdminAgentsSection").then((m) => ({ default: m.AdminAgentsSection })),
);
const AdminBrandingSection = lazyWithRetry(() =>
  import("@/components/admin/AdminBrandingSection").then((m) => ({ default: m.AdminBrandingSection })),
);
// Sole recharts consumer in this file — split so the admin shell chunk no
// longer drags in the vendor-recharts bundle.
const AdminFameHistoryChart = lazyWithRetry(() =>
  import("@/pages/admin/AdminFameHistoryChart").then((m) => ({ default: m.AdminFameHistoryChart })),
);

/** Shared Suspense wrapper for lazily loaded admin sections. */
function SectionSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading section...
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UploadImageInput } from "@/components/ui/upload-image-input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { apiRequest } from "@/lib/queryClient";
import { dateToLocal, localDatetimeToIso } from "@/lib/datetime-local";
import { formatDate, formatTimeAgo } from "@/lib/formatDate";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/PersonAvatar";
import { AdminCategoryMultiSelect } from "@/components/admin/AdminCategoryMultiSelect";
import {
  GeoCountryTargeting,
  geoStateFromAllowlist,
  isGeoTargetingValid,
  visibleCountriesPayload,
} from "@/components/geo/GeoCountryTargeting";
import { getAdminAccessBlock } from "@/pages/admin/AdminAccessGate";
import { CountryFlag } from "@/components/ui/CountryFlag";
import type { TrendingPoll } from "@shared/schema";
import { normalizeMarketCategory, MARKET_CATEGORY_OPTIONS, OPINION_POLL_MAX_OPTIONS } from "@shared/constants";
import { sortByRecency, type RecencySort } from "@/lib/recencySort";
import { RecencySortSelect } from "@/components/admin/RecencySortSelect";
import {
  EMPTY_CELEBRITY_FORM,
  DEFAULT_SEED_APPROVAL_COUNTS,
  type AdminSection,
  type AdminStats,
  type TrafficStats,
  type UserProfile,
  type AdminUsersListResponse,
  ADMIN_USERS_PAGE_SIZE,
  canModerateUser,
  isInfrastructureUser,
  type PredictionMarket,
  type AuditLogEntry,
  type Celebrity,
  type SeedRatingKey,
  type SeedApprovalCounts,
  type Matchup,
  type InsightComment,
  type ScoreBreakdownData,
} from "@/pages/admin/adminTypes";
import { fetchWithAuth, getAuthHeaders } from "@/pages/admin/adminAuth";
import { CopyDebugSummaryButton } from "@/pages/admin/CopyDebugSummaryButton";
import { AmmResolutionDialog } from "@/components/admin/AmmResolutionDialog";
import { CreateMarketModal } from "@/pages/admin/CreateMarketModal";
import { RelatedCelebritiesField } from "@/pages/admin/RelatedCelebritiesField";
import { WorldMarketsSection } from "@/pages/admin/WorldMarketsSection";
import { NativeMarketRow } from "@/pages/admin/NativeMarketRow";

/**
 * One-shot deep-link params so ops emails can land the founder directly on
 * the right admin surface from a phone:
 *   /admin?section=predictions&tab=real-world&resolve=<marketId>
 * `vis` presets the World Markets visibility filter (e.g. vis=draft),
 * `resolve` opens the settle dialog, `edit` opens the edit modal.
 * Params are consumed on mount and stripped from the URL immediately after.
 */
function readAdminDeepLink() {
  const params = new URLSearchParams(window.location.search);
  return {
    section: params.get("section"),
    tab: params.get("tab"),
    vis: params.get("vis"),
    resolve: params.get("resolve"),
    edit: params.get("edit"),
  };
}

const ADMIN_DEEP_LINK_SECTIONS: AdminSection[] = [
  "overview", "celebrities", "predictions", "voting", "moderation",
  "settlement", "amm", "users", "gamification", "agents", "categories",
  "branding", "tools",
];

// Human-readable labels for the source keys written by the ingest job
// (see server/jobs/ingest.ts). Keep in sync if a new source is added —
// unknown keys fall back to a capitalized version of the key so we never
// silently mis-label a source as "Wikipedia" again.
const SOURCE_LABELS = {
  wiki: "Wikipedia",
  mediastack: "News (Mediastack)",
  gdelt: "News (GDELT)",
  serper: "Search (Serper)",
  serper_news: "News (Serper)",
  trends: "Search Momentum",
  searchVolume: "Search Interest",
  webSentiment: "Web Sentiment",
} as const;

// Shared color mapping for the per-run W/M/G/S letter badges and any other
// place we need to color a raw source-status string. Treats OK_FALLBACK
// (GDELT→Serper news fallback succeeded) as green, since it means the run
// got useful data from that source.
function sourceStatusColor(status: string | null | undefined): string {
  if (status === "OK" || status === "OK_FALLBACK") return "text-green-500";
  if (status === "DEGRADED") return "text-yellow-500";
  if (status === "THROTTLED") return "text-blue-500";
  if (!status || status === "SKIPPED" || status === "DISABLED") return "text-muted-foreground";
  return "text-red-500";
}

function sourceStatusTooltip(provider: string, status: string | null | undefined): string {
  const base = `${provider}: ${status ?? "—"}`;
  if (status === "THROTTLED") return `${base} (cache-only mode — Mediastack budget hard-stop active)`;
  if (status === "DISABLED" && (provider === "News (GDELT)" || provider === "GDELT")) {
    return `${base} (excluded from union news aggregation — negligible English URL contribution + no language filter)`;
  }
  if (status === "SKIPPED" && provider === "Search Momentum") {
    return `${base} (12h fetch cadence — fetched separately, not every cycle)`;
  }
  if (status === "SKIPPED" && provider === "Search Interest") {
    return `${base} (24h fetch cadence — monthly search-volume figure, refreshed daily)`;
  }
  if (status === "SKIPPED" && provider === "Web Sentiment") {
    return `${base} (7d fetch cadence — fetched separately, not every cycle)`;
  }
  return base;
}


// NOTE: World-market settlement now uses the shared <AmmResolutionDialog>
// (client/src/components/admin/AmmResolutionDialog.tsx), the same dialog the
// Settlement Center uses — AMM-aware payouts plus the AI scout panel.
// CreateMarketModal and RelatedCelebritiesField live in
// client/src/pages/admin/ (extracted in the Phase 3+4 chunk split).

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, isAdmin, profileLoading, profile } = useAuth();
  // Compensate for Chrome's collapsing bottom toolbar so the mobile
  // admin nav (rendered fixed at the bottom below) stays glued to the
  // visible bottom edge instead of leaving a transparent strip. The
  // hook returns a signed delta — applied verbatim via translateY,
  // so positive values push the nav down and negative push it up.
  const adminNavViewportOffset = useVisualViewportOffset();
  // Parsed once on mount; state so the values survive the URL cleanup below.
  const [deepLink] = useState(readAdminDeepLink);
  const [activeSection, setActiveSectionRaw] = useState<AdminSection>(() => {
    if (deepLink.section && ADMIN_DEEP_LINK_SECTIONS.includes(deepLink.section as AdminSection)) {
      sessionStorage.setItem("admin_active_section", deepLink.section);
      return deepLink.section as AdminSection;
    }
    const saved = sessionStorage.getItem("admin_active_section");
    // Backwards compat for the deprecated `credits` / `badges`
    // sidebar entries: a stale sessionStorage value lands the user
    // on the new Gamification CMS section with the corresponding
    // sub-tab pre-selected (handled by the JSX render block via
    // initialSubTab). We keep the raw saved value here so that
    // initialSubTab can pick up "credits" / "badges" — the alias
    // gets normalised to "gamification" the next time the user
    // clicks any sidebar item.
    return (saved as AdminSection) || "overview";
  });
  const setActiveSection = (section: AdminSection) => {
    sessionStorage.setItem("admin_active_section", section);
    setActiveSectionRaw(section);
  };

  const [votingSubTab, setVotingSubTabRaw] = useState(() => sessionStorage.getItem("admin_voting_tab") || "polls");
  const setVotingSubTab = (tab: string) => { sessionStorage.setItem("admin_voting_tab", tab); setVotingSubTabRaw(tab); };

  const [pollsViewMode, setPollsViewModeRaw] = useState<"cards" | "table">(() => (sessionStorage.getItem("admin_polls_view") as "cards" | "table") || "cards");
  const setPollsViewMode = (m: "cards" | "table") => { sessionStorage.setItem("admin_polls_view", m); setPollsViewModeRaw(m); };
  const [opinionViewMode, setOpinionViewModeRaw] = useState<"cards" | "table">(() => (sessionStorage.getItem("admin_opinion_view") as "cards" | "table") || "cards");
  const setOpinionViewMode = (m: "cards" | "table") => { sessionStorage.setItem("admin_opinion_view", m); setOpinionViewModeRaw(m); };
  const [matchupsViewMode, setMatchupsViewModeRaw] = useState<"cards" | "table">(() => (sessionStorage.getItem("admin_matchups_view") as "cards" | "table") || "cards");
  const setMatchupsViewMode = (m: "cards" | "table") => { sessionStorage.setItem("admin_matchups_view", m); setMatchupsViewModeRaw(m); };

  const [pollSeedEdits, setPollSeedEdits] = useState<Record<string, { seedAgreeCount: number; seedNeutralCount: number; seedDisagreeCount: number }>>({});
  const [matchupSeedEdits, setMatchupSeedEdits] = useState<Record<string, { seedVotesA: number; seedVotesB: number }>>({});
  const [opinionSeedEdits, setOpinionSeedEdits] = useState<Record<string, { options: { name: string; imageUrl: string; personId: string; seedCount: number }[] }>>({});
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(new Set());

  const [predictionSubTab, setPredictionSubTabRaw] = useState(() => {
    if (deepLink.tab) {
      sessionStorage.setItem("admin_prediction_tab", deepLink.tab);
      return deepLink.tab;
    }
    return sessionStorage.getItem("admin_prediction_tab") || "real-world";
  });
  const setPredictionSubTab = (tab: string) => { sessionStorage.setItem("admin_prediction_tab", tab); setPredictionSubTabRaw(tab); };

  // Strip consumed deep-link params so refresh / back don't re-trigger them.
  useEffect(() => {
    if (deepLink.section || deepLink.tab || deepLink.vis || deepLink.resolve || deepLink.edit) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [moderationSubTab, setModerationSubTabRaw] = useState(() => {
    const allowed = new Set(["queue", "reports", "comments"]);
    if (deepLink.section === "moderation" && deepLink.tab && allowed.has(deepLink.tab)) {
      sessionStorage.setItem("admin_moderation_tab", deepLink.tab);
      return deepLink.tab;
    }
    const stored = sessionStorage.getItem("admin_moderation_tab");
    // The "insights" sub-tab was merged into "comments" (community_insights →
    // comments merge); a stale stored value would select a tab that no longer
    // exists and render an empty panel.
    if (stored && allowed.has(stored)) return stored;
    return "queue";
  });
  const setModerationSubTab = (tab: string) => { sessionStorage.setItem("admin_moderation_tab", tab); setModerationSubTabRaw(tab); };
  const [searchQuery, setSearchQuery] = useState("");
  // Toggle the Users tab between the full user list and a filtered
  // view showing only the wallet/ledger drift offenders. Set by the
  // header "Credit Drift" tile click; also toggleable via a chip in
  // the Users tab header.
  const [userFilter, setUserFilter] = useState<"all" | "drift">("all");
  const [userSort, setUserSort] = useState<
    "created_desc" | "created_asc" | "last_active" | "credits" | "xp"
  >("created_desc");
  // Server-side list filters: humans (default — hides the ~56 sim
  // agents + house), banned-only, recently-active windows.
  const [userKindFilter, setUserKindFilter] = useState<
    "humans" | "agents" | "system" | "all"
  >("humans");
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "banned">("all");
  const [userActiveFilter, setUserActiveFilter] = useState<"any" | "7d" | "30d">("any");
  const [userPage, setUserPage] = useState(1);
  const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
  const [reconcileDriftTarget, setReconcileDriftTarget] = useState<UserProfile | null>(null);
  const [celebritySearch, setCelebritySearch] = useState("");
  // Status filter for the admin Celebrities list. Default to main_leaderboard so
  // the count matches the public leaderboard; induction shadow rows used by
  // Curate Profile are still browsable via the dropdown.
  const [celebrityStatusFilter, setCelebrityStatusFilter] = useState<"main_leaderboard" | "induction" | "all">("main_leaderboard");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [creditAdjustment, setCreditAdjustment] = useState({ amount: 0, reason: "" });
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditHistoryUserId, setCreditHistoryUserId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserProfile | null>(null);
  const [deleteUserReason, setDeleteUserReason] = useState("");
  const [deleteUserConfirmText, setDeleteUserConfirmText] = useState("");
  const [showBanUserModal, setShowBanUserModal] = useState(false);
  const [banUserTarget, setBanUserTarget] = useState<UserProfile | null>(null);
  const [banUserReason, setBanUserReason] = useState("");
  const [banUserConfirmText, setBanUserConfirmText] = useState("");
  // Confirm guard for the native-market Settle / Delete icon buttons —
  // they used to fire instantly, and both are irreversible (settle pays
  // out users; delete removes the market).
  const [confirmNativeAction, setConfirmNativeAction] = useState<
    { kind: "settle" | "delete"; id: string; title?: string | null } | null
  >(null);
  const [showUnbanUserModal, setShowUnbanUserModal] = useState(false);
  const [unbanUserTarget, setUnbanUserTarget] = useState<UserProfile | null>(null);
  const [unbanUserReason, setUnbanUserReason] = useState("");
  const [unbanUserConfirmText, setUnbanUserConfirmText] = useState("");
  
  const [showZeroNewsPeople, setShowZeroNewsPeople] = useState(false);
  const [showSkippedRuns, setShowSkippedRuns] = useState(false);
  const [wikiAuditResults, setWikiAuditResults] = useState<any>(null);
  const [wikiAuditLoading, setWikiAuditLoading] = useState(false);
  const [wikiAuditExpanded, setWikiAuditExpanded] = useState(false);
  const [wikiSlugFixingId, setWikiSlugFixingId] = useState<string | null>(null);
  const [msAuditResults, setMsAuditResults] = useState<any>(null);
  const [msAuditLoading, setMsAuditLoading] = useState(false);
  const [msAuditExpanded, setMsAuditExpanded] = useState(false);
  const [msAuditFilter, setMsAuditFilter] = useState<"all" | "zero_articles" | "no_cache" | "stale" | "ok">("all");
  const [msProbeLoading, setMsProbeLoading] = useState<string | null>(null);
  const [msProbeResults, setMsProbeResults] = useState<Record<string, any>>({});
  const [serperAuditResults, setSerperAuditResults] = useState<any>(null);
  const [serperAuditLoading, setSerperAuditLoading] = useState(false);
  const [serperAuditExpanded, setSerperAuditExpanded] = useState(false);
  const [trendsAuditResults, setTrendsAuditResults] = useState<any>(null);
  const [trendsAuditLoading, setTrendsAuditLoading] = useState(false);
  const [trendsAuditExpanded, setTrendsAuditExpanded] = useState(false);
  const [trendsAuditFilter, setTrendsAuditFilter] = useState<"all" | "no_data" | "stale" | "zero_data" | "missing_topic_id" | "ok">("all");
  // Per-row SerpApi autocomplete results for the Trends audit "Lookup" popover.
  // Cached in-memory for the session so re-opening a popover is instant.
  type TrendsSuggestion = { topicId: string; title: string; type: string };
  type TrendsSuggestionState = { loading: boolean; suggestions: TrendsSuggestion[]; error?: string };
  const [trendsSuggestionsByPerson, setTrendsSuggestionsByPerson] = useState<Record<string, TrendsSuggestionState>>({});
  const [trendsSavingPersonId, setTrendsSavingPersonId] = useState<string | null>(null);
  const [serperAuditFilter, setSerperAuditFilter] = useState<
    "all" | "zero_results" | "no_cache" | "stale" | "ok"
  >("all");
  const [serperRefreshLoading, setSerperRefreshLoading] = useState(false);
  const [serperProbeLoading, setSerperProbeLoading] = useState<string | null>(null);
  const [serperProbeResults, setSerperProbeResults] = useState<Record<string, any>>({});
  const [showCelebrityModal, setShowCelebrityModal] = useState(false);
  const [editingCelebrity, setEditingCelebrity] = useState<Celebrity | null>(null);
  const [celebrityForm, setCelebrityForm] = useState({ ...EMPTY_CELEBRITY_FORM });
  const MAX_ADD_CELEBRITY_GALLERY = 5;
  const [pendingCelebrityGalleryFiles, setPendingCelebrityGalleryFiles] = useState<File[]>([]);
  const [celebrityGalleryUploading, setCelebrityGalleryUploading] = useState(false);
  const addCelebrityGalleryInputRef = useRef<HTMLInputElement>(null);
  const [seedApprovalCounts, setSeedApprovalCounts] = useState<SeedApprovalCounts>(DEFAULT_SEED_APPROVAL_COUNTS);
  const [seedApprovalLoading, setSeedApprovalLoading] = useState(false);
  
  const [showMatchupModal, setShowMatchupModal] = useState(false);
  const [editingMatchup, setEditingMatchup] = useState<Matchup | null>(null);
  const [matchupForm, setMatchupForm] = useState({
    title: "",
    category: "tech",
    secondaryCategories: [] as string[],
    optionAText: "",
    optionBText: "",
    optionAImage: "",
    optionBImage: "",
    personAId: "",
    personBId: "",
    promptText: "",
    description: "",
    isActive: true,
    visibility: "live",
    featured: false,
    slug: "",
    seedVotesA: 0,
    seedVotesB: 0,
  });
  const [matchupSearchA, setMatchupSearchA] = useState("");
  const [matchupSearchB, setMatchupSearchB] = useState("");
  const [matchupRelatedPeople, setMatchupRelatedPeople] = useState<{ id: string; name: string }[]>([]);
  const [matchupGeoEnabled, setMatchupGeoEnabled] = useState(false);
  const [matchupGeoCountries, setMatchupGeoCountries] = useState<string[]>([]);
  
  const [showPollModal, setShowPollModal] = useState(false);
  const [editingPoll, setEditingPoll] = useState<TrendingPoll | null>(null);
  const [pollFilter, setPollFilter] = useState<string>("all");
  const [pollCategoryFilter, setPollCategoryFilter] = useState<string>("all");
  const [pollSortOrder, setPollSortOrder] = useState<RecencySort>("default");
  const [importingPollsCsv, setImportingPollsCsv] = useState(false);
  const pollCsvInputRef = useRef<HTMLInputElement>(null);
  const [pollForm, setPollForm] = useState({
    status: "draft" as "draft" | "live" | "archived",
    category: "tech",
    secondaryCategories: [] as string[],
    headline: "",
    subjectText: "",
    personId: "",
    description: "",
    timeline: "",
    deadlineAt: "",
    imageUrl: "",
    seedAgreeCount: 0,
    seedNeutralCount: 0,
    seedDisagreeCount: 0,
    slug: "",
    featured: false,
    visibility: "draft" as "draft" | "live" | "inactive" | "archived",
  });
  
  const [celebritySearchInput, setCelebritySearchInput] = useState("");
  const [celebritySearchResults, setCelebritySearchResults] = useState<Celebrity[]>([]);
  const [showCelebrityDropdown, setShowCelebrityDropdown] = useState(false);
  const [selectedCelebrityName, setSelectedCelebrityName] = useState("");
  const celebritySearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollRelatedPeople, setPollRelatedPeople] = useState<{ id: string; name: string }[]>([]);
  const [pollGeoEnabled, setPollGeoEnabled] = useState(false);
  const [pollGeoCountries, setPollGeoCountries] = useState<string[]>([]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);
  const [demoteCelebrityTarget, setDemoteCelebrityTarget] = useState<Celebrity | null>(null);
  
  // Score Breakdown Modal state
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [scoreBreakdownCelebrity, setScoreBreakdownCelebrity] = useState<string | null>(null);

  // Entity Diagnostic state
  const [entityDiagResults, setEntityDiagResults] = useState<any[] | null>(null);
  const [entityDiagLoading, setEntityDiagLoading] = useState(false);
  const [entityDiagFilter, setEntityDiagFilter] = useState<string>("all");

  const [createMarketOpen, setCreateMarketOpen] = useState(false);
  // `edit` / `resolve` deep-link params open the corresponding modal as soon
  // as the markets query returns the row.
  const [editMarketId, setEditMarketId] = useState<string | null>(deepLink.edit);
  const [settleMarketId, setSettleMarketId] = useState<string | null>(deepLink.resolve);
  const [voidMarketId, setVoidMarketId] = useState<string | null>(null);
  const [deleteWorldMarket, setDeleteWorldMarket] = useState<{ id: string; title: string } | null>(null);

  const [nativeVisFilter, setNativeVisFilter] = useState("all");
  const [nativeCatFilter, setNativeCatFilter] = useState("all");
  const [nativeSearchQuery, setNativeSearchQuery] = useState("");
  const [h2hMarketSearch, setH2hMarketSearch] = useState("");
  const [gainerMarketSearch, setGainerMarketSearch] = useState("");
  const [pollSearchQuery, setPollSearchQuery] = useState("");
  const [matchupSearchQuery, setMatchupSearchQuery] = useState("");
  const [matchupVisFilter, setMatchupVisFilter] = useState("all");
  const [matchupSortOrder, setMatchupSortOrder] = useState<RecencySort>("default");
  const [selectedNativeIds, setSelectedNativeIds] = useState<Set<string>>(new Set());
  const [h2hModalOpen, setH2hModalOpen] = useState(false);
  const [gainerModalOpen, setGainerModalOpen] = useState(false);
  const [h2hPersonASearch, setH2hPersonASearch] = useState("");
  const [h2hPersonBSearch, setH2hPersonBSearch] = useState("");
  const [h2hPersonAId, setH2hPersonAId] = useState("");
  const [h2hPersonBId, setH2hPersonBId] = useState("");
  const [h2hCategory, setH2hCategory] = useState("misc");
  const [h2hSecondaryCategories, setH2hSecondaryCategories] = useState<string[]>([]);
  const [gainerCategory, setGainerCategory] = useState<string>("tech");
  const [gainerPersonIds, setGainerPersonIds] = useState<string[]>([]);
  const [gainerPersonSearch, setGainerPersonSearch] = useState("");
  const [showOpinionPollModal, setShowOpinionPollModal] = useState(false);
  const [editingOpinionPoll, setEditingOpinionPoll] = useState<any | null>(null);
  const [opinionPollFilter, setOpinionPollFilter] = useState<string>("all");
  const [opinionPollCategoryFilter, setOpinionPollCategoryFilter] = useState<string>("all");
  const [opinionPollSearchQuery, setOpinionPollSearchQuery] = useState("");
  const [opinionPollSortOrder, setOpinionPollSortOrder] = useState<RecencySort>("default");
  const [opinionPollForm, setOpinionPollForm] = useState({
    title: "",
    slug: "",
    category: "tech",
    secondaryCategories: [] as string[],
    description: "",
    summary: "",
    imageUrl: "",
    featured: false,
    visibility: "draft" as "draft" | "live" | "archived",
    options: [{ name: "", imageUrl: "", personId: "", seedCount: 0 }, { name: "", imageUrl: "", personId: "", seedCount: 0 }, { name: "", imageUrl: "", personId: "", seedCount: 0 }] as Array<{ name: string; imageUrl: string; personId: string; seedCount: number }>,
  });
  const [opOptionSearchInputs, setOpOptionSearchInputs] = useState<string[]>(["", "", ""]);
  const [opOptionSearchResults, setOpOptionSearchResults] = useState<any[][]>([[], [], []]);
  const [opOptionShowDropdown, setOpOptionShowDropdown] = useState<boolean[]>([false, false, false]);
  const [opinionPollRelatedPeople, setOpinionPollRelatedPeople] = useState<{ id: string; name: string }[]>([]);
  const [opinionPollGeoEnabled, setOpinionPollGeoEnabled] = useState(false);
  const [opinionPollGeoCountries, setOpinionPollGeoCountries] = useState<string[]>([]);
  const [isGeneratingPollSubject, setIsGeneratingPollSubject] = useState(false);
  const [isGeneratingPollDescription, setIsGeneratingPollDescription] = useState(false);
  const [isGeneratingOpSubject, setIsGeneratingOpSubject] = useState(false);
  const [isGeneratingOpDescription, setIsGeneratingOpDescription] = useState(false);
  const [isGeneratingMatchupDescription, setIsGeneratingMatchupDescription] = useState(false);

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

  // Fetch users for moderation - only when admin and on users section.
  // When `userFilter === "drift"` we swap in /api/admin/credit-drift-users
  // which returns the same UserProfile shape plus `drift` + `ledgerSum`
  // for inline display and the Reconcile action.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUserSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setUserPage(1);
  }, [debouncedUserSearch, userFilter, userSort, userKindFilter, userStatusFilter, userActiveFilter]);

  const { data: usersList, isLoading: usersLoading } = useQuery<AdminUsersListResponse>({
    queryKey: [
      "/api/admin/users",
      userFilter,
      debouncedUserSearch,
      userPage,
      userSort,
      userKindFilter,
      userStatusFilter,
      userActiveFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(userPage),
        pageSize: String(ADMIN_USERS_PAGE_SIZE),
      });
      if (debouncedUserSearch) params.set("search", debouncedUserSearch);
      if (userFilter !== "drift") {
        params.set("sort", userSort);
        params.set("kind", userKindFilter);
        if (userStatusFilter !== "all") params.set("status", userStatusFilter);
        if (userActiveFilter !== "any") params.set("active", userActiveFilter);
      }
      const base =
        userFilter === "drift"
          ? "/api/admin/credit-drift-users"
          : "/api/admin/users";
      const res = await fetchWithAuth(`${base}?${params.toString()}`);
      if (!res.ok) {
        throw new Error(
          userFilter === "drift"
            ? "Failed to fetch credit drift users"
            : "Failed to fetch users",
        );
      }
      return res.json();
    },
    enabled: isAdmin && activeSection === "users",
  });

  // After deletes or filter changes, the current page can be past the end.
  useEffect(() => {
    if (!usersList || usersList.totalPages === 0) return;
    if (userPage > usersList.totalPages) {
      setUserPage(usersList.totalPages);
    }
  }, [usersList, userPage]);

  const displayUsers = usersList?.users ?? [];
  const userListStart =
    usersList && usersList.total > 0
      ? (usersList.page - 1) * usersList.pageSize + 1
      : 0;
  const userListEnd = usersList
    ? Math.min(usersList.page * usersList.pageSize, usersList.total)
    : 0;

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

  // Front-end sort override for the PUBLIC World Markets feed (Predict CMS
  // knob, persisted server-side). Distinct from rwSortBy, which only sorts
  // this admin list.
  const { data: predictCmsSettings } = useQuery<{ worldMarketsSortMode: string }>({
    queryKey: ["/api/admin/predict-cms-settings"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/predict-cms-settings");
      if (!res.ok) throw new Error("Failed to fetch Predict CMS settings");
      return res.json();
    },
    enabled: isAdmin && activeSection === "predictions",
  });
  const frontendSortMutation = useMutation({
    mutationFn: async (mode: string) => {
      const res = await fetchWithAuth("/api/admin/predict-cms-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldMarketsSortMode: mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to update front-end sort");
      }
      return res.json();
    },
    onSuccess: (data: { worldMarketsSortMode: string }) => {
      queryClient.setQueryData(["/api/admin/predict-cms-settings"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] });
      toast.success("Front-end sort updated", {
        description: "The public World Markets feed now uses this order for everyone.",
      });
    },
    onError: (e: Error) =>
      toast.error("Could not update front-end sort", { description: e.message }),
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

  const { data: opsSummary } = useQuery<{
    pendingCount: number;
    aiResolveNowCount: number;
    stuckCount: number;
    closingSoonCount: number;
    resolverLastRunAt: string | null;
    resolverAgeMinutes: number | null;
    resolverHealthy: boolean;
    driftUserCount: number;
  }>({
    queryKey: ["/api/admin/ops-summary"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/ops-summary");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAdmin,
    refetchInterval: 120000,
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
    enabled: isAdmin && (activeSection === "celebrities" || activeSection === "voting" || activeSection === "predictions"),
  });

  // Registry categories power the celebrity editor dropdown so admin-added categories appear here too.
  const { data: adminCategoryRows } = useQuery<Array<{ id: string; label: string; sortOrder: number }>>({
    queryKey: ["/api/admin/categories"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/categories");
      if (!res.ok) throw new Error("Failed to fetch admin categories");
      return res.json();
    },
    enabled: isAdmin,
  });

  const celebrityCategoryOptions = useMemo(() => {
    const fallback = MARKET_CATEGORY_OPTIONS.map((c) => c.label);
    const set = new Set<string>(fallback);
    (adminCategoryRows || []).forEach((row) => {
      if (row?.label?.trim()) set.add(row.label.trim());
    });
    if (celebrityForm.category?.trim()) set.add(celebrityForm.category.trim());
    return Array.from(set);
  }, [adminCategoryRows, celebrityForm.category]);

  /** Registry-backed { value: id, label } for admin selects; falls back to static list while loading. */
  const adminCategorySelectOptions = useMemo(() => {
    const rows = adminCategoryRows ?? [];
    if (rows.length > 0) {
      return [...rows]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
        .map((r) => ({ value: r.id, label: r.label }));
    }
    return MARKET_CATEGORY_OPTIONS.map((c) => ({ value: c.value, label: c.label }));
  }, [adminCategoryRows]);

  const gainerCategoryCelebrities = useMemo(
    () => (celebrities || []).filter((celebrity) => normalizeMarketCategory(celebrity.category) === gainerCategory),
    [celebrities, gainerCategory]
  );

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

  // Fetch matchups - only when admin and on cms section
  const { data: matchups, isLoading: matchupsLoading } = useQuery<Matchup[]>({
    queryKey: ["/api/admin/matchups"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/matchups");
      if (!res.ok) throw new Error("Failed to fetch matchups");
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

  const { data: opinionPollsList, isLoading: opinionPollsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/opinion-polls"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/opinion-polls");
      if (!res.ok) throw new Error("Failed to fetch opinion polls");
      return res.json();
    },
    enabled: isAdmin && activeSection === "voting",
  });

  const { data: underratedData } = useQuery<{ data: any[]; totalCount: number }>({
    queryKey: ['/api/admin/vote/underrated'],
    enabled: isAdmin && activeSection === "voting",
  });
  const { data: inductionData } = useQuery<{ data: any[]; totalCount: number }>({
    queryKey: ['/api/admin/induction'],
    enabled: isAdmin && (activeSection === "voting" || activeSection === "celebrities"),
  });
  const { data: curateData } = useQuery<{ data: any[]; totalCount: number }>({
    queryKey: ['/api/admin/vote/curate-profile'],
    enabled: isAdmin && activeSection === "voting",
  });

  // Fetch comments for moderation
  // (The legacy /api/admin/moderation/insights endpoint was removed when
  // community_insights merged into comments. Profile posts now appear in the
  // comments list with parentType=community_insight, filterable via the
  // parentType dropdown.)
  // Comment moderation filters — kept in component state, applied to the
  // query key so a change refetches with new server-side filters.
  const [commentParentFilter, setCommentParentFilter] = useState<
    "all" | "matchup" | "trending_poll" | "opinion_poll" | "open_market" | "community_insight" | "voices_post"
  >("all");
  const [commentAuthorFilter, setCommentAuthorFilter] = useState<"all" | "agents" | "humans">("all");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentSearchDebounced, setCommentSearchDebounced] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => setCommentSearchDebounced(commentSearch.trim()), 300);
    return () => clearTimeout(handle);
  }, [commentSearch]);

  const { data: moderationComments, isLoading: commentsLoading } = useQuery<InsightComment[]>({
    queryKey: [
      "/api/admin/moderation/comments",
      commentParentFilter,
      commentAuthorFilter,
      commentSearchDebounced,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (commentParentFilter !== "all") params.set("parentType", commentParentFilter);
      if (commentAuthorFilter !== "all") params.set("author", commentAuthorFilter);
      if (commentSearchDebounced) params.set("q", commentSearchDebounced);
      params.set("limit", "200");
      const res = await fetchWithAuth(`/api/admin/moderation/comments?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    enabled: isAdmin && activeSection === "moderation",
  });

  const { data: moderationQueueData, isLoading: moderationQueueLoading, refetch: refetchModerationQueue } = useQuery<{
    data: Array<{
      id: string;
      contentType: string;
      contentId: string;
      authorId: string | null;
      decision: string;
      status: string;
      provider: string;
      flagged: boolean;
      matchedCategories: string[] | null;
      sampleText: string | null;
      authorUsername: string | null;
      authorIsAgent: boolean | null;
      createdAt: string;
    }>;
  }>({
    queryKey: ["/api/admin/moderation/queue", "pending"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/moderation/queue?status=pending&limit=100");
      if (!res.ok) throw new Error("Failed to fetch moderation queue");
      return res.json();
    },
    enabled: isAdmin && activeSection === "moderation" && moderationSubTab === "queue",
  });

  const { data: commentReportsData, isLoading: commentReportsLoading } = useQuery<
    Array<{
      id: string;
      commentId: string;
      entityType: string;
      reporterId: string;
      reason: string | null;
      createdAt: string;
      commentBody: string | null;
      commentParentType: string | null;
      authorUsername: string | null;
      authorIsAgent: boolean | null;
    }>
  >({
    queryKey: ["/api/admin/moderation/comment-reports"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/moderation/comment-reports");
      if (!res.ok) throw new Error("Failed to fetch comment reports");
      return res.json();
    },
    enabled: isAdmin && activeSection === "moderation" && moderationSubTab === "reports",
  });

  const resolveModerationMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "remove" | "dismiss";
    }) => {
      const res = await fetchWithAuth(`/api/admin/moderation/queue/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to resolve");
      }
      return res.json();
    },
    onSuccess: () => {
      void refetchModerationQueue();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/comments"] });
      toast.success("Moderation action saved");
    },
    onError: (err: Error) => toast.error(err.message),
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
    refetchInterval: 120000,
    refetchOnWindowFocus: false,
  });

  // Force-refresh the rolling p25/p50/p75 source-stats cache (use after flipping NEWS_AGGREGATION_FLIPPED_AT)
  const refreshSourceStatsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/source-stats/refresh", { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      const stats = data?.stats;
      const newsP50 = stats?.news?.p50;
      toast("Percentile cache refreshed", { description: newsP50 != null
          ? `New news p50: ${Number(newsP50).toFixed(2)} (p25 ${Number(stats?.news?.p25).toFixed(2)} / p75 ${Number(stats?.news?.p75).toFixed(2)})`
          : "Source stats recomputed from latest snapshots." });
      refetchEngineHealth();
    },
    onError: (err: any) => {
      toast.error("Refresh failed", { description: err?.message || "Unknown error" });
    },
  });

  // Drop a deep-linked ?edit=<id> that doesn't match any market (bogus or
  // deleted id) so it can't leak edit mode into a later "Create" click.
  useEffect(() => {
    if (editMarketId && markets && !markets.some((mk) => mk.id === editMarketId)) {
      setEditMarketId(null);
    }
  }, [markets, editMarketId]);

  const settleMarket = settleMarketId ? markets?.find(m => m.id === settleMarketId) : null;
  // Prefer the admin detail endpoint so drafts / non-live markets still
  // return entries (public /api/open-markets/:slug only serves live/inactive/archived).
  const { data: settleMarketDetail } = useQuery<{
    entries: { id: string; label: string; totalStake?: number }[];
    totalParticipants?: number;
  }>({
    queryKey: ["/api/admin/open-markets", settleMarket?.id],
    queryFn: async () => {
      if (!settleMarket?.id) return { entries: [] };
      const res = await fetchWithAuth(`/api/admin/open-markets/${settleMarket.id}`);
      if (!res.ok) return { entries: [] };
      return res.json();
    },
    enabled: !!settleMarket?.id,
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
      toast("Market Created", { description: "Real-world market created successfully." });
    },
    onError: (err: Error) => {
      toast.error("Error", { description: err.message });
    },
  });

  const updateMarketMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetchWithAuth(`/api/admin/open-markets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update market");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      setEditMarketId(null);
      toast("Market Updated", { description: "Real-world market updated successfully." });
    },
    onError: (err: Error) => {
      toast.error("Error", { description: err.message });
    },
  });

  // Settlement now runs through the shared <AmmResolutionDialog>, which owns
  // its own resolve/void mutations (engine-aware URLs, AMM payout preview,
  // AI scout panel). The legacy bespoke settleMarketMutation was removed.

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
      toast("Market Voided", { description: "Market has been voided." });
    },
    onError: (err: Error) => {
      toast.error("Error", { description: err.message });
    },
  });

  const deleteOpenMarketMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/open-markets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(err.message || err.error || "Failed to delete market");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/open-markets"] });
      setDeleteWorldMarket(null);
      toast("Market deleted", { description: "This world market has been permanently removed." });
    },
    onError: (err: Error) => {
      toast.error("Error", { description: err.message });
    },
  });

  // Lazy-load SerpApi autocomplete suggestions for a person in the Trends audit
  // Lookup popover. Results are cached in-memory for the session (and the
  // server caches them 24h via apiCache) so re-opening is instant.
  const loadTrendsSuggestionsFor = async (personId: string, name: string) => {
    setTrendsSuggestionsByPerson(prev => {
      const existing = prev[personId];
      if (existing && (existing.suggestions.length > 0 || existing.loading)) return prev;
      return { ...prev, [personId]: { loading: true, suggestions: [] } };
    });
    try {
      const res = await fetchWithAuth("/api/admin/trends-topic-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: name }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setTrendsSuggestionsByPerson(prev => ({
          ...prev,
          [personId]: { loading: false, suggestions: [], error: `HTTP ${res.status}${text ? `: ${text}` : ""}` },
        }));
        return;
      }
      const data = await res.json();
      const suggestions: TrendsSuggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setTrendsSuggestionsByPerson(prev => ({
        ...prev,
        [personId]: { loading: false, suggestions },
      }));
    } catch (err) {
      setTrendsSuggestionsByPerson(prev => ({
        ...prev,
        [personId]: { loading: false, suggestions: [], error: (err as Error).message },
      }));
    }
  };

  // Persist a Topic ID for a person (or clear it by passing ""). Updates the
  // current trends-audit row in place and invalidates the celebrities list so
  // the Celebrities tab edit modal stays consistent.
  const applyTrendsTopicId = async (personId: string, topicId: string) => {
    setTrendsSavingPersonId(personId);
    try {
      const res = await fetchWithAuth(`/api/admin/celebrities/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleTrendsTopicId: topicId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        toast.error("Save failed", { description: `HTTP ${res.status}${text ? `: ${text}` : ""}` });
        return;
      }
      const normalized = topicId.trim();
      setTrendsAuditResults((prev: any) => {
        if (!prev?.results) return prev;
        return {
          ...prev,
          results: prev.results.map((r: any) =>
            r.personId === personId
              ? { ...r, googleTrendsTopicId: normalized || null, hasTopicId: !!normalized }
              : r,
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
      toast.success(normalized ? "Topic ID saved" : "Topic ID cleared", {
        description: normalized ? normalized : "Will fall back to name search on next 12h cycle.",
      });
    } catch (err) {
      toast.error("Save error", { description: (err as Error).message });
    } finally {
      setTrendsSavingPersonId(null);
    }
  };

  // System tool mutations
  const refreshDataMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/refresh-data", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh data");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Data Refreshed", { description: `Processed ${data.processed} celebrities in ${data.duration}ms` });
      refetchStats();
    },
    onError: (error: any) => {
      toast.error("Refresh Failed", { description: error.message });
    },
  });

  const runScoringMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/run-scoring", { method: "POST" });
      if (!res.ok) throw new Error("Failed to run scoring");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Scoring Complete", { description: `Updated rankings for ${data.processed} celebrities` });
      refetchStats();
    },
    onError: (error: any) => {
      toast.error("Scoring Failed", { description: error.message });
    },
  });

  // NOTE: captureSnapshotsMutation was removed along with its backing endpoint.
  // /api/admin/capture-snapshots always returned 0 — snapshots are written
  // only by the hourly ingest job. Use "Refresh Data" to force a run.

  // Seed approval data mutation
  const seedApprovalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/seed-approval", { method: "POST" });
      if (!res.ok) throw new Error("Failed to seed approval data");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Approval Data Seeded", { description: `Seeded ${data.seeded} celebrities, skipped ${data.skipped}` });
      refetchStats();
    },
    onError: (error: any) => {
      toast.error("Seeding Failed", { description: error.message });
    },
  });

  const syncCurateImagesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/sync-curate-images", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync curate images");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Curate Images Synced", { description: `Synced ${data.totalSynced} image(s) across ${data.peopleProcessed} people (${data.totalPeopleScanned} scanned)` });
    },
    onError: (error: any) => {
      toast.error("Sync Failed", { description: error.message });
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
      toast("Vox Adjusted", { description: `Successfully adjusted Vox for user` });
      setShowCreditModal(false);
      setSelectedUser(null);
      setCreditAdjustment({ amount: 0, reason: "" });
      setConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast.error("Adjustment Failed", { description: error.message });
    },
  });

  // Ban user mutation
  const banUserMutation = useMutation({
    mutationFn: async (params: { userId: string; reason: string }) => {
      const res = await fetchWithAuth("/api/admin/ban-user", { 
        method: "POST", 
        body: JSON.stringify(params) 
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to ban user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("User Banned", { description: "User has been banned from the platform" });
      setShowBanUserModal(false);
      setBanUserTarget(null);
      setBanUserReason("");
      setBanUserConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast.error("Ban Failed", { description: error.message });
    },
  });

  // Unban user mutation — mirror of ban, restores role to plain 'user'.
  const unbanUserMutation = useMutation({
    mutationFn: async (params: { userId: string; reason: string }) => {
      const res = await fetchWithAuth("/api/admin/unban-user", {
        method: "POST",
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to unban user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("User Unbanned", { description: "User access has been restored" });
      setShowUnbanUserModal(false);
      setUnbanUserTarget(null);
      setUnbanUserReason("");
      setUnbanUserConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast.error("Unban Failed", { description: error.message });
    },
  });

  // Per-user wallet/ledger drift reconciliation. Writes one
  // `manual_drift_reconciliation` ledger row equal to `wallet - ledgerSum`
  // for the target user, bringing their ledger audit trail back into
  // line with their (authoritative) wallet balance. Idempotent per
  // (userId, wallet) on the server.
  const reconcileDriftMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetchWithAuth(`/api/admin/users/${userId}/reconcile-drift`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.message || body?.error || "Failed to reconcile drift");
      }
      return body as
        | { noop: true; alreadyReconciled?: boolean; message?: string }
        | { noop: false; wallet: number; ledgerSumBefore: number; ledgerSumAfter: number; delta: number };
    },
    onSuccess: (data) => {
      if ("noop" in data && data.noop) {
        toast("Already reconciled", {
          description: data.message ?? "No drift to close on this user.",
        });
      } else if (!data.noop) {
        toast.success("Drift reconciled", {
          description: `Wrote a ${data.delta >= 0 ? "+" : ""}${formatVox(data.delta)} ledger row. Ledger now matches wallet (${formatVox(data.wallet)}).`,
        });
      }
      setReconcileDriftTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
    },
    onError: (error: any) => {
      toast.error("Reconcile Failed", { description: error?.message ?? String(error) });
    },
  });

  // Hard-delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (params: { userId: string; reason: string }) => {
      const res = await fetchWithAuth("/api/admin/delete-user", {
        method: "POST",
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to delete user");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("User Deleted", { description: "User account and auth record were permanently removed" });
      setShowDeleteUserModal(false);
      setDeleteUserTarget(null);
      setDeleteUserReason("");
      setDeleteUserConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  const uploadCurateProfileImages = useCallback(async (personId: string, files: File[]) => {
    const client = await getSupabase();
    const { data: { session } } = await client.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated");
    const failures: string[] = [];
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source", "admin_upload");
      const res = await fetch(`/api/admin/vote/curate-profile/${personId}/images`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        failures.push(`${file.name}: ${(err as { error?: string }).error || res.statusText}`);
      }
    }
    return failures;
  }, []);

  // Celebrity mutations
  const createCelebrityMutation = useMutation({
    mutationFn: async (input: { form: typeof celebrityForm; galleryFiles: File[] }) => {
      const { form, galleryFiles } = input;
      const res = await fetchWithAuth("/api/admin/celebrities", { 
        method: "POST", 
        body: JSON.stringify(form) 
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to create celebrity");
      }
      const created = await res.json();
      return { created, galleryFiles };
    },
    onSuccess: async ({ created, galleryFiles }) => {
      const personId = created.id as string;
      try {
        if (galleryFiles.length > 0) {
          setCelebrityGalleryUploading(true);
          const failures = await uploadCurateProfileImages(personId, galleryFiles);
          if (failures.length > 0) {
            toast.error("Celebrity created", { description: `Image upload issues: ${failures.slice(0, 2).join(" · ")}${failures.length > 2 ? " …" : ""} Remove extras in Curate Profile if needed.` });
          } else {
            toast("Celebrity created", { description: `New celebrity added with ${galleryFiles.length} image(s) in Supabase.` });
          }
        } else {
          toast("Celebrity Created", { description: "New celebrity added successfully" });
        }
      } finally {
        setCelebrityGalleryUploading(false);
        setPendingCelebrityGalleryFiles([]);
      }
      setShowCelebrityModal(false);
      setEditingCelebrity(null);
      setCelebrityForm({ ...EMPTY_CELEBRITY_FORM });
      setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
      setSeedApprovalLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vote/curate-profile"] });
    },
    onError: (error: any) => {
      toast.error("Create Failed", { description: error.message });
    },
  });

  const updateCelebrityMutation = useMutation({
    mutationFn: async ({ id, data, baselineCounts }: { id: string; data: typeof celebrityForm; baselineCounts?: SeedApprovalCounts }) => {
      const res = await fetchWithAuth(`/api/admin/celebrities/${id}`, {
        method: "PATCH", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update celebrity");
      }

      if (baselineCounts) {
        const seedRes = await fetchWithAuth(`/api/admin/celebrities/${id}/seed-approval-breakdown`, {
          method: "PUT",
          body: JSON.stringify({ counts: baselineCounts }),
        });
        if (!seedRes.ok) {
          const err = await seedRes.json().catch(() => ({}));
          throw new Error(err.error || "Failed to update baseline votes");
        }
      }

      return res.json();
    },
    onSuccess: () => {
      toast("Celebrity Updated", { description: "Celebrity updated successfully" });
      setShowCelebrityModal(false);
      setEditingCelebrity(null);
      setCelebrityForm({ ...EMPTY_CELEBRITY_FORM });
      setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
      setSeedApprovalLoading(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vote/curate-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trending?sort=rank&limit=100"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
    },
    onError: (error: any) => {
      toast.error("Update Failed", { description: error.message });
    },
  });

  const deleteCelebrityMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/celebrities/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete celebrity");
      return res.json();
    },
    onSuccess: () => {
      toast("Celebrity Deleted", { description: "Celebrity removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  const demoteCelebrityMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/celebrities/${id}/demote-to-induction`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to demote celebrity");
      }
      return res.json();
    },
    onSuccess: (data: { message?: string }) => {
      toast("Demoted to induction queue", {
        description: data.message ?? "Removed from main leaderboard; active in vote queue.",
      });
      setDemoteCelebrityTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/celebrities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vote/induction"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/vote/curate-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trending?sort=rank&limit=100"] });
    },
    onError: (error: Error) => {
      toast.error("Demote failed", { description: error.message });
    },
  });

  // Matchup mutations
  const createMatchupMutation = useMutation({
    mutationFn: async (data: typeof matchupForm) => {
      const res = await fetchWithAuth("/api/admin/matchups", { 
        method: "POST", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to create matchup");
      return res.json();
    },
    onSuccess: () => {
      toast("Matchup Created", { description: "New matchup added successfully" });
      setShowMatchupModal(false);
      setEditingMatchup(null);
      setMatchupForm({ title: "", category: "tech", secondaryCategories: [], optionAText: "", optionBText: "", optionAImage: "", optionBImage: "", personAId: "", personBId: "", promptText: "", description: "", isActive: true, visibility: "live", featured: false, slug: "", seedVotesA: 0, seedVotesB: 0 });
      setMatchupSearchA(""); setMatchupSearchB(""); setMatchupRelatedPeople([]);
      setMatchupGeoEnabled(false); setMatchupGeoCountries([]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/matchups"] });
    },
    onError: (error: any) => {
      toast.error("Create Failed", { description: error.message });
    },
  });

  const updateMatchupMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof matchupForm }) => {
      const res = await fetchWithAuth(`/api/admin/matchups/${id}`, { 
        method: "PATCH", 
        body: JSON.stringify(data) 
      });
      if (!res.ok) throw new Error("Failed to update matchup");
      return res.json();
    },
    onSuccess: () => {
      toast("Matchup Updated", { description: "Matchup updated successfully" });
      setShowMatchupModal(false);
      setEditingMatchup(null);
      setMatchupForm({ title: "", category: "tech", secondaryCategories: [], optionAText: "", optionBText: "", optionAImage: "", optionBImage: "", personAId: "", personBId: "", promptText: "", description: "", isActive: true, visibility: "live", featured: false, slug: "", seedVotesA: 0, seedVotesB: 0 });
      setMatchupSearchA(""); setMatchupSearchB(""); setMatchupRelatedPeople([]);
      setMatchupGeoEnabled(false); setMatchupGeoCountries([]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/matchups"] });
    },
    onError: (error: any) => {
      toast.error("Update Failed", { description: error.message });
    },
  });

  const deleteMatchupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/matchups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete matchup");
      return res.json();
    },
    onSuccess: () => {
      toast("Matchup Deleted", { description: "Matchup removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/matchups"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  const generateUpdownMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/native-markets/generate-updown", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Generated Up/Down Markets", { description: `Created ${data.created} markets for week ${data.weekNumber}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to generate markets" }),
  });

  const generateJackpotMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/native-markets/generate-jackpot", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Generated Jackpot Markets", { description: `Created ${data.created} jackpot entries for week ${data.weekNumber}` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to generate jackpot markets" }),
  });

  const generateGainerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/admin/native-markets/generate-gainer", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate");
      return res.json();
    },
    onSuccess: (data: any) => {
      const parts = [];
      if (data.created > 0) parts.push(`${data.created} created`);
      if (data.updated > 0) parts.push(`${data.updated} updated`);
      toast("Generated Category Races", { description: parts.length > 0 ? `Week ${data.weekNumber}: ${parts.join(", ")}` : `Week ${data.weekNumber}: already up-to-date` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to generate Category Race markets" }),
  });

  const bulkVisibilityMutation = useMutation({
    mutationFn: async ({ marketIds, visibility }: { marketIds: string[]; visibility: string }) => {
      const res = await fetchWithAuth("/api/admin/native-markets/bulk-visibility", {
        method: "POST",
        body: JSON.stringify({ marketIds, visibility }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast("Updated", { description: `${data.updated} markets updated` });
      setSelectedNativeIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to update visibility" }),
  });

  const updateNativeMarketMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; visibility?: string; featured?: boolean; inactiveMessage?: string }) => {
      const res = await fetchWithAuth(`/api/admin/native-markets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to update market" }),
  });

  const createH2hMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetchWithAuth("/api/admin/native-markets/h2h", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Created", { description: "Head-to-Head battle created" });
      setH2hModalOpen(false);
      setH2hPersonAId(""); setH2hPersonBId("");
      setH2hPersonASearch(""); setH2hPersonBSearch("");
      setH2hSecondaryCategories([]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: (err: any) => toast.error("Error", { description: err.message }),
  });

  const createGainerMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetchWithAuth("/api/admin/native-markets/gainer", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Created", { description: "Category Race market created" });
      setGainerModalOpen(false);
      setGainerPersonIds([]);
      setGainerPersonSearch("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: (err: any) => toast.error("Error", { description: err.message }),
  });

  const deleteNativeMarketMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/native-markets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      toast("Deleted", { description: "Market removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to delete" }),
  });

  const settleNativeMarketMutation = useMutation({
    mutationFn: async ({ id, winnerEntryId, notes }: { id: string; winnerEntryId?: string; notes?: string }) => {
      const res = await fetchWithAuth(`/api/admin/native-markets/${id}/settle`, {
        method: "POST",
        body: JSON.stringify({ winnerEntryId, notes }),
      });
      if (!res.ok) throw new Error("Failed to settle");
      return res.json();
    },
    onSuccess: () => {
      toast("Settled", { description: "Market resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    },
    onError: () => toast.error("Error", { description: "Failed to settle" }),
  });

  const createPollMutation = useMutation({
    mutationFn: async (data: typeof pollForm) => {
      const cleanData = {
        ...data,
        status: data.visibility === "inactive" ? "draft" : data.visibility,
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
      toast("Poll Created", { description: "New sentiment poll added successfully" });
      setShowPollModal(false);
      setEditingPoll(null);
      resetPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast.error("Create Failed", { description: error.message });
    },
  });

  const updatePollMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const cleanData = {
        ...data,
        status: data.visibility === "inactive" ? "draft" : data.visibility,
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
      toast("Poll Updated", { description: "Sentiment poll updated successfully" });
      setShowPollModal(false);
      setEditingPoll(null);
      resetPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast.error("Update Failed", { description: error.message });
    },
  });

  const deletePollMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/trending-polls/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete poll");
      return res.json();
    },
    onSuccess: () => {
      toast("Poll Deleted", { description: "Sentiment poll removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  const handlePollCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportingPollsCsv(true);
    try {
      const csvContent = await file.text();
      const res = await fetchWithAuth("/api/admin/import-sentiment-polls-csv", {
        method: "POST",
        body: JSON.stringify({ csvContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const { created, updated, skipped, warnings, errors } = data;
      const desc = `${created} created, ${updated} updated, ${skipped} skipped${warnings?.length ? `, ${warnings.length} warnings` : ''}${errors?.length ? `, ${errors.length} errors` : ''}`;
      toast("CSV Import Complete", { description: desc });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    } catch (err: any) {
      toast.error("Import Failed", { description: err.message });
    } finally {
      setImportingPollsCsv(false);
    }
  };

  const createOpinionPollMutation = useMutation({
    mutationFn: async (data: typeof opinionPollForm) => {
      const res = await fetchWithAuth("/api/admin/opinion-polls", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          options: data.options.filter(o => o.name.trim()),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errBody.error || `Server error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Opinion Poll Created");
      setShowOpinionPollModal(false);
      setEditingOpinionPoll(null);
      resetOpinionPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
    },
    onError: (error: any) => {
      toast.error("Create Failed", { description: error.message });
    },
  });

  const updateOpinionPollMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetchWithAuth(`/api/admin/opinion-polls/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...data,
          options: data.options.filter((o: any) => o.name.trim()),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errBody.error || `Server error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Opinion Poll Updated");
      setShowOpinionPollModal(false);
      setEditingOpinionPoll(null);
      resetOpinionPollForm();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
    },
    onError: (error: any) => {
      toast.error("Update Failed", { description: error.message });
    },
  });

  const deleteOpinionPollMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/opinion-polls/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete opinion poll");
      return res.json();
    },
    onSuccess: () => {
      toast("Opinion Poll Deleted");
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  const saveInlinePollSeeds = async (pollId: string) => {
    const edits = pollSeedEdits[pollId];
    if (!edits) return;
    setSavingRowIds(prev => new Set(prev).add(pollId));
    try {
      const res = await fetchWithAuth(`/api/admin/trending-polls/${pollId}`, {
        method: "PATCH",
        body: JSON.stringify(edits),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast("Saved", { description: "Seed votes updated" });
      setPollSeedEdits(prev => { const next = { ...prev }; delete next[pollId]; return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
    } catch {
      toast.error("Save Failed");
    } finally {
      setSavingRowIds(prev => { const next = new Set(prev); next.delete(pollId); return next; });
    }
  };

  const saveInlineMatchupSeeds = async (matchupId: string) => {
    const edits = matchupSeedEdits[matchupId];
    if (!edits) return;
    setSavingRowIds(prev => new Set(prev).add(matchupId));
    try {
      const res = await fetchWithAuth(`/api/admin/matchups/${matchupId}`, {
        method: "PATCH",
        body: JSON.stringify(edits),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast("Saved", { description: "Seed votes updated" });
      setMatchupSeedEdits(prev => { const next = { ...prev }; delete next[matchupId]; return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/matchups"] });
    } catch {
      toast.error("Save Failed");
    } finally {
      setSavingRowIds(prev => { const next = new Set(prev); next.delete(matchupId); return next; });
    }
  };

  const saveInlineOpinionSeeds = async (pollId: string) => {
    const edits = opinionSeedEdits[pollId];
    if (!edits) return;
    setSavingRowIds(prev => new Set(prev).add(pollId));
    try {
      const res = await fetchWithAuth(`/api/admin/opinion-polls/${pollId}`, {
        method: "PATCH",
        body: JSON.stringify({ options: edits.options.filter(o => o.name.trim()) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast("Saved", { description: "Seed votes updated" });
      setOpinionSeedEdits(prev => { const next = { ...prev }; delete next[pollId]; return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
    } catch {
      toast.error("Save Failed");
    } finally {
      setSavingRowIds(prev => { const next = new Set(prev); next.delete(pollId); return next; });
    }
  };

  // Moderation mutations
  const deleteCommentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`/api/admin/moderation/comments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete comment");
      return res.json();
    },
    onSuccess: () => {
      toast("Comment Deleted", { description: "Comment removed successfully" });
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/comments"] });
    },
    onError: (error: any) => {
      toast.error("Delete Failed", { description: error.message });
    },
  });

  // Inline edit state for the moderation comments list. Only one comment
  // can be in edit mode at a time; opening another cancels the first.
  // Edits are restricted server-side to agent-authored comments — the UI
  // mirrors that by only rendering the pencil button for is_agent rows.
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState<string>("");

  const editCommentMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetchWithAuth(`/api/admin/moderation/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(errPayload?.error ?? "Failed to edit comment");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.unchanged) {
        toast("No Changes", { description: "Comment body was unchanged" });
      } else {
        toast("Comment Updated", { description: "Agent comment edited successfully" });
      }
      setEditingCommentId(null);
      setEditingCommentDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/moderation/comments"] });
    },
    onError: (error: Error) => {
      toast.error("Edit Failed", { description: error.message });
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
      toast("Entity Diagnostics Complete", { description: `Analyzed ${data.total} celebrities` });
    } catch (error: any) {
      toast.error("Diagnostics Failed", { description: error.message });
    } finally {
      setEntityDiagLoading(false);
    }
  }, []);

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

  const filteredOpinionPolls = useMemo(() => {
    const filtered = (opinionPollsList || []).filter((poll: any) => {
      if (opinionPollFilter !== "all" && poll.visibility !== opinionPollFilter) return false;
      if (
        opinionPollCategoryFilter !== "all" &&
        normalizeMarketCategory(poll.category) !== opinionPollCategoryFilter
      )
        return false;
      if (opinionPollSearchQuery && !poll.title?.toLowerCase().includes(opinionPollSearchQuery.toLowerCase())) return false;
      return true;
    });
    return sortByRecency(filtered, opinionPollSortOrder, (poll: any) => poll.createdAt);
  }, [opinionPollsList, opinionPollFilter, opinionPollCategoryFilter, opinionPollSearchQuery, opinionPollSortOrder]);

  const filteredPolls = useMemo(() => {
    const filtered = trendingPollsList?.filter((poll) => {
      if (pollFilter === "missing_image") {
        return poll.status === "draft" && !poll.personId && !poll.imageUrl;
      }
      if (pollFilter !== "all" && poll.status !== pollFilter) return false;
      if (pollCategoryFilter !== "all" && normalizeMarketCategory(poll.category) !== pollCategoryFilter)
        return false;
      if (pollSearchQuery && !poll.headline?.toLowerCase().includes(pollSearchQuery.toLowerCase()) && !poll.subjectText?.toLowerCase().includes(pollSearchQuery.toLowerCase())) return false;
      return true;
    }) ?? [];
    return sortByRecency(filtered, pollSortOrder, (poll) => poll.createdAt);
  }, [trendingPollsList, pollFilter, pollCategoryFilter, pollSearchQuery, pollSortOrder]);

  const filteredMatchups = useMemo(() => {
    const filtered = (matchups || []).filter((matchup) => {
      if (matchupVisFilter !== "all" && matchup.visibility !== matchupVisFilter) return false;
      if (matchupSearchQuery) {
        const q = matchupSearchQuery.toLowerCase();
        if (!matchup.title?.toLowerCase().includes(q) && !matchup.optionAText?.toLowerCase().includes(q) && !matchup.optionBText?.toLowerCase().includes(q) && !matchup.category?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    return sortByRecency(filtered, matchupSortOrder, (matchup: any) => matchup.createdAt);
  }, [matchups, matchupVisFilter, matchupSearchQuery, matchupSortOrder]);

  const canReorderSentimentPolls =
    pollFilter === "all" && pollCategoryFilter === "all" && !pollSearchQuery.trim() && pollSortOrder === "default";
  const canReorderOpinionPolls =
    opinionPollFilter === "all" && opinionPollCategoryFilter === "all" && !opinionPollSearchQuery.trim() && opinionPollSortOrder === "default";
  const canReorderMatchups = matchupVisFilter === "all" && !matchupSearchQuery.trim() && matchupSortOrder === "default";

  const activeInductionNameKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of inductionData?.data ?? []) {
      if (c.isActive !== false) {
        keys.add(String(c.displayName).trim().toLowerCase());
      }
    }
    return keys;
  }, [inductionData]);

  const activeInductionQueueCount = useMemo(
    () => inductionData?.data?.filter((c) => c.isActive !== false).length ?? 0,
    [inductionData],
  );

  const matchesActiveInductionQueue = (c: Celebrity) =>
    c.status === "induction" &&
    activeInductionNameKeys.has(c.name.trim().toLowerCase());

  const filteredCelebrities = useMemo(() => celebrities?.filter(c => {
    if (celebrityStatusFilter === "induction") {
      if (!matchesActiveInductionQueue(c)) return false;
    } else if (celebrityStatusFilter !== "all" && c.status !== celebrityStatusFilter) return false;
    if (celebritySearch === "") return true;
    return (
      c.name.toLowerCase().includes(celebritySearch.toLowerCase()) ||
      c.category.toLowerCase().includes(celebritySearch.toLowerCase())
    );
  }) ?? [], [celebrities, celebritySearch, celebrityStatusFilter, activeInductionNameKeys]);

  const celebrityStatusCounts = useMemo(() => {
    const counts = { main_leaderboard: 0, induction: 0, all: 0 };
    if (celebrities) {
      for (const c of celebrities) {
        counts.all += 1;
        if (c.status === "main_leaderboard") counts.main_leaderboard += 1;
        else if (matchesActiveInductionQueue(c)) counts.induction += 1;
      }
    }
    return counts;
  }, [celebrities, activeInductionNameKeys]);

  const jMarkets = useMemo(() => (markets || []).filter(m => m.marketType === "jackpot").filter(m => {
    if (nativeVisFilter !== "all" && m.visibility !== nativeVisFilter) return false;
    if (nativeSearchQuery && !m.title?.toLowerCase().includes(nativeSearchQuery.toLowerCase())) return false;
    return true;
  }), [markets, nativeVisFilter, nativeSearchQuery]);

  /** Seed-approval baseline stats (must stay above conditional returns — Rules of Hooks) */
  const baselineTotalVotes = useMemo(
    () => seedApprovalCounts["1"] + seedApprovalCounts["2"] + seedApprovalCounts["3"] + seedApprovalCounts["4"] + seedApprovalCounts["5"],
    [seedApprovalCounts],
  );
  const baselineImpliedAvg = useMemo(() => {
    if (baselineTotalVotes <= 0) return 0;
    const weighted =
      seedApprovalCounts["1"] * 1 +
      seedApprovalCounts["2"] * 2 +
      seedApprovalCounts["3"] * 3 +
      seedApprovalCounts["4"] * 4 +
      seedApprovalCounts["5"] * 5;
    return weighted / baselineTotalVotes;
  }, [baselineTotalVotes, seedApprovalCounts]);

  // ============ CONDITIONAL RENDERING (after all hooks) ============
  const adminAccessBlock = getAdminAccessBlock({
    profileLoading,
    user,
    profile,
    isAdmin,
    onGoHome: () => setLocation("/"),
  });
  if (adminAccessBlock) return adminAccessBlock;

  // ============ ADMIN DASHBOARD UI ============

  const sidebarItems = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "celebrities" as const, label: "Celebrities", icon: Star },
    { id: "predictions" as const, label: "Prediction CMS", icon: BarChart3 },
    { id: "voting" as const, label: "Voting CMS", icon: Megaphone },
    { id: "moderation" as const, label: "Moderation", icon: Shield },
    { id: "settlement" as const, label: "Settlement", icon: Gavel },
    { id: "amm" as const, label: "AMM", icon: Activity },
    { id: "users" as const, label: "Users", icon: Users },
    { id: "gamification" as const, label: "Gamification CMS", icon: Trophy },
    { id: "agents" as const, label: "Agents", icon: Bot },
    { id: "categories" as const, label: "Categories", icon: Layers },
    { id: "branding" as const, label: "Branding & Marketing", icon: Palette },
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

  const openDeleteUserModal = (user: UserProfile) => {
    setDeleteUserTarget(user);
    setDeleteUserReason("");
    setDeleteUserConfirmText("");
    setShowDeleteUserModal(true);
  };

  const handleDeleteUser = () => {
    if (!deleteUserTarget || deleteUserConfirmText !== "DELETE" || !deleteUserReason.trim()) return;
    deleteUserMutation.mutate({
      userId: deleteUserTarget.id,
      reason: deleteUserReason.trim(),
    });
  };

  const openBanUserModal = (user: UserProfile) => {
    setBanUserTarget(user);
    setBanUserReason("");
    setBanUserConfirmText("");
    setShowBanUserModal(true);
  };

  const handleBanUser = () => {
    if (!banUserTarget || banUserConfirmText !== "BAN" || !banUserReason.trim()) return;
    banUserMutation.mutate({
      userId: banUserTarget.id,
      reason: banUserReason.trim(),
    });
  };

  const openUnbanUserModal = (user: UserProfile) => {
    setUnbanUserTarget(user);
    setUnbanUserReason("");
    setUnbanUserConfirmText("");
    setShowUnbanUserModal(true);
  };

  const handleUnbanUser = () => {
    if (!unbanUserTarget || unbanUserConfirmText !== "UNBAN" || !unbanUserReason.trim()) return;
    unbanUserMutation.mutate({
      userId: unbanUserTarget.id,
      reason: unbanUserReason.trim(),
    });
  };

  const openEditCelebrity = (celebrity: Celebrity) => {
    setSeedApprovalLoading(true);
    setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
    setPendingCelebrityGalleryFiles([]);
    setEditingCelebrity(celebrity);

    const matchedCandidate = inductionData?.data?.find(
      (c) =>
        c.isActive !== false &&
        String(c.displayName).trim().toLowerCase() === celebrity.name.trim().toLowerCase(),
    );

    const isInductionShadow = celebrity.status === "induction";
    setCelebrityForm({
      name: celebrity.name,
      category: celebrity.category,
      secondaryCategories: ((celebrity as any).secondaryCategories as string[] | null) ?? [],
      status: isInductionShadow ? "induction" : (celebrity.status || "main_leaderboard"),
      wikiSlug: celebrity.wikiSlug || matchedCandidate?.wikiSlug || "",
      xHandle: celebrity.xHandle || matchedCandidate?.xHandle || "",
      instagramHandle: celebrity.instagramHandle || matchedCandidate?.instagramHandle || "",
      tiktokHandle: celebrity.tiktokHandle || matchedCandidate?.tiktokHandle || "",
      youtubeId: celebrity.youtubeId || matchedCandidate?.youtubeId || "",
      spotifyId: celebrity.spotifyId || matchedCandidate?.spotifyId || "",
      searchQueryOverride:
        celebrity.searchQueryOverride || matchedCandidate?.searchQueryOverride || "",
      googleTrendsTopicId:
        celebrity.googleTrendsTopicId || matchedCandidate?.googleTrendsTopicId || "",
    });
    setShowCelebrityModal(true);
    fetchWithAuth(`/api/admin/celebrities/${celebrity.id}/seed-approval-breakdown`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch seed approval breakdown");
        const data = await res.json();
        const counts = data?.counts || {};
        setSeedApprovalCounts({
          "1": Math.max(0, Number(counts["1"]) || 0),
          "2": Math.max(0, Number(counts["2"]) || 0),
          "3": Math.max(0, Number(counts["3"]) || 0),
          "4": Math.max(0, Number(counts["4"]) || 0),
          "5": Math.max(0, Number(counts["5"]) || 0),
        });
      })
      .catch((error) => {
        console.error("Failed to load seed approval breakdown", error);
        toast.error("Seed votes unavailable", { description: "Could not load baseline seed votes. You can still edit standard fields." });
      })
      .finally(() => setSeedApprovalLoading(false));
  };

  const openEditMatchup = (matchup: Matchup) => {
    setEditingMatchup(matchup);
    setMatchupForm({
      title: matchup.title,
      category: normalizeMarketCategory(matchup.category),
      secondaryCategories: ((matchup as any).secondaryCategories as string[] | null) ?? [],
      optionAText: matchup.optionAText,
      optionBText: matchup.optionBText,
      optionAImage: matchup.optionAImage || "",
      optionBImage: matchup.optionBImage || "",
      personAId: matchup.personAId || "",
      personBId: matchup.personBId || "",
      promptText: matchup.promptText || "",
      description: (matchup as any).description || "",
      isActive: matchup.isActive,
      visibility: matchup.visibility || "live",
      featured: matchup.featured || false,
      slug: matchup.slug || "",
      seedVotesA: matchup.seedVotesA || 0,
      seedVotesB: matchup.seedVotesB || 0,
    });
    setMatchupSearchA("");
    setMatchupSearchB("");
    setMatchupRelatedPeople((matchup as any).relatedPeople || []);
    const geo = geoStateFromAllowlist((matchup as any).visibleCountries);
    setMatchupGeoEnabled(geo.enabled);
    setMatchupGeoCountries(geo.codes);
    setShowMatchupModal(true);
  };

  const handleSaveCelebrity = () => {
    if (editingCelebrity) {
      updateCelebrityMutation.mutate({
        id: editingCelebrity.id,
        data: celebrityForm,
        baselineCounts: seedApprovalCounts,
      });
    } else {
      createCelebrityMutation.mutate({
        form: celebrityForm,
        galleryFiles: pendingCelebrityGalleryFiles,
      });
    }
  };

  const handleSaveMatchup = () => {
    if (!isGeoTargetingValid(matchupGeoEnabled, matchupGeoCountries)) {
      toast.error("Country required", { description: "Select at least one country or turn off geo targeting." });
      return;
    }
    const dataToSend: any = {
      ...matchupForm,
      title: matchupForm.optionAText && matchupForm.optionBText 
        ? `${matchupForm.optionAText} vs ${matchupForm.optionBText}` 
        : matchupForm.title || "Untitled Matchup",
      personAId: matchupForm.personAId || null,
      personBId: matchupForm.personBId || null,
      optionAImage: matchupForm.optionAImage || null,
      optionBImage: matchupForm.optionBImage || null,
      relatedPersonIds: matchupRelatedPeople.map(p => p.id),
      visibleCountries: visibleCountriesPayload(matchupGeoEnabled, matchupGeoCountries),
    };
    if (editingMatchup) {
      updateMatchupMutation.mutate({ id: editingMatchup.id, data: dataToSend });
    } else {
      createMatchupMutation.mutate(dataToSend);
    }
  };

  const resetPollForm = () => {
    setPollForm({
      status: "draft",
      category: "tech",
      secondaryCategories: [],
      headline: "",
      subjectText: "",
      personId: "",
      description: "",
      timeline: "",
      deadlineAt: "",
      imageUrl: "",
      seedAgreeCount: 0,
      seedNeutralCount: 0,
      seedDisagreeCount: 0,
      slug: "",
      featured: false,
      visibility: "draft",
    });
    setCelebritySearchInput("");
    setSelectedCelebrityName("");
    setCelebritySearchResults([]);
    setShowCelebrityDropdown(false);
    setPollRelatedPeople([]);
    setPollGeoEnabled(false);
    setPollGeoCountries([]);
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
    const vis = (poll.visibility || poll.status || "draft") as "draft" | "live" | "inactive" | "archived";
    setPollForm({
      status: poll.status as "draft" | "live" | "archived",
      category: normalizeMarketCategory(poll.category),
      secondaryCategories: ((poll as any).secondaryCategories as string[] | null) ?? [],
      headline: poll.headline,
      subjectText: poll.subjectText,
      personId: poll.personId || "",
      description: poll.description || "",
      timeline: poll.timeline || "",
      deadlineAt: dateToLocal(poll.deadlineAt),
      imageUrl: poll.imageUrl || "",
      seedAgreeCount: poll.seedAgreeCount,
      seedNeutralCount: poll.seedNeutralCount,
      seedDisagreeCount: poll.seedDisagreeCount,
      slug: poll.slug || "",
      featured: poll.featured ?? false,
      visibility: vis,
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
      }).catch((err) => {
        console.error("[AdminDashboard] Failed to fetch celebrity for poll:", err);
        toast.error("Could not load celebrity name", { description: "Using ID fallback." });
        setCelebritySearchInput(pid.slice(0, 8) + "...");
        setSelectedCelebrityName(pid.slice(0, 8) + "...");
      });
    } else {
      setCelebritySearchInput("");
      setSelectedCelebrityName("");
    }
    setPollRelatedPeople((poll as any).relatedPeople || []);
    const geo = geoStateFromAllowlist((poll as any).visibleCountries);
    setPollGeoEnabled(geo.enabled);
    setPollGeoCountries(geo.codes);
    setShowPollModal(true);
  };

  const handleSavePoll = () => {
    if (!isGeoTargetingValid(pollGeoEnabled, pollGeoCountries)) {
      toast.error("Country required", { description: "Select at least one country or turn off geo targeting." });
      return;
    }
    const dataToSend = {
      ...pollForm,
      relatedPersonIds: pollRelatedPeople.map(p => p.id),
      visibleCountries: visibleCountriesPayload(pollGeoEnabled, pollGeoCountries),
    };
    if (editingPoll) {
      updatePollMutation.mutate({ id: editingPoll.id, data: dataToSend });
    } else {
      createPollMutation.mutate(dataToSend);
    }
  };

  const handleGeneratePollDraft = async (field: "subjectText" | "description") => {
    if (!editingPoll?.id) return;
    const setLoading = field === "subjectText" ? setIsGeneratingPollSubject : setIsGeneratingPollDescription;
    const currentContent = field === "subjectText" ? pollForm.subjectText : pollForm.description;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/trending-polls/${editingPoll.id}/generate-ai-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, currentContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate draft" }));
        throw new Error(err.error || "Failed to generate draft");
      }
      const data = await res.json();
      setPollForm(prev => ({ ...prev, [field]: data.content }));
      toast("Draft generated", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOpinionPollDraft = async (field: "description" | "summary") => {
    if (!editingOpinionPoll?.id) return;
    const setLoading = field === "description" ? setIsGeneratingOpSubject : setIsGeneratingOpDescription;
    const currentContent = field === "description" ? opinionPollForm.description : opinionPollForm.summary;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/opinion-polls/${editingOpinionPoll.id}/generate-ai-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, currentContent }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate draft" }));
        throw new Error(err.error || "Failed to generate draft");
      }
      const data = await res.json();
      setOpinionPollForm(prev => ({ ...prev, [field]: data.content }));
      toast("Draft generated", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMatchupDescriptionDraft = async () => {
    if (!editingMatchup?.id) return;
    setIsGeneratingMatchupDescription(true);
    try {
      const res = await fetchWithAuth(`/api/admin/matchups/${editingMatchup.id}/generate-ai-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "description", currentContent: matchupForm.description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate draft" }));
        throw new Error(err.error || "Failed to generate draft");
      }
      const data = await res.json();
      setMatchupForm((prev) => ({ ...prev, description: data.content }));
      toast("Draft generated", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setIsGeneratingMatchupDescription(false);
    }
  };

  const resetOpinionPollForm = () => {
    setOpinionPollForm({
      title: "",
      slug: "",
      category: "tech",
      secondaryCategories: [],
      description: "",
      summary: "",
      imageUrl: "",
      featured: false,
      visibility: "draft",
      options: [{ name: "", imageUrl: "", personId: "", seedCount: 0 }, { name: "", imageUrl: "", personId: "", seedCount: 0 }, { name: "", imageUrl: "", personId: "", seedCount: 0 }],
    });
    setOpOptionSearchInputs(["", "", ""]);
    setOpOptionSearchResults([[], [], []]);
    setOpOptionShowDropdown([false, false, false]);
    setOpinionPollRelatedPeople([]);
    setOpinionPollGeoEnabled(false);
    setOpinionPollGeoCountries([]);
  };

  const openEditOpinionPoll = (poll: any) => {
    setEditingOpinionPoll(poll);
    const opts = (poll.options || []).map((o: any) => ({
      name: o.name || "",
      imageUrl: o.imageUrl || "",
      personId: o.personId || "",
      seedCount: o.seedCount || 0,
    }));
    while (opts.length < 3) opts.push({ name: "", imageUrl: "", personId: "", seedCount: 0 });
    setOpinionPollForm({
      title: poll.title || "",
      slug: poll.slug || "",
      category: normalizeMarketCategory(poll.category || "tech"),
      secondaryCategories: (poll.secondaryCategories as string[] | null) ?? [],
      description: poll.description || "",
      summary: poll.summary || "",
      imageUrl: poll.imageUrl || "",
      featured: poll.featured ?? false,
      visibility: poll.visibility || "draft",
      options: opts,
    });
    setOpOptionSearchInputs(opts.map((o: any) => o.personId ? o.name : ""));
    setOpOptionSearchResults(opts.map(() => []));
    setOpOptionShowDropdown(opts.map(() => false));
    setOpinionPollRelatedPeople(poll.relatedPeople || []);
    const geo = geoStateFromAllowlist(poll.visibleCountries);
    setOpinionPollGeoEnabled(geo.enabled);
    setOpinionPollGeoCountries(geo.codes);
    setShowOpinionPollModal(true);
  };

  const handleSaveOpinionPoll = () => {
    if (!isGeoTargetingValid(opinionPollGeoEnabled, opinionPollGeoCountries)) {
      toast.error("Country required", { description: "Select at least one country or turn off geo targeting." });
      return;
    }
    const dataToSend = {
      ...opinionPollForm,
      relatedPersonIds: opinionPollRelatedPeople.map(p => p.id),
      visibleCountries: visibleCountriesPayload(opinionPollGeoEnabled, opinionPollGeoCountries),
    };
    if (editingOpinionPoll) {
      updateOpinionPollMutation.mutate({ id: editingOpinionPoll.id, data: dataToSend });
    } else {
      createOpinionPollMutation.mutate(dataToSend);
    }
  };

  const addOpinionOption = () => {
    if (opinionPollForm.options.length >= OPINION_POLL_MAX_OPTIONS) return;
    setOpinionPollForm(prev => ({
      ...prev,
      options: [...prev.options, { name: "", imageUrl: "", personId: "", seedCount: 0 }],
    }));
    setOpOptionSearchInputs(prev => [...prev, ""]);
    setOpOptionSearchResults(prev => [...prev, []]);
    setOpOptionShowDropdown(prev => [...prev, false]);
  };

  const removeOpinionOption = (idx: number) => {
    if (opinionPollForm.options.length <= 3) return;
    setOpinionPollForm(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== idx),
    }));
    setOpOptionSearchInputs(prev => prev.filter((_, i) => i !== idx));
    setOpOptionSearchResults(prev => prev.filter((_, i) => i !== idx));
    setOpOptionShowDropdown(prev => prev.filter((_, i) => i !== idx));
  };

  const updateOpinionOption = (idx: number, field: string, value: string | number) => {
    setOpinionPollForm(prev => ({
      ...prev,
      options: prev.options.map((o, i) => i === idx ? { ...o, [field]: value } : o),
    }));
  };

  const searchCelebrityForOption = async (idx: number, query: string) => {
    setOpOptionSearchInputs(prev => { const n = [...prev]; n[idx] = query; return n; });

    if (!query.trim()) {
      setOpOptionSearchResults(prev => { const n = [...prev]; n[idx] = []; return n; });
      setOpOptionShowDropdown(prev => { const n = [...prev]; n[idx] = false; return n; });
      return;
    }

    try {
      const res = await fetchWithAuth(`/api/admin/celebrities?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setOpOptionSearchResults(prev => { const n = [...prev]; n[idx] = data.slice(0, 15); return n; });
        setOpOptionShowDropdown(prev => { const n = [...prev]; n[idx] = true; return n; });
      }
    } catch {}
  };

  const selectCelebrityForOption = (idx: number, celeb: any) => {
    updateOpinionOption(idx, "personId", celeb.id);
    updateOpinionOption(idx, "name", celeb.name);
    if (celeb.avatar) {
      updateOpinionOption(idx, "imageUrl", celeb.avatar);
    }
    setOpOptionSearchInputs(prev => { const n = [...prev]; n[idx] = celeb.name; return n; });
    setOpOptionShowDropdown(prev => { const n = [...prev]; n[idx] = false; return n; });
    setOpOptionSearchResults(prev => { const n = [...prev]; n[idx] = []; return n; });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "celebrity") {
      deleteCelebrityMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "matchup") {
      deleteMatchupMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "comment") {
      deleteCommentMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "poll") {
      deletePollMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === "opinion-poll") {
      deleteOpinionPollMutation.mutate(deleteTarget.id);
    }
  };

  const getActionBadgeColor = (actionType: string) => {
    if (actionType.startsWith("CREATE")) return "bg-emerald-500/25 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400";
    if (actionType.startsWith("UPDATE")) return "bg-amber-500/25 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400";
    if (actionType.startsWith("DELETE")) return "bg-red-500/25 dark:bg-red-500/20 text-red-600 dark:text-red-400";
    return "bg-violet-500/25 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400";
  };

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 p-4 hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen md:overflow-y-auto">
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
                  ? "bg-violet-500/25 dark:bg-violet-500/20 text-violet-500 dark:text-violet-300 border border-violet-500/50 dark:border-violet-400/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setLocation("/admin/notifications")}
            data-testid="nav-notifications"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Megaphone className="h-4 w-4" />
            Notifications
          </button>
          <button
            onClick={() => setLocation("/admin/suggestions")}
            data-testid="nav-suggestions"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Inbox className="h-4 w-4" />
            Suggestions
          </button>
        </nav>

        <div className="mt-auto pt-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/");
              }
            }}
            data-testid="button-back-to-site"
          >
            Back to Site
          </Button>
        </div>
      </aside>

      {/* Mobile nav — horizontally scrollable so all nav sections fit on a phone
          without squishing labels into 2 lines. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-xl"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          transform: adminNavViewportOffset !== 0 ? `translateY(${adminNavViewportOffset}px)` : undefined,
          willChange: 'transform',
        }}
        aria-label="Admin section navigation"
      >
        <div
          className="flex gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              data-testid={`nav-mobile-${item.id}`}
              aria-current={activeSection === item.id ? "page" : undefined}
              className={cn(
                "flex shrink-0 min-w-[64px] flex-col items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                activeSection === item.id
                  ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 pb-24 md:pb-6 overflow-auto">
        {opsSummary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <button
              onClick={() => setActiveSection("settlement")}
              className="rounded-md border p-3 text-left hover-elevate"
              data-testid="card-ops-pending"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1.5 rounded-md ${(opsSummary.pendingCount + (opsSummary.aiResolveNowCount ?? 0)) > 0 ? "bg-amber-500/15" : "bg-muted/50"}`}>
                  <Gavel className={`h-4 w-4 ${(opsSummary.pendingCount + (opsSummary.aiResolveNowCount ?? 0)) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
                </div>
                <span className="text-xs text-muted-foreground">Needs Resolution</span>
              </div>
              <p className={`text-xl font-bold ${(opsSummary.pendingCount + (opsSummary.aiResolveNowCount ?? 0)) > 0 ? "text-amber-600 dark:text-amber-400" : ""}`} data-testid="text-ops-pending-count">
                {opsSummary.pendingCount + (opsSummary.aiResolveNowCount ?? 0)}
              </p>
              {(opsSummary.aiResolveNowCount ?? 0) > 0 && (
                <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5" data-testid="text-ops-ai-flagged">
                  {opsSummary.aiResolveNowCount} AI-flagged
                </p>
              )}
              {(opsSummary.stuckCount ?? 0) > 0 && (
                <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 font-medium" data-testid="text-ops-stuck">
                  {opsSummary.stuckCount} stuck
                </p>
              )}
            </button>
            <button
              onClick={() => setActiveSection("predictions")}
              className="rounded-md border p-3 text-left hover-elevate"
              data-testid="card-ops-closing-soon"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1.5 rounded-md ${opsSummary.closingSoonCount > 0 ? "bg-blue-500/15" : "bg-muted/50"}`}>
                  <Clock className={`h-4 w-4 ${opsSummary.closingSoonCount > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} />
                </div>
                <span className="text-xs text-muted-foreground">Closing Soon</span>
              </div>
              <p className={`text-xl font-bold ${opsSummary.closingSoonCount > 0 ? "text-blue-600 dark:text-blue-400" : ""}`} data-testid="text-ops-closing-count">
                {opsSummary.closingSoonCount}
              </p>
            </button>
            <button
              onClick={() => setActiveSection("tools")}
              className="rounded-md border p-3 text-left hover-elevate"
              data-testid="card-ops-resolver"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1.5 rounded-md ${opsSummary.resolverHealthy ? "bg-green-500/15" : "bg-red-500/15"}`}>
                  <Activity className={`h-4 w-4 ${opsSummary.resolverHealthy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} />
                </div>
                <span className="text-xs text-muted-foreground">Resolver</span>
              </div>
              <p className={`text-sm font-medium ${opsSummary.resolverHealthy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-ops-resolver-status">
                {opsSummary.resolverAgeMinutes !== null ? `${opsSummary.resolverAgeMinutes}m ago` : "Not yet run"}
              </p>
            </button>
            <button
              onClick={() => {
                setActiveSection("users");
                setUserFilter(opsSummary.driftUserCount > 0 ? "drift" : "all");
              }}
              className="rounded-md border p-3 text-left hover-elevate"
              data-testid="card-ops-drift"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`p-1.5 rounded-md ${opsSummary.driftUserCount > 0 ? "bg-red-500/15" : "bg-green-500/15"}`}>
                  <AlertTriangle className={`h-4 w-4 ${opsSummary.driftUserCount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} />
                </div>
                <span className="text-xs text-muted-foreground">Credit Drift</span>
              </div>
              <p className={`text-xl font-bold ${opsSummary.driftUserCount > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} data-testid="text-ops-drift-count">
                {opsSummary.driftUserCount}
              </p>
            </button>
          </div>
        )}

        {/* Overview Section */}
        {activeSection === "overview" && (
          <div className="space-y-6">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                    <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400" data-testid="stat-traffic-today">
                      {trafficLoading ? "..." : trafficStats?.today || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Today</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-violet-600 dark:text-violet-400" data-testid="stat-traffic-week">
                      {trafficLoading ? "..." : trafficStats?.last7Days || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Last 7 Days</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-traffic-month">
                      {trafficLoading ? "..." : trafficStats?.last30Days || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Last 30 Days</p>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="stat-traffic-total">
                      {trafficLoading ? "..." : trafficStats?.total || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">All Time</p>
                  </div>
                </div>

                {(trafficStats?.humanLikeLast30Days !== undefined || trafficStats?.botLikeLast30Days !== undefined) && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      Human-like (30d): {trafficLoading ? "..." : trafficStats?.humanLikeLast30Days || 0}
                    </Badge>
                    <Badge variant="outline">
                      Bot-like (30d): {trafficLoading ? "..." : trafficStats?.botLikeLast30Days || 0}
                    </Badge>
                    <Badge variant="outline">
                      Unique human-like sessions (30d): {trafficLoading ? "..." : trafficStats?.uniqueHumanLikeSessions30Days || 0}
                    </Badge>
                  </div>
                )}
                
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

                {trafficStats?.topCountries && trafficStats.topCountries.length > 0 && (() => {
                  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
                  return (
                    <div className="mt-4 pt-4 border-t border-border">
                      <h4 className="text-sm font-medium mb-2">Top Countries (30 days, human-like)</h4>
                      <div className="space-y-2">
                        {trafficStats.topCountries.map((entry) => (
                          <div key={entry.country} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <CountryFlag code={entry.country} className="w-5 h-3.5 shrink-0" />
                              <span>{regionNames.of(entry.country) || entry.country}</span>
                            </span>
                            <Badge variant="secondary">{entry.views} views</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {trafficStats?.topReferrerDomains && trafficStats.topReferrerDomains.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h4 className="text-sm font-medium mb-2">Top Referrer Domains (30 days, human-like)</h4>
                    <div className="space-y-2">
                      {trafficStats.topReferrerDomains.map((entry) => (
                        <div key={entry.domain} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[280px]">{entry.domain}</span>
                          <Badge variant="secondary">{entry.views} views</Badge>
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
                        className="flex flex-col gap-2 p-3 rounded-lg border sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                        data-testid={`audit-log-${log.id}`}
                      >
                        <div className="flex flex-col items-start gap-2 min-w-0 sm:flex-row sm:items-center sm:gap-3">
                          <Badge
                            className={cn(
                              "text-[10px] leading-tight whitespace-normal break-all max-w-full",
                              getActionBadgeColor(log.actionType),
                            )}
                          >
                            {log.actionType}
                          </Badge>
                          <div className="min-w-0">
                            <p className="text-sm font-medium break-all sm:break-normal">{log.targetTable}</p>
                            <p className="text-xs text-muted-foreground break-all">
                              Admin: {log.adminEmail || log.adminId}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground sm:whitespace-nowrap shrink-0">
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
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Celebrities</h2>
                <p className="text-muted-foreground">Manage tracked celebrities and influencers</p>
              </div>
              <Button 
                onClick={() => {
                  setEditingCelebrity(null);
                  setCelebrityForm({ ...EMPTY_CELEBRITY_FORM });
                  setPendingCelebrityGalleryFiles([]);
                  setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
                  setSeedApprovalLoading(false);
                  setShowCelebrityModal(true);
                }}
                data-testid="button-add-celebrity"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Celebrity
              </Button>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
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
              <Select
                value={celebrityStatusFilter}
                onValueChange={(v) => setCelebrityStatusFilter(v as "main_leaderboard" | "induction" | "all")}
              >
                <SelectTrigger className="w-full sm:w-[220px]" data-testid="select-celebrity-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main_leaderboard" data-testid="filter-option-main">
                    Main Leaderboard ({celebrityStatusCounts.main_leaderboard})
                  </SelectItem>
                  <SelectItem value="induction" data-testid="filter-option-induction">
                    Induction Queue ({celebrityStatusCounts.induction})
                  </SelectItem>
                  <SelectItem value="all" data-testid="filter-option-all">
                    All ({celebrityStatusCounts.all})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Induction Queue lists everyone currently in the vote queue (same count as Voting CMS → Induction Queue).
              Edit full vote metadata (wiki, social handles, seed votes) there; use this tab for shadow profile fields.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Celebrity List</CardTitle>
                <CardDescription>
                  {celebrities
                    ? `${filteredCelebrities.length} ${
                        celebrityStatusFilter === "main_leaderboard"
                          ? "main leaderboard"
                          : celebrityStatusFilter === "induction"
                            ? "induction queue"
                            : "total"
                      } celebrit${filteredCelebrities.length === 1 ? "y" : "ies"} found`
                    : "Loading..."}
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
                        className="flex flex-col gap-3 p-3 rounded-lg border sm:flex-row sm:items-center sm:justify-between"
                        data-testid={`celebrity-row-${celebrity.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <PersonAvatar
                            name={celebrity.name}
                            avatar={celebrity.avatar}
                            imageSlug={celebrity.imageSlug}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{celebrity.name}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
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
                        <div className="flex items-center gap-2 self-end shrink-0 sm:self-auto">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 sm:h-9 sm:w-9"
                            onClick={() => {
                              setScoreBreakdownCelebrity(celebrity.id);
                              setShowScoreBreakdown(true);
                            }}
                            title="Score Breakdown"
                            aria-label="Score breakdown"
                            data-testid={`button-score-breakdown-${celebrity.id}`}
                          >
                            <Activity className="h-4 w-4" />
                          </Button>
                          {celebrity.status === "main_leaderboard" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 sm:h-9 sm:w-9"
                              onClick={() => setDemoteCelebrityTarget(celebrity)}
                              aria-label="Demote to induction queue"
                              title="Demote to induction queue"
                              data-testid={`button-demote-celebrity-${celebrity.id}`}
                            >
                              <ArrowDownToLine className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 sm:h-9 sm:w-9"
                            onClick={() => openEditCelebrity(celebrity)}
                            aria-label="Edit"
                            data-testid={`button-edit-celebrity-${celebrity.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 sm:h-9 sm:w-9 text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeleteTarget({ type: "celebrity", id: celebrity.id, name: celebrity.name });
                              setShowDeleteConfirm(true);
                            }}
                            aria-label="Delete"
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
                        setCelebrityForm({ ...EMPTY_CELEBRITY_FORM });
                        setPendingCelebrityGalleryFiles([]);
                        setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
                        setSeedApprovalLoading(false);
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
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Prediction CMS</h2>
                <p className="text-muted-foreground">Manage prediction markets</p>
              </div>
              <Button onClick={() => setCreateMarketOpen(true)} data-testid="button-create-market">
                <Plus className="h-4 w-4 mr-2" />
                New Market
              </Button>
            </div>

            <Tabs value={predictionSubTab} onValueChange={setPredictionSubTab} className="w-full">
              {/* Horizontal scroll on mobile keeps tabs on one row.
                  flex-wrap was overflowing the h-10 muted box and visually
                  bleeding into the card heading below. */}
              <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TabsList className="inline-flex w-max">
                  <TabsTrigger value="real-world" data-testid="tab-real-world-markets">
                    World Markets {markets ? <span className="ml-1 text-xs opacity-60">({markets.filter(m => m.marketType === "community").length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="weekly-jackpot" data-testid="tab-weekly-jackpot">
                    Weekly Jackpot {markets ? <span className="ml-1 text-xs opacity-60">({markets.filter(m => m.marketType === "jackpot").length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="weekly-updown" data-testid="tab-weekly-updown">
                    Weekly Up/Down {markets ? <span className="ml-1 text-xs opacity-60">({markets.filter(m => m.marketType === "updown").length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="head-to-head" data-testid="tab-head-to-head">
                    Head-to-Head Battles {markets ? <span className="ml-1 text-xs opacity-60">({markets.filter(m => m.marketType === "h2h").length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="top-gainer" data-testid="tab-top-gainer">
                    Category Races {markets ? <span className="ml-1 text-xs opacity-60">({markets.filter(m => m.marketType === "gainer").length})</span> : null}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="real-world" className="mt-4">
                <WorldMarketsSection
                  markets={markets}
                  marketsLoading={marketsLoading}
                  categoryOptions={adminCategorySelectOptions}
                  frontendSortMode={predictCmsSettings?.worldMarketsSortMode ?? "volume"}
                  frontendSortPending={frontendSortMutation.isPending}
                  onFrontendSortChange={(mode) => frontendSortMutation.mutate(mode)}
                  onCreate={() => setCreateMarketOpen(true)}
                  onEdit={(id) => setEditMarketId(id)}
                  onSettle={(id) => setSettleMarketId(id)}
                  onVoid={(id) => setVoidMarketId(id)}
                  onDelete={(m) => setDeleteWorldMarket(m)}
                  initialVisFilter={deepLink.vis}
                />
              </TabsContent>

              <TabsContent value="weekly-jackpot" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Weekly Jackpot</CardTitle>
                      <CardDescription>Jackpot eligibility tied to all leaderboard celebrities</CardDescription>
                    </div>
                    <Button onClick={() => generateJackpotMutation.mutate()} disabled={generateJackpotMutation.isPending} size="sm" className="w-full sm:w-auto" data-testid="button-generate-jackpot">
                      {generateJackpotMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                      Generate All
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Select value={nativeVisFilter} onValueChange={setNativeVisFilter}>
                        <SelectTrigger className="w-full sm:w-[140px] h-11 sm:h-9" data-testid="select-jackpot-vis-filter">
                          <SelectValue placeholder="Visibility" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input placeholder="Search..." value={nativeSearchQuery} onChange={(e) => setNativeSearchQuery(e.target.value)} className="w-full sm:w-[200px] h-11 sm:h-9" data-testid="input-jackpot-search" />
                    </div>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                    ) : jMarkets.length > 0 ? (
                        <div className="space-y-2">
                          {jMarkets.map((market) => (
                            <NativeMarketRow
                              key={market.id}
                              market={market}
                              testIdPrefix="jackpot"
                              showCategory={false}
                              showWeek={false}
                              onVisibilityChange={(v) => updateNativeMarketMutation.mutate({ id: market.id, visibility: v })}
                              onToggleFeatured={() => updateNativeMarketMutation.mutate({ id: market.id, featured: !market.featured })}
                              onSettle={() => setConfirmNativeAction({ kind: "settle", id: market.id, title: market.title })}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Trophy className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No jackpot markets found.</p>
                          <Button className="mt-4" onClick={() => generateJackpotMutation.mutate()} data-testid="button-generate-jackpot-empty">
                            <Plus className="h-4 w-4 mr-2" />
                            Generate Jackpot Markets
                          </Button>
                        </div>
                      )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="weekly-updown" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Weekly Up/Down</CardTitle>
                      <CardDescription>Auto-generated cards for all leaderboard celebrities</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
                      {selectedNativeIds.size > 0 && (
                        <Select onValueChange={(v) => bulkVisibilityMutation.mutate({ marketIds: Array.from(selectedNativeIds), visibility: v })}>
                          <SelectTrigger className="flex-1 sm:flex-none sm:w-[130px] h-11 sm:h-9" data-testid="select-bulk-vis"><SelectValue placeholder={`Bulk (${selectedNativeIds.size})`} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="live">Set Live</SelectItem>
                            <SelectItem value="inactive">Set Inactive</SelectItem>
                            <SelectItem value="archived">Set Archived</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <Button onClick={() => generateUpdownMutation.mutate()} disabled={generateUpdownMutation.isPending} size="sm" className="flex-1 sm:flex-none" data-testid="button-generate-updown">
                        {generateUpdownMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        Generate All
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Select value={nativeVisFilter} onValueChange={setNativeVisFilter}>
                        <SelectTrigger className="w-full sm:w-[140px] h-11 sm:h-9" data-testid="select-updown-vis-filter"><SelectValue placeholder="Visibility" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={nativeCatFilter} onValueChange={setNativeCatFilter}>
                        <SelectTrigger className="w-full sm:w-[140px] h-11 sm:h-9" data-testid="select-updown-cat-filter"><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {adminCategorySelectOptions.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Search celebrities..." value={nativeSearchQuery} onChange={(e) => setNativeSearchQuery(e.target.value)} className="w-full sm:w-[200px] h-11 sm:h-9" data-testid="input-updown-search" />
                      <span className="text-xs text-muted-foreground sm:ml-auto">{(markets || []).filter(m => m.marketType === "updown").length} total</span>
                    </div>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                    ) : (() => {
                      const filtered = (markets || []).filter(m => m.marketType === "updown").filter(m => {
                        if (nativeVisFilter !== "all" && m.visibility !== nativeVisFilter) return false;
                        if (
                          nativeCatFilter !== "all" &&
                          normalizeMarketCategory(m.category) !== nativeCatFilter
                        )
                          return false;
                        if (nativeSearchQuery && !m.title?.toLowerCase().includes(nativeSearchQuery.toLowerCase())) return false;
                        return true;
                      });
                      return filtered.length > 0 ? (
                        <div className="space-y-2 md:max-h-[500px] md:overflow-y-auto">
                          {filtered.map((market) => (
                            <NativeMarketRow
                              key={market.id}
                              market={market}
                              testIdPrefix="updown"
                              showStatus={false}
                              selectable
                              selected={selectedNativeIds.has(market.id)}
                              onSelectedChange={(checked) => {
                                const next = new Set(selectedNativeIds);
                                if (checked) next.add(market.id);
                                else next.delete(market.id);
                                setSelectedNativeIds(next);
                              }}
                              onVisibilityChange={(v) => updateNativeMarketMutation.mutate({ id: market.id, visibility: v })}
                              onToggleFeatured={() => updateNativeMarketMutation.mutate({ id: market.id, featured: !market.featured })}
                              onDelete={() => setConfirmNativeAction({ kind: "delete", id: market.id, title: market.title })}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No Up/Down markets yet</p>
                          <Button className="mt-4" onClick={() => generateUpdownMutation.mutate()} data-testid="button-generate-updown-empty">
                            <Plus className="h-4 w-4 mr-2" />Generate for All Celebrities
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="head-to-head" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Head-to-Head Battles</CardTitle>
                      <CardDescription>Curated matchups between two celebrities</CardDescription>
                    </div>
                    <Button onClick={() => { setH2hPersonAId(""); setH2hPersonBId(""); setH2hPersonASearch(""); setH2hPersonBSearch(""); setH2hCategory("misc"); setH2hSecondaryCategories([]); setH2hModalOpen(true); }} size="sm" className="w-full sm:w-auto" data-testid="button-create-h2h">
                      <Plus className="h-4 w-4 mr-1" />New Battle
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Input
                        placeholder="Search..."
                        value={h2hMarketSearch}
                        onChange={(e) => setH2hMarketSearch(e.target.value)}
                        className="w-full sm:w-[200px] h-11 sm:h-9"
                        data-testid="input-h2h-search"
                      />
                    </div>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                    ) : (() => {
                      const h2hList = (markets || []).filter(m => m.marketType === "h2h").filter(m => !h2hMarketSearch || m.title?.toLowerCase().includes(h2hMarketSearch.toLowerCase()));
                      return h2hList.length > 0 ? (
                        <div className="space-y-2">
                          {h2hList.map((market) => (
                            <NativeMarketRow
                              key={market.id}
                              market={market}
                              testIdPrefix="h2h"
                              onVisibilityChange={(v) => updateNativeMarketMutation.mutate({ id: market.id, visibility: v })}
                              onToggleFeatured={() => updateNativeMarketMutation.mutate({ id: market.id, featured: !market.featured })}
                              onSettle={() => setConfirmNativeAction({ kind: "settle", id: market.id, title: market.title })}
                              onDelete={() => setConfirmNativeAction({ kind: "delete", id: market.id, title: market.title })}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No Head-to-Head battles yet</p>
                          <Button className="mt-4" onClick={() => { setH2hPersonAId(""); setH2hPersonBId(""); setH2hCategory("misc"); setH2hSecondaryCategories([]); setH2hModalOpen(true); }} data-testid="button-create-first-h2h">
                            <Plus className="h-4 w-4 mr-2" />Create First Battle
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="top-gainer" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>Category Races</CardTitle>
                      <CardDescription>One per category: Tech, Politics, Business, Sports, Creator, Music</CardDescription>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button onClick={() => generateGainerMutation.mutate()} size="sm" variant="outline" disabled={generateGainerMutation.isPending} className="flex-1 sm:flex-none" data-testid="button-generate-gainer">
                        <RefreshCw className={`h-4 w-4 mr-1 ${generateGainerMutation.isPending ? "animate-spin" : ""}`} />
                        {generateGainerMutation.isPending ? "Generating..." : "Generate All"}
                      </Button>
                      <Button onClick={() => { setGainerPersonIds([]); setGainerPersonSearch(""); setGainerCategory("tech"); setGainerModalOpen(true); }} size="sm" className="flex-1 sm:flex-none" data-testid="button-create-gainer">
                        <Plus className="h-4 w-4 mr-1" />New Gainer
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Input
                        placeholder="Search..."
                        value={gainerMarketSearch}
                        onChange={(e) => setGainerMarketSearch(e.target.value)}
                        className="w-full sm:w-[200px] h-11 sm:h-9"
                        data-testid="input-gainer-search"
                      />
                    </div>
                    {marketsLoading ? (
                      <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                    ) : (() => {
                      const gainerList = (markets || []).filter(m => m.marketType === "gainer").filter(m => !gainerMarketSearch || m.title?.toLowerCase().includes(gainerMarketSearch.toLowerCase()) || m.category?.toLowerCase().includes(gainerMarketSearch.toLowerCase()));
                      return gainerList.length > 0 ? (
                        <div className="space-y-2">
                          {gainerList.map((market) => (
                            <NativeMarketRow
                              key={market.id}
                              market={market}
                              testIdPrefix="gainer"
                              onVisibilityChange={(v) => updateNativeMarketMutation.mutate({ id: market.id, visibility: v })}
                              onToggleFeatured={() => updateNativeMarketMutation.mutate({ id: market.id, featured: !market.featured })}
                              onSettle={() => setConfirmNativeAction({ kind: "settle", id: market.id, title: market.title })}
                              onDelete={() => setConfirmNativeAction({ kind: "delete", id: market.id, title: market.title })}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
                          <p>No Category Race markets yet</p>
                          <Button className="mt-4" onClick={() => { setGainerPersonIds([]); setGainerCategory("tech"); setGainerModalOpen(true); }} data-testid="button-create-first-gainer">
                            <Plus className="h-4 w-4 mr-2" />Create First Market
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* H2H Create Modal */}
            <Dialog open={h2hModalOpen} onOpenChange={(open) => { if (!open) setH2hSecondaryCategories([]); setH2hModalOpen(open); }}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Head-to-Head Battle</DialogTitle>
                  <DialogDescription>Select two celebrities to create a matchup</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Celebrity A</Label>
                    <Input placeholder="Search celebrity..." value={h2hPersonASearch} onChange={(e) => setH2hPersonASearch(e.target.value)} data-testid="input-h2h-person-a" />
                    {h2hPersonASearch && (celebrities || []).filter((c: any) => c.name.toLowerCase().includes(h2hPersonASearch.toLowerCase()) && c.id !== h2hPersonBId).length > 0 && (
                      <div className="mt-1 max-h-32 overflow-y-auto border rounded-md">
                        {(celebrities || []).filter((c: any) => c.name.toLowerCase().includes(h2hPersonASearch.toLowerCase()) && c.id !== h2hPersonBId).slice(0, 8).map((c: any) => (
                          <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2" onClick={() => { setH2hPersonAId(c.id); setH2hPersonASearch(c.name); }} data-testid={`h2h-persona-option-${c.id}`}>
                            <Avatar className="h-6 w-6"><AvatarImage src={c.avatar} /><AvatarFallback>{c.name[0]}</AvatarFallback></Avatar>
                            <span>{c.name}</span>
                            <Badge variant="outline" className="text-xs ml-auto capitalize">{c.category}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    {h2hPersonAId && <p className="text-xs text-green-500 mt-1">Selected: {(celebrities || []).find((c: any) => c.id === h2hPersonAId)?.name}</p>}
                  </div>
                  <div>
                    <Label>Celebrity B</Label>
                    <Input placeholder="Search celebrity..." value={h2hPersonBSearch} onChange={(e) => setH2hPersonBSearch(e.target.value)} data-testid="input-h2h-person-b" />
                    {h2hPersonBSearch && (celebrities || []).filter((c: any) => c.name.toLowerCase().includes(h2hPersonBSearch.toLowerCase()) && c.id !== h2hPersonAId).length > 0 && (
                      <div className="mt-1 max-h-32 overflow-y-auto border rounded-md">
                        {(celebrities || []).filter((c: any) => c.name.toLowerCase().includes(h2hPersonBSearch.toLowerCase()) && c.id !== h2hPersonAId).slice(0, 8).map((c: any) => (
                          <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2" onClick={() => { setH2hPersonBId(c.id); setH2hPersonBSearch(c.name); }} data-testid={`h2h-personb-option-${c.id}`}>
                            <Avatar className="h-6 w-6"><AvatarImage src={c.avatar} /><AvatarFallback>{c.name[0]}</AvatarFallback></Avatar>
                            <span>{c.name}</span>
                            <Badge variant="outline" className="text-xs ml-auto capitalize">{c.category}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    {h2hPersonBId && <p className="text-xs text-green-500 mt-1">Selected: {(celebrities || []).find((c: any) => c.id === h2hPersonBId)?.name}</p>}
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select value={h2hCategory} onValueChange={setH2hCategory}>
                      <SelectTrigger data-testid="select-h2h-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {adminCategorySelectOptions.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <AdminCategoryMultiSelect
                    options={adminCategorySelectOptions}
                    value={h2hSecondaryCategories}
                    onChange={setH2hSecondaryCategories}
                    primaryValue={h2hCategory}
                    helperText="Extra filters this battle appears under (in addition to the players' own secondary categories). Optional."
                    testId="h2h-secondary-categories"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setH2hSecondaryCategories([]); setH2hModalOpen(false); }} data-testid="button-cancel-h2h">Cancel</Button>
                  <Button onClick={() => createH2hMutation.mutate({ personAId: h2hPersonAId, personBId: h2hPersonBId, category: h2hCategory, secondaryCategories: h2hSecondaryCategories })} disabled={!h2hPersonAId || !h2hPersonBId || createH2hMutation.isPending} data-testid="button-submit-h2h">
                    {createH2hMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Create Battle
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Gainer Create Modal */}
            <Dialog open={gainerModalOpen} onOpenChange={setGainerModalOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Category Race Market</DialogTitle>
                  <DialogDescription>Select a category and choose the full roster you want available in this race</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Category</Label>
                    <Select value={gainerCategory} onValueChange={setGainerCategory}>
                      <SelectTrigger data-testid="select-gainer-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {adminCategorySelectOptions.map((category) => (
                          <SelectItem key={category.value} value={category.value}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Engine:</span>{" "}
                    AMM (LMSR). Races trade as shares; house seeds initial
                    liquidity. Trading closes 5 minutes before resolution.
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label>Linked Celebrities ({gainerPersonIds.length})</Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setGainerPersonIds(gainerCategoryCelebrities.map((celebrity) => celebrity.id))}
                          disabled={gainerCategoryCelebrities.length === 0}
                        >
                          Use whole category ({gainerCategoryCelebrities.length})
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setGainerPersonIds([])}
                          disabled={gainerPersonIds.length === 0}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <Input placeholder="Search to add celebrities..." value={gainerPersonSearch} onChange={(e) => setGainerPersonSearch(e.target.value)} data-testid="input-gainer-person-search" />
                    {gainerPersonSearch && (
                      <div className="mt-1 max-h-32 overflow-y-auto border rounded-md">
                        {gainerCategoryCelebrities.filter((c: any) => c.name.toLowerCase().includes(gainerPersonSearch.toLowerCase()) && !gainerPersonIds.includes(c.id)).slice(0, 8).map((c: any) => (
                          <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2" onClick={() => { setGainerPersonIds([...gainerPersonIds, c.id]); setGainerPersonSearch(""); }} data-testid={`gainer-person-option-${c.id}`}>
                            <Avatar className="h-6 w-6"><AvatarImage src={c.avatar} /><AvatarFallback>{c.name[0]}</AvatarFallback></Avatar>
                            <span>{c.name}</span>
                            <Badge variant="outline" className="text-xs ml-auto capitalize">{c.category}</Badge>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Category Races resolve by percentage gain, but every linked celebrity appears as a selectable outcome in the market.
                    </p>
                    {gainerPersonIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {gainerPersonIds.map(pid => {
                          const person = (celebrities || []).find((c: any) => c.id === pid);
                          return (
                            <Badge key={pid} variant="secondary" className="text-xs">
                              {person?.name || pid}
                              <button className="ml-1" onClick={() => setGainerPersonIds(gainerPersonIds.filter(id => id !== pid))}><X className="h-3 w-3" /></button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setGainerModalOpen(false)} data-testid="button-cancel-gainer">Cancel</Button>
                  <Button
                    onClick={() => createGainerMutation.mutate({
                      category: gainerCategory,
                      personIds: gainerPersonIds,
                      engine: "amm",
                    })}
                    disabled={
                      gainerPersonIds.length < 2
                      || createGainerMutation.isPending
                    }
                    data-testid="button-submit-gainer"
                  >
                    {createGainerMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                    Create AMM Market
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Voting CMS Section */}
        {activeSection === "voting" && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Voting CMS</h2>
                <p className="text-muted-foreground">Manage voting content</p>
              </div>
            </div>

            <Tabs value={votingSubTab} onValueChange={setVotingSubTab} className="w-full">
              {/* See note on Prediction CMS tabs above — same horizontal-scroll
                  treatment for the same reason. */}
              <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <TabsList className="inline-flex w-max">
                  <TabsTrigger value="polls" data-testid="tab-polls">
                    Sentiment Polls {trendingPollsList ? <span className="ml-1 text-xs opacity-60">({trendingPollsList.length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="opinion-polls" data-testid="tab-opinion-polls">
                    Opinion Polls {opinionPollsList ? <span className="ml-1 text-xs opacity-60">({opinionPollsList.length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="option-suggestions" data-testid="tab-option-suggestions">
                    Option Suggestions
                  </TabsTrigger>
                  <TabsTrigger value="idea-scout" data-testid="tab-idea-scout">
                    Idea Scout
                  </TabsTrigger>
                  <TabsTrigger value="matchups" data-testid="tab-matchups">
                    Matchups {matchups ? <span className="ml-1 text-xs opacity-60">({matchups.length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="underrated-overrated" data-testid="tab-underrated-overrated">
                    Underrated / Overrated {underratedData?.data ? <span className="ml-1 text-xs opacity-60">({underratedData.data.length})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="induction" data-testid="tab-induction">
                    Induction Queue {activeInductionQueueCount > 0 ? <span className="ml-1 text-xs opacity-60">({activeInductionQueueCount})</span> : null}
                  </TabsTrigger>
                  <TabsTrigger value="curate-profile" data-testid="tab-curate-profile">
                    Curate Profile {curateData?.data ? <span className="ml-1 text-xs opacity-60">({curateData.data.length})</span> : null}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="polls" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle>Sentiment Polls</CardTitle>
                      <CardDescription>Manage community polling questions</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={pollCsvInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handlePollCsvImport}
                        data-testid="input-import-polls-csv"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pollCsvInputRef.current?.click()}
                        disabled={importingPollsCsv}
                        data-testid="button-import-polls-csv"
                      >
                        {importingPollsCsv ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )}
                        Import CSV
                      </Button>
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
                    </div>
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
                          {adminCategorySelectOptions.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <RecencySortSelect
                        value={pollSortOrder}
                        onValueChange={setPollSortOrder}
                        className="w-[140px]"
                        testId="select-poll-sort"
                      />
                      <Input
                        placeholder="Search..."
                        value={pollSearchQuery}
                        onChange={(e) => setPollSearchQuery(e.target.value)}
                        className="w-[200px]"
                        data-testid="input-poll-search"
                      />
                      <div className="flex items-center border rounded-md overflow-hidden ml-auto">
                        <button
                          className={`p-1.5 transition-colors ${pollsViewMode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setPollsViewMode("cards")}
                          title="Card view"
                        >
                          <LayoutList className="h-4 w-4" />
                        </button>
                        <button
                          className={`p-1.5 transition-colors ${pollsViewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setPollsViewMode("table")}
                          title="Table view"
                        >
                          <Table2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {pollsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredPolls && filteredPolls.length > 0 ? (
                      pollsViewMode === "table" ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 px-3 font-medium">Headline</th>
                              <th className="py-2 px-3 font-medium">Category</th>
                              <th className="py-2 px-3 font-medium">Visibility</th>
                              <th className="py-2 px-3 font-medium text-right">Seed Agree</th>
                              <th className="py-2 px-3 font-medium text-right">Seed Neutral</th>
                              <th className="py-2 px-3 font-medium text-right">Seed Disagree</th>
                              <th className="py-2 px-3 font-medium text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPolls.map((poll) => {
                              const edits = pollSeedEdits[poll.id];
                              const isDirty = !!edits;
                              const isSaving = savingRowIds.has(poll.id);
                              return (
                                <tr key={poll.id} className="border-b hover:bg-muted/50">
                                  <td className="py-2 px-3 max-w-[260px]">
                                    <p className="font-medium truncate">{poll.headline}</p>
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge variant="outline" className="text-xs">{poll.category}</Badge>
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge
                                      variant={(poll.visibility || poll.status) === "live" ? "default" : (poll.visibility || poll.status) === "draft" ? "secondary" : "outline"}
                                      className="text-xs"
                                    >
                                      {poll.visibility || poll.status}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <Input
                                      type="number"
                                      className="w-20 h-7 text-xs text-right ml-auto"
                                      value={edits?.seedAgreeCount ?? poll.seedAgreeCount ?? 0}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setPollSeedEdits(prev => ({
                                          ...prev,
                                          [poll.id]: {
                                            seedAgreeCount: val,
                                            seedNeutralCount: prev[poll.id]?.seedNeutralCount ?? poll.seedNeutralCount ?? 0,
                                            seedDisagreeCount: prev[poll.id]?.seedDisagreeCount ?? poll.seedDisagreeCount ?? 0,
                                          },
                                        }));
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <Input
                                      type="number"
                                      className="w-20 h-7 text-xs text-right ml-auto"
                                      value={edits?.seedNeutralCount ?? poll.seedNeutralCount ?? 0}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setPollSeedEdits(prev => ({
                                          ...prev,
                                          [poll.id]: {
                                            seedAgreeCount: prev[poll.id]?.seedAgreeCount ?? poll.seedAgreeCount ?? 0,
                                            seedNeutralCount: val,
                                            seedDisagreeCount: prev[poll.id]?.seedDisagreeCount ?? poll.seedDisagreeCount ?? 0,
                                          },
                                        }));
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <Input
                                      type="number"
                                      className="w-20 h-7 text-xs text-right ml-auto"
                                      value={edits?.seedDisagreeCount ?? poll.seedDisagreeCount ?? 0}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setPollSeedEdits(prev => ({
                                          ...prev,
                                          [poll.id]: {
                                            seedAgreeCount: prev[poll.id]?.seedAgreeCount ?? poll.seedAgreeCount ?? 0,
                                            seedNeutralCount: prev[poll.id]?.seedNeutralCount ?? poll.seedNeutralCount ?? 0,
                                            seedDisagreeCount: val,
                                          },
                                        }));
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1 justify-end">
                                      {isDirty && (
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-7 px-2 text-xs"
                                          disabled={isSaving}
                                          onClick={() => saveInlinePollSeeds(poll.id)}
                                        >
                                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                          Save
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditPoll(poll)} title="Edit in modal">
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => { setDeleteTarget({ type: "poll", id: poll.id, name: poll.headline }); setShowDeleteConfirm(true); }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      ) : (
                      <div data-testid="poll-list">
                        <AdminSortableCardList
                          items={filteredPolls}
                          disabled={!canReorderSentimentPolls}
                          disabledReason={
                            !canReorderSentimentPolls
                              ? "Set sort to \"Default order\", clear search, and set status and category to \"All\" to drag rows into your preferred order."
                              : undefined
                          }
                          onReorder={async (orderedIds) => {
                            const res = await fetchWithAuth("/api/admin/trending-polls/reorder", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ orderedIds }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              const msg = (err as { error?: string }).error || res.statusText;
                              toast.error("Could not save order", { description: msg });
                              throw new Error(msg || "Reorder failed");
                            }
                            toast.success("Poll order saved");
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
                          }}
                          renderItem={(poll, { dragHandle }) => (
                            <div
                              className="flex items-center justify-between gap-2 p-3 rounded-lg border"
                              data-testid={`poll-row-${poll.id}`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                {dragHandle}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium">{poll.headline}</p>
                                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{poll.subjectText}</p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <Badge variant="outline" className="text-xs">{poll.category}</Badge>
                                    <Badge
                                      variant={
                                        (poll.visibility || poll.status) === "live"
                                          ? "default"
                                          : (poll.visibility || poll.status) === "draft"
                                          ? "secondary"
                                          : (poll.visibility || poll.status) === "inactive"
                                          ? "outline"
                                          : "outline"
                                      }
                                      className="text-xs"
                                    >
                                      {poll.visibility || poll.status}
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
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {poll.status !== "archived" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      fetchWithAuth(`/api/admin/trending-polls/${poll.id}`, {
                                        method: "PATCH",
                                        body: JSON.stringify({ status: "archived" }),
                                      }).then(() => {
                                        toast("Poll Archived");
                                        queryClient.invalidateQueries({ queryKey: ["/api/admin/trending-polls"] });
                                      });
                                    }}
                                    title="Archive"
                                    aria-label="Archive"
                                    data-testid={`button-archive-poll-${poll.id}`}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditPoll(poll)}
                                  aria-label="Edit"
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
                                  aria-label="Delete"
                                  data-testid={`button-delete-poll-${poll.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        />
                      </div>
                      )
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Vote className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No sentiment polls yet</p>
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

              <TabsContent value="opinion-polls" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Opinion Polls</CardTitle>
                      <CardDescription>Multi-option polls for community voting</CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingOpinionPoll(null);
                        resetOpinionPollForm();
                        setShowOpinionPollModal(true);
                      }}
                      data-testid="button-add-opinion-poll"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Opinion Poll
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Select value={opinionPollFilter} onValueChange={setOpinionPollFilter}>
                        <SelectTrigger className="w-[140px]" data-testid="select-opinion-poll-status-filter">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={opinionPollCategoryFilter} onValueChange={setOpinionPollCategoryFilter}>
                        <SelectTrigger className="w-[140px]" data-testid="select-opinion-poll-category-filter">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {adminCategorySelectOptions.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Search..."
                        value={opinionPollSearchQuery}
                        onChange={(e) => setOpinionPollSearchQuery(e.target.value)}
                        className="w-[200px]"
                        data-testid="input-opinion-poll-search"
                      />
                      <RecencySortSelect
                        value={opinionPollSortOrder}
                        onValueChange={setOpinionPollSortOrder}
                        className="w-[140px]"
                        testId="select-opinion-poll-sort"
                      />
                      <div className="flex items-center border rounded-md overflow-hidden ml-auto">
                        <button
                          className={`p-1.5 transition-colors ${opinionViewMode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setOpinionViewMode("cards")}
                          title="Card view"
                        >
                          <LayoutList className="h-4 w-4" />
                        </button>
                        <button
                          className={`p-1.5 transition-colors ${opinionViewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setOpinionViewMode("table")}
                          title="Table view"
                        >
                          <Table2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {opinionPollsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredOpinionPolls.length > 0 ? (
                      opinionViewMode === "table" ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 px-3 font-medium">Title</th>
                              <th className="py-2 px-3 font-medium">Category</th>
                              <th className="py-2 px-3 font-medium">Visibility</th>
                              <th className="py-2 px-3 font-medium">Options &amp; Seed Counts</th>
                              <th className="py-2 px-3 font-medium text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredOpinionPolls.map((poll: any) => {
                              const edits = opinionSeedEdits[poll.id];
                              const isDirty = !!edits;
                              const isSaving = savingRowIds.has(poll.id);
                              const currentOptions: { name: string; imageUrl: string; personId: string; seedCount: number }[] =
                                edits?.options ?? poll.options?.map((o: any) => ({ name: o.name, imageUrl: o.imageUrl || "", personId: o.personId || "", seedCount: o.seedCount ?? 0 })) ?? [];
                              return (
                                <tr key={poll.id} className="border-b hover:bg-muted/50 align-top">
                                  <td className="py-2 px-3 max-w-[200px]">
                                    <p className="font-medium truncate">{poll.title}</p>
                                    <p className="text-xs text-muted-foreground">{poll.totalVotes || 0} votes</p>
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge variant="outline" className="text-xs">{poll.category}</Badge>
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge
                                      variant={poll.visibility === "live" ? "default" : poll.visibility === "draft" ? "secondary" : "outline"}
                                      className="text-xs"
                                    >
                                      {poll.visibility}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="space-y-1">
                                      {currentOptions.map((opt, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                          <span className="text-xs truncate max-w-[140px]">{opt.name}</span>
                                          <Input
                                            type="number"
                                            className="w-16 h-6 text-xs text-right"
                                            value={opt.seedCount}
                                            onChange={(e) => {
                                              const val = parseInt(e.target.value) || 0;
                                              const base = edits?.options ?? poll.options?.map((o: any) => ({
                                                name: o.name, imageUrl: o.imageUrl || "", personId: o.personId || "", seedCount: o.seedCount ?? 0,
                                              })) ?? [];
                                              const updated = base.map((o: any, i: number) => i === idx ? { ...o, seedCount: val } : o);
                                              setOpinionSeedEdits(prev => ({ ...prev, [poll.id]: { options: updated } }));
                                            }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1 justify-end">
                                      {isDirty && (
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-7 px-2 text-xs"
                                          disabled={isSaving}
                                          onClick={() => saveInlineOpinionSeeds(poll.id)}
                                        >
                                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                          Save
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditOpinionPoll(poll)} title="Edit in modal">
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => { setDeleteTarget({ type: "opinion-poll", id: poll.id, name: poll.title }); setShowDeleteConfirm(true); }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      ) : (
                      <div data-testid="opinion-poll-list">
                        <AdminSortableCardList
                          items={filteredOpinionPolls}
                          disabled={!canReorderOpinionPolls}
                          disabledReason={
                            !canReorderOpinionPolls
                              ? "Set sort to \"Default order\", clear search, and set status and category to \"All\" to drag rows into your preferred order."
                              : undefined
                          }
                          onReorder={async (orderedIds) => {
                            const res = await fetchWithAuth("/api/admin/opinion-polls/reorder", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ orderedIds }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              const msg = (err as { error?: string }).error || res.statusText;
                              toast.error("Could not save order", { description: msg });
                              throw new Error(msg || "Reorder failed");
                            }
                            toast.success("Opinion poll order saved");
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/opinion-polls"] });
                          }}
                          renderItem={(poll: any, { dragHandle }) => (
                            <div
                              className="flex items-center justify-between gap-2 p-3 rounded-lg border"
                              data-testid={`opinion-poll-row-${poll.id}`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                {dragHandle}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium">{poll.title}</p>
                                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{poll.description}</p>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <Badge variant="outline" className="text-xs">{poll.category}</Badge>
                                    <Badge
                                      variant={poll.visibility === "live" ? "default" : poll.visibility === "draft" ? "secondary" : "outline"}
                                      className="text-xs"
                                    >
                                      {poll.visibility}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">{poll.options?.length || 0} options</span>
                                    <span className="text-xs text-muted-foreground">{poll.totalVotes || 0} votes</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditOpinionPoll(poll)}
                                  aria-label="Edit"
                                  data-testid={`button-edit-opinion-poll-${poll.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setDeleteTarget({ type: "opinion-poll", id: poll.id, name: poll.title });
                                    setShowDeleteConfirm(true);
                                  }}
                                  aria-label="Delete"
                                  data-testid={`button-delete-opinion-poll-${poll.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        />
                      </div>
                      )
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Vote className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No opinion polls yet</p>
                        <Button
                          className="mt-4"
                          onClick={() => {
                            setEditingOpinionPoll(null);
                            resetOpinionPollForm();
                            setShowOpinionPollModal(true);
                          }}
                          data-testid="button-create-first-opinion-poll"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create First Opinion Poll
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="option-suggestions" className="mt-4">
                <SectionSuspense>
                  <AdminOptionSuggestionsSection />
                </SectionSuspense>
              </TabsContent>

              <TabsContent value="idea-scout" className="mt-4">
                <SectionSuspense>
                  <AdminVoteScoutSection />
                </SectionSuspense>
              </TabsContent>

              <TabsContent value="matchups" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Matchup Queue</CardTitle>
                      <CardDescription>Manage Matchup voting questions</CardDescription>
                    </div>
                    <Button 
                      size="sm"
                      onClick={() => {
                        setEditingMatchup(null);
                        setMatchupForm({ title: "", category: "tech", secondaryCategories: [], optionAText: "", optionBText: "", optionAImage: "", optionBImage: "", personAId: "", personBId: "", promptText: "", description: "", isActive: true, visibility: "live", featured: false, slug: "", seedVotesA: 0, seedVotesB: 0 });
                        setMatchupSearchA(""); setMatchupSearchB(""); setMatchupRelatedPeople([]);
                        setShowMatchupModal(true);
                      }}
                      data-testid="button-add-matchup"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Matchup
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <Select value={matchupVisFilter} onValueChange={setMatchupVisFilter}>
                        <SelectTrigger className="w-[140px]" data-testid="select-matchup-vis-filter">
                          <SelectValue placeholder="Visibility" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Visibility</SelectItem>
                          <SelectItem value="live">Live</SelectItem>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Search..."
                        value={matchupSearchQuery}
                        onChange={(e) => setMatchupSearchQuery(e.target.value)}
                        className="w-[200px]"
                        data-testid="input-matchup-search"
                      />
                      <RecencySortSelect
                        value={matchupSortOrder}
                        onValueChange={setMatchupSortOrder}
                        className="w-[140px]"
                        testId="select-matchup-sort"
                      />
                      <span className="text-xs text-muted-foreground">{filteredMatchups.length} total</span>
                      <div className="flex items-center border rounded-md overflow-hidden ml-auto">
                        <button
                          className={`p-1.5 transition-colors ${matchupsViewMode === "cards" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setMatchupsViewMode("cards")}
                          title="Card view"
                        >
                          <LayoutList className="h-4 w-4" />
                        </button>
                        <button
                          className={`p-1.5 transition-colors ${matchupsViewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                          onClick={() => setMatchupsViewMode("table")}
                          title="Table view"
                        >
                          <Table2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {matchupsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredMatchups.length > 0 ? (
                      matchupsViewMode === "table" ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 px-3 font-medium">Title / Matchup</th>
                              <th className="py-2 px-3 font-medium">Category</th>
                              <th className="py-2 px-3 font-medium">Visibility</th>
                              <th className="py-2 px-3 font-medium text-right">Seed A</th>
                              <th className="py-2 px-3 font-medium text-right">Seed B</th>
                              <th className="py-2 px-3 font-medium text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMatchups.map((matchup) => {
                              const edits = matchupSeedEdits[matchup.id];
                              const isDirty = !!edits;
                              const isSaving = savingRowIds.has(matchup.id);
                              return (
                                <tr key={matchup.id} className="border-b hover:bg-muted/50">
                                  <td className="py-2 px-3 max-w-[260px]">
                                    <p className="font-medium truncate">{matchup.title || `${matchup.optionAText} vs ${matchup.optionBText}`}</p>
                                    {matchup.title && (
                                      <p className="text-xs text-muted-foreground truncate">{matchup.optionAText} vs {matchup.optionBText}</p>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge variant="outline" className="text-xs">{matchup.category}</Badge>
                                  </td>
                                  <td className="py-2 px-3">
                                    <Badge variant={matchup.visibility === 'live' ? 'default' : matchup.visibility === 'draft' ? 'outline' : 'secondary'} className="text-xs">
                                      {matchup.visibility || 'live'}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <Input
                                      type="number"
                                      className="w-20 h-7 text-xs text-right ml-auto"
                                      value={edits?.seedVotesA ?? matchup.seedVotesA ?? 0}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setMatchupSeedEdits(prev => ({
                                          ...prev,
                                          [matchup.id]: {
                                            seedVotesA: val,
                                            seedVotesB: prev[matchup.id]?.seedVotesB ?? matchup.seedVotesB ?? 0,
                                          },
                                        }));
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-3 text-right">
                                    <Input
                                      type="number"
                                      className="w-20 h-7 text-xs text-right ml-auto"
                                      value={edits?.seedVotesB ?? matchup.seedVotesB ?? 0}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        setMatchupSeedEdits(prev => ({
                                          ...prev,
                                          [matchup.id]: {
                                            seedVotesA: prev[matchup.id]?.seedVotesA ?? matchup.seedVotesA ?? 0,
                                            seedVotesB: val,
                                          },
                                        }));
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1 justify-end">
                                      {isDirty && (
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-7 px-2 text-xs"
                                          disabled={isSaving}
                                          onClick={() => saveInlineMatchupSeeds(matchup.id)}
                                        >
                                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                                          Save
                                        </Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditMatchup(matchup)} title="Edit in modal">
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => { setDeleteTarget({ type: "matchup", id: matchup.id, name: matchup.title || `${matchup.optionAText} vs ${matchup.optionBText}` }); setShowDeleteConfirm(true); }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      ) : (
                      <div data-testid="matchup-list">
                        <AdminSortableCardList
                          items={filteredMatchups}
                          disabled={!canReorderMatchups}
                          disabledReason={
                            !canReorderMatchups
                              ? "Set sort to \"Default order\", clear search, and set visibility to \"All\" to drag rows into your preferred order."
                              : undefined
                          }
                          onReorder={async (orderedIds) => {
                            const res = await fetchWithAuth("/api/admin/matchups/reorder", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ orderedIds }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              const msg = (err as { error?: string }).error || res.statusText;
                              toast.error("Could not save order", { description: msg });
                              throw new Error(msg || "Reorder failed");
                            }
                            toast.success("Matchup order saved");
                            queryClient.invalidateQueries({ queryKey: ["/api/admin/matchups"] });
                          }}
                          renderItem={(matchup, { dragHandle }) => (
                            <div
                              className="flex items-center justify-between gap-2 p-3 rounded-lg border"
                              data-testid={`matchup-row-${matchup.id}`}
                            >
                              <div className="flex items-start gap-2 min-w-0 flex-1">
                                {dragHandle}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {matchup.featured && <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />}
                                    <p className="font-medium truncate">{matchup.title || `${matchup.optionAText} vs ${matchup.optionBText}`}</p>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <Badge variant="outline" className="text-xs">{matchup.category}</Badge>
                                    {matchup.title && <span className="text-sm text-muted-foreground">{matchup.optionAText} vs {matchup.optionBText}</span>}
                                    {matchup.slug && (
                                      <span className="text-xs text-muted-foreground font-mono">/{matchup.slug}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant={matchup.visibility === 'live' ? 'default' : matchup.visibility === 'draft' ? 'outline' : 'secondary'}>
                                  {matchup.visibility || 'live'}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditMatchup(matchup)}
                                  aria-label="Edit"
                                  data-testid={`button-edit-matchup-${matchup.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive"
                                  onClick={() => {
                                    setDeleteTarget({ type: "matchup", id: matchup.id, name: matchup.title || `${matchup.optionAText} vs ${matchup.optionBText}` });
                                    setShowDeleteConfirm(true);
                                  }}
                                  aria-label="Delete"
                                  data-testid={`button-delete-matchup-${matchup.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        />
                      </div>
                      )
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ArrowUpDown className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>{matchupSearchQuery || matchupVisFilter !== "all" ? "No matchups match your filters" : "No matchups yet"}</p>
                        {!matchupSearchQuery && matchupVisFilter === "all" && (
                          <Button 
                            className="mt-4" 
                            onClick={() => {
                              setEditingMatchup(null);
                              setMatchupForm({ title: "", category: "tech", secondaryCategories: [], optionAText: "", optionBText: "", optionAImage: "", optionBImage: "", personAId: "", personBId: "", promptText: "", description: "", isActive: true, visibility: "live", featured: false, slug: "", seedVotesA: 0, seedVotesB: 0 });
                              setMatchupSearchA(""); setMatchupSearchB(""); setMatchupRelatedPeople([]);
                              setShowMatchupModal(true);
                            }}
                            data-testid="button-create-first-matchup"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Create First Matchup
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="underrated-overrated" className="mt-4">
                <SectionSuspense>
                  <AdminUnderratedOverrated />
                </SectionSuspense>
              </TabsContent>

              <TabsContent value="induction" className="mt-4">
                <SectionSuspense>
                  <AdminInductionQueue />
                </SectionSuspense>
              </TabsContent>

              <TabsContent value="curate-profile" className="mt-4">
                <SectionSuspense>
                  <AdminCurateProfile />
                </SectionSuspense>
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

            <Tabs value={moderationSubTab} onValueChange={setModerationSubTab} className="w-full">
              <TabsList>
                <TabsTrigger value="queue" data-testid="tab-moderation-queue">
                  Review queue
                </TabsTrigger>
                <TabsTrigger value="reports" data-testid="tab-comment-reports">
                  Reports
                </TabsTrigger>
                <TabsTrigger value="comments" data-testid="tab-comments">
                  Comments
                </TabsTrigger>
              </TabsList>

              <TabsContent value="queue" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Automated review queue</CardTitle>
                    <CardDescription>
                      Items flagged by OpenAI omni-moderation (or the local blocklist). Approve restores visibility; Remove hides/rejects; Dismiss closes without changing content further.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {moderationQueueLoading ? (
                      <p className="text-sm text-muted-foreground">Loading queue…</p>
                    ) : !moderationQueueData?.data?.length ? (
                      <p className="text-sm text-muted-foreground">Queue is clear.</p>
                    ) : (
                      moderationQueueData.data.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border p-3 space-y-2"
                          data-testid={`moderation-queue-item-${item.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant={item.decision === "auto_hide" ? "destructive" : "secondary"}>
                              {item.decision}
                            </Badge>
                            <span>{item.contentType}</span>
                            <span>·</span>
                            <span>@{item.authorUsername || "unknown"}{item.authorIsAgent ? " (agent)" : ""}</span>
                            <span>·</span>
                            <span>{new Date(item.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {item.sampleText || "(no sample)"}
                          </p>
                          {Array.isArray(item.matchedCategories) && item.matchedCategories.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Categories: {item.matchedCategories.join(", ")}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolveModerationMutation.isPending}
                              onClick={() => resolveModerationMutation.mutate({ id: item.id, action: "approve" })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={resolveModerationMutation.isPending}
                              onClick={() => resolveModerationMutation.mutate({ id: item.id, action: "remove" })}
                            >
                              Remove
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={resolveModerationMutation.isPending}
                              onClick={() => resolveModerationMutation.mutate({ id: item.id, action: "dismiss" })}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reports" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>User comment reports</CardTitle>
                    <CardDescription>
                      Reports submitted via the in-app Report action. Use the Comments tab to hard-delete offending rows.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {commentReportsLoading ? (
                      <p className="text-sm text-muted-foreground">Loading reports…</p>
                    ) : !commentReportsData?.length ? (
                      <p className="text-sm text-muted-foreground">No reports yet.</p>
                    ) : (
                      commentReportsData.map((report) => (
                        <div key={report.id} className="rounded-lg border p-3 space-y-1">
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{report.entityType}</span>
                            <span>·</span>
                            <span>@{report.authorUsername || "unknown"}{report.authorIsAgent ? " (agent)" : ""}</span>
                            <span>·</span>
                            <span>{new Date(report.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {report.commentBody || "(comment missing)"}
                          </p>
                          {report.reason && (
                            <p className="text-xs text-muted-foreground">Reason: {report.reason}</p>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="comments" className="mt-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <CardTitle>Comments</CardTitle>
                        <CardDescription>
                          All user + agent comments across matchups, polls, world markets, and celebrity insights
                        </CardDescription>
                      </div>
                      {moderationComments && (
                        <div className="text-xs text-muted-foreground self-end">
                          Showing <span className="font-semibold text-foreground">{moderationComments.length}</span>
                          {moderationComments.length === 200 && " (capped — refine filters to see more)"}
                        </div>
                      )}
                    </div>
                    {/* Filter bar */}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <div className="relative flex-1 min-w-[200px] max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search comment text…"
                          value={commentSearch}
                          onChange={(e) => setCommentSearch(e.target.value)}
                          className="pl-10"
                          data-testid="comments-search"
                        />
                      </div>
                      <Select value={commentParentFilter} onValueChange={(v) => setCommentParentFilter(v as typeof commentParentFilter)}>
                        <SelectTrigger className="w-[180px]" data-testid="comments-parent-filter">
                          <SelectValue placeholder="All surfaces" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All surfaces</SelectItem>
                          <SelectItem value="matchup">Matchups</SelectItem>
                          <SelectItem value="trending_poll">Sentiment polls</SelectItem>
                          <SelectItem value="opinion_poll">Opinion polls</SelectItem>
                          <SelectItem value="open_market">World markets</SelectItem>
                          <SelectItem value="community_insight">Community insights</SelectItem>
                          <SelectItem value="voices_post">Voices posts</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={commentAuthorFilter} onValueChange={(v) => setCommentAuthorFilter(v as typeof commentAuthorFilter)}>
                        <SelectTrigger className="w-[150px]" data-testid="comments-author-filter">
                          <SelectValue placeholder="All authors" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All authors</SelectItem>
                          <SelectItem value="humans">Humans only</SelectItem>
                          <SelectItem value="agents">Agents only</SelectItem>
                        </SelectContent>
                      </Select>
                      {(commentParentFilter !== "all" || commentAuthorFilter !== "all" || commentSearch) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCommentParentFilter("all");
                            setCommentAuthorFilter("all");
                            setCommentSearch("");
                          }}
                          data-testid="comments-clear-filters"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {commentsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    ) : moderationComments && moderationComments.length > 0 ? (
                      <div className="space-y-3" data-testid="comments-list">
                        {moderationComments.map((comment) => {
                          const surfaceLabel: Record<string, string> = {
                            matchup: "Matchup",
                            trending_poll: "Sentiment poll",
                            opinion_poll: "Opinion poll",
                            open_market: "World market",
                            community_insight: "Insight",
                            voices_post: "Voices",
                          };
                          return (
                            <div
                              key={comment.id}
                              className="flex items-start justify-between gap-3 p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                              data-testid={`comment-row-${comment.id}`}
                            >
                              <div className="flex-1 min-w-0 space-y-2">
                                {/* Author + parent header */}
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                  {comment.authorLink ? (
                                    <a
                                      href={comment.authorLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-semibold text-foreground hover:underline"
                                    >
                                      @{comment.username}
                                    </a>
                                  ) : (
                                    <span className="font-semibold text-muted-foreground italic">
                                      {comment.username || "[deleted user]"}
                                    </span>
                                  )}
                                  {comment.isAgent && (
                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-violet-500/40 text-violet-500">
                                      <Bot className="h-3 w-3 mr-1" />
                                      AGENT
                                    </Badge>
                                  )}
                                  <span className="text-muted-foreground">on</span>
                                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                    {surfaceLabel[comment.parentType]}
                                  </Badge>
                                  {comment.parentLink ? (
                                    <a
                                      href={comment.parentLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-foreground hover:underline truncate max-w-[400px] inline-flex items-center gap-1"
                                      title={comment.parentTitle ?? ""}
                                    >
                                      {comment.parentTitle ?? "(untitled)"}
                                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground truncate max-w-[400px]" title={comment.parentTitle ?? ""}>
                                      {comment.parentTitle ?? "(unresolvable parent)"}
                                    </span>
                                  )}
                                  {comment.parentCategory && (
                                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                      {comment.parentCategory}
                                    </Badge>
                                  )}
                                </div>
                                {/* Comment body — edit mode for agents, read-only otherwise */}
                                {editingCommentId === comment.id ? (
                                  <div className="space-y-2">
                                    <Textarea
                                      value={editingCommentDraft}
                                      onChange={(e) => setEditingCommentDraft(e.target.value)}
                                      rows={Math.min(10, Math.max(3, editingCommentDraft.split("\n").length + 1))}
                                      maxLength={2000}
                                      className="text-sm font-normal resize-y"
                                      autoFocus
                                      data-testid={`textarea-edit-comment-${comment.id}`}
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          const trimmed = editingCommentDraft.trim();
                                          if (trimmed.length === 0) {
                                            toast.error("Comment cannot be empty");
                                            return;
                                          }
                                          editCommentMutation.mutate({ id: comment.id, body: trimmed });
                                        }}
                                        disabled={editCommentMutation.isPending}
                                        data-testid={`button-save-comment-${comment.id}`}
                                      >
                                        {editCommentMutation.isPending && editCommentMutation.variables?.id === comment.id ? (
                                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        ) : null}
                                        Save
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                          setEditingCommentId(null);
                                          setEditingCommentDraft("");
                                        }}
                                        disabled={editCommentMutation.isPending}
                                        data-testid={`button-cancel-edit-${comment.id}`}
                                      >
                                        Cancel
                                      </Button>
                                      <span className="text-xs text-muted-foreground ml-auto">
                                        {editingCommentDraft.length}/2000
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-sm whitespace-pre-wrap break-words text-foreground">{comment.body}</p>
                                )}
                                {/* Timestamp */}
                                <div className="text-xs text-muted-foreground">
                                  {new Date(comment.createdAt).toLocaleString()}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 flex-shrink-0">
                                {/* Edit button — agent-authored comments only.
                                    Server enforces this guard regardless of UI state. */}
                                {comment.isAgent && editingCommentId !== comment.id && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => {
                                      setEditingCommentId(comment.id);
                                      setEditingCommentDraft(comment.body);
                                    }}
                                    aria-label="Edit agent comment"
                                    title="Edit agent comment"
                                    data-testid={`button-edit-comment-${comment.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setDeleteTarget({ type: "comment", id: comment.id, name: "this comment" });
                                    setShowDeleteConfirm(true);
                                  }}
                                  aria-label="Delete"
                                  data-testid={`button-delete-comment-${comment.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No comments {(commentParentFilter !== "all" || commentAuthorFilter !== "all" || commentSearchDebounced) ? "match your filters" : "to moderate"}</p>
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
          <SectionSuspense>
            <AdminSettlementCenter />
          </SectionSuspense>
        )}

        {/* AMM Section */}
        {activeSection === "amm" && (
          <SectionSuspense>
            <AdminAmmSection />
          </SectionSuspense>
        )}

        {/* Gamification CMS — unified XP / Ranks / Streaks / Credits /
            Badges / User Lookup section. Aliases below keep
            deep-links to the deprecated `credits` and `badges`
            sidebar IDs working by mounting the same section with
            an explicit initialSubTab. */}
        {(activeSection === "gamification" ||
          activeSection === "credits" ||
          activeSection === "badges") && (
          <SectionSuspense>
            <AdminGamificationSection
              initialSubTab={
                activeSection === "credits"
                  ? "credits"
                  : activeSection === "badges"
                    ? "badges"
                    : undefined
              }
            />
          </SectionSuspense>
        )}

        {/* Users Section */}
        {activeSection === "users" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold">Users & Moderation</h2>
              <p className="text-muted-foreground">Manage user accounts and moderation</p>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search username, email, or user ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-user-search"
                />
              </div>
              <Button
                variant={userFilter === "drift" ? "default" : "outline"}
                size="sm"
                onClick={() => setUserFilter(userFilter === "drift" ? "all" : "drift")}
                data-testid="button-toggle-drift-filter"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                {userFilter === "drift"
                  ? `Showing credit drift${typeof opsSummary?.driftUserCount === "number" ? ` (${opsSummary.driftUserCount})` : ""} — click to clear`
                  : `Credit drift only${typeof opsSummary?.driftUserCount === "number" ? ` (${opsSummary.driftUserCount})` : ""}`}
              </Button>
              {userFilter !== "drift" && (
                <Select
                  value={userSort}
                  onValueChange={(v) => setUserSort(v as typeof userSort)}
                >
                  <SelectTrigger className="w-[200px]" data-testid="select-user-created-sort">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created_desc">Newest accounts first</SelectItem>
                    <SelectItem value="created_asc">Oldest accounts first</SelectItem>
                    <SelectItem value="last_active">Recently active first</SelectItem>
                    <SelectItem value="credits">Most Vox first</SelectItem>
                    <SelectItem value="xp">Most XP first</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Filter chips — server-side kind / banned / active-window
                filters. Hidden while the drift list is showing (that
                endpoint has its own fixed filter). */}
            {userFilter !== "drift" && (
              <div className="flex items-center gap-2 flex-wrap">
                {([
                  { value: "humans" as const, label: "Humans" },
                  { value: "agents" as const, label: "Agents" },
                  { value: "system" as const, label: "System" },
                  { value: "all" as const, label: "All accounts" },
                ]).map((opt) => (
                  <Button
                    key={opt.value}
                    variant={userKindFilter === opt.value ? "default" : "outline"}
                    size="sm"
                    className="h-8"
                    onClick={() => setUserKindFilter(opt.value)}
                    data-testid={`chip-user-kind-${opt.value}`}
                  >
                    {opt.label}
                  </Button>
                ))}
                <div className="w-px h-5 bg-border mx-1" />
                <Button
                  variant={userStatusFilter === "banned" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() =>
                    setUserStatusFilter(userStatusFilter === "banned" ? "all" : "banned")
                  }
                  data-testid="chip-user-status-banned"
                >
                  <Ban className="h-3.5 w-3.5 mr-1.5" />
                  Banned only
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
                {([
                  { value: "any" as const, label: "Any activity" },
                  { value: "7d" as const, label: "Active 7d" },
                  { value: "30d" as const, label: "Active 30d" },
                ]).map((opt) => (
                  <Button
                    key={opt.value}
                    variant={userActiveFilter === opt.value ? "default" : "outline"}
                    size="sm"
                    className="h-8"
                    onClick={() => setUserActiveFilter(opt.value)}
                    data-testid={`chip-user-active-${opt.value}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}

            {userFilter !== "drift" && userKindFilter === "system" && (
              <div
                className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-muted-foreground"
                data-testid="banner-system-accounts"
              >
                <p className="font-medium text-foreground flex items-center gap-2">
                  <Server className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                  Platform infrastructure accounts
                </p>
                <p className="mt-1">
                  <strong className="font-medium text-foreground">__house__</strong> seeds and settles AMM markets (Admin → AMM).
                  {" "}
                  <strong className="font-medium text-foreground">__market_scout__</strong> owns auto-imported World Market drafts.
                  Never ban, delete, or adjust credits on these rows.
                </p>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{userFilter === "drift" ? "Users with credit drift" : "User Accounts"}</CardTitle>
                <CardDescription>
                  {usersLoading
                    ? "Loading users..."
                    : usersList
                      ? userFilter === "drift"
                        ? usersList.total === 0
                          ? "No users with credit drift"
                          : `Showing ${userListStart}–${userListEnd} of ${usersList.total} user${usersList.total === 1 ? "" : "s"} where wallet ≠ ledger sum`
                        : usersList.total === 0
                          ? "No users found"
                          : `Showing ${userListStart}–${userListEnd} of ${usersList.total} user${usersList.total === 1 ? "" : "s"}`
                      : "Loading users..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : displayUsers.length > 0 ? (
                  <div className="space-y-3">
                    {displayUsers.map((user) => (
                      <div
                        key={user.id}
                        className="flex flex-col gap-3 p-3 rounded-lg border sm:flex-row sm:items-center sm:justify-between"
                        data-testid={`user-row-${user.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserProfileAvatar
                            displayName={user.username}
                            avatarUrl={user.avatarUrl}
                            size="md"
                            testId={`user-avatar-${user.id}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">
                              {user.username || "Unknown"}
                            </p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                {user.role}
                              </Badge>
                              <span className="whitespace-nowrap">{user.xpPoints} XP</span>
                              <span className="whitespace-nowrap">{formatVox(user.predictCredits)}</span>
                              {user.createdAt && (
                                <span className="whitespace-nowrap" data-testid={`user-joined-${user.id}`}>
                                  Joined {formatDate(user.createdAt)}
                                </span>
                              )}
                              {user.lastActiveAt && (
                                <span className="whitespace-nowrap" data-testid={`user-last-active-${user.id}`}>
                                  Active {formatTimeAgo(user.lastActiveAt)}
                                </span>
                              )}
                              {isInfrastructureUser(user) && (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-violet-500/50 text-violet-700 dark:text-violet-300"
                                  data-testid={`badge-infrastructure-${user.id}`}
                                >
                                  Infrastructure
                                </Badge>
                              )}
                              {user.isHouse && (
                                <Badge variant="outline" className="text-xs border-fuchsia-500/50 text-fuchsia-700 dark:text-fuchsia-300">
                                  AMM House
                                </Badge>
                              )}
                              {user.isSimAgent && (
                                <Badge variant="outline" className="text-xs border-cyan-500/50 text-cyan-600 dark:text-cyan-400">
                                  Sim agent
                                </Badge>
                              )}
                              {typeof user.drift === "number" && user.drift !== 0 && (
                                <Badge
                                  variant="outline"
                                  className={`text-xs whitespace-nowrap ${user.drift < 0 ? "border-red-500/50 text-red-600 dark:text-red-400" : "border-amber-500/50 text-amber-600 dark:text-amber-400"}`}
                                  data-testid={`badge-drift-${user.id}`}
                                >
                                  Drift: {user.drift > 0 ? "+" : ""}{formatVox(user.drift)}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap shrink-0 sm:flex-nowrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 sm:min-h-8"
                            onClick={() => setCreditHistoryUserId(user.id)}
                            data-testid={`button-view-user-${user.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Details
                          </Button>
                          {canModerateUser(user) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 sm:min-h-8"
                              onClick={() => {
                                setSelectedUser(user);
                                setShowCreditModal(true);
                              }}
                              data-testid={`button-adjust-credits-${user.id}`}
                            >
                              <Coins className="h-4 w-4 mr-1" />
                              Vox
                            </Button>
                          )}
                          {canModerateUser(user) && typeof user.drift === "number" && user.drift !== 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 sm:min-h-8 border-amber-500/50 text-amber-700 dark:text-amber-400"
                              onClick={() => setReconcileDriftTarget(user)}
                              data-testid={`button-reconcile-drift-${user.id}`}
                            >
                              <AlertTriangle className="h-4 w-4 mr-1" />
                              Reconcile
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 sm:min-h-8"
                            onClick={() =>
                              setLocation(`/admin/notifications?inspect=${user.id}`)
                            }
                            data-testid={`button-inspect-notifications-${user.id}`}
                          >
                            <Bell className="h-4 w-4 mr-1" />
                            Notifs
                          </Button>
                          {canModerateUser(user) && (
                            user.isBanned ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-11 sm:min-h-8 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 hover:text-emerald-700"
                                onClick={() => openUnbanUserModal(user)}
                                disabled={unbanUserMutation.isPending}
                                data-testid={`button-unban-${user.id}`}
                              >
                                <Ban className="h-4 w-4 mr-1" />
                                Unban
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-h-11 sm:min-h-8 text-destructive hover:text-destructive"
                                onClick={() => openBanUserModal(user)}
                                disabled={banUserMutation.isPending}
                                data-testid={`button-ban-${user.id}`}
                              >
                                <Ban className="h-4 w-4 mr-1" />
                                Ban
                              </Button>
                            )
                          )}
                          {canModerateUser(user) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 sm:min-h-8 text-destructive hover:text-destructive border-destructive/30"
                              onClick={() => openDeleteUserModal(user)}
                              data-testid={`button-delete-user-${user.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {usersList && usersList.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-3 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={userPage <= 1 || usersLoading}
                          onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                          data-testid="button-users-prev-page"
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" />
                          Previous
                        </Button>
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid="text-users-page-indicator"
                        >
                          Page {usersList.page} of {usersList.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={userPage >= usersList.totalPages || usersLoading}
                          onClick={() => setUserPage((p) => p + 1)}
                          data-testid="button-users-next-page"
                        >
                          Next
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No users found</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {creditHistoryUserId && (
              <Suspense fallback={null}>
                <AdminUserCreditHistory
                  userId={creditHistoryUserId}
                  open={!!creditHistoryUserId}
                  onOpenChange={(open) => { if (!open) setCreditHistoryUserId(null); }}
                />
              </Suspense>
            )}
          </div>
        )}

        {/* Agents Section */}
        {activeSection === "agents" && (
          <SectionSuspense>
            <AdminAgentsSection />
          </SectionSuspense>
        )}

        {/* System Tools Section */}
        {activeSection === "categories" && (
          <SectionSuspense>
            <AdminCategoriesSection enabled={isAdmin && activeSection === "categories"} />
          </SectionSuspense>
        )}

        {activeSection === "branding" && (
          <SectionSuspense>
            <AdminBrandingSection />
          </SectionSuspense>
        )}

        {activeSection === "tools" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-2xl font-bold">System Tools</h2>
                <p className="text-muted-foreground">Control data pipelines and scoring engine</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshSourceStatsMutation.mutate()}
                  disabled={refreshSourceStatsMutation.isPending}
                  title="Force-recompute the rolling p25/p50/p75 percentiles used by Momentum Signals. Use after flipping NEWS_AGGREGATION_FLIPPED_AT."
                  data-testid="button-refresh-source-stats"
                >
                  {refreshSourceStatsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Refresh Percentile Cache
                </Button>
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
                  {engineHealth.engineModes && (() => {
                    const m = engineHealth.engineModes;
                    const flipped = m.newsAggregationFlippedAt
                      ? new Date(m.newsAggregationFlippedAt)
                      : null;
                    const flippedLabel = flipped
                      ? `${flipped.toLocaleDateString()} ${flipped.toLocaleTimeString()}`
                      : "not set";
                    const newsModeTone =
                      m.newsAggregationMode === "union"
                        ? "bg-cyan-500/15 text-cyan-500 border-cyan-500/40"
                        : "bg-muted text-muted-foreground border-border";
                    return (
                      <div className="p-3 rounded-lg border bg-muted/30" data-testid="panel-engine-modes">
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Engine Modes (live config)
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            From env vars at server start
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground">News Aggregation</span>
                            <Badge variant="outline" className={cn("w-fit", newsModeTone)} data-testid="badge-news-mode">
                              {m.newsAggregationMode ?? "tiered"}
                            </Badge>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground">Ingest Cadence</span>
                            <span className="font-medium" data-testid="text-ingest-cadence">
                              every {m.ingestIntervalMinutes}m
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground">Mediastack Refresh</span>
                            <span className="font-medium" data-testid="text-mediastack-cadence">
                              every {m.mediastackRefreshIntervalMinutes}m
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 sm:col-span-2">
                            <span className="text-muted-foreground">News Flipped-At Cutoff</span>
                            <span className="font-medium text-[11px]" data-testid="text-flipped-at">
                              {flippedLabel}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground">Baseline Window</span>
                            <span className="font-medium" data-testid="text-baseline-window-days">
                              {m.rollingWindowDaysBaseline ?? 14}d (wiki, search)
                            </span>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground">News Window</span>
                            <span className="font-medium" data-testid="text-news-window-days">
                              {m.rollingWindowDaysNews ?? 7}d (news)
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                            <span className="text-muted-foreground">Diagnostics Verbose</span>
                            <Badge variant="outline" className={cn("w-fit", m.diagnosticsVerbose ? "bg-blue-500/15 text-blue-500 border-blue-500/40" : "bg-muted text-muted-foreground border-border")}>
                              {m.diagnosticsVerbose ? "on" : "off"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
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
                          freshnessOk ? "border-green-500/50 dark:border-green-500/40" : freshnessWarn ? "border-yellow-500/50 dark:border-yellow-500/40" : "border-red-500/50 dark:border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            freshnessOk ? "bg-green-500/15 dark:bg-green-500/10 text-green-500" : freshnessWarn ? "bg-yellow-500/15 dark:bg-yellow-500/10 text-yellow-500" : "bg-red-500/15 dark:bg-red-500/10 text-red-500"
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
                          <p
                            className="text-xs text-muted-foreground mt-1"
                            title={
                              engineHealth.ingestion?.lastSuccessfulFinish
                                ? new Date(engineHealth.ingestion.lastSuccessfulFinish).toISOString()
                                : undefined
                            }
                          >
                            {engineHealth.ingestion?.currentlyRunning ? (
                              <span className="text-cyan-500 font-medium">Ingestion running now</span>
                            ) : engineHealth.ingestion?.lastSuccessfulFinish ? (
                              <>Last success: {new Date(engineHealth.ingestion.lastSuccessfulFinish).toLocaleTimeString()}</>
                            ) : (
                              "No successful runs recorded"
                            )}
                          </p>
                          {(engineHealth.ingestion?.lastSuccessfulDurationMs != null ||
                            engineHealth.ingestion?.lastSuccessfulSnapshotsWritten != null) && (
                            <p className="text-xs text-muted-foreground">
                              {engineHealth.ingestion?.lastSuccessfulSnapshotsWritten != null && (
                                <>{engineHealth.ingestion.lastSuccessfulSnapshotsWritten} snap</>
                              )}
                              {engineHealth.ingestion?.lastSuccessfulSnapshotsWritten != null &&
                                engineHealth.ingestion?.lastSuccessfulDurationMs != null && " · "}
                              {engineHealth.ingestion?.lastSuccessfulDurationMs != null && (
                                <>{Math.round(engineHealth.ingestion.lastSuccessfulDurationMs / 1000)}s</>
                              )}
                            </p>
                          )}
                        </div>

                        <div className={cn("p-4 rounded-lg border-2 text-center",
                          continuityOk ? "border-green-500/50 dark:border-green-500/40" : continuityWarn ? "border-yellow-500/50 dark:border-yellow-500/40" : "border-red-500/50 dark:border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            continuityOk ? "bg-green-500/15 dark:bg-green-500/10 text-green-500" : continuityWarn ? "bg-yellow-500/15 dark:bg-yellow-500/10 text-yellow-500" : "bg-red-500/15 dark:bg-red-500/10 text-red-500"
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
                          integrityOk ? "border-green-500/50 dark:border-green-500/40" : integrityWarn ? "border-yellow-500/50 dark:border-yellow-500/40" : "border-red-500/50 dark:border-red-500/40"
                        )}>
                          <div className={cn("inline-flex items-center justify-center h-10 w-10 rounded-full mb-2",
                            integrityOk ? "bg-green-500/15 dark:bg-green-500/10 text-green-500" : integrityWarn ? "bg-yellow-500/15 dark:bg-yellow-500/10 text-yellow-500" : "bg-red-500/15 dark:bg-red-500/10 text-red-500"
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

                  {engineHealth.ingestionRuns && (() => {
                    // Hide locked-out and skipped rows by default — the 10-minute
                    // live-tick pings the ingest job ~5x per useful hourly run,
                    // producing "0s, 0 snap" noise rows. Keep them available
                    // behind a toggle so operators can still audit them.
                    const allRuns = engineHealth.ingestionRuns.recentRuns ?? [];
                    const isNoiseRun = (run: any) =>
                      run.status === "locked_out" || run.status === "skipped";
                    const hiddenCount = allRuns.filter(isNoiseRun).length;
                    const visibleRuns = showSkippedRuns
                      ? allRuns
                      : allRuns.filter((r: any) => !isNoiseRun(r));
                    return (
                    <div className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
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
                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowSkippedRuns(prev => !prev)}
                              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                              data-testid="toggle-show-skipped-runs"
                            >
                              {showSkippedRuns ? `Hide skipped (${hiddenCount})` : `Show skipped (${hiddenCount})`}
                            </button>
                          )}
                        </div>
                      </div>
                      {visibleRuns.length > 0 && (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {visibleRuns.map((run: any) => (
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
                                    <span title={sourceStatusTooltip("Wikipedia", run.sourceStatuses.wiki)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.wiki))}>W</span>
                                    <span title={sourceStatusTooltip("Mediastack", run.sourceStatuses.mediastack)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.mediastack))}>M</span>
                                    <span title={sourceStatusTooltip("GDELT", run.sourceStatuses.gdelt)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.gdelt))}>G</span>
                                    <span title={sourceStatusTooltip("Serper (search)", run.sourceStatuses.serper)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.serper))}>S</span>
                                    {run.sourceStatuses.serper_news && (
                                      <span title={sourceStatusTooltip("Serper (news)", run.sourceStatuses.serper_news)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.serper_news))}>SN</span>
                                    )}
                                    <span title={sourceStatusTooltip("Search Momentum", run.sourceStatuses.trends)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.trends))}>T</span>
                                    <span title={sourceStatusTooltip("Search Interest", run.sourceStatuses.searchVolume)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.searchVolume))}>I</span>
                                    <span title={sourceStatusTooltip("Web Sentiment", run.sourceStatuses.webSentiment)} className={cn("text-[10px]", sourceStatusColor(run.sourceStatuses.webSentiment))}>A</span>
                                  </div>
                                )}
                                {run.status === "locked_out" && <Badge variant="outline" className="text-[10px] text-yellow-500 py-0">locked</Badge>}
                                {run.status === "failed" && <Badge variant="outline" className="text-[10px] text-red-500 py-0">failed</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {allRuns.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No ingestion runs recorded yet. Runs will appear after the next ingestion cycle.</p>
                      )}
                      {allRuns.length > 0 && visibleRuns.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          All {allRuns.length} recent run{allRuns.length === 1 ? "" : "s"} were skipped or locked out.
                          {" "}
                          <button
                            type="button"
                            onClick={() => setShowSkippedRuns(true)}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            Show them
                          </button>
                          .
                        </p>
                      )}
                    </div>
                    );
                  })()}

                  {engineHealth.sourceHealth?.statuses && (
                    <div className="p-3 rounded-lg border">
                      <span className="text-xs font-medium text-muted-foreground">Source Health (from last successful run)</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {Object.entries(engineHealth.sourceHealth.statuses as Record<string, string>).map(([source, status]) => {
                          const label = SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]
                            ?? source.charAt(0).toUpperCase() + source.slice(1);
                          // Dot + text colour mirrors the per-run badge
                          // palette so SKIPPED / THROTTLED render as
                          // intentional (grey / blue) rather than red.
                          const dotColor =
                            status === "OK" || status === "OK_FALLBACK" ? "bg-green-500" :
                            status === "DEGRADED" ? "bg-yellow-500" :
                            status === "THROTTLED" ? "bg-blue-500" :
                            status === "SKIPPED" || status === "DISABLED" ? "bg-muted-foreground" :
                            "bg-red-500";
                          const textColor = sourceStatusColor(status);
                          // Some sources run on a slower cadence than the
                          // hourly ingest (e.g. Google Trends every 12h).
                          // For those, the backend substitutes the most
                          // recent run that actually fetched the source so
                          // the indicator reflects health, not cadence
                          // gating. Show a small "X ago" hint when the
                          // displayed status is from an older run.
                          const lastRefreshIso = (engineHealth.sourceHealth.lastRefreshAt as Record<string, string> | undefined)?.[source];
                          let ageLabel: string | null = null;
                          if (lastRefreshIso) {
                            const ageMs = Date.now() - new Date(lastRefreshIso).getTime();
                            const ageHours = ageMs / (60 * 60 * 1000);
                            ageLabel = ageHours < 1
                              ? `${Math.max(1, Math.round(ageMs / 60000))}m ago`
                              : ageHours < 48
                                ? `${Math.round(ageHours)}h ago`
                                : `${Math.round(ageHours / 24)}d ago`;
                          }
                          const tooltip = ageLabel
                            ? `${sourceStatusTooltip(label, status)} · last refreshed ${ageLabel}`
                            : sourceStatusTooltip(label, status);
                          return (
                            <div key={source} className="flex items-center justify-between text-sm p-2 rounded border" title={tooltip}>
                              <span className="font-medium">{label}</span>
                              <div className="flex items-center gap-2">
                                <div className={cn("h-2 w-2 rounded-full", dotColor)} />
                                <span className={cn("text-xs", textColor)}>{status}</span>
                                {engineHealth.sourceHealth.timings?.[source] && (
                                  <span className="text-xs text-muted-foreground">({Math.round(engineHealth.sourceHealth.timings[source] / 1000)}s)</span>
                                )}
                                {ageLabel && (
                                  <span className="text-[10px] text-muted-foreground/70" title={`Last actual fetch ${ageLabel}`}>· {ageLabel}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
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
                        <div>
                          <button
                            type="button"
                            className="flex w-full justify-between items-center hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
                            onClick={() => setShowZeroNewsPeople(prev => !prev)}
                          >
                            <span className="flex items-center gap-1">
                              Zero news
                              {(engineHealth.signalQuality?.zeroNews || 0) > 0 && (
                                showZeroNewsPeople ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              )}
                            </span>
                            <span className={cn("font-medium", (engineHealth.signalQuality?.zeroNews || 0) > 20 ? "text-red-500" : (engineHealth.signalQuality?.zeroNews || 0) > 10 ? "text-yellow-500" : "text-muted-foreground")}>
                              {engineHealth.signalQuality?.zeroNews || 0}
                            </span>
                          </button>
                          {showZeroNewsPeople && (engineHealth.zeroNewsPeople?.length ?? 0) > 0 && (
                            <div className="mt-2 max-h-60 overflow-y-auto rounded border bg-background/50 text-xs">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b text-muted-foreground">
                                    <th className="px-2 py-1 text-left font-medium">Name</th>
                                    <th className="px-2 py-1 text-left font-medium">Query Used</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {engineHealth.zeroNewsPeople.map((p: any) => (
                                    <tr key={p.personId} className="border-b last:border-0 hover:bg-muted/30">
                                      <td className="px-2 py-1 font-medium">{p.name}</td>
                                      <td className="px-2 py-1 text-muted-foreground">
                                        {p.newsQueryWidened ? (
                                          <span title={`Widened: ${p.newsQueryWidened}`}>
                                            {p.name} <span className="text-yellow-500">(+widened)</span>
                                          </span>
                                        ) : (
                                          <span>{p.searchQueryOverride || p.name}</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
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
                    <div className="p-3 rounded-lg border border-yellow-500/40 dark:border-yellow-500/30">
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
                    <div className="p-3 rounded-lg border border-red-500/40 dark:border-red-500/30">
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

                  <div className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Wiki Slug Audit</span>
                      <div className="flex items-center gap-2">
                        {wikiAuditResults && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setWikiAuditExpanded(prev => !prev)}
                          >
                            {wikiAuditResults.issueCount} issue{wikiAuditResults.issueCount !== 1 ? "s" : ""} / {wikiAuditResults.total} total
                            {wikiAuditExpanded ? <ChevronUp className="inline h-3 w-3 ml-1" /> : <ChevronDown className="inline h-3 w-3 ml-1" />}
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          disabled={wikiAuditLoading}
                          onClick={async () => {
                            setWikiAuditLoading(true);
                            try {
                              const headers = await getAuthHeaders();
                              const resp = await fetch("/api/admin/wiki-slug-audit", {
                                method: "POST",
                                headers,
                              });
                              if (!resp.ok) throw new Error(await resp.text());
                              const data = await resp.json();
                              setWikiAuditResults(data);
                              setWikiAuditExpanded(true);
                            } catch (err: any) {
                              console.error("Wiki audit failed:", err);
                            } finally {
                              setWikiAuditLoading(false);
                            }
                          }}
                        >
                          {wikiAuditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          {wikiAuditLoading ? "Auditing..." : "Run Audit"}
                        </button>
                      </div>
                    </div>

                    {wikiAuditExpanded && wikiAuditResults?.results && (
                      <div className="mt-3 max-h-80 overflow-auto rounded border bg-background/50 text-xs">
                        <table className="w-full min-w-[600px]">
                          <thead>
                            <tr className="border-b text-muted-foreground sticky top-0 bg-background">
                              <th className="px-2 py-1.5 text-left font-medium">Name</th>
                              <th className="px-2 py-1.5 text-left font-medium">Current Slug</th>
                              <th className="px-2 py-1.5 text-left font-medium">Status</th>
                              <th className="px-2 py-1.5 text-right font-medium">Views/day</th>
                              <th className="px-2 py-1.5 text-left font-medium">Note / Suggested Fix</th>
                              <th className="px-2 py-1.5 text-right font-medium"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {wikiAuditResults.results.map((r: any) => (
                              <tr key={r.personId} className={cn(
                                "border-b last:border-0",
                                r.status === "ok" || r.status === "redirect_ok" ? "opacity-50" : "hover:bg-muted/30",
                              )}>
                                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                                <td className="px-2 py-1.5 text-muted-foreground font-mono max-w-[180px] truncate" title={r.currentSlug || ""}>
                                  {r.currentSlug || <span className="italic">none</span>}
                                </td>
                                <td className="px-2 py-1.5">
                                  <Badge variant="outline" className={cn("text-[10px]", {
                                    "border-green-500/60 dark:border-green-500/50 text-green-500": r.status === "ok" || r.status === "redirect_ok",
                                    "border-red-500/60 dark:border-red-500/50 text-red-500": r.status === "not_found",
                                    "border-yellow-500/60 dark:border-yellow-500/50 text-yellow-500": r.status === "redirect" || r.status === "low_views" || r.status === "missing",
                                    "border-muted-foreground/50": r.status === "error",
                                  })}>
                                    {r.status === "ok" ? "OK"
                                      : r.status === "redirect_ok" ? "Redirect (OK)"
                                      : r.status === "redirect" ? "Redirect"
                                      : r.status === "low_views" ? "Low Views"
                                      : r.status === "missing" ? "Missing"
                                      : r.status === "not_found" ? "Not Found"
                                      : "Error"}
                                  </Badge>
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {r.viewsPerDay != null ? r.viewsPerDay.toLocaleString() : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-muted-foreground max-w-[260px]">
                                  {r.note ? (
                                    <span className="text-[10px] leading-tight block" title={r.note}>{r.note}</span>
                                  ) : r.suggestedSlug ? (
                                    <span className="font-mono truncate block" title={r.suggestedSlug}>{r.suggestedSlug}</span>
                                  ) : "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  {r.suggestedSlug && r.status !== "ok" && r.status !== "redirect_ok" && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                                      disabled={wikiSlugFixingId === r.personId}
                                      onClick={async () => {
                                        setWikiSlugFixingId(r.personId);
                                        try {
                                          const headers = await getAuthHeaders();
                                          const resp = await fetch(`/api/admin/celebrities/${r.personId}`, {
                                            method: "PATCH",
                                            headers: { ...headers, "Content-Type": "application/json" },
                                            body: JSON.stringify({ wikiSlug: r.suggestedSlug }),
                                          });
                                          if (!resp.ok) throw new Error(await resp.text());
                                          setWikiAuditResults((prev: any) => ({
                                            ...prev,
                                            issueCount: prev.issueCount - 1,
                                            results: prev.results.map((item: any) =>
                                              item.personId === r.personId
                                                ? { ...item, currentSlug: r.suggestedSlug, status: "ok", suggestedSlug: null, note: null }
                                                : item
                                            ),
                                          }));
                                        } catch (err: any) {
                                          console.error("Failed to fix wiki slug:", err);
                                        } finally {
                                          setWikiSlugFixingId(null);
                                        }
                                      }}
                                    >
                                      {wikiSlugFixingId === r.personId ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                                      Fix
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Mediastack News Audit</span>
                      <div className="flex items-center gap-2">
                        {msAuditResults && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setMsAuditExpanded(prev => !prev)}
                          >
                            {msAuditResults.issueCount} issue{msAuditResults.issueCount !== 1 ? "s" : ""} / {msAuditResults.total} total
                            {msAuditExpanded ? <ChevronUp className="inline h-3 w-3 ml-1" /> : <ChevronDown className="inline h-3 w-3 ml-1" />}
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          disabled={msAuditLoading}
                          onClick={async () => {
                            setMsAuditLoading(true);
                            try {
                              const headers = await getAuthHeaders();
                              const resp = await fetch("/api/admin/mediastack-audit", {
                                method: "POST",
                                headers,
                              });
                              if (!resp.ok) throw new Error(await resp.text());
                              const data = await resp.json();
                              setMsAuditResults(data);
                              setMsAuditExpanded(true);
                            } catch (err: any) {
                              console.error("Mediastack audit failed:", err);
                            } finally {
                              setMsAuditLoading(false);
                            }
                          }}
                        >
                          {msAuditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          {msAuditLoading ? "Auditing..." : "Run Audit"}
                        </button>
                      </div>
                    </div>

                    {msAuditExpanded && msAuditResults?.results && (
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(["all", "zero_articles", "no_cache", "stale", "ok"] as const).map(f => {
                            const count = f === "all"
                              ? msAuditResults.results.length
                              : msAuditResults.results.filter((r: any) => r.status === f).length;
                            return (
                              <button
                                key={f}
                                type="button"
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors border",
                                  msAuditFilter === f
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                                )}
                                onClick={() => setMsAuditFilter(f)}
                              >
                                {f === "all" ? "All" : f === "zero_articles" ? "Zero Articles" : f === "no_cache" ? "No Cache" : f === "stale" ? "Stale" : "OK"}
                                <span className="opacity-70">({count})</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="max-h-80 overflow-auto rounded border bg-background/50 text-xs">
                          <table className="w-full min-w-[600px]">
                            <thead>
                              <tr className="border-b text-muted-foreground sticky top-0 bg-background">
                                <th className="px-2 py-1.5 text-left font-medium">Name</th>
                                <th className="px-2 py-1.5 text-left font-medium">Query Used</th>
                                <th className="px-2 py-1.5 text-right font-medium">Articles</th>
                                <th className="px-2 py-1.5 text-left font-medium">Top Headlines</th>
                                <th className="px-2 py-1.5 text-left font-medium">Status</th>
                                <th className="px-2 py-1.5 text-right font-medium">Cache Age</th>
                                <th className="px-2 py-1.5 text-center font-medium">Live Test</th>
                              </tr>
                            </thead>
                            <tbody>
                              {msAuditResults.results
                                .filter((r: any) => msAuditFilter === "all" || r.status === msAuditFilter)
                                .map((r: any) => (
                                <tr key={r.personId} className={cn(
                                  "border-b last:border-0",
                                  r.status === "ok" ? "opacity-50" : "hover:bg-muted/30",
                                )}>
                                  <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.name}</td>
                                  <td className="px-2 py-1.5 text-muted-foreground max-w-[140px] truncate" title={r.queryUsed}>
                                    {r.queryUsed}
                                    {r.widenedQuery && (
                                      <span className="ml-1 text-yellow-500" title={`Widened: ${r.widenedQuery} (${r.widenedArticleCount ?? 0} articles)`}>
                                        (+W)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">
                                    {r.articleCount != null ? r.articleCount : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground max-w-[250px]">
                                    {r.topHeadlines?.length > 0 ? (
                                      <span className="line-clamp-2 text-[10px]" title={r.topHeadlines.join(" | ")}>
                                        {r.topHeadlines[0]}
                                      </span>
                                    ) : (
                                      <span className="italic text-muted-foreground/50">none</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Badge variant="outline" className={cn("text-[10px]", {
                                      "border-green-500/60 dark:border-green-500/50 text-green-500": r.status === "ok",
                                      "border-red-500/60 dark:border-red-500/50 text-red-500": r.status === "zero_articles",
                                      "border-yellow-500/60 dark:border-yellow-500/50 text-yellow-500": r.status === "no_cache" || r.status === "stale",
                                    })}>
                                      {r.status === "ok" ? "OK" : r.status === "zero_articles" ? "Zero Articles" : r.status === "no_cache" ? "No Cache" : "Stale"}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                                    {r.cacheAge || "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    {msProbeResults[r.personId] ? (
                                      <div className="text-[10px] leading-tight">
                                        {msProbeResults[r.personId].recommendation === "relaxed_helps" ? (
                                          <span className="text-green-500" title={`EN: ${msProbeResults[r.personId].withLanguageFilter.articleCount}, All langs: ${msProbeResults[r.personId].withoutLanguageFilter.articleCount}`}>
                                            +{msProbeResults[r.personId].withoutLanguageFilter.articleCount} (no lang filter)
                                          </span>
                                        ) : msProbeResults[r.personId].recommendation === "no_results" ? (
                                          <span className="text-red-600 dark:text-red-400">0 both</span>
                                        ) : (
                                          <span className="text-muted-foreground">{msProbeResults[r.personId].withLanguageFilter.articleCount} EN</span>
                                        )}
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 disabled:opacity-50"
                                        disabled={msProbeLoading === r.personId}
                                        onClick={async () => {
                                          setMsProbeLoading(r.personId);
                                          try {
                                            const headers = await getAuthHeaders();
                                            const resp = await fetch("/api/admin/mediastack-probe", {
                                              method: "POST",
                                              headers: { ...headers, "Content-Type": "application/json" },
                                              body: JSON.stringify({ personName: r.name }),
                                            });
                                            if (!resp.ok) throw new Error(await resp.text());
                                            const data = await resp.json();
                                            setMsProbeResults(prev => ({ ...prev, [r.personId]: data }));
                                          } catch (err: any) {
                                            console.error("Probe failed:", err);
                                          } finally {
                                            setMsProbeLoading(null);
                                          }
                                        }}
                                      >
                                        {msProbeLoading === r.personId ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Test"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Serper Search Audit</span>
                      <div className="flex items-center gap-2">
                        {serperAuditResults && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSerperAuditExpanded((prev) => !prev)}
                          >
                            {serperAuditResults.issueCount} issue{serperAuditResults.issueCount !== 1 ? "s" : ""} /{" "}
                            {serperAuditResults.total} total
                            {serperAuditExpanded ? (
                              <ChevronUp className="inline h-3 w-3 ml-1" />
                            ) : (
                              <ChevronDown className="inline h-3 w-3 ml-1" />
                            )}
                          </button>
                        )}
                        {serperAuditResults?.results?.some((r: any) => r.status === "stale") && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded border border-yellow-500/50 dark:border-yellow-500/40 bg-yellow-500/15 dark:bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-600 hover:bg-yellow-500/25 dark:hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                            disabled={serperRefreshLoading}
                            onClick={async () => {
                              const staleIds = serperAuditResults.results
                                .filter((r: any) => r.status === "stale")
                                .map((r: any) => r.personId);
                              if (!staleIds.length) return;

                              setSerperRefreshLoading(true);
                              try {
                                const headers = await getAuthHeaders();
                                const refreshResp = await fetch("/api/admin/serper-refresh", {
                                  method: "POST",
                                  headers: { ...headers, "Content-Type": "application/json" },
                                  body: JSON.stringify({ personIds: staleIds }),
                                });
                                if (!refreshResp.ok) throw new Error(await refreshResp.text());

                                const auditResp = await fetch("/api/admin/audit-serper", {
                                  method: "POST",
                                  headers,
                                });
                                if (!auditResp.ok) throw new Error(await auditResp.text());
                                const auditData = await auditResp.json();
                                setSerperAuditResults(auditData);
                                setSerperAuditExpanded(true);
                              } catch (err: any) {
                                console.error("Serper stale refresh failed:", err);
                              } finally {
                                setSerperRefreshLoading(false);
                              }
                            }}
                            title="Run live Serper refresh only for stale rows"
                          >
                            {serperRefreshLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            {serperRefreshLoading ? "Refreshing..." : "Refresh Stale"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          disabled={serperAuditLoading}
                          onClick={async () => {
                            setSerperAuditLoading(true);
                            try {
                              const headers = await getAuthHeaders();
                              const resp = await fetch("/api/admin/audit-serper", {
                                method: "POST",
                                headers,
                              });
                              if (!resp.ok) throw new Error(await resp.text());
                              const data = await resp.json();
                              setSerperAuditResults(data);
                              setSerperAuditExpanded(true);
                            } catch (err: any) {
                              console.error("Serper audit failed:", err);
                            } finally {
                              setSerperAuditLoading(false);
                            }
                          }}
                        >
                          {serperAuditLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Search className="h-3 w-3" />
                          )}
                          {serperAuditLoading ? "Auditing..." : "Run Audit"}
                        </button>
                      </div>
                    </div>

                    {serperAuditExpanded && serperAuditResults?.results && (
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(["all", "zero_results", "no_cache", "stale", "ok"] as const).map((f) => {
                            const count =
                              f === "all"
                                ? serperAuditResults.results.length
                                : serperAuditResults.results.filter((r: any) => r.status === f).length;
                            return (
                              <button
                                key={f}
                                type="button"
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors border",
                                  serperAuditFilter === f
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                                )}
                                onClick={() => setSerperAuditFilter(f)}
                              >
                                {f === "all"
                                  ? "All"
                                  : f === "zero_results"
                                    ? "Zero Results"
                                    : f === "no_cache"
                                      ? "No Cache"
                                      : f === "stale"
                                        ? "Stale"
                                        : "OK"}
                                <span className="opacity-70">({count})</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="max-h-80 overflow-auto rounded border bg-background/50 text-xs">
                          <table className="w-full min-w-[600px]">
                            <thead>
                              <tr className="border-b text-muted-foreground sticky top-0 bg-background">
                                <th className="px-2 py-1.5 text-left font-medium">Name</th>
                                <th className="px-2 py-1.5 text-left font-medium">Query Used</th>
                                <th className="px-2 py-1.5 text-right font-medium">Results</th>
                                <th className="px-2 py-1.5 text-left font-medium">Top Result Title</th>
                                <th className="px-2 py-1.5 text-left font-medium">Status</th>
                                <th className="px-2 py-1.5 text-right font-medium">Cache Age</th>
                                <th className="px-2 py-1.5 text-center font-medium">Live Test</th>
                              </tr>
                            </thead>
                            <tbody>
                              {serperAuditResults.results
                                .filter(
                                  (r: any) => serperAuditFilter === "all" || r.status === serperAuditFilter
                                )
                                .map((r: any) => (
                                  <tr
                                    key={r.personId}
                                    className={cn(
                                      "border-b last:border-0",
                                      r.status === "ok" ? "opacity-50" : "hover:bg-muted/30"
                                    )}
                                  >
                                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.name}</td>
                                    <td
                                      className="px-2 py-1.5 text-muted-foreground max-w-[140px] truncate"
                                      title={r.queryUsed}
                                    >
                                      {r.queryUsed}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">
                                      {r.organicCount != null ? (
                                        r.organicCount
                                      ) : r.searchVolume != null ? (
                                        <span title="Composite search activity score (0-100). Organic result count will appear after cache refresh.">
                                          {r.searchVolume}
                                        </span>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-muted-foreground max-w-[250px]">
                                      {r.topResultTitle ? (
                                        <span className="line-clamp-2 text-[10px]" title={r.topResultTitle}>
                                          {r.topResultTitle}
                                        </span>
                                      ) : (
                                        <span className="italic text-muted-foreground/50">none</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Badge
                                        variant="outline"
                                        className={cn("text-[10px]", {
                                          "border-green-500/60 dark:border-green-500/50 text-green-500": r.status === "ok",
                                          "border-red-500/60 dark:border-red-500/50 text-red-500": r.status === "zero_results",
                                          "border-yellow-500/60 dark:border-yellow-500/50 text-yellow-500":
                                            r.status === "no_cache" || r.status === "stale",
                                        })}
                                      >
                                        {r.status === "ok"
                                          ? "OK"
                                          : r.status === "zero_results"
                                            ? "Zero Results"
                                            : r.status === "no_cache"
                                              ? "No Cache"
                                              : "Stale"}
                                      </Badge>
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                                      {r.cacheAge || "—"}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      {serperProbeResults[r.personId] ? (
                                        <div className="text-[10px] leading-tight text-muted-foreground">
                                          <span
                                            className="tabular-nums"
                                            title={`Activity ${serperProbeResults[r.personId].searchVolume}`}
                                          >
                                            {serperProbeResults[r.personId].organicCount} org
                                          </span>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 disabled:opacity-50"
                                          disabled={serperProbeLoading === r.personId}
                                          onClick={async () => {
                                            setSerperProbeLoading(r.personId);
                                            try {
                                              const headers = await getAuthHeaders();
                                              const resp = await fetch("/api/admin/serper-probe", {
                                                method: "POST",
                                                headers: { ...headers, "Content-Type": "application/json" },
                                                body: JSON.stringify({
                                                  personName: r.name,
                                                  searchQueryOverride: r.queryUsed !== r.name ? r.queryUsed : undefined,
                                                }),
                                              });
                                              if (!resp.ok) throw new Error(await resp.text());
                                              const data = await resp.json();
                                              setSerperProbeResults((prev) => ({ ...prev, [r.personId]: data }));
                                            } catch (err: any) {
                                              console.error("Serper probe failed:", err);
                                            } finally {
                                              setSerperProbeLoading(null);
                                            }
                                          }}
                                        >
                                          {serperProbeLoading === r.personId ? (
                                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                          ) : (
                                            "Test"
                                          )}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Google Trends Audit</span>
                      <div className="flex items-center gap-2">
                        {trendsAuditResults && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setTrendsAuditExpanded(prev => !prev)}
                          >
                            {trendsAuditResults.issueCount} issue{trendsAuditResults.issueCount !== 1 ? "s" : ""} / {trendsAuditResults.total} total
                            {trendsAuditExpanded ? <ChevronUp className="inline h-3 w-3 ml-1" /> : <ChevronDown className="inline h-3 w-3 ml-1" />}
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                          disabled={trendsAuditLoading}
                          onClick={async () => {
                            setTrendsAuditLoading(true);
                            try {
                              const headers = await getAuthHeaders();
                              const resp = await fetch("/api/admin/trends-audit", {
                                method: "POST",
                                headers,
                              });
                              if (!resp.ok) throw new Error(await resp.text());
                              const data = await resp.json();
                              setTrendsAuditResults(data);
                              setTrendsAuditExpanded(true);
                              setTrendsAuditFilter("all");
                            } catch (err: any) {
                              console.error("Trends audit failed:", err);
                            } finally {
                              setTrendsAuditLoading(false);
                            }
                          }}
                        >
                          {trendsAuditLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          {trendsAuditLoading ? "Auditing..." : "Run Audit"}
                        </button>
                      </div>
                    </div>

                    {trendsAuditExpanded && trendsAuditResults?.results && (
                      <div className="mt-3">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {(["all", "no_data", "stale", "zero_data", "missing_topic_id", "ok"] as const).map((f) => {
                            const count =
                              f === "all"
                                ? trendsAuditResults.results.length
                                : trendsAuditResults.results.filter((r: any) => r.status === f).length;
                            const label =
                              f === "all" ? "All" :
                              f === "no_data" ? "No Data" :
                              f === "stale" ? "Stale" :
                              f === "zero_data" ? "Zero Data" :
                              f === "missing_topic_id" ? "Missing Topic ID" :
                              "OK";
                            return (
                              <button
                                key={f}
                                type="button"
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors border",
                                  trendsAuditFilter === f
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                                )}
                                onClick={() => setTrendsAuditFilter(f)}
                              >
                                {label}
                                <span className="opacity-70">({count})</span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="max-h-80 overflow-auto rounded border bg-background/50 text-xs">
                          <table className="w-full min-w-[600px]">
                            <thead>
                              <tr className="border-b text-muted-foreground sticky top-0 bg-background">
                                <th className="px-2 py-1.5 text-left font-medium">Name</th>
                                <th className="px-2 py-1.5 text-left font-medium">Topic ID</th>
                                <th className="px-2 py-1.5 text-right font-medium">Latest</th>
                                <th className="px-2 py-1.5 text-right font-medium">7d Avg</th>
                                <th className="px-2 py-1.5 text-right font-medium">Last Fetch</th>
                                <th className="px-2 py-1.5 text-left font-medium">Status</th>
                                <th className="px-2 py-1.5 text-left font-medium">Note</th>
                                <th className="px-2 py-1.5 text-left font-medium">Lookup</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trendsAuditResults.results
                                .filter((r: any) => trendsAuditFilter === "all" || r.status === trendsAuditFilter)
                                .map((r: any) => (
                                  <tr
                                    key={r.personId}
                                    className={cn(
                                      "border-b last:border-0",
                                      r.status === "ok" ? "opacity-50" : "hover:bg-muted/30"
                                    )}
                                  >
                                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.name}</td>
                                    <td className="px-2 py-1.5 text-muted-foreground font-mono max-w-[140px] truncate" title={r.googleTrendsTopicId || "(none)"}>
                                      {r.googleTrendsTopicId || <span className="italic">none</span>}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">
                                      {r.latestInterest != null ? r.latestInterest : "—"}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">
                                      {r.avg7d != null ? r.avg7d : "—"}
                                    </td>
                                    <td className="px-2 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                                      {r.ageHours != null ? `${r.ageHours}h ago` : "—"}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Badge
                                        variant="outline"
                                        className={cn("text-[10px]", {
                                          "border-green-500/60 dark:border-green-500/50 text-green-500": r.status === "ok",
                                          "border-red-500/60 dark:border-red-500/50 text-red-500": r.status === "zero_data" || r.status === "no_data",
                                          "border-yellow-500/60 dark:border-yellow-500/50 text-yellow-500": r.status === "stale" || r.status === "missing_topic_id",
                                        })}
                                      >
                                        {r.status === "ok" ? "OK"
                                          : r.status === "zero_data" ? "Zero Data"
                                          : r.status === "no_data" ? "No Data"
                                          : r.status === "stale" ? "Stale"
                                          : "Missing Topic ID"}
                                      </Badge>
                                    </td>
                                    <td className="px-2 py-1.5 text-muted-foreground max-w-[280px]">
                                      {r.note ? (
                                        <span className="text-[10px] leading-tight block" title={r.note}>{r.note}</span>
                                      ) : "—"}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7"
                                            title="Lookup Topic ID on Google Trends"
                                            data-testid={`btn-trends-audit-lookup-${r.personId}`}
                                            onClick={() => loadTrendsSuggestionsFor(r.personId, r.name)}
                                          >
                                            <Search className="h-3.5 w-3.5" />
                                          </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-96 p-0" align="end">
                                          {(() => {
                                            const s = trendsSuggestionsByPerson[r.personId];
                                            const current = r.googleTrendsTopicId || "";
                                            const isSaving = trendsSavingPersonId === r.personId;
                                            return (
                                              <div className="text-xs">
                                                <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
                                                  <div className="min-w-0">
                                                    <div className="font-medium truncate">{r.name}</div>
                                                    <div className="text-muted-foreground font-mono text-[10px] truncate" title={current || "none"}>
                                                      Current: {current || <span className="italic">none</span>}
                                                    </div>
                                                  </div>
                                                  {current && (
                                                    <button
                                                      type="button"
                                                      className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                                                      disabled={isSaving}
                                                      onClick={() => applyTrendsTopicId(r.personId, "")}
                                                    >
                                                      Clear
                                                    </button>
                                                  )}
                                                </div>
                                                <div className="max-h-72 overflow-y-auto">
                                                  {s?.loading ? (
                                                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                                                      <Loader2 className="h-3 w-3 animate-spin" />
                                                      <span>Searching Google Trends...</span>
                                                    </div>
                                                  ) : s?.error ? (
                                                    <div className="px-3 py-4 text-destructive">{s.error}</div>
                                                  ) : !s || s.suggestions.length === 0 ? (
                                                    <div className="px-3 py-4 text-muted-foreground">
                                                      No Google Trends matches for this name.
                                                    </div>
                                                  ) : (
                                                    <ul className="divide-y">
                                                      {s.suggestions.map((sug) => {
                                                        const isCurrent = sug.topicId === current;
                                                        const isPerson = /person|politician|athlete|singer|actor|musician|rapper|model|youtuber|streamer|author|comedian|chef|host/i.test(sug.type);
                                                        return (
                                                          <li key={sug.topicId}>
                                                            <button
                                                              type="button"
                                                              disabled={isSaving || isCurrent}
                                                              onClick={() => applyTrendsTopicId(r.personId, sug.topicId)}
                                                              className={cn(
                                                                "w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors disabled:cursor-default",
                                                                isCurrent && "bg-primary/10",
                                                              )}
                                                            >
                                                              <div className="flex items-center gap-2 min-w-0">
                                                                <span className="font-medium truncate flex-1">{sug.title}</span>
                                                                {isPerson && (
                                                                  <Badge variant="outline" className="text-[9px] border-green-500/60 text-green-500 shrink-0">
                                                                    Person
                                                                  </Badge>
                                                                )}
                                                                {isCurrent && (
                                                                  <Badge variant="outline" className="text-[9px] shrink-0">Current</Badge>
                                                                )}
                                                              </div>
                                                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                                                                <span className="truncate">{sug.type}</span>
                                                                <span className="font-mono shrink-0">{sug.topicId}</span>
                                                              </div>
                                                            </button>
                                                          </li>
                                                        );
                                                      })}
                                                    </ul>
                                                  )}
                                                </div>
                                                <div className="px-3 py-2 border-t text-[10px] text-muted-foreground">
                                                  Click a suggestion to save. Trends data refreshes on the next 12h cycle.
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </PopoverContent>
                                      </Popover>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
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

              {/* "Capture Snapshots" card removed — its endpoint was a no-op.
                  Snapshots are written only by the hourly ingest job; use
                  "Refresh Data" to force a run. */}

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

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImagePlus className="h-5 w-5 text-cyan-500" />
                    Sync Curate Images
                  </CardTitle>
                  <CardDescription>
                    Pull gallery images from Supabase storage into curate profiles
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => syncCurateImagesMutation.mutate()}
                    disabled={syncCurateImagesMutation.isPending}
                    data-testid="button-sync-curate-images"
                  >
                    {syncCurateImagesMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Syncing Images...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Sync Curate Images
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
                              result.conclusion === "POSSIBLE_MISMATCH" && "border-red-500/40 dark:border-red-500/30 bg-red-500/8 dark:bg-red-500/5",
                              result.conclusion === "ENTITY_MATCH_OK" && "border-green-500/20",
                              result.conclusion === "NO_DATA" && "border-yellow-500/40 dark:border-yellow-500/30 bg-yellow-500/8 dark:bg-yellow-500/5"
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
                                  <div key={i} className="flex items-center gap-1 text-red-600 dark:text-red-400">
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
                                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-blue-600 dark:text-blue-400 hover:underline text-xs" data-testid={`link-entity-result-${i}`}>({r.domain})</a>
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

            <SectionSuspense>
              <AdminLeaderboardDiff />
              <AdminScoreInspector />
            </SectionSuspense>
          </div>
        )}
      </main>

      {/* Credit Adjustment Modal */}
      <Dialog open={showCreditModal} onOpenChange={setShowCreditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Vox</DialogTitle>
            <DialogDescription>
              Modify Vox for {selectedUser?.username || "user"}
              <br />
              Current balance: {formatVox(selectedUser?.predictCredits || 0)}
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
                placeholder="Explain why you're adjusting this user's Vox..."
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

      {/* Reconcile Credit Drift Modal */}
      <Dialog
        open={reconcileDriftTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReconcileDriftTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile credit drift</DialogTitle>
            <DialogDescription>
              Writes a single <code>manual_drift_reconciliation</code> ledger row to bring the
              user's ledger sum in line with their (authoritative) wallet balance. The wallet
              itself is unchanged; only the audit trail is closed out.
            </DialogDescription>
          </DialogHeader>
          {reconcileDriftTarget && (
            <div className="space-y-3 py-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">User</span>
                <span className="font-medium">{reconcileDriftTarget.username || reconcileDriftTarget.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Wallet (authoritative)</span>
                <span className="font-medium">{formatVox(reconcileDriftTarget.predictCredits)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ledger sum (current)</span>
                <span className="font-medium">
                  {typeof reconcileDriftTarget.ledgerSum === "number"
                    ? formatVox(reconcileDriftTarget.ledgerSum)
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-muted-foreground">Ledger row to write</span>
                <span
                  className={`font-bold ${(reconcileDriftTarget.drift ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                  data-testid="text-drift-reconcile-delta"
                >
                  {(reconcileDriftTarget.drift ?? 0) > 0 ? "+" : ""}
                  {formatVox(reconcileDriftTarget.drift ?? 0)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReconcileDriftTarget(null)}
              disabled={reconcileDriftMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (reconcileDriftTarget) reconcileDriftMutation.mutate(reconcileDriftTarget.id);
              }}
              disabled={reconcileDriftMutation.isPending || !reconcileDriftTarget}
              data-testid="button-confirm-reconcile-drift"
            >
              {reconcileDriftMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reconciling...
                </>
              ) : (
                "Confirm Reconcile"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban User Modal */}
      <Dialog open={showBanUserModal} onOpenChange={setShowBanUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Ban User</DialogTitle>
            <DialogDescription>
              Banned users keep their data but lose platform access until manually restored.
              <br />
              Target: {banUserTarget?.username || "user"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ban-user-reason">Reason (required)</Label>
              <Textarea
                id="ban-user-reason"
                value={banUserReason}
                onChange={(e) => setBanUserReason(e.target.value)}
                placeholder="Explain why this user is being banned..."
                data-testid="input-ban-user-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-ban-user">Type "BAN" to confirm</Label>
              <Input
                id="confirm-ban-user"
                value={banUserConfirmText}
                onChange={(e) => setBanUserConfirmText(e.target.value)}
                placeholder="BAN"
                data-testid="input-confirm-ban-user"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBanUserModal(false);
                setBanUserTarget(null);
                setBanUserReason("");
                setBanUserConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBanUser}
              disabled={
                banUserMutation.isPending ||
                !banUserTarget ||
                !banUserReason.trim() ||
                banUserConfirmText !== "BAN"
              }
              data-testid="button-confirm-ban-user"
            >
              {banUserMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Banning...
                </>
              ) : (
                "Confirm Ban"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Native market Settle / Delete confirm */}
      <Dialog
        open={confirmNativeAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmNativeAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={confirmNativeAction?.kind === "delete" ? "text-destructive" : undefined}>
              {confirmNativeAction?.kind === "settle" ? "Settle market now?" : "Delete market?"}
            </DialogTitle>
            <DialogDescription>
              {confirmNativeAction?.kind === "settle"
                ? "This resolves the market against current scores and pays out users immediately. It cannot be undone."
                : "This permanently removes the market and its entries. It cannot be undone."}
              {confirmNativeAction?.title ? (
                <>
                  <br />
                  Target: {confirmNativeAction.title}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNativeAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmNativeAction?.kind === "delete" ? "destructive" : "default"}
              disabled={settleNativeMarketMutation.isPending || deleteNativeMarketMutation.isPending}
              onClick={() => {
                if (!confirmNativeAction) return;
                if (confirmNativeAction.kind === "settle") {
                  settleNativeMarketMutation.mutate({ id: confirmNativeAction.id });
                } else {
                  deleteNativeMarketMutation.mutate(confirmNativeAction.id);
                }
                setConfirmNativeAction(null);
              }}
              data-testid="button-confirm-native-action"
            >
              {confirmNativeAction?.kind === "settle" ? "Settle market" : "Delete market"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unban User Modal */}
      <Dialog open={showUnbanUserModal} onOpenChange={setShowUnbanUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unban User</DialogTitle>
            <DialogDescription>
              Restores platform access. The user's role returns to "user".
              <br />
              Target: {unbanUserTarget?.username || "user"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="unban-user-reason">Reason (required)</Label>
              <Textarea
                id="unban-user-reason"
                value={unbanUserReason}
                onChange={(e) => setUnbanUserReason(e.target.value)}
                placeholder="Explain why this user is being unbanned..."
                data-testid="input-unban-user-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-unban-user">Type "UNBAN" to confirm</Label>
              <Input
                id="confirm-unban-user"
                value={unbanUserConfirmText}
                onChange={(e) => setUnbanUserConfirmText(e.target.value)}
                placeholder="UNBAN"
                data-testid="input-confirm-unban-user"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowUnbanUserModal(false);
                setUnbanUserTarget(null);
                setUnbanUserReason("");
                setUnbanUserConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUnbanUser}
              disabled={
                unbanUserMutation.isPending ||
                !unbanUserTarget ||
                !unbanUserReason.trim() ||
                unbanUserConfirmText !== "UNBAN"
              }
              data-testid="button-confirm-unban-user"
            >
              {unbanUserMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Unbanning...
                </>
              ) : (
                "Confirm Unban"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Modal */}
      <Dialog open={showDeleteUserModal} onOpenChange={setShowDeleteUserModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete User Account</DialogTitle>
            <DialogDescription>
              This permanently deletes the user from app data and Supabase auth.
              <br />
              Target: {deleteUserTarget?.username || "user"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="delete-user-reason">Reason (required)</Label>
              <Textarea
                id="delete-user-reason"
                value={deleteUserReason}
                onChange={(e) => setDeleteUserReason(e.target.value)}
                placeholder="Explain why this user is being permanently deleted..."
                data-testid="input-delete-user-reason"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-delete-user">Type "DELETE" to confirm</Label>
              <Input
                id="confirm-delete-user"
                value={deleteUserConfirmText}
                onChange={(e) => setDeleteUserConfirmText(e.target.value)}
                placeholder="DELETE"
                data-testid="input-confirm-delete-user"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteUserModal(false);
                setDeleteUserTarget(null);
                setDeleteUserReason("");
                setDeleteUserConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={
                deleteUserMutation.isPending ||
                !deleteUserTarget ||
                !deleteUserReason.trim() ||
                deleteUserConfirmText !== "DELETE"
              }
              data-testid="button-confirm-delete-user"
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Permanently Delete User"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Celebrity Modal */}
      <Dialog
        open={showCelebrityModal}
        onOpenChange={(open) => {
          setShowCelebrityModal(open);
          if (!open) {
            setEditingCelebrity(null);
            setPendingCelebrityGalleryFiles([]);
            setSeedApprovalCounts(DEFAULT_SEED_APPROVAL_COUNTS);
            setSeedApprovalLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
                  {celebrityCategoryOptions.map((categoryLabel) => (
                    <SelectItem key={categoryLabel} value={categoryLabel}>
                      {categoryLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <AdminCategoryMultiSelect
                options={adminCategorySelectOptions}
                value={celebrityForm.secondaryCategories}
                onChange={(next) => setCelebrityForm({ ...celebrityForm, secondaryCategories: next })}
                primaryValue={celebrityForm.category}
                testId="celebrity-secondary-categories"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-status">Status</Label>
              <Select 
                value={celebrityForm.status} 
                onValueChange={(value) => setCelebrityForm({ ...celebrityForm, status: value })}
                disabled={editingCelebrity?.status === "induction"}
              >
                <SelectTrigger data-testid="select-celebrity-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {editingCelebrity?.status === "induction" ? (
                    <SelectItem value="induction">Induction Queue</SelectItem>
                  ) : null}
                  <SelectItem value="main_leaderboard">Main Leaderboard</SelectItem>
                </SelectContent>
              </Select>
              {editingCelebrity?.status === "induction" ? (
                <p className="text-xs text-muted-foreground">
                  Induction shadows stay in the queue until approved via Voting CMS → Induction Queue.
                </p>
              ) : null}
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
              <p className="text-xs text-muted-foreground">X/Twitter username. The leading @ is stripped on save.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-instagram">Instagram Handle (optional)</Label>
              <Input
                id="celeb-instagram"
                value={celebrityForm.instagramHandle}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, instagramHandle: e.target.value })}
                placeholder="e.g., @zendaya"
                data-testid="input-celebrity-instagram"
              />
              <p className="text-xs text-muted-foreground">Instagram username. The leading @ is stripped on save.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-tiktok">TikTok Handle (optional)</Label>
              <Input
                id="celeb-tiktok"
                value={celebrityForm.tiktokHandle}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, tiktokHandle: e.target.value })}
                placeholder="e.g., @khaby.lame"
                data-testid="input-celebrity-tiktok"
              />
              <p className="text-xs text-muted-foreground">TikTok username. The leading @ is stripped on save.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-youtube">YouTube Channel ID (optional)</Label>
              <Input
                id="celeb-youtube"
                value={celebrityForm.youtubeId}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, youtubeId: e.target.value })}
                placeholder="e.g., UCX6OQ3DkcsbYNE6H8uQQuVA"
                data-testid="input-celebrity-youtube"
              />
              <p className="text-xs text-muted-foreground">YouTube channel ID — starts with "UC" and is 24 characters. Not the @handle.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="celeb-spotify">Spotify Artist ID (optional)</Label>
              <Input
                id="celeb-spotify"
                value={celebrityForm.spotifyId}
                onChange={(e) => setCelebrityForm({ ...celebrityForm, spotifyId: e.target.value })}
                placeholder="e.g., 06HL4z0CvFAxyc27GXpf02"
                data-testid="input-celebrity-spotify"
              />
              <p className="text-xs text-muted-foreground">22-character alphanumeric artist ID from the Spotify URL.</p>
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
            <div className="space-y-2">
              <Label htmlFor="celeb-trends-topic-id">Google Trends Topic ID (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="celeb-trends-topic-id"
                  value={celebrityForm.googleTrendsTopicId}
                  onChange={(e) => setCelebrityForm({ ...celebrityForm, googleTrendsTopicId: e.target.value })}
                  placeholder="e.g., /m/0cqt90"
                  data-testid="input-celebrity-trends-topic"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="btn-trends-lookup"
                  onClick={async () => {
                    const name = celebrityForm.name || editingCelebrity?.name;
                    if (!name) return;
                    try {
                      const res = await fetchWithAuth("/api/admin/trends-topic-suggestions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: name }),
                      });
                      if (!res.ok) {
                        toast.error("Lookup failed", { description: `HTTP ${res.status}` });
                        return;
                      }
                      const data = await res.json();
                      if (data.suggestions?.length > 0) {
                        const personSuggestion = data.suggestions.find(
                          (s: any) => s.type?.toLowerCase().includes("person") ||
                            s.type?.toLowerCase().includes("politician") ||
                            s.type?.toLowerCase().includes("athlete") ||
                            s.type?.toLowerCase().includes("singer") ||
                            s.type?.toLowerCase().includes("actor")
                        ) || data.suggestions[0];
                        setCelebrityForm(prev => ({ ...prev, googleTrendsTopicId: personSuggestion.topicId }));
                        toast.success("Topic ID found", {
                          description: `${personSuggestion.title} (${personSuggestion.type}) — ${personSuggestion.topicId}`,
                        });
                      } else {
                        toast.info("No suggestions", { description: "Google Trends has no entity match for this name." });
                      }
                    } catch (err) {
                      toast.error("Lookup error", { description: (err as Error).message });
                    }
                  }}
                >
                  Lookup
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Unique Google Trends entity ID for disambiguation. Click Lookup to auto-detect.
                {!celebrityForm.googleTrendsTopicId && (
                  <span className="text-yellow-600 ml-1">⚠ Without a Topic ID, Trends data uses name search (less accurate).</span>
                )}
              </p>
            </div>
            {!editingCelebrity && (
              <div className="space-y-2 border-t pt-4">
                <Label>Profile images (optional, max {MAX_ADD_CELEBRITY_GALLERY})</Label>
                <p className="text-xs text-muted-foreground">
                  Stored in Supabase, same pipeline as Curate Profile. The first image becomes the primary avatar; uploads run after the person is created.
                </p>
                <input
                  ref={addCelebrityGalleryInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  data-testid="input-add-celebrity-gallery"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files || []).filter((f) =>
                      ["image/png", "image/jpeg", "image/webp"].includes(f.type),
                    );
                    setPendingCelebrityGalleryFiles((prev) => {
                      const next = [...prev, ...picked].slice(0, MAX_ADD_CELEBRITY_GALLERY);
                      return next;
                    });
                    e.target.value = "";
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingCelebrityGalleryFiles.length >= MAX_ADD_CELEBRITY_GALLERY}
                    onClick={() => addCelebrityGalleryInputRef.current?.click()}
                    data-testid="button-add-celebrity-pick-images"
                  >
                    <ImagePlus className="h-4 w-4 mr-2" />
                    Add images
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {pendingCelebrityGalleryFiles.length}/{MAX_ADD_CELEBRITY_GALLERY} selected
                  </span>
                </div>
                {pendingCelebrityGalleryFiles.length > 0 && (
                  <ul className="text-xs space-y-1 max-h-28 overflow-y-auto">
                    {pendingCelebrityGalleryFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{f.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2"
                          onClick={() =>
                            setPendingCelebrityGalleryFiles((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {editingCelebrity && (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <h4 className="font-medium">Baseline Votes (Seed)</h4>
                  <p className="text-xs text-muted-foreground">
                    Set seed vote counts for ratings 1-5 used as the initial approval baseline.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 leading-snug mt-1">
                    Seed/baseline count only. Public leaderboard vote count includes seeds + community votes + agent votes.
                  </p>
                </div>

                {seedApprovalLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading current seed votes...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      { key: "1", label: "1 - Hate" },
                      { key: "2", label: "2 - Dislike" },
                      { key: "3", label: "3 - Neutral" },
                      { key: "4", label: "4 - Like" },
                      { key: "5", label: "5 - Love" },
                    ] as Array<{ key: SeedRatingKey; label: string }>).map((item) => (
                      <div className="space-y-1" key={item.key}>
                        <Label htmlFor={`seed-rating-${item.key}`}>{item.label}</Label>
                        <Input
                          id={`seed-rating-${item.key}`}
                          type="number"
                          min={0}
                          step={1}
                          value={seedApprovalCounts[item.key]}
                          onChange={(e) => {
                            const parsed = Number.parseInt(e.target.value, 10);
                            setSeedApprovalCounts((prev) => ({
                              ...prev,
                              [item.key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
                            }));
                          }}
                          data-testid={`input-seed-rating-${item.key}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-muted-foreground" data-testid="seed-votes-summary">
                  Total seed votes: <span className="font-medium text-foreground">{baselineTotalVotes}</span>
                  {"  |  "}
                  Implied avg rating:{" "}
                  <span className="font-medium text-foreground">{baselineTotalVotes > 0 ? baselineImpliedAvg.toFixed(2) : "0.00"}</span>
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCelebrityModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveCelebrity}
              disabled={
                !celebrityForm.name ||
                createCelebrityMutation.isPending ||
                updateCelebrityMutation.isPending ||
                celebrityGalleryUploading ||
                (editingCelebrity !== null && seedApprovalLoading)
              }
              data-testid="button-save-celebrity"
            >
              {celebrityGalleryUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading images…
                </>
              ) : (createCelebrityMutation.isPending || updateCelebrityMutation.isPending) ? (
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
                <Card className="p-4 border-violet-500/40 dark:border-violet-500/30 bg-violet-500/8 dark:bg-violet-500/5" data-testid="card-prev-hour">
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
                    <div className="p-3 bg-violet-500/25 dark:bg-violet-500/20 rounded-lg border border-violet-500/40 dark:border-violet-500/30">
                      <p className="text-lg font-bold text-violet-600 dark:text-violet-400">{scoreBreakdown.previousHourComparison.currentFameIndex.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Current</p>
                      <Badge variant="outline" className="mt-1 text-xs">
                        #{scoreBreakdown.currentRank}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 justify-center text-xs">
                    <Badge variant="outline">
                      Scoring: raw (no smoothing / rate limit / catch-up)
                    </Badge>
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
                    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-md bg-muted/40" />}>
                      <AdminFameHistoryChart snapshots={scoreBreakdown.historicalSnapshots} />
                    </Suspense>
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

              {/* Score Calculation */}
              <Card className="p-4" data-testid="card-score-calculation">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Score Calculation
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.massScore.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Mass ({(scoreBreakdown.weights.mass * 100).toFixed(0)}%)</p>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-lg font-bold">{scoreBreakdown.scoreBreakdown.velocityScore.toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">Velocity ({(scoreBreakdown.weights.velocity * 100).toFixed(0)}%)</p>
                  </div>
                  <div className="text-center p-3 bg-violet-500/25 dark:bg-violet-500/20 rounded-lg border border-violet-500/40 dark:border-violet-500/30">
                    <p className="text-lg font-bold text-violet-600 dark:text-violet-400">{scoreBreakdown.scoreBreakdown.fameIndex.toLocaleString()}</p>
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

      {/* Matchup Modal */}
      <Dialog open={showMatchupModal} onOpenChange={setShowMatchupModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingMatchup ? "Edit Matchup" : "Create Matchup"}</DialogTitle>
            <DialogDescription>
              {editingMatchup ? "Update matchup details" : "Create a new matchup voting question"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="matchup-category">Category</Label>
                <Select 
                  value={matchupForm.category} 
                  onValueChange={(value) => setMatchupForm({ ...matchupForm, category: value })}
                >
                  <SelectTrigger data-testid="select-matchup-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminCategorySelectOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="matchup-visibility">Visibility</Label>
                <Select 
                  value={matchupForm.visibility} 
                  onValueChange={(value) => setMatchupForm({ ...matchupForm, visibility: value })}
                >
                  <SelectTrigger data-testid="select-matchup-visibility">
                    <SelectValue placeholder="Select visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                    <SelectItem value="hidden">Hidden</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <AdminCategoryMultiSelect
              options={adminCategorySelectOptions}
              value={matchupForm.secondaryCategories}
              onChange={(next) => setMatchupForm({ ...matchupForm, secondaryCategories: next })}
              primaryValue={matchupForm.category}
              testId="matchup-secondary-categories"
            />

            <GeoCountryTargeting
              enabled={matchupGeoEnabled}
              onEnabledChange={setMatchupGeoEnabled}
              selectedCodes={matchupGeoCountries}
              onSelectedCodesChange={setMatchupGeoCountries}
              testIdPrefix="matchup"
            />

            <Label className="text-sm font-medium">Option A</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 relative">
                <Label className="text-xs text-muted-foreground">Linked Celebrity (optional)</Label>
                {matchupForm.personAId ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/30 border-green-500/40">
                    <span className="text-sm flex-1 truncate">{matchupForm.optionAText}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMatchupForm({ ...matchupForm, personAId: "" })}
                      aria-label="Clear selection"
                      data-testid="button-clear-option-a"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Input
                    value={matchupForm.optionAText}
                    onChange={(e) => {
                      setMatchupForm({ ...matchupForm, optionAText: e.target.value, personAId: "" });
                      setMatchupSearchA(e.target.value);
                    }}
                    placeholder="Search by name..."
                    data-testid="input-matchup-option-a"
                  />
                )}
                {matchupSearchA.length >= 2 && !matchupForm.personAId && celebrities && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {celebrities
                      .filter((c: Celebrity) => c.name.toLowerCase().includes(matchupSearchA.toLowerCase()))
                      .slice(0, 6)
                      .map((c: Celebrity) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover-elevate"
                          onClick={() => {
                            setMatchupForm({
                              ...matchupForm,
                              optionAText: c.name,
                              personAId: c.id,
                              optionAImage: "",
                            });
                            setMatchupSearchA("");
                          }}
                          data-testid={`suggest-a-${c.id}`}
                        >
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={c.avatar || ""} />
                            <AvatarFallback className="text-[10px]">{c.name.slice(0, 2)}</AvatarFallback>
                          </Avatar>
                          <span>{c.name}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{c.category}</span>
                        </button>
                      ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {matchupForm.personAId ? `ID: ${matchupForm.personAId.slice(0, 8)}...` : "Not linked — search and select a celebrity"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Image URL (optional)</Label>
                <UploadImageInput
                  value={matchupForm.optionAImage}
                  onChange={(url) => setMatchupForm({ ...matchupForm, optionAImage: url })}
                  moduleName="matchups"
                  slugOrId="option-a"
                  placeholder="Upload or paste image URL"
                  disabled={!!matchupForm.personAId}
                />
              </div>
            </div>

            <Label className="text-sm font-medium">Option B</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 relative">
                <Label className="text-xs text-muted-foreground">Linked Celebrity (optional)</Label>
                {matchupForm.personBId ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/30 border-green-500/40">
                    <span className="text-sm flex-1 truncate">{matchupForm.optionBText}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setMatchupForm({ ...matchupForm, personBId: "" })}
                      aria-label="Clear selection"
                      data-testid="button-clear-option-b"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Input
                    value={matchupForm.optionBText}
                    onChange={(e) => {
                      setMatchupForm({ ...matchupForm, optionBText: e.target.value, personBId: "" });
                      setMatchupSearchB(e.target.value);
                    }}
                    placeholder="Search by name..."
                    data-testid="input-matchup-option-b"
                  />
                )}
                {matchupSearchB.length >= 2 && !matchupForm.personBId && celebrities && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {celebrities
                      .filter((c: Celebrity) => c.name.toLowerCase().includes(matchupSearchB.toLowerCase()))
                      .slice(0, 6)
                      .map((c: Celebrity) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover-elevate"
                          onClick={() => {
                            setMatchupForm({
                              ...matchupForm,
                              optionBText: c.name,
                              personBId: c.id,
                              optionBImage: "",
                            });
                            setMatchupSearchB("");
                          }}
                          data-testid={`suggest-b-${c.id}`}
                        >
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={c.avatar || ""} />
                            <AvatarFallback className="text-[10px]">{c.name.slice(0, 2)}</AvatarFallback>
                          </Avatar>
                          <span>{c.name}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{c.category}</span>
                        </button>
                      ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {matchupForm.personBId ? `ID: ${matchupForm.personBId.slice(0, 8)}...` : "Not linked — search and select a celebrity"}
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Image URL (optional)</Label>
                <UploadImageInput
                  value={matchupForm.optionBImage}
                  onChange={(url) => setMatchupForm({ ...matchupForm, optionBImage: url })}
                  moduleName="matchups"
                  slugOrId="option-b"
                  placeholder="Upload or paste image URL"
                  disabled={!!matchupForm.personBId}
                />
              </div>
            </div>

            <RelatedCelebritiesField
              value={matchupRelatedPeople}
              onChange={setMatchupRelatedPeople}
              fetchFn={fetchWithAuth}
            />

            <Label className="text-sm font-medium">Seed Votes</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Option A Seed Votes</Label>
                <Input
                  type="number"
                  min="0"
                  value={matchupForm.seedVotesA}
                  onChange={(e) => setMatchupForm({ ...matchupForm, seedVotesA: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                  data-testid="input-seed-votes-a"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Option B Seed Votes</Label>
                <Input
                  type="number"
                  min="0"
                  value={matchupForm.seedVotesB}
                  onChange={(e) => setMatchupForm({ ...matchupForm, seedVotesB: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                  data-testid="input-seed-votes-b"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="matchup-prompt">Pre-Vote Prompt</Label>
              <Input
                id="matchup-prompt"
                value={matchupForm.promptText}
                onChange={(e) => setMatchupForm({ ...matchupForm, promptText: e.target.value })}
                placeholder='e.g. "Who do you prefer?" (leave blank for default)'
                data-testid="input-matchup-prompt"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="matchup-description">Description (optional)</Label>
                {editingMatchup && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={isGeneratingMatchupDescription}
                    onClick={handleGenerateMatchupDescriptionDraft}
                    data-testid="button-matchup-draft-description"
                  >
                    {isGeneratingMatchupDescription ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" /> Draft with AI</>
                    )}
                  </Button>
                )}
              </div>
              <Textarea
                id="matchup-description"
                value={matchupForm.description}
                onChange={(e) => setMatchupForm({ ...matchupForm, description: e.target.value })}
                placeholder="Additional context or details about this matchup"
                className="resize-none"
                rows={3}
                data-testid="input-matchup-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="matchup-slug">URL Slug</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="matchup-slug"
                  value={matchupForm.slug}
                  onChange={(e) => setMatchupForm({ ...matchupForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') })}
                  placeholder="auto-generated-from-options"
                  className="font-mono text-sm"
                  data-testid="input-matchup-slug"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const generated = `${matchupForm.optionAText}-vs-${matchupForm.optionBText}`
                      .toLowerCase()
                      .replace(/[^a-z0-9\s-]/g, '')
                      .replace(/\s+/g, '-')
                      .replace(/-+/g, '-')
                      .replace(/^-|-$/g, '');
                    setMatchupForm({ ...matchupForm, slug: generated });
                  }}
                  data-testid="button-generate-slug"
                >
                  Generate
                </Button>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="matchup-featured"
                checked={matchupForm.featured}
                onCheckedChange={(checked) => setMatchupForm({ ...matchupForm, featured: checked })}
                data-testid="switch-matchup-featured"
              />
              <Label htmlFor="matchup-featured">Featured</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMatchupModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveMatchup}
              disabled={
                !matchupForm.optionAText || 
                !matchupForm.optionBText || 
                createMatchupMutation.isPending || 
                updateMatchupMutation.isPending
              }
              data-testid="button-save-matchup"
            >
              {(createMatchupMutation.isPending || updateMatchupMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                editingMatchup ? "Update Matchup" : "Create Matchup"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Opinion Poll Create/Edit Dialog */}
      <Dialog open={showOpinionPollModal} onOpenChange={setShowOpinionPollModal}>
        <DialogContent className="max-w-xl w-[min(36rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto overflow-x-hidden min-w-0 p-6">
          <DialogHeader>
            <DialogTitle>{editingOpinionPoll ? "Edit Opinion Poll" : "Create Opinion Poll"}</DialogTitle>
            <DialogDescription>
              {editingOpinionPoll ? "Update opinion poll details and options" : "Create a multi-option poll for community voting"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 min-w-0 max-w-full">
            <div className="grid grid-cols-2 gap-4 min-w-0">
              <div className="space-y-2 min-w-0">
                <Label>Visibility</Label>
                <Select
                  value={opinionPollForm.visibility}
                  onValueChange={(value) => setOpinionPollForm(prev => ({ ...prev, visibility: value as any }))}
                >
                  <SelectTrigger className="min-w-0 w-full" data-testid="select-opinion-poll-visibility">
                    <SelectValue placeholder="Select visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Category</Label>
                <Select
                  value={opinionPollForm.category}
                  onValueChange={(value) => setOpinionPollForm(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger className="min-w-0 w-full" data-testid="select-opinion-poll-modal-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminCategorySelectOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 min-w-0">
              <AdminCategoryMultiSelect
                options={adminCategorySelectOptions}
                value={opinionPollForm.secondaryCategories}
                onChange={(next) => setOpinionPollForm(prev => ({ ...prev, secondaryCategories: next }))}
                primaryValue={opinionPollForm.category}
                testId="opinion-poll-secondary-categories"
              />
            </div>
            <GeoCountryTargeting
              enabled={opinionPollGeoEnabled}
              onEnabledChange={setOpinionPollGeoEnabled}
              selectedCodes={opinionPollGeoCountries}
              onSelectedCodesChange={setOpinionPollGeoCountries}
              testIdPrefix="opinion-poll"
            />
            <div className="space-y-2 min-w-0">
              <Label>Title</Label>
              <Input
                value={opinionPollForm.title}
                onChange={(e) => setOpinionPollForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Poll question or title"
                data-testid="input-opinion-poll-title"
              />
            </div>
            <div className="space-y-2 min-w-0">
              <Label>Slug</Label>
              <Input
                value={opinionPollForm.slug}
                onChange={(e) => setOpinionPollForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                placeholder="url-friendly-slug"
                data-testid="input-opinion-poll-slug"
              />
            </div>
            <div className="space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <Label>Subject / Question</Label>
                {editingOpinionPoll && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={isGeneratingOpSubject}
                    onClick={() => handleGenerateOpinionPollDraft("description")}
                  >
                    {isGeneratingOpSubject ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" /> Draft with AI</>
                    )}
                  </Button>
                )}
              </div>
              <Textarea
                value={opinionPollForm.description}
                onChange={(e) => setOpinionPollForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="The main question shown on the poll card"
                className="resize-none min-w-0 max-w-full"
                data-testid="input-opinion-poll-description"
              />
            </div>
            <div className="space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <Label>Description (optional)</Label>
                {editingOpinionPoll && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={isGeneratingOpDescription}
                    onClick={() => handleGenerateOpinionPollDraft("summary")}
                  >
                    {isGeneratingOpDescription ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" /> Draft with AI</>
                    )}
                  </Button>
                )}
              </div>
              <Textarea
                value={opinionPollForm.summary}
                onChange={(e) => setOpinionPollForm(prev => ({ ...prev, summary: e.target.value }))}
                placeholder="Additional context or details"
                rows={8}
                className="min-w-0 max-w-full"
                data-testid="input-opinion-poll-summary"
              />
            </div>
            <div className="space-y-2 min-w-0">
              <Label>Image</Label>
              <UploadImageInput
                value={opinionPollForm.imageUrl}
                onChange={(url) => setOpinionPollForm(prev => ({ ...prev, imageUrl: url }))}
                moduleName="opinion-polls"
                slugOrId={opinionPollForm.slug || "new"}
                placeholder="Upload or paste header image URL"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={opinionPollForm.featured}
                onChange={(e) => setOpinionPollForm(prev => ({ ...prev, featured: e.target.checked }))}
                data-testid="checkbox-opinion-poll-featured"
              />
              <Label>Featured</Label>
            </div>

            <RelatedCelebritiesField
              value={opinionPollRelatedPeople}
              onChange={setOpinionPollRelatedPeople}
              fetchFn={fetchWithAuth}
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Options ({opinionPollForm.options.length}/{OPINION_POLL_MAX_OPTIONS})</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addOpinionOption}
                  disabled={opinionPollForm.options.length >= OPINION_POLL_MAX_OPTIONS}
                  data-testid="button-add-opinion-option"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Option
                </Button>
              </div>
              {opinionPollForm.options.map((opt, idx) => (
                <div key={idx} className="flex items-start gap-2 p-3 rounded-lg border min-w-0 max-w-full">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground w-4 shrink-0">{idx + 1}</span>
                      <Input
                        value={opt.name}
                        onChange={(e) => {
                          updateOpinionOption(idx, "name", e.target.value);
                          if (!opt.personId && e.target.value.trim().length >= 2) {
                            searchCelebrityForOption(idx, e.target.value);
                          }
                        }}
                        placeholder="Option name"
                        className="flex-1 min-w-0"
                        data-testid={`input-opinion-option-name-${idx}`}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={opt.seedCount}
                        onChange={(e) => updateOpinionOption(idx, "seedCount", parseInt(e.target.value) || 0)}
                        placeholder="Seed"
                        className="w-20 shrink-0 text-xs"
                        data-testid={`input-opinion-option-seed-${idx}`}
                      />
                    </div>
                    <div className="ml-6 min-w-0">
                      <UploadImageInput
                        value={opt.imageUrl}
                        onChange={(url) => updateOpinionOption(idx, "imageUrl", url)}
                        moduleName="opinion-poll-options"
                        slugOrId={`${opinionPollForm.slug || "new"}-opt-${idx}`}
                        placeholder="Upload or paste option image"
                      />
                    </div>
                    <div className="relative ml-6 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {opt.personId && opt.imageUrl && (
                          <img src={opt.imageUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0 border border-green-500/50" />
                        )}
                        {!opt.personId && (
                          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <Input
                          value={opOptionSearchInputs[idx] || ""}
                          onChange={(e) => searchCelebrityForOption(idx, e.target.value)}
                          onFocus={() => {
                            const q = (opOptionSearchInputs[idx] || "").trim();
                            if (q && !opt.personId) searchCelebrityForOption(idx, q);
                          }}
                          placeholder={opt.personId ? "Linked — type to change" : "Link to leaderboard celebrity..."}
                          className={`text-xs flex-1 ${opt.personId ? "border-green-500/40" : ""}`}
                          data-testid={`input-opinion-option-celebrity-${idx}`}
                        />
                        {opt.personId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 h-7 w-7"
                            onClick={() => {
                              updateOpinionOption(idx, "personId", "");
                              updateOpinionOption(idx, "name", "");
                              updateOpinionOption(idx, "imageUrl", "");
                              setOpOptionSearchInputs(prev => { const n = [...prev]; n[idx] = ""; return n; });
                            }}
                            aria-label="Clear celebrity"
                            data-testid={`button-clear-opinion-option-celebrity-${idx}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      {opOptionShowDropdown[idx] && (
                        <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto" onMouseDown={(e) => e.preventDefault()}>
                          {opOptionSearchResults[idx]?.length > 0 ? (
                            opOptionSearchResults[idx].map((celeb: any) => (
                              <button
                                key={celeb.id}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2"
                                onClick={() => selectCelebrityForOption(idx, celeb)}
                                data-testid={`option-celebrity-result-${idx}-${celeb.id}`}
                              >
                                {celeb.avatar ? (
                                  <img src={celeb.avatar} alt={celeb.name} className="w-6 h-6 rounded-md object-cover shrink-0" />
                                ) : (
                                  <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                                    {celeb.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                                  </div>
                                )}
                                <span className="truncate">{celeb.name}</span>
                                {celeb.category && (
                                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{celeb.category}</span>
                                )}
                              </button>
                            ))
                          ) : (
                            <p className="px-3 py-2 text-xs text-muted-foreground">No matching celebrities found</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {opinionPollForm.options.length > 3 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOpinionOption(idx)}
                      aria-label="Remove option"
                      data-testid={`button-remove-opinion-option-${idx}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpinionPollModal(false)} data-testid="button-cancel-opinion-poll">
              Cancel
            </Button>
            <Button
              onClick={handleSaveOpinionPoll}
              disabled={!opinionPollForm.title.trim() || !opinionPollForm.slug.trim() || opinionPollForm.options.filter(o => o.name.trim()).length < 3 || createOpinionPollMutation.isPending || updateOpinionPollMutation.isPending}
              data-testid="button-save-opinion-poll"
            >
              {createOpinionPollMutation.isPending || updateOpinionPollMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingOpinionPoll ? "Update Poll" : "Create Poll"}
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
              {editingPoll ? "Update sentiment poll details" : "Create a new sentiment poll question"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="poll-visibility">Visibility</Label>
                <Select
                  value={pollForm.visibility}
                  onValueChange={(value) => setPollForm({ ...pollForm, visibility: value as "draft" | "live" | "inactive" | "archived" })}
                >
                  <SelectTrigger data-testid="select-poll-visibility">
                    <SelectValue placeholder="Select visibility" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft (Admin only)</SelectItem>
                    <SelectItem value="live">Live (Active)</SelectItem>
                    <SelectItem value="inactive">Inactive (Visible but dimmed)</SelectItem>
                    <SelectItem value="archived">Archived (Hidden)</SelectItem>
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
                    {adminCategorySelectOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <AdminCategoryMultiSelect
                options={adminCategorySelectOptions}
                value={pollForm.secondaryCategories}
                onChange={(next) => setPollForm({ ...pollForm, secondaryCategories: next })}
                primaryValue={pollForm.category}
                testId="poll-secondary-categories"
              />
            </div>
            <GeoCountryTargeting
              enabled={pollGeoEnabled}
              onEnabledChange={setPollGeoEnabled}
              selectedCodes={pollGeoCountries}
              onSelectedCodesChange={setPollGeoCountries}
              testIdPrefix="poll"
            />
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="poll-slug">Slug</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="poll-slug"
                    value={pollForm.slug}
                    onChange={(e) => setPollForm({ ...pollForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') })}
                    placeholder="auto-generated-from-headline"
                    data-testid="input-poll-slug"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const generated = pollForm.headline
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .slice(0, 80);
                      setPollForm({ ...pollForm, slug: generated });
                    }}
                    disabled={!pollForm.headline}
                    data-testid="button-generate-slug"
                  >
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Unique URL-friendly identifier</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poll-featured">Featured</Label>
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pollForm.featured}
                    onClick={() => setPollForm({ ...pollForm, featured: !pollForm.featured })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${pollForm.featured ? 'bg-primary' : 'bg-muted'}`}
                    data-testid="toggle-poll-featured"
                  >
                    <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${pollForm.featured ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm text-muted-foreground">{pollForm.featured ? "Featured" : "Not featured"}</span>
                </div>
                <p className="text-xs text-muted-foreground">Highlighted on the Vote page</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="poll-subject">Subject / Question</Label>
                {editingPoll && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={isGeneratingPollSubject}
                    onClick={() => handleGeneratePollDraft("subjectText")}
                  >
                    {isGeneratingPollSubject ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" /> Draft with AI</>
                    )}
                  </Button>
                )}
              </div>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="poll-description">Description (optional)</Label>
                {editingPoll && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={isGeneratingPollDescription}
                    onClick={() => handleGeneratePollDraft("description")}
                  >
                    {isGeneratingPollDescription ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-3 w-3" /> Draft with AI</>
                    )}
                  </Button>
                )}
              </div>
              <Textarea
                id="poll-description"
                value={pollForm.description}
                onChange={(e) => setPollForm({ ...pollForm, description: e.target.value })}
                placeholder="Additional context or details"
                rows={8}
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
                      aria-label="Clear celebrity"
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
                        {celeb.avatar && <img src={celeb.avatar} alt={celeb.name} className="h-6 w-6 rounded object-cover" />}
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
                <UploadImageInput
                  value={pollForm.imageUrl}
                  onChange={(url) => setPollForm({ ...pollForm, imageUrl: url })}
                  moduleName="trending-polls"
                  slugOrId={pollForm.slug || "new"}
                  placeholder="Upload or paste image URL"
                  disabled={!!pollForm.personId}
                />
              </div>
            </div>
            <RelatedCelebritiesField
              value={pollRelatedPeople}
              onChange={setPollRelatedPeople}
              fetchFn={fetchWithAuth}
            />
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
                  <Label htmlFor="poll-seed-agree" className="text-xs">Agree</Label>
                  <Input
                    id="poll-seed-agree"
                    type="number"
                    min="0"
                    value={pollForm.seedAgreeCount}
                    onChange={(e) => setPollForm({ ...pollForm, seedAgreeCount: parseInt(e.target.value) || 0 })}
                    data-testid="input-poll-seed-agree"
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
                  <Label htmlFor="poll-seed-disagree" className="text-xs">Disagree</Label>
                  <Input
                    id="poll-seed-disagree"
                    type="number"
                    min="0"
                    value={pollForm.seedDisagreeCount}
                    onChange={(e) => setPollForm({ ...pollForm, seedDisagreeCount: parseInt(e.target.value) || 0 })}
                    data-testid="input-poll-seed-disagree"
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
        // Deep-linked edits (?edit=<id>) wait for the markets query so the
        // modal opens in edit mode directly instead of flashing "Create".
        open={createMarketOpen || (!!editMarketId && (markets || []).some((mk) => mk.id === editMarketId))}
        onClose={() => { setCreateMarketOpen(false); setEditMarketId(null); }}
        onSubmit={(data) => {
          if (editMarketId) {
            updateMarketMutation.mutate({ id: editMarketId, data });
          } else {
            createMarketMutation.mutate(data);
          }
        }}
        isPending={createMarketMutation.isPending || updateMarketMutation.isPending}
        categoryOptions={adminCategorySelectOptions}
        editMarket={editMarketId ? (() => {
          const m = (markets || []).find((mk: any) => mk.id === editMarketId);
          if (!m) return undefined;
          return m;
        })() : undefined}
      />

      {settleMarket && (
        <AmmResolutionDialog
          market={{
            id: settleMarket.id,
            title: settleMarket.title,
            marketType: settleMarket.marketType,
            category: settleMarket.category ?? null,
            // Community markets are always AMM; default defensively in case
            // the list row predates the engine column.
            engine: settleMarket.engine ?? "amm",
            uniqueBettors: settleMarketDetail?.totalParticipants,
            entries: (settleMarketDetail?.entries ?? []).map((e) => ({
              id: e.id,
              label: e.label,
              marketId: settleMarket.id,
            })),
            scoutAssessment: settleMarket.metadata?.scoutAssessment ?? null,
            resolutionCriteria: settleMarket.resolutionCriteria ?? null,
            sourceRulesText:
              settleMarket.metadata?.source?.resolutionRulesText ?? null,
            sourceUrl:
              settleMarket.metadata?.source?.url ??
              settleMarket.sourceUrl ??
              null,
            metadata: settleMarket.metadata ?? null,
          }}
          open={!!settleMarketId}
          onOpenChange={(isOpen) => { if (!isOpen) setSettleMarketId(null); }}
          invalidateOnSettle={[["/api/admin/markets"]]}
        />
      )}

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

      <Dialog open={!!deleteWorldMarket} onOpenChange={(isOpen) => !isOpen && setDeleteWorldMarket(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-delete-world-market">
          <DialogHeader>
            <DialogTitle>Delete world market permanently?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                This removes <strong className="text-foreground">{deleteWorldMarket?.title}</strong> from the database and admin list.
              </span>
              <span className="block text-destructive/90">
                If the market is still open, active stakes are refunded first (same as void). Resolved history for this market will be removed. This cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteWorldMarket(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteOpenMarketMutation.isPending}
              onClick={() => {
                if (deleteWorldMarket) deleteOpenMarketMutation.mutate(deleteWorldMarket.id);
              }}
              data-testid="button-confirm-delete-world-market"
            >
              {deleteOpenMarketMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Demote to induction queue */}
      <Dialog
        open={!!demoteCelebrityTarget}
        onOpenChange={(open) => {
          if (!open && !demoteCelebrityMutation.isPending) {
            setDemoteCelebrityTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Demote to induction queue?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">
                    {demoteCelebrityTarget?.name}
                  </span>{" "}
                  will be removed from the public main leaderboard immediately.
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Reactivated or added as an active induction candidate (voteable).</li>
                  <li>Historical trend data stays on the same profile id.</li>
                  <li>Use the green tick in Voting CMS → Induction Queue to promote again.</li>
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDemoteCelebrityTarget(null)}
              disabled={demoteCelebrityMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (demoteCelebrityTarget) {
                  demoteCelebrityMutation.mutate(demoteCelebrityTarget.id);
                }
              }}
              disabled={demoteCelebrityMutation.isPending}
              data-testid="button-confirm-demote-celebrity"
            >
              {demoteCelebrityMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Demoting...
                </>
              ) : (
                "Demote to queue"
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
                deleteMatchupMutation.isPending || 
                deletePollMutation.isPending ||
                deleteCommentMutation.isPending
              }
              data-testid="button-confirm-delete"
            >
              {(deleteCelebrityMutation.isPending || deleteMatchupMutation.isPending || deletePollMutation.isPending || deleteCommentMutation.isPending) ? (
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
