import { secondsToTicks, tuning } from '../../config/tuning';
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
  private lockTick = 0;

  constructor(id: number, x: number, y: number, spawnTick: number) {
    super(id, x, y, tuning.canodron.CANO_HP, spawnTick);
  }

  override cursorCell(): { x: number; y: number; locked: boolean } | null {
    if (this.state !== 'TELEGRAPH' || this.cursorY < 0) return null;
    return { x: this.x, y: this.cursorY, locked: this.locked };
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' && this.locked ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (!this.alive || this.state !== 'IDLE') return;
    this.startCursor(tick);
    this.lock(tick);
  }

  private startCursor(tick: number): void {
    this.setState('TELEGRAPH', tick);
    this.cursorY = this.y + 1;
    this.cursorStepTick = tick;
    this.locked = false;
  }

  private lock(tick: number): void {
    this.locked = true;
    this.lockTick = tick;
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
      case 'TELEGRAPH': {
        if (this.locked) {
          if (t - this.lockTick < secondsToTicks(c.CANO_FIRE_DELAY)) return;
          ctx.shootLane(this.x, this.y + 1, c.CANO_DMG);
          this.cursorY = -1;
          this.locked = false;
          this.setState('ATTACK', t);
          return;
        }
        if (p.x !== this.x) {
          this.resetCursor(t);
          return;
        }
        if (t - this.cursorStepTick >= Math.max(1, secondsToTicks(c.CANO_CURSOR_STEP))) {
          this.cursorY++;
          this.cursorStepTick = t;
          if (this.cursorY >= ROWS) {
            this.resetCursor(t);
            return;
          }
        }
        if (p.y === this.cursorY) this.lock(t);
        return;
      }
      case 'ATTACK':
        if (this.elapsed(t) >= secondsToTicks(c.CANO_ATTACK_TIME)) this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= secondsToTicks(c.CANO_COOLDOWN)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
