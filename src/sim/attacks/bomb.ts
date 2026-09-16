import { secondsToTicks, tuning } from '../../config/tuning';

// Player MiniBomb in flight (GDD §6.4 `lob_3`): lands after BOMB_FLIGHT_TIME and
// damages whatever enemy stands on the landing cell at that moment.

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
  ) {
    this.landTick = throwTick + Math.max(1, secondsToTicks(tuning.chips.BOMB_FLIGHT_TIME));
  }

  /** Flight progress in [0, 1]. */
  progress(tick: number, alpha = 0): number {
    return Math.min(1, Math.max(0, (tick - this.throwTick + alpha) / (this.landTick - this.throwTick)));
  }
}
