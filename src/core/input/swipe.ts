import type { Dir } from './commands';

// Swipe recognition for the trackball (spec §10.2). Pure logic, no DOM: fed with
// pointer positions and a clock in seconds.
// A direction fires as soon as the finger travels `threshold` CSS px on the
// dominant axis. Each accepted step rebases the anchor at the current pointer,
// so another step requires another intentional displacement. A gesture that
// ends without a step, inside `tapMaxTime`, is a tap — the trackball is also
// the chip trigger.

export type GestureEnd = 'step' | 'tap' | 'none';

function dominant(dx: number, dy: number): Dir {
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

export class SwipeRecognizer {
  private anchorX = 0;
  private anchorY = 0;
  private startedAt = 0;
  private active = false;
  private steps = 0;

  constructor(
    public threshold: number,
    public tapMaxTime: number,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  begin(x: number, y: number, now: number): void {
    this.active = true;
    this.steps = 0;
    this.anchorX = x;
    this.anchorY = y;
    this.startedAt = now;
  }

  /** Returns a direction when a stroke crosses the threshold, otherwise null. */
  move(x: number, y: number, _now = this.startedAt): Dir | null {
    if (!this.active) return null;

    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    const far = Math.max(Math.abs(dx), Math.abs(dy)) >= this.threshold;
    return far ? this.fire(dominant(dx, dy), x, y) : null;
  }

  private fire(dir: Dir, x: number, y: number): Dir {
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
    this.steps = 0;
    if (!wasActive) return 'none';
    if (stepped) return 'step';
    return held <= this.tapMaxTime ? 'tap' : 'none';
  }
}
