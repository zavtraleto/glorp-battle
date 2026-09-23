import type { EnemySpawn } from '../../data/battles';
import { Bladdy } from './bladdy';
import { Canodron } from './canodron';
import type { Enemy } from './enemyBase';
import { Hopzap } from './hopzap';
import { Mettik } from './mettik';

export function createEnemy(spawn: EnemySpawn, id: number, tick: number): Enemy {
  const level = spawn.level ?? 1;
  const args = [id, spawn.x, spawn.y, tick, level] as const;
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(...args);
    case 'canodron':
      return new Canodron(...args);
    case 'hopzap':
      return new Hopzap(...args);
    case 'bladdy':
      return new Bladdy(...args);
  }
}
