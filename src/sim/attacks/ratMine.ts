import { inField } from '../grid';
import type { Attack, AttackContext } from './attack';

// Rattik's mine (Ratty, MMBN1; roguelite spec §5.2): runs down its lane; on
// the player's row it turns once toward the player and runs to the edge.
// It needs a floor: a hole stops it, and so does an object.

export class RatMine implements Attack {
  readonly kind = 'ratmine';
  readonly hitIds = new Set<number>();
  done = false;
  prevX: number;
  prevY: number;
  lastStepTick: number;
  private dx = 0;
  private dy = 1;
  private turned = false;

  constructor(
    readonly id: number,
    public x: number,
    public y: number,
    spawnTick: number,
    readonly stepTicks: number,
    private readonly damage: number,
  ) {
    this.prevX = x;
    this.prevY = y;
    this.lastStepTick = spawnTick;
  }

  update(ctx: AttackContext): void {
    if (this.done) return;
    if (ctx.tick - this.lastStepTick >= this.stepTicks) {
      const p = ctx.player;
      if (!this.turned && this.y === p.y && this.x !== p.x) {
        this.turned = true;
        this.dx = Math.sign(p.x - this.x);
        this.dy = 0;
      }
      this.prevX = this.x;
      this.prevY = this.y;
      this.x += this.dx;
      this.y += this.dy;
      this.lastStepTick = ctx.tick;
      if (!inField(this.x, this.y) || ctx.field.panel(this.x, this.y) === 'BROKEN') {
        this.done = true;
        return;
      }
    }
    if (ctx.hitObjectAt(this, this.x, this.y, this.damage) || ctx.hitPlayerAt(this, this.x, this.y, this.damage)) {
      this.done = true;
    }
  }
}
