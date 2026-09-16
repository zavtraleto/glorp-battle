import { secondsToTicks, tuning } from '../config/tuning';

// Custom Gauge (GDD §5): fills linearly during ACTION only, stays full until the Custom Screen opens.

export class Gauge {
  /** Ticks accumulated toward a full gauge. */
  private ticks = 0;

  get fillTicks(): number {
    return Math.max(1, secondsToTicks(tuning.gauge.GAUGE_FILL_TIME));
  }

  get value(): number {
    return Math.min(1, this.ticks / this.fillTicks);
  }

  get full(): boolean {
    return this.ticks >= this.fillTicks;
  }

  tick(): void {
    if (!this.full) this.ticks++;
  }

  fill(): void {
    this.ticks = this.fillTicks;
  }

  reset(): void {
    this.ticks = 0;
  }
}
