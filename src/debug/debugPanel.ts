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
import { FOLDERS } from '../data/folders';
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
  giveChip(id: ChipId): void;
  /** Battle field look (BATTLE_VISUAL.md §10). */
  setCellState(x: number, y: number, state: DebugCellState | 'NONE'): void;
  clearCellStates(): void;
  demoCellStates(): void;
  /** Run (GDD §10–11). */
  runDepth(depth: number): void;
  /** Changes the real panels (roguelite spec §3). */
  simPanel(x: number, y: number, action: 'crack' | 'break' | 'repair' | 'grab' | 'rock'): void;
}

// Slider ranges for numeric tunables; anything not listed gets an auto range.
const RANGES: Record<string, [number, number, number]> = {
  SIM_HZ: [30, 240, 1],
  TIME_SCALE: [0.05, 4, 0.05],
  WORLD_TIME_SCALE: [0.1, 1, 0.05],
  SLOW_MO_ENTER: [0, 1, 0.01],
  SLOW_MO_EXIT: [0, 1, 0.01],
  COMBO_BREAK_EXIT: [0, 0.5, 0.01],
  CHIP_INPUT_BUFFER: [0, 0.5, 0.01],
  HOP_ALIGN_CHANCE: [0, 1, 0.05],
  BLD_AREA_GRAB_DECISIONS: [1, 10, 1],
  MINE_TARGET_DISTANCE: [1, 5, 1],
  SWIPE_REARM_TIME: [0, 0.3, 0.01],
  SWIPE_REST_PX: [0, 12, 1],
  SWIPE_CONTINUE_TIME: [0, 0.4, 0.01],
  SWIPE_CONTINUE_PX: [24, 150, 1],
  BLD_MIN_PLAYER_ROWS: [1, 3, 1],
  BREAK_TARGET_DISTANCE: [1, 5, 1],
  VIEW_PITCH: [5, 80, 1],
  VIEW_FOV: [15, 90, 1],
  VIEW_FILL: [0.5, 1.5, 0.01],
  VIEW_OFFSET_X: [-1, 1, 0.01],
  VIEW_OFFSET_Y: [-1, 1, 0.01],
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
  CRT_PHOSPHOR: [0, 1, 0.01],
  CRT_GLOW: [0, 1, 0.01],
  CRT_NOISE: [0, 0.3, 0.01],
  CRT_ABERRATION: [0, 2, 0.05],
  CRT_SHAKE: [0, 1, 0.01],
  AMBIENT: [0, 0.5, 0.01],
  LIGHT_CRT: [0, 2, 0.05],
  LIGHT_RING: [0, 2, 0.05],
  LIGHT_CHIP: [0, 2, 0.05],
  VIGNETTE: [0, 1, 0.01],
  CONTROL_TILT: [0, 45, 1],
  CRT_TILT: [0, 20, 1],
  BALL_W: [0.1, 0.5, 0.01],
  RING_W: [0.15, 0.6, 0.01],
  CHIP_ACTIVE_PUSH: [0, 0.5, 0.01],
  CHIP_TILT_DEG: [0, 60, 1],
  CHIP_ACTIVE_GLOW: [0, 2, 0.05],
  CHIP_CANCEL_FLASH_TIME: [0, 2, 0.05],
  HUD_BAND: [0, 0.3, 0.01],
  LAYOUT_DRAW: [0, 0.12, 0.01],
  COUNTER_STAGGER_TIME: [0, 2, 0.01],
  HAND_REFILL_COOLDOWN: [0, 10, 0.1],
  DRAW_PREVIEW: [0, 6, 1],
  HAND_SIZE: [3, 8, 1],
  ORIGINAL_COLOR_RETENTION: [0, 1, 0.01],
  BASE_BRIGHTNESS: [0, 1, 0.01],
  SCANLINE_SPACING: [1, 12, 0.1],
  SCANLINE_WIDTH: [0.05, 0.95, 0.01],
  SCANLINE_CURVATURE: [0, 2.4, 0.01],
  SCANLINE_STRENGTH: [0, 1, 0.01],
  EMISSION_STRENGTH: [0, 2, 0.01],
  HALO_STRENGTH: [0, 1.5, 0.01],
  BLOOM_STRENGTH: [0, 0.5, 0.01],
  GLITCH_AMOUNT: [0, 0.5, 0.01],
  EDGE_PARTICLE_AMOUNT: [0, 1, 0.01],
  BRIGHT_SWEEP_STRENGTH: [0, 2, 0.01],
  BRIGHT_SWEEP_SPEED: [0, 0.5, 0.01],
  BRIGHT_SWEEP_WIDTH: [0.01, 0.5, 0.01],
  THIN_SWEEP_STRENGTH: [0, 2, 0.01],
  THIN_SWEEP_WIDTH: [0.002, 0.1, 0.001],
  THIN_SWEEP_SPEED_MIN: [0, 0.5, 0.01],
  THIN_SWEEP_SPEED_MAX: [0, 0.5, 0.01],
  DROPOUT_AMOUNT: [0, 0.3, 0.005],
  DROPOUT_SIZE: [1, 4, 0.1],
  DROPOUT_SPEED: [0, 0.5, 0.01],
  DROPOUT_ANGLE: [-180, 180, 1],
};

