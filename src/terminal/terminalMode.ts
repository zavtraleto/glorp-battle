import type { Screen } from '../app/session';
import type { GameState } from '../sim/world';

// Terminal mode (TERMINAL.md §4) and status lamps (§7.3). Derived every
// frame from the session and the world, never stored.

export type TerminalMode = 'BATTLE' | 'CHIP_SELECT' | 'MENU' | 'TRANSITION';

export function terminalMode(screen: Screen, state: GameState): TerminalMode {
  // The reward is picked on the chip tray (roguelite spec §6.3).
  if (screen === 'REWARD') return 'CHIP_SELECT';
  if (screen !== 'BATTLE') return 'MENU';
  // Chip selection happens inside ACTION now; the tray only serves rewards.
  if (state === 'ACTION') return 'BATTLE';
  return 'TRANSITION';
}

/** Blink rate of anything that pulses on the CRT, Hz. */
export const LAMP_BLINK_HZ = 2;

export function blinkPhase(timeSec: number, hz = LAMP_BLINK_HZ): boolean {
  return Math.floor(timeSec * hz * 2) % 2 === 0;
}
