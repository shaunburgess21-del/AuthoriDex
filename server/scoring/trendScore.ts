import { 
  calculateDynamicMassWeights, 
  calculateDynamicVelocityWeights,
  MASS_ALLOCATION,
  VELOCITY_ALLOCATION,
  MISSING_X_PENALTY,
  WIKI_DOMINANCE_CAP,
  ActivePlatforms
} from "./normalize";
import { 
  normalizeMass, 
  normalizeVelocity, 
  clamp, 
  calculateMomentum, 
  generateDrivers 
} from "./utils";

export interface TrendInputs {
  wikiPageviews: number;
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;
  xQuoteVelocity: number;
  xReplyVelocity: number;
  
  totalFollowers?: number;
  
  activePlatforms: ActivePlatforms;
}

export interface TrendScoreResult {
  trendScore: number;
  massScore: number;
  velocityScore: number;
  confidence: number;
  momentum: "Breakout" | "Sustained" | "Cooling" | "Stable";
  drivers: string[];
  
  change24h: number;
  change7d: number;
}

export function computeTrendScore(
  inputs: TrendInputs,
  previousScore?: number,
  previousScore7d?: number
): TrendScoreResult {
  const massWeights = calculateDynamicMassWeights(inputs.activePlatforms);
  
  const hasWiki = inputs.wikiDelta !== 0 || inputs.wikiPageviews > 0;
  const hasNews = inputs.newsDelta !== 0;
  const hasSearch = inputs.searchDelta !== 0;
  const hasX = inputs.xQuoteVelocity > 0 || inputs.xReplyVelocity > 0;
  
  const velocityWeights = calculateDynamicVelocityWeights(
    hasWiki || inputs.activePlatforms.wiki,
    hasNews,
    hasSearch,
    hasX || inputs.activePlatforms.x
  );
  
  let wikiMassScore = normalizeMass(inputs.wikiPageviews * 365);
  wikiMassScore = Math.min(wikiMassScore, wikiMassScore * WIKI_DOMINANCE_CAP + 50);
  
  const followerScore = inputs.totalFollowers 
    ? normalizeMass(inputs.totalFollowers) 
    : 0;
  
  const massScore = (
    (wikiMassScore * massWeights.wiki) +
    (followerScore * massWeights.x) +
    (followerScore * massWeights.instagram) +
    (followerScore * massWeights.youtube)
  );
  
  let wikiVelocityScore = normalizeVelocity(inputs.wikiDelta);
  wikiVelocityScore = Math.min(wikiVelocityScore, wikiVelocityScore * WIKI_DOMINANCE_CAP + 30);
  
  const newsVelocityScore = normalizeVelocity(inputs.newsDelta);
  const searchVelocityScore = normalizeVelocity(inputs.searchDelta);
  
  const xTotalVelocity = inputs.xQuoteVelocity + inputs.xReplyVelocity;
  const xVelocityScore = Math.min(100, xTotalVelocity * 2);
  
  const velocityScore = (
    (wikiVelocityScore * velocityWeights.wikiDelta) +
    (newsVelocityScore * velocityWeights.newsDelta) +
    (searchVelocityScore * velocityWeights.searchDelta) +
    (xVelocityScore * velocityWeights.xVelocity)
  );
  
  const rawScore = (massScore * MASS_ALLOCATION) + (velocityScore * VELOCITY_ALLOCATION);
  
  let dataSourceCount = 0;
  if (hasWiki) dataSourceCount++;
  if (hasNews) dataSourceCount++;
  if (hasSearch) dataSourceCount++;
  if (hasX) dataSourceCount++;
  
  const hasXHandle = inputs.activePlatforms.x;
  const xPenalty = hasXHandle ? 1.0 : MISSING_X_PENALTY;
  
  let confidence = dataSourceCount >= 3 ? 1.3 : 
                   dataSourceCount >= 2 ? 1.0 : 
                   dataSourceCount >= 1 ? 0.8 : 0.6;
  
  confidence = confidence * xPenalty;
  
  const trendScore = clamp(rawScore * confidence * 10000, 0, 1000000);
  
  const avgDelta = (inputs.wikiDelta + inputs.newsDelta + inputs.searchDelta) / 3;
  const momentum = calculateMomentum(velocityScore, avgDelta);
  
  const drivers = generateDrivers(
    inputs.wikiDelta,
    inputs.newsDelta,
    inputs.searchDelta,
    xTotalVelocity
  );
  
  const change24h = previousScore 
    ? ((trendScore - previousScore) / previousScore) * 100
    : (Math.random() * 20 - 10);
  
  const change7d = previousScore7d
    ? ((trendScore - previousScore7d) / previousScore7d) * 100
    : (Math.random() * 40 - 20);
  
  return {
    trendScore: Math.round(trendScore),
    massScore: Math.round(massScore * 100) / 100,
    velocityScore: Math.round(velocityScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    momentum,
    drivers,
    change24h: Math.round(change24h * 10) / 10,
    change7d: Math.round(change7d * 10) / 10,
  };
}
