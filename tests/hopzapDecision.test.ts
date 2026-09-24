import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { LaneShot } from '../src/sim/attacks/laneShot';
import type { Hopzap } from '../src/sim/enemies/hopzap';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function settleTicks(): number {
  return T(tuning.hopzap.HOP_SETTLE_TIME);
}

function world(seed = 41, x = 0, y = 1): World {
  return new World({
    seed,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: true },
    encounter: {
      id: 'hopzap-decisions',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      waves: [{ enemies: [{ kind: 'hopzap', x, y }] }],
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

function placePlayer(w: World, x: number, y = w.player.y): void {
  const p = w.player;
  w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

function keepOnly(w: World, cells: { x: number; y: number }[]): void {
  const keep = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x < 3; x++) {
      if (!keep.has(`${x},${y}`)) w.field.breakPanel(x, y, w.tick, T(10));
    }
  }
  w.drainEvents();
}

describe('Hopzap sample-and-commit decisions', () => {
  it('keeps one landing through HOP, then settles before deciding again', () => {
    const w = world();
    const hopzap = w.enemies[0] as Hopzap;
    placePlayer(w, 2);
    keepOnly(w, [{ x: 0, y: 1 }, { x: 2, y: 2 }]);

    run(w, settleTicks());
    expect({ state: hopzap.state, x: hopzap.x, y: hopzap.y }).toEqual({ state: 'MOVE', x: 0, y: 1 });

    placePlayer(w, 0);
    run(w, T(tuning.hopzap.MOVE_TIME) - 1);
    expect({ x: hopzap.x, y: hopzap.y }).toEqual({ x: 0, y: 1 });
    const landingEvents = step(w);
    expect({ state: hopzap.state, x: hopzap.x, y: hopzap.y }).toEqual({ state: 'IDLE', x: 2, y: 2 });
    expect(landingEvents).toContainEqual({ type: 'enemyWarped', id: hopzap.id, fromX: 0, fromY: 1, x: 2, y: 2 });

    run(w, settleTicks() - 1);
    expect(hopzap.state).toBe('IDLE');
    step(w);
    expect(hopzap.state).toBe('MOVE');
  });

  it('finishes a hop after collision stagger starts on the landing tick', () => {
    const w = world();
    const hopzap = w.enemies[0] as Hopzap;
    placePlayer(w, 2);
    keepOnly(w, [{ x: 0, y: 1 }, { x: 2, y: 2 }]);

    run(w, settleTicks());
    expect(hopzap.state).toBe('MOVE');
    hopzap.lastMoveTick = w.tick;
    expect(w.pushEnemy(hopzap, { x: 1, y: 1 })).toBe('queued');

    run(w, T(tuning.hopzap.MOVE_TIME));
    expect(hopzap.state).toBe('STAGGER');
    run(w, T(tuning.field.STAGGER_TIME));
    expect(hopzap.state).toBe('MOVE');

    step(w);
    expect({ state: hopzap.state, x: hopzap.x, y: hopzap.y }).toEqual({ state: 'IDLE', x: 2, y: 2 });
  });

  it('biases hops toward an attack lane without always choosing it', () => {
    let aligned = 0;
    let unaligned = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = world(seed);
      placePlayer(w, 2);
      run(w, settleTicks() + T(tuning.hopzap.MOVE_TIME));
      const hopzap = w.enemies[0] as Hopzap;
      if (hopzap.x === 2) aligned++;
      else unaligned++;
    }

    expect(aligned).toBeGreaterThan(unaligned);
    expect(unaligned).toBeGreaterThan(0);
  });

  it('keeps the committed ZapRing lane through wind-up and can miss', () => {
    const w = world(41, 1, 1);
    const hopzap = w.enemies[0] as Hopzap;
    run(w, settleTicks());
    expect(hopzap.state).toBe('INTENTION');

    expect(w.pushEnemy(hopzap, { x: 0, y: 1 })).toBe('moved');
    placePlayer(w, 0);
    expect(w.dangerCells()).toEqual([]);
    run(w, T(tuning.hopzap.INTENTION_TIME));
    expect(w.dangerCells()).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ]);

    run(w, T(tuning.hopzap.LOCK_TIME + tuning.hopzap.COUNTER_TIME));
    const ring = w.attacks.find((attack): attack is LaneShot => attack instanceof LaneShot);
    expect(ring?.x).toBe(1);
    expect(ring?.stepTicks).toBe(T(tuning.hopzap.HOP_RING_CELL_TIME));
    for (let i = 0; ring && !ring.done && i < 5 * ring.stepTicks; i++) step(w);
    expect(ring?.done).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('keeps ZapRing paralysis and starts a fresh movement cycle after recovery', () => {
    const hitWorld = world(43, 1, 1);
    run(hitWorld, settleTicks() + T(
      tuning.hopzap.INTENTION_TIME
      + tuning.hopzap.LOCK_TIME
      + tuning.hopzap.COUNTER_TIME
      + 2 * tuning.hopzap.HOP_RING_CELL_TIME,
    ));
    expect(hitWorld.player.hp).toBe(hitWorld.player.maxHp - tuning.hopzap.HOP_DMG);
    expect(hitWorld.player.paralyzeTicks).toBeGreaterThan(0);

    const cycleWorld = world(47, 1, 1);
    const hopzap = cycleWorld.enemies[0] as Hopzap;
    run(cycleWorld, settleTicks());
    placePlayer(cycleWorld, 0);
    run(cycleWorld, T(
      tuning.hopzap.INTENTION_TIME
      + tuning.hopzap.LOCK_TIME
      + tuning.hopzap.COUNTER_TIME
      + tuning.hopzap.STRIKE_TIME
      + tuning.hopzap.RECOVERY_TIME,
    ));
    expect(hopzap.state).toBe('IDLE');
    run(cycleWorld, settleTicks() - 1);
    expect(hopzap.state).toBe('IDLE');
    step(cycleWorld);
    expect(hopzap.state).toBe('MOVE');
  });
});

describe('Hopzap and player mines', () => {
  it('never lands on a mine', () => {
    const w = world();
    const hopzap = w.enemies[0] as Hopzap;
    placePlayer(w, 2);
    keepOnly(w, [{ x: 0, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 0 }]);
    w.field.arm(2, 2, { kind: 'mine', side: 'player', damage: 6 });

    run(w, settleTicks() + T(tuning.hopzap.MOVE_TIME));
    expect({ x: hopzap.x, y: hopzap.y, hp: hopzap.hp }).toEqual({ x: 1, y: 0, hp: hopzap.maxHp });
    expect(w.field.hazard(2, 2)).not.toBeNull();
  });
});
