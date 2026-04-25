import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Placeholder Terms of Service page.
 *
 * TODO: Replace with finalized legal copy before public launch. The /terms
 * route is referenced from /login/welcome's acceptance checkbox, so this
 * file must keep returning a valid page even before the real content is in.
 */
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-terms-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-semibold">Terms of Service</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="p-6 space-y-4 text-sm text-muted-foreground leading-relaxed">
          <p className="text-foreground font-medium">
            VoxDex Terms of Service — placeholder.
          </p>
          <p>
            By using VoxDex you agree to participate respectfully, vote
            honestly, and not abuse our platform. Final, fully-vetted legal
            copy will replace this placeholder before public launch.
          </p>
          <p>
            Questions in the meantime? Get in touch via the address listed in
            our Privacy Policy.
          </p>
        </Card>
      </main>
    </div>
  );
}
