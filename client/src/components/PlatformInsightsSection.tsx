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

interface PlatformInsightsResponse {
  insights: PlatformInsight[];
  followerCounts: Record<string, number>;
}

interface PlatformInsightsSectionProps {
  personId: string;
}

// Platform-specific follower labels
const followerLabels: Record<string, string> = {
  'X': 'Followers',
  'YouTube': 'Subscribers',
  'Instagram': 'Followers',
  'TikTok': 'Followers',
  'Spotify': 'Monthly Listeners',
  'News': '',
};

export function PlatformInsightsSection({ personId }: PlatformInsightsSectionProps) {
  const { data, isLoading, error } = useQuery<PlatformInsightsResponse>({
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

  if (error || !data || !data.insights || data.insights.length === 0) {
    return null;
  }

  const { insights, followerCounts } = data;

  // Group insights by platform
  const platformGroups = insights.reduce((acc: Record<string, PlatformInsight[]>, insight: PlatformInsight) => {
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
            followerCount={followerCounts[platform]}
            followerLabel={followerLabels[platform]}
            personId={personId}
          />
        ))}
      </div>
    </div>
  );
}
