import type { Screen } from '../app/session';
import type { GameState } from '../sim/world';

// Terminal mode (TERMINAL.md §4) and status lamps (§7.3). Derived every
// frame from the session and the world, never stored.

export type TerminalMode = 'BATTLE' | 'MENU' | 'TRANSITION';

export function terminalMode(screen: Screen, state: GameState): TerminalMode {
  if (screen !== 'BATTLE') return 'MENU';
  // Chip selection happens inside ACTION (on the rail).
  if (state === 'ACTION') return 'BATTLE';
  return 'TRANSITION';
}

/** Blink rate of anything that pulses on the CRT, Hz. */
export const LAMP_BLINK_HZ = 2;

export function blinkPhase(timeSec: number, hz = LAMP_BLINK_HZ): boolean {
  return Math.floor(timeSec * hz * 2) % 2 === 0;
}
