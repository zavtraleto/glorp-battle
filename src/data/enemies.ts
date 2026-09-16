import type { EnemyKind } from '../sim/enemies/enemyBase';

// Presentation data for enemies (placeholder sprites, GDD §14). Stats live in config/tuning.ts.

// Names live in i18n (`enemy.<kind>`).
export interface EnemyLook {
  letter: string;
  color: string;
}

export const ENEMY_LOOKS: Record<EnemyKind, EnemyLook> = {
  mettik: { letter: 'M', color: '#ffd23f' },
  canodron: { letter: 'C', color: '#5fd068' },
  spiker: { letter: 'S', color: '#ff9442' },
};
