import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export function UpdateIndicator() {
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Badge 
      variant="secondary" 
      className="gap-2 h-8"
      data-testid="badge-update-indicator"
    >
      <RefreshCw className="h-3 w-3" />
      <span className="text-xs">
        Updated {secondsAgo}s ago
      </span>
    </Badge>
  );
}
