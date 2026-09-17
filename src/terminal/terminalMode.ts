import type { Screen } from '../app/session';
import type { GameState } from '../sim/world';

// Terminal mode (TERMINAL.md §4) and status lamps (§7.3). Derived every
// frame from the session and the world, never stored.

export type TerminalMode = 'BATTLE' | 'CHIP_SELECT' | 'MENU' | 'TRANSITION';

export function terminalMode(screen: Screen, state: GameState): TerminalMode {
  if (screen !== 'BATTLE') return 'MENU';
  if (state === 'ACTION') return 'BATTLE';
  if (state === 'CUSTOM') return 'CHIP_SELECT';
  return 'TRANSITION';
}

export interface LampStates {
  power: boolean;
  sync: boolean;
  link: boolean;
  battle: boolean;
}

export const LAMP_BLINK_HZ = 2;

export function blinkPhase(timeSec: number, hz = LAMP_BLINK_HZ): boolean {
  return Math.floor(timeSec * hz * 2) % 2 === 0;
}

export function lampStates(mode: TerminalMode, screen: Screen, gaugeFull: boolean, timeSec: number): LampStates {
  const blink = blinkPhase(timeSec);
  return {
    power: true,
    sync: mode === 'TRANSITION' && blink,
    link: screen === 'BATTLE' || screen === 'PAUSED',
    battle: mode === 'BATTLE' && (!gaugeFull || blink),
  };
}
