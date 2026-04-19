import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildPickerSeeds } from '@/lib/avatar/generator';
import { GenerativeAvatar } from './GenerativeAvatar';

interface AvatarPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  username?: string | null;
  currentSeed?: string | null;
  /**
   * Called when the user hits Save. The parent is responsible for:
   *   - rendering the seed to PNG
   *   - uploading it to Supabase Storage
   *   - PATCHing the profile with { avatarSeed, avatarUrl }
   * Should throw on error — the picker will keep the modal open and
   * surface the loading state appropriately.
   */
  onSave: (seed: string) => Promise<void>;
}

const OPTION_COUNT = 8;

/**
 * Build a fresh batch of OPTION_COUNT seeds. If the user already has a
 * saved seed, the first slot is their current avatar so they can see it
 * alongside the fresh batch and don't feel the modal is "wiping" them.
 */
function buildBatch(userId: string, currentSeed: string | null | undefined): string[] {
  const salt = Date.now().toString(36);
  const fresh = buildPickerSeeds(userId, salt, OPTION_COUNT);
  if (!currentSeed) return fresh;
  // Replace the first fresh option with the user's current seed
  fresh[0] = currentSeed;
  return fresh;
}

export function AvatarPicker({
  open,
  onOpenChange,
  userId,
  username,
  currentSeed,
  onSave,
}: AvatarPickerProps) {
  const [seeds, setSeeds] = useState<string[]>(() => buildBatch(userId, currentSeed));
  const [selectedSeed, setSelectedSeed] = useState<string>(() => seeds[0]);
  const [saving, setSaving] = useState(false);

  // Reset seeds + selection when the modal opens (so each open is a fresh batch)
  useEffect(() => {
    if (open) {
      const batch = buildBatch(userId, currentSeed);
      setSeeds(batch);
      setSelectedSeed(currentSeed || batch[0]);
      setSaving(false);
    }
  }, [open, userId, currentSeed]);

  const shuffle = useCallback(() => {
    const salt = Date.now().toString(36);
    const fresh = buildPickerSeeds(userId, salt, OPTION_COUNT);
    setSeeds(fresh);
    setSelectedSeed(fresh[0]);
  }, [userId]);

  const canSave = useMemo(
    () => selectedSeed && selectedSeed !== currentSeed,
    [selectedSeed, currentSeed],
  );

  const handleSave = useCallback(async () => {
    if (!selectedSeed || saving) return;
    setSaving(true);
    try {
      await onSave(selectedSeed);
      onOpenChange(false);
    } catch (err) {
      // Parent component surfaces the error toast; we just recover state.
      setSaving(false);
    }
  }, [selectedSeed, saving, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Choose your avatar</DialogTitle>
          <DialogDescription>
            Every avatar is unique and generated just for you. Pick one, shuffle for more options,
            or keep what you have.
          </DialogDescription>
        </DialogHeader>

        {/* Preview */}
        <div className="flex flex-col items-center py-2">
          <div
            className={cn(
              'relative h-32 w-32 overflow-hidden rounded-full',
              'ring-2 ring-primary/30 ring-offset-4 ring-offset-background',
              'shadow-lg shadow-primary/10 transition-all duration-300',
            )}
          >
            {selectedSeed && <GenerativeAvatar seed={selectedSeed} />}
          </div>
          {username && (
            <p className="mt-3 text-sm text-muted-foreground">@{username}</p>
          )}
        </div>

        {/* Grid of options */}
        <div className="grid grid-cols-4 gap-3 px-1">
          {seeds.map((seed) => {
            const isSelected = seed === selectedSeed;
            return (
              <button
                key={seed}
                type="button"
                onClick={() => setSelectedSeed(seed)}
                disabled={saving}
                aria-label={`Avatar option${isSelected ? ' (selected)' : ''}`}
                aria-pressed={isSelected}
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-full',
                  'transition-all duration-150',
                  'ring-2 ring-offset-2 ring-offset-background',
                  'focus-visible:outline-none focus-visible:ring-primary',
                  isSelected
                    ? 'ring-primary scale-105 shadow-md shadow-primary/20'
                    : 'ring-transparent hover:ring-border hover:scale-105',
                  saving && 'pointer-events-none opacity-50',
                )}
              >
                <GenerativeAvatar seed={seed} />
                {isSelected && (
                  <div className="absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
                    <div className="rounded-full bg-primary p-1 shadow-sm">
                      <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={shuffle}
            disabled={saving}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Shuffle
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="min-w-[80px]"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
