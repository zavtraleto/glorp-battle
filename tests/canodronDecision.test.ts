import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { SimEvent } from '../src/sim/events';
import type { Canodron } from '../src/sim/enemies/canodron';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  return new World({
    seed: 37,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: true },
    encounter: {
      id: 'canodron-decisions',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      waves: [{ enemies: [{ kind: 'canodron', x: 1, y: 1 }] }],
    },
  });
}

function step(w: World): SimEvent[] {
  w.step(DT, { commands: [], held: null });
  return w.drainEvents();
}

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(w));
  return events;
}

function placePlayer(w: World, x: number, y: number): void {
  const p = w.player;
  w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

function lock(w: World): Canodron {
  const canodron = w.enemies[0] as Canodron;
  step(w);
  run(w, 2 * T(tuning.canodron.CURSOR_STEP));
  expect(canodron.state).toBe('LOCK');
  return canodron;
}

describe('Canodron sample-and-commit decisions', () => {
  it('tracks the current player cell during AIM', () => {
    const w = world();
    const canodron = w.enemies[0] as Canodron;
    step(w);
    placePlayer(w, 1, 3);

    run(w, T(tuning.canodron.CURSOR_STEP));

    expect(canodron.state).toBe('INTENTION');
    expect(canodron.cursorCell()).toEqual({ x: 1, y: 3, locked: false });
  });

  it('keeps the committed cursor and firing lane after LOCK', () => {
    const w = world();
    const canodron = lock(w);
    placePlayer(w, 1, 5);

    expect(canodron.cursorCell()).toEqual({ x: 1, y: 4, locked: true });
    expect(w.pushEnemy(canodron, { x: 0, y: 1 })).toBe('moved');
    expect(canodron.x).toBe(2);
    step(w);
    expect(canodron.cursorCell()).toEqual({ x: 1, y: 4, locked: true });
    expect(w.dangerCells()).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ]);

    placePlayer(w, 0, 5);
    const events = run(w, T(tuning.canodron.LOCK_TIME + tuning.canodron.COUNTER_TIME) - 1);
    expect(events).toContainEqual({ type: 'enemyShot', x: 1, fromY: 2, toY: 6 });
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('pauses the AIM cursor cadence during collision stagger', () => {
    const w = world();
    const canodron = w.enemies[0] as Canodron;
    step(w);
    run(w, T(tuning.canodron.CURSOR_STEP) - 2);
    w.field.breakPanel(1, 0, w.tick, T(2));

    expect(w.pushEnemy(canodron, { x: 1, y: 2 })).toBe('blocked');
    expect(canodron.state).toBe('STAGGER');
    run(w, T(tuning.field.STAGGER_TIME));
    expect(canodron.state).toBe('INTENTION');

    step(w);
    expect(canodron.cursorCell()).toEqual({ x: 1, y: 2, locked: false });
    step(w);
    expect(canodron.cursorCell()).toEqual({ x: 1, y: 3, locked: false });
  });

  it('does not aim again during FIRE or RECOVERY', () => {
    const w = world();
    const canodron = lock(w);
    placePlayer(w, 0, 4);
    run(w, T(tuning.canodron.LOCK_TIME + tuning.canodron.COUNTER_TIME));
    expect(canodron.state).toBe('STRIKE');

    placePlayer(w, 1, 4);
    run(w, T(tuning.canodron.STRIKE_TIME + tuning.canodron.RECOVERY_TIME) - 1);
    expect(canodron.state).toBe('RECOVERY');
    expect(canodron.cursorCell()).toBeNull();

    step(w);
    expect(canodron.state).toBe('IDLE');
  });
});
