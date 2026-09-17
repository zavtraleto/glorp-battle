import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import type { Attack } from '../attacks/attack';
import type { Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Punchy (Champy, MMBN1) — roguelite spec §5.2.
// When the player stands right at the border, it jumps onto the panel in
// front of them, telegraphs and punches; a hit knocks the player back.

export class Punchy extends Enemy {
  readonly kind = 'punchy';
  private target: Cell | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.punchy.PUN_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' && this.target ? [this.target] : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && this.state === 'IDLE') this.stateTick = tick - this.ticks(tuning.punchy.PUN_CHECK);
  }

  update(ctx: EnemyContext): void {
    const c = tuning.punchy;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(c.PUN_CHECK)) return;
        this.stateTick = t;
        const p = ctx.player;
        const fx = p.x;
        const fy = p.y - 1;
        if (ctx.field.owner(fx, fy) !== 'enemy') return;
        const here = this.x === fx && this.y === fy;
        if (!here && !this.warpTo(ctx, fx, fy)) return;
        this.target = { x: p.x, y: p.y };
        this.setState('TELEGRAPH', t);
        return;
      }
      case 'TELEGRAPH': {
        if (this.elapsed(t) < this.ticks(c.PUN_TELEGRAPH) || !this.target) return;
        const punch: Attack = { id: ctx.nextAttackId(), kind: 'punch', hitIds: new Set(), done: true, update: () => undefined };
        const cell = { x: this.x, y: this.y + 1 };
        if (ctx.hitPlayerAt(punch, cell.x, cell.y, this.dmg(c.PUN_DMG))) ctx.pushPlayer();
        ctx.emit({ type: 'enemySlash', cells: [cell] });
        this.target = null;
        this.setState('ATTACK', t);
        return;
      }
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(c.PUN_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(c.PUN_RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
