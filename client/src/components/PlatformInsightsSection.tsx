import { useQuery } from "@tanstack/react-query";
import { PlatformBlock } from "./PlatformBlock";

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

interface PlatformInsightsSectionProps {
  personId: string;
}

export function PlatformInsightsSection({ personId }: PlatformInsightsSectionProps) {
  const { data: insights, isLoading, error } = useQuery<PlatformInsight[]>({
    queryKey: [`/api/people/${personId}/insights`],
    enabled: !!personId,
  });

  if (isLoading) {
    return (
      <div className="mt-8">
        <h2 className="text-2xl font-serif font-bold mb-6">Platform Insights</h2>
        <div className="flex items-center justify-center py-12">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
        </div>
      </div>
    );
  }

  if (error || !insights || insights.length === 0) {
    return null;
  }

  // Group insights by platform
  const platformGroups = insights.reduce((acc, insight) => {
    if (!acc[insight.platform]) {
      acc[insight.platform] = [];
    }
    acc[insight.platform].push(insight);
    return acc;
  }, {} as Record<string, PlatformInsight[]>);

  // Define platform order
  const platformOrder = ['X', 'YouTube', 'Instagram', 'TikTok', 'Spotify', 'News'];
  const sortedPlatforms = platformOrder.filter(p => platformGroups[p]);

  return (
    <div className="mt-8" data-testid="section-platform-insights">
      <h2 className="text-2xl font-serif font-bold mb-6">Platform Insights</h2>
      
      <div className="space-y-6">
        {sortedPlatforms.map((platform) => (
          <PlatformBlock
            key={platform}
            platform={platform}
            insights={platformGroups[platform]}
          />
        ))}
      </div>
    </div>
  );
}
