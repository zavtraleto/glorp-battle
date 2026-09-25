import type { LoopStats } from '../core/loop';
import type { Enemy } from '../sim/enemies/enemyBase';
import type { GestureStats } from '../terminal/interaction/pointerRouter';
import type { PerfSnapshot } from './perfProbe';

const DIR_LETTER = { up: 'U', down: 'D', left: 'L', right: 'R' } as const;

/**
 * Trackball gestures, newest first: distance, time, fired steps and the cells
 * the player actually moved from its start until the next gesture began.
 */
export function gestureLines(gestures: readonly GestureStats[], playerMoves: number): string {
  return gestures
    .map((g, i) => {
      const steps = g.steps.map((d) => DIR_LETTER[d]).join('') || '-';
      const until = gestures[i - 1]?.movesAtStart ?? playerMoves;
      return `${g.active ? '>' : ' '}swipe ${Math.round(g.net)}px path ${Math.round(g.path)} ${Math.round(g.duration * 1000)}ms` +
        ` cmd ${g.steps.length} ${steps} moved ${Math.max(0, until - g.movesAtStart)}`;
    })
    .join('\n');
}

/** Pure playtest diagnostic: current timing phase and time to its deadline. */
export function enemyTimingLines(enemies: readonly Enemy[], tick: number, simHz: number): string {
  return enemies
    .map((enemy) => `${enemy.kind}#${enemy.id} ${enemy.state} ${Math.round((enemy.phaseRemaining(tick) * 1000) / simHz)}ms`)
    .join('\n');
}

export interface OverlayInfo {
  stats: LoopStats;
  state: string;
  seed: number;
  battle: number;
  timeScale: number;
  paused: boolean;
  simTime: number;
  /** Dead-time line (debug/deadTime.ts). */
  deadTime: string;
  extra?: string;
  perf?: PerfSnapshot;
}

const EXPANDED_KEY = 'glorp.debug.overlay.expanded';

/**
 * Stats overlay (GDD §15.5): two lines (FPS, state, dead time) over the CRT
 * bezel; a tap expands the full diagnostics. Updated a few times per second.
 */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private accum = Infinity;
  private minFps = Infinity;
  private minFpsWindow = 0;
  private expanded = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    try {
      this.expanded = localStorage.getItem(EXPANDED_KEY) === '1';
    } catch {
      // storage unavailable
    }
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.expanded = !this.expanded;
      this.accum = Infinity;
      try {
        localStorage.setItem(EXPANDED_KEY, this.expanded ? '1' : '0');
      } catch {
        // storage unavailable
      }
    });
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
    const fpsClass = s.fps > 0 && s.fps < 55 ? 'warn' : '';
    const minFps = Number.isFinite(this.minFps) ? this.minFps.toFixed(0) : '-';
    const head =
      `<span class="${fpsClass}">FPS ${s.fps.toFixed(0)} min ${minFps}</span>` +
      ` · ${info.state}${info.paused ? ' [PAUSED]' : ''} · x${info.timeScale} ${this.expanded ? '▴' : '▾'}\n` +
      info.deadTime;
    if (!this.expanded) {
      this.el.innerHTML = head;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.el.innerHTML =
      head + '\n' +
      `frame ${s.frameMs.toFixed(2)} ms  ticks/f ${s.ticksLastFrame}\n` +
      (info.perf
        ? `cpu p50 ${info.perf.cpuP50.toFixed(2)} p95 ${info.perf.cpuP95.toFixed(2)} ms  ` +
          `gap p95 ${info.perf.intervalP95.toFixed(1)} ms\n` +
          `calls ${info.perf.calls}  tris ${info.perf.triangles}  rt ${(info.perf.textureBytes / 1048576).toFixed(1)} MB  ` +
          `canvas ${info.perf.renderW}×${info.perf.renderH}\n`
        : '') +
      `ticks ${s.totalTicks}  sim ${info.simTime.toFixed(2)} s\n` +
      `battle ${info.battle}  seed ${info.seed}\n` +
      `view ${window.innerWidth}×${window.innerHeight} @${dpr.toFixed(2)}` +
      (info.extra ? `\n${info.extra}` : '');
  }
}
