import { useCallback, useRef } from 'react';

interface SplitterProps {
  readonly direction: 'vertical' | 'horizontal';
  /** Called with the pointer delta (px) since drag start. */
  readonly onDrag: (delta: number) => void;
  readonly onDragEnd?: () => void;
  readonly onDoubleClick?: () => void;
}

/**
 * A thin draggable divider. `vertical` splits left/right (drag along x);
 * `horizontal` splits top/bottom (drag along y).
 */
export function Splitter({ direction, onDrag, onDragEnd, onDoubleClick }: SplitterProps) {
  const start = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    start.current = direction === 'vertical' ? e.clientX : e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      if (start.current === null) return;
      onDrag((direction === 'vertical' ? ev.clientX : ev.clientY) - start.current);
    };
    const up = () => {
      start.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      onDragEnd?.();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }, [direction, onDrag, onDragEnd]);

  return (
    <div
      className={`splitter splitter-${direction}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={direction}
      title="Drag to resize · double-click to reset"
    />
  );
}
