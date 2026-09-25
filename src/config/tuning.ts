// All tunable gameplay parameters (GDD §17). Times are in seconds.
// Never hardcode these values elsewhere: read them from `tuning`.
// The debug panel edits this object live and persists overrides.

/** Designer-facing combat timing unit. The simulation still runs at SIM_HZ. */
export const COMBAT_TIMING_UNIT = 0.1;

export const DEFAULT_TUNING = {
  sim: {
    SIM_HZ: 60,
    MAX_FRAME_TIME: 0.25,
    TIME_SCALE: 1,
  },
  combo: {
    WORLD_TIME_SCALE: 0.85,
    SLOW_MO_ENTER: 0.1,
    SLOW_MO_EXIT: 0.15,
    COMBO_BREAK_EXIT: 0.08,
    CHIP_INPUT_BUFFER: 0.1,
    /** Experimental: world speed while the Attack Queue is being built (GDD §6.7); 1 = off. */
    SELECT_TIME_SCALE: 0.1,
    SELECT_SLOW_MO_ENTER: 0.1,
    /** Selection slow-mo budget per hand, unscaled seconds (GDD §6.7). */
    SELECT_SLOW_MO_TIME: 3,
    /** Unscaled seconds for an empty budget to refill while the queue is empty. */
    SELECT_SLOW_MO_RECHARGE: 6,
  },
  /** Battle flow around the fight: intro, waves (GDD §10.4), result delays. */
  flow: {
    /** Enemies appear and the hand rides into the rail before the battle runs. */
    INTRO_TIME: 0.6,
    /** Last enemy of a wave deleted → the field resets; covers the deletion animation. */
    WAVE_CLEAR_TIME: 0.4,
    /** New enemies materialize line by line on the reset field; nothing acts yet (GDD §10.4). */
    WAVE_SPAWN_TIME: 0.7,
    /** "ENEMY DELETED!" banner before the result screen. */
    RESULT_DELAY_WIN: 0.9,
    /** Player deletion before the GAME OVER screen. */
    RESULT_DELAY_LOSE: 1.0,
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
  },
  hand: {
    /** Hand slots visible in the rail for the whole battle (GDD §5). */
    SIZE: 5,
    /** A spent slot cools this long from its chip's hit until the next draw arrives (GDD §5). */
    REFILL_COOLDOWN: 4.0,
    /** A completed combo cuts each of its slots' cooldown by this × the combo's size. */
    COMBO_CUT_PER_CHIP: 0.4,
  },
  // Chips (GDD §6): one group per chip id; STARTUP → impact → RECOVERY (GDD §6.5).
  cannon: {
    DAMAGE: 4,
    STARTUP: 0.1,
    RECOVERY: 0.15,
  },
  airshot: {
    DAMAGE: 2,
    STARTUP: 0.1,
    RECOVERY: 0.15,
  },
  spreader: {
    DAMAGE: 3,
    /** Damage to the cells beside the hit. */
    SPLASH_DAMAGE: 1,
    STARTUP: 0.1,
    RECOVERY: 0.15,
  },
  sword: {
    DAMAGE: 6,
    STARTUP: 0.15,
    RECOVERY: 0.2,
  },
  widesword: {
    DAMAGE: 4,
    STARTUP: 0.15,
    RECOVERY: 0.2,
  },
  areagrab: {
    STARTUP: 0.15,
    RECOVERY: 0.15,
    DURATION: 8,
    /** AreaGrab skips occupied cells and deals this to whoever stands there. */
    OCCUPANT_DMG: 1,
  },
  mine: {
    DAMAGE: 6,
    STARTUP: 0.15,
    RECOVERY: 0.15,
    /** Rows ahead of the player that Mine arms. */
    TARGET_DISTANCE: 3,
  },
  block: {
    STARTUP: 0.15,
    RECOVERY: 0.15,
    HP: 2,
    DURATION: 6,
  },
  break: {
    STARTUP: 0.15,
    RECOVERY: 0.15,
    /** Rows ahead of the player that Break breaks. */
    TARGET_DISTANCE: 3,
    DURATION: 5,
  },
  guard: {
    STARTUP: 0.15,
    RECOVERY: 0.15,
  },
  /** Tutorial (GDD §10.5). */
  tutorial: {
    /** Free movement after the MOVE callout, before the first Cannon arrives. */
    TUT_FREE_MOVE: 3,
    /** Least time between one callout closing and the next opening. */
    TUT_CALLOUT_GAP: 1,
  },
  /** Shared by every enemy (GDD §8.1). */
  enemy: {
    COUNTER_STAGGER_TIME: 0.5,
  },
  // Enemy timings follow MMBN6 as the Hub-OS mods recreate it (GDD §8.2–8.4):
  // frame counts / 60, rounded, then shortened for tempo (2026-09-25). Bunny has
  // no frame data: Hopzap is [оценка].
  mettik: {
    /** Pickaxe raised (0.34 s in BN6), then the counter window up to the wave (0.72 s). */
    INTENTION_TIME: 0.2,
    LOCK_TIME: 0.14,
    COUNTER_TIME: 0.38,
    STRIKE_TIME: 0.1,
    RECOVERY_TIME: 0.32,
    /** Slide between cells on screen. */
    MOVE_TIME: 0.2,
    /** Wait before every action: each step, each strike, and on getting the turn (38 frames in BN6). */
    ACTION_DELAY: 0.4,
    /** Shockwave speed: 21 frames per cell. */
    WAVE_CELL_TIME: 0.35,
    /** Steps the turn holder may chase the player's lane before handing the turn on. */
    CHASE_STEPS: 3,
    /** true: the turn goes on as the wave leaves; false: after recovery (BN6). */
    HANDOFF_ON_WAVE: true,
    HP: 4,
    DMG: 1,
  },
  canodron: {
    /** Least time the cursor is on screen before it can lock. */
    INTENTION_TIME: 0.3,
    /** Lock-on blink, then the shot (0.37 s in BN3). */
    LOCK_TIME: 0.2,
    COUNTER_TIME: 0.17,
    STRIKE_TIME: 0.1,
    /** Cursor smoke before it aims again (~2 s in BN3). */
    RECOVERY_TIME: 1.0,
    MOVE_TIME: 0.2,
    HP: 6,
    DMG: 1,
    /** Cursor speed: 15 frames per cell. */
    CURSOR_STEP: 0.25,
  },
  hopzap: {
    INTENTION_TIME: 0.3,
    LOCK_TIME: 0.2,
    COUNTER_TIME: 0.2,
    STRIKE_TIME: 0.1,
    RECOVERY_TIME: 0.3,
    MOVE_TIME: 0.15,
    HP: 4,
    DMG: 1,
    PARALYZE: 1.0,
    /** Stop between hops. */
    SETTLE_TIME: 0.3,
    ALIGN_CHANCE: 0.6,
    /** ZapRing speed. */
    RING_CELL_TIME: 0.2,
  },
  bladdy: {
    /** Warned cells flash 64 frames before the swing. */
    INTENTION_TIME: 0.5,
    LOCK_TIME: 0.3,
    COUNTER_TIME: 0.27,
    STRIKE_TIME: 0.15,
    /** Holds after the swing (~64–80 frames in BN6). */
    RECOVERY_TIME: 0.7,
    MOVE_TIME: 0.4,
    HP: 9,
    DMG: 3,
    /** Stop after each step (0.8 in BN6: one step per ~1.2 s with MOVE_TIME). */
    SETTLE_TIME: 0.45,
    AREA_GRAB_DECISIONS: 3,
    /** Damage to the player standing in the row Bladdy's AreaGrab takes. */
    AREA_GRAB_DMG: 1,
    /** AreaGrab never leaves the player fewer rows than this behind the grabbed one. */
    MIN_PLAYER_ROWS: 2,
  },
  fx: {
    HIT_FLASH: 0.1,
    IFRAME_BLINK_HZ: 15,
    CANNON_TRACER_TIME: 0.18,
    SLASH_TIME: 0.15,
    WARP_FX_TIME: 0.15,
    DAMAGE_NUMBER_TIME: 0.6,
    DELETE_ANIM_TIME: 0.4,
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
    /** A completed combo cut this slot's cooldown: one fading yellow glow (s). */
    CHIP_CUT_FLASH_TIME: 0.35,
    /** Nothing queued this long in battle: the cassette faces start flashing to call for a pick (s). */
    RAIL_ATTRACT_DELAY: 1.5,
    /** One beat of those flashing patterns (s). */
    RAIL_ATTRACT_STEP: 0.45,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

const STORAGE_KEY = "glorp.tuning.v2";
/** Overrides saved before the 2026-09-25 regrouping; dropped on load. */
const LEGACY_STORAGE_KEY = "glorp.tuning.v1";

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
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
