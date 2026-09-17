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
    return this.state === 'TELEGRAPH' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  update(ctx: EnemyContext): void {
    const r = tuning.rattik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(r.RAT_MOVE_INTERVAL)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          this.setState('TELEGRAPH', t);
          return;
        }
        this.state = this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(r.RAT_TELEGRAPH)) return;
        ctx.spawnAttack(new RatMine(ctx.nextAttackId(), this.x, this.y + 1, t, this.ticks(r.RAT_STEP), this.dmg(r.RAT_DMG)));
        this.setState('RECOVERY', t);
        return;
      case 'ATTACK':
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(r.RAT_RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
