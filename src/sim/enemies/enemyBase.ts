import { secondsToTicks, tuning } from '../../config/tuning';
import type { Cell } from '../grid';
import type { EntityId, Occupancy } from '../occupancy';
import type { Player } from '../player';
import type { Rng } from '../../core/rng';
import type { Attack } from '../attacks/attack';
import { ENEMY_LEVELS, type EnemyLevel } from '../../data/enemies';
import type { Field } from '../field';
import type { FieldObject, ObjectKind } from '../fieldObject';
import type { Side } from '../grid';
import type { SimEvent } from '../events';

// Common enemy timing grammar (GDD §8.1):
// IDLE/MOVE → INTENTION → LOCK → COUNTER → STRIKE → RECOVERY; DEAD is terminal.
// Hits never interrupt an enemy's action; they only flash.

export type EnemyKind = 'mettik' | 'canodron' | 'hopzap' | 'bladdy';
export type EnemyState =
  | 'IDLE'
  | 'MOVE'
  | 'INTENTION'
  | 'LOCK'
  | 'COUNTER'
  | 'STRIKE'
  | 'RECOVERY'
  | 'STAGGER'
  | 'DEAD';

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
  /** Damages the player on (x, y) once per attack record. */
  hitPlayerAt(attack: Attack, x: number, y: number, damage: number): boolean;
  paralyzePlayer(ticks: number): void;
  placeObject(kind: ObjectKind, x: number, y: number, side: Side): FieldObject | null;
  /** Mettik relay (GDD §8.1): whether this enemy holds its kind's turn. */
  hasTurn(enemy: Enemy): boolean;
  /** The holder hands its kind's turn on. */
  passTurn(enemy: Enemy): void;
  /** One attacker of a kind at a time (GDD §8.1): true if it is (now) this enemy. */
  claimAttack(enemy: Enemy): boolean;
  releaseAttack(enemy: Enemy): void;
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
  /** Tick when a timed phase ends; Infinity for untimed states. */
  stateEndTick = Infinity;
  lastHitTick = -Infinity;
  deathTick = -Infinity;
  /** Ticks left of paralysis: no actions, state timers stand still. */
  paralyzeTicks = 0;
  private collisionResume: {
    state: EnemyState;
    elapsed: number;
    remaining: number;
    timed: boolean;
  } | null = null;

  constructor(
    readonly id: EntityId,
    x: number,
    y: number,
    baseHp: number,
    spawnTick: number,
    readonly level: EnemyLevel = 1,
  ) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.hp = this.maxHp = Math.round(baseHp * ENEMY_LEVELS[level].hp);
    this.stateTick = spawnTick;
  }

  /** A timing tunable in ticks, shortened by the level's speed. */
  protected ticks(seconds: number): number {
    return Math.max(1, secondsToTicks(seconds / ENEMY_LEVELS[this.level].speed));
  }

  /** A damage tunable scaled by the level. */
  protected dmg(base: number): number {
    return Math.round(base * ENEMY_LEVELS[this.level].damage);
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
    this.stateEndTick = Infinity;
  }

  setTimedState(state: EnemyState, tick: number, durationTicks: number): void {
    this.state = state;
    this.stateTick = tick;
    this.stateEndTick = tick + Math.max(0, durationTicks);
  }

  phaseDone(tick: number): boolean {
    return tick >= this.stateEndTick;
  }

  phaseRemaining(tick: number): number {
    return Number.isFinite(this.stateEndTick) ? Math.max(0, this.stateEndTick - tick) : 0;
  }

  freezePhase(ticks = 1): void {
    this.stateTick += ticks;
    if (Number.isFinite(this.stateEndTick)) this.stateEndTick += ticks;
  }

  /** Render interpolation duration matching this level's rounded simulation cadence. */
  moveDurationSeconds(): number {
    return this.ticks(tuning[this.kind].MOVE_TIME) / tuning.sim.SIM_HZ;
  }

  /** Debug "force enemy attack": start the attack sequence as soon as possible. */
  forceAttack(_tick: number): void {}

  /** Targeting cursor to draw (Canodron), or null. */
  cursorCell(): { x: number; y: number; locked: boolean } | null {
    return null;
  }

  /** Cells to highlight as dangerous right now (telegraph); ground attacks stop at holes. */
  dangerCells(_field: Field): Cell[] {
    return [];
  }

  /** True only during the explicit vulnerable phase before Strike. */
  counterWindowOpen(): boolean {
    return this.state === 'COUNTER';
  }

  /** Cancels the pending attack and starts the common Counter stagger. */
  counter(tick: number): boolean {
    if (!this.counterWindowOpen()) return false;
    this.onCountered();
    this.setState('STAGGER', tick);
    return true;
  }

  applyCollisionStagger(tick: number, durationTicks: number): void {
    if (!this.alive) return;
    if (this.state === 'STAGGER' && this.collisionResume) {
      this.stateTick = tick;
      this.stateEndTick = tick + durationTicks;
      return;
    }
    this.collisionResume = {
      state: this.state,
      elapsed: this.elapsed(tick),
      remaining: this.phaseRemaining(tick),
      timed: Number.isFinite(this.stateEndTick),
    };
    this.setTimedState('STAGGER', tick, durationTicks);
  }

  /** Enemy-specific pending attack state can be cleared here. */
  protected onCountered(): void {}

  /** Runs in World even when enemy AI is disabled. */
  updateStagger(ctx: EnemyContext): void {
    if (this.state !== 'STAGGER') return;
    const duration = this.collisionResume
      ? Math.max(0, this.stateEndTick - this.stateTick)
      : secondsToTicks(tuning.counter.COUNTER_STAGGER_TIME);
    if (this.elapsed(ctx.tick) < duration) return;
    if (this.collisionResume) {
      const resume = this.collisionResume;
      this.collisionResume = null;
      this.state = resume.state;
      this.stateTick = ctx.tick - resume.elapsed;
      this.stateEndTick = resume.timed ? ctx.tick + resume.remaining : Infinity;
      return;
    }
    this.finishCounterStagger(ctx);
    this.setState('IDLE', ctx.tick);
  }

  protected finishCounterStagger(_ctx: EnemyContext): void {}

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

  /**
   * A panel the enemy may choose to move onto: its own, standing and free.
   * A player mine is a wall for voluntary moves (GDD §8.1); forced moves ignore this.
   */
  static canEnter(ctx: EnemyContext, x: number, y: number): boolean {
    return ctx.field.canStand('enemy', x, y) && ctx.occupancy.isFree(x, y) && ctx.field.hazard(x, y)?.side !== 'player';
  }

  /** Instant relocation (Hopzap): no slide animation. */
  protected warpTo(ctx: EnemyContext, nx: number, ny: number): boolean {
    if (!Enemy.canEnter(ctx, nx, ny)) return false;
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
    if (!Enemy.canEnter(ctx, nx, ny)) return false;
    ctx.occupancy.move(this.id, this.x, this.y, nx, ny);
    ctx.field.onLeave(this.x, this.y, ctx.tick);
    this.prevX = this.x;
    this.prevY = this.y;
    this.x = nx;
    this.y = ny;
    this.lastMoveTick = ctx.tick;
    return true;
  }

  paralyze(ticks: number): void {
    if (this.alive) this.paralyzeTicks = Math.max(this.paralyzeTicks, ticks);
  }

  /** Knock-back: one row away from the player if the panel allows it. */
  pushBack(ctx: EnemyContext): boolean {
    return this.alive && this.tryStep(ctx, this.x, this.y - 1);
  }

  abstract update(ctx: EnemyContext): void;
}
