import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { Shockwave } from '../attacks/shockwave';
import { laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Mettik (Mettaur, MMBN1) — GDD §8.2.
// Keeps its row, steps sideways toward the player's lane every MET_MOVE_INTERVAL.
// When aligned and holding the turn token: telegraph → shockwave → recovery.

export class Mettik extends Enemy {
  readonly kind = 'mettik';
  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.mettik.MET_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    if (this.state !== 'TELEGRAPH') return [];
    return laneCellsBelow(this.x, this.y + 1);
  }

  override counterWindowOpen(tick: number): boolean {
    if (this.state !== 'TELEGRAPH') return false;
    const total = this.ticks(tuning.mettik.MET_TELEGRAPH);
    const window = this.counterTicks(tuning.counter.COUNTER_WINDOW_METTIK);
    if (window === 0) return false;
    const elapsed = this.elapsed(tick);
    return elapsed >= Math.max(0, total - window) && elapsed < total;
  }

  protected override finishCounterStagger(ctx: EnemyContext): void {
    ctx.passTurn(this);
  }

  /** Starts the attack now if possible (debug "force attack"). */
  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  update(ctx: EnemyContext): void {
    const m = tuning.mettik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(m.MET_MOVE_INTERVAL)) return;
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
        if (this.elapsed(t) < this.ticks(m.MET_TELEGRAPH)) return;
        ctx.spawnAttack(
          new Shockwave(ctx.nextAttackId(), this.x, this.y + 1, t, {
            dir: 1,
            damage: this.dmg(m.MET_DMG),
            stepTicks: this.ticks(m.MET_WAVE_STEP),
            owner: 'enemy',
          }),
        );
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.elapsed(t) >= this.ticks(m.MET_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) < this.ticks(m.MET_RECOVERY)) return;
        ctx.passTurn(this);
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
