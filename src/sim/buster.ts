import { secondsToTicks, tuning } from '../config/tuning';

// Buster (GDD §4): hitscan shot, cooldown between shots, two charge levels.
// Pure state machine; the world performs the actual hit.

export type ChargeLevel = 0 | 1 | 2;

export class Buster {
  /** Button is physically held. */
  held = false;
  /** Tick when the current charge began; null when not charging. */
  chargeStartTick: number | null = null;
  lastShotTick = -Infinity;
  /** Shot released while on cooldown/locked; fires as soon as possible. */
  pendingLevel: ChargeLevel | null = null;
  shots = 0;

  cooldownTicks(): number {
    return secondsToTicks(tuning.buster.BUSTER_COOLDOWN);
  }

  cooldownRemaining(tick: number): number {
    return Math.max(0, this.cooldownTicks() - (tick - this.lastShotTick));
  }

  chargeTicks(tick: number): number {
    return this.chargeStartTick === null ? 0 : tick - this.chargeStartTick;
  }

  chargeLevel(tick: number): ChargeLevel {
    if (!tuning.buster.CHARGE_ENABLED || this.chargeStartTick === null) return 0;
    const held = this.chargeTicks(tick);
    if (held >= secondsToTicks(tuning.buster.CHARGE_T2)) return 2;
    if (held >= secondsToTicks(tuning.buster.CHARGE_T1)) return 1;
    return 0;
  }

  static damageFor(level: ChargeLevel): number {
    const b = tuning.buster;
    const mult = level === 2 ? b.CHARGE_MULT_2 : level === 1 ? b.CHARGE_MULT_1 : 1;
    return b.BUSTER_DAMAGE * mult;
  }

  press(tick: number, flinched: boolean): void {
    if (this.held) return;
    this.held = true;
    this.chargeStartTick = flinched ? null : tick;
  }

  release(tick: number): void {
    if (!this.held) return;
    this.held = false;
    // A tap/hold that happened entirely during a flinch produces nothing.
    if (this.chargeStartTick === null) return;
    this.pendingLevel = this.chargeLevel(tick);
    this.chargeStartTick = null;
  }

  /** Flinch cancels the charge and any queued shot (GDD §4.1). */
  cancel(): void {
    this.chargeStartTick = null;
    this.pendingLevel = null;
  }

  /**
   * Advances one tick. `fire` is called when a queued shot goes off.
   * @param flinched player is stunned: charge is lost, nothing fires
   * @param acting player is busy with a chip: charge keeps building, shots wait
   */
  update(tick: number, flinched: boolean, acting: boolean, fire: (level: ChargeLevel) => void): void {
    if (flinched) {
      this.cancel();
      return;
    }
    // Still holding after a flinch: start charging again.
    if (this.held && this.chargeStartTick === null) this.chargeStartTick = tick;

    if (this.pendingLevel !== null && !acting && this.cooldownRemaining(tick) === 0) {
      const level = this.pendingLevel;
      this.pendingLevel = null;
      this.lastShotTick = tick;
      this.shots++;
      fire(level);
    }
  }
}
