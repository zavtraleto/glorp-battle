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
    /** Hand slots visible in the rail for the whole battle (GDD §5). */
    HAND_SIZE: 5,
    /** Chips spent before the hand refills; the pacing knob of the whole battle. */
    REFRESH_AT: 3,
    /** Chips of the draw queue shown under the rail. */
    DRAW_PREVIEW: 3,
    CHIP_USE_TIME_CANNON: 0.5,
    CHIP_USE_TIME_SWORD: 0.4,
    CHIP_USE_TIME_BOMB: 0.5,
    CHIP_USE_TIME_RECOVER: 0.5,
    CHIP_USE_TIME_FIELD: 0.4,
    CHIP_HIT_FRAME: 0.1,
    BOMB_FLIGHT_TIME: 0.5,
    /** ZapRing paralysis (roguelite spec §4.3). */
    PARALYZE_TIME: 1.5,
    INVIS_TIME: 3.0,
    /** Player ShockWave: seconds per panel. */
    PLAYER_WAVE_STEP: 0.15,
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
    CANO_HP: 60,
    CANO_DMG: 10,
    CANO_CURSOR_STEP: 0.15,
    CANO_FIRE_DELAY: 0.3,
    CANO_ATTACK_TIME: 0.2,
    CANO_COOLDOWN: 2.0,
  },
  spiker: {
    SPK_HP: 90,
    SPK_DMG: 30,
    SPK_WARP_INTERVAL: 0.8,
    SPK_WARPS_MIN: 2,
    SPK_WARPS_MAX: 4,
    SPK_TELEGRAPH: 0.5,
    SPK_SHOT_STEP: 0.12,
    SPK_ATTACK_TIME: 0.2,
    SPK_RECOVERY: 1.5,
  },
  /** Roguelite viruses (roguelite spec §5.2). HP and damage: MMBN3; timings: [оценка]. */
  hopzap: {
    HOP_HP: 40,
    HOP_DMG: 15,
    HOP_MOVE_INTERVAL: 0.6,
    HOP_TELEGRAPH: 0.5,
    HOP_RING_STEP: 0.2,
    HOP_PARALYZE: 1.0,
    HOP_RECOVERY: 1.2,
  },
  bladdy: {
    BLD_HP: 90,
    BLD_DMG: 30,
    BLD_MOVE_INTERVAL: 0.8,
    BLD_TELEGRAPH: 0.6,
    BLD_ATTACK_TIME: 0.25,
    BLD_RECOVERY: 1.5,
  },
  rattik: {
    RAT_HP: 40,
    RAT_DMG: 20,
    RAT_MOVE_INTERVAL: 0.7,
    RAT_TELEGRAPH: 0.4,
    RAT_STEP: 0.18,
    RAT_RECOVERY: 2.0,
  },
  helmhead: {
    HELM_HP: 80,
    HELM_DMG: 60,
    HELM_CLOSED: 2.0,
    HELM_TELEGRAPH: 0.6,
    HELM_FLIGHT: 0.6,
    HELM_RECOVERY: 1.0,
  },
  finnik: {
    FIN_HP: 90,
    FIN_DMG: 30,
    FIN_MOVE_INTERVAL: 0.8,
    FIN_TELEGRAPH: 0.6,
    FIN_DASH_STEP: 0.08,
    FIN_RECOVERY: 1.5,
  },
  /** Act boss (roguelite spec §5.3); all values [оценка]. */
  monolith: {
    MONO_HP: 400,
    MONO_MOVE_INTERVAL: 1.2,
    MONO_ATTACK_INTERVAL: 2.5,
    MONO_TELEGRAPH: 0.8,
    MONO_ATTACK_TIME: 0.4,
    MONO_ROCK_DMG: 40,
    MONO_ROCK_FALL: 0.3,
    MONO_ROCKS: 3,
    MONO_ROCKS_RAGE: 5,
    MONO_WAVE_DMG: 50,
    MONO_WAVE_STEP: 0.2,
    MONO_RAGE_SPEED: 1.25,
  },
  fx: {
    HIT_FLASH: 0.1,
    IFRAME_BLINK_HZ: 15,
    CANNON_TRACER_TIME: 0.18,
    SLASH_TIME: 0.15,
    EXPLOSION_TIME: 0.3,
    HEAL_FX_TIME: 0.5,
    WARP_FX_TIME: 0.15,
    DAMAGE_NUMBER_TIME: 0.6,
    DELETE_ANIM_TIME: 0.4,
    /** Enemies appear and the hand rides into the rail before the battle runs. */
    INTRO_TIME: 0.8,
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
    VIEW_PITCH: 41,
    VIEW_FOV: 44,
    /** Share of the CRT frame the field may fill. */
    /** Leaves the top band of the picture to the HUD (spec §8). */
    VIEW_FILL: 1,
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
    /** Height of the CRT status band, share of the picture (spec §8). */
    HUD_BAND: 0.11,
  },
  /** Physical terminal NET-01 (docs/TERMINAL.md §17). */
  terminal: {
    /** Render pixels across the terminal body's short side; the canvas is upscaled without smoothing. */
    RENDER_SCALE_SHORT: 400,
    /** Battle render target shown on the CRT; 320:440 = 1:1.375, the glass aspect (spec §5.2). */
    CRT_RES_W: 320,
    CRT_RES_H: 440,
    /** Viewport aspect (w/h) range the terminal body stretches to; outside it the terminal is letterboxed. */
    TERMINAL_ASPECT_MIN: 0.42,
    TERMINAL_ASPECT_MAX: 0.62,
    /** Vertical shares of the terminal, top to bottom (spec §3; sum = 1). */
    LAYOUT_CRT: 0.64,
    LAYOUT_RAIL: 0.15,
    /** Draw queue strip under the rail; it takes its height from the deck. */
    LAYOUT_DRAW: 0.035,
    LAYOUT_DECK: 0.175,
    /** Horizontal bezel around the CRT glass, as a share of terminal width on each side. */
    CRT_MARGIN_X: 0.015,
    /** The control panel (rail, draw strip, trackball, pause) is one plane; its top edge leans away from the player, degrees. */
    CONTROL_TILT: 25,
    /** The screen leans back about its lower edge, degrees (spec §3.1). */
    CRT_TILT: 4,
    /** A trackball gesture that never travelled counts as a chip shot within this long (spec §10.2). */
    TAP_MAX_TIME: 0.35,
    /** Pause key in the bottom-left corner of the control panel: zone side, share of terminal width. */
    PAUSE_ZONE_W: 0.16,
    /** Vertical field of view, degrees. */
    CAMERA_FOV: 34,
    /** Glass effects, moderate: the picture must stay readable (spec §5.3). */
    CRT_SCANLINES: 0.3,
    CRT_CURVATURE: 0.06,
    CRT_BLEED: 0.35,
    /** Previous-frame persistence; 0 disables the ghosting pass entirely. */
    CRT_GHOSTING: 0.58,
    CRT_FLASH_TIME: 0.12,
    /** RGB phosphor triads across the texel columns. */
    CRT_PHOSPHOR: 0.25,
    /** Bloom around bright texels. */
    CRT_GLOW: 0.35,
    CRT_NOISE: 0.03,
    /** Radial R/B separation, in texels at the screen edge. */
    CRT_ABERRATION: 0.4,
    /** Picture shake on a hit (the cabinet never moves). */
    CRT_SHAKE: 0.15,
    /** Near-black scene: everything is lit by the screen, the ring and the active chip (spec §4). */
    AMBIENT: 0.04,
    LIGHT_CRT: 1.0,
    LIGHT_RING: 1.6,
    LIGHT_CHIP: 0.7,
    /** Darkening of the terminal frame's edges. */
    VIGNETTE: 0.6,
    /** Button travel when pressed, world units. */
    BUTTON_PRESS_DEPTH: 0.12,
    /** Ball diameter and red ring outer diameter, shares of the body width (spec §10.1). */
    BALL_W: 0.25,
    RING_W: 0.34,
    RING_SEGMENTS: 16,
    /** Trackball rotation per CSS px of drag, radians. */
    TRACKBALL_ROLL_GAIN: 0.0067,
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
    /** CHIP SELECT glow pulse when the gauge is full. */
    GLOW_PULSE_HZ: 1.5,
    /** Chip rail (spec §9.2): active chip lift and push (world units), animation times (s). */
    CHIP_ACTIVE_LIFT: 0.18,
    /** How far the active cartridge slides out of its slot toward the player. */
    CHIP_ACTIVE_PUSH: 0.1,
    /** Brightness of the light the active cartridge throws on its own slot. */
    CHIP_ACTIVE_GLOW: 0.7,
    EJECT_LIFT_TIME: 0.06,
    EJECT_TIME: 0.55,
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
