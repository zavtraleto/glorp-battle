import type { EnemyKind } from '../sim/enemies/enemyBase';

// Presentation data for enemies (BATTLE_VISUAL.md §5.1). Stats live in config/tuning.ts,
// names in i18n (`enemy.<kind>`).

/** Creature generator seed per enemy kind: a fixed seed keeps each kind recognisable. */
export const ENEMY_SEEDS: Record<EnemyKind, number> = {
  mettik: 11,
  canodron: 23,
  spiker: 42,
};
