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
    shellBg:
      "bg-[linear-gradient(to_bottom,rgba(0,200,200,0.08)_0%,transparent_75%)]",
    iconBg: "bg-cyan-500/10",
  },
  violet: {
    borderTop: "border-t-violet-500",
    shellBg:
      "bg-[linear-gradient(to_bottom,rgba(139,92,246,0.08)_0%,transparent_75%)]",
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
    <div className="px-1.5 md:px-0">
      <div
        className={`mb-3 border-t-[3px] border-b-0 ${a.borderTop} rounded-t-lg ${a.shellBg}`}
        data-testid={testId}
      >
        <div className="flex items-center justify-between pl-3 pr-3 py-3 md:pl-0 md:pr-0">
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

        {meta && <div className="pl-3 pr-3 pb-2 md:pl-0 md:pr-0">{meta}</div>}

        {children && (
          <div className="pl-3 pr-3 pb-1 md:pb-3 md:pl-0 md:pr-0">{children}</div>
        )}
      </div>
    </div>
  );
}
