import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { HeatShot } from '../attacks/heatShot';
import { COLS, ENEMY_ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Spiker (Spikey, MMBN2) — GDD §8.4.
// Warps to random free panels SPK_WARPS_MIN..MAX times, then warps into the
// player's lane, aims (telegraph) and throws a HeatShot down the lane.

export class Spiker extends Enemy {
  readonly kind = 'spiker';
  /** Random warps left before lining up; -1 = roll a new count. */
  private warpsLeft = -1;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.spiker.SPK_HP, spawnTick, level);
    this.state = 'MOVE';
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (!this.alive || this.state !== 'MOVE') return;
    this.warpsLeft = 0;
    this.stateTick = tick - this.ticks(tuning.spiker.SPK_WARP_INTERVAL);
  }

  private freeCells(ctx: EnemyContext, lane: number | null): Cell[] {
    const cells: Cell[] = [];
    for (let y = ENEMY_ROWS.min; y <= ENEMY_ROWS.max; y++) {
      for (let x = 0; x < COLS; x++) {
        if (lane !== null && x !== lane) continue;
        if (x === this.x && y === this.y) continue;
        if (ctx.occupancy.isFree(x, y) && ctx.field.canStand('enemy', x, y)) cells.push({ x, y });
      }
    }
    return cells;
  }

  private warpRandom(ctx: EnemyContext, lane: number | null): boolean {
    const cells = this.freeCells(ctx, lane);
    if (cells.length === 0) return false;
    const c = ctx.rngAi.pick(cells);
    return this.warpTo(ctx, c.x, c.y);
  }

  update(ctx: EnemyContext): void {
    const s = tuning.spiker;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.warpsLeft < 0) this.warpsLeft = ctx.rngAi.int(s.SPK_WARPS_MIN, Math.max(s.SPK_WARPS_MIN, s.SPK_WARPS_MAX));
        if (this.elapsed(t) < this.ticks(s.SPK_WARP_INTERVAL)) return;
        this.stateTick = t;
        if (this.warpsLeft > 0) {
          this.warpRandom(ctx, null);
          this.warpsLeft--;
          return;
        }
        // Line up with the player: already there, or warp into the lane.
        const lane = ctx.player.x;
        if (this.x === lane || this.warpRandom(ctx, lane)) {
          this.setState('TELEGRAPH', t);
        } else {
          // Lane is full: keep warping and try again next interval.
          this.warpRandom(ctx, null);
        }
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(s.SPK_TELEGRAPH)) return;
        ctx.spawnAttack(
          new HeatShot(ctx.nextAttackId(), this.x, this.y + 1, t, this.dmg(s.SPK_DMG), this.ticks(s.SPK_SHOT_STEP)),
        );
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(s.SPK_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) < this.ticks(s.SPK_RECOVERY)) return;
        this.warpsLeft = -1;
        this.setState('MOVE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
