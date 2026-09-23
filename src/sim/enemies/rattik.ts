import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { RatMine } from '../attacks/ratMine';
import { laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Rattik (Ratty, MMBN1) — roguelite spec §5.2.
// Keeps its row and steps toward the player's lane; aligned, it releases a
// mine that runs down the lane and turns toward the player on their row.

export class Rattik extends Enemy {
  readonly kind = 'rattik';

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.rattik.RAT_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    return this.state === 'LOCK' || this.state === 'COUNTER' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.setTimedState('INTENTION', tick, this.ticks(tuning.rattik.INTENTION_TIME));
    }
  }

  update(ctx: EnemyContext): void {
    const r = tuning.rattik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(r.MOVE_TIME)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          this.setTimedState('INTENTION', t, this.ticks(r.INTENTION_TIME));
          return;
        }
        this.state = this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(r.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(r.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        ctx.spawnAttack(
          new RatMine(
            ctx.nextAttackId(),
            this.x,
            this.y + 1,
            t,
            this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
            this.dmg(r.RAT_DMG),
          ),
        );
        this.setTimedState('STRIKE', t, this.ticks(r.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(r.RECOVERY_TIME));
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
