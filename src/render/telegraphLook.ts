import { tuning } from '../config/tuning';
import type { CursorView, EnemyState } from '../sim/enemies/enemyBase';

// Telegraph language on screen (GDD §8.1.1, BATTLE_VISUAL.md §6.1): how the
// enemy sprite reads in each phase and how a tracking cursor glides. Pure.

export interface EnemyLook {
  /** Pose lift in texel steps. */
  lift: number;
  /** White hit/strike flash. */
  flash: boolean;
  /** Colour wash over the sprite: red while winding up, yellow in the counter window. */
  tint: 'red' | 'accent' | null;
  /** Strength of the wash, 0..1. */
  tintAmount: number;
  /** Brightness multiplier (RECOVERY reads as powered down). */
  brightness: number;
}

/** Sprite look for an enemy phase at `seconds` of world time (idle bob excluded). */
export function enemyLook(state: EnemyState, seconds: number): EnemyLook {
  const v = tuning.battleVisual;
  const look: EnemyLook = { lift: 0, flash: false, tint: null, tintAmount: 0, brightness: 1 };
  switch (state) {
    case 'INTENTION':
    case 'LOCK':
      // Wind-up: raised pose, blinking red; the corridor tells how long is left.
      look.lift = 2;
      if (Math.sin(seconds * Math.PI * 2 * v.DANGER_PULSE_HZ) > 0.2) {
        look.tint = 'red';
        look.tintAmount = v.WINDUP_TINT;
      }
      break;
    case 'COUNTER':
      // Your window (yellow = action): never fully off, so it reads as one span.
      look.lift = 2;
      look.tint = 'accent';
      look.tintAmount = Math.sin(seconds * Math.PI * 4 * v.DANGER_PULSE_HZ) > 0 ? 1 : 0.6;
      break;
    case 'STRIKE':
      look.lift = 1;
      look.flash = true;
      break;
    case 'RECOVERY':
      look.brightness = v.RECOVERY_DIM;
      break;
    default:
      break;
  }
  return look;
}

/** Share of a cursor step spent gliding into the new cell. */
const CURSOR_GLIDE = 0.6;

/**
 * How far a tracking cursor has glided from its previous cell into its
 * current one (0..1, eased out) at `now` world ticks.
 */
export function cursorGlide(c: CursorView, now: number): number {
  const t = Math.max(0, Math.min(1, (now - c.stepTick) / Math.max(1, c.stepTicks * CURSOR_GLIDE)));
  return 1 - (1 - t) * (1 - t);
}

/**
 * Homing on the target after the glide (0..1, eased in and out): the reticle
 * slides onto the figure and tightens over `CURSOR_SETTLE_TIME`.
 */
export function cursorSettle(c: CursorView, now: number): number {
  const from = c.stepTick + c.stepTicks * CURSOR_GLIDE;
  const span = Math.max(1, tuning.battleVisual.CURSOR_SETTLE_TIME * tuning.sim.SIM_HZ);
  const t = Math.max(0, Math.min(1, (now - from) / span));
  return t * t * (3 - 2 * t);
}
