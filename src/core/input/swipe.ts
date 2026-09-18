import type { Dir } from './commands';

// Swipe recognition for the trackball (spec §10.2). Pure logic, no DOM: fed with
// pointer positions and a clock in seconds.
// One gesture = one step: the direction fires as soon as the finger travels
// `threshold` px (dominant axis), and the rest of the gesture is ignored until
// the finger is lifted. A gesture that ends without a step, inside `tapMaxTime`,
// is a tap — the trackball is also the chip trigger.

export type GestureEnd = 'step' | 'tap' | 'none';

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private startedAt = 0;
  private active = false;
  private fired = false;

  constructor(
    public threshold: number,
    public tapMaxTime: number,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number, now: number): void {
    this.active = true;
    this.fired = false;
    this.anchorX = x;
    this.anchorY = y;
    this.startedAt = now;
  }

  /** Returns a direction the first time the movement crosses the threshold, then null. */
  move(x: number, y: number): Dir | null {
    if (!this.active || this.fired) return null;
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < this.threshold) return null;
    this.fired = true;
    return ax >= ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  /** Ends the gesture and classifies it. A long rest is neither a step nor a tap. */
  end(now: number): GestureEnd {
    const wasActive = this.active;
    const fired = this.fired;
    const held = now - this.startedAt;
    this.active = false;
    this.fired = false;
    if (!wasActive) return 'none';
    if (fired) return 'step';
    return held <= this.tapMaxTime ? 'tap' : 'none';
  }
}
