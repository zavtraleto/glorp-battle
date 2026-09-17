import type { LoopStats } from '../core/loop';
import type { PerfSnapshot } from './perfProbe';

export interface OverlayInfo {
  stats: LoopStats;
  state: string;
  seed: number;
  battle: number;
  timeScale: number;
  paused: boolean;
  simTime: number;
  extra?: string;
  perf?: PerfSnapshot;
}

/** Text overlay with FPS and simulation info (GDD §15.5). Updated a few times per second. */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private accum = Infinity;
  private minFps = Infinity;
  private minFpsWindow = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    parent.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  update(frameSeconds: number, info: OverlayInfo): void {
    if (!this.visible) return;
    if (info.stats.fps > 0) this.minFps = Math.min(this.minFps, info.stats.fps);
    this.accum += frameSeconds;
    this.minFpsWindow += frameSeconds;
    if (this.minFpsWindow > 5) {
      this.minFpsWindow = 0;
      this.minFps = Infinity;
    }
    if (this.accum < 0.25) return;
    this.accum = 0;

    const s = info.stats;
    const dpr = window.devicePixelRatio || 1;
    const fpsClass = s.fps > 0 && s.fps < 55 ? 'warn' : '';
    const minFps = Number.isFinite(this.minFps) ? this.minFps.toFixed(0) : '-';
    this.el.innerHTML =
      `<span class="${fpsClass}">FPS ${s.fps.toFixed(0)} (min5s ${minFps})</span>\n` +
      `frame ${s.frameMs.toFixed(2)} ms  ticks/f ${s.ticksLastFrame}\n` +
      (info.perf
        ? `cpu p50 ${info.perf.cpuP50.toFixed(2)} p95 ${info.perf.cpuP95.toFixed(2)} ms  ` +
          `gap p95 ${info.perf.intervalP95.toFixed(1)} ms\n` +
          `calls ${info.perf.calls}  tris ${info.perf.triangles}  rt ${(info.perf.textureBytes / 1048576).toFixed(1)} MB  ` +
          `canvas ${info.perf.renderW}×${info.perf.renderH}\n`
        : '') +
      `ticks ${s.totalTicks}  sim ${info.simTime.toFixed(2)} s\n` +
      `state ${info.state}${info.paused ? ' [PAUSED]' : ''}  x${info.timeScale}\n` +
      `battle ${info.battle}  seed ${info.seed}\n` +
      `view ${window.innerWidth}×${window.innerHeight} @${dpr.toFixed(2)}` +
      (info.extra ? `
${info.extra}` : '');
  }
}
