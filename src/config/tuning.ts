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
  /** Auto Buster (roguelite spec §2): a weak instant shot down the player's column. */
  buster: {
    BUSTER_INTERVAL: 1.0,
    BUSTER_DAMAGE: 1,
  },
  /** Panels (roguelite spec §3). */
  field: {
    PANEL_RESTORE_TIME: 10,
    STEAL_RESTORE_TIME: 15,
    ROCK_HP: 100,
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
    CANNON_TRACER_TIME: 0.18,
    BUSTER_TRACER_TIME: 0.08,
    SLASH_TIME: 0.15,
    EXPLOSION_TIME: 0.3,
    HEAL_FX_TIME: 0.5,
    WARP_FX_TIME: 0.15,
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
    /** Delay before the first repeated step while a movement key is held. */
    HOLD_REPEAT_DELAY: 0.35,
    /** Interval between further repeated steps while the direction stays held. */
    HOLD_REPEAT: 0.2,
  },
  /** Battle field look, "CRT Occult Vector" (docs/BATTLE_VISUAL.md §9). */
  battleVisual: {
    /** Camera pitch below the horizon and vertical field of view, degrees. */
    VIEW_PITCH: 38,
    VIEW_FOV: 50,
    /** Share of the CRT frame the field may fill. */
    VIEW_FILL: 0.92,
    /** Gap between cell outlines (share of a cell). */
    CELL_GAP: 0.08,
    /** Brightness of idle grid lines (dithered below 1). */
    GRID_DIM: 0.75,
    /** Fill brightness of the player's cell. */
    ACTIVE_FILL: 0.25,
    /** Creature sprite width as a share of a cell; texels are then rounded to whole CRT pixels. */
    SPRITE_CELL_FRAC: 0.95,
    DANGER_PULSE_HZ: 6,
    /** Hit stripe, then the flickering afterglow, seconds. */
    ATTACK_CELL_TIME: 0.15,
    AFTER_TIME: 0.2,
    /** Spawn markers at the battle intro, seconds. */
    SPAWN_TIME: 0.6,
    HP_SEGMENTS: 8,
    DAMAGE_SCALE: 3,
  },
  /** Physical terminal NET-01 (docs/TERMINAL.md §17). */
  terminal: {
    /** Render pixels across the terminal body's short side; the canvas is upscaled without smoothing. */
    RENDER_SCALE_SHORT: 400,
    /** Battle render target shown on the CRT. */
    CRT_RES_W: 240,
    CRT_RES_H: 320,
    /** Viewport aspect (w/h) range the terminal body stretches to; outside it the terminal is letterboxed. */
    TERMINAL_ASPECT_MIN: 0.42,
    TERMINAL_ASPECT_MAX: 0.62,
    /** Vertical shares of the terminal, top to bottom (sum = 1). */
    LAYOUT_TOP: 0.06,
    LAYOUT_CRT: 0.5,
    LAYOUT_RAIL: 0.14,
    LAYOUT_DECK: 0.3,
    /** Horizontal bezel around the CRT glass, as a share of terminal width on each side. */
    CRT_MARGIN_X: 0.1,
    /** Deck columns: CHIP SELECT | trackball zone | EXECUTE (shares of terminal width). */
    DECK_SPLIT_LEFT: 0.27,
    DECK_SPLIT_RIGHT: 0.63,
    /** Pause key zone width at the right end of the top bar (share of terminal width). */
    PAUSE_ZONE_W: 0.16,
    /** Vertical field of view, degrees. */
    CAMERA_FOV: 22,
    /** Glass effects are post-processing on top of the base look; off by default (BATTLE_VISUAL.md §2). */
    CRT_SCANLINES: 0,
    CRT_CURVATURE: 0,
    CRT_BLEED: 0,
    /** Previous-frame persistence; 0 disables the ghosting pass entirely. */
    CRT_GHOSTING: 0,
    CRT_FLASH_TIME: 0,
    /** Button travel when pressed, world units. */
    BUTTON_PRESS_DEPTH: 0.12,
    /** Trackball rotation per CSS px of drag, radians. */
    TRACKBALL_ROLL_GAIN: 0.02,
    /** Trackball spin decay, 1/s. */
    TRACKBALL_FRICTION: 6,
    /** Key spring: stiffness (1/s²) and damping (1/s); low damping gives the release overshoot. */
    SPRING_STIFFNESS: 900,
    SPRING_DAMPING: 22,
    /** Travel of a dull (refused) press as a share of the full travel. */
    DULL_PRESS_SHARE: 0.35,
    /** Lift of a hovered control (mouse), world units. */
    HOVER_LIFT: 0.04,
    ARROW_FLASH_TIME: 0.15,
    /** Red blink of the CHIP SELECT ring / EXECUTE when refused. */
    DENIED_BLINK_TIME: 0.4,
    /** Camera tilt toward the mouse pointer (fine pointers only), degrees. */
    PARALLAX_DEG: 1.5,
    /** CHIP SELECT glow pulse when the gauge is full. */
    GLOW_PULSE_HZ: 1.5,
    /** Chip rail (TERMINAL.md §6.3): active chip lift (world units) and animation times (s). */
    CHIP_ACTIVE_LIFT: 0.18,
    EJECT_LIFT_TIME: 0.06,
    EJECT_TIME: 0.34,
    BURN_STAGGER: 0.04,
    BURN_TIME: 0.6,
    LOAD_TIME: 0.18,
    LOAD_STAGGER: 0.05,
    CONTACT_FLASH_TIME: 0.2,
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
