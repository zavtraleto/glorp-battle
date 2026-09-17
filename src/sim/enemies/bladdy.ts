import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import type { Attack } from '../attacks/attack';
import { inField, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Bladdy (Swordy, MMBN1) — roguelite spec §5.2.
// Walks to the front edge of its area in the player's lane, telegraphs and
// swings a long blade over the two panels in front of it.

export class Bladdy extends Enemy {
  readonly kind = 'bladdy';

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.bladdy.BLD_HP, spawnTick, level);
  }

  private reach(): Cell[] {
    return [
      { x: this.x, y: this.y + 1 },
      { x: this.x, y: this.y + 2 },
    ].filter((c) => inField(c.x, c.y));
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? this.reach() : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  /** At the front edge: the panel in front belongs to someone else. */
  private atFront(ctx: EnemyContext): boolean {
    return ctx.field.owner(this.x, this.y + 1) !== 'enemy';
  }

  update(ctx: EnemyContext): void {
    const b = tuning.bladdy;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(b.BLD_MOVE_INTERVAL)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px && this.atFront(ctx)) {
          this.setState('TELEGRAPH', t);
          return;
        }
        const moved =
          this.x !== px
            ? this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y)
            : this.tryStep(ctx, this.x, this.y + 1);
        this.state = moved ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH': {
        if (this.elapsed(t) < this.ticks(b.BLD_TELEGRAPH)) return;
        const swing: Attack = { id: ctx.nextAttackId(), kind: 'slash', hitIds: new Set(), done: true, update: () => undefined };
        const cells = this.reach();
        for (const c of cells) ctx.hitPlayerAt(swing, c.x, c.y, this.dmg(b.BLD_DMG));
        ctx.emit({ type: 'enemySlash', cells });
        this.setState('ATTACK', t);
        return;
      }
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(b.BLD_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(b.BLD_RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
