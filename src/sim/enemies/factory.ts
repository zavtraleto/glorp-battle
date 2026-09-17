import type { EnemySpawn } from '../../data/battles';
import { Canodron } from './canodron';
import type { Enemy } from './enemyBase';
import { Mettik } from './mettik';
import { Spiker } from './spiker';

export function createEnemy(spawn: EnemySpawn, id: number, tick: number): Enemy {
  const level = spawn.level ?? 1;
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(id, spawn.x, spawn.y, tick, level);
    case 'canodron':
      return new Canodron(id, spawn.x, spawn.y, tick, level);
    case 'spiker':
      return new Spiker(id, spawn.x, spawn.y, tick, level);
  }
}
