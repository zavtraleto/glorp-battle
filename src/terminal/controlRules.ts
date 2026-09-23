import type { Dir } from '../core/input/commands';
import type { GameState } from '../sim/world';
import { RAIL_ZONE_SLOTS, type ZoneId } from './layout';
import type { TerminalMode } from './terminalMode';

// When terminal controls act and how they feel (spec §11). Pure.

export interface ControlWorld {
  state: GameState;
  activeChip: unknown;
  player: { flinched: boolean; actionTicks: number; paralyzeTicks: number };
  chips: { attack: readonly number[]; locked: boolean };
}

/** `dull`: the control moves less and sends nothing. */
export type Availability = 'ok' | 'dull';

/** Whether a tap on the trackball may use the active chip. */
export function shotAvailability(w: ControlWorld): Availability {
  if (w.state !== 'ACTION' || w.chips.attack.length === 0) return 'dull';
  return w.player.flinched || w.player.paralyzeTicks > 0 ? 'dull' : 'ok';
}

/** A tap on the ball would act: pick a menu item, or fire a loaded chip. */
export function trackballArmed(mode: TerminalMode, shot: Availability): boolean {
  return mode === 'MENU' || (mode === 'BATTLE' && shot === 'ok');
}

/**
 * Controls react in BATTLE; in MENU the trackball moves the cursor and a tap
 * picks the item; the pause key works whenever it is visible.
 */
export function acceptsPress(mode: TerminalMode, zone: ZoneId): boolean {
  if (zone === 'pause' || mode === 'BATTLE') return true;
  return mode === 'MENU' && zone === 'trackball';
}

export interface KeyOrgan {
  zone: ZoneId;
  dir?: Dir;
  fire?: boolean;
  /** Hand slot for the digit keys. */
  slot?: number;
}

const KEY_ORGANS: Record<string, KeyOrgan> = {
  KeyW: { zone: 'trackball', dir: 'up' },
  ArrowUp: { zone: 'trackball', dir: 'up' },
  KeyS: { zone: 'trackball', dir: 'down' },
  ArrowDown: { zone: 'trackball', dir: 'down' },
  KeyA: { zone: 'trackball', dir: 'left' },
  ArrowLeft: { zone: 'trackball', dir: 'left' },
  KeyD: { zone: 'trackball', dir: 'right' },
  ArrowRight: { zone: 'trackball', dir: 'right' },
  Space: { zone: 'trackball', fire: true },
  KeyF: { zone: 'trackball', fire: true },
  Escape: { zone: 'pause' },
};

/** The control a keyboard key stands for (keys only animate it; commands come from the keyboard device). */
export function organForKey(code: string): KeyOrgan | null {
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) {
    const slot = Number(digit[1]) - 1;
    return slot < RAIL_ZONE_SLOTS ? { zone: 'rail', slot } : null;
  }
  return KEY_ORGANS[code] ?? null;
}

export type CursorKind = 'default' | 'point' | 'press';

/** `pointing`: the pointer is over something that can be pressed. */
export function cursorKind(pointing: boolean, pressed: boolean): CursorKind {
  if (pressed) return 'press';
  return pointing ? 'point' : 'default';
}
