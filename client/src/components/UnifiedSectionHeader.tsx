interface UnifiedSectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent: "cyan" | "violet";
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}

const accentMap = {
  cyan: {
    borderTop: "border-t-cyan-500",
    gradient: "from-cyan-500/5 via-cyan-500/8 to-transparent",
    iconBg: "bg-cyan-500/10",
  },
  violet: {
    borderTop: "border-t-violet-500",
    gradient: "from-violet-500/5 via-violet-500/8 to-transparent",
    iconBg: "bg-violet-500/10",
  },
} as const;

export function UnifiedSectionHeader({
  title,
  subtitle,
  icon,
  accent,
  actions,
  meta,
  children,
  testId,
}: UnifiedSectionHeaderProps) {
  const a = accentMap[accent];

  return (
    <div
      className={`mb-3 border-t-[3px] border-b-0 ${a.borderTop} rounded-t-lg bg-gradient-to-r ${a.gradient}`}
      data-testid={testId}
    >
      <div className="flex items-center justify-between px-0 py-3">
        <div className="flex items-center gap-3">
          {icon && (
            <div className={`h-10 w-10 rounded-lg ${a.iconBg} hidden sm:flex items-center justify-center shrink-0`}>
              {icon}
            </div>
          )}
          <div>
            <h2 className="text-xl font-serif font-bold">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {meta && <div className="px-0 pb-2">{meta}</div>}

      {children && <div className="px-0 pb-3 pr-2">{children}</div>}
    </div>
  );
}
