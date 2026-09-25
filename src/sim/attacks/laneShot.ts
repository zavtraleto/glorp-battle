import { ROWS } from '../grid';
import type { AttackContext } from './attack';
import type { LaneMover } from './shockwave';

// Hopzap's ZapRing flies down a lane, over holes, stopping on objects and the first hit.

export interface LaneShotOptions {
  damage: number;
  stepTicks: number;
  /** Player paralysis on hit, in ticks (0 = none). */
  paralyze?: number;
}

export class LaneShot implements LaneMover {
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly dir = 1 as const;
  private readonly damage: number;
  private readonly paralyze: number;

  constructor(
    readonly id: number,
    readonly kind: 'zapring' | 'dash',
    readonly x: number,
    public y: number,
    spawnTick: number,
    opts: LaneShotOptions,
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, opts.stepTicks);
    this.damage = opts.damage;
    this.paralyze = opts.paralyze ?? 0;
  }

  update(ctx: AttackContext, tick = ctx.tick): void {
    if (this.done) return;
    if (tick - this.lastStepTick >= this.stepTicks) {
      this.y++;
      this.lastStepTick = tick;
      if (this.y >= ROWS) {
        this.done = true;
        return;
      }
    }
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage)) {
      this.done = true;
      return;
    }
    if (ctx.hitPlayerAt(this, this.x, this.y, this.damage)) {
      if (this.paralyze > 0) ctx.paralyzePlayer(this.paralyze);
      this.done = true;
    }
  }
}
