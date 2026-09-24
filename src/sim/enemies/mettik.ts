import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { Shockwave } from '../attacks/shockwave';
import type { Field } from '../field';
import { groundCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

type MettikIntent =
  | { kind: 'move'; destination: Cell; sampledLane: number }
  | { kind: 'shockwave'; origin: Cell };

// Mettik (Mettaur, MMBN3) — GDD §8.2.
// Each decision snapshots a move or Shockwave, then finishes it before observing again.

export class Mettik extends Enemy {
  readonly kind = 'mettik';
  private intent: MettikIntent | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.mettik.MET_HP, spawnTick, level);
  }

  override dangerCells(field: Field): Cell[] {
    if (this.state !== 'LOCK' && this.state !== 'COUNTER') return [];
    const origin = this.intent?.kind === 'shockwave' ? this.intent.origin : null;
    return origin ? groundCellsBelow(origin.x, origin.y, (x, y) => field.panel(x, y) === 'BROKEN') : [];
  }

  protected override onCountered(): void {
    this.intent = null;
  }

  /** Starts the attack now if possible (debug "force attack"). */
  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.commitShockwave(tick);
    }
  }

  private commitShockwave(tick: number, lane = this.x): void {
    this.intent = { kind: 'shockwave', origin: { x: lane, y: this.y + 1 } };
    this.setTimedState('INTENTION', tick, this.ticks(tuning.mettik.INTENTION_TIME));
  }

  private decide(ctx: EnemyContext): void {
    const sampledLane = ctx.player.x;
    if (this.x === sampledLane) {
      this.commitShockwave(ctx.tick, sampledLane);
      return;
    }

    const destination = { x: this.x + Math.sign(sampledLane - this.x), y: this.y };
    this.intent = { kind: 'move', destination, sampledLane };
    if (this.tryStep(ctx, destination.x, destination.y)) {
      this.setTimedState('MOVE', ctx.tick, this.ticks(tuning.mettik.MOVE_TIME));
    } else {
      this.intent = null;
      this.setState('IDLE', ctx.tick);
    }
  }

  update(ctx: EnemyContext): void {
    const m = tuning.mettik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE': {
        if (this.elapsed(t) < this.ticks(m.MOVE_TIME)) return;
        this.decide(ctx);
        return;
      }
      case 'MOVE': {
        if (!this.phaseDone(t)) return;
        const completed = this.intent?.kind === 'move' ? this.intent : null;
        this.intent = null;
        if (completed && this.x === completed.sampledLane) this.commitShockwave(t, completed.sampledLane);
        else this.decide(ctx);
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
        if (this.intent?.kind !== 'shockwave') {
          this.setState('IDLE', t);
          return;
        }
        ctx.spawnAttack(
          new Shockwave(ctx.nextAttackId(), this.intent.origin.x, this.intent.origin.y, t, {
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
        this.intent = null;
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
