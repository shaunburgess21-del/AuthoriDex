import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

export default function NotFound() {
  useDocumentMeta({
    title: "Page not found | VoxDex",
    description: "We could not find that page. It may have moved or the link may be outdated.",
  });

  return (
    <div className="pb-20 md:pb-0">
      <SiteHeader />
      <main className="flex w-full items-center justify-center px-4 py-16 md:py-24">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              We could not find that page. It may have moved or the link may be outdated.
            </p>
            <Link href="/" className="mt-5 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go back home
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
