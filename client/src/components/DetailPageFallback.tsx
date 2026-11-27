import { VoteDetailSkeleton } from "@/components/vote/VoteDetailSkeleton";
import {
  CommunityMarketDetailSkeleton,
  NativeMarketDetailSkeleton,
} from "@/components/predict/MarketDetailSkeleton";
import { PersonDetailSkeleton } from "@/components/profile/PersonDetailSkeleton";
import {
  AccountProfileSkeleton,
  PublicProfileSkeleton,
} from "@/components/profile/PublicProfileSkeleton";
import type { DetailSkeletonKind } from "@/lib/detailRouteSkeleton";

/**
 * Route-level Suspense fallback for detail URLs. Matches the skeleton
 * each page renders while its own query is in flight, so the chunk
 * download and the data wait look like one continuous layout.
 */
export function DetailPageFallback({ kind }: { kind: DetailSkeletonKind }) {
  switch (kind) {
    case "matchup":
      return <VoteDetailSkeleton variant="matchup" />;
    case "opinion":
      return <VoteDetailSkeleton variant="opinion" />;
    case "sentiment":
      return <VoteDetailSkeleton variant="sentiment" />;
    case "market":
      return <CommunityMarketDetailSkeleton />;
    case "native-market":
      return <NativeMarketDetailSkeleton />;
    case "person":
      return <PersonDetailSkeleton />;
    case "public-profile":
      return <PublicProfileSkeleton />;
    case "account-profile":
      return <AccountProfileSkeleton />;
    default:
      return null;
  }
}
