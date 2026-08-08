import type { VoicesEntity } from "./types";

type OpinionPreview = NonNullable<VoicesEntity["opinionPreview"]>;

interface VoiceOpinionPollPreviewProps {
  preview: OpinionPreview;
}

export function VoiceOpinionPollPreview({ preview }: VoiceOpinionPollPreviewProps) {
  const remainingCount = Math.max(0, preview.totalOptions - preview.topOptions.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden pt-1">
      <div className="space-y-1.5">
        {preview.topOptions.map((option, idx) => {
          const isLeading = idx === 0 && option.percent > 0;
          return (
            <div key={`${option.name}-${idx}`} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs leading-tight text-foreground">
                  {option.name}
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] font-bold leading-tight ${
                    isLeading ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground"
                  }`}
                >
                  {option.percent}%
                </span>
              </div>
              <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-slate-700/50">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
                  style={{ width: `${option.percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {remainingCount > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          + {remainingCount} more option{remainingCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
