import type { Dir } from './commands';

// Swipe recognition for the trackball (spec §10.2). Pure logic, no DOM: fed with
// pointer positions and a clock in seconds.
// A direction fires when the finger travels `threshold` CSS px on the dominant
// axis; the stroke is then spent and pulling back never fires. With the finger
// held down, a new step comes from:
// - a rest (no travel beyond `restPx` for `rearmTime`), then `threshold` again;
// - a perpendicular turn, at once (an L-shaped drag gives two steps);
// - a second dash: `continueTime` after the step the same stroke may go on, and
//   `continuePx` more in the same direction fire again. A quick flick is over
//   by then, so it stays one panel (GDD §12).
// A gesture that ends without a step, inside `tapMaxTime`, is a tap — the
// trackball is also the chip trigger.

export type GestureEnd = 'step' | 'tap' | 'none';

export interface SwipeTiming {
  rearmTime: number;
  restPx: number;
  continueTime: number;
  continuePx: number;
}

const DEFAULT_TIMING: SwipeTiming = { rearmTime: 0.08, restPx: 4, continueTime: 0.1, continuePx: 60 };

function dominant(dx: number, dy: number): Dir {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

function horizontal(dir: Dir): boolean {
  return dir === 'left' || dir === 'right';
}

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private startedAt = 0;
  private active = false;
  private steps = 0;
  /** Direction of the spent stroke; null while a new stroke may fire. */
  private spent: Dir | null = null;
  private stepAt = 0;
  /** The anchor was moved to where the finger was at `continueTime`. */
  private continuing = false;
  /** Where and when the finger last travelled more than `restPx`. */
  private restX = 0;
  private restY = 0;
  private restAt = 0;

  constructor(
    public threshold: number,
    public tapMaxTime: number,
    public timing: SwipeTiming = DEFAULT_TIMING,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number, now: number): void {
    this.active = true;
    this.steps = 0;
    this.spent = null;
    this.continuing = false;
    this.anchorX = this.restX = x;
    this.anchorY = this.restY = y;
    this.startedAt = this.restAt = now;
  }

  /** Returns a direction when a stroke crosses the threshold, otherwise null. */
  move(x: number, y: number, now = this.startedAt): Dir | null {
    if (!this.active) return null;
    const t = this.timing;

    // A resting finger sends no events: the rest is noticed on the next move.
    if (this.spent && now - this.restAt >= t.rearmTime) {
      this.spent = null;
      this.anchorX = this.restX;
      this.anchorY = this.restY;
    }
    if (Math.hypot(x - this.restX, y - this.restY) > t.restPx) {
      this.restX = x;
      this.restY = y;
      this.restAt = now;
    }
    if (this.spent && !this.continuing && now - this.stepAt >= t.continueTime) {
      this.continuing = true;
      this.anchorX = x;
      this.anchorY = y;
    }

    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    const far = Math.max(Math.abs(dx), Math.abs(dy));
    if (far < this.threshold) return null;
    const dir = dominant(dx, dy);
    if (!this.spent || horizontal(dir) !== horizontal(this.spent)) return this.fire(dir, x, y, now);
    if (dir !== this.spent || !this.continuing) {
      // The spent stroke goes on or pulls back: follow the finger, no step.
      this.anchorX = x;
      this.anchorY = y;
      return null;
    }
    // Second dash: the stroke went on past `continueTime`.
    return far >= t.continuePx ? this.fire(dir, x, y, now) : null;
  }

  private fire(dir: Dir, x: number, y: number, now: number): Dir {
    this.steps++;
    this.spent = dir;
    this.stepAt = now;
    this.continuing = false;
    this.anchorX = x;
    this.anchorY = y;
    return dir;
  }

  /** Ends the gesture and classifies it. A long rest is neither a step nor a tap. */
  end(now: number): GestureEnd {
    const wasActive = this.active;
    const stepped = this.steps > 0;
    const held = now - this.startedAt;
    this.active = false;
    this.steps = 0;
    this.spent = null;
    this.continuing = false;
    if (!wasActive) return 'none';
    if (stepped) return 'step';
    return held <= this.tapMaxTime ? 'tap' : 'none';
  }
}
