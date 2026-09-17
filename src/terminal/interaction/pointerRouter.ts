import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { SwipeRecognizer } from '../../core/input/swipe';
import { zoneAt, type TerminalLayout, type ZoneId } from '../layout';
import { attachPointers } from './pointerEvents';

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
  /** Mouse hover (no button held): the zone under the pointer, and the pointer position. */
  hover?(zone: ZoneId | null, x: number, y: number): void;
  /** Presses on zones that return false are ignored (not captured). */
  accepts?(zone: ZoneId): boolean;
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
    if (!zone || this.handlers.accepts?.(zone) === false) return false;
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

  /** Reports the zone under a free (not captured) mouse pointer. */
  hoverAt(x: number, y: number): void {
    this.handlers.hover?.(zoneAt(this.getLayout(), x, y), x, y);
  }

  get anyCaptured(): boolean {
    return this.captures.size > 0;
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

  isCaptured(id: number): boolean {
    return this.captures.has(id);
  }

  /** Listens on `el` (coordinates relative to it); returns a detach function. */
  attach(el: HTMLElement): () => void {
    return attachPointers(el, {
      down: (id, x, y) => this.down(id, x, y),
      move: (id, x, y) => this.move(id, x, y),
      up: (id) => this.up(id),
      cancelAll: () => this.cancelAll(),
      isCaptured: (id) => this.isCaptured(id),
      hover: (x, y) => (x < 0 ? this.handlers.hover?.(null, -1, -1) : this.hoverAt(x, y)),
    });
  }
}
