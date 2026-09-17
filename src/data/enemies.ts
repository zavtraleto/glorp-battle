import type { EnemyKind } from '../sim/enemies/enemyBase';

// Presentation data and level multipliers for enemies (BATTLE_VISUAL.md §5.1,
// roguelite spec §5.1). Base stats live in config/tuning.ts, names in i18n (`enemy.<kind>`).

/** Creature generator seed per enemy kind: a fixed seed keeps each kind recognisable. */
export const ENEMY_SEEDS: Record<EnemyKind, number> = {
  mettik: 11,
  canodron: 23,
  spiker: 42,
  hopzap: 57,
  bladdy: 64,
  rattik: 77,
  helmhead: 91,
  finnik: 103,
  punchy: 118,
};

export type EnemyLevel = 1 | 2 | 3;

/** Multipliers over the base stats: HP, damage, and action speed (timings are divided by it). */
export interface LevelStats {
  hp: number;
  damage: number;
  speed: number;
}

export const ENEMY_LEVELS: Record<EnemyLevel, LevelStats> = {
  1: { hp: 1, damage: 1, speed: 1 },
  2: { hp: 2, damage: 2, speed: 1.2 },
  3: { hp: 3, damage: 3, speed: 1.35 },
};
