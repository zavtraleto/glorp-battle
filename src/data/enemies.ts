// Enemy level multipliers. Base stats live in config/tuning.ts, names in i18n.

export type EnemyLevel = 1 | 2 | 3;

/** Multipliers over the base stats: HP, damage, and action speed (timings are divided by it). */
export interface LevelStats {
  hp: number;
  damage: number;
  speed: number;
}

export const ENEMY_LEVELS: Record<EnemyLevel, LevelStats> = {
  1: { hp: 1, damage: 1, speed: 1 },
  2: { hp: 1.5, damage: 1.5, speed: 1.1 },
  3: { hp: 2, damage: 2, speed: 1.2 },
};
