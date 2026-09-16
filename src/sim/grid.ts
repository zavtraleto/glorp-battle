// Logical battlefield (GDD §2.1): 3 columns × 6 rows, enemy on top (y 0..2), player below (y 3..5).

export const COLS = 3;
export const ROWS = 6;
export const ENEMY_ROWS = { min: 0, max: 2 } as const;
export const PLAYER_ROWS = { min: 3, max: 5 } as const;

export type Side = 'enemy' | 'player';

export interface Cell {
  x: number;
  y: number;
}

export function inField(x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

export function sideOfRow(y: number): Side {
  return y <= ENEMY_ROWS.max ? 'enemy' : 'player';
}

/** Cells of lane `x` from row `fromY` down to the last row (toward the player). */
export function laneCellsBelow(x: number, fromY: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = Math.max(0, fromY); y < ROWS; y++) cells.push({ x, y });
  return cells;
}

export function inTerritory(side: Side, x: number, y: number): boolean {
  return inField(x, y) && sideOfRow(y) === side;
}
