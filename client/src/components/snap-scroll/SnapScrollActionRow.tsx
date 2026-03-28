import { MessageCircle, ExternalLink, Share2 } from "lucide-react";

interface SnapScrollActionRowProps {
  onComments: () => void;
  onDetail: () => void;
  onShare: () => void;
  commentCount?: number;
}

export function SnapScrollActionRow({
  onComments,
  onDetail,
  onShare,
  commentCount,
}: SnapScrollActionRowProps) {
  return (
    <div className="flex items-center justify-center gap-8 py-3 px-4">
      <button
        onClick={onComments}
        className="flex flex-col items-center gap-1 text-muted-foreground hover:text-cyan-400 transition-colors"
        data-interactive="true"
      >
        <MessageCircle className="h-5 w-5" />
        {commentCount !== undefined && commentCount > 0 && (
          <span className="text-[10px] font-mono leading-none">{commentCount}</span>
        )}
      </button>
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
