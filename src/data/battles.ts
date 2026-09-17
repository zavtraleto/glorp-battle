import type { EnemyKind } from '../sim/enemies/enemyBase';
import type { EnemyLevel } from './enemies';

// Fixed battle sequence (GDD §10.1). Coordinates are logical cells in the enemy area.

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Virus level (roguelite spec §5.1); 1 by default. */
  level?: EnemyLevel;
}

export interface BattleDef {
  enemies: EnemySpawn[];
}

export const BATTLES: readonly BattleDef[] = [
  { enemies: [{ kind: 'mettik', x: 1, y: 1 }] },
  { enemies: [{ kind: 'canodron', x: 1, y: 1 }] },
  {
    enemies: [
      { kind: 'mettik', x: 0, y: 2 },
      { kind: 'canodron', x: 2, y: 0 },
    ],
  },
  {
    enemies: [
      { kind: 'spiker', x: 1, y: 1 },
      { kind: 'canodron', x: 0, y: 0 },
    ],
  },
];

/** 1-based battle index → definition (clamped). */
export function getBattle(index: number): BattleDef {
  const i = Math.min(BATTLES.length, Math.max(1, Math.floor(index))) - 1;
  return BATTLES[i] as BattleDef;
}
