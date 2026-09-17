import type { Offset, Shape } from '../../data/chips';
import { inField, type Cell } from '../grid';

// Chip shapes (GDD §6.4, roguelite spec §4.2). The player stands at (px, py)
// and faces −y. Lane shapes need the field to find their target, so they take a lookup.

/** Row of the first target in lane `x` in front of row `py`, or -1. */
export type TargetRow = (x: number, py: number) => number;

function around(offsets: readonly Offset[], x: number, y: number): Cell[] {
  return offsets.map((o) => ({ x: x + o.x, y: y + o.y })).filter((c) => inField(c.x, c.y));
}

/** Cells damaged right away by lane and near shapes; other shapes return []. */
export function shapeCells(shape: Shape, px: number, py: number, targetRow: TargetRow): Cell[] {
  switch (shape.t) {
    case 'lane': {
      const ty = targetRow(px, py);
      if (ty < 0) return [];
      return [{ x: px, y: ty }, ...around(shape.around ?? [], px, ty)];
    }
    case 'near':
      return around(shape.cells, px, py);
    default:
      return [];
  }
}

/** Landing cell of a lobbed chip (MMBN1 MiniBomb: "Depth=3"), or null off the field. */
export function lobTarget(depth: number, px: number, py: number): Cell | null {
  const c = { x: px, y: py - depth };
  return inField(c.x, c.y) ? c : null;
}

/** Cells hit around a landing cell. */
export function lobArea(area: readonly Offset[], x: number, y: number): Cell[] {
  return around(area, x, y);
}
