import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Placeholder Privacy Policy page.
 *
 * TODO: Replace with finalized legal copy before public launch. The /privacy
 * route is referenced from /login/welcome's acceptance checkbox, so this
 * file must keep returning a valid page even before the real content is in.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-privacy-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-semibold">Privacy Policy</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="p-6 space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p className="text-foreground font-medium">
            VoxDex Privacy Policy — placeholder.
          </p>
          <p>
            We collect the minimum personal information needed to run VoxDex
            (your email, profile data you supply, and votes/predictions you
            submit). We don't sell your data. Final, fully-vetted privacy copy
            will replace this placeholder before public launch.
          </p>
          <p>
            For privacy-related questions, please reach out to the email
            address that will be listed here on launch.
          </p>
        </Card>
      </main>
    </div>
  );
}
