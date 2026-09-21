import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { EnemyKind } from '../src/sim/enemies/enemyBase';
import { createEnemy } from '../src/sim/enemies/factory';

const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

describe('Play enemy Counter windows', () => {
  const cases: readonly [EnemyKind, number, number][] = [
    ['mettik', tuning.mettik.MET_TELEGRAPH, tuning.counter.COUNTER_WINDOW_METTIK],
    ['canodron', tuning.canodron.CANO_FIRE_DELAY, tuning.counter.COUNTER_WINDOW_CANODRON],
    ['bladdy', tuning.bladdy.BLD_TELEGRAPH, tuning.counter.COUNTER_WINDOW_BLADDY],
    ['hopzap', tuning.hopzap.HOP_TELEGRAPH, tuning.counter.COUNTER_WINDOW_BUNNY],
  ];

  it.each(cases)('%s opens only for the final configured part of its telegraph', (kind, telegraph, window) => {
    const enemy = createEnemy({ kind, x: 1, y: 1 }, 100, 0);
    enemy.forceAttack(0);
    const opensAt = T(telegraph) - T(window);

    expect(enemy.counterWindowOpen(Math.max(0, opensAt - 1))).toBe(false);
    expect(enemy.counterWindowOpen(opensAt)).toBe(true);
    expect(enemy.counterWindowOpen(T(telegraph))).toBe(false);
  });

  it('Counter cancels Canodron lock and enters stagger', () => {
    const enemy = createEnemy({ kind: 'canodron', x: 1, y: 1 }, 101, 0);
    enemy.forceAttack(0);
    const opensAt = T(tuning.canodron.CANO_FIRE_DELAY) - T(tuning.counter.COUNTER_WINDOW_CANODRON);

    expect(enemy.counter(opensAt)).toBe(true);
    expect(enemy.state).toBe('STAGGER');
    expect(enemy.cursorCell()).toBeNull();
  });

  it('allows a Counter window to be disabled from the debug tuning', () => {
    tuning.counter.COUNTER_WINDOW_METTIK = 0;
    const enemy = createEnemy({ kind: 'mettik', x: 1, y: 1 }, 102, 0);
    enemy.forceAttack(0);

    expect(enemy.counterWindowOpen(T(tuning.mettik.MET_TELEGRAPH) - 1)).toBe(false);
  });
});
