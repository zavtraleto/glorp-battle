import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { Shockwave } from '../attacks/shockwave';
import type { Field } from '../field';
import { groundCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';
import type { TelegraphKind } from './telegraph';

type MettikIntent = { kind: 'move'; destination: Cell } | { kind: 'shockwave'; origin: Cell };

// Mettik (Mettaur, MMBN6) — GDD §8.2. Mettik take turns (`EnemyContext.hasTurn`):
// only the holder acts, the rest stand. Before every action the holder waits
// ACTION_DELAY, then steps one cell toward the player's lane or, on it,
// strikes. The turn goes on with the wave, after CHASE_STEPS steps without
// a strike, when it cannot step, and when it is countered.

export class Mettik extends Enemy {
  readonly kind = 'mettik';
  private intent: MettikIntent | null = null;
  /** Steps taken in this turn without striking. */
  private chased = 0;
  /** The turn is to be handed on at the next update (set where no context is at hand). */
  private passPending = false;
  /** Stood without the turn; the action delay restarts when it arrives. */
  private waiting = false;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.mettik.HP, spawnTick, level);
  }

  protected override telegraphShape(field: Field): { kind: TelegraphKind; cells: Cell[] } | null {
    if (this.intent?.kind !== 'shockwave') return null;
    const { x, y } = this.intent.origin;
    return { kind: 'lane', cells: groundCellsBelow(x, y, (cx, cy) => field.panel(cx, cy) === 'BROKEN') };
  }

  protected override onCountered(): void {
    this.intent = null;
    this.passPending = true;
  }

  /** Starts the attack now if possible (debug "force attack"); ignores the turn. */
  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.commitShockwave(tick);
    }
  }

  private commitShockwave(tick: number): void {
    this.chased = 0;
    this.intent = { kind: 'shockwave', origin: { x: this.x, y: this.y + 1 } };
    this.setTimedState('INTENTION', tick, this.ticks(tuning.mettik.INTENTION_TIME));
  }

  private handOn(ctx: EnemyContext): void {
    this.chased = 0;
    this.passPending = false;
    ctx.passTurn(this);
  }

  private decide(ctx: EnemyContext): void {
    const lane = ctx.player.x;
    if (this.x === lane) {
      this.commitShockwave(ctx.tick);
      return;
    }
    const destination = { x: this.x + Math.sign(lane - this.x), y: this.y };
    if (this.chased < tuning.mettik.CHASE_STEPS && this.tryStep(ctx, destination.x, destination.y)) {
      this.chased++;
      this.intent = { kind: 'move', destination };
      this.setTimedState('MOVE', ctx.tick, this.ticks(tuning.mettik.MOVE_TIME));
      return;
    }
    // Chased long enough, or blocked: someone else's turn.
    this.handOn(ctx);
    this.setState('IDLE', ctx.tick);
  }

  update(ctx: EnemyContext): void {
    const m = tuning.mettik;
    const t = ctx.tick;
    if (this.passPending) this.handOn(ctx);
    switch (this.state) {
      case 'IDLE': {
        // Without the turn it stands; the wait starts when the turn comes.
        if (!ctx.hasTurn(this)) {
          this.waiting = true;
          return;
        }
        if (this.waiting) {
          this.waiting = false;
          this.setState('IDLE', t);
        }
        if (this.elapsed(t) < this.ticks(m.ACTION_DELAY)) return;
        this.decide(ctx);
        return;
      }
      case 'MOVE':
        if (!this.phaseDone(t)) return;
        this.intent = null;
        this.setState('IDLE', t);
        return;
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(m.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(m.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        if (this.intent?.kind !== 'shockwave') {
          this.setState('IDLE', t);
          return;
        }
        ctx.spawnAttack(
          new Shockwave(ctx.nextAttackId(), this.intent.origin.x, this.intent.origin.y, t, {
            dir: 1,
            damage: this.dmg(m.DMG),
            stepTicks: this.ticks(m.WAVE_CELL_TIME),
          }),
        );
        if (m.HANDOFF_ON_WAVE) this.handOn(ctx);
        this.setTimedState('STRIKE', t, this.ticks(m.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(m.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (!this.phaseDone(t)) return;
        this.intent = null;
        if (!m.HANDOFF_ON_WAVE) this.handOn(ctx);
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
