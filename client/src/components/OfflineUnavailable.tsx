import { Button } from "@/components/ui/button";
import { offlineNoticeCopy, type OfflineNoticeKind } from "@/lib/networkStatus";

export function OfflineUnavailable({
  kind,
  onRetry,
}: {
  kind: OfflineNoticeKind;
  onRetry?: () => void;
}) {
  const copy = offlineNoticeCopy(kind);
  return (
    <div className="min-h-screen flex items-center justify-center px-6" data-testid="offline-unavailable">
      <div className="text-center max-w-sm">
        <p className="text-xl text-muted-foreground">{copy.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{copy.detail}</p>
        {onRetry ? (
          <Button className="mt-4" onClick={onRetry} data-testid="button-offline-retry">
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Section-level stand-in so a paused list does not read as "nothing here". */
export function OfflineInlineNotice({
  kind,
  onRetry,
}: {
  kind: OfflineNoticeKind;
  onRetry?: () => void;
}) {
  const copy = offlineNoticeCopy(kind);
  return (
    <div className="text-center py-8 text-muted-foreground" data-testid="offline-inline-notice">
      <p className="text-sm font-medium text-foreground">{copy.title}</p>
      <p className="mt-1 text-sm">{copy.detail}</p>
      {onRetry ? (
        <Button
          className="mt-4"
          variant="outline"
          size="sm"
          onClick={onRetry}
          data-testid="button-offline-retry"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
