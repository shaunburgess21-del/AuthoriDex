export function normalizeMass(rawValue: number): number {
  if (rawValue < 10000) {
    return 0;
  }
  
  const val = Math.log10(rawValue);
  const min = 4;
  const max = 9;
  
  const normalized = ((val - min) / (max - min)) * 100;
  
  return Math.min(100, Math.max(0, normalized));
}

export function normalizeVelocity(delta: number): number {
  if (delta <= -1) return 0;
  if (delta >= 2) return 100;
  
  const normalized = ((delta + 1) / 3) * 100;
  return Math.min(100, Math.max(0, normalized));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateMomentum(
  velocityScore: number,
  delta: number
): "Breakout" | "Sustained" | "Cooling" | "Stable" {
  if (delta > 0.5 && velocityScore > 70) {
    return "Breakout";
  } else if (delta > 0.1 && velocityScore > 50) {
    return "Sustained";
  } else if (delta < -0.1 && velocityScore < 40) {
    return "Cooling";
  } else {
    return "Stable";
  }
}

export function generateDrivers(
  wikiDelta: number,
  newsDelta: number,
  searchDelta: number,
  _unused?: number
): string[] {
  const drivers: string[] = [];
  
  if (wikiDelta > 0.5) {
    drivers.push("Wikipedia Spike");
  } else if (wikiDelta > 0.2) {
    drivers.push("Rising Wikipedia Interest");
  }
  
  if (newsDelta > 0.5) {
    drivers.push("Heavy News Coverage");
  } else if (newsDelta > 0.2) {
    drivers.push("Increased Media Attention");
  }
  
  if (searchDelta > 0.5) {
    drivers.push("Search Breakout");
  } else if (searchDelta > 0.2) {
    drivers.push("Trending in Search");
  }
  
  if (drivers.length === 0) {
    drivers.push("Steady Baseline");
  }
  
  return drivers;
}
