import type { EnemySpawn } from '../../data/battles';
import { Canodron } from './canodron';
import type { Enemy } from './enemyBase';
import { Mettik } from './mettik';
import { Spiker } from './spiker';

export function createEnemy(spawn: EnemySpawn, id: number, tick: number): Enemy {
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(id, spawn.x, spawn.y, tick);
    case 'canodron':
      return new Canodron(id, spawn.x, spawn.y, tick);
    case 'spiker':
      return new Spiker(id, spawn.x, spawn.y, tick);
  }
}
