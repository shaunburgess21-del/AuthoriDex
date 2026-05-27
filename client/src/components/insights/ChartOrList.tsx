import type { ReactNode } from "react";

interface ChartOrListProps {
  chart: ReactNode;
  list: ReactNode;
  /** Use list below this breakpoint (Tailwind md = 768px) */
  listBelowMd?: boolean;
}

export function ChartOrList({ chart, list, listBelowMd = true }: ChartOrListProps) {
  if (listBelowMd) {
    return (
      <>
        <div className="hidden md:block">{chart}</div>
        <div className="md:hidden">{list}</div>
      </>
    );
  }
  return chart;
}
