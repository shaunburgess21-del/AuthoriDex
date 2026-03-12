import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { InsightCard } from "./InsightCard";
import { useState } from "react";
import { InsightModal } from "./InsightModal";
import { SiX, SiYoutube, SiInstagram, SiTiktok, SiSpotify } from "react-icons/si";
import { Newspaper } from "lucide-react";

interface InsightItem {
  rank: number;
  title: string;
  metricValue: number;
  link?: string;
  imageUrl?: string;
  timestamp: Date;
}

interface PlatformInsight {
  platform: string;
  insightType: string;
  metricName: string;
  items: InsightItem[];
}

interface PlatformBlockProps {
  platform: string;
  insights: PlatformInsight[];
  followerCount?: number;
  followerLabel?: string;
  personId?: string;
}

const platformConfig: Record<string, { 
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  accentColor: string;
}> = {
  'X': { 
    icon: SiX, 
    color: 'text-white', 
    bgColor: 'bg-black dark:bg-white/10',
    accentColor: '#000000'
  },
  'YouTube': { 
    icon: SiYoutube, 
    color: 'text-red-500', 
    bgColor: 'bg-red-500/10',
    accentColor: '#ef4444'
  },
  'Instagram': { 
    icon: SiInstagram, 
    color: 'text-pink-500', 
    bgColor: 'bg-pink-500/10',
    accentColor: '#ec4899'
  },
  'TikTok': { 
    icon: SiTiktok, 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-400/10',
    accentColor: '#22d3ee'
  },
  'Spotify': { 
    icon: SiSpotify, 
    color: 'text-green-500', 
    bgColor: 'bg-green-500/10',
    accentColor: '#22c55e'
  },
  'News': { 
    icon: Newspaper, 
    color: 'text-blue-500', 
    bgColor: 'bg-blue-500/10',
    accentColor: '#3b82f6'
  },
};

export function PlatformBlock({ platform, insights, followerCount, followerLabel, personId }: PlatformBlockProps) {
  const [selectedInsight, setSelectedInsight] = useState<PlatformInsight | null>(null);
  const config = platformConfig[platform] || platformConfig['News'];
  const Icon = config.icon;

  const handleInsightClick = (insight: PlatformInsight) => {
    setSelectedInsight(insight);
  };

  // Format follower count (e.g., 1200000 -> 1.2M)
  const formatCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  return (
    <>
      <Card className="overflow-visible" data-testid={`platform-block-${platform.toLowerCase()}`}>
        <CardHeader className={`${config.bgColor} pb-4`}>
          {/* Desktop: Logo/Name left, Followers right | Mobile: Stack */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`${config.color}`}>
                <Icon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-serif font-semibold" data-testid={`text-platform-${platform.toLowerCase()}`}>
                {platform}
              </h3>
            </div>
            
            {/* Follower count (right-aligned on desktop, left on mobile) */}
            {followerCount && followerCount > 0 && (
              <div className="flex items-center gap-2" data-testid={`followers-${platform.toLowerCase()}`}>
                <span className="text-sm text-muted-foreground">{followerLabel || 'Followers'}:</span>
                <span className={`text-lg font-bold ${config.color}`}>
                  {formatCount(followerCount)}
                </span>
              </div>
            )}
          </div>
          
          {/* Brand accent line */}
          <div 
            className="mt-4 h-0.5 w-full" 
            style={{ backgroundColor: config.accentColor, opacity: 0.3 }}
          />
        </CardHeader>
        
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map((insight) => (
              <InsightCard
                key={insight.insightType}
                insightType={insight.insightType}
                metricName={insight.metricName}
                topItem={insight.items[0]}
                onClick={() => handleInsightClick(insight)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedInsight && (
        <InsightModal
          open={!!selectedInsight}
          onOpenChange={(open) => !open && setSelectedInsight(null)}
          insightType={selectedInsight.insightType}
          metricName={selectedInsight.metricName}
          items={selectedInsight.items}
          platform={platform}
          personId={personId}
        />
      )}
    </>
  );
}
