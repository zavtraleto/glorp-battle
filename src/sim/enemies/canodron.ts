import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type CursorView, type EnemyContext } from './enemyBase';
import type { TelegraphKind } from './telegraph';

interface CanodronIntent {
  kind: 'laneShot';
  lane: number;
  fromY: number;
  targetY: number;
}

// Canodron (Canodumb, MMBN3) — GDD §8.3.
// Stationary. While the player stands in its lane it sends a cursor down the
// lane; when the cursor reaches the player's panel it locks, and after
// the common telegraph fires an instant shot down the committed lane. Leaving the lane before
// the lock cancels the cursor without a cooldown.

export class Canodron extends Enemy {
  readonly kind = 'canodron';
  private cursorY = -1;
  private cursorStepTick = 0;
  private intent: CanodronIntent | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.canodron.HP, spawnTick, level);
  }

  override cursorCell(): CursorView | null {
    if (!['INTENTION', 'LOCK', 'COUNTER'].includes(this.state) || this.cursorY < 0) return null;
    const stepTicks = this.ticks(tuning.canodron.CURSOR_STEP);
    if (this.intent) return { x: this.intent.lane, y: this.intent.targetY, locked: true, stepTick: this.cursorStepTick, stepTicks };
    return { x: this.x, y: this.cursorY, locked: false, stepTick: this.cursorStepTick, stepTicks };
  }

  /** The lane is known only once the cursor locks (GDD §8.3). */
  protected override readonly fusePhases = ['LOCK', 'COUNTER'] as const;

  protected override telegraphShape(): { kind: TelegraphKind; cells: Cell[] } | null {
    if (!this.intent) return null;
    return { kind: 'lane', cells: laneCellsBelow(this.intent.lane, this.intent.fromY) };
  }

  protected override onCountered(): void {
    this.cursorY = -1;
    this.intent = null;
  }

  override forceAttack(tick: number): void {
    if (!this.alive || this.state !== 'IDLE') return;
    this.startCursor(tick);
  }

  override updateStagger(ctx: EnemyContext): void {
    if (this.cursorY >= 0 && !this.intent) this.cursorStepTick++;
    super.updateStagger(ctx);
  }

  private startCursor(tick: number): void {
    this.setState('INTENTION', tick);
    this.cursorY = this.y + 1;
    this.cursorStepTick = tick;
    this.intent = null;
  }

  private lock(tick: number): void {
    this.intent = {
      kind: 'laneShot',
      lane: this.x,
      fromY: this.y + 1,
      targetY: this.cursorY,
    };
    this.setTimedState('LOCK', tick, this.ticks(tuning.canodron.LOCK_TIME));
  }

  private resetCursor(tick: number): void {
    this.cursorY = -1;
    this.intent = null;
    this.setState('IDLE', tick);
  }

  update(ctx: EnemyContext): void {
    const c = tuning.canodron;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (ctx.player.x === this.x) this.startCursor(t);
        return;
      case 'INTENTION': {
        const p = ctx.player;
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
        if (t - this.cursorStepTick >= this.ticks(c.CURSOR_STEP)) {
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
        if (!this.intent) {
          this.resetCursor(t);
          return;
        }
        ctx.shootLane(this.intent.lane, this.intent.fromY, this.dmg(c.DMG));
        this.cursorY = -1;
        this.setTimedState('STRIKE', t, this.ticks(c.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(c.RECOVERY_TIME));
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
