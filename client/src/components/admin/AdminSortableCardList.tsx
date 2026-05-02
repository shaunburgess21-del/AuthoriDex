import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export type AdminSortableRenderCtx = { dragHandle: ReactNode | null };

type Props<T extends { id: string }> = {
  items: T[];
  disabled?: boolean;
  disabledReason?: string;
  onReorder: (orderedIds: string[]) => Promise<void>;
  className?: string;
  listClassName?: string;
  renderItem: (item: T, ctx: AdminSortableRenderCtx) => ReactNode;
};

function DragHandle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted shrink-0 active:cursor-grabbing"
      aria-label="Drag to reorder"
      {...props}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

function SortableItemRow<T extends { id: string }>({
  item,
  disabled,
  renderItem,
}: {
  item: T;
  disabled?: boolean;
  renderItem: Props<T>["renderItem"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
    position: "relative" as const,
  };
  const dragHandle = disabled ? null : <DragHandle {...attributes} {...listeners} />;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-90 shadow-md ring-1 ring-border rounded-lg" : undefined}
    >
      {renderItem(item, { dragHandle })}
    </div>
  );
}

export function AdminSortableCardList<T extends { id: string }>({
  items,
  disabled,
  disabledReason,
  onReorder,
  className,
  listClassName,
  renderItem,
}: Props<T>) {
  const idKey = useMemo(() => items.map((i) => i.id).join("|"), [items]);
  const [ids, setIds] = useState<string[]>(() => items.map((i) => i.id));

  useEffect(() => {
    setIds(items.map((i) => i.id));
  }, [idKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items]);

  async function handleDragEnd(event: DragEndEvent) {
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const previousIds = [...ids];
    const next = arrayMove(ids, oldIndex, newIndex);
    setIds(next);
    try {
      await onReorder(next);
    } catch {
      setIds(previousIds);
    }
  }

  if (disabled) {
    return (
      <div className={className}>
        {disabledReason ? <p className="text-xs text-muted-foreground mb-2">{disabledReason}</p> : null}
        <div className={listClassName ?? "space-y-3"}>
          {items.map((item) => (
            <div key={item.id}>{renderItem(item, { dragHandle: null })}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className={listClassName ?? "space-y-3"}>
            {ids.map((id) => {
              const item = byId.get(id);
              if (!item) return null;
              return <SortableItemRow key={id} item={item} disabled={false} renderItem={renderItem} />;
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
