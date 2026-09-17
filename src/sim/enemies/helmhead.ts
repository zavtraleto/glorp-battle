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
    return (this.state === 'TELEGRAPH' || this.state === 'ATTACK') && this.target ? [this.target] : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && this.state === 'IDLE') this.stateTick = tick - this.ticks(tuning.helmhead.HELM_CLOSED);
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
        this.target = { x: ctx.player.x, y: ctx.player.y };
        this.setState('TELEGRAPH', t);
        return;
      case 'TELEGRAPH': {
        if (this.elapsed(t) < this.ticks(h.HELM_TELEGRAPH) || !this.target) return;
        const ball = new CannonBall(ctx.nextAttackId(), 'cannonball', this.x, this.y, [this.target], t, {
          damage: this.dmg(h.HELM_DMG),
          flightTicks: this.ticks(h.HELM_FLIGHT),
          panel: 'break',
        });
        ctx.spawnAttack(ball);
        this.setState('ATTACK', t);
        return;
      }
      case 'ATTACK':
        if (this.elapsed(t) < this.ticks(h.HELM_FLIGHT)) return;
        this.target = null;
        this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(h.HELM_RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
