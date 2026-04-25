import { toast } from "sonner";

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
    toast.success("Link copied!", { duration: 2500 });
  } catch {
    toast.error("Could not copy link");
  }
}
