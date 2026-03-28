import { ExternalLink, Share2 } from "lucide-react";

interface SnapScrollActionRowProps {
  onDetail: () => void;
  onShare: () => void;
}

export function SnapScrollActionRow({
  onDetail,
  onShare,
}: SnapScrollActionRowProps) {
  return (
    <div className="flex items-center justify-center gap-8 py-3 px-4">
      <button
        onClick={onDetail}
        className="flex flex-col items-center gap-1 text-muted-foreground hover:text-cyan-400 transition-colors"
        data-interactive="true"
      >
        <ExternalLink className="h-5 w-5" />
      </button>
      <button
        onClick={onShare}
        className="flex flex-col items-center gap-1 text-muted-foreground hover:text-cyan-400 transition-colors"
        data-interactive="true"
      >
        <Share2 className="h-5 w-5" />
      </button>
    </div>
  );
}
