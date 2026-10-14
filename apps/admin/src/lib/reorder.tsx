/**
 * Drag to reorder a list (computer), with ↑ ↓ buttons for phones: the home page sections, the
 * links of the bio page… `onChange` receives the list in its new order.
 */
import { useRef, useState, type DragEvent } from "react";
import { tr } from "../i18n";

export function useReorder<T>(items: readonly T[], onChange: (next: T[]) => void) {
  const from = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (a: number, b: number) => {
    if (b < 0 || b >= items.length || a === b) return;
    const list = [...items];
    const [item] = list.splice(a, 1);
    list.splice(b, 0, item!);
    onChange(list);
  };
  /** spread on each <li>: dragging, and the highlight of the place it would land */
  const rowProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      from.current = i;
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(i);
    },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (from.current != null) move(from.current, i);
      from.current = null;
      setOver(null);
    },
    onDragEnd: () => setOver(null),
  });
  return { move, rowProps, over };
}

/** The grip and the ↑ ↓ buttons of one row. */
export function ReorderControls({ i, count, move }: { i: number; count: number; move: (a: number, b: number) => void }) {
  return (
    <>
      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-sm disabled:opacity-30" aria-label={tr("Monter")}>
        ↑
      </button>
      <button type="button" onClick={() => move(i, i + 1)} disabled={i === count - 1} className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-sm disabled:opacity-30" aria-label={tr("Descendre")}>
        ↓
      </button>
    </>
  );
}

export const Grip = () => (
  <span className="cursor-grab select-none px-1 text-lg text-ink-soft" aria-hidden="true">
    ⠿
  </span>
);
