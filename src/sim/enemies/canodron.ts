import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Canodron (Canodumb, MMBN1) — GDD §8.3.
// Stationary. While the player stands in its lane it sends a cursor down the
// lane; when the cursor reaches the player's panel it locks, and after
// CANO_FIRE_DELAY fires an instant shot down the lane. Leaving the lane before
// the lock cancels the cursor without a cooldown.

export class Canodron extends Enemy {
  readonly kind = 'canodron';
  private cursorY = -1;
  private cursorStepTick = 0;
  private locked = false;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.canodron.CANO_HP, spawnTick, level);
  }

  override cursorCell(): { x: number; y: number; locked: boolean } | null {
    if (!['INTENTION', 'LOCK', 'COUNTER'].includes(this.state) || this.cursorY < 0) return null;
    return { x: this.x, y: this.cursorY, locked: this.locked };
  }

  override dangerCells(): Cell[] {
    return this.state === 'LOCK' || this.state === 'COUNTER' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  protected override onCountered(): void {
    this.cursorY = -1;
    this.locked = false;
  }

  override forceAttack(tick: number): void {
    if (!this.alive || this.state !== 'IDLE') return;
    this.startCursor(tick);
  }

  override freezePhase(ticks = 1): void {
    super.freezePhase(ticks);
    this.cursorStepTick += ticks;
  }

  private startCursor(tick: number): void {
    this.setState('INTENTION', tick);
    this.cursorY = this.y + 1;
    this.cursorStepTick = tick;
    this.locked = false;
  }

  private lock(tick: number): void {
    this.locked = true;
    this.setTimedState('LOCK', tick, this.ticks(tuning.canodron.LOCK_TIME));
  }

  private resetCursor(tick: number): void {
    this.cursorY = -1;
    this.locked = false;
    this.setState('IDLE', tick);
  }

  update(ctx: EnemyContext): void {
    const c = tuning.canodron;
    const t = ctx.tick;
    const p = ctx.player;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (p.x === this.x) this.startCursor(t);
        return;
      case 'INTENTION': {
        if (p.x !== this.x) {
          this.resetCursor(t);
          return;
        }
        // Once aim reaches the current target row, hold it there until the
        // early signal has remained visible for the full Intention duration.
        if (p.y === this.cursorY) {
          if (this.elapsed(t) >= this.ticks(c.INTENTION_TIME)) this.lock(t);
          return;
        }
        if (t - this.cursorStepTick >= this.ticks(c.CANO_CURSOR_STEP)) {
          this.cursorY++;
          this.cursorStepTick = t;
          if (this.cursorY >= ROWS) {
            this.resetCursor(t);
            return;
          }
        }
        if (p.y === this.cursorY && this.elapsed(t) >= this.ticks(c.INTENTION_TIME)) this.lock(t);
        return;
      }
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(c.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        ctx.shootLane(this.x, this.y + 1, this.dmg(c.CANO_DMG));
        this.cursorY = -1;
        this.locked = false;
        this.setTimedState('STRIKE', t, this.ticks(c.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(c.RECOVERY_TIME));
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
