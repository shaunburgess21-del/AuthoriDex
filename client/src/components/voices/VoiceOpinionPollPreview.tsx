import type { VoicesEntity } from "./types";

type OpinionPreview = NonNullable<VoicesEntity["opinionPreview"]>;

interface VoiceOpinionPollPreviewProps {
  preview: OpinionPreview;
}

const MOBILE_OPTION_COUNT = 3;
const DESKTOP_OPTION_COUNT = 5;

export function VoiceOpinionPollPreview({ preview }: VoiceOpinionPollPreviewProps) {
  const mobileShown = Math.min(MOBILE_OPTION_COUNT, preview.topOptions.length);
  const desktopShown = Math.min(DESKTOP_OPTION_COUNT, preview.topOptions.length);
  const remainingMobile = Math.max(0, preview.totalOptions - mobileShown);
  const remainingDesktop = Math.max(0, preview.totalOptions - desktopShown);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div className="space-y-1">
        {preview.topOptions.map((option, idx) => {
          const isLeading = idx === 0 && option.percent > 0;
          const desktopOnly = idx >= MOBILE_OPTION_COUNT;
          return (
            <div
              key={`${option.name}-${idx}`}
              className={desktopOnly ? "hidden min-w-0 sm:block" : "min-w-0"}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs leading-none text-foreground">
                  {option.name}
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] font-bold leading-none ${
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
      {remainingMobile > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground sm:hidden">
          + {remainingMobile} more option{remainingMobile === 1 ? "" : "s"}
        </p>
      )}
      {remainingDesktop > 0 && (
        <p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">
          + {remainingDesktop} more option{remainingDesktop === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
