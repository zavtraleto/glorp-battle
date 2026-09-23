import { tuning } from '../../config/tuning';
import type { Dir } from '../../core/input/commands';
import { SwipeRecognizer } from '../../core/input/swipe';
import type { ZoneId } from '../layout';
import { attachPointers } from './pointerEvents';

// Pointer Events → terminal controls (spec §10.2). Each pointer captures the
// zone it went down in until it is lifted; a trackball gesture continues
// outside its zone. The pause key fires on press, in the same frame. The
// trackball moves as soon as a swipe crosses the threshold; on release it is
// known whether a gesture without movement was a tap.

export interface RouterHandlers {
  /** A control was pressed (visual reaction, same frame). */
  press(zone: ZoneId): void;
  release(zone: ZoneId): void;
  /** One trackball step. */
  move(dir: Dir): void;
  /** Direction held by an active trackball gesture; null on release/cancel. */
  hold?(dir: Dir | null): void;
  /** Trackball drag delta in CSS px, for the rolling visual. */
  roll(dx: number, dy: number): void;
  /**
   * The pause key and the chip rail on press; the trackball on release, when
   * the gesture was a tap. `x`, `y` are where the pointer went down, so a zone
   * split into parts (the rail's slots) can tell which part was hit.
   */
  action(zone: ZoneId, x: number, y: number): void;
  /** Mouse hover (no button held): the zone under the pointer, and the pointer position. */
  hover?(zone: ZoneId | null, x: number, y: number): void;
  /** Presses on zones that return false are ignored (not captured). */
  accepts?(zone: ZoneId): boolean;
}

interface Capture {
  zone: ZoneId;
  downX: number;
  downY: number;
  lastX: number;
  lastY: number;
  swipe: SwipeRecognizer | null;
  heldDir: Dir | null;
  heldOrder: number;
}

export class PointerRouter {
  private readonly captures = new Map<number, Capture>();
  private heldOrder = 0;

  constructor(
    /** Screen point → organ. The terminal projects tilted zones through the camera. */
    private zoneAt: (x: number, y: number) => ZoneId | null,
    private handlers: RouterHandlers,
    private now: () => number = () => performance.now() / 1000,
  ) {}

  /** Returns true if a zone captured the pointer. */
  down(id: number, x: number, y: number): boolean {
    if (this.captures.has(id)) return true;
    const zone = this.zoneAt(x, y);
    if (!zone || this.handlers.accepts?.(zone) === false) return false;
    let swipe: SwipeRecognizer | null = null;
    if (zone === 'trackball') {
      swipe = new SwipeRecognizer(tuning.input.SWIPE_MIN_PX, tuning.terminal.TAP_MAX_TIME);
      swipe.begin(x, y, this.now());
    }
    this.captures.set(id, { zone, downX: x, downY: y, lastX: x, lastY: y, swipe, heldDir: null, heldOrder: 0 });
    this.handlers.press(zone);
    if (zone !== 'trackball') this.handlers.action(zone, x, y);
    return true;
  }

  move(id: number, x: number, y: number): void {
    const c = this.captures.get(id);
    if (!c?.swipe) return;
    this.handlers.roll(x - c.lastX, y - c.lastY);
    c.lastX = x;
    c.lastY = y;
    c.swipe.threshold = tuning.input.SWIPE_MIN_PX;
    const dir = c.swipe.move(x, y, this.now());
    if (dir) {
      c.heldDir = dir;
      c.heldOrder = ++this.heldOrder;
      this.handlers.move(dir);
      this.syncHold();
    }
  }

  /** Reports the zone under a free (not captured) mouse pointer. */
  hoverAt(x: number, y: number): void {
    this.handlers.hover?.(this.zoneAt(x, y), x, y);
  }

  get anyCaptured(): boolean {
    return this.captures.size > 0;
  }

  up(id: number): void {
    const c = this.captures.get(id);
    if (!c) return;
    this.captures.delete(id);
    if (c.swipe?.end(this.now()) === 'tap') this.handlers.action(c.zone, c.downX, c.downY);
    if (c.heldDir) this.syncHold();
    this.handlers.release(c.zone);
  }

  private syncHold(): void {
    let latest: Capture | null = null;
    for (const capture of this.captures.values()) {
      if (capture.heldDir && (!latest || capture.heldOrder > latest.heldOrder)) latest = capture;
    }
    this.handlers.hold?.(latest?.heldDir ?? null);
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
