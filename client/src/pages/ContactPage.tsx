import { useLocation } from "wouter";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VoxDexLogo } from "@/components/VoxDexLogo";

const SUPPORT_EMAIL = "hello@voxdex.com";

/**
 * Placeholder contact surface linked from the footer.
 *
 * TODO: replace with a structured contact form (categories:
 *   Billing / Support / Technical / Suggestion / General). Form
 *   submissions should hit a server endpoint that emails the
 *   triage queue and stores the request for follow-up — keeps the
 *   support inbox out of the public DOM (the current page still
 *   exposes hello@voxdex.com to scrapers, so spam protection is
 *   only meaningful once the form lands).
 *
 * The route stays at /contact across both versions, so the footer
 * link and any other internal references don't need to change
 * when we swap the contents.
 */
export default function ContactPage() {
  const [, setLocation] = useLocation();

  // Same history-aware back pattern as the other top-level pages
  // (LegalDocumentPage, CheckoutPage). Falls back to home for direct
  // visits / shared links.
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            data-testid="button-contact-back"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <VoxDexLogo size={24} />
            <h1 className="font-semibold">Contact</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-12">
        <Card className="w-full p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/15 dark:bg-violet-500/10">
            <Mail className="h-7 w-7 text-violet-600 dark:text-violet-400" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold">Get in touch</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Email us for support, billing questions, suggestions, or
            anything else. We aim to respond within 2 business days.
          </p>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex w-full items-center justify-center rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            data-testid="link-contact-email"
          >
            <Mail className="mr-2 h-4 w-4" />
            {SUPPORT_EMAIL}
          </a>

          <p className="mt-6 text-xs text-muted-foreground">
            A structured contact form is coming soon — for now, email
            works just as well.
          </p>
        </Card>
      </main>
    </div>
  );
}
