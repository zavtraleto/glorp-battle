import { secondsToTicks, tuning } from '../../config/tuning';
import type { ChipDef } from '../../data/chips';

// Player bomb in flight (GDD §6.4 lob): lands after BOMB_FLIGHT_TIME and hits
// its chip's area around the landing cell.

export class PlayerBomb {
  readonly landTick: number;
  done = false;

  constructor(
    readonly id: number,
    readonly fromX: number,
    readonly fromY: number,
    readonly x: number,
    readonly y: number,
    readonly damage: number,
    readonly throwTick: number,
    readonly def: ChipDef,
  ) {
    this.landTick = throwTick + Math.max(1, secondsToTicks(tuning.chips.BOMB_FLIGHT_TIME));
  }

  /** Flight progress in [0, 1]. */
  progress(tick: number, alpha = 0): number {
    return Math.min(1, Math.max(0, (tick - this.throwTick + alpha) / (this.landTick - this.throwTick)));
  }
}
