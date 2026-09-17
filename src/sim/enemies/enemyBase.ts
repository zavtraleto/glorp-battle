import { secondsToTicks, tuning } from '../../config/tuning';
import type { Cell } from '../grid';
import type { EntityId, Occupancy } from '../occupancy';
import type { Player } from '../player';
import type { Rng } from '../../core/rng';
import type { Attack } from '../attacks/attack';
import type { Field } from '../field';
import type { SimEvent } from '../events';

// Common enemy state machine (GDD §8.1):
// IDLE → MOVE → TELEGRAPH → ATTACK → RECOVERY → IDLE; DEAD is terminal.
// Hits never interrupt an enemy's action; they only flash.

export type EnemyKind = 'mettik' | 'canodron' | 'spiker';
export type EnemyState = 'IDLE' | 'MOVE' | 'TELEGRAPH' | 'ATTACK' | 'RECOVERY' | 'DEAD';

/** What an enemy may read or do during its update. */
export interface EnemyContext {
  readonly tick: number;
  readonly player: Player;
  readonly occupancy: Occupancy;
  readonly field: Field;
  /** Deterministic AI randomness (GDD §15.4). */
  readonly rngAi: Rng;
  spawnAttack(attack: Attack): void;
  /** Allocates an id for an attack entity. */
  nextAttackId(): number;
  emit(event: SimEvent): void;
  /** Instant hit on the first target in lane x from row `fromY` downward; returns the stop row. */
  shootLane(x: number, fromY: number, damage: number): number;
  /** Mettik turn-taking (GDD §8.2). */
  hasTurn(enemy: Enemy): boolean;
  passTurn(enemy: Enemy): void;
}

export abstract class Enemy {
  abstract readonly kind: EnemyKind;
  hp: number;
  readonly maxHp: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  lastMoveTick = -Infinity;
  state: EnemyState = 'IDLE';
  /** Tick when the current state was entered. */
  stateTick: number;
  lastHitTick = -Infinity;
  deathTick = -Infinity;

  constructor(
    readonly id: EntityId,
    x: number,
    y: number,
    hp: number,
    spawnTick: number,
  ) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.hp = this.maxHp = hp;
    this.stateTick = spawnTick;
  }

  get alive(): boolean {
    return this.state !== 'DEAD';
  }

  /** Ticks spent in the current state. */
  elapsed(tick: number): number {
    return tick - this.stateTick;
  }

  setState(state: EnemyState, tick: number): void {
    this.state = state;
    this.stateTick = tick;
  }

  /** Debug "force enemy attack": start the attack sequence as soon as possible. */
  forceAttack(_tick: number): void {}

  /** Targeting cursor to draw (Canodron), or null. */
  cursorCell(): { x: number; y: number; locked: boolean } | null {
    return null;
  }

  /** Cells to highlight as dangerous right now (telegraph). */
  dangerCells(): Cell[] {
    return [];
  }

  /** Returns true if the enemy died from this hit. */
  applyDamage(amount: number, tick: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.lastHitTick = tick;
    if (this.hp === 0) {
      this.setState('DEAD', tick);
      this.deathTick = tick;
      return true;
    }
    return false;
  }

  /** Deletion animation finished; the world removes the enemy. */
  isRemovable(tick: number): boolean {
    return !this.alive && tick - this.deathTick >= secondsToTicks(tuning.fx.DELETE_ANIM_TIME);
  }

  /** Instant relocation (Spiker warp): no slide animation. */
  protected warpTo(ctx: EnemyContext, nx: number, ny: number): boolean {
    if (!ctx.field.canStand('enemy', nx, ny) || !ctx.occupancy.isFree(nx, ny)) return false;
    const fromX = this.x;
    const fromY = this.y;
    ctx.occupancy.move(this.id, this.x, this.y, nx, ny);
    ctx.field.onLeave(fromX, fromY, ctx.tick);
    this.x = this.prevX = nx;
    this.y = this.prevY = ny;
    ctx.emit({ type: 'enemyWarped', id: this.id, fromX, fromY, x: nx, y: ny });
    return true;
  }

  protected tryStep(ctx: EnemyContext, nx: number, ny: number): boolean {
    if (!ctx.field.canStand('enemy', nx, ny) || !ctx.occupancy.isFree(nx, ny)) return false;
    ctx.occupancy.move(this.id, this.x, this.y, nx, ny);
    ctx.field.onLeave(this.x, this.y, ctx.tick);
    this.prevX = this.x;
    this.prevY = this.y;
    this.x = nx;
    this.y = ny;
    this.lastMoveTick = ctx.tick;
    return true;
  }

  abstract update(ctx: EnemyContext): void;
}
