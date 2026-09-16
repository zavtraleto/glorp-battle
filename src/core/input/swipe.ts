import type { Dir } from './commands';

// Swipe recognition (GDD §12.1). Pure logic, no DOM: fed with pointer positions.
// A step fires as soon as the finger travels `threshold` px from the anchor;
// the anchor then moves to the current point, so one continuous gesture can
// produce several steps (e.g. right, then up).

export interface SwipeResult {
  dir: Dir;
}

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private active = false;
  /** Direction of the last step in the current gesture (used for hold-to-repeat). */
  lastDir: Dir | null = null;

  constructor(public threshold: number) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number): void {
    this.active = true;
    this.anchorX = x;
    this.anchorY = y;
    this.lastDir = null;
  }

  /** Returns a direction when the movement since the anchor crosses the threshold. */
  move(x: number, y: number): Dir | null {
    if (!this.active) return null;
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < this.threshold) return null;
    const dir: Dir = ax >= ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    this.anchorX = x;
    this.anchorY = y;
    this.lastDir = dir;
    return dir;
  }

  end(): void {
    this.active = false;
    this.lastDir = null;
  }
}
