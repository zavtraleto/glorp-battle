// Fixed-timestep simulation with interpolated rendering (GDD §15.1).
// The simulation always advances in whole ticks of 1/SIM_HZ seconds;
// rendering runs at display rate and receives an interpolation alpha.

export interface LoopOptions {
  hz: number;
  /** Frames longer than this (e.g. tab was hidden) are clamped to avoid a tick burst. */
  maxFrameTime: number;
}

export interface LoopStats {
  fps: number;
  frameMs: number;
  ticksLastFrame: number;
  totalTicks: number;
}

export class FixedStepClock {
  private accumulator = 0;
  private pendingSteps = 0;
  totalTicks = 0;
  timeScale = 1;
  paused = false;

  constructor(public options: LoopOptions) {}

  get dt(): number {
    return 1 / this.options.hz;
  }

  /** Queue single ticks to run while paused (debug frame step). */
  stepOnce(count = 1): void {
    this.pendingSteps += count;
  }

  /**
   * Advances the clock by a real frame duration and returns how many
   * simulation ticks must run now. `alpha` is valid after the call.
   */
  advance(frameSeconds: number): number {
    const frame = Math.min(Math.max(frameSeconds, 0), this.options.maxFrameTime);
    let ticks = 0;
    if (this.paused) {
      ticks = this.pendingSteps;
      this.pendingSteps = 0;
      this.accumulator = 0;
    } else {
      this.accumulator += frame * this.timeScale;
      const dt = this.dt;
      while (this.accumulator >= dt) {
        this.accumulator -= dt;
        ticks++;
      }
    }
    this.totalTicks += ticks;
    return ticks;
  }

  get alpha(): number {
    return this.paused ? 1 : this.accumulator / this.dt;
  }
}

export interface GameLoopCallbacks {
  tick(dt: number): void;
  render(alpha: number, frameSeconds: number): void;
}

export class GameLoop {
  readonly clock: FixedStepClock;
  readonly stats: LoopStats = { fps: 0, frameMs: 0, ticksLastFrame: 0, totalTicks: 0 };
  private lastTime = -1;
  private rafId = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(options: LoopOptions, private callbacks: GameLoopCallbacks) {
    this.clock = new FixedStepClock(options);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      const seconds = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.frame(seconds, now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
    this.lastTime = -1;
  }

  private frame(seconds: number, now: number): void {
    const ticks = this.clock.advance(seconds);
    const dt = this.clock.dt;
    for (let i = 0; i < ticks; i++) this.callbacks.tick(dt);
    this.callbacks.render(this.clock.alpha, seconds);
    this.stats.frameMs = performance.now() - now;
    this.stats.ticksLastFrame = ticks;
    this.stats.totalTicks = this.clock.totalTicks;

    this.fpsFrames++;
    this.fpsTime += seconds;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}
