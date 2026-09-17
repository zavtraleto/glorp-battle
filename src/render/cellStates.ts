import type { Cell } from '../sim/grid';

// Visual state of each battle cell (BATTLE_VISUAL.md §4). Pure.

export type CellVisual = 'NORMAL' | 'ACTIVE' | 'DANGER' | 'ATTACK' | 'AFTER' | 'SPAWN' | 'BROKEN' | 'EMPTY' | 'OBJECT';
export type DebugCellState = 'BROKEN' | 'EMPTY' | 'OBJECT';
export type AttackTone = 'accent' | 'red';

export interface CellView {
  state: CellVisual;
  /** Colour of ATTACK / AFTER. */
  tone: AttackTone | null;
  /** Ticks since the event behind ATTACK / AFTER / SPAWN started (0 otherwise). */
  age: number;
}

export interface AttackMark {
  tick: number;
  tone: AttackTone;
}

export interface CellInputs {
  cols: number;
  rows: number;
  tick: number;
  player: Cell | null;
  danger: readonly Cell[];
  /** Last attack per cell, keyed by `cellKey`. */
  attacks: ReadonlyMap<number, AttackMark>;
  /** Cells showing a spawn marker, with its age in ticks (its own clock: spawns play while the battle is frozen). */
  spawns: ReadonlyMap<number, number>;
  overrides: ReadonlyMap<number, DebugCellState>;
  attackTicks: number;
  afterTicks: number;
  spawnTicks: number;
}

export function cellKey(x: number, y: number, cols: number): number {
  return y * cols + x;
}

const NORMAL: CellView = { state: 'NORMAL', tone: null, age: 0 };

export function cellStates(i: CellInputs): CellView[] {
  const out: CellView[] = new Array<CellView>(i.cols * i.rows).fill(NORMAL);
  const danger = new Set(i.danger.map((c) => cellKey(c.x, c.y, i.cols)));
  const playerKey = i.player ? cellKey(i.player.x, i.player.y, i.cols) : -1;
  for (let key = 0; key < out.length; key++) {
    const override = i.overrides.get(key);
    const attack = i.attacks.get(key);
    const attackAge = attack ? i.tick - attack.tick : Infinity;
    const spawnAge = i.spawns.get(key) ?? Infinity;
    if (override === 'EMPTY' || override === 'BROKEN') out[key] = { state: override, tone: null, age: 0 };
    else if (attack && attackAge < i.attackTicks) out[key] = { state: 'ATTACK', tone: attack.tone, age: attackAge };
    else if (danger.has(key)) out[key] = { state: 'DANGER', tone: null, age: 0 };
    else if (spawnAge >= 0 && spawnAge < i.spawnTicks) out[key] = { state: 'SPAWN', tone: null, age: spawnAge };
    else if (override === 'OBJECT') out[key] = { state: 'OBJECT', tone: null, age: 0 };
    else if (key === playerKey) out[key] = { state: 'ACTIVE', tone: null, age: 0 };
    else if (attack && attackAge < i.attackTicks + i.afterTicks)
      out[key] = { state: 'AFTER', tone: attack.tone, age: attackAge - i.attackTicks };
  }
  return out;
}
