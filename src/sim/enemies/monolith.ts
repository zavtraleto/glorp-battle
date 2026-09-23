import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { CannonBall } from '../attacks/cannonBall';
import { Shockwave } from '../attacks/shockwave';
import { COLS, ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Monolith (StoneMan, MMBN1) — roguelite spec §5.3. The act boss.
// Drifts around its area; every MONO_ATTACK_INTERVAL it telegraphs one of:
// rockfall on the player's panels, a rock cube in the player's area, or a
// ground quake down the player's lane that cracks panels. Below half HP the
// rockfall grows and attacks come faster.

type MonolithAttack = 'rocks' | 'cube' | 'quake';
const ATTACKS: readonly MonolithAttack[] = ['rocks', 'cube', 'quake'];

export class Monolith extends Enemy {
  readonly kind = 'monolith';
  private nextAttackTick: number;
  private attack: MonolithAttack = 'rocks';
  private targets: Cell[] = [];

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.monolith.MONO_HP, spawnTick, level);
    this.nextAttackTick = spawnTick + this.interval();
  }

  get enraged(): boolean {
    return this.hp * 2 < this.maxHp;
  }

  private interval(): number {
    const m = tuning.monolith;
    return this.ticks(m.MONO_ATTACK_INTERVAL / (this.enraged ? m.MONO_RAGE_SPEED : 1));
  }

  override dangerCells(): Cell[] {
    return this.state === 'LOCK' || this.state === 'COUNTER' ? this.targets : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) {
      this.nextAttackTick = tick;
      this.setTimedState('INTENTION', tick, this.ticks(tuning.monolith.INTENTION_TIME));
    }
  }

  /** Free panels of the player's area, in field order. */
  private playerCells(ctx: EnemyContext, includePlayer: boolean): Cell[] {
    const cells: Cell[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!ctx.field.canStand('player', x, y)) continue;
        const isPlayer = x === ctx.player.x && y === ctx.player.y;
        if (isPlayer ? includePlayer : ctx.occupancy.isFree(x, y)) cells.push({ x, y });
      }
    }
    return cells;
  }

  private lockTargets(ctx: EnemyContext): void {
    const m = tuning.monolith;
    const p = ctx.player;
    switch (this.attack) {
      case 'rocks': {
        const count = this.enraged ? m.MONO_ROCKS_RAGE : m.MONO_ROCKS;
        const pool = ctx.rngAi.shuffle(this.playerCells(ctx, false));
        this.targets = [{ x: p.x, y: p.y }, ...pool.slice(0, Math.max(0, count - 1))];
        return;
      }
      case 'cube': {
        const pool = this.playerCells(ctx, false);
        this.targets = pool.length > 0 ? [ctx.rngAi.pick(pool)] : [];
        return;
      }
      case 'quake':
        this.targets = laneCellsBelow(p.x, this.y + 1);
        return;
    }
  }

  protected override onCountered(): void {
    this.targets = [];
  }

  protected override finishCounterStagger(ctx: EnemyContext): void {
    this.nextAttackTick = ctx.tick + this.interval();
  }

  private strike(ctx: EnemyContext): void {
    const m = tuning.monolith;
    const t = ctx.tick;
    switch (this.attack) {
      case 'rocks':
        ctx.spawnAttack(
          new CannonBall(ctx.nextAttackId(), 'rockfall', this.x, this.y, this.targets, t, {
            damage: this.dmg(m.MONO_ROCK_DMG),
            cellTravelTicks: this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
            panel: 'crack',
          }),
        );
        return;
      case 'cube':
        for (const c of this.targets) ctx.placeObject('rock', c.x, c.y, 'enemy');
        return;
      case 'quake': {
        const x = this.targets[0]?.x ?? this.x;
        ctx.spawnAttack(
          new Shockwave(ctx.nextAttackId(), x, this.y + 1, t, {
            dir: 1,
            damage: this.dmg(m.MONO_WAVE_DMG),
            stepTicks: this.ticks(tuning.projectile.CELL_TRAVEL_TIME),
            owner: 'enemy',
            crack: true,
          }),
        );
        return;
      }
    }
  }

  private drift(ctx: EnemyContext): void {
    const dirs = ctx.rngAi.shuffle([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
    for (const [dx, dy] of dirs) {
      if (this.tryStep(ctx, this.x + (dx as number), this.y + (dy as number))) return;
    }
  }

  update(ctx: EnemyContext): void {
    const m = tuning.monolith;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE':
        if (t >= this.nextAttackTick) {
          this.attack = ctx.rngAi.pick(ATTACKS);
          this.setTimedState('INTENTION', t, this.ticks(m.INTENTION_TIME));
          return;
        }
        if (this.elapsed(t) < this.ticks(m.MOVE_TIME)) return;
        this.stateTick = t;
        this.drift(ctx);
        return;
      case 'INTENTION':
        if (!this.phaseDone(t)) return;
        this.lockTargets(ctx);
        this.setTimedState('LOCK', t, this.ticks(m.LOCK_TIME));
        return;
      case 'LOCK':
        if (this.phaseDone(t)) this.setTimedState('COUNTER', t, this.ticks(m.COUNTER_TIME));
        return;
      case 'COUNTER':
        if (!this.phaseDone(t)) return;
        this.strike(ctx);
        this.setTimedState('STRIKE', t, this.ticks(m.STRIKE_TIME));
        return;
      case 'STRIKE':
        if (!this.phaseDone(t)) return;
        this.targets = [];
        this.setTimedState('RECOVERY', t, this.ticks(m.RECOVERY_TIME));
        return;
      case 'RECOVERY':
        if (!this.phaseDone(t)) return;
        this.nextAttackTick = t + this.interval();
        this.setState('IDLE', t);
        return;
      case 'STAGGER':
      case 'DEAD':
        return;
    }
  }
}
