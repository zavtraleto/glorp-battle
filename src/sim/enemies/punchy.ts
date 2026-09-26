import { secondsToTicks, tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import type { Attack } from '../attacks/attack';
import type { Field } from '../field';
import { COLS, ROWS, type Cell } from '../grid';
import { Enemy, type EnemyContext, type EnemyState } from './enemyBase';
import type { Telegraph } from './telegraph';

interface PunchyIntent {
  /** Cell it appears on, right in front of the player (their side too). */
  dest: Cell;
  /** Cell the fist lands on. */
  punch: Cell;
}

// Punchy (Champy, MMBN6) — GDD §8.4.1. Stands until the player is in its lane,
// then commits: a ghost marks the arrival cell while it is still home
// (INTENTION), it warps in front of the player, raises the fist (LOCK), gives
// the counter window (COUNTER, never shorter than `enemy.WARP_MIN_WINDOW`),
// punches one cell, recovers there and warps home. One Punchy attacks at a time.

export class Punchy extends Enemy {
  readonly kind = 'punchy';
  private intent: PunchyIntent | null = null;
  private homeX: number;
  private homeY: number;
  /** No new check before this tick (rest after coming home). */
  private restUntil = -Infinity;
  /** Countered: let go of the attack lock at the next update. */
  private releasePending = false;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.punchy.HP, spawnTick, level);
    this.homeX = x;
    this.homeY = y;
  }

  private counterTicks(): number {
    return Math.max(this.ticks(tuning.punchy.COUNTER_TIME), secondsToTicks(tuning.enemy.WARP_MIN_WINDOW));
  }

  protected override phaseTicks(state: EnemyState): number {
    return state === 'COUNTER' ? this.counterTicks() : super.phaseTicks(state);
  }

  /** Arrival ghost while home, then the punch cell until the strike (GDD §8.1.1). */
  override telegraph(_field: Field): Telegraph | null {
    const i = this.intent;
    if (!i || !Number.isFinite(this.stateEndTick)) return null;
    const here = this.x === i.dest.x && this.y === i.dest.y;
    if (this.state === 'INTENTION' && !here) {
      return { enemyId: this.id, kind: 'warp', cells: [i.dest], start: this.stateTick, end: this.stateEndTick };
    }
    let start: number;
    let end: number;
    if (this.state === 'INTENTION') {
      start = this.stateTick;
      end = this.stateEndTick + this.phaseTicks('LOCK') + this.counterTicks();
    } else if (this.state === 'LOCK') {
      start = this.stateTick;
      end = this.stateEndTick + this.counterTicks();
    } else if (this.state === 'COUNTER') {
      start = this.stateTick - this.phaseTicks('LOCK');
      end = this.stateEndTick;
    } else {
      return null;
    }
    return { enemyId: this.id, kind: 'lane', cells: [i.punch], start, end };
  }

  override forceAttack(tick: number): void {
    if (this.alive && this.state === 'IDLE') {
      this.restUntil = -Infinity;
      this.stateTick = tick - this.ticks(tuning.punchy.ACTION_DELAY);
    }
  }

  protected override onCountered(): void {
    this.intent = null;
    this.releasePending = true;
  }

  protected override finishCounterStagger(ctx: EnemyContext): void {
    this.goHome(ctx);
  }

  /** Where it may appear: any standing, free panel, the player's side included (GDD §8.4.1). */
  private static canLand(ctx: EnemyContext, x: number, y: number): boolean {
    return (
      x >= 0 && x < COLS && y >= 0 && y < ROWS &&
      ctx.field.panel(x, y) !== 'BROKEN' &&
      ctx.occupancy.isFree(x, y) &&
      ctx.field.hazard(x, y)?.side !== 'player'
    );
  }

  private decide(ctx: EnemyContext): void {
    const p = ctx.player;
    if (!p.alive || p.x !== this.x) return;
    const dest = { x: p.x, y: p.y - 1 };
    const here = this.x === dest.x && this.y === dest.y;
    if (!here && !Punchy.canLand(ctx, dest.x, dest.y)) return;
    if (!ctx.claimAttack(this)) return;
    this.intent = { dest, punch: { x: p.x, y: p.y } };
    this.setTimedState('INTENTION', ctx.tick, this.ticks(tuning.punchy.INTENTION_TIME));
  }

  /** Home cell, or the nearest free cell of its own if that is taken; stays put if none. */
  private goHome(ctx: EnemyContext): void {
    if (this.x === this.homeX && this.y === this.homeY) return;
    if (Enemy.canEnter(ctx, this.homeX, this.homeY)) {
      this.relocate(ctx, this.homeX, this.homeY);
      return;
    }
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!Enemy.canEnter(ctx, x, y)) continue;
        const d = Math.abs(x - this.homeX) + Math.abs(y - this.homeY);
        if (d < bestD) {
          best = { x, y };
          bestD = d;
        }
      }
    }
    if (!best) return;
    this.relocate(ctx, best.x, best.y);
    this.homeX = best.x;
    this.homeY = best.y;
  }

  update(ctx: EnemyContext): void {
    const c = tuning.punchy;
    const t = ctx.tick;
    if (this.releasePending) {
      this.releasePending = false;
      ctx.releaseAttack(this);
    }
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (t < this.restUntil || this.elapsed(t) < this.ticks(c.ACTION_DELAY)) return;
        // Stranded on the player's side (home was taken): try again first.
        if (ctx.field.owner(this.x, this.y) !== 'enemy') this.goHome(ctx);
        this.stateTick = t;
        this.decide(ctx);
        return;
      case 'INTENTION': {
        if (!this.phaseDone(t) || !this.intent) return;
        const { dest } = this.intent;
        const here = this.x === dest.x && this.y === dest.y;
        if (!here) {
          if (!Punchy.canLand(ctx, dest.x, dest.y)) {
            // The cell was taken meanwhile: call it off.
            this.intent = null;
            ctx.releaseAttack(this);
            this.setState('IDLE', t);
            return;
          }
          this.relocate(ctx, dest.x, dest.y);
        }
        this.setTimedState('LOCK', t, this.ticks(c.LOCK_TIME));
        return;
      }
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.counterTicks());
        return;
      case 'COUNTER': {
        if (!this.phaseDone(t)) return;
        if (!this.intent) {
          ctx.releaseAttack(this);
          this.setState('IDLE', t);
          return;
        }
        const punch: Attack = { id: ctx.nextAttackId(), kind: 'punch', hitIds: new Set(), done: true, update: () => undefined };
        const cell = this.intent.punch;
        ctx.hitPlayerAt(punch, cell.x, cell.y, this.dmg(c.DMG));
        ctx.emit({ type: 'enemySlash', cells: [cell] });
        this.setTimedState('STRIKE', t, this.ticks(c.STRIKE_TIME));
        return;
      }
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(c.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (!this.phaseDone(t)) return;
        this.intent = null;
        ctx.releaseAttack(this);
        this.goHome(ctx);
        this.setState('IDLE', t);
        this.restUntil = t + this.ticks(c.REST_TIME);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
