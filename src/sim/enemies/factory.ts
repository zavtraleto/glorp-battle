import type { EnemySpawn } from '../../data/battles';
import type { Enemy } from './enemyBase';
import { Mettik } from './mettik';

/** Creates an enemy for a spawn entry; returns null for kinds not implemented yet (M6). */
export function createEnemy(
  spawn: EnemySpawn,
  id: number,
  tick: number,
  nextAttackId: () => number,
): Enemy | null {
  switch (spawn.kind) {
    case 'mettik':
      return new Mettik(id, spawn.x, spawn.y, tick, nextAttackId);
    case 'canodron':
    case 'spiker':
      return null;
  }
}
