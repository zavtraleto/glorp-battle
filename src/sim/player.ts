import { secondsToTicks, tuning } from '../config/tuning';
import { DIR_VECTORS, type Dir } from '../core/input/commands';
import type { Field } from './field';
import type { EntityId, Occupancy } from './occupancy';

// Player (GDD §3): one-cell steps inside the player territory, instant logical
// move, cooldown, one buffered direction, keyboard hold-to-repeat; flinch and i-frames (§9).

export const PLAYER_ID: EntityId = 1;

export class Player {
  readonly id = PLAYER_ID;
  x: number;
  y: number;
  hp: number;
  maxHp: number;

  /** Cell the player left on the last step (for render interpolation). */
  prevX: number;
  prevY: number;
  /** Tick at which the last step started; -Infinity if never moved. */
  lastMoveTick = -Infinity;
  /** Direction queued while movement was on cooldown (only the latest is kept). */
  bufferedDir: Dir | null = null;
  /** Remaining ticks of stun after a hit: no movement, no chips. */
  flinchTicks = 0;
  /** Remaining ticks of invulnerability after a hit. */
  iframeTicks = 0;
  /** Remaining ticks of Invis: enemy attacks pass through. */
  invisTicks = 0;
  /** One charge that fully absorbs the next damaging hit. */
  guard = false;
  /** Remaining ticks of paralysis: no movement or chips, no i-frames. */
  paralyzeTicks = 0;
  /** Remaining ticks of a chip animation; movement remains available. */
  actionTicks = 0;
  lastHitTick = -Infinity;
  moves = 0;
  hitsTaken = 0;
  /** True once a held direction has produced a step; switches to the shorter repeat interval. */
  private repeating = false;

  constructor(
    private occupancy: Occupancy,
    private field: Field,
    hp?: number,
  ) {
    this.x = this.prevX = tuning.player.PLAYER_START_X;
    this.y = this.prevY = tuning.player.PLAYER_START_Y;
    this.maxHp = tuning.player.PLAYER_MAX_HP;
    this.hp = Math.min(this.maxHp, hp ?? this.maxHp);
    occupancy.place(this.id, this.x, this.y);
  }

  get flinched(): boolean {
    return this.flinchTicks > 0;
  }

  get invulnerable(): boolean {
    return this.iframeTicks > 0;
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  canStep(dir: Dir): boolean {
    const v = DIR_VECTORS[dir];
    const nx = this.x + v.dx;
    const ny = this.y + v.dy;
    return this.field.canStand('player', nx, ny) && this.occupancy.isFree(nx, ny);
  }

  /** Applies a hit. Callers must check `invulnerable` first. */
  takeHit(amount: number, tick: number): void {
    this.hp = Math.max(0, this.hp - amount);
    this.flinchTicks = secondsToTicks(tuning.player.PLAYER_FLINCH_TIME);
    this.iframeTicks = secondsToTicks(tuning.player.PLAYER_IFRAMES);
    this.actionTicks = 0;
    this.bufferedDir = null;
    this.lastHitTick = tick;
    this.hitsTaken++;
  }

  private cooldownReady(tick: number): boolean {
    return tick - this.lastMoveTick >= secondsToTicks(tuning.player.CELL_MOVE_TIME);
  }

  /** Performs a step if possible. Blocked steps do nothing (no cooldown, no buffer). */
  private step(dir: Dir, tick: number): boolean {
    if (!this.canStep(dir)) return false;
    const v = DIR_VECTORS[dir];
    this.prevX = this.x;
    this.prevY = this.y;
    this.occupancy.move(this.id, this.x, this.y, this.x + v.dx, this.y + v.dy);
    this.x += v.dx;
    this.y += v.dy;
    this.field.onLeave(this.prevX, this.prevY, tick, 'player');
    this.lastMoveTick = tick;
    this.moves++;
    return true;
  }

  /** Counts down stun/i-frame/action timers. Call once per tick before `updateMovement`. */
  updateTimers(): void {
    if (this.flinchTicks > 0) this.flinchTicks--;
    if (this.iframeTicks > 0) this.iframeTicks--;
    if (this.invisTicks > 0) this.invisTicks--;
    if (this.paralyzeTicks > 0) this.paralyzeTicks--;
    if (this.actionTicks > 0) this.actionTicks--;
  }

  /**
   * Movement for one tick.
   * @param pressed discrete move presses received this tick, in order
   * @param held direction currently held by any device
   */
  updateMovement(tick: number, pressed: readonly Dir[], held: Dir | null): void {
    if (pressed.length > 0) this.bufferedDir = pressed[pressed.length - 1] as Dir;

    if (this.flinchTicks > 0 || this.paralyzeTicks > 0) {
      // Presses during a lock are dropped, not replayed afterwards.
      this.bufferedDir = null;
      return;
    }
    if (!this.cooldownReady(tick)) return;

    if (this.bufferedDir) {
      const dir = this.bufferedDir;
      this.bufferedDir = null;
      if (this.step(dir, tick)) this.repeating = false;
      return;
    }

    if (!held) {
      this.repeating = false;
      return;
    }
    const wait = this.repeating ? tuning.input.HOLD_REPEAT : tuning.input.HOLD_REPEAT_DELAY;
    if (tick - this.lastMoveTick >= secondsToTicks(wait) && this.step(held, tick)) {
      this.repeating = true;
    }
  }
}
