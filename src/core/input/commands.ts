// Abstract input (GDD §12.3). Devices write here; the simulation reads it once per tick.

export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_VECTORS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export type Command =
  | { type: 'move'; dir: Dir }
  | { type: 'busterDown' }
  | { type: 'busterUp' }
  | { type: 'useChip' }
  | { type: 'openCustom' }
  | { type: 'pause' };

type HoldSource = 'keyboard' | 'swipe';

export class InputState {
  private queue: Command[] = [];
  private held = new Map<HoldSource, Dir>();
  private lastHeldSource: HoldSource | null = null;

  push(cmd: Command): void {
    // Bound the queue so a stalled simulation never accumulates stale input.
    if (this.queue.length >= 16) this.queue.shift();
    this.queue.push(cmd);
  }

  /** Sets or clears the direction a device is currently holding. */
  setHeld(source: HoldSource, dir: Dir | null): void {
    if (dir) {
      this.held.set(source, dir);
      this.lastHeldSource = source;
    } else {
      this.held.delete(source);
      if (this.lastHeldSource === source) this.lastHeldSource = null;
    }
  }

  /** Direction currently held, preferring the most recently updated device. */
  get heldDir(): Dir | null {
    if (this.lastHeldSource) return this.held.get(this.lastHeldSource) ?? null;
    for (const d of this.held.values()) return d;
    return null;
  }

  drain(): Command[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear(): void {
    this.queue = [];
    this.held.clear();
    this.lastHeldSource = null;
  }
}
