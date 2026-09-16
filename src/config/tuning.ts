// All tunable gameplay parameters (GDD §17). Times are in seconds.
// Never hardcode these values elsewhere: read them from `tuning`.
// The debug panel edits this object live and persists overrides.

export const DEFAULT_TUNING = {
  sim: {
    SIM_HZ: 60,
    MAX_FRAME_TIME: 0.25,
    TIME_SCALE: 1,
  },
  player: {
    PLAYER_MAX_HP: 100,
    PLAYER_START_X: 1,
    PLAYER_START_Y: 4,
    MOVE_VISUAL_TIME: 0.066,
    MOVE_COOLDOWN: 0.1,
    PLAYER_FLINCH_TIME: 0.4,
    PLAYER_IFRAMES: 2.0,
  },
  buster: {
    BUSTER_DAMAGE: 1,
    BUSTER_COOLDOWN: 2.0,
    CHARGE_ENABLED: true,
    CHARGE_T1: 1.0,
    CHARGE_T2: 2.0,
    CHARGE_MULT_1: 8,
    CHARGE_MULT_2: 16,
  },
  gauge: {
    GAUGE_FILL_TIME: 8.0,
  },
  chips: {
    HAND_BASE: 5,
    HAND_ADD_STEP: 5,
    HAND_MAX: 15,
    SELECT_MAX: 5,
    CHIP_USE_TIME_CANNON: 0.5,
    CHIP_USE_TIME_SWORD: 0.4,
    CHIP_USE_TIME_BOMB: 0.5,
    CHIP_USE_TIME_RECOVER: 0.5,
    CHIP_HIT_FRAME: 0.1,
    BOMB_FLIGHT_TIME: 0.5,
    RECOVER_AMOUNT: 50,
  },
  mettik: {
    MET_HP: 40,
    MET_DMG: 10,
    MET_MOVE_INTERVAL: 0.5,
    MET_TELEGRAPH: 0.5,
    MET_ATTACK_TIME: 0.2,
    MET_WAVE_STEP: 0.25,
    MET_RECOVERY: 1.5,
  },
  canodron: {
    CANO_HP: 50,
    CANO_DMG: 10,
    CANO_CURSOR_STEP: 0.15,
    CANO_FIRE_DELAY: 0.3,
    CANO_ATTACK_TIME: 0.2,
    CANO_COOLDOWN: 2.0,
  },
  spiker: {
    SPK_HP: 90,
    SPK_DMG: 20,
    SPK_WARP_INTERVAL: 0.8,
    SPK_WARPS_MIN: 2,
    SPK_WARPS_MAX: 4,
    SPK_TELEGRAPH: 0.5,
    SPK_SHOT_STEP: 0.12,
    SPK_ATTACK_TIME: 0.2,
    SPK_RECOVERY: 1.5,
  },
  fx: {
    HIT_FLASH: 0.1,
    IFRAME_BLINK_HZ: 15,
    BUSTER_TRACER_TIME: 0.08,
    CANNON_TRACER_TIME: 0.18,
    SLASH_TIME: 0.15,
    EXPLOSION_TIME: 0.3,
    HEAL_FX_TIME: 0.5,
    WARP_FX_TIME: 0.15,
    CHARGE_RING_DELAY: 0.15,
    DAMAGE_NUMBER_TIME: 0.6,
    DELETE_ANIM_TIME: 0.4,
    INTRO_TIME: 0.8,
    BANNER_BATTLE_START: 1.0,
    RESUME_DELAY: 0.2,
    /** "ENEMY DELETED!" banner before the result screen. */
    RESULT_DELAY_WIN: 1.2,
    /** Player deletion before the GAME OVER screen. */
    RESULT_DELAY_LOSE: 1.0,
  },
  input: {
    SWIPE_MIN_PX: 24,
    /** Keep stepping while the finger stays down after a swipe. */
    SWIPE_HOLD_ENABLED: true,
    /** Delay before the first repeated step while a direction is held (swipe or key). */
    HOLD_REPEAT_DELAY: 0.35,
    /** Interval between further repeated steps while the direction stays held. */
    HOLD_REPEAT: 0.2,
  },
  render: {
    CAMERA_TILT_DEG: 45,
    PANEL_GAP: 0.06,
    FIELD_SCREEN_SHARE: 0.6,
    MAX_PIXEL_RATIO: 2,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

const STORAGE_KEY = 'glorp.tuning.v1';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const tuning: Tuning = clone(DEFAULT_TUNING);

/** Copies known keys from `src` into `dst`, ignoring unknown keys and type mismatches. */
export function mergeTuning(dst: Tuning, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  const d = dst as unknown as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(src as Record<string, unknown>)) {
    const target = d[group];
    if (!target || !values || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (key in target && typeof target[key] === typeof value) target[key] = value;
    }
  }
}

export function loadTuningOverrides(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) mergeTuning(tuning, JSON.parse(raw));
  } catch {
    // storage unavailable or corrupted: keep defaults
  }
}

export function saveTuningOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    // ignore
  }
}

export function resetTuning(): void {
  mergeTuning(tuning, clone(DEFAULT_TUNING));
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * tuning.sim.SIM_HZ));
}
