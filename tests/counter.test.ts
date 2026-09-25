import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { EnemyKind, EnemyState } from '../src/sim/enemies/enemyBase';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);
const ATTACK_PHASES: readonly EnemyState[] = ['INTENTION', 'LOCK', 'COUNTER', 'STRIKE', 'RECOVERY'];
const ATTACK_ENEMIES: readonly EnemyKind[] = [
  'mettik', 'canodron', 'hopzap', 'bladdy',
];

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(kind: EnemyKind, aiEnabled = true): World {
  return new World({
    seed: 17,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: true, aiEnabled },
    encounter: { id: `timing-${kind}`, tier: 'normal', minDepth: 1, maxDepth: 1, waves: [{ enemies: [{ kind, x: 1, y: 1 }] }] },
  });
}

function step(w: World): void {
  w.step(DT, { commands: [], held: null });
  w.drainEvents();
}

describe('enemy attack timing grammar', () => {
  it.each(ATTACK_ENEMIES)('%s follows intention, lock, counter, strike, recovery', (kind) => {
    const w = world(kind);
    const enemy = w.enemies[0]!;
    enemy.forceAttack(w.tick);
    const seen: EnemyState[] = [];
    for (let i = 0; i < T(12) && seen.length < ATTACK_PHASES.length; i++) {
      if (ATTACK_PHASES.includes(enemy.state) && seen.at(-1) !== enemy.state) seen.push(enemy.state);
      step(w);
    }
    expect(seen).toEqual(ATTACK_PHASES);
  });

  it('counters only a damaging hit during the explicit COUNTER state', () => {
    const w = world('mettik', false);
    const enemy = w.enemies[0]!;
    enemy.setTimedState('LOCK', w.tick, T(0.2));
    w.damageEnemy(enemy, 1, true);
    expect(enemy.state).toBe('LOCK');

    enemy.setTimedState('COUNTER', w.tick, T(0.18));
    w.damageEnemy(enemy, 1, true);
    expect(enemy.state).toBe('STAGGER');
    expect(w.drainEvents().some((event) => event.type === 'enemyCountered')).toBe(true);
  });

  it('reports the level-scaled movement duration used by simulation', () => {
    const w = new World({
      seed: 17,
      battleIndex: 1,
      skipIntro: true,
      encounter: {
        id: 'scaled-move',
        tier: 'normal',
        minDepth: 1,
        maxDepth: 1,
        waves: [{ enemies: [{ kind: 'mettik', x: 1, y: 1, level: 3 }] }],
      },
    });
    expect(w.enemies[0]!.moveDurationSeconds()).toBe(T(tuning.mettik.MOVE_TIME / 1.2) / tuning.sim.SIM_HZ);
  });
});
