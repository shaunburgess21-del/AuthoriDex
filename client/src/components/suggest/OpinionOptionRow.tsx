import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useToast } from "@/hooks/use-toast";
import { usePeopleSearch, type SearchablePerson } from "@/hooks/usePeopleSearch";
import { Search, X, ImageIcon, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type OpinionOptionInput = {
  name: string;
  personId?: string;
  imageUrl?: string;
  uploadedFile?: File;
  uploadedPreview?: string;
};

export function OpinionOptionRow({
  value,
  onChange,
  onRemove,
  testIdPrefix,
  index,
}: {
  value: OpinionOptionInput;
  onChange: (next: OpinionOptionInput) => void;
  onRemove?: () => void;
  testIdPrefix: string;
  index: number;
}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: searchResponse } = usePeopleSearch(searchQuery, 5);
  const filteredCelebrities = searchQuery ? (searchResponse?.data ?? []) : [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCelebrity = (celebrity: SearchablePerson) => {
    onChange({
      name: celebrity.name,
      personId: celebrity.id,
      imageUrl: celebrity.avatar || undefined,
      uploadedFile: undefined,
      uploadedPreview: undefined,
    });
    setSearchQuery("");
    setShowDropdown(false);
  };

  const handleClearSelection = () => {
    onChange({ name: "" });
    setSearchQuery("");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 2 MB.", variant: "destructive" });
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only PNG, JPG, and WEBP files are allowed.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      onChange({
        ...value,
        uploadedFile: file,
        uploadedPreview: event.target?.result as string,
      });
    };
    reader.readAsDataURL(file);
  };

  const isCelebrity = !!value.personId;
  const displayImage = value.imageUrl || value.uploadedPreview;

  // Selected state — celebrity or custom with image attached
  if (value.name && (isCelebrity || value.uploadedFile || value.uploadedPreview)) {
    return (
      <div className="flex items-center gap-2" data-testid={`${testIdPrefix}-option-row-${index}`}>
        <div className="w-6 h-6 rounded-full bg-cyan-500/25 dark:bg-cyan-500/20 flex items-center justify-center shrink-0">
          <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">{index + 1}</span>
        </div>
        <div className="flex items-center gap-2 flex-1 p-2 rounded-lg border bg-muted/30 min-w-0">
          {displayImage ? (
            <div className="h-8 w-8 rounded-md overflow-hidden shrink-0 border border-border">
              <img src={displayImage} alt={value.name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="h-8 w-8 rounded-md bg-slate-700/50 flex items-center justify-center shrink-0 border border-border">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{value.name}</p>
            {isCelebrity ? (
              <span className="text-xs text-cyan-600 dark:text-cyan-400">Celebrity</span>
            ) : (
              <span className="text-xs text-violet-600 dark:text-violet-400">Custom</span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClearSelection}
            className="shrink-0 h-7 w-7"
            data-testid={`${testIdPrefix}-option-clear-${index}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {onRemove && (
          <Button variant="ghost" size="icon" onClick={onRemove} data-testid={`button-remove-opinion-option-${index}`}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </div>
    );
  }

  // Search/input state
  return (
    <div data-testid={`${testIdPrefix}-option-row-${index}`}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-cyan-500/25 dark:bg-cyan-500/20 flex items-center justify-center shrink-0">
          <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">{index + 1}</span>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value.name || searchQuery}
            onChange={(e) => {
              const v = e.target.value;
              setSearchQuery(v);
              onChange({ name: v, personId: undefined, imageUrl: undefined, uploadedFile: undefined, uploadedPreview: undefined });
              if (v.length > 0) setShowDropdown(true);
            }}
            onFocus={() => {
              if (searchQuery.length > 0 || (value.name && !value.personId)) setShowDropdown(true);
            }}
            placeholder={`Option ${index + 1} — search celebrity or type custom`}
            className="pl-9 flex-1"
            data-testid={`input-opinion-option-${index}`}
          />
          <AnimatePresence>
            {showDropdown && filteredCelebrities.length > 0 && (
              <motion.div
                ref={dropdownRef}
                className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
              >
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                  Celebrities
                </div>
                {filteredCelebrities.map((celebrity) => (
                  <button
                    key={celebrity.id}
                    onClick={() => handleSelectCelebrity(celebrity)}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    data-testid={`${testIdPrefix}-option-${index}-celebrity-${celebrity.id}`}
                  >
                    {celebrity.avatar ? (
                      <div className="h-7 w-7 rounded-md overflow-hidden shrink-0 border border-border">
                        <img src={celebrity.avatar} alt={celebrity.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <PersonAvatar name={celebrity.name} avatar="" size="sm" />
                    )}
                    <span className="truncate">{celebrity.name}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] bg-cyan-500/15 dark:bg-cyan-500/10 text-cyan-500 dark:text-cyan-300 border-cyan-500/40 dark:border-cyan-400/30"
                    >
                      Auto
                    </Badge>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* Custom image upload button — show when typing custom (no personId) and no image yet */}
        {value.name && !value.personId && !value.uploadedPreview && (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 h-9 w-9 border-amber-500/60 dark:border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 dark:hover:bg-amber-500/10"
              data-testid={`${testIdPrefix}-option-upload-${index}`}
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
          </>
        )}
        {/* Show small preview when custom image uploaded */}
        {value.uploadedPreview && !value.personId && (
          <div className="relative shrink-0">
            <div className="h-9 w-9 rounded-md overflow-hidden border border-border">
              <img src={value.uploadedPreview} alt="preview" className="w-full h-full object-cover" />
            </div>
            <button
              onClick={() => onChange({ ...value, uploadedFile: undefined, uploadedPreview: undefined })}
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 flex items-center justify-center"
              data-testid={`${testIdPrefix}-option-remove-image-${index}`}
            >
              <X className="h-2.5 w-2.5 text-white" />
            </button>
          </div>
        )}
        {onRemove && (
          <Button variant="ghost" size="icon" onClick={onRemove} data-testid={`button-remove-opinion-option-${index}`}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}
