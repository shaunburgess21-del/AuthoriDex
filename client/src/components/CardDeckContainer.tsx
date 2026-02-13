import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ViewType = "vote" | "predict";

interface CardDeckContainerProps<T> {
  items: T[];
  renderCard: (item: T, onInteract: () => void) => React.ReactNode;
  onSkip?: (item: T) => void;
  emptyMessage?: string;
  showBottomButton?: boolean;
  viewType?: ViewType;
  hasInteracted?: boolean;
  onAdvance?: () => void;
}

export function CardDeckContainer<T>({
  items,
  renderCard,
  onSkip,
  emptyMessage = "No items available",
  showBottomButton = true,
  viewType = "vote",
  hasInteracted = false,
  onAdvance
}: CardDeckContainerProps<T>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<"left" | "right">("left");

  // Reset index if it goes out of bounds when items change
  useEffect(() => {
    if (items.length > 0 && currentIndex >= items.length) {
      setCurrentIndex(0);
    }
  }, [items.length, currentIndex]);

  const advanceToNext = useCallback(() => {
    setDirection("left");
    setCurrentIndex((prev) => {
      if (items.length <= 1) return 0;
      return (prev + 1) % items.length;
    });
    onAdvance?.();
  }, [items.length, onAdvance]);

  const handleSkip = useCallback(() => {
    if (items[currentIndex]) {
      onSkip?.(items[currentIndex]);
    }
    setDirection("right");
    setCurrentIndex((prev) => {
      if (items.length <= 1) return 0;
      return (prev + 1) % items.length;
    });
    onAdvance?.();
  }, [currentIndex, items, onSkip, onAdvance]);

  const handleBottomButtonClick = useCallback(() => {
    if (hasInteracted) {
      advanceToNext();
    } else {
      handleSkip();
    }
  }, [hasInteracted, advanceToNext, handleSkip]);

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  const currentItem = items[currentIndex % items.length];
  
  const buttonLabel = hasInteracted 
    ? viewType === "vote" ? "Vote Next" : "Predict Next"
    : "Skip";

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
          {renderCard(currentItem, advanceToNext)}
        </motion.div>
      </AnimatePresence>
      
      {showBottomButton && (
        <div className="flex justify-center mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBottomButtonClick}
            className={`text-xs transition-all ${
              hasInteracted 
                ? "text-cyan-400 hover:text-cyan-300 font-medium" 
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={hasInteracted ? "button-next-card" : "button-skip-card"}
          >
            {buttonLabel}
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}
      
      <p className="text-center text-xs font-mono text-muted-foreground mt-2" data-testid="text-carousel-counter">
        {currentIndex + 1} &ndash; {items.length}
      </p>
    </div>
  );
}
