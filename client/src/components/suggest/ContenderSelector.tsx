import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { usePeopleSearch, type SearchablePerson } from "@/hooks/usePeopleSearch";
import { Search, X, Plus, Check, User, Upload } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Contender Selection for Matchup modal - supports celebrities with auto-images and custom entries with uploads
export type ContenderSelection = {
  type: "celebrity" | "custom" | null;
  name: string;
  celebrityId?: string;
  imageUrl?: string;
  uploadedFile?: File;
  uploadedPreview?: string;
};

export function ContenderSelector({
  value,
  onChange,
  label,
  placeholder = "Search celebrity or enter custom...",
  testIdPrefix,
}: {
  value: ContenderSelection;
  onChange: (selection: ContenderSelection) => void;
  label: string;
  placeholder?: string;
  testIdPrefix: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Server-side celebrity search (trigram-backed, Phase 1g).
  // Empty query returns no suggestions — users must type ≥2 chars. The prior
  // "top 6 when empty" behaviour relied on a client-side leaderboard fetch
  // and is intentionally dropped as part of the suggest-to-live redesign.
  const { data: searchResponse } = usePeopleSearch(searchQuery, 6);
  const filteredCelebrities = searchResponse?.data ?? [];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCelebrity = (celebrity: SearchablePerson) => {
    onChange({
      type: "celebrity",
      name: celebrity.name,
      celebrityId: celebrity.id,
      imageUrl: celebrity.avatar || undefined,
      uploadedFile: undefined,
      uploadedPreview: undefined,
    });
    setSearchQuery("");
    setShowSuggestions(false);
  };

  const handleSelectCustom = () => {
    if (searchQuery.length >= 2) {
      onChange({
        type: "custom",
        name: searchQuery,
        celebrityId: undefined,
        imageUrl: undefined,
        uploadedFile: undefined,
        uploadedPreview: undefined,
      });
      setShowSuggestions(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        onChange({
          ...value,
          uploadedFile: file,
          uploadedPreview: event.target?.result as string,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClear = () => {
    onChange({
      type: null,
      name: "",
      celebrityId: undefined,
      imageUrl: undefined,
      uploadedFile: undefined,
      uploadedPreview: undefined,
    });
    setSearchQuery("");
  };

  const hasMatchingCelebrities = filteredCelebrities.length > 0;
  const showCustomOption =
    searchQuery.length >= 2 &&
    !filteredCelebrities.some((c) => c.name.toLowerCase() === searchQuery.toLowerCase());

  // If a selection is made, show the selected state
  if (value.type) {
    const displayImage = value.type === "celebrity" ? value.imageUrl : value.uploadedPreview;
    const needsUpload = value.type === "custom" && !value.uploadedPreview;

    return (
      <div className="space-y-2">
        <label className="text-sm font-medium mb-1 block">{label}</label>
        <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
          {displayImage ? (
            <div className="h-10 w-10 rounded-md overflow-hidden shrink-0 border border-border">
              <img src={displayImage} alt={value.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-md bg-slate-700/50 flex items-center justify-center shrink-0 border border-border">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              {value.type === "celebrity" ? (
                <span className="text-cyan-600 dark:text-cyan-400">VoxDex Celebrity</span>
              ) : (
                <span className="text-violet-600 dark:text-violet-400">Custom Contender</span>
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="shrink-0 h-8 w-8"
            data-testid={`${testIdPrefix}-clear`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Upload button for custom contenders */}
        {needsUpload && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-amber-500/60 dark:border-amber-500/50 bg-amber-500/5">
            <Upload className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-600 dark:text-amber-400">Image required for custom contenders</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto border-amber-500/60 dark:border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 dark:hover:bg-amber-500/10"
              data-testid={`${testIdPrefix}-upload-btn`}
            >
              Upload Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileUpload}
              className="hidden"
              data-testid={`${testIdPrefix}-file-input`}
            />
          </div>
        )}
      </div>
    );
  }

  // Show search input
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium mb-1 block">{label}</label>
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            className="pl-10"
            data-testid={`${testIdPrefix}-search`}
          />
        </div>

        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              ref={suggestionsRef}
              className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {/* Custom contender option */}
              {showCustomOption && (
                <button
                  onClick={handleSelectCustom}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-violet-500/15 dark:hover:bg-violet-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-violet-500/5 to-transparent"
                  data-testid={`${testIdPrefix}-custom-option`}
                >
                  <div className="h-8 w-8 rounded-md bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/40 dark:border-violet-500/30 flex items-center justify-center">
                    <Plus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex flex-col">
                    <span>
                      Use "
                      <span className="font-medium text-violet-600 dark:text-violet-400">{searchQuery}</span>
                      " as Custom Contender
                    </span>
                    <span className="text-xs text-muted-foreground">Image upload required</span>
                  </div>
                </button>
              )}

              {/* Celebrity suggestions */}
              {hasMatchingCelebrities ? (
                <>
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                    VoxDex Celebrities
                  </div>
                  {filteredCelebrities.map((celebrity, index) => (
                    <button
                      key={celebrity.id}
                      onClick={() => handleSelectCelebrity(celebrity)}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-3"
                      data-testid={`${testIdPrefix}-celebrity-${index}`}
                    >
                      {celebrity.avatar ? (
                        <div className="h-8 w-8 rounded-md overflow-hidden shrink-0 border border-border">
                          <img src={celebrity.avatar} alt={celebrity.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <PersonAvatar name={celebrity.name} avatar="" size="sm" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{celebrity.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {celebrity.category} • Auto-image
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs bg-cyan-500/15 dark:bg-cyan-500/10 text-cyan-500 dark:text-cyan-300 border-cyan-500/40 dark:border-cyan-400/30"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    </button>
                  ))}
                </>
              ) : searchQuery.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  Type to search VoxDex celebrities or enter a custom name
                </div>
              ) : searchQuery.length < 2 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                  Keep typing to search...
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
