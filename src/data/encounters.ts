import type { EnemyKind } from '../sim/enemies/enemyBase';
import type { EnemyLevel } from './enemies';

// Battles as data (roguelite spec §5.4). A run picks encounters by tier and
// depth; the first four repeat the old fixed battles 1–4 (debug and tests).
// Coordinates are logical cells in the enemy area.

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Virus level (roguelite spec §5.1); 1 by default. */
  level?: EnemyLevel;
}

export type EncounterTier = 'normal' | 'elite' | 'boss';

export interface Encounter {
  id: string;
  tier: EncounterTier;
  minDepth: number;
  maxDepth: number;
  enemies: EnemySpawn[];
  /** Panels damaged from the start. */
  panels?: { x: number; y: number; panel: 'CRACKED' | 'BROKEN' }[];
}

const e = (kind: EnemyKind, x: number, y: number, level: EnemyLevel = 1): EnemySpawn => ({ kind, x, y, level });

export const ENCOUNTERS: readonly Encounter[] = [
  { id: 'n1', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('mettik', 1, 1)] },
  { id: 'n2', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('canodron', 1, 1)] },
  { id: 'n3', tier: 'normal', minDepth: 2, maxDepth: 4, enemies: [e('mettik', 0, 2), e('canodron', 2, 0)] },
  { id: 'n4', tier: 'normal', minDepth: 4, maxDepth: 6, enemies: [e('spiker', 1, 1)] },
  { id: 'n5', tier: 'normal', minDepth: 1, maxDepth: 3, enemies: [e('hopzap', 1, 1)] },
  { id: 'n6', tier: 'normal', minDepth: 2, maxDepth: 4, enemies: [e('rattik', 1, 1)] },
  { id: 'n7', tier: 'normal', minDepth: 3, maxDepth: 6, enemies: [e('bladdy', 1, 0)] },
  { id: 'n8', tier: 'normal', minDepth: 4, maxDepth: 6, enemies: [e('helmhead', 1, 0)] },
  { id: 'n9', tier: 'normal', minDepth: 4, maxDepth: 7, enemies: [e('finnik', 2, 1), e('mettik', 0, 2)] },
  { id: 'n10', tier: 'normal', minDepth: 4, maxDepth: 7, enemies: [e('hopzap', 0, 0), e('canodron', 2, 1)] },
  { id: 'n11', tier: 'normal', minDepth: 6, maxDepth: 9, enemies: [e('rattik', 0, 1), e('hopzap', 2, 0)] },
  { id: 'n12', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('helmhead', 1, 1), e('canodron', 0, 0)] },
  { id: 'n13', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('bladdy', 0, 0), e('spiker', 2, 1)] },
  { id: 'n14', tier: 'normal', minDepth: 7, maxDepth: 9, enemies: [e('mettik', 1, 1, 2), e('rattik', 2, 0)] },
  { id: 'e1', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('bladdy', 1, 0, 2), e('mettik', 0, 2)] },
  { id: 'e2', tier: 'elite', minDepth: 5, maxDepth: 5, enemies: [e('spiker', 1, 1, 2), e('canodron', 2, 0)] },
  { id: 'e3', tier: 'elite', minDepth: 8, maxDepth: 8, enemies: [e('finnik', 1, 0, 2), e('hopzap', 2, 2, 2)] },
  {
    id: 'e4', tier: 'elite', minDepth: 8, maxDepth: 8,
    enemies: [e('helmhead', 0, 0, 2), e('rattik', 2, 1, 2)],
    panels: [{ x: 1, y: 5, panel: 'CRACKED' }],
  },
  { id: 'boss', tier: 'boss', minDepth: 10, maxDepth: 10, enemies: [e('monolith', 1, 0)] },
];

export function encounterById(id: string): Encounter | undefined {
  return ENCOUNTERS.find((x) => x.id === id);
}

/** The old fixed battles 1–4 by 1-based index (clamped). */
export function debugEncounter(index: number): Encounter {
  const i = Math.min(4, Math.max(1, Math.floor(index))) - 1;
  return ENCOUNTERS[i] as Encounter;
}
