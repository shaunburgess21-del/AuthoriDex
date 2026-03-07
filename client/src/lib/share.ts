import { toast } from "@/hooks/use-toast";

export async function sharePage(title: string) {
  const url = window.location.href;

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    const { dismiss } = toast({ title: "Link copied!" });
    setTimeout(() => dismiss(), 2500);
  } catch {
    toast({ title: "Could not copy link", variant: "destructive" });
  }
}
