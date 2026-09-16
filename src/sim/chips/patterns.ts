import type { PatternId } from '../../data/chips';
import { inField, type Cell } from '../grid';

// Attack patterns (GDD §6.4). The player stands at (px, py) and faces −y.
// Hitscan patterns need the field to find their target, so they take a lookup.

/** Returns the row of the first living enemy in lane `x` in front of `py`, or -1. */
export type FirstEnemyRow = (x: number, py: number) => number;

/** Fixed cells hit by melee patterns, clipped to the field. */
export function meleeCells(pattern: PatternId, px: number, py: number): Cell[] {
  let cells: Cell[];
  switch (pattern) {
    case 'melee_1':
      cells = [{ x: px, y: py - 1 }];
      break;
    case 'melee_wide':
      cells = [
        { x: px - 1, y: py - 1 },
        { x: px, y: py - 1 },
        { x: px + 1, y: py - 1 },
      ];
      break;
    case 'melee_long':
      cells = [
        { x: px, y: py - 1 },
        { x: px, y: py - 2 },
      ];
      break;
    default:
      cells = [];
  }
  return cells.filter((c) => inField(c.x, c.y));
}

/** Landing cell of a lobbed bomb (MMBN1 MiniBomb: "Depth=3"). */
export function lobTarget(px: number, py: number): Cell | null {
  const c = { x: px, y: py - 3 };
  return inField(c.x, c.y) ? c : null;
}

/**
 * Cells damaged by hitscan patterns: the first enemy in the lane, plus the
 * panel behind it for Shotgun ("Hits enemy and keeps going 1pnl").
 */
export function hitscanCells(pattern: PatternId, px: number, py: number, firstEnemyRow: FirstEnemyRow): Cell[] {
  const ey = firstEnemyRow(px, py);
  if (ey < 0) return [];
  const cells: Cell[] = [{ x: px, y: ey }];
  if (pattern === 'lane_hitscan_pierce1' && inField(px, ey - 1)) cells.push({ x: px, y: ey - 1 });
  return cells;
}
