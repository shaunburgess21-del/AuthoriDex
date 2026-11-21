interface UnifiedSectionHeaderProps {
  title: string;
  /** Extra classes on the heading. Used for a layout-neutral highlight. */
  titleClassName?: string;
  titleAddon?: React.ReactNode;
  subtitle?: string;
  subtitleMeta?: React.ReactNode;
  icon?: React.ReactNode;
  accent: "cyan" | "violet" | "blue";
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /**
   * Painted on top of the header row. Callers must position it absolutely
   * so the row's height stays the same.
   */
  overlay?: React.ReactNode;
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
  titleClassName,
  titleAddon,
  subtitle,
  subtitleMeta,
  icon,
  accent,
  actions,
  meta,
  overlay,
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
        <div className="relative flex items-center justify-between px-3 py-3 md:px-5">
          <div className="flex items-center gap-3">
            {icon && (
              <div className={`h-10 w-10 rounded-lg ${a.iconBg} hidden sm:flex items-center justify-center shrink-0`}>
                {icon}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className={titleClassName ? `text-xl font-serif font-bold ${titleClassName}` : "text-xl font-serif font-bold"}>{title}</h2>
                {titleAddon}
              </div>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
              {subtitleMeta && <div>{subtitleMeta}</div>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
          {overlay}
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
