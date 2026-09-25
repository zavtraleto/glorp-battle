import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { LaneShot } from '../attacks/laneShot';
import { COLS, ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

type HopzapIntent =
  | { kind: 'hop'; landing: Cell }
  | { kind: 'zapring'; origin: Cell };

// Hopzap (Bunny, MMBN3) — roguelite spec §5.2.
// Commits one biased-random hop or one fixed-lane ZapRing per decision.

export class Hopzap extends Enemy {
  readonly kind = 'hopzap';
  private intent: HopzapIntent | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.hopzap.HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    if ((this.state !== 'LOCK' && this.state !== 'COUNTER') || this.intent?.kind !== 'zapring') return [];
    return laneCellsBelow(this.intent.origin.x, this.intent.origin.y);
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.commitZapRing(tick);
    }
  }

  protected override onCountered(): void {
    this.intent = null;
  }

  private commitZapRing(tick: number): void {
    this.intent = { kind: 'zapring', origin: { x: this.x, y: this.y + 1 } };
    this.setTimedState('INTENTION', tick, this.ticks(tuning.hopzap.INTENTION_TIME));
  }

  private chooseLanding(ctx: EnemyContext, sampledLane: number): Cell | null {
    const aligned: Cell[] = [];
    const other: Cell[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (x === this.x && y === this.y) continue;
        if (!Enemy.canEnter(ctx, x, y)) continue;
        (x === sampledLane ? aligned : other).push({ x, y });
      }
    }
    if (aligned.length === 0 && other.length === 0) return null;
    if (aligned.length === 0) return ctx.rngAi.pick(other);
    if (other.length === 0) return ctx.rngAi.pick(aligned);
    return ctx.rngAi.pick(ctx.rngAi.next() < tuning.hopzap.ALIGN_CHANCE ? aligned : other);
  }

  private decide(ctx: EnemyContext): void {
    const sampledLane = ctx.player.x;
    if (this.x === sampledLane) {
      this.commitZapRing(ctx.tick);
      return;
    }
    const landing = this.chooseLanding(ctx, sampledLane);
    if (!landing) {
      this.setState('IDLE', ctx.tick);
      return;
    }
    this.intent = { kind: 'hop', landing };
    this.setTimedState('MOVE', ctx.tick, this.ticks(tuning.hopzap.MOVE_TIME));
  }

  update(ctx: EnemyContext): void {
    const h = tuning.hopzap;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
        if (this.elapsed(t) < this.ticks(h.SETTLE_TIME)) return;
        this.decide(ctx);
        return;
      case 'MOVE': {
        if (!this.phaseDone(t)) return;
        const landing = this.intent?.kind === 'hop' ? this.intent.landing : null;
        this.intent = null;
        if (landing) this.warpTo(ctx, landing.x, landing.y);
        this.setState('IDLE', t);
        return;
      }
      case 'INTENTION':
        if (this.phaseDone(t)) this.setTimedState('LOCK', t, this.ticks(h.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(h.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        if (this.intent?.kind !== 'zapring') {
          this.setState('IDLE', t);
          return;
        }
        ctx.spawnAttack(
          new LaneShot(ctx.nextAttackId(), 'zapring', this.intent.origin.x, this.intent.origin.y, t, {
            damage: this.dmg(h.DMG),
            stepTicks: this.ticks(h.RING_CELL_TIME),
            paralyze: this.ticks(h.PARALYZE),
          }),
        );
        this.setTimedState('STRIKE', t, this.ticks(h.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (this.phaseDone(t)) this.setTimedState('RECOVERY', t, this.ticks(h.RECOVERY_TIME));
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
