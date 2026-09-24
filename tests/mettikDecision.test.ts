import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { Shockwave } from '../src/sim/attacks/shockwave';
import type { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(spawns: { x: number; y: number }[] = [{ x: 0, y: 1 }]): World {
  return new World({
    seed: 31,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: true },
    encounter: {
      id: 'mettik-decisions',
      tier: 'normal',
      minDepth: 1,
      maxDepth: 1,
      waves: [{ enemies: spawns.map(({ x, y }) => ({ kind: 'mettik' as const, x, y })) }],
    },
  });
}

function step(w: World): void {
  w.step(DT, { commands: [], held: null });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

function placePlayerLane(w: World, x: number): void {
  const p = w.player;
  w.occupancy.move(p.id, p.x, p.y, x, p.y);
  p.x = p.prevX = x;
}

describe('Mettik committed decisions', () => {
  it('finishes one sampled step before observing the player again', () => {
    const w = world();
    const m = w.enemies[0] as Mettik;
    placePlayerLane(w, 2);

    run(w, T(tuning.mettik.MOVE_TIME));
    expect({ state: m.state, x: m.x }).toEqual({ state: 'MOVE', x: 1 });

    placePlayerLane(w, 0);
    run(w, T(tuning.mettik.MOVE_TIME) - 1);
    expect({ state: m.state, x: m.x }).toEqual({ state: 'MOVE', x: 1 });

    step(w);
    expect(m.x).toBe(0);
  });

  it('locks Shockwave to the sampled lane and can miss after the player leaves', () => {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;

    run(w, T(tuning.mettik.MOVE_TIME));
    expect(m.state).toBe('INTENTION');
    placePlayerLane(w, 0);
    run(w, T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME));

    expect(m.state).toBe('COUNTER');
    expect(w.dangerCells().every((cell) => cell.x === 1)).toBe(true);
    run(w, T(tuning.mettik.COUNTER_TIME));

    const wave = w.attacks.find((attack): attack is Shockwave => attack instanceof Shockwave);
    expect(wave?.x).toBe(1);
    for (let i = 0; wave && !wave.done && i < 5 * T(tuning.projectile.CELL_TRAVEL_TIME); i++) step(w);
    expect(wave?.done).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('does not decide again until Shockwave recovery completes', () => {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;
    run(w, T(tuning.mettik.MOVE_TIME));
    placePlayerLane(w, 0);

    run(w, T(
      tuning.mettik.INTENTION_TIME
      + tuning.mettik.LOCK_TIME
      + tuning.mettik.COUNTER_TIME
      + tuning.mettik.STRIKE_TIME
      + tuning.mettik.RECOVERY_TIME,
    ) - 1);

    expect(m.state).toBe('RECOVERY');
    expect(m.x).toBe(1);
    step(w);
    expect(m.state).toBe('IDLE');
  });

  it('attacks the sampled lane after arriving even if the player keeps switching lanes', () => {
    const w = world();
    const m = w.enemies[0] as Mettik;
    placePlayerLane(w, 2);
    let lastMoveTick = m.lastMoveTick;
    let spawned = false;

    for (let i = 0; i < T(3); i++) {
      step(w);
      if (m.lastMoveTick !== lastMoveTick) {
        lastMoveTick = m.lastMoveTick;
        placePlayerLane(w, m.x === 0 ? 2 : 0);
      }
      if (w.attacks.some((attack) => attack.kind === 'shockwave')) {
        spawned = true;
        break;
      }
    }

    expect(spawned).toBe(true);
  });

  it('lets multiple Mettik commit attacks independently', () => {
    const w = world([{ x: 1, y: 0 }, { x: 1, y: 1 }]);

    run(w, T(tuning.mettik.MOVE_TIME));

    expect(w.enemies.map((enemy) => enemy.state)).toEqual(['INTENTION', 'INTENTION']);
    run(w, T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    expect(w.attacks.filter((attack) => attack.kind === 'shockwave')).toHaveLength(2);
  });
});

describe('Mettik Shockwave travels on the ground', () => {
  function attackFrom(holeY: number) {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;
    if (w.player.x !== 1) placePlayerLane(w, 1);
    w.field.breakPanel(1, holeY, w.tick, T(30));
    run(w, T(tuning.mettik.MOVE_TIME + tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME));
    expect(m.state).toBe('COUNTER');
    return { w, m };
  }

  it('attacks into a hole in front of it and the wave dies on its spawn cell', () => {
    const { w, m } = attackFrom(2);
    expect(w.dangerCells()).toEqual([]);
    run(w, T(tuning.mettik.COUNTER_TIME));
    expect(m.state).toBe('STRIKE');
    expect(w.attacks.filter((a) => a.kind === 'shockwave')).toHaveLength(0);
    run(w, 5 * T(tuning.projectile.CELL_TRAVEL_TIME));
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('cuts the telegraph and the wave at the first hole', () => {
    const { w } = attackFrom(tuning.player.PLAYER_START_Y - 1);
    expect(w.dangerCells()).toEqual(
      Array.from({ length: tuning.player.PLAYER_START_Y - 3 }, (_, i) => ({ x: 1, y: 2 + i })),
    );
    run(w, T(tuning.mettik.COUNTER_TIME) + 6 * T(tuning.projectile.CELL_TRAVEL_TIME));
    expect(w.attacks.filter((a) => a.kind === 'shockwave')).toHaveLength(0);
    expect(w.player.hp).toBe(w.player.maxHp);
  });
});

describe('enemies treat player mines as walls', () => {
  it('Mettik does not step onto a mine to reach the player lane', () => {
    const w = world([{ x: 0, y: 1 }]);
    const m = w.enemies[0] as Mettik;
    placePlayerLane(w, 2);
    w.field.arm(1, 1, { kind: 'mine', side: 'player', damage: 6 });

    run(w, 4 * T(tuning.mettik.MOVE_TIME));
    expect([m.x, m.y, m.hp]).toEqual([0, 1, m.maxHp]);
    expect(w.field.hazard(1, 1)).not.toBeNull();
  });
});
