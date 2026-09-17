import GUI from 'lil-gui';
import {
  DEFAULT_TUNING,
  resetTuning,
  saveTuningOverrides,
  tuning,
  type Tuning,
} from '../config/tuning';
import { events } from '../core/events';
import type { FixedStepClock } from '../core/loop';
import { CHIPS, type ChipId } from '../data/chips';
import type { DebugCellState } from '../render/cellStates';
import type { Cheats } from '../sim/world';

export interface DebugActions {
  getSeed(): number;
  /** Omitted fields keep their current value; `seed: 'random'` rolls a new seed. */
  restart(opts: { seed?: number | 'random'; battle?: number }): void;
  setCoordsVisible(v: boolean): void;
  setOverlayVisible(v: boolean): void;
  cheats: Cheats;
  killAll(): void;
  setPlayerHp(hp: number): void;
  forceAttack(): void;
  fillGauge(): void;
  openCustom(): void;
  giveChip(id: ChipId): void;
  /** Battle field look (BATTLE_VISUAL.md §10). */
  setCellState(x: number, y: number, state: DebugCellState | 'NONE'): void;
  clearCellStates(): void;
  demoCellStates(): void;
  rerollEnemies(): void;
}

// Slider ranges for numeric tunables; anything not listed gets an auto range.
const RANGES: Record<string, [number, number, number]> = {
  SIM_HZ: [30, 240, 1],
  TIME_SCALE: [0.05, 4, 0.05],
  VIEW_PITCH: [5, 80, 1],
  VIEW_FOV: [15, 90, 1],
  VIEW_FILL: [0.5, 1, 0.01],
  CELL_GAP: [0, 0.4, 0.01],
  GRID_DIM: [0, 1, 0.01],
  ACTIVE_FILL: [0, 1, 0.01],
  CRT_FLASH_TIME: [0, 0.5, 0.01],
  RENDER_SCALE_SHORT: [120, 1440, 10],
  CRT_RES_W: [80, 720, 10],
  CRT_RES_H: [120, 960, 10],
  CAMERA_FOV: [5, 60, 1],
  CRT_SCANLINES: [0, 1, 0.01],
  CRT_CURVATURE: [0, 0.4, 0.01],
  CRT_BLEED: [0, 1, 0.01],
  CRT_GHOSTING: [0, 0.9, 0.01],
};

/** lil-gui debug panel (GDD §15.5). Every tunable is editable live and persisted. */
export class DebugPanel {
  readonly gui: GUI;
  private readonly state = {
    seed: 0,
    battle: 1,
    timeScale: 1,
    paused: false,
    showCoords: false,
    showOverlay: true,
    logEvents: false,
  };

  constructor(private clock: FixedStepClock, private actions: DebugActions) {
    this.gui = new GUI({ title: 'Debug' });
    this.state.seed = actions.getSeed();
    this.state.timeScale = tuning.sim.TIME_SCALE;
    this.buildSession();
    this.buildTuning();
    if (window.innerWidth < 600) this.gui.close();
  }

  set visible(v: boolean) {
    this.gui.show(v);
  }

  get visible(): boolean {
    return !this.gui._hidden;
  }

