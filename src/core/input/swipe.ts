import type { Dir } from './commands';

// Swipe recognition for the trackball (spec §10.2). Pure logic, no DOM: fed with
// pointer positions and a clock in seconds.
// One stroke = one step [decision 2026-09-19]: the direction fires as soon as
// the finger travels `threshold` px (dominant axis). Keeping on in the same
// direction does nothing more; the finger stays down and makes a new stroke
// either after resting for `rearmTime` or by heading off in another direction
// for `threshold` px. A gesture that ends without a step, inside `tapMaxTime`,
// is a tap — the trackball is also the chip trigger.

export type GestureEnd = 'step' | 'tap' | 'none';

/** Movement below this many px between samples counts as the finger resting. */
const REST_PX = 2;

function dominant(dx: number, dy: number): Dir {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private lastX = 0;
  private lastY = 0;
  /** When the finger last really moved. */
  private movedAt = 0;
  private startedAt = 0;
  private active = false;
  /** Direction of the current stroke's step, or null while the gesture is armed. */
  private stroke: Dir | null = null;
  private steps = 0;

  constructor(
    public threshold: number,
    public tapMaxTime: number,
    public rearmTime = Infinity,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number, now: number): void {
    this.active = true;
    this.stroke = null;
    this.steps = 0;
    this.anchorX = this.lastX = x;
    this.anchorY = this.lastY = y;
    this.startedAt = this.movedAt = now;
  }

  /** Returns a direction when a stroke crosses the threshold, otherwise null. */
  move(x: number, y: number, now = this.movedAt): Dir | null {
    if (!this.active) return null;
    // A rest re-arms the gesture from where the finger stopped.
    if (this.stroke && now - this.movedAt >= this.rearmTime) {
      this.stroke = null;
      this.anchorX = this.lastX;
      this.anchorY = this.lastY;
    }
    if (Math.hypot(x - this.lastX, y - this.lastY) >= REST_PX) this.movedAt = now;
    this.lastX = x;
    this.lastY = y;

    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    const far = Math.max(Math.abs(dx), Math.abs(dy)) >= this.threshold;
    const dir = dominant(dx, dy);
    if (this.stroke === null) {
      if (!far) return null;
      return this.fire(dir, x, y);
    }
    // Carrying on in the stroke's direction: the anchor follows the finger, so
    // turning back is measured from where it turned.
    if (dir === this.stroke) {
      this.anchorX = x;
      this.anchorY = y;
      return null;
    }
    return far ? this.fire(dir, x, y) : null;
  }

  private fire(dir: Dir, x: number, y: number): Dir {
    this.stroke = dir;
    this.steps++;
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
    this.stroke = null;
    this.steps = 0;
    if (!wasActive) return 'none';
    if (stepped) return 'step';
    return held <= this.tapMaxTime ? 'tap' : 'none';
  }
}
