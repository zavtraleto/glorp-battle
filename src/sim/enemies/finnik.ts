import { tuning } from '../../config/tuning';
import type { EnemyLevel } from '../../data/enemies';
import { LaneShot } from '../attacks/laneShot';
import { COLS, ROWS, laneCellsBelow, type Cell } from '../grid';
import { Enemy, type EnemyContext } from './enemyBase';

// Finnik (Fishy, MMBN1) — roguelite spec §5.2.
// Steps toward the player's lane, telegraphs, then dashes through the whole
// lane. During the dash it leaves its panel and cannot be hit; afterwards it
// returns to its panel, or the nearest free panel of its area.

export class Finnik extends Enemy {
  readonly kind = 'finnik';
  private dash: LaneShot | null = null;

  constructor(id: number, x: number, y: number, spawnTick: number, level: EnemyLevel = 1) {
    super(id, x, y, tuning.finnik.FIN_HP, spawnTick, level);
  }

  override dangerCells(): Cell[] {
    return this.state === 'TELEGRAPH' ? laneCellsBelow(this.x, this.y + 1) : [];
  }

  override forceAttack(tick: number): void {
    if (this.alive && (this.state === 'IDLE' || this.state === 'MOVE')) this.setState('TELEGRAPH', tick);
  }

  /** Back on the field: own panel if free, else the nearest free one. */
  private land(ctx: EnemyContext): boolean {
    const free = (x: number, y: number) => ctx.field.canStand('enemy', x, y) && ctx.occupancy.isFree(x, y);
    let best: Cell | null = free(this.x, this.y) ? { x: this.x, y: this.y } : null;
    if (!best) {
      let bestD = Infinity;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const d = Math.abs(x - this.x) + Math.abs(y - this.y);
          if (d < bestD && free(x, y)) {
            best = { x, y };
            bestD = d;
          }
        }
      }
    }
    if (!best) return false;
    this.x = this.prevX = best.x;
    this.y = this.prevY = best.y;
    ctx.occupancy.place(this.id, best.x, best.y);
    this.offField = false;
    this.guarded = false;
    return true;
  }

  update(ctx: EnemyContext): void {
    const f = tuning.finnik;
    const t = ctx.tick;
    switch (this.state) {
      case 'IDLE':
      case 'MOVE': {
        if (this.elapsed(t) < this.ticks(f.FIN_MOVE_INTERVAL)) return;
        this.stateTick = t;
        const px = ctx.player.x;
        if (this.x === px) {
          this.setState('TELEGRAPH', t);
          return;
        }
        this.state = this.tryStep(ctx, this.x + Math.sign(px - this.x), this.y) ? 'MOVE' : 'IDLE';
        return;
      }
      case 'TELEGRAPH':
        if (this.elapsed(t) < this.ticks(f.FIN_TELEGRAPH)) return;
        ctx.occupancy.remove(this.id, this.x, this.y);
        ctx.field.onLeave(this.x, this.y, t);
        this.offField = true;
        this.guarded = true;
        this.dash = new LaneShot(ctx.nextAttackId(), 'dash', this.x, this.y, t, {
          damage: this.dmg(f.FIN_DMG),
          stepTicks: this.ticks(f.FIN_DASH_STEP),
        });
        ctx.spawnAttack(this.dash);
        this.setState('ATTACK', t);
        return;
      case 'ATTACK':
        if (this.dash && !this.dash.done) return;
        if (!this.land(ctx)) return;
        this.dash = null;
        this.setState('RECOVERY', t);
        return;
      case 'RECOVERY':
        if (this.elapsed(t) >= this.ticks(f.FIN_RECOVERY)) this.setState('IDLE', t);
        return;
      case 'DEAD':
        return;
    }
  }
}
