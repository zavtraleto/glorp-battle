import type { Cell } from '../grid';

// Telegraph language (GDD §8.1.1): shape = where, fill = when, colour = who.
// An enemy attack describes the cells it will hit and a fuse that burns from
// the moment the attack is committed to the strike tick.

/**
 * - `lane`: a corridor down a lane, cells ordered from the source.
 * - `area`: cells hit at once (swords).
 * - `grab`: the cells change owner (AreaGrab); drawn as a field change.
 */
export type TelegraphKind = 'lane' | 'area' | 'grab';

export interface Telegraph {
  enemyId: number;
  kind: TelegraphKind;
  cells: Cell[];
  /** World tick the fuse was lit. */
  start: number;
  /** World tick of the strike. */
  end: number;
}

/** Burnt share of the fuse at `now` (world ticks, may be fractional), 0..1. */
export function fuseProgress(t: Telegraph, now: number): number {
  const span = t.end - t.start;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (now - t.start) / span));
}
