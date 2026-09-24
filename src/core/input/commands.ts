// Abstract input (GDD §12.1). Devices write here; the simulation reads it once per tick.

export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIR_VECTORS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export type Command =
  | { type: 'move'; dir: Dir }
  | { type: 'useChip' }
  /** Tap on a hand slot: build or unbuild the Attack Queue (GDD §7.2). */
  | { type: 'selectChip'; slot: number };

export class InputState {
  private queue: Command[] = [];
  private held: Dir | null = null;

  push(cmd: Command): void {
    // Bound the queue so a stalled simulation never accumulates stale input.
    if (this.queue.length >= 16) this.queue.shift();
    this.queue.push(cmd);
  }

  setHeld(dir: Dir | null): void {
    this.held = dir;
  }

  get heldDir(): Dir | null {
    return this.held;
  }

  drain(): Command[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  clear(): void {
    this.queue = [];
    this.held = null;
  }
}
