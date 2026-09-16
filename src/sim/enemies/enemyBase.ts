import { secondsToTicks, tuning } from '../../config/tuning';
import type { Cell } from '../grid';
import type { EntityId, Occupancy } from '../occupancy';
import type { Player } from '../player';
import type { Attack } from '../attacks/attack';

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
  spawnAttack(attack: Attack): void;
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

  protected tryStep(ctx: EnemyContext, nx: number, ny: number): boolean {
    if (ny > 2 || !ctx.occupancy.isFree(nx, ny)) return false;
    ctx.occupancy.move(this.id, this.x, this.y, nx, ny);
    this.prevX = this.x;
    this.prevY = this.y;
    this.x = nx;
    this.y = ny;
    this.lastMoveTick = ctx.tick;
    return true;
  }

  abstract update(ctx: EnemyContext): void;
}
