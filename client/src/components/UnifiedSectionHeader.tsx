interface UnifiedSectionHeaderProps {
  title: React.ReactNode;
  titleAddon?: React.ReactNode;
  subtitle?: string;
  subtitleMeta?: React.ReactNode;
  icon?: React.ReactNode;
  accent: "cyan" | "violet" | "blue";
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}

/** Shell uses the shared pulse-card system (index.css): tinted hairline all
 *  around + fading 3px top lip, same anatomy as Pulse widgets / leaderboard rows. */
const accentMap = {
  cyan: {
    cardClass: "pulse-card-cyan",
    iconBg: "bg-cyan-500/15 dark:bg-cyan-500/10",
  },
  violet: {
    cardClass: "pulse-card-purple",
    iconBg: "bg-violet-500/15 dark:bg-violet-500/10",
  },
  /** VoxDex leaderboard blue (#3B82F6) — Weekly Predict sections. */
  blue: {
    cardClass: "pulse-card-voxdex",
    iconBg: "bg-blue-500/15 dark:bg-blue-500/10",
  },
} as const;

export function UnifiedSectionHeader({
  title,
  titleAddon,
  subtitle,
  subtitleMeta,
  icon,
  accent,
  actions,
  meta,
  children,
  testId,
}: UnifiedSectionHeaderProps) {
  const a = accentMap[accent];

  return (
    <div className="px-1.5 md:px-0">
      <div
        className={`mb-3 rounded-xl pulse-card-flush pulse-card-noglow ${a.cardClass}`}
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3 md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icon && (
              <div className={`h-10 w-10 rounded-lg ${a.iconBg} hidden sm:flex items-center justify-center shrink-0`}>
                {icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xl font-serif font-bold">
                {title}
                {titleAddon ? <span className="inline-flex shrink-0">{titleAddon}</span> : null}
              </h2>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              {subtitleMeta && <div>{subtitleMeta}</div>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>

        {meta && <div className="px-3 pb-2 md:px-5">{meta}</div>}

        {children && (
          <div className="px-3 pb-3 md:px-5">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
