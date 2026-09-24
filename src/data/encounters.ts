import type { EnemyKind } from '../sim/enemies/enemyBase';
import type { EnemyLevel } from './enemies';

// Battles as data (roguelite spec §5.4). An encounter is a sequence of waves
// (GDD §10.4): each wave starts on a fresh field with its own enemies.
// Coordinates are logical cells in the enemy area.

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Virus level (roguelite spec §5.1); 1 by default. */
  level?: EnemyLevel;
}

export interface EncounterWave {
  enemies: EnemySpawn[];
  /** Panels damaged from the start of the wave. */
  panels?: { x: number; y: number; panel: 'CRACKED' | 'BROKEN' }[];
}

export type EncounterTier = 'normal' | 'elite';

export interface Encounter {
  id: string;
  tier: EncounterTier;
  minDepth: number;
  maxDepth: number;
  /** Played in order; the encounter is won after the last one (GDD §10.4). */
  waves: EncounterWave[];
}

export const e = (kind: EnemyKind, x: number, y: number, level: EnemyLevel = 1): EnemySpawn => ({ kind, x, y, level });

/** Shorthand for a wave without damaged panels. */
export const wave = (...enemies: EnemySpawn[]): EncounterWave => ({ enemies });

/** Enemies of every wave, in order. */
export function encounterEnemies(encounter: Encounter): EnemySpawn[] {
  return encounter.waves.flatMap((w) => w.enemies);
}

/**
 * Play run stages 1–5 (GDD §10.2), MMBN6-style formations of at most three
 * viruses per wave [оценка]. The final stage is rolled from the run seed (run.ts).
 */
export const STAGES: readonly Encounter[] = [
  {
    id: 's1', tier: 'normal', minDepth: 1, maxDepth: 1,
    waves: [
      wave(e('mettik', 1, 1)),
      wave(e('mettik', 0, 1), e('mettik', 2, 1)),
      wave(e('mettik', 0, 2), e('canodron', 2, 0)),
    ],
  },
  {
    id: 's2', tier: 'normal', minDepth: 2, maxDepth: 2,
    waves: [
      wave(e('canodron', 1, 0), e('mettik', 0, 2)),
      wave(e('canodron', 0, 0), e('canodron', 2, 0)),
      wave(e('canodron', 0, 0), e('mettik', 1, 2), e('canodron', 2, 0)),
    ],
  },
  {
    id: 's3', tier: 'normal', minDepth: 3, maxDepth: 3,
    waves: [
      wave(e('bladdy', 1, 0)),
      wave(e('bladdy', 0, 0), e('mettik', 2, 2)),
    ],
  },
  {
    id: 's4', tier: 'normal', minDepth: 4, maxDepth: 4,
    waves: [
      wave(e('hopzap', 1, 1)),
      wave(e('hopzap', 0, 0), e('canodron', 2, 1)),
      wave(e('hopzap', 0, 2), e('hopzap', 2, 0), e('mettik', 1, 1)),
    ],
  },
  {
    id: 's5', tier: 'elite', minDepth: 5, maxDepth: 5,
    waves: [
      wave(e('bladdy', 0, 0), e('canodron', 2, 1)),
      wave(e('mettik', 0, 2), e('hopzap', 2, 0), e('canodron', 1, 0)),
      wave(e('bladdy', 1, 0), e('hopzap', 0, 2), e('canodron', 2, 1)),
    ],
  },
];

/**
 * Single-wave debug fixtures (`?encounter=`, `?battle=1..4`, tests). The
 * first four are the old fixed battles 1–4.
 */
export const ENCOUNTERS: readonly Encounter[] = [
  { id: 'n1', tier: 'normal', minDepth: 1, maxDepth: 3, waves: [wave(e('mettik', 1, 1))] },
  { id: 'n2', tier: 'normal', minDepth: 1, maxDepth: 3, waves: [wave(e('canodron', 1, 1))] },
  { id: 'n3', tier: 'normal', minDepth: 2, maxDepth: 4, waves: [wave(e('mettik', 0, 2), e('canodron', 2, 0))] },
  { id: 'n4', tier: 'normal', minDepth: 1, maxDepth: 4, waves: [wave(e('hopzap', 1, 1))] },
  { id: 'n5', tier: 'normal', minDepth: 3, maxDepth: 7, waves: [wave(e('bladdy', 1, 0))] },
  { id: 'n6', tier: 'normal', minDepth: 4, maxDepth: 9, waves: [wave(e('hopzap', 0, 0), e('canodron', 2, 1))] },
  { id: 'e1', tier: 'elite', minDepth: 5, maxDepth: 5, waves: [wave(e('bladdy', 1, 0, 2), e('mettik', 0, 2))] },
  { id: 'e2', tier: 'elite', minDepth: 8, maxDepth: 8, waves: [wave(e('bladdy', 0, 0, 2), e('hopzap', 2, 2, 2))] },
];

/** Debug fixtures first, then run stages (`?encounter=s1`). */
export function encounterById(id: string): Encounter | undefined {
  return ENCOUNTERS.find((x) => x.id === id) ?? STAGES.find((x) => x.id === id);
}

/** The old fixed battles 1–4 by 1-based index (clamped). */
export function debugEncounter(index: number): Encounter {
  const i = Math.min(4, Math.max(1, Math.floor(index))) - 1;
  return ENCOUNTERS[i] as Encounter;
}
