import type { VoicesEntity } from "./types";

type WorldMarketPreview = NonNullable<VoicesEntity["worldMarketPreview"]>;

interface VoiceWorldMarketPreviewProps {
  preview: WorldMarketPreview;
}

function BinaryTiles({ preview }: { preview: Extract<WorldMarketPreview, { layout: "binary" }> }) {
  const leftTileClass = preview.isClassicYesNo
    ? "border-emerald-500/30 bg-emerald-500/5"
    : "border-blue-500/30 bg-blue-500/5";
  const rightTileClass = preview.isClassicYesNo
    ? "border-rose-500/30 bg-rose-500/5"
    : "border-purple-500/30 bg-purple-500/5";
  const leftPercentClass = preview.isClassicYesNo
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-blue-600 dark:text-blue-400";
  const rightPercentClass = preview.isClassicYesNo
    ? "text-rose-600 dark:text-rose-400"
    : "text-purple-600 dark:text-purple-400";

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <div className={`rounded border px-1.5 py-1 text-center ${leftTileClass}`}>
        <p className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">
          {preview.left.label}
        </p>
        <p className={`text-lg font-bold font-mono leading-tight tabular-nums ${leftPercentClass}`}>
          {preview.left.percent}%
        </p>
      </div>
      <div className={`rounded border px-1.5 py-1 text-center ${rightTileClass}`}>
        <p className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">
          {preview.right.label}
        </p>
        <p className={`text-lg font-bold font-mono leading-tight tabular-nums ${rightPercentClass}`}>
          {preview.right.percent}%
        </p>
      </div>
    </div>
  );
}

function MultiRows({ preview }: { preview: Extract<WorldMarketPreview, { layout: "multi" }> }) {
  const remainingCount = Math.max(0, preview.totalOutcomes - preview.topOutcomes.length);

  return (
    <>
      <div className="space-y-1">
        {preview.topOutcomes.map((outcome, idx) => {
          const isLeading = idx === 0 && outcome.percent > 0;
          return (
            <div key={`${outcome.label}-${idx}`} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs leading-tight text-foreground">
                  {outcome.label}
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] font-bold leading-tight ${
                    isLeading ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground"
                  }`}
                >
                  {outcome.percent}%
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-700/50">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
                  style={{ width: `${outcome.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {remainingCount > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          + {remainingCount} more outcome{remainingCount === 1 ? "" : "s"}
        </p>
      )}
    </>
  );
}

export function VoiceWorldMarketPreview({ preview }: VoiceWorldMarketPreviewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end pt-1">
      {preview.layout === "binary" ? (
        <BinaryTiles preview={preview} />
      ) : (
        <MultiRows preview={preview} />
      )}
    </div>
  );
}
