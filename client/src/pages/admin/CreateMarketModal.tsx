import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpDown,
  CheckCircle,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { UploadImageInput } from "@/components/ui/upload-image-input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminCategoryMultiSelect } from "@/components/admin/AdminCategoryMultiSelect";
import {
  GeoCountryTargeting,
  geoStateFromAllowlist,
  isGeoTargetingValid,
  visibleCountriesPayload,
} from "@/components/geo/GeoCountryTargeting";
import { dateToLocal, localDatetimeToIso } from "@/lib/datetime-local";
import { normalizeMarketCategory, OPINION_POLL_MAX_OPTIONS } from "@shared/constants";
import { type MarketEntryForm, createMarketEntry } from "@/pages/admin/adminTypes";
import { fetchWithAuth } from "@/pages/admin/adminAuth";
import { RelatedCelebritiesField } from "@/pages/admin/RelatedCelebritiesField";
import { AdminSortableCardList } from "@/components/admin/AdminSortableCardList";

/**
 * World Market create/edit dialog. Extracted verbatim from
 * AdminDashboard.tsx (Phase 3+4 B6 chunk split) — it was already a clean
 * module-scope component taking six props, with no ties to the dashboard's
 * internal state beyond them.
 */
export function CreateMarketModal({
  open,
  onClose,
  onSubmit,
  isPending,
  editMarket,
  categoryOptions,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  editMarket?: any;
  categoryOptions: Array<{ value: string; label: string }>;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [openMarketType, setOpenMarketType] = useState<"binary" | "multi" | "updown">("binary");
  const [teaser, setTeaser] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("misc");
  const [secondaryCategories, setSecondaryCategories] = useState<string[]>([]);
  const [endAt, setEndAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [featured, setFeatured] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [resolveMethod, setResolveMethod] = useState("admin_manual");
  const [resolutionCriteria, setResolutionCriteria] = useState<string[]>([""]);
  const [scoutWatch, setScoutWatch] = useState("");
  const [isSuggestingWatch, setIsSuggestingWatch] = useState(false);
  const [underlying, setUnderlying] = useState("");
  const [metric, setMetric] = useState("");
  const [strike, setStrike] = useState("");
  const [unit, setUnit] = useState("$");
  const [entries, setEntries] = useState<MarketEntryForm[]>([
    createMarketEntry({ label: "Yes" }),
    createMarketEntry({ label: "No" }),
  ]);
  const [visibility, setVisibility] = useState<"draft" | "live" | "inactive" | "archived">("live");
  const [inactiveMessage, setInactiveMessage] = useState("");
  const [personId, setPersonId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [marketCelebSearch, setMarketCelebSearch] = useState("");
  const [marketCelebResults, setMarketCelebResults] = useState<any[]>([]);
  const [showMarketCelebDropdown, setShowMarketCelebDropdown] = useState(false);
  const [selectedMarketCelebName, setSelectedMarketCelebName] = useState("");
  const latestEditMarketIdRef = useRef<string | null>(null);
  const [relatedPeople, setRelatedPeople] = useState<{ id: string; name: string }[]>([]);
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoCountries, setGeoCountries] = useState<string[]>([]);
  const [expandedEntryImage, setExpandedEntryImage] = useState<string | null>(null);
  const [entrySearches, setEntrySearches] = useState<Record<string, string>>({});
  const [entrySearchResults, setEntrySearchResults] = useState<Record<string, any[]>>({});
  const [showEntryDropdown, setShowEntryDropdown] = useState<Record<string, boolean>>({});
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const handleGenerateSummary = async () => {
    if (!editMarket?.id) return;
    setIsGeneratingSummary(true);
    try {
      const res = await fetchWithAuth(`/api/admin/open-markets/${editMarket.id}/generate-summary`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate summary" }));
        throw new Error(err.error || "Failed to generate summary");
      }
      const data = await res.json();
      setSummary(data.summary);
      toast("Summary drafted", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setIsGeneratingSummary(false);
    }
  };
  const handleSuggestWatch = async () => {
    if (!title.trim()) {
      toast.error("Add a title first", { description: "The AI needs the market title to suggest what to watch." });
      return;
    }
    setIsSuggestingWatch(true);
    try {
      const res = await fetchWithAuth(`/api/admin/world-markets/suggest-watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          teaser,
          outcomes: entries.map((e) => e.label).filter(Boolean),
          resolutionCriteria: resolutionCriteria.filter((c) => c.trim()),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to suggest watch criteria" }));
        throw new Error(err.error || "Failed to suggest watch criteria");
      }
      const data = await res.json();
      setScoutWatch(data.scoutWatch);
      toast("Watch criteria drafted", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Suggestion failed", { description: err.message });
    } finally {
      setIsSuggestingWatch(false);
    }
  };

  const [isGeneratingTeaser, setIsGeneratingTeaser] = useState(false);
  const handleGenerateTeaser = async () => {
    if (!editMarket?.id) return;
    setIsGeneratingTeaser(true);
    try {
      const res = await fetchWithAuth(`/api/admin/open-markets/${editMarket.id}/generate-teaser`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to generate teaser" }));
        throw new Error(err.error || "Failed to generate teaser");
      }
      const data = await res.json();
      setTeaser(data.teaser);
      toast("Teaser drafted", { description: "Review and edit before saving." });
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setIsGeneratingTeaser(false);
    }
  };

  useEffect(() => {
    if (open && !editMarket) {
      setGeoEnabled(false);
      setGeoCountries([]);
    }
  }, [open, editMarket]);

  useEffect(() => {
    const generated = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    setSlug(generated);
  }, [title]);

  useEffect(() => {
    if (editMarket) return;
    if (openMarketType === "binary") {
      setEntries([
        createMarketEntry({ label: "Yes" }),
        createMarketEntry({ label: "No" }),
      ]);
    } else if (openMarketType === "updown") {
      setEntries([
        createMarketEntry({ label: "Above" }),
        createMarketEntry({ label: "Below" }),
      ]);
    } else {
      setEntries([
        createMarketEntry(),
        createMarketEntry(),
        createMarketEntry(),
      ]);
    }
  }, [openMarketType]);

  useEffect(() => {
    latestEditMarketIdRef.current = editMarket?.id ?? null;
    if (editMarket) {
      setTitle(editMarket.title || "");
      setSlug(editMarket.slug || "");
      setOpenMarketType(editMarket.openMarketType || "binary");
      setTeaser(editMarket.teaser || "");
      setSummary(editMarket.summary || "");
      setCategory(normalizeMarketCategory(editMarket.category) || "misc");
      setSecondaryCategories((editMarket.secondaryCategories as string[] | null) ?? []);
      setEndAt(dateToLocal(editMarket.endAt));
      setCloseAt(dateToLocal(editMarket.closeAt));
      setFeatured(editMarket.featured || false);
      setSourceUrl(editMarket.sourceUrl || "");
      setResolveMethod(editMarket.resolveMethod || "admin_manual");
      setResolutionCriteria(editMarket.resolutionCriteria?.length ? editMarket.resolutionCriteria : [""]);
      setScoutWatch(
        typeof editMarket.metadata?.scoutWatch === "string" ? editMarket.metadata.scoutWatch : "",
      );
      setUnderlying(editMarket.underlying || "");
      setMetric(editMarket.metric || "");
      setStrike(editMarket.strike ? String(editMarket.strike) : "");
      setUnit(editMarket.unit || "$");
      const vis = editMarket.visibility || (editMarket.isLive === false ? "draft" : "live");
      setVisibility(vis as any);
      setInactiveMessage(editMarket.inactiveMessage || "");
      setPersonId(editMarket.personId || "");
      setImageUrl(editMarket.coverImageUrl || "");
      setRelatedPeople(editMarket.relatedPeople || []);
      const geo = geoStateFromAllowlist(editMarket.visibleCountries);
      setGeoEnabled(geo.enabled);
      setGeoCountries(geo.codes);
      if (editMarket.personId) {
        setSelectedMarketCelebName("Loading...");
        setMarketCelebSearch("Loading...");
        fetch(`/api/trending`).then(r => r.ok ? r.json() : { data: [] }).then((resp) => {
          const list = Array.isArray(resp) ? resp : resp.data || [];
          const found = list.find((c: any) => c.id === editMarket.personId);
          if (found) {
            setSelectedMarketCelebName(found.name);
            setMarketCelebSearch(found.name);
          } else {
            setSelectedMarketCelebName(editMarket.personId.slice(0, 8) + "...");
            setMarketCelebSearch(editMarket.personId.slice(0, 8) + "...");
          }
        }).catch((err) => {
          console.error("[AdminDashboard] Failed to fetch celebrity for market:", err);
          toast.error("Could not load celebrity name", { description: "Using ID fallback." });
          setSelectedMarketCelebName(editMarket.personId.slice(0, 8) + "...");
          setMarketCelebSearch(editMarket.personId.slice(0, 8) + "...");
        });
      } else {
        setSelectedMarketCelebName("");
        setMarketCelebSearch("");
      }
      // Fetch entries from dedicated admin endpoint for accurate edit state
      if (editMarket.id && !editMarket.entries?.length) {
        const requestedMarketId = editMarket.id;
        fetchWithAuth(`/api/admin/open-markets/${requestedMarketId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (latestEditMarketIdRef.current !== requestedMarketId) return;
            if (data?.entries?.length) {
              setEntries(data.entries.map((e: any) =>
                createMarketEntry({
                  clientId: e.id,
                  label: e.label || "",
                  description: e.description || "",
                  imageUrl: e.imageUrl || "",
                  entryPersonId: e.personId || "",
                  entryPersonName: "",
                }),
              ));
            }
            if (data?.relatedPeople?.length) {
              setRelatedPeople(data.relatedPeople);
            }
            if (typeof data?.metadata?.scoutWatch === "string") {
              setScoutWatch(data.metadata.scoutWatch);
            }
          })
          .catch(() => {});
      } else if (editMarket.entries?.length) {
        setEntries(editMarket.entries.map((e: any) =>
          createMarketEntry({
            clientId: e.id,
            label: e.label || "",
            description: e.description || "",
            imageUrl: e.imageUrl || "",
            entryPersonId: e.personId || "",
            entryPersonName: "",
          }),
        ));
      }
    } else {
      setTitle("");
      setSlug("");
      setOpenMarketType("binary");
      setTeaser("");
      setSummary("");
      setCategory("misc");
      setSecondaryCategories([]);
      setEndAt("");
      setCloseAt("");
      setFeatured(false);
      setSourceUrl("");
      setResolveMethod("admin_manual");
      setResolutionCriteria([""]);
      setScoutWatch("");
      setUnderlying("");
      setMetric("");
      setStrike("");
      setUnit("$");
      setVisibility("live");
      setInactiveMessage("");
      setPersonId("");
      setImageUrl("");
      setSelectedMarketCelebName("");
      setMarketCelebSearch("");
      setMarketCelebResults([]);
      setRelatedPeople([]);
      setEntries([
        createMarketEntry({ label: "Yes" }),
        createMarketEntry({ label: "No" }),
      ]);
    }
  }, [editMarket, open]);

  const addEntry = () => {
    if (entries.length < OPINION_POLL_MAX_OPTIONS) {
      setEntries([...entries, createMarketEntry()]);
    }
  };

  const removeEntry = (clientId: string) => {
    if (entries.length > 3) {
      setEntries(entries.filter((entry) => entry.clientId !== clientId));
      if (expandedEntryImage === clientId) setExpandedEntryImage(null);
      setEntrySearches((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      setEntrySearchResults((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      setShowEntryDropdown((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
    }
  };

  const reorderEntries = async (orderedClientIds: string[]) => {
    setEntries((prev) => {
      const byId = new Map(prev.map((entry) => [entry.clientId, entry]));
      return orderedClientIds
        .map((id) => byId.get(id))
        .filter((entry): entry is MarketEntryForm => !!entry);
    });
  };

  const updateEntry = (clientId: string, field: keyof MarketEntryForm, value: string | number) => {
    if (field === "clientId") return;
    setEntries((prev) =>
      prev.map((entry) =>
        entry.clientId === clientId ? { ...entry, [field]: value } : entry,
      ),
    );
  };

  const searchMarketCelebrities = async (query: string) => {
    if (!query || query.length < 2) {
      setMarketCelebResults([]);
      setShowMarketCelebDropdown(false);
      return;
    }
    try {
      const res = await fetch(`/api/trending?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.data || [];
        setMarketCelebResults(list.slice(0, 8));
        setShowMarketCelebDropdown(true);
      }
    } catch {}
  };

  const marketCelebTimer = useRef<any>(null);
  const handleMarketCelebSearch = (value: string) => {
    setMarketCelebSearch(value);
    if (marketCelebTimer.current) clearTimeout(marketCelebTimer.current);
    marketCelebTimer.current = setTimeout(() => searchMarketCelebrities(value), 300);
  };

  const selectMarketCeleb = (celeb: any) => {
    setPersonId(celeb.id);
    setSelectedMarketCelebName(celeb.name);
    setMarketCelebSearch(celeb.name);
    setShowMarketCelebDropdown(false);
    setMarketCelebResults([]);
    if (!imageUrl) {
      setImageUrl(celeb.avatar || "");
    }
  };

  const clearMarketCeleb = () => {
    setPersonId("");
    setSelectedMarketCelebName("");
    setMarketCelebSearch("");
    setShowMarketCelebDropdown(false);
    setMarketCelebResults([]);
  };

  const entrySearchTimer = useRef<any>(null);
  const searchEntryCelebrities = async (clientId: string, query: string) => {
    setEntrySearches(prev => ({ ...prev, [clientId]: query }));
    if (!query || query.length < 2) {
      setEntrySearchResults(prev => ({ ...prev, [clientId]: [] }));
      setShowEntryDropdown(prev => ({ ...prev, [clientId]: false }));
      return;
    }
    if (entrySearchTimer.current) clearTimeout(entrySearchTimer.current);
    entrySearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/trending?search=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.data || [];
          setEntrySearchResults(prev => ({ ...prev, [clientId]: list.slice(0, 6) }));
          setShowEntryDropdown(prev => ({ ...prev, [clientId]: true }));
        }
      } catch {}
    }, 300);
  };

  const selectEntryCeleb = (clientId: string, celeb: any) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.clientId === clientId
          ? {
              ...entry,
              entryPersonId: celeb.id,
              entryPersonName: celeb.name,
              imageUrl: celeb.avatar || "",
            }
          : entry,
      ),
    );
    setEntrySearches(prev => ({ ...prev, [clientId]: celeb.name }));
    setEntrySearchResults(prev => ({ ...prev, [clientId]: [] }));
    setShowEntryDropdown(prev => ({ ...prev, [clientId]: false }));
  };

  const clearEntryCeleb = (clientId: string) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.clientId === clientId
          ? { ...entry, entryPersonId: "", entryPersonName: "" }
          : entry,
      ),
    );
    setEntrySearches(prev => ({ ...prev, [clientId]: "" }));
    setEntrySearchResults(prev => ({ ...prev, [clientId]: [] }));
    setShowEntryDropdown(prev => ({ ...prev, [clientId]: false }));
  };

  const canSubmit = () => {
    if (!title.trim() || !slug.trim() || !endAt) return false;
    if (openMarketType === "updown" && (!underlying.trim() || !strike.trim())) return false;
    if (openMarketType === "multi" && entries.some(e => !e.label.trim())) return false;
    if (!isGeoTargetingValid(geoEnabled, geoCountries)) return false;
    return true;
  };

  const handleSubmit = () => {
    onSubmit({
      title,
      slug,
      openMarketType,
      teaser: teaser || null,
      summary: summary || null,
      category,
      secondaryCategories,
      endAt: localDatetimeToIso(endAt),
      closeAt: closeAt ? localDatetimeToIso(closeAt) : undefined,
      featured,
      sourceUrl: sourceUrl || null,
      resolveMethod,
      resolutionCriteria: resolutionCriteria.filter(c => c.trim()),
      scoutWatch: scoutWatch.trim() || null,
      underlying: openMarketType === "updown" ? underlying : undefined,
      metric: openMarketType === "updown" ? metric : undefined,
      strike: openMarketType === "updown" ? strike : undefined,
      unit: openMarketType === "updown" ? unit : undefined,
      visibility,
      inactiveMessage: visibility === "inactive" ? (inactiveMessage || null) : null,
      personId: personId && personId.trim() ? personId : null,
      coverImageUrl: imageUrl || null,
      relatedPersonIds: relatedPeople.map(p => p.id),
      visibleCountries: visibleCountriesPayload(geoEnabled, geoCountries),
      entries: entries.map((e, i) => ({
        label: e.label,
        description: e.description || undefined,
        displayOrder: i,
        imageUrl: e.imageUrl || undefined,
        personId: e.entryPersonId || undefined,
      })),
    });
  };

  const titlePlaceholders: Record<string, string> = {
    binary: "Will the Save America Act require voter ID by Dec 2026?",
    multi: "Who will be the Republican nominee for the next presidential election?",
    updown: "Will Bitcoin be above or below $100,000 by 31 Jul 2026?",
  };
  const slugPlaceholders: Record<string, string> = {
    binary: "save-america-act-voter-id-2026",
    multi: "republican-nominee-next-presidential-election",
    updown: "bitcoin-above-below-100000-jul-2026",
  };
  const teaserPlaceholders: Record<string, string> = {
    binary: "A simple yes/no on a verifiable outcome.",
    multi: "Pick from multiple outcomes (3–20).",
    updown: "Predict above/below a strike level by the deadline.",
  };

  const renderOutcomeEntry = (
    entry: MarketEntryForm,
    idx: number,
    dragHandle: ReactNode | null = null,
  ) => (
    <div className="space-y-0">
      <div className="flex items-center gap-2 p-3 rounded-lg border">
        {openMarketType === "multi" && dragHandle}
        {openMarketType === "multi" && (
          <button
            type="button"
            onClick={() =>
              setExpandedEntryImage(expandedEntryImage === entry.clientId ? null : entry.clientId)
            }
            className="shrink-0 cursor-pointer"
            data-testid={`button-entry-image-${entry.clientId}`}
          >
            {entry.imageUrl ? (
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarImage src={entry.imageUrl} alt={entry.label} className="object-cover" />
                <AvatarFallback className="text-[10px]">{(entry.label || "?")[0]}</AvatarFallback>
              </Avatar>
            ) : (
              <div className="h-8 w-8 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center">
                <ImagePlus className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
            )}
          </button>
        )}
        <div className="flex-1 space-y-2">
          <Input
            value={entry.label}
            onChange={(e) => updateEntry(entry.clientId, "label", e.target.value)}
            placeholder={`Option ${idx + 1}`}
            disabled={openMarketType === "binary" || openMarketType === "updown"}
            data-testid={`input-entry-label-${entry.clientId}`}
          />
        </div>
        {openMarketType === "multi" && entries.length > 3 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeEntry(entry.clientId)}
            aria-label="Remove entry"
            data-testid={`button-remove-entry-${entry.clientId}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
      {openMarketType === "multi" && expandedEntryImage === entry.clientId && (
        <div className="ml-4 mr-4 p-3 border border-t-0 rounded-b-lg bg-muted/30 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Image for "{entry.label || `Option ${idx + 1}`}"
          </p>
          <div className="relative">
            <Input
              value={entrySearches[entry.clientId] || entry.entryPersonName || ""}
              onChange={(e) => searchEntryCelebrities(entry.clientId, e.target.value)}
              placeholder="Search celebrity on leaderboard..."
              className="text-xs"
              data-testid={`input-entry-celeb-search-${entry.clientId}`}
            />
            {entry.entryPersonId && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => clearEntryCeleb(entry.clientId)}
                aria-label="Clear celebrity"
                data-testid={`button-clear-entry-celeb-${entry.clientId}`}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
            {showEntryDropdown[entry.clientId] &&
              (entrySearchResults[entry.clientId] || []).length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {entrySearchResults[entry.clientId].map((celeb: any) => (
                    <button
                      key={celeb.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover-elevate flex items-center gap-2"
                      onClick={() => selectEntryCeleb(entry.clientId, celeb)}
                      data-testid={`entry-celeb-option-${entry.clientId}-${celeb.id}`}
                    >
                      {celeb.avatar && (
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={celeb.avatar} alt={celeb.name} />
                          <AvatarFallback className="text-[8px]">{celeb.name?.[0]}</AvatarFallback>
                        </Avatar>
                      )}
                      <span>{celeb.name}</span>
                    </button>
                  ))}
                </div>
              )}
          </div>
          <UploadImageInput
            value={entry.imageUrl}
            onChange={(url) => updateEntry(entry.clientId, "imageUrl", url)}
            moduleName="market-entries"
            slugOrId={`${slug || "new"}-entry-${entry.clientId}`}
            placeholder="Upload or paste entry image URL..."
          />
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      {/* Full-screen sheet on phones (sticky header/footer, scrollable body);
          centered 2xl dialog on md+. */}
      <DialogContent className="flex flex-col gap-0 p-0 max-w-2xl max-h-[90vh] max-md:left-0 max-md:top-0 max-md:translate-x-0 max-md:translate-y-0 max-md:h-[100dvh] max-md:max-h-none max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>{editMarket ? "Edit World Market" : "Create World Market"}</DialogTitle>
          <DialogDescription>{editMarket ? "Update an existing prediction market" : "Create a new prediction market for real-world events"}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4 px-6 flex-1 overflow-y-auto">
          <div className="space-y-2">
            <Label>Market Type</Label>
            <Select value={openMarketType} onValueChange={(v) => setOpenMarketType(v as any)}>
              <SelectTrigger data-testid="select-market-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="binary">Binary (Yes / No)</SelectItem>
                <SelectItem value="multi">Multi-Option (3-{OPINION_POLL_MAX_OPTIONS} choices)</SelectItem>
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
                placeholder={titlePlaceholders[openMarketType]}
                data-testid="input-market-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input 
                value={slug} 
                onChange={(e) => setSlug(e.target.value)} 
                placeholder={slugPlaceholders[openMarketType]}
                data-testid="input-market-slug"
              />
              <p className="text-xs text-muted-foreground">/markets/{slug}</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Teaser (short tagline for card)</Label>
              {editMarket && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={isGeneratingTeaser}
                  onClick={handleGenerateTeaser}
                  data-testid="button-generate-teaser"
                >
                  {isGeneratingTeaser ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles className="h-3 w-3" /> Draft with AI</>
                  )}
                </Button>
              )}
            </div>
            <Input 
              value={teaser} 
              onChange={(e) => setTeaser(e.target.value)} 
              placeholder={teaserPlaceholders[openMarketType]}
              data-testid="input-market-teaser"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Summary</Label>
              {editMarket && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={isGeneratingSummary}
                  onClick={handleGenerateSummary}
                  data-testid="button-generate-summary"
                >
                  {isGeneratingSummary ? (
                    <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
                  ) : (
                    <><Sparkles className="h-3 w-3" /> Draft with AI</>
                  )}
                </Button>
              )}
            </div>
            <Textarea 
              value={summary} 
              onChange={(e) => setSummary(e.target.value)} 
              placeholder="Additional context about this market..."
              rows={8}
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
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
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

          <AdminCategoryMultiSelect
            options={categoryOptions}
            value={secondaryCategories}
            onChange={setSecondaryCategories}
            primaryValue={category}
            testId="market-secondary-categories"
          />

          <GeoCountryTargeting
            enabled={geoEnabled}
            onEnabledChange={setGeoEnabled}
            selectedCodes={geoCountries}
            onSelectedCodesChange={setGeoCountries}
            testIdPrefix="market"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as any)} data-testid="select-market-visibility">
                <SelectTrigger data-testid="select-market-visibility-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft (Admin only)</SelectItem>
                  <SelectItem value="live">Live (Active)</SelectItem>
                  <SelectItem value="inactive">Inactive (Visible but dimmed)</SelectItem>
                  <SelectItem value="archived">Archived (Hidden)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibility === "inactive" && (
              <div className="space-y-2">
                <Label>Inactive Message</Label>
                <Input
                  value={inactiveMessage}
                  onChange={(e) => setInactiveMessage(e.target.value)}
                  placeholder="Coming Soon"
                  data-testid="input-inactive-message"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 relative">
              <Label>Linked Celebrity (optional)</Label>
              {personId && selectedMarketCelebName ? (
                <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/30">
                  <span className="text-sm flex-1 truncate">{selectedMarketCelebName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={clearMarketCeleb}
                    aria-label="Clear celebrity"
                    data-testid="button-clear-market-celebrity"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Input
                  value={marketCelebSearch}
                  onChange={(e) => handleMarketCelebSearch(e.target.value)}
                  onFocus={() => { if (marketCelebResults.length > 0) setShowMarketCelebDropdown(true); }}
                  onBlur={() => { setTimeout(() => setShowMarketCelebDropdown(false), 200); }}
                  placeholder="Search by name..."
                  autoComplete="off"
                  data-testid="input-market-celebrity-search"
                />
              )}
              {showMarketCelebDropdown && marketCelebResults.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {marketCelebResults.map((celeb: any) => (
                    <button
                      key={celeb.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2"
                      onMouseDown={(e) => { e.preventDefault(); selectMarketCeleb(celeb); }}
                      data-testid={`market-celeb-option-${celeb.id}`}
                    >
                      {celeb.avatar && <img src={celeb.avatar} alt={celeb.name} className="h-6 w-6 rounded object-cover" />}
                      <span>{celeb.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{celeb.category}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {personId ? `ID: ${personId.slice(0, 8)}...` : "Search and select a celebrity"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Image URL (optional)</Label>
              <UploadImageInput
                value={imageUrl}
                onChange={setImageUrl}
                moduleName="real-world-markets"
                slugOrId={slug || "new"}
                placeholder="Paste URL or upload (overrides celebrity avatar)"
              />
              <p className="text-xs text-muted-foreground">
                {personId && !imageUrl ? "Will use celebrity avatar" : imageUrl ? "Custom image set" : "No image"}
              </p>
            </div>
          </div>

          <RelatedCelebritiesField
            value={relatedPeople}
            onChange={setRelatedPeople}
            fetchFn={fetchWithAuth}
          />

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
            <div className="flex items-center justify-between">
              <Label>Source URL (optional)</Label>
              {(() => {
                // Scouted markets keep the origin URL in metadata.source.url
                // (provenance only). The public sourceUrl field ships empty by
                // default; this one-click fill is for admins who DO want the
                // source shown on the market page.
                const scoutUrl = editMarket?.metadata?.source?.url;
                if (typeof scoutUrl !== "string" || !scoutUrl || sourceUrl === scoutUrl) return null;
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-sky-600 dark:text-sky-400"
                    onClick={() => setSourceUrl(scoutUrl)}
                    data-testid="button-use-scout-source-url"
                  >
                    Use Polymarket link
                  </Button>
                );
              })()}
            </div>
            <Input 
              value={sourceUrl} 
              onChange={(e) => setSourceUrl(e.target.value)} 
              placeholder="https://..."
              data-testid="input-market-source-url"
            />
            <p className="text-xs text-muted-foreground">
              Shown to users as a source link on the market page. Leave empty to hide.
            </p>
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
                    aria-label="Remove criterion"
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

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>AI Scout — Watch Criteria</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSuggestWatch}
                disabled={isSuggestingWatch}
                className="gap-1"
                data-testid="button-suggest-watch"
              >
                {isSuggestingWatch ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Suggesting...</>
                ) : (
                  <><Sparkles className="h-3 w-3" /> Suggest with AI</>
                )}
              </Button>
            </div>
            <Textarea
              value={scoutWatch}
              onChange={(e) => setScoutWatch(e.target.value)}
              placeholder="Leading indicators the daily AI scout should watch for, e.g. Portugal squad announcement; Ronaldo named in starting XI; official withdrawal."
              rows={3}
              data-testid="input-scout-watch"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Guides the once-daily resolution scout on what real-world signals would move this market toward resolution. Leave blank to let the scout infer from the title and criteria.
            </p>
          </div>

          {openMarketType === "updown" && (
            <div className="space-y-4 p-4 rounded-lg border border-violet-500/20 bg-violet-500/8 dark:bg-violet-500/5">
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
                  disabled={entries.length >= OPINION_POLL_MAX_OPTIONS}
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
               `Multi-option: ${entries.length} of 3-${OPINION_POLL_MAX_OPTIONS} outcomes. Drag the grip to reorder.`}
            </p>
            {openMarketType === "multi" ? (
              <AdminSortableCardList
                items={entries.map((entry) => ({ ...entry, id: entry.clientId }))}
                onReorder={reorderEntries}
                listClassName="space-y-3"
                renderItem={(entry, { dragHandle }) => {
                  const idx = entries.findIndex((e) => e.clientId === entry.clientId);
                  return renderOutcomeEntry(entry, idx, dragHandle);
                }}
              />
            ) : (
              entries.map((entry, idx) => (
                <div key={entry.clientId}>{renderOutcomeEntry(entry, idx)}</div>
              ))
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4 gap-2 max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <Button variant="outline" onClick={onClose} className="h-11 md:h-9">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit() || isPending}
            className="h-11 md:h-9"
            data-testid="button-submit-market"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : editMarket ? <CheckCircle className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {editMarket ? "Update Market" : "Create Market"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
