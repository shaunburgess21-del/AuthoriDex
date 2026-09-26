import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  getPublishedLink,
  ONLINE_LINK,
  subscribePublishedLink,
  type PublishedLink,
} from "@/lib/networkStatus";

function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

/**
 * Android Capacitor reads the published plugin state. Website, PWA, and
 * iOS always see "online" here so they do not grow a native banner.
 * Paused queries on the website still use TanStack's own navigator listener.
 */
export function useNetworkStatus(): PublishedLink {
  const android = isAndroidNative();
  const [link, setLink] = useState<PublishedLink>(() => (android ? getPublishedLink() : ONLINE_LINK));

  useEffect(() => {
    if (!android) return;
    setLink(getPublishedLink());
    return subscribePublishedLink(setLink);
  }, [android]);

  return link;
}

export function useAndroidNetworkUi(): boolean {
  const [android] = useState(isAndroidNative);
  return android;
}
