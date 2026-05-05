import { Link, useLocation } from "wouter";
import { ArrowLeft, Gift, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import {
  CREDIT_PACKAGES,
  FIRST_TIME_BONUS_PCT,
  formatPerCreditCents,
  formatUSD,
  type CreditPackage,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

/**
 * Public pricing page. Lives at /pricing, visible to logged-out users
 * (the brief explicitly wants this so prospects can decide before signup).
 *
 * Mobile note: every page in the app is min-h-screen + pb-20 to clear the
 * fixed mobile BottomNav. We keep that pattern here so the footer disclaimer
 * doesn't get hidden behind the nav on small screens.
 */
export default function PricingPage() {
  const [, setLocation] = useLocation();

  // Same history-aware back pattern used elsewhere in the app
  // (LegalDocumentPage, CheckoutPage, ContactPage). Falls back to
  // home for direct visits / shared links — Pricing is a public
  // page so logged-out viewers may land here from external sources.
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label="Go back"
              data-testid="button-pricing-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Link
              href="/"
              className="flex items-center gap-2 transition-opacity hover:opacity-80"
              data-testid="link-pricing-home"
            >
              <VoxDexLogo size={32} />
              <span className="font-serif text-xl font-bold">VoxDex</span>
            </Link>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 md:py-14">
        <PricingHeader />
        <FirstTimeBonusCallout />
        <PricingGrid />
        <ComparisonTable />
        <PricingFaq />
        <PricingDisclaimer />
      </main>
    </div>
  );
}

function PricingHeader() {
  return (
    <section className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
      <h1
        className="mb-3 font-serif text-4xl font-bold tracking-tight md:text-5xl"
        data-testid="text-pricing-title"
      >
        Buy Credits
      </h1>
      <p className="text-base text-muted-foreground md:text-lg">
        Top up to keep predicting. Credits never expire.
      </p>
    </section>
  );
}

function FirstTimeBonusCallout() {
  return (
    <section
      className="mx-auto mb-10 flex max-w-2xl items-start gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 dark:border-amber-500/30 dark:bg-amber-500/8"
      data-testid="callout-first-time-bonus"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 dark:bg-amber-500/15">
        <Gift className="h-5 w-5 text-amber-600 dark:text-amber-400" />
      </div>
      <div>
        <p className="mb-1 font-semibold text-amber-700 dark:text-amber-300">
          First-time bonus
        </p>
        <p className="text-sm text-muted-foreground">
          Get an extra <strong className="text-foreground">{FIRST_TIME_BONUS_PCT}%</strong>{" "}
          on your first credit purchase — automatically applied at checkout.
        </p>
      </div>
    </section>
  );
}

function PricingGrid() {
  return (
    <section className="mb-14 md:mb-20">
      <div className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CREDIT_PACKAGES.map((pkg) => (
          <PricingCard key={pkg.id} pkg={pkg} />
        ))}
      </div>
    </section>
  );
}

