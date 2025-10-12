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
}

const platformConfig: Record<string, { 
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
}> = {
  'X': { 
    icon: SiX, 
    color: 'text-white', 
    bgColor: 'bg-black dark:bg-white/10' 
  },
  'YouTube': { 
    icon: SiYoutube, 
    color: 'text-red-500', 
    bgColor: 'bg-red-500/10' 
  },
  'Instagram': { 
    icon: SiInstagram, 
    color: 'text-pink-500', 
    bgColor: 'bg-pink-500/10' 
  },
  'TikTok': { 
    icon: SiTiktok, 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-400/10' 
  },
  'Spotify': { 
    icon: SiSpotify, 
    color: 'text-green-500', 
    bgColor: 'bg-green-500/10' 
  },
  'News': { 
    icon: Newspaper, 
    color: 'text-blue-500', 
    bgColor: 'bg-blue-500/10' 
  },
};

export function PlatformBlock({ platform, insights }: PlatformBlockProps) {
  const [selectedInsight, setSelectedInsight] = useState<PlatformInsight | null>(null);
  const config = platformConfig[platform] || platformConfig['News'];
  const Icon = config.icon;

  return (
    <>
      <Card className="overflow-visible" data-testid={`platform-block-${platform.toLowerCase()}`}>
        <CardHeader className={`${config.bgColor} pb-4`}>
          <div className="flex items-center gap-3">
            <div className={`${config.color}`}>
              <Icon className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-serif font-semibold" data-testid={`text-platform-${platform.toLowerCase()}`}>
              {platform}
            </h3>
          </div>
        </CardHeader>
        
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map((insight) => (
              <InsightCard
                key={insight.insightType}
                insightType={insight.insightType}
                metricName={insight.metricName}
                topItem={insight.items[0]}
                onClick={() => setSelectedInsight(insight)}
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
        />
      )}
    </>
  );
}
