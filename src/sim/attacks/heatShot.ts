import { secondsToTicks, tuning } from '../../config/tuning';
import { ROWS, inField, type Cell } from '../grid';
import type { AttackContext } from './attack';
import type { LaneMover } from './shockwave';

// Spiker fireball (GDD §8.4, §8.5): travels down the lane one panel per
// SPK_SHOT_STEP; on hitting the player it bursts over that panel and the one
// behind it, then disappears. An invulnerable player lets it pass.

export class HeatShot implements LaneMover {
  readonly kind = 'heatshot';
  readonly hitIds = new Set<number>();
  done = false;
  lastStepTick: number;
  readonly stepTicks: number;
  readonly damage: number;
  readonly dir = 1 as const;

  constructor(
    readonly id: number,
    readonly x: number,
    public y: number,
    spawnTick: number,
    damage = tuning.spiker.SPK_DMG,
    stepTicks = secondsToTicks(tuning.spiker.SPK_SHOT_STEP),
  ) {
    this.lastStepTick = spawnTick;
    this.stepTicks = Math.max(1, stepTicks);
    this.damage = damage;
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
    // A fireball bursts on an object too (roguelite spec §3.4).
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage) || ctx.hitPlayerAt(this, this.x, this.y, this.damage)) {
      const cells: Cell[] = [{ x: this.x, y: this.y }];
      if (inField(this.x, this.y + 1)) cells.push({ x: this.x, y: this.y + 1 });
      ctx.emit({ type: 'explosion', cells });
      this.done = true;
    }
  }
}