function PricingCard({ pkg }: { pkg: CreditPackage }) {
  const [, setLocation] = useLocation();
  const isMostPopular = pkg.badge === "Most popular";
  const isBestValue = pkg.badge === "Best value";

  const ariaLabel = `Buy ${pkg.credits.toLocaleString("en-US")} credits for ${formatUSD(pkg.priceUSD)}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lg",
        isMostPopular &&
          "border-violet-500/60 shadow-violet-500/20 ring-1 ring-violet-500/40 dark:border-violet-500/50 lg:scale-[1.03]",
        isBestValue &&
          "border-amber-500/60 shadow-amber-500/15 ring-1 ring-amber-500/40 dark:border-amber-500/50",
        !isMostPopular && !isBestValue && "border-border hover:border-border/80",
      )}
      data-testid={`card-pricing-${pkg.id}`}
    >
      {pkg.badge && (
        <div
          className={cn(
            "absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold shadow-sm",
            isMostPopular &&
              "bg-violet-600 text-white dark:bg-violet-500",
            isBestValue &&
              "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
          )}
          data-testid={`badge-${pkg.id}`}
        >
          {isMostPopular && <Sparkles className="mr-1 inline h-3 w-3" />}
          {pkg.badge}
        </div>
      )}

      <div className="mb-4">
        {/* h2 (not h3) so we don't skip a heading level after the page
            h1 — the section above the grid intentionally has no
            heading. Visual size stays small via tailwind classes.
            Tier description (pkg.description) is intentionally
            hidden for now per product call — re-render the <p>
            below if/when copy returns. */}
        <h2 className="text-lg font-semibold">{pkg.name}</h2>
      </div>

      <div className="mb-5">
        <p className="mb-1 text-2xl font-bold tabular-nums">
          {pkg.credits.toLocaleString("en-US")}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            credits
          </span>
        </p>
        <div className="flex items-baseline gap-2">
          <p className="text-4xl font-bold tabular-nums">
            {formatUSD(pkg.priceUSD)}
          </p>
          {pkg.savingsPct !== null && (
            <Badge
              variant="outline"
              className="border-green-500/40 bg-green-500/10 text-green-700 dark:border-green-500/30 dark:bg-green-500/8 dark:text-green-400"
              data-testid={`badge-savings-${pkg.id}`}
            >
              Save {pkg.savingsPct}%
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatPerCreditCents(pkg.perCreditUSD)} per credit
        </p>
      </div>

      <div className="mt-auto">
        <Button
          className={cn(
            "w-full",
            isMostPopular &&
              "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500",
            isBestValue &&
              "bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400",
          )}
          variant={isMostPopular || isBestValue ? "default" : "outline"}
          onClick={() => setLocation(`/checkout/${pkg.id}`)}
          aria-label={ariaLabel}
          data-testid={`button-buy-${pkg.id}`}
        >
          Buy now
        </Button>
      </div>
    </article>
  );
}

function ComparisonTable() {
  const starter = CREDIT_PACKAGES[0];
  return (
    <section
      className="mx-auto mb-14 max-w-4xl md:mb-20"
      data-testid="section-comparison"
    >
      <h2 className="mb-2 text-center text-2xl font-semibold md:text-3xl">
        Compare packages
      </h2>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        Per-credit value improves at every tier. No expiry, no subscription.
      </p>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm [&_tbody_tr:nth-child(even)]:bg-muted/30">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Tier</th>
              <th className="px-4 py-3 text-right font-semibold">Credits</th>
              <th className="px-4 py-3 text-right font-semibold">Price</th>
              <th className="px-4 py-3 text-right font-semibold">Per credit</th>
              <th className="px-4 py-3 text-right font-semibold">
                Savings vs Starter
              </th>
            </tr>
          </thead>
          <tbody>
            {CREDIT_PACKAGES.map((pkg) => (
              <tr key={pkg.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pkg.name}</span>
                    {pkg.badge && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "px-1.5 py-0 text-[10px]",
                          pkg.badge === "Most popular" &&
                            "border-violet-500/40 text-violet-600 dark:border-violet-500/30 dark:text-violet-400",
                          pkg.badge === "Best value" &&
                            "border-amber-500/40 text-amber-600 dark:border-amber-500/30 dark:text-amber-400",
                        )}
                      >
                        {pkg.badge}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {pkg.credits.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatUSD(pkg.priceUSD)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {formatPerCreditCents(pkg.perCreditUSD)}
                </td>
                <td className="px-4 py-3 text-right">
                  {pkg.savingsPct === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-semibold text-green-700 dark:text-green-400">
                      {pkg.savingsPct}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Per-credit savings calculated against the {starter.name} tier rate
        of {formatPerCreditCents(starter.perCreditUSD)}.
      </p>
    </section>
  );
}

function PricingFaq() {
  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "Do credits expire?",
      a: (
        <p>
          No. Once you buy credits, they're yours forever — even if you
          take a break from VoxDex.
        </p>
      ),
    },
    {
      q: "Can I cash out my credits?",
      a: (
        <p>
          No. Credits are for use on VoxDex only. They have no cash value
          and can't be exchanged for money or transferred to other users.
          See our{" "}
          <Link
            href="/terms"
            className="text-primary underline underline-offset-2"
          >
            Terms of Service
          </Link>
          .
        </p>
      ),
    },
    {
      q: "What payment methods do you accept?",
      a: (
        <p>
          We accept all major credit and debit cards, plus Apple Pay and
          Google Pay where supported. Payments are processed by our payment
          partner.
        </p>
      ),
    },
    {
      q: "Are refunds available?",
      a: (
        <p>
          Refunds are processed by Paddle, our Merchant of Record, in line
          with Paddle's policy and applicable consumer law. For VoxDex-side
          technical billing issues, contact us and we'll help route your
          request. See our{" "}
          <Link
            href="/refund-policy"
            className="text-primary underline underline-offset-2"
          >
            Refund Policy
          </Link>
          .
        </p>
      ),
    },
    {
      q: "Is there a subscription option?",
      a: (
        <p>
          Not yet. Right now you buy credits as you need them. We may add
          subscriptions in the future.
        </p>
      ),
    },
  ];

  return (
    <section className="mx-auto mb-14 max-w-3xl md:mb-20" data-testid="section-pricing-faq">
      <h2 className="mb-2 text-center text-2xl font-semibold md:text-3xl">
        Frequently asked
      </h2>
      <p className="mb-6 text-center text-sm text-muted-foreground">
        Quick answers to the questions we hear most.
      </p>
      <Card className="px-2 sm:px-4">
        <Accordion type="single" collapsible>
          {faqs.map((item, idx) => (
            <AccordionItem
              key={item.q}
              value={`faq-${idx}`}
              className="last:border-b-0"
              data-testid={`accordion-faq-${idx}`}
            >
              <AccordionTrigger className="text-left text-base">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>
    </section>
  );
}

function PricingDisclaimer() {
  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        All prices in US dollars. Your local currency equivalent at
        checkout depends on your bank's exchange rate. Credits are for
        entertainment use on VoxDex only and have no cash value. See our{" "}
        <Link
          href="/terms"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/refund-policy"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Refund Policy
        </Link>
        .
      </p>
    </section>
  );
}
