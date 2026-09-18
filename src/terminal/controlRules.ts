import type { Dir } from '../core/input/commands';
import type { GameState } from '../sim/world';
import { RAIL_ZONE_SLOTS, type ZoneId } from './layout';
import type { TerminalMode } from './terminalMode';

// When terminal controls act and how they feel (spec §11). Pure.

export interface ControlWorld {
  state: GameState;
  activeChip: unknown;
  player: { flinched: boolean; actionTicks: number };
  chips: { attack: readonly number[] };
}

/** `dull`: the control moves less and sends nothing. */
export type Availability = 'ok' | 'dull';

/** Whether a tap on the trackball may use the active chip. */
export function shotAvailability(w: ControlWorld): Availability {
  if (w.state !== 'ACTION' || w.chips.attack.length === 0) return 'dull';
  const busy = w.activeChip !== null || w.player.flinched || w.player.actionTicks > 0;
  return busy ? 'dull' : 'ok';
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

export type TrayKeyAction =
  | { kind: 'focus'; delta: number }
  | { kind: 'pick' }
  | { kind: 'removeLast' }
  | { kind: 'ok' }
  | { kind: 'add' };

/** Keyboard on the chip tray (TERMINAL.md §6.4): arrows move the focus, Space / F pick. */
export function trayKeyAction(code: string, columns: number): TrayKeyAction | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
      return { kind: 'focus', delta: -1 };
    case 'ArrowRight':
    case 'KeyD':
      return { kind: 'focus', delta: 1 };
    case 'ArrowUp':
    case 'KeyW':
      return { kind: 'focus', delta: -columns };
    case 'ArrowDown':
    case 'KeyS':
      return { kind: 'focus', delta: columns };
    case 'Space':
    case 'KeyF':
      return { kind: 'pick' };
    case 'Backspace':
      return { kind: 'removeLast' };
    case 'Enter':
      return { kind: 'ok' };
    case 'KeyR':
      return { kind: 'add' };
    default:
      return null;
  }
}

/** Moves the tray focus, skipping empty hand slots; stays put if nothing is there. */
export function stepFocus(slot: number, delta: number, filled: readonly boolean[]): number {
  let i = slot + delta;
  while (i >= 0 && i < filled.length) {
    if (filled[i]) return i;
    i += Math.sign(delta);
  }
  return slot;
}
