// All tunable gameplay parameters (GDD §17). Times are in seconds.
// Never hardcode these values elsewhere: read them from `tuning`.
// The debug panel edits this object live and persists overrides.

/** Designer-facing combat timing unit. The simulation still runs at SIM_HZ. */
export const COMBAT_TIMING_UNIT = 0.1;

const FAST_ENEMY_TIMING = {
  INTENTION_TIME: 0.2,
  LOCK_TIME: 0.15,
  COUNTER_TIME: 0.15,
  STRIKE_TIME: 0.1,
  RECOVERY_TIME: 0.25,
  MOVE_TIME: 0.15,
};

const STANDARD_ENEMY_TIMING = {
  INTENTION_TIME: 0.3,
  LOCK_TIME: 0.2,
  COUNTER_TIME: 0.18,
  STRIKE_TIME: 0.1,
  RECOVERY_TIME: 0.3,
  MOVE_TIME: 0.2,
};

const HEAVY_ENEMY_TIMING = {
  INTENTION_TIME: 0.4,
  LOCK_TIME: 0.25,
  COUNTER_TIME: 0.2,
  STRIKE_TIME: 0.15,
  RECOVERY_TIME: 0.4,
  MOVE_TIME: 0.3,
};

export const DEFAULT_TUNING = {
  sim: {
    SIM_HZ: 60,
    MAX_FRAME_TIME: 0.25,
    TIME_SCALE: 1,
  },
  combo: {
    WORLD_TIME_SCALE: 0.7,
    SLOW_MO_ENTER: 0.1,
    SLOW_MO_EXIT: 0.15,
    COMBO_BREAK_EXIT: 0.08,
    CHIP_INPUT_BUFFER: 0.1,
  },
  player: {
    PLAYER_MAX_HP: 10,
    PLAYER_START_X: 1,
    PLAYER_START_Y: 4,
    CELL_MOVE_TIME: 0.2,
    PLAYER_FLINCH_TIME: 0.4,
    PLAYER_IFRAMES: 2.0,
  },
  /** Panels (roguelite spec §3). */
  field: {
    PANEL_RESTORE_TIME: 10,
    STEAL_RESTORE_TIME: 15,
    ROCK_HP: 10,
    STAGGER_TIME: 0.25,
    BLOCK_HP: 2,
    BLOCK_DURATION: 6,
  },
  gauge: {
    GAUGE_FILL_TIME: 8.0,
  },
  chips: {
    /** Hand slots visible in the rail for the whole battle (GDD §5). */
    HAND_SIZE: 5,
    /** Chips of the draw queue shown under the rail. */
    DRAW_PREVIEW: 3,
    CHIP_STARTUP_VULCAN: 0.1,
    CHIP_RECOVERY_VULCAN: 0.1,
    CHIP_STARTUP_CANNON: 0.1,
    CHIP_RECOVERY_CANNON: 0.15,
    CHIP_STARTUP_SWORD: 0.15,
    CHIP_RECOVERY_SWORD: 0.2,
    CHIP_STARTUP_BOMB: 0.2,
    CHIP_RECOVERY_BOMB: 0.2,
    CHIP_STARTUP_RECOVER: 0.1,
    CHIP_RECOVERY_RECOVER: 0.15,
    CHIP_STARTUP_FIELD: 0.15,
    CHIP_RECOVERY_FIELD: 0.15,
    /** Shared delay from the first charged shot until the next hand may activate. */
    HAND_REFILL_COOLDOWN: 4.0,
    VULCAN_HIT_STEP: 0.05,
    /** ZapRing paralysis (roguelite spec §4.3). */
    PARALYZE_TIME: 1.5,
    INVIS_TIME: 3.0,
    CHIP_DAMAGE_CANNON: 4,
    CHIP_DAMAGE_SWORD: 6,
    CHIP_DAMAGE_MINE: 6,
    CHIP_DAMAGE_AIRSHOT: 2,
    CHIP_DAMAGE_SPREADER_MAIN: 3,
    CHIP_DAMAGE_SPREADER_SPLASH: 1,
    CHIP_DAMAGE_WIDESWORD: 4,
    /** Rows ahead of the player that Mine arms and Break breaks. */
    MINE_TARGET_DISTANCE: 3,
    BREAK_TARGET_DISTANCE: 3,
    BREAK_DURATION: 5,
    AREA_GRAB_DURATION: 8,
    /** AreaGrab skips occupied cells and deals this to whoever stands there. */
    AREA_GRAB_OCCUPANT_DMG: 1,
  },
  /** Projectile speed in designer-facing seconds per cell. */
  projectile: {
    CELL_TRAVEL_TIME: 0.2,
    FAST_CELL_TRAVEL_TIME: 0.15,
    SLOW_CELL_TRAVEL_TIME: 0.3,
  },
  counter: {
    COUNTER_STAGGER_TIME: 0.5,
  },
  /** Tutorial hint ladder (tutorial spec §5), seconds of inaction. */
  tutorial: {
    TUT_HINT_PULSE: 2,
    TUT_HINT_SEG: 4,
    TUT_HINT_LINE: 8,
  },
  mettik: {
    ...STANDARD_ENEMY_TIMING,
    MET_HP: 4,
    MET_DMG: 1,
  },
  canodron: {
    ...STANDARD_ENEMY_TIMING,
    CANO_HP: 6,
    CANO_DMG: 1,
    CANO_CURSOR_STEP: 0.15,
  },
  hopzap: {
    ...FAST_ENEMY_TIMING,
    HOP_HP: 4,
    HOP_DMG: 1,
    HOP_PARALYZE: 1.0,
    HOP_SETTLE_TIME: 0.15,
    HOP_ALIGN_CHANCE: 0.6,
  },
  bladdy: {
    ...HEAVY_ENEMY_TIMING,
    BLD_HP: 9,
    BLD_DMG: 3,
    BLD_SETTLE_TIME: 0.15,
    BLD_AREA_GRAB_DECISIONS: 3,
    /** Damage to the player standing in the row Bladdy's AreaGrab takes. */
    BLD_AREA_GRAB_DMG: 1,
    /** AreaGrab never leaves the player fewer rows than this behind the grabbed one. */
    BLD_MIN_PLAYER_ROWS: 2,
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
    /** A held finger starts a new stroke after resting this long (GDD §12). */
    SWIPE_REARM_TIME: 0.08,
    /** Travel below this many CSS px still counts as resting. */
    SWIPE_REST_PX: 4,
    /** After a step the same stroke may go on for a second dash after this long... */
    SWIPE_CONTINUE_TIME: 0.1,
    /** ...by travelling this many CSS px more in the same direction. */
    SWIPE_CONTINUE_PX: 60,
    /** Delay before the first repeated step while a movement key is held. */
    HOLD_REPEAT_DELAY: 0.35,
    /** Interval between further repeated steps while the direction stays held. */
    HOLD_REPEAT: 0.2,
  },
  /** Battle field look, "CRT Occult Vector" (docs/BATTLE_VISUAL.md §9). */
  battleVisual: {
    /** Camera pitch below the horizon and vertical field of view, degrees. */
    VIEW_PITCH: 30,
    VIEW_FOV: 25,
    /** Half-extent of the field in NDC; values above 1 deliberately crop it. */
    VIEW_FILL: 1.08,
    /** Field centre in NDC, applied to the field, sprites and effects together. */
    VIEW_OFFSET_X: 0,
    /** Extra vertical shift after reserving the HUD band; negative moves down. */
    VIEW_OFFSET_Y: 0.01,
    /** Gap between cell outlines (share of a cell). */
    CELL_GAP: 0.08,
    /** Brightness of idle grid lines. */
    GRID_DIM: 0.75,
    /** Fill brightness of the player's cell. */
    ACTIVE_FILL: 0.0,
    /** Creature sprite width as a share of a cell; texels are then rounded to whole CRT pixels. */
    SPRITE_CELL_FRAC: 0.95,
    DANGER_PULSE_HZ: 6,
    /** Hit stripe, then the flickering afterglow, seconds. */
    ATTACK_CELL_TIME: 0.15,
    AFTER_TIME: 0.2,
    /** Spawn markers at the battle intro, seconds. */
    SPAWN_TIME: 0.6,
    DAMAGE_SCALE: 4,
    /** Height of the CRT status band, share of the picture (spec §8). */
    HUD_BAND: 0.11,
  },
  /** Object-space projection effect for hand-drawn PNG actors. */
  hologram: {
    ORIGINAL_COLOR_RETENTION: 0.75,
    BASE_BRIGHTNESS: 0.85,
    SCANLINE_SPACING: 1.5,
    SCANLINE_WIDTH: 0.12,
    SCANLINE_CURVATURE: 0,
    SCANLINE_STRENGTH: 0.75,
    EMISSION_STRENGTH: 0.07,
    HALO_STRENGTH: 0.2,
    BLOOM_STRENGTH: 0.1,
    GLITCH_AMOUNT: 0.05,
    EDGE_PARTICLE_AMOUNT: 1,
    BRIGHT_SWEEP_STRENGTH: 0.15,
    BRIGHT_SWEEP_SPEED: 0.07,
    BRIGHT_SWEEP_WIDTH: 0.03,
    THIN_SWEEP_STRENGTH: 0.21,
    THIN_SWEEP_WIDTH: 0.012,
    THIN_SWEEP_SPEED_MIN: 0.14,
    THIN_SWEEP_SPEED_MAX: 0.21,
    DROPOUT_AMOUNT: 0.065,
    DROPOUT_SIZE: 1.7,
    DROPOUT_SPEED: 0.15,
    DROPOUT_ANGLE: -34,
    GLOW_COLOR: "#8ACE00",
  },
  /** Physical terminal NET-01 (docs/TERMINAL.md §17). */
  terminal: {
    /** Render pixels across the terminal body's short side; the canvas is upscaled without smoothing. */
    RENDER_SCALE_SHORT: 600,
    /** Aspect of the CRT picture, 320:440 = 1:1.375 (spec §5.2). The picture itself is drawn 1:1 with the glass's render pixels. */
    CRT_RES_W: 320,
    CRT_RES_H: 440,
    /** Viewport aspect (w/h) range the terminal body stretches to; outside it the terminal is letterboxed. */
    TERMINAL_ASPECT_MIN: 0.42,
    TERMINAL_ASPECT_MAX: 0.62,
    /** Vertical shares of the terminal, top to bottom (spec §3; sum = 1). */
    LAYOUT_CRT: 0.64,
    /** Lower CRT frame holding the 14-segment display. */
    LAYOUT_DISPLAY: 0.037,
    LAYOUT_RAIL: 0.15,
    LAYOUT_DECK: 0.173,
    /** Horizontal bezel around the CRT glass, as a share of terminal width on each side. */
    CRT_MARGIN_X: 0.015,
    /** The control panel (rail, draw strip, trackball, pause) is one plane; its top edge leans away from the player, degrees. */
    CONTROL_TILT: 45,
    /** The screen leans back about its lower edge, degrees (spec §3.1). */
    CRT_TILT: 4,
    /** A trackball gesture that never travelled counts as a chip shot within this long (spec §10.2). */
    TAP_MAX_TIME: 0.35,
    /** Pause key in the bottom-left corner of the control panel: zone side, share of terminal width. */
    PAUSE_ZONE_W: 0.16,
    /** Vertical field of view, degrees. */
    CAMERA_FOV: 45,
    /** Glass effects, moderate: the picture must stay readable (spec §5.3). */
    CRT_SCANLINES: 0.3,
    CRT_CURVATURE: 0.06,
    CRT_BLEED: 0.35,
    /** Previous-frame persistence; 0 disables the ghosting pass entirely. */
    CRT_GHOSTING: 0.6,
    CRT_FLASH_TIME: 0.12,
    /** RGB phosphor triads across the texel columns. */
    CRT_PHOSPHOR: 0,
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
    BALL_W: 0.2,
    RING_W: 0.235,
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
    /** Flash of a trackball direction triangle on a step. */
    ARROW_FLASH_TIME: 0.15,
    /** Chip rail (spec §9.2): active chip lift and push (world units), animation times (s). */
    /** Loaded and compatible chips tilt toward the player about their bottom edge, degrees. */
    CHIP_TILT_DEG: 32,
    /** How far the active cartridge slides out of its slot toward the player. */
    CHIP_ACTIVE_PUSH: 0.1,
    CHIP_BLOCKED_SINK: 0.04,
    /** A reserved chip sits visibly below the ready position while its slot cools. */
    CHIP_COOLDOWN_SINK: 0.12,
    /** Extra depth below the cooling rest position where a reserved chip first appears. */
    CHIP_PENDING_LOAD_DEPTH: 0.3,
    /** Brightness of the light the active cartridge throws on its own slot. */
    CHIP_ACTIVE_GLOW: 0.7,
    EJECT_LIFT_TIME: 0.06,
    EJECT_TIME: 0.55,
    LOAD_TIME: 0.18,
    LOAD_STAGGER: 0.05,
    CONTACT_FLASH_TIME: 0.2,
    /** Three red body pulses when a chip chain is cancelled before use. */
    CHIP_CANCEL_FLASH_TIME: 1.2,
    /** Nothing queued this long in battle: the cassette faces start flashing to call for a pick (s). */
    RAIL_ATTRACT_DELAY: 1.5,
    /** One beat of those flashing patterns (s). */
    RAIL_ATTRACT_STEP: 0.45,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

const STORAGE_KEY = "glorp.tuning.v1";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const tuning: Tuning = clone(DEFAULT_TUNING);

/** Copies known keys from `src` into `dst`, ignoring unknown keys and type mismatches. */
export function mergeTuning(dst: Tuning, src: unknown): void {
  if (!src || typeof src !== "object") return;
  const d = dst as unknown as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(
    src as Record<string, unknown>,
  )) {
    const target = d[group];
    if (!target || !values || typeof values !== "object") continue;
    for (const [key, value] of Object.entries(
      values as Record<string, unknown>,
    )) {
      if (key in target && typeof target[key] === typeof value)
        target[key] = value;
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
