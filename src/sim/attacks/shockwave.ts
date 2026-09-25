import { secondsToTicks, tuning } from '../../config/tuning';
import { ROWS } from '../grid';
import type { Attack, AttackContext } from './attack';

/** An attack that walks along a lane one panel per `stepTicks` (render interpolation uses this). */
export interface LaneMover extends Attack {
  readonly x: number;
  y: number;
  lastStepTick: number;
  readonly stepTicks: number;
  /** +1 moves toward the player's side, −1 toward the enemy's. */
  readonly dir: 1 | -1;
}

export interface WaveOptions {
  dir: 1 | -1;
  damage: number;
  stepTicks: number;
}

function mettikWave(): WaveOptions {
  return {
    dir: 1,
    damage: tuning.mettik.MET_DMG,
    stepTicks: Math.max(1, secondsToTicks(tuning.projectile.CELL_TRAVEL_TIME)),
  };
}

/**
 * Mettik's ground wave (GDD §8.2): travels one
 * panel per step, pierces its targets, stops at the field edge, a hole (its spawn
 * cell included) or an object.
 */
export class Shockwave implements LaneMover {
  readonly kind = 'shockwave';
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly damage: number;
  readonly dir: 1 | -1;

  constructor(
    readonly id: number,
    readonly x: number,
    public y: number,
    spawnTick: number,
    opts: WaveOptions = mettikWave(),
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, opts.stepTicks);
    this.damage = opts.damage;
    this.dir = opts.dir;
  }

  update(ctx: AttackContext, tick = ctx.tick): void {
    if (this.done) return;
    if (tick - this.lastStepTick >= this.stepTicks) {
      this.y += this.dir;
      this.lastStepTick = tick;
      if (this.y < 0 || this.y >= ROWS) {
        this.done = true;
        return;
      }
    }
    // Waves need a floor (roguelite spec §3.2), the spawn cell included.
    if (ctx.field.panel(this.x, this.y) === 'BROKEN') {
      this.done = true;
      return;
    }
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage)) {
      this.done = true;
      return;
    }
    ctx.hitPlayerAt(this, this.x, this.y, this.damage);
  }
}
