import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, MapPin, DollarSign, Sparkles, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import * as Flags from "country-flag-icons/react/3x2";

interface CelebrityProfile {
  personId: string;
  personName: string;
  shortBio: string;
  knownFor: string;
  fromCountry: string;
  fromCountryCode: string;
  basedIn: string;
  basedInCountryCode: string;
  estimatedNetWorth: string;
  generatedAt: string;
}

interface CelebrityInfoModalProps {
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

export function CelebrityInfoModal({ personId, personName }: CelebrityInfoModalProps) {
  const [open, setOpen] = useState(false);
  
  const { data: profile, isLoading, error } = useQuery<CelebrityProfile>({
    queryKey: ['/api/celebrity-profile', personId],
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full bg-background/60 backdrop-blur-sm border border-border/50 hover:bg-background/80"
          data-testid="button-celebrity-info"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-background/95 backdrop-blur-xl border border-border/50">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-xl font-serif">{personName}</DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating profile with AI...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-destructive">Failed to load profile</p>
            <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
          </div>
        ) : profile ? (
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Short Bio</h4>
                <p className="text-sm leading-relaxed" data-testid="text-celebrity-bio">{profile.shortBio}</p>
              </div>
              
              <div>
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Known For</h4>
                <p className="text-sm leading-relaxed" data-testid="text-celebrity-known-for">{profile.knownFor}</p>
              </div>
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
                {profile.estimatedNetWorth}
              </p>
            </div>
            
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-2 border-t border-border/50">
              <Sparkles className="h-3 w-3" />
              <span>AI-generated content. May not be 100% accurate.</span>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
