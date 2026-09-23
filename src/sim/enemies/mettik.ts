import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { Shockwave } from '../attacks/shockwave';
import { laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Mettik (Mettaur, MMBN1) — GDD §8.2.
// Keeps its row, steps sideways toward the player's lane every MOVE_TIME.
// When aligned and holding the turn token, it follows the common attack grammar.

export class Mettik extends Enemy {
  readonly kind = 'mettik';
  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.mettik.MET_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    if (this.state !== 'LOCK' && this.state !== 'COUNTER') return [];
    return laneCellsBelow(this.x, this.y + 1);
  }

  protected override finishCounterStagger(ctx: EnemyContext): void {
    ctx.passTurn(this);
  }

  /** Starts the attack now if possible (debug "force attack"). */
  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.setTimedState('INTENTION', tick, this.ticks(tuning.mettik.INTENTION_TIME));
    }
  }

  update(ctx: EnemyContext): void {
    const m = tuning.mettik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(m.MOVE_TIME)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          if (ctx.hasTurn(this)) this.setTimedState('INTENTION', t, this.ticks(m.INTENTION_TIME));
          return;
        }
        const nx = this.x + Math.sign(px - this.x);
        this.state = this.tryStep(ctx, nx, this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(m.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(m.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        ctx.spawnAttack(
          new Shockwave(ctx.nextAttackId(), this.x, this.y + 1, t, {
            dir: 1,
            damage: this.dmg(m.MET_DMG),
            stepTicks: this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
            owner: 'enemy',
          }),
        );
        this.setTimedState('STRIKE', t, this.ticks(m.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(m.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (!this.phaseDone(t)) return;
        ctx.passTurn(this);
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
