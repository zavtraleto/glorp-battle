import type { Cell } from '../grid';
import type { Attack, AttackContext } from './attack';

// Lobbed enemy attack (roguelite spec §5.2–5.3): Helmhead's cannonball and
// Monolith's falling rocks. It lands on its cells after a flight, hits the
// player there and cracks or breaks the panels.

export interface ArcOptions {
  damage: number;
  flightTicks: number;
  panel: 'crack' | 'break';
}

export class CannonBall implements Attack {
  readonly hitIds = new Set<number>();
  done = false;
  readonly landTick: number;

  constructor(
    readonly id: number,
    readonly kind: 'cannonball' | 'rockfall',
    readonly fromX: number,
    readonly fromY: number,
    readonly cells: readonly Cell[],
    readonly throwTick: number,
    private readonly opts: ArcOptions,
  ) {
    this.landTick = throwTick + Math.max(1, opts.flightTicks);
  }

  /** Flight progress in [0, 1]. */
  progress(tick: number, alpha = 0): number {
    return Math.min(1, Math.max(0, (tick - this.throwTick + alpha) / (this.landTick - this.throwTick)));
  }

  update(ctx: AttackContext): void {
    if (this.done || ctx.tick < this.landTick) return;
    this.done = true;
    for (const c of this.cells) {
      if (!ctx.hitObjectAt(this, c.x, c.y, this.opts.damage)) ctx.hitPlayerAt(this, c.x, c.y, this.opts.damage);
      if (this.opts.panel === 'crack') ctx.field.crack(c.x, c.y);
      else ctx.field.breakPanel(c.x, c.y, ctx.tick, !ctx.occupancy.isFree(c.x, c.y));
    }
    ctx.emit({ type: 'explosion', cells: [...this.cells] });
  }
}
