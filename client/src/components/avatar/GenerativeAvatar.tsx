import { useMemo } from 'react';
import { generateAvatarDataURL } from '@/lib/avatar/render';
import { cn } from '@/lib/utils';

interface GenerativeAvatarProps {
  seed: string;
  className?: string;
  alt?: string;
}

/**
 * Renders a single avatar from its seed as a pixelated img.
 * The data URL is memoized by seed so repeated renders are free.
 *
 * Use this inside the avatar picker (grid options + preview). For
 * generic avatar display across the app, keep using UserProfileAvatar
 * which resolves `avatar_url` from the backend.
 */
export function GenerativeAvatar({ seed, className, alt = 'Avatar' }: GenerativeAvatarProps) {
  const dataURL = useMemo(() => generateAvatarDataURL(seed), [seed]);
  if (!dataURL) return null;
  return (
    <img
      src={dataURL}
      alt={alt}
      draggable={false}
      className={cn('block h-full w-full object-cover', className)}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
