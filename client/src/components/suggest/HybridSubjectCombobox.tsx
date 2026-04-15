import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { usePeopleSearch } from "@/hooks/usePeopleSearch";
import { Search, Plus, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export type SubjectSelection = {
  type: "celebrity" | "custom";
  value: string;
};

export function HybridSubjectCombobox({
  value,
  onChange,
  onSelect,
  placeholder = "Search celebrity or create custom topic...",
  showCustomTopicOption = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: SubjectSelection) => void;
  placeholder?: string;
  showCustomTopicOption?: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const { data: searchResponse } = usePeopleSearch(value, 6);
  const filteredPeople = searchResponse?.data ?? [];

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

  const handleSelectCelebrity = (name: string) => {
    onSelect({ type: "celebrity", value: name });
    setShowSuggestions(false);
  };

  const handleSelectCustomTopic = (topic: string) => {
    onSelect({ type: "custom", value: topic });
    setShowSuggestions(false);
  };

  const hasMatchingCelebrities = filteredPeople.length > 0;
  const showFallbackCustom = value.length >= 2 && !hasMatchingCelebrities;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="pl-10"
          data-testid="input-subject-search"
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
            {showCustomTopicOption && (
              <button
                onClick={() => handleSelectCustomTopic(value || "Custom Topic")}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-cyan-500/15 dark:hover:bg-cyan-500/10 transition-colors flex items-center gap-2 border-b border-border bg-gradient-to-r from-cyan-500/5 to-transparent"
                data-testid="option-create-custom-topic"
              >
                <div className="h-7 w-7 rounded-md bg-cyan-500/25 dark:bg-cyan-500/20 border border-cyan-500/40 dark:border-cyan-500/30 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">Create Custom Topic</span>
                  <span className="text-xs text-muted-foreground">Not about a specific celebrity</span>
                </div>
              </button>
            )}

            {hasMatchingCelebrities ? (
              <>
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-b border-border">
                  Celebrities
                </div>
                {filteredPeople.map((person, index) => (
                  <button
                    key={person.id}
                    onClick={() => handleSelectCelebrity(person.name)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    data-testid={`suggestion-celebrity-${index}`}
                  >
                    {person.avatar ? (
                      <div className="h-7 w-7 rounded-md overflow-hidden shrink-0 border border-border">
                        <img src={person.avatar} alt={person.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <PersonAvatar name={person.name} avatar="" size="sm" />
                    )}
                    <span>{person.name}</span>
                  </button>
                ))}
              </>
            ) : showFallbackCustom ? (
              <button
                onClick={() => handleSelectCustomTopic(value)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                data-testid="option-use-as-custom"
              >
                <div className="h-7 w-7 rounded-md bg-violet-500/25 dark:bg-violet-500/20 border border-violet-500/40 dark:border-violet-500/30 flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex flex-col">
                  <span>
                    Use "
                    <span className="font-medium text-violet-600 dark:text-violet-400">{value}</span>
                    " as Custom Topic
                  </span>
                  <span className="text-xs text-muted-foreground">No matching celebrities found</span>
                </div>
              </button>
            ) : value.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                Type to search celebrities or create a custom topic
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
