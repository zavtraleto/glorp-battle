import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { SwipeRecognizer } from '../../core/input/swipe';
import { zoneAt, type TerminalLayout, type ZoneId } from '../layout';

// Pointer Events → terminal controls (TERMINAL.md §5). Each pointer captures
// the zone it went down in until it is lifted; a trackball gesture continues
// outside its zone. Action controls fire on press, in the same frame.

export interface RouterHandlers {
  /** A control was pressed (visual reaction, same frame). */
  press(zone: ZoneId): void;
  release(zone: ZoneId): void;
  /** One trackball step. */
  move(dir: Dir): void;
  /** Trackball drag delta in CSS px, for the rolling visual. */
  roll(dx: number, dy: number): void;
  /** Action controls fire on press. */
  action(zone: 'execute' | 'chipSelect' | 'pause'): void;
}

interface Capture {
  zone: ZoneId;
  lastX: number;
  lastY: number;
  swipe: SwipeRecognizer | null;
}

export class PointerRouter {
  private readonly captures = new Map<number, Capture>();

  constructor(
    private getLayout: () => TerminalLayout,
    private handlers: RouterHandlers,
  ) {}

  /** Returns true if a zone captured the pointer. */
  down(id: number, x: number, y: number): boolean {
    if (this.captures.has(id)) return true;
    const zone = zoneAt(this.getLayout(), x, y);
    if (!zone) return false;
    let swipe: SwipeRecognizer | null = null;
    if (zone === 'trackball') {
      swipe = new SwipeRecognizer(tuning.input.SWIPE_MIN_PX);
      swipe.begin(x, y);
    }
    this.captures.set(id, { zone, lastX: x, lastY: y, swipe });
    this.handlers.press(zone);
    if (zone !== 'trackball') this.handlers.action(zone);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const c = this.captures.get(id);
    if (!c?.swipe) return;
    this.handlers.roll(x - c.lastX, y - c.lastY);
    c.lastX = x;
    c.lastY = y;
    c.swipe.threshold = tuning.input.SWIPE_MIN_PX;
    const dir = c.swipe.move(x, y);
    if (dir) this.handlers.move(dir);
  }

  up(id: number): void {
    const c = this.captures.get(id);
    if (!c) return;
    this.captures.delete(id);
    c.swipe?.end();
    this.handlers.release(c.zone);
  }

  cancelAll(): void {
    for (const id of [...this.captures.keys()]) this.up(id);
  }

  /** Listens on `el` (coordinates relative to it); returns a detach function. */
  attach(el: HTMLElement): () => void {
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = local(e);
      if (!this.down(e.pointerId, x, y)) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // synthetic pointers cannot be captured; routing still works
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!this.captures.has(e.pointerId)) return;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length > 0 ? events : [e]) {
        const [x, y] = local(ce);
        this.move(e.pointerId, x, y);
      }
    };
    const onUp = (e: PointerEvent) => this.up(e.pointerId);
    const onBlur = () => this.cancelAll();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }
}