  syncSeed(seed: number, battle: number): void {
    this.state.seed = seed;
    this.state.battle = battle;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private buildSession(): void {
    const s = this.state;
    const f = this.gui.addFolder('Session');
    f.add({ folder: new URLSearchParams(location.search).get('folder') ?? 'mvp' }, 'folder', ['mvp', 'p1'])
      .name('folder (reloads)')
      .onChange((v: string) => {
        const url = new URL(location.href);
        url.searchParams.set('folder', v);
        location.href = url.toString();
      });
    f.add(s, 'battle', [1, 2, 3, 4]).name('battle').onChange((b: number) => this.actions.restart({ battle: b }));
    f.add(s, 'seed').name('seed').step(1);
    f.add({ apply: () => this.actions.restart({ seed: s.seed >>> 0 }) }, 'apply').name('restart with seed');
    f.add({ random: () => this.actions.restart({ seed: 'random' }) }, 'random').name('restart random seed');
    f.add({ copy: () => this.copyLink() }, 'copy').name('copy repro link');

    const tf = this.gui.addFolder('Time');
    tf.add(s, 'timeScale', [0.25, 0.5, 1, 2]).name('time scale').onChange((v: number) => {
      tuning.sim.TIME_SCALE = v;
      this.clock.timeScale = v;
      saveTuningOverrides();
    });
    tf.add(s, 'paused').name('pause sim').onChange((v: boolean) => (this.clock.paused = v));
    tf.add({ step: () => this.clock.stepOnce(1) }, 'step').name('step 1 tick');
    tf.add({ step: () => this.clock.stepOnce(tuning.sim.SIM_HZ) }, 'step').name('step 1 second');

    const vf = this.gui.addFolder('View');
    vf.add(s, 'showCoords').name('cell coords').onChange((v: boolean) => this.actions.setCoordsVisible(v));
    vf.add(s, 'showOverlay').name('stats overlay').onChange((v: boolean) => this.actions.setOverlayVisible(v));
    vf.add(s, 'logEvents').name('log events').onChange((v: boolean) => (events.logEnabled = v));

    // More cheats arrive with their systems (fill gauge, give chip...).
    const cf = this.gui.addFolder('Cheats');
    const a = this.actions;
    const hp = { value: 100 };
    cf.add(a.cheats, 'god').name('god mode (no damage)');
    cf.add(a.cheats, 'aiEnabled').name('enemy AI');
    cf.add({ kill: () => a.killAll() }, 'kill').name('kill all enemies');
    cf.add({ force: () => a.forceAttack() }, 'force').name('force enemy attack');
    cf.add({ fill: () => a.fillGauge() }, 'fill').name('fill custom gauge');
    cf.add({ open: () => a.openCustom() }, 'open').name('open custom now');
    const give = { chip: 'cannon' as ChipId };
    cf.add(give, 'chip', Object.keys(CHIPS)).name('chip to give');
    cf.add({ give: () => a.giveChip(give.chip) }, 'give').name('add chip to queue');
    cf.add(hp, 'value', 0, 100, 1).name('player HP');
    cf.add({ set: () => a.setPlayerHp(hp.value) }, 'set').name('set player HP');
    cf.add({ retry: () => a.restart({}) }, 'retry').name('restart battle');
    cf.close();

    const ff = this.gui.addFolder('Field');
    const cell = { x: 1, y: 1, state: 'BROKEN' as DebugCellState | 'NONE' };
    ff.add(cell, 'x', 0, 2, 1).name('cell x');
    ff.add(cell, 'y', 0, 5, 1).name('cell y');
    ff.add(cell, 'state', ['BROKEN', 'EMPTY', 'OBJECT', 'NONE']).name('state');
    ff.add({ apply: () => a.setCellState(cell.x, cell.y, cell.state) }, 'apply').name('apply to cell');
    ff.add({ clear: () => a.clearCellStates() }, 'clear').name('clear cell states');
    ff.add({ demo: () => a.demoCellStates() }, 'demo').name('demo all states');
    ff.add({ reroll: () => a.rerollEnemies() }, 'reroll').name('new enemy looks');
    ff.close();
  }

  private buildTuning(): void {
    const root = this.gui.addFolder('Tuning');
    root.add({ reset: () => this.resetAll() }, 'reset').name('reset to defaults');
    root.add({ exp: () => this.exportJson() }, 'exp').name('export JSON');
    const groups = tuning as unknown as Record<string, Record<string, number | boolean>>;
    const defaults = DEFAULT_TUNING as unknown as Record<string, Record<string, number | boolean>>;
    for (const group of Object.keys(groups) as (keyof Tuning)[]) {
      const values = groups[group] as Record<string, number | boolean>;
      const f = root.addFolder(group);
      for (const key of Object.keys(values)) {
        const def = defaults[group]?.[key];
        let c;
        if (typeof values[key] === 'number') {
          const range = RANGES[key];
          if (range) {
            c = f.add(values, key, range[0], range[1], range[2]);
          } else {
            const d = Math.abs(def as number);
            const max = d === 0 ? 10 : d * 4;
            const step = Number.isInteger(def) && d >= 1 ? 1 : 0.01;
            c = f.add(values, key, 0, max, step);
          }
        } else {
          c = f.add(values, key);
        }
        c.onFinishChange(() => {
          if (key === 'TIME_SCALE') this.clock.timeScale = tuning.sim.TIME_SCALE;
          if (key === 'SIM_HZ') this.clock.options.hz = tuning.sim.SIM_HZ;
          saveTuningOverrides();
        });
      }
      f.close();
    }
    root.close();
  }

  private resetAll(): void {
    resetTuning();
    this.clock.timeScale = tuning.sim.TIME_SCALE;
    this.clock.options.hz = tuning.sim.SIM_HZ;
    this.state.timeScale = tuning.sim.TIME_SCALE;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private exportJson(): void {
    const json = JSON.stringify(tuning, null, 2);
    console.info('[tuning]\n' + json);
    navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  private copyLink(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('debug', '1');
    url.searchParams.set('seed', String(this.state.seed));
    url.searchParams.set('battle', String(this.state.battle));
    const link = url.toString();
    console.info('[repro]', link);
    navigator.clipboard?.writeText(link).catch(() => undefined);
  }
}
