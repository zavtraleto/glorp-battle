import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Bladdy } from '../src/sim/enemies/bladdy';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(x = 0, y = 0): World {
  return new World({
    seed: 53,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: true },
    encounter: {
      id: 'bladdy-decisions',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      enemies: [{ kind: 'bladdy', x, y }],
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
  if (p.x !== x || p.y !== y) w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

describe('Bladdy sample-and-commit decisions', () => {
  it('commits one forward step, then settles before observing again', () => {
    const w = world();
    const bladdy = w.enemies[0] as Bladdy;
    placePlayer(w, 2, 4);

    run(w, T(tuning.bladdy.BLD_SETTLE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'MOVE', x: 0, y: 1 });

    placePlayer(w, 0, 4);
    run(w, T(tuning.bladdy.MOVE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'IDLE', x: 0, y: 1 });
    run(w, T(tuning.bladdy.BLD_SETTLE_TIME) - 1);
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'IDLE', x: 0, y: 1 });
    step(w);
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'MOVE', x: 0, y: 2 });
  });

  it('aligns only after reaching the front and attacks instead of continuing the chase', () => {
    const w = world(0, 2);
    const bladdy = w.enemies[0] as Bladdy;
    placePlayer(w, 2, 4);

    run(w, T(tuning.bladdy.BLD_SETTLE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'MOVE', x: 1, y: 2 });
    run(w, T(tuning.bladdy.MOVE_TIME + tuning.bladdy.BLD_SETTLE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'MOVE', x: 2, y: 2 });
    run(w, T(tuning.bladdy.MOVE_TIME + tuning.bladdy.BLD_SETTLE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'INTENTION', x: 2, y: 2 });
  });

  it('commits a close WideSword area that does not follow either actor', () => {
    const w = world(1, 2);
    const bladdy = w.enemies[0] as Bladdy;
    placePlayer(w, 2, 3);

    run(w, T(tuning.bladdy.BLD_SETTLE_TIME));
    expect(bladdy.state).toBe('INTENTION');
    placePlayer(w, 0, 5);
    expect(w.pushEnemy(bladdy, { x: 0, y: 2 })).toBe('moved');
    run(w, T(tuning.bladdy.INTENTION_TIME));
    expect(w.dangerCells()).toEqual([
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ]);

    const events = run(w, T(tuning.bladdy.LOCK_TIME + tuning.bladdy.COUNTER_TIME));
    expect(events).toContainEqual({
      type: 'enemySlash',
      cells: [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
    });
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('commits LongSword at distance and waits through recovery before deciding again', () => {
    const w = world(1, 2);
    const bladdy = w.enemies[0] as Bladdy;
    placePlayer(w, 1, 4);

    run(w, T(tuning.bladdy.BLD_SETTLE_TIME + tuning.bladdy.INTENTION_TIME));
    expect(w.dangerCells()).toEqual([{ x: 1, y: 3 }, { x: 1, y: 4 }]);
    placePlayer(w, 2, 5);
    const events = run(w, T(tuning.bladdy.LOCK_TIME + tuning.bladdy.COUNTER_TIME));
    expect(events).toContainEqual({ type: 'enemySlash', cells: [{ x: 1, y: 3 }, { x: 1, y: 4 }] });
    expect(w.player.hp).toBe(w.player.maxHp);

    run(w, T(tuning.bladdy.STRIKE_TIME));
    expect(bladdy.state).toBe('RECOVERY');
    run(w, T(tuning.bladdy.RECOVERY_TIME) - 1);
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'RECOVERY', x: 1, y: 2 });
    step(w);
    expect(bladdy.state).toBe('IDLE');
  });

  it('uses committed AreaGrab after repeated out-of-range decisions, then advances', () => {
    tuning.bladdy.BLD_AREA_GRAB_DECISIONS = 2;
    const w = world(1, 2);
    const bladdy = w.enemies[0] as Bladdy;
    placePlayer(w, 1, 5);

    run(w, T(tuning.bladdy.BLD_SETTLE_TIME));
    expect(bladdy.state).toBe('IDLE');
    run(w, T(tuning.bladdy.BLD_SETTLE_TIME));
    expect(bladdy.state).toBe('INTENTION');
    run(w, T(tuning.bladdy.INTENTION_TIME));
    expect(w.dangerCells()).toEqual([{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }]);

    run(w, T(tuning.bladdy.LOCK_TIME + tuning.bladdy.COUNTER_TIME));
    expect([w.field.owner(0, 3), w.field.owner(1, 3), w.field.owner(2, 3)]).toEqual([
      'enemy', 'enemy', 'enemy',
    ]);
    run(w, T(tuning.bladdy.STRIKE_TIME + tuning.bladdy.RECOVERY_TIME + tuning.bladdy.BLD_SETTLE_TIME));
    expect({ state: bladdy.state, x: bladdy.x, y: bladdy.y }).toEqual({ state: 'MOVE', x: 1, y: 3 });
  });
});
