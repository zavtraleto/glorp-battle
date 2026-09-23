import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { LaneShot } from '../attacks/laneShot';
import { COLS, ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Hopzap (Bunny, MMBN1) — roguelite spec §5.2.
// Hops between its panels, preferring the player's lane; once in the lane it
// telegraphs and sends a slow ZapRing down it. A hit paralyzes the player.

export class Hopzap extends Enemy {
  readonly kind = 'hopzap';

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.hopzap.HOP_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    return this.state === 'LOCK' || this.state === 'COUNTER' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.setTimedState('INTENTION', tick, this.ticks(tuning.hopzap.INTENTION_TIME));
    }
  }

  private hop(ctx: EnemyContext): void {
    const cells: Cell[] = [];
    const lane: Cell[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (x === this.x && y === this.y) continue;
        if (!ctx.field.canStand('enemy', x, y) || !ctx.occupancy.isFree(x, y)) continue;
        cells.push({ x, y });
        if (x === ctx.player.x) lane.push({ x, y });
      }
    }
    const pool = lane.length > 0 ? lane : cells;
    if (pool.length === 0) return;
    const c = ctx.rngAi.pick(pool);
    this.warpTo(ctx, c.x, c.y);
  }

  update(ctx: EnemyContext): void {
    const h = tuning.hopzap;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (this.elapsed(t) < this.ticks(h.MOVE_TIME)) return;
        this.stateTick = t;
        if (this.x === ctx.player.x) this.setTimedState('INTENTION', t, this.ticks(h.INTENTION_TIME));
        else this.hop(ctx);
        return;
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(h.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(h.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        ctx.spawnAttack(
          new LaneShot(ctx.nextAttackId(), 'zapring', this.x, this.y + 1, t, {
            damage: this.dmg(h.HOP_DMG),
            stepTicks: this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
            paralyze: this.ticks(h.HOP_PARALYZE),
          }),
        );
        this.setTimedState('STRIKE', t, this.ticks(h.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(h.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (this.phaseDone(t)) this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
