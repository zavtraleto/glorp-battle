// Frame-time percentiles and GPU counters for the terminal budget (TERMINAL.md §10).

export interface PerfSnapshot {
  frames: number;
  /** ms between frames */
  intervalP50: number;
  intervalP95: number;
  /** ms spent in tick + render */
  cpuP50: number;
  cpuP95: number;
  /** last frame */
  calls: number;
  triangles: number;
  /** estimated, render targets only */
  textureBytes: number;
  /** canvas backing size */
  renderW: number;
  renderH: number;
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export class PerfProbe {
  private intervals: number[] = [];
  private cpu: number[] = [];
  private gpu = { calls: 0, triangles: 0, textureBytes: 0, renderW: 0, renderH: 0 };

  constructor(private capacity = 600) {}

  record(intervalMs: number, cpuMs: number): void {
    this.intervals.push(intervalMs);
    this.cpu.push(cpuMs);
    if (this.intervals.length > this.capacity) {
      this.intervals.shift();
      this.cpu.shift();
    }
  }

  setGpu(calls: number, triangles: number, textureBytes: number, renderW: number, renderH: number): void {
    this.gpu = { calls, triangles, textureBytes, renderW, renderH };
  }

  snapshot(): PerfSnapshot {
    const iv = [...this.intervals].sort((a, b) => a - b);
    const cpu = [...this.cpu].sort((a, b) => a - b);
    return {
      frames: iv.length,
      intervalP50: percentile(iv, 50),
      intervalP95: percentile(iv, 95),
      cpuP50: percentile(cpu, 50),
      cpuP95: percentile(cpu, 95),
      ...this.gpu,
    };
  }

  reset(): void {
    this.intervals = [];
    this.cpu = [];
  }
}
