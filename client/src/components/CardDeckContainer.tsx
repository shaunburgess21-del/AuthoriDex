import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CardDeckContainerProps<T> {
  items: T[];
  renderCard: (item: T, onComplete: () => void) => React.ReactNode;
  onSkip?: (item: T) => void;
  emptyMessage?: string;
  showSkip?: boolean;
  skipLabel?: string;
}

export function CardDeckContainer<T>({
  items,
  renderCard,
  onSkip,
  emptyMessage = "No items available",
  showSkip = true,
  skipLabel = "Skip"
}: CardDeckContainerProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("left");

  // Reset index if it goes out of bounds when items change
  useEffect(() => {
    if (items.length > 0 && currentIndex >= items.length) {
      setCurrentIndex(0);
    }
  }, [items.length, currentIndex]);

  const handleComplete = useCallback(() => {
    setDirection("left");
    setCurrentIndex((prev) => {
      if (items.length <= 1) return 0;
      return (prev + 1) % items.length;
    });
  }, [items.length]);

  const handleSkip = useCallback(() => {
    if (items[currentIndex]) {
      onSkip?.(items[currentIndex]);
    }
    setDirection("right");
    setCurrentIndex((prev) => {
      if (items.length <= 1) return 0;
      return (prev + 1) % items.length;
    });
  }, [currentIndex, items, onSkip]);

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  const currentItem = items[currentIndex % items.length];

  return (
    <div className="relative">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: direction === "left" ? 100 : -100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction === "left" ? -100 : 100 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {renderCard(currentItem, handleComplete)}
        </motion.div>
      </AnimatePresence>
      
      {showSkip && (
        <div className="flex justify-center mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-muted-foreground hover:text-foreground text-xs"
            data-testid="button-skip-card"
          >
            {skipLabel}
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}
      
      <div className="flex justify-center mt-2 gap-1">
        {items.slice(0, Math.min(items.length, 5)).map((_, idx) => (
          <div
            key={idx}
            className={`h-1 w-6 rounded-full transition-colors ${
              idx === currentIndex % Math.min(items.length, 5)
                ? "bg-cyan-400"
                : "bg-muted"
            }`}
          />
        ))}
        {items.length > 5 && (
          <span className="text-xs text-muted-foreground ml-1">+{items.length - 5}</span>
        )}
      </div>
    </div>
  );
}
