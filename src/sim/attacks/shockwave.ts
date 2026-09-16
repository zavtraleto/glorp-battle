import { secondsToTicks, tuning } from '../../config/tuning';
import { ROWS } from '../grid';
import type { Attack, AttackContext } from './attack';

// Mettik ground wave (GDD §8.2, §8.5): starts in front of the Mettik and
// travels down its lane one cell per MET_WAVE_STEP, piercing through.

export class Shockwave implements Attack {
  readonly kind = 'shockwave';
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly damage: number;

  constructor(
    readonly id: number,
    readonly x: number,
    public y: number,
    spawnTick: number,
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, secondsToTicks(tuning.mettik.MET_WAVE_STEP));
    this.damage = tuning.mettik.MET_DMG;
  }

  update(ctx: AttackContext): void {
    if (this.done) return;
    if (ctx.tick - this.lastStepTick >= this.stepTicks) {
      this.y++;
      this.lastStepTick = ctx.tick;
      if (this.y >= ROWS) {
        this.done = true;
        return;
      }
    }
    ctx.hitPlayerAt(this, this.x, this.y, this.damage);
  }
}
