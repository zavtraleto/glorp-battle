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

export function executeAvailability(w: ControlWorld): { press: Availability; notice: 'noChip' | null } {
  if (w.state !== 'ACTION') return { press: 'dull', notice: null };
  if (w.chips.queue.length === 0) return { press: 'dull', notice: 'noChip' };
  const busy = w.activeChip !== null || w.player.flinched || w.player.actionTicks > 0;
  return { press: busy ? 'dull' : 'ok', notice: null };
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
