import type { Tuning } from '../config/tuning';

// Folder tree of the debug panel's Tune tab (GDD §15.5). Pure data and helpers:
// the Tweakpane panel (debugPanel.ts) renders it; tests check it covers `tuning`.

export type GroupKey = keyof Tuning;
type Value = number | boolean | string;
type Groups = Record<string, Record<string, Value>>;

/** A folder shows the keys of its groups, then its child folders. */
export interface TuneFolder {
  title: string;
  groups?: readonly GroupKey[];
  children?: readonly TuneFolder[];
}

const leaf = (title: string, ...groups: GroupKey[]): TuneFolder => ({ title, groups });

export const TUNE_LAYOUT: readonly TuneFolder[] = [
  { title: 'Tempo', children: [leaf('Sim', 'sim'), leaf('Combo', 'combo'), leaf('Flow', 'flow')] },
  leaf('Player', 'player', 'input'),
  leaf('Hand', 'hand'),
  {
    title: 'Chips',
    children: [
      leaf('Cannon', 'cannon'),
      leaf('AirShot', 'airshot'),
      leaf('Spreader', 'spreader'),
      leaf('Sword', 'sword'),
      leaf('WideSword', 'widesword'),
      leaf('AreaGrab', 'areagrab'),
      leaf('Mine', 'mine'),
      leaf('Block', 'block'),
      leaf('Break', 'break'),
      leaf('Guard', 'guard'),
    ],
  },
  {
    title: 'Enemies',
    children: [
      leaf('Common', 'enemy'),
      leaf('Mettik', 'mettik'),
      leaf('Canodron', 'canodron'),
      leaf('Hopzap', 'hopzap'),
      leaf('Bladdy', 'bladdy'),
    ],
  },
  leaf('Field', 'field'),
  leaf('Battle visual', 'battleVisual', 'fx'),
  leaf('Terminal', 'terminal'),
  leaf('Hologram', 'hologram'),
];

/** Groups edited from the Tools tab instead. */
export const TOOLS_GROUPS: readonly GroupKey[] = ['tutorial'];

/** Every group in the folders, depth first. */
export function layoutGroups(folders: readonly TuneFolder[]): GroupKey[] {
  return folders.flatMap((f) => [...(f.groups ?? []), ...layoutGroups(f.children ?? [])]);
}

export interface TuningChange {
  group: GroupKey;
  key: string;
  from: Value;
  to: Value;
}

function same(a: Value, b: Value): boolean {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;
}

/** Values that differ from the defaults, in panel order. */
export function changedValues(values: Tuning, defaults: Tuning): TuningChange[] {
  const v = values as unknown as Groups;
  const d = defaults as unknown as Groups;
  const out: TuningChange[] = [];
  for (const group of [...layoutGroups(TUNE_LAYOUT), ...TOOLS_GROUPS]) {
    for (const [key, from] of Object.entries(d[group] ?? {})) {
      const to = v[group]?.[key];
      if (to !== undefined && !same(from, to)) out.push({ group, key, from, to });
    }
  }
  return out;
}

/** One `group.KEY: from → to` line per change, for pasting into DEFAULT_TUNING. */
export function formatChanges(changes: readonly TuningChange[]): string {
  return changes.map((c) => `${c.group}.${c.key}: ${c.from} → ${c.to}`).join('\n');
}

export function resetGroups(values: Tuning, defaults: Tuning, groups: readonly GroupKey[]): void {
  const v = values as unknown as Groups;
  const d = defaults as unknown as Groups;
  for (const g of groups) Object.assign(v[g]!, JSON.parse(JSON.stringify(d[g])));
}

/** Every whitespace-separated word must occur in `group.KEY` or the folder title. */
export function matchesFilter(query: string, group: string, key: string, title: string): boolean {
  const hay = `${group}.${key} ${title}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function tuningControlKind(value: unknown): 'number' | 'boolean' | 'color' | 'string' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return 'color';
  return 'string';
}

// Slider ranges by key name; anything not listed gets an auto range.
const RANGES: Record<string, [number, number, number]> = {
  SIM_HZ: [30, 240, 1],
  TIME_SCALE: [0.05, 4, 0.05],
  WORLD_TIME_SCALE: [0.1, 1, 0.05],
  SLOW_MO_ENTER: [0, 1, 0.01],
  SLOW_MO_EXIT: [0, 1, 0.01],
  COMBO_BREAK_EXIT: [0, 0.5, 0.01],
  CHIP_INPUT_BUFFER: [0, 0.5, 0.01],
  SELECT_TIME_SCALE: [0.02, 1, 0.01],
  SELECT_SLOW_MO_ENTER: [0, 1, 0.01],
  SELECT_SLOW_MO_TIME: [0.5, 10, 0.1],
  SELECT_SLOW_MO_RECHARGE: [0.5, 20, 0.1],
  SIZE: [3, 8, 1],
  REFILL_COOLDOWN: [0, 10, 0.1],
  COMBO_CUT_PER_CHIP: [0, 2, 0.05],
  TARGET_DISTANCE: [1, 5, 1],
  COUNTER_STAGGER_TIME: [0, 2, 0.01],
  ALIGN_CHANCE: [0, 1, 0.05],
  AREA_GRAB_DECISIONS: [1, 10, 1],
  MIN_PLAYER_ROWS: [1, 3, 1],
  SWIPE_REARM_TIME: [0, 0.3, 0.01],
  SWIPE_REST_PX: [0, 12, 1],
  SWIPE_CONTINUE_TIME: [0, 0.4, 0.01],
  SWIPE_CONTINUE_PX: [24, 150, 1],
  VIEW_PITCH: [5, 80, 1],
  VIEW_FOV: [15, 90, 1],
  VIEW_FILL: [0.5, 1.5, 0.01],
  VIEW_OFFSET_X: [-1, 1, 0.01],
  VIEW_OFFSET_Y: [-1, 1, 0.01],
  CELL_GAP: [0, 0.4, 0.01],
  GRID_DIM: [0, 1, 0.01],
  ACTIVE_FILL: [0, 1, 0.01],
  HUD_BAND: [0, 0.3, 0.01],
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
  CHIP_CUT_FLASH_TIME: [0, 1, 0.05],
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

/** `[min, max, step]` for a numeric tunable with the given default. */
export function sliderRange(key: string, def: number): [number, number, number] {
  const listed = RANGES[key];
  if (listed) return listed;
  const d = Math.abs(def);
  if (d === 0) return [0, 10, 0.01];
  return [0, d * 4, Number.isInteger(def) && d >= 1 ? 1 : 0.01];
}
