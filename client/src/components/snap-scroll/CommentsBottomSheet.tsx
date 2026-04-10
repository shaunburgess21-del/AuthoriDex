import { Drawer } from "vaul";
import { X } from "lucide-react";
import { CardComments, type CommentEntityType } from "@/components/comments/CardComments";

interface CommentsBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: CommentEntityType;
  slug: string;
}

export function CommentsBottomSheet({
  open,
  onOpenChange,
  entityType,
  slug,
}: CommentsBottomSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[0.5, 1]}
      activeSnapPoint={open ? 0.5 : undefined}
      modal={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[60] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[100dvh]">
          <div className="mx-auto mt-3 mb-2 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-4 pb-2">
            <Drawer.Title className="text-sm font-semibold text-muted-foreground">Discussion</Drawer.Title>
            <button type="button" onClick={() => onOpenChange(false)} className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
            {slug && (
              <CardComments
                entityType={entityType}
                slug={slug}
                variant="inline"
                maxHeight="none"
                placeholder="Add a comment..."
              />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
