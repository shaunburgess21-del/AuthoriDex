export const IMAGE_FLAG_REASONS = [
  'wrong_person',
  'low_quality',
  'inappropriate',
  'duplicate',
  'other',
] as const;

export type ImageFlagReason = (typeof IMAGE_FLAG_REASONS)[number];

export const IMAGE_FLAG_RATE_LIMIT = 10;
export const IMAGE_FLAG_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isValidImageFlagReason(reason: unknown): reason is ImageFlagReason {
  return typeof reason === 'string' && (IMAGE_FLAG_REASONS as readonly string[]).includes(reason);
}

export function isImageFlagRateLimited(countInWindow: number): boolean {
  return countInWindow >= IMAGE_FLAG_RATE_LIMIT;
}
