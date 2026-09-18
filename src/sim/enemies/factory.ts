import type { EnemySpawn } from '../../data/battles';
import { Bladdy } from './bladdy';
import { Canodron } from './canodron';
import type { Enemy } from './enemyBase';
import { Finnik } from './finnik';
import { Helmhead } from './helmhead';
import { Hopzap } from './hopzap';
import { Mettik } from './mettik';
import { Monolith } from './monolith';
import { Rattik } from './rattik';
import { Spiker } from './spiker';

export function createEnemy(spawn: EnemySpawn, id: number, tick: number): Enemy {
  const level = spawn.level ?? 1;
  const args = [id, spawn.x, spawn.y, tick, level] as const;
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(...args);
    case 'canodron':
      return new Canodron(...args);
    case 'spiker':
      return new Spiker(...args);
    case 'hopzap':
      return new Hopzap(...args);
    case 'bladdy':
      return new Bladdy(...args);
    case 'rattik':
      return new Rattik(...args);
    case 'helmhead':
      return new Helmhead(...args);
    case 'finnik':
      return new Finnik(...args);
    case 'monolith':
      return new Monolith(...args);
  }
}
