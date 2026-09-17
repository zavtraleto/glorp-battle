import type { Command, Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import type { PerfSnapshot } from './perfProbe';

// ?bench=1 (TERMINAL.md §14): plays battle 1 with random moves and chip uses
// for a fixed time so the frame budget can be measured on a real phone.

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const MOVE_EVERY = 0.35;
const CHIP_EVERY = 1.3;

export interface BenchResult {
  seconds: number;
  snapshot: PerfSnapshot;
}

export class BenchAutopilot {
  private readonly rng: Rng;
  private elapsed = 0;
  private nextMove = MOVE_EVERY;
  private nextChip = CHIP_EVERY;

  constructor(
    seed: number,
    readonly duration = 20,
  ) {
    this.rng = new Rng(seed);
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  /** Called once per frame; returns the commands to push. */
  frame(dt: number): Command[] {
    if (this.done) return [];
    this.elapsed += dt;
    const out: Command[] = [];
    if (this.elapsed >= this.nextMove) {
      this.nextMove += MOVE_EVERY;
      out.push({ type: 'move', dir: this.rng.pick(DIRS) });
    }
    if (this.elapsed >= this.nextChip) {
      this.nextChip += CHIP_EVERY;
      out.push({ type: 'useChip' });
    }
    return out;
  }
}

export function formatBench(r: BenchResult): string {
  const s = r.snapshot;
  return (
    `BENCH ${r.seconds}s  frames ${s.frames}\n` +
    `cpu p50 ${s.cpuP50.toFixed(2)} ms  cpu p95 ${s.cpuP95.toFixed(2)} ms\n` +
    `gap p50 ${s.intervalP50.toFixed(1)} ms  gap p95 ${s.intervalP95.toFixed(1)} ms\n` +
    `calls ${s.calls}  tris ${s.triangles}  rt ${(s.textureBytes / 1048576).toFixed(1)} MB  canvas ${s.renderW}×${s.renderH}`
  );
}
