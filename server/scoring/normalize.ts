export interface StandardWeights {
  mass: {
    wiki: number;
    x: number;
    instagram: number;
    youtube: number;
  };
  velocity: {
    wikiDelta: number;
    newsDelta: number;
    searchDelta: number;
    xVelocity: number;
  };
}

export const STANDARD_WEIGHTS: StandardWeights = {
  mass: {
    wiki: 0.4,
    x: 0.2,
    instagram: 0.2,
    youtube: 0.2,
  },
  velocity: {
    wikiDelta: 0.15,
    newsDelta: 0.25,
    searchDelta: 0.35,
    xVelocity: 0.25,
  },
};

export const MASS_ALLOCATION = 0.3;
export const VELOCITY_ALLOCATION = 0.7;

export interface ActivePlatforms {
  wiki: boolean;
  x: boolean;
  instagram: boolean;
  youtube: boolean;
}

export interface AdjustedMassWeights {
  wiki: number;
  x: number;
  instagram: number;
  youtube: number;
}

export interface AdjustedVelocityWeights {
  wikiDelta: number;
  newsDelta: number;
  searchDelta: number;
  xVelocity: number;
}

export function calculateDynamicMassWeights(
  activePlatforms: ActivePlatforms
): AdjustedMassWeights {
  const weights = STANDARD_WEIGHTS.mass;
  
  let activeSum = 0;
  if (activePlatforms.wiki) activeSum += weights.wiki;
  if (activePlatforms.x) activeSum += weights.x;
  if (activePlatforms.instagram) activeSum += weights.instagram;
  if (activePlatforms.youtube) activeSum += weights.youtube;
  
  if (activeSum === 0) {
    activeSum = weights.wiki;
  }
  
  const multiplier = 1.0 / activeSum;
  
  return {
    wiki: activePlatforms.wiki ? weights.wiki * multiplier : 0,
    x: activePlatforms.x ? weights.x * multiplier : 0,
    instagram: activePlatforms.instagram ? weights.instagram * multiplier : 0,
    youtube: activePlatforms.youtube ? weights.youtube * multiplier : 0,
  };
}

export function calculateDynamicVelocityWeights(
  hasWiki: boolean,
  hasNews: boolean,
  hasSearch: boolean,
  hasX: boolean
): AdjustedVelocityWeights {
  const weights = STANDARD_WEIGHTS.velocity;
  
  let activeSum = 0;
  if (hasWiki) activeSum += weights.wikiDelta;
  if (hasNews) activeSum += weights.newsDelta;
  if (hasSearch) activeSum += weights.searchDelta;
  if (hasX) activeSum += weights.xVelocity;
  
  if (activeSum === 0) {
    activeSum = weights.wikiDelta + weights.newsDelta;
  }
  
  const multiplier = 1.0 / activeSum;
  
  return {
    wikiDelta: hasWiki ? weights.wikiDelta * multiplier : 0,
    newsDelta: hasNews ? weights.newsDelta * multiplier : 0,
    searchDelta: hasSearch ? weights.searchDelta * multiplier : 0,
    xVelocity: hasX ? weights.xVelocity * multiplier : 0,
  };
}
