import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { CannonBall } from '../attacks/cannonBall';
import type { Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Helmhead (HardHead, MMBN1) — roguelite spec §5.2.
// Hides in its helmet (no damage), then opens, marks the player's panel and
// lobs a cannonball that hits it and breaks the panel. It stays open until
// the recovery ends.

export class Helmhead extends Enemy {
  readonly kind = 'helmhead';
  private target: Cell | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.helmhead.HELM_HP, spawnTick, level);
    this.guarded = true;
  }

  override dangerCells(): Cell[] {
    return (this.state === 'LOCK' || this.state === 'COUNTER') && this.target ? [this.target] : [];
  }

  override forceAttack(tick: number): void {
    if (!this.alive || this.state !== 'IDLE') return;
    this.guarded = false;
    this.setTimedState('INTENTION', tick, this.ticks(tuning.helmhead.INTENTION_TIME));
  }

  protected override onCountered(): void {
    this.target = null;
  }

  protected override finishCounterStagger(): void {
    this.guarded = true;
  }

  update(ctx: EnemyContext): void {
    const h = tuning.helmhead;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        this.guarded = true;
        if (this.elapsed(t) < this.ticks(h.HELM_CLOSED)) return;
        this.guarded = false;
        this.setTimedState('INTENTION', t, this.ticks(h.INTENTION_TIME));
        return;
      case 'INTENTION':
        if (!this.phaseDone(t)) return;
        this.target = { x: ctx.player.x, y: ctx.player.y };
        this.setTimedState('LOCK', t, this.ticks(h.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(h.COUNTER_TIME));
        return;
      case 'COUNTER': {
        if (!this.phaseDone(t) || !this.target) return;
        const ball = new CannonBall(ctx.nextAttackId(), 'cannonball', this.x, this.y, [this.target], t, {
          damage: this.dmg(h.HELM_DMG),
          cellTravelTicks: this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
          panel: 'break',
        });
        ctx.spawnAttack(ball);
        this.setTimedState('STRIKE', t, this.ticks(h.STRIKE_TIME));
        return;
      }
      case 'STRIKE':
        if (!this.phaseDone(t)) return;
        this.target = null;
        this.setTimedState('RECOVERY', t, this.ticks(h.RECOVERY_TIME));
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
