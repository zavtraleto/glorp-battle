// DOM Pointer Events → a pointer sink in element-local CSS px (TERMINAL.md §8.1).

export interface PointerSink {
  /** Returns true if the pointer was captured. */
  down(id: number, x: number, y: number): boolean;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number): void;
  cancelAll(): void;
  isCaptured(id: number): boolean;
  /** A free mouse pointer moved (x, y = -1 when it left the element). */
  hover?(x: number, y: number): void;
}

export function attachPointers(el: HTMLElement, sink: PointerSink): () => void {
  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onDown = (e: PointerEvent) => {
    const [x, y] = local(e);
    if (!sink.down(e.pointerId, x, y)) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers cannot be captured; routing still works
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!sink.isCaptured(e.pointerId)) {
      if (e.pointerType === 'mouse') sink.hover?.(...local(e));
      return;
    }
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ce of events.length > 0 ? events : [e]) sink.move(e.pointerId, ...local(ce));
  };
  const onUp = (e: PointerEvent) => sink.up(e.pointerId, ...local(e));
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && !sink.isCaptured(e.pointerId)) sink.hover?.(-1, -1);
  };
  const onBlur = () => sink.cancelAll();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onBlur);
  el.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onBlur);
    el.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onBlur);
  };
}
