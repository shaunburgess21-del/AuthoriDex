import { useState } from "react";
import { MapPin, DollarSign, Sparkles, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import * as Flags from "country-flag-icons/react/3x2";
import { formatNetWorth } from "@/lib/formatNumber";

interface CelebrityProfile {
  personId: string;
  personName: string;
  shortBio: string;
  longBio: string | null;
  knownFor: string;
  fromCountry: string;
  fromCountryCode: string;
  basedIn: string;
  basedInCountryCode: string;
  estimatedNetWorth: string;
  generatedAt: string;
}

interface InlineCelebrityBioProps {
  personId: string;
  personName: string;
}

const countryToISO3: Record<string, string> = {
  US: "USA", GB: "GBR", ZA: "ZAF", CA: "CAN", AU: "AUS", DE: "DEU", FR: "FRA", JP: "JPN", KR: "KOR", IN: "IND",
  BR: "BRA", MX: "MEX", CN: "CHN", IT: "ITA", ES: "ESP", RU: "RUS", NL: "NLD", SE: "SWE", CH: "CHE", AT: "AUT",
  BE: "BEL", PL: "POL", GR: "GRC", PT: "PRT", IE: "IRL", NZ: "NZL", AR: "ARG", CL: "CHL", CO: "COL", IL: "ISR",
  AE: "ARE", SG: "SGP", HK: "HKG", TW: "TWN", PH: "PHL", TH: "THA", MY: "MYS", ID: "IDN", VN: "VNM", NG: "NGA",
  EG: "EGY", KE: "KEN", ZW: "ZWE", GH: "GHA", MA: "MAR", TR: "TUR", SA: "SAU", PK: "PAK", BD: "BGD", LK: "LKA",
  NP: "NPL", MM: "MMR"
};

function CountryDisplay({ countryCode, countryName }: { countryCode: string; countryName: string }) {
  const FlagComponent = (Flags as any)[countryCode];
  const iso3 = countryToISO3[countryCode] || countryCode;

  return (
    <span className="inline-flex items-center gap-2">
      {FlagComponent && <FlagComponent className="w-5 h-4 rounded-sm" />}
      <span className="hidden md:inline">{countryName}</span>
      <span className="md:hidden">{iso3}</span>
    </span>
  );
}

export function InlineCelebrityBio({ personId, personName }: InlineCelebrityBioProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: profile, isLoading, error } = useQuery<CelebrityProfile>({
    queryKey: ["/api/celebrity-profile", personId],
    queryFn: async () => {
      const res = await fetch(`/api/celebrity-profile/${personId}`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled: !!personId,
  });

  if (isLoading) {
    return (
      <div className="mb-8 flex items-center gap-2 text-sm text-muted-foreground" data-testid="inline-bio-loading">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading profile…</span>
      </div>
    );
  }

  if (error || !profile) {
    return null;
  }

  const aboutText = expanded && profile.longBio ? profile.longBio : profile.shortBio;

  return (
    <div className="mb-8 space-y-4" data-testid="inline-celebrity-bio">
      <div>
        <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">About</h4>
        <p
          className={`text-base leading-relaxed text-muted-foreground ${!expanded ? "line-clamp-2" : ""}`}
          data-testid="text-celebrity-bio"
        >
          {aboutText}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-xs text-primary hover:text-primary/80 hover:underline focus:outline-none focus:underline"
          data-testid="button-read-more"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      </div>

      {expanded && (
        <>
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Known For</h4>
            <p className="text-sm leading-relaxed text-muted-foreground" data-testid="text-celebrity-known-for">
              {profile.knownFor}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5" />
                <span className="text-xs uppercase tracking-wide">From</span>
              </div>
              <p className="text-sm font-medium" data-testid="text-celebrity-from">
                <CountryDisplay
                  countryCode={profile.fromCountryCode}
                  countryName={profile.fromCountry}
                />
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5" />
                <span className="text-xs uppercase tracking-wide">Based In</span>
              </div>
              <p className="text-sm font-medium" data-testid="text-celebrity-based-in">
                <CountryDisplay
                  countryCode={profile.basedInCountryCode}
                  countryName={profile.basedIn}
                />
              </p>
            </div>
          </div>

          <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-2 text-primary mb-1">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide font-medium">Estimated Net Worth (2025)</span>
            </div>
            <p className="text-xl font-mono font-bold" data-testid="text-celebrity-net-worth">
              {formatNetWorth(profile.estimatedNetWorth)}
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2 border-t border-border/50">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span>AI-generated content. May not be 100% accurate.</span>
          </div>
        </>
      )}
    </div>
  );
}
