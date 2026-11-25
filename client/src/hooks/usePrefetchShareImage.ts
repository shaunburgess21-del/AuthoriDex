import { useEffect } from "react";
import { prefetchShareImage } from "@/lib/share";

/** Warm the result-card blob so the share click does not wait on the network. */
export function usePrefetchShareImage(imagePath: string | null | undefined): void {
  useEffect(() => {
    if (imagePath) void prefetchShareImage(imagePath);
  }, [imagePath]);
}