/** Stable display order for debug names, independent of object declaration order. */
export function alphabeticalKeys(values: Record<string, unknown>): string[] {
  return Object.keys(values).sort((a, b) => a.localeCompare(b));
}

export function tuningControlKind(
  _key: string,
  value: unknown,
): 'number' | 'boolean' | 'color' | 'string' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return 'color';
  return 'string';
}

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
    f.add({ folder: new URLSearchParams(location.search).get('folder') ?? 'basic' }, 'folder', Object.keys(FOLDERS))
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
    const run = { depth: 1 };
    f.add(run, 'depth', 1, 10, 1).name('run step');
    f.add({ go: () => this.actions.runDepth(run.depth) }, 'go').name('go to step');

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
    const hp = { value: tuning.player.PLAYER_MAX_HP };
    cf.add(a.cheats, 'god').name('god mode (no damage)');
    cf.add(a.cheats, 'aiEnabled').name('enemy AI');
    cf.add({ kill: () => a.killAll() }, 'kill').name('kill all enemies');
    cf.add({ force: () => a.forceAttack() }, 'force').name('force enemy attack');
    const give = { chip: 'cannon' as ChipId };
    cf.add(give, 'chip', Object.keys(CHIPS)).name('chip to give');
    cf.add({ give: () => a.giveChip(give.chip) }, 'give').name('add chip to queue');
    cf.add(hp, 'value', 0, tuning.player.PLAYER_MAX_HP, 1).name('player HP');
    cf.add({ set: () => a.setPlayerHp(hp.value) }, 'set').name('set player HP');
    cf.add({ retry: () => a.restart({}) }, 'retry').name('restart battle');
    cf.close();

    const ff = this.gui.addFolder('Field');
    const cell = { x: 1, y: 1, state: 'BROKEN' as DebugCellState | 'NONE' };
    ff.add(cell, 'x', 0, 2, 1).name('cell x');
    ff.add(cell, 'y', 0, 5, 1).name('cell y');
    ff.add(cell, 'state', ['BROKEN', 'EMPTY', 'OBJECT', 'NONE']).name('state');
    ff.add({ apply: () => a.setCellState(cell.x, cell.y, cell.state) }, 'apply').name('apply to cell');
    const sim = { action: 'crack' as 'crack' | 'break' | 'repair' | 'grab' | 'rock' };
    ff.add(sim, 'action', ['crack', 'break', 'repair', 'grab', 'rock']).name('sim action');
    ff.add({ run: () => a.simPanel(cell.x, cell.y, sim.action) }, 'run').name('apply to sim');
    ff.add({ clear: () => a.clearCellStates() }, 'clear').name('clear cell states');
    ff.add({ demo: () => a.demoCellStates() }, 'demo').name('demo all states');
    ff.close();
  }

  private buildTuning(): void {
    const root = this.gui.addFolder('Tuning');
    root.add({ reset: () => this.resetAll() }, 'reset').name('reset to defaults');
    root.add({ exp: () => this.exportJson() }, 'exp').name('export JSON');
    const groups = tuning as unknown as Record<string, Record<string, number | boolean | string>>;
    const defaults = DEFAULT_TUNING as unknown as Record<string, Record<string, number | boolean | string>>;
    for (const group of alphabeticalKeys(groups) as (keyof Tuning)[]) {
      const values = groups[group] as Record<string, number | boolean | string>;
      const f = root.addFolder(group);
      for (const key of alphabeticalKeys(values)) {
        const def = defaults[group]?.[key];
        let c;
        const kind = tuningControlKind(key, values[key]);
        if (kind === 'number') {
          const range = RANGES[key];
          if (range) {
            c = f.add(values, key, range[0], range[1], range[2]);
          } else {
            const d = Math.abs(def as number);
            const max = d === 0 ? 10 : d * 4;
            const step = Number.isInteger(def) && d >= 1 ? 1 : 0.01;
            c = f.add(values, key, 0, max, step);
          }
        } else if (kind === 'color') {
          c = f.addColor(values, key);
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
