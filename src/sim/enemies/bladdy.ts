import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import type { Attack } from '../attacks/attack';
import { COLS, ROWS, inField, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';
import type { TelegraphKind } from './telegraph';

type BladdyIntent =
  | { kind: 'move'; destination: Cell }
  | { kind: 'wideSword' | 'longSword'; cells: Cell[] }
  | { kind: 'areaGrab'; cells: Cell[] };

// Bladdy (Swordy, MMBN3; timings MMBN6) — GDD §8.4.
// Commits one positional step or one fixed sword/AreaGrab action per decision.
// Only one Bladdy attacks at a time (`EnemyContext.claimAttack`); the others
// stand while it swings.

export class Bladdy extends Enemy {
  readonly kind = 'bladdy';
  private intent: BladdyIntent | null = null;
  private outOfRangeDecisions = 0;
  /** Let go of the attack lock at the next update (countered: no context there). */
  private releasePending = false;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.bladdy.HP, spawnTick, level);
  }

  private longSwordCells(): Cell[] {
    return [
      { x: this.x, y: this.y + 1 },
      { x: this.x, y: this.y + 2 },
    ].filter((c) => inField(c.x, c.y));
  }

  private wideSwordCells(): Cell[] {
    return [-1, 0, 1]
      .map((dx) => ({ x: this.x + dx, y: this.y + 1 }))
      .filter((c) => inField(c.x, c.y));
  }

  protected override telegraphShape(): { kind: TelegraphKind; cells: Cell[] } | null {
    if (!this.intent || this.intent.kind === 'move') return null;
    return { kind: this.intent.kind === 'areaGrab' ? 'grab' : 'area', cells: [...this.intent.cells] };
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.commitAttack({ kind: 'longSword', cells: this.longSwordCells() }, tick);
    }
  }

  protected override onCountered(): void {
    this.intent = null;
    this.outOfRangeDecisions = 0;
    this.releasePending = true;
  }

  private commitAttack(intent: Exclude<BladdyIntent, { kind: 'move' }>, tick: number): void {
    this.intent = intent;
    this.outOfRangeDecisions = 0;
    this.setTimedState('INTENTION', tick, this.ticks(tuning.bladdy.INTENTION_TIME));
  }

  private selectSword(ctx: EnemyContext): Exclude<BladdyIntent, { kind: 'move' | 'areaGrab' }> | null {
    const dx = ctx.player.x - this.x;
    const dy = ctx.player.y - this.y;
    if (dy === 1 && Math.abs(dx) <= 1) return { kind: 'wideSword', cells: this.wideSwordCells() };
    if (dx === 0 && dy >= 1 && dy <= 2) return { kind: 'longSword', cells: this.longSwordCells() };
    return null;
  }

  /**
   * Player-owned cells of the nearest row with a free one, never closer than
   * MIN_PLAYER_ROWS to the back edge. The player's own cell is included:
   * it stays theirs, but the grab hurts them.
   */
  private areaGrabCells(ctx: EnemyContext): Cell[] {
    const lastRow = ROWS - 1 - tuning.bladdy.MIN_PLAYER_ROWS;
    for (let y = this.y + 1; y <= lastRow; y++) {
      const cells: Cell[] = [];
      for (let x = 0; x < COLS; x++) if (ctx.field.owner(x, y) === 'player') cells.push({ x, y });
      if (cells.some((c) => ctx.occupancy.isFree(c.x, c.y))) return cells;
    }
    return [];
  }

  private commitMove(ctx: EnemyContext, destination: Cell): boolean {
    if (!this.tryStep(ctx, destination.x, destination.y)) return false;
    this.intent = { kind: 'move', destination };
    this.outOfRangeDecisions = 0;
    this.setTimedState('MOVE', ctx.tick, this.ticks(tuning.bladdy.MOVE_TIME));
    return true;
  }

  private decide(ctx: EnemyContext): void {
    const sword = this.selectSword(ctx);
    if (sword) {
      // Another Bladdy is attacking: hold position until it is done.
      if (ctx.claimAttack(this)) this.commitAttack(sword, ctx.tick);
      else this.setState('IDLE', ctx.tick);
      return;
    }

    if (this.commitMove(ctx, { x: this.x, y: this.y + 1 })) return;
    if (this.x !== ctx.player.x) {
      const horizontal = { x: this.x + Math.sign(ctx.player.x - this.x), y: this.y };
      if (this.commitMove(ctx, horizontal)) return;
    }

    this.outOfRangeDecisions++;
    if (this.outOfRangeDecisions >= tuning.bladdy.AREA_GRAB_DECISIONS) {
      const cells = this.areaGrabCells(ctx);
      if (cells.length > 0 && ctx.claimAttack(this)) {
        this.commitAttack({ kind: 'areaGrab', cells }, ctx.tick);
        return;
      }
    }
    this.setState('IDLE', ctx.tick);
  }

  update(ctx: EnemyContext): void {
    const b = tuning.bladdy;
    const t = ctx.tick;
    if (this.releasePending) {
      this.releasePending = false;
      ctx.releaseAttack(this);
    }
    switch (this.state) {
      case 'IDLE':
        if (this.elapsed(t) < this.ticks(b.SETTLE_TIME)) return;
        this.decide(ctx);
        return;
      case 'MOVE':
        if (!this.phaseDone(t)) return;
        this.intent = null;
        this.setState('IDLE', t);
        return;
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(b.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(b.COUNTER_TIME));
        return;
      case 'COUNTER': {
        if (!this.phaseDone(t)) return;
        if (!this.intent || this.intent.kind === 'move') {
          ctx.releaseAttack(this);
          this.setState('IDLE', t);
          return;
        }
        if (this.intent.kind === 'areaGrab') {
          const grab: Attack = { id: ctx.nextAttackId(), kind: 'areaGrab', hitIds: new Set(), done: true, update: () => undefined };
          for (const cell of this.intent.cells) {
            if (ctx.field.owner(cell.x, cell.y) !== 'player') continue;
            if (ctx.occupancy.isFree(cell.x, cell.y)) ctx.field.setOwner(cell.x, cell.y, 'enemy', t, 'world');
            else ctx.hitPlayerAt(grab, cell.x, cell.y, this.dmg(b.AREA_GRAB_DMG));
          }
          this.setTimedState('STRIKE', t, this.ticks(b.STRIKE_TIME));
          return;
        }
        const swing: Attack = { id: ctx.nextAttackId(), kind: 'slash', hitIds: new Set(), done: true, update: () => undefined };
        const cells = this.intent.cells;
        for (const c of cells) ctx.hitPlayerAt(swing, c.x, c.y, this.dmg(b.DMG));
        ctx.emit({ type: 'enemySlash', cells });
        this.setTimedState('STRIKE', t, this.ticks(b.STRIKE_TIME));
        return;
      }
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(b.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (!this.phaseDone(t)) return;
        this.intent = null;
        ctx.releaseAttack(this);
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
