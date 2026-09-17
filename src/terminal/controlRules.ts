import type { Dir } from '../core/input/commands';
import type { GameState } from '../sim/world';
import type { ZoneId } from './layout';
import type { TerminalMode } from './terminalMode';

// When terminal controls act and how they feel (TERMINAL.md §5). Pure.

export interface ControlWorld {
  state: GameState;
  activeChip: unknown;
  gauge: { full: boolean };
  player: { flinched: boolean; actionTicks: number };
  chips: { queue: readonly unknown[] };
}

/** `dull`: the control moves less and sends nothing. */
export type Availability = 'ok' | 'dull';

export function executeAvailability(w: ControlWorld): Availability {
  if (w.state !== 'ACTION' || w.chips.queue.length === 0) return 'dull';
  const busy = w.activeChip !== null || w.player.flinched || w.player.actionTicks > 0;
  return busy ? 'dull' : 'ok';
}

export function chipSelectAvailability(w: ControlWorld): Availability {
  return w.state === 'ACTION' && w.gauge.full ? 'ok' : 'dull';
}

/**
 * Controls react in BATTLE; in MENU the trackball moves the cursor and EXECUTE
 * picks the item; the pause key works whenever it is visible.
 */
export function acceptsPress(mode: TerminalMode, zone: ZoneId): boolean {
  if (zone === 'pause' || mode === 'BATTLE') return true;
  return mode === 'MENU' && (zone === 'trackball' || zone === 'execute');
}

const KEY_ORGANS: Record<string, { zone: ZoneId; dir?: Dir }> = {
  KeyW: { zone: 'trackball', dir: 'up' },
  ArrowUp: { zone: 'trackball', dir: 'up' },
  KeyS: { zone: 'trackball', dir: 'down' },
  ArrowDown: { zone: 'trackball', dir: 'down' },
  KeyA: { zone: 'trackball', dir: 'left' },
  ArrowLeft: { zone: 'trackball', dir: 'left' },
  KeyD: { zone: 'trackball', dir: 'right' },
  ArrowRight: { zone: 'trackball', dir: 'right' },
  Space: { zone: 'execute' },
  KeyF: { zone: 'execute' },
  KeyQ: { zone: 'chipSelect' },
  KeyE: { zone: 'chipSelect' },
  Escape: { zone: 'pause' },
};

/** The control a keyboard key stands for (keys only animate it; commands come from the keyboard device). */
export function organForKey(code: string): { zone: ZoneId; dir?: Dir } | null {
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
