import type { Side } from './grid';
import type { TimeDomain } from './field';

// Objects on the field (roguelite spec §3.4): take a cell, stop shots and
// waves, break at 0 HP. No AI.

export type ObjectKind = 'rock' | 'block';

export class FieldObject {
  constructor(
    readonly id: number,
    readonly kind: ObjectKind,
    readonly x: number,
    readonly y: number,
    readonly side: Side,
    public hp: number,
    readonly expiresAt = Infinity,
    readonly timeDomain: TimeDomain = 'world',
  ) {}

  get alive(): boolean {
    return this.hp > 0;
  }
}
