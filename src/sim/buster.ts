import { secondsToTicks, tuning } from '../config/tuning';

// Auto Buster timer (roguelite spec §2): one shot per BUSTER_INTERVAL while the
// player is free. A blocked shot waits; shots never stack.

export class Buster {
  private wait = Math.max(1, secondsToTicks(tuning.buster.BUSTER_INTERVAL));

  /** Advances one sim tick; returns true when a shot fires now. */
  tick(blocked: boolean): boolean {
    if (this.wait > 0) this.wait--;
    if (blocked || this.wait > 0) return false;
    this.wait = Math.max(1, secondsToTicks(tuning.buster.BUSTER_INTERVAL));
    return true;
  }
}
