import { debugEncounter, ENCOUNTERS, type Encounter } from './encounters';

// The old fixed battle sequence (GDD §10.2), kept for debug jumps and tests.
// Battles now live in data/encounters.ts.

export type { EnemySpawn } from './encounters';

export const BATTLES: readonly Encounter[] = ENCOUNTERS.slice(0, 4);

/** 1-based battle index → encounter (clamped to the first four). */
export const getBattle = debugEncounter;
