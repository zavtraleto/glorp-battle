import { secondsToTicks, tuning } from '../../config/tuning';
import { Shockwave } from '../attacks/shockwave';
import { ROWS, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Mettik (Mettaur, MMBN1) — GDD §8.2.
// Keeps its row, steps sideways toward the player's lane every MET_MOVE_INTERVAL.
// When aligned and holding the turn token: telegraph → shockwave → recovery.

export class Mettik extends Enemy {
  readonly kind = 'mettik';
  private nextAttackId: () => number;

  constructor(id: number, x: number, y: number, spawnTick: number, nextAttackId: () => number) {
    super(id, x, y, tuning.mettik.MET_HP, spawnTick);
    this.nextAttackId = nextAttackId;
  }

  override dangerCells(): Cell[] {
    if (this.state !== 'TELEGRAPH') return [];
    const cells: Cell[] = [];
    for (let y = this.y + 1; y < ROWS; y++) cells.push({ x: this.x, y });
    return cells;
  }

  /** Starts the attack now if possible (debug "force attack"). */
  forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  update(ctx: EnemyContext): void {
    const m = tuning.mettik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < secondsToTicks(m.MET_MOVE_INTERVAL)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          if (ctx.hasTurn(this)) this.setState('TELEGRAPH', t);
          return;
        }
        const nx = this.x + Math.sign(px - this.x);
        this.state = this.tryStep(ctx, nx, this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < secondsToTicks(m.MET_TELEGRAPH)) return;
        ctx.spawnAttack(new Shockwave(this.nextAttackId(), this.x, this.y + 1, t));
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.elapsed(t) >= secondsToTicks(m.MET_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) < secondsToTicks(m.MET_RECOVERY)) return;
        ctx.passTurn(this);
        this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
