import { COLS, ROWS } from '../sim/grid';
import type { GameState } from '../sim/world';

// Wordless battle signals on the grid (BATTLE_VISUAL.md §8) and enemy HP
// segments (§7). Pure.

export interface GridSignal {
  /** 0..1 per row: how much of the row is drawn in. */
  reveal(y: number): number;
  /** Extra accent brightness for a cell (0..1). */
  flash(x: number, y: number): number;
  /** Cells forced BROKEN. */
  broken(x: number, y: number): boolean;
  /** Whole grid drawn in red (defeat). */
  red: boolean;
}

export const NO_SIGNAL: GridSignal = { reveal: () => 1, flash: () => 0, broken: () => false, red: false };

export interface SignalInput {
  state: GameState;
  /** Ticks since the state began (world.stateElapsed). */
  elapsed: number;
  player: { x: number; y: number };
  introTicks: number;
  wonTicks: number;
  deadTicks: number;
}

/** Rows counted from the player's edge: the nearest row is 0. */
function nearIndex(y: number): number {
  return ROWS - 1 - y;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function battleSignal(i: SignalInput): GridSignal {
  switch (i.state) {
    case 'BATTLE_INTRO': {
      // The grid draws in row by row, away from the player.
      const t = i.elapsed / Math.max(1, i.introTicks);
      return { ...NO_SIGNAL, reveal: (y) => clamp01(t * ROWS * 1.25 - nearIndex(y)) };
    }
    case 'BATTLE_WON': {
      // Enemy cells blink, the rest pulses once.
      const on = Math.floor(i.elapsed / 4) % 2 === 0;
      const t = i.elapsed / Math.max(1, i.wonTicks);
      const pulse = clamp01(1 - Math.abs(t * 3 - 1));
      return { ...NO_SIGNAL, flash: (_x, y) => (y < ROWS / 2 ? (on ? 1 : 0) : pulse * 0.6) };
    }
    case 'PLAYER_DEAD': {
      // The grid breaks outward from the player and fades out in red.
      const t = i.elapsed / Math.max(1, i.deadTicks);
      const radius = t * (ROWS + COLS);
      return {
        reveal: () => clamp01(1 - (t - 0.6) / 0.4),
        flash: () => 0,
        broken: (x, y) => Math.abs(x - i.player.x) + Math.abs(y - i.player.y) <= radius,
        red: true,
      };
    }
    default:
      return NO_SIGNAL;
  }
}

/** Enemy HP as segments: any HP left shows at least one. */
export function hpSegments(hp: number, maxHp: number, total: number): { filled: number; total: number } {
  if (hp <= 0 || maxHp <= 0) return { filled: 0, total };
  return { filled: Math.max(1, Math.min(total, Math.ceil((hp / maxHp) * total))), total };
}
