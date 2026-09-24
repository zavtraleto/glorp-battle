import type { Panel } from '../sim/field';
import type { Cell, Side } from '../sim/grid';

// Visual state of each battle cell (BATTLE_VISUAL.md §4). Pure.

export type CellVisual = 'NORMAL' | 'ACTIVE' | 'DANGER' | 'ATTACK' | 'AFTER' | 'SPAWN' | 'BROKEN' | 'EMPTY' | 'OBJECT' | 'ARM';
export type DebugCellState = 'BROKEN' | 'EMPTY' | 'OBJECT';
export type AttackTone = 'accent' | 'red';

export interface CellView {
  state: CellVisual;
  /** Colour of ATTACK / AFTER. */
  tone: AttackTone | null;
  /** Ticks since the event behind ATTACK / AFTER / SPAWN started (0 otherwise). */
  age: number;
  owner: Side;
  /** Panel is cracked (drawn over any state but BROKEN / EMPTY). */
  cracked: boolean;
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
  enemies: readonly Cell[];
  danger: readonly Cell[];
  /** Last attack per cell, keyed by `cellKey`. */
  attacks: ReadonlyMap<number, AttackMark>;
  /** Cells showing a spawn marker, with its age in ticks (its own clock: spawns play while the battle is frozen). */
  spawns: ReadonlyMap<number, number>;
  overrides: ReadonlyMap<number, DebugCellState>;
  /** Simulation panels, indexed by `cellKey`. */
  panels: readonly { panel: Panel; owner: Side; armed?: boolean }[];
  objects: readonly Cell[];
  attackTicks: number;
  afterTicks: number;
  spawnTicks: number;
}

export function cellKey(x: number, y: number, cols: number): number {
  return y * cols + x;
}

export function cellStates(i: CellInputs): CellView[] {
  const out: CellView[] = [];
  const danger = new Set(i.danger.map((c) => cellKey(c.x, c.y, i.cols)));
  const objects = new Set(i.objects.map((c) => cellKey(c.x, c.y, i.cols)));
  const actors = new Set(i.enemies.map((c) => cellKey(c.x, c.y, i.cols)));
  if (i.player) actors.add(cellKey(i.player.x, i.player.y, i.cols));
  for (let key = 0; key < i.cols * i.rows; key++) {
    const p = i.panels[key] as { panel: Panel; owner: Side; armed?: boolean };
    const view = (state: CellVisual, tone: AttackTone | null = null, age = 0): CellView => ({
      state,
      tone,
      age,
      owner: p.owner,
      cracked: p.panel === 'CRACKED',
    });
    const override = i.overrides.get(key);
    const attack = i.attacks.get(key);
    const attackAge = attack ? i.tick - attack.tick : Infinity;
    const spawnAge = i.spawns.get(key) ?? Infinity;
    if (override === 'EMPTY' || override === 'BROKEN') out.push(view(override));
    else if (p.panel === 'BROKEN') out.push(view('BROKEN'));
    else if (attack && attackAge < i.attackTicks) out.push(view('ATTACK', attack.tone, attackAge));
    else if (danger.has(key)) out.push(view('DANGER'));
    else if (spawnAge >= 0 && spawnAge < i.spawnTicks) out.push(view('SPAWN', null, spawnAge));
    else if (override === 'OBJECT' || objects.has(key)) out.push(view('OBJECT'));
    else if (actors.has(key)) out.push(view('ACTIVE'));
    else if (p.armed) out.push(view('ARM'));
    else if (attack && attackAge < i.attackTicks + i.afterTicks) out.push(view('AFTER', attack.tone, attackAge - i.attackTicks));
    else out.push(view('NORMAL'));
  }
  return out;
}
