import { useRoute, Link, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { getCreditPackage, formatUSD } from "@/lib/pricing";
import { voxWord } from "@/lib/currency";

/**
 * Temporary placeholder for the credit-purchase flow.
 *
 * The real integration with our Merchant of Record (Paddle) lands in a
 * separate PR once their domain review approves voxdex.com. Until then we
 * still need a destination for the "Buy now" CTAs on /pricing so users
 * don't hit a dead link — this page acknowledges the click, names the
 * package they picked (so the choice doesn't feel lost), and routes them
 * back. Replace with the real Paddle Checkout when wiring up payments.
 */
export default function CheckoutPage() {
  const [, params] = useRoute<{ packageId: string }>("/checkout/:packageId");
  const [, setLocation] = useLocation();
  const pkg = params ? getCreditPackage(params.packageId) : undefined;

  // Prefer history.back() so a user who clicked through from /pricing
  // (the normal entry point) returns to their scroll position there.
  // Direct visits / shared links fall back to /pricing as the most
  // contextually relevant landing.
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/pricing");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            data-testid="button-checkout-back"
            aria-label="Back to pricing"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <VoxDexLogo size={24} />
            <h1 className="font-semibold">Checkout</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4 py-12">
        <Card className="w-full p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/15 dark:bg-violet-500/10">
            <Clock className="h-7 w-7 text-violet-600 dark:text-violet-400" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold">Checkout coming soon</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            We're finalizing our payment integration. Credit purchases will
            be available shortly — check back soon.
          </p>

          {pkg && (
            <div className="mb-6 rounded-lg border bg-muted/30 p-4 text-left">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                You picked
              </p>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">
                  {pkg.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {voxWord(pkg.credits)}
                  </span>
                </span>
                <span className="font-mono font-semibold">
                  {formatUSD(pkg.priceUSD)}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/pricing" className="flex-1">
              <Button
                variant="outline"
                className="w-full"
                data-testid="button-checkout-back-to-pricing"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to pricing
              </Button>
            </Link>
            <Link href="/" className="flex-1">
              <Button
                className="w-full"
                data-testid="button-checkout-keep-playing"
              >
                Keep playing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
