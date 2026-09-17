import type { Dir } from './commands';

// Swipe recognition (GDD §12.1). Pure logic, no DOM: fed with pointer positions.
// One gesture = one step: the direction fires as soon as the finger travels
// `threshold` px (dominant axis), and the rest of the gesture is ignored until
// the finger is lifted.

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private active = false;
  private fired = false;

  constructor(public threshold: number) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number): void {
    this.active = true;
    this.fired = false;
    this.anchorX = x;
    this.anchorY = y;
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

  end(): void {
    this.active = false;
    this.fired = false;
  }
}
