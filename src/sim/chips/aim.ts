import type { ChipDef } from '../../data/chips';
import { tuning } from '../../config/tuning';
import { claimRow } from '../field';
import { COLS, type Cell, type Side } from '../grid';
import { lobArea, lobTarget, shapeCells, type TargetRow } from './patterns';

// Aim preview of the loaded chip (TERMINAL.md §6.3, decision 2026-09-19): the
// cells the chip would hit if fired now, from the same shape rules the hit
// itself uses. Pure: reads the field through the lookups it is given.

export interface AimLookup {
  px: number;
  py: number;
  firstTargetRow: TargetRow;
  owner(x: number, y: number): Side | null;
  /** A hole (BROKEN panel). */
  hole(x: number, y: number): boolean;
  /** An object (rock) stands there. */
  object(x: number, y: number): boolean;
  /** Anything stands there: enemy, object or the player. */
  occupied(x: number, y: number): boolean;
}

export interface Aim {
  /** Cells the chip acts on. */
  cells: Cell[];
  /** A shot travelling up the player's lane: rows `fromY` (exclusive) to `toY` (inclusive). */
  beam: { x: number; fromY: number; toY: number } | null;
}

const NONE: Aim = { cells: [], beam: null };

/** Rows ahead of the player that Mine (`arm`) and Break target (GDD §6.2). */
export function fieldTargetDistance(action: 'arm' | 'break'): number {
  return action === 'arm' ? tuning.chips.MINE_TARGET_DISTANCE : tuning.chips.BREAK_TARGET_DISTANCE;
}

function fieldCells(def: ChipDef, l: AimLookup): Cell[] {
  const cells: Cell[] = [];
  switch (def.field) {
    case 'claim': {
      const free = (x: number, y: number) => !l.occupied(x, y);
      const y = claimRow(l.owner, free);
      if (y >= 0) for (let x = 0; x < COLS; x++) if (l.owner(x, y) === 'enemy' && free(x, y)) cells.push({ x, y });
      break;
    }
    case 'occupy':
      if (l.py - 1 >= 0) cells.push({ x: l.px, y: l.py - 1 });
      break;
    case 'arm':
    case 'break': {
      const y = l.py - fieldTargetDistance(def.field);
      if (y >= 0) cells.push({ x: l.px, y });
      break;
    }
    case undefined:
      break;
  }
  return cells;
}

/** Where `def` would land if fired from (px, py) now. */
export function chipAim(def: ChipDef, l: AimLookup): Aim {
  const shape = def.shape;
  switch (shape.t) {
    case 'lane': {
      const cells = shapeCells(shape, l.px, l.py, l.firstTargetRow);
      const toY = cells[0]?.y ?? 0;
      return { cells, beam: { x: l.px, fromY: l.py, toY } };
    }
    case 'near':
      return { cells: shapeCells(shape, l.px, l.py, l.firstTargetRow), beam: null };
    case 'lob': {
      const land = lobTarget(shape.depth, l.px, l.py);
      return land ? { cells: lobArea(shape.area, land.x, land.y), beam: null } : NONE;
    }
    case 'wave': {
      // The wave runs up the lane and stops at a hole or an object in the way.
      const cells: Cell[] = [];
      for (let y = l.py - 1; y >= 0; y--) {
        if (l.hole(l.px, y)) break;
        cells.push({ x: l.px, y });
        if (l.object(l.px, y)) break;
      }
      return { cells, beam: null };
    }
    case 'self': {
      if (def.field) return { cells: fieldCells(def, l), beam: null };
      return { cells: [{ x: l.px, y: l.py }], beam: null };
    }
  }
}
