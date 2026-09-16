import type { EnemyKind } from '../sim/enemies/enemyBase';

// Presentation data for enemies (placeholder sprites, GDD §14). Stats live in config/tuning.ts.

export interface EnemyLook {
  name: string;
  letter: string;
  color: string;
}

export const ENEMY_LOOKS: Record<EnemyKind, EnemyLook> = {
  mettik: { name: 'Mettik', letter: 'M', color: '#ffd23f' },
  canodron: { name: 'Canodron', letter: 'C', color: '#5fd068' },
  spiker: { name: 'Spiker', letter: 'S', color: '#ff9442' },
};
