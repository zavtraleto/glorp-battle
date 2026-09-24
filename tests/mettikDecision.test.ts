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

describe('Mettik decisions', () => {
  const D = () => T(tuning.mettik.MET_ACTION_DELAY);

  it('waits MET_ACTION_DELAY before every step and observes the player again after it', () => {
    const w = world();
    const m = w.enemies[0] as Mettik;
    placePlayerLane(w, 2);

    run(w, D() - 1);
    expect({ state: m.state, x: m.x }).toEqual({ state: 'IDLE', x: 0 });
    step(w);
    expect({ state: m.state, x: m.x }).toEqual({ state: 'MOVE', x: 1 });

    placePlayerLane(w, 0);
    run(w, T(tuning.mettik.MOVE_TIME));
    expect({ state: m.state, x: m.x }).toEqual({ state: 'IDLE', x: 1 });
    run(w, D());
    expect(m.x).toBe(0);
  });

  it('locks Shockwave to its lane and can miss after the player leaves', () => {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;

    run(w, D());
    expect(m.state).toBe('INTENTION');
    placePlayerLane(w, 0);
    run(w, T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME));

    expect(m.state).toBe('COUNTER');
    expect(w.dangerCells().every((cell) => cell.x === 1)).toBe(true);
    run(w, T(tuning.mettik.COUNTER_TIME));

    const wave = w.attacks.find((attack): attack is Shockwave => attack instanceof Shockwave);
    expect(wave?.x).toBe(1);
    for (let i = 0; wave && !wave.done && i < 5 * T(tuning.mettik.MET_WAVE_CELL_TIME); i++) step(w);
    expect(wave?.done).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('does not decide again until Shockwave recovery and the action delay are over', () => {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;
    run(w, D());
    placePlayerLane(w, 0);

    run(w, T(
      tuning.mettik.INTENTION_TIME
      + tuning.mettik.LOCK_TIME
      + tuning.mettik.COUNTER_TIME
      + tuning.mettik.STRIKE_TIME
      + tuning.mettik.RECOVERY_TIME,
    ) - 1);

    expect(m.state).toBe('RECOVERY');
    step(w);
    expect(m.state).toBe('IDLE');
    run(w, D() - 1);
    expect([m.state, m.x]).toEqual(['IDLE', 1]);
  });

  it('takes turns nearest row first; the others stand', () => {
    const w = world([{ x: 0, y: 0 }, { x: 2, y: 1 }]);
    const [back, front] = w.enemies as Mettik[];
    expect(w.hasTurn(front!)).toBe(true);
    expect(w.hasTurn(back!)).toBe(false);
    run(w, 3 * D());
    expect(back!.x).toBe(0);
  });

  it('hands the turn on after MET_CHASE_STEPS steps without a strike', () => {
    const w = world([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
    const [chaser, other] = w.enemies as Mettik[];
    // The player keeps leaving the chaser's next lane.
    placePlayerLane(w, 2);
    let steps = 0;
    let last = chaser!.lastMoveTick;
    for (let i = 0; i < T(10) && steps < tuning.mettik.MET_CHASE_STEPS; i++) {
      step(w);
      if (chaser!.lastMoveTick !== last) {
        last = chaser!.lastMoveTick;
        steps++;
        placePlayerLane(w, chaser!.x === 1 ? (w.player.x === 2 ? 0 : 2) : 1);
      }
    }
    expect(steps).toBe(tuning.mettik.MET_CHASE_STEPS);
    expect(w.hasTurn(other!)).toBe(false);
    run(w, T(tuning.mettik.MOVE_TIME) + D() + 1);
    expect(w.hasTurn(other!)).toBe(true);
  });

  it('hands the turn on as its wave leaves; the next one strikes MET_ACTION_DELAY later', () => {
    const w = world([{ x: 1, y: 1 }, { x: 1, y: 0 }]);
    const [first, second] = w.enemies as Mettik[];
    run(w, D() + T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    expect(first!.state).toBe('STRIKE');
    expect(w.hasTurn(second!)).toBe(true);
    run(w, D());
    expect(second!.state).toBe('INTENTION');
  });
});

describe('Mettik Shockwave travels on the ground', () => {
  function attackFrom(holeY: number) {
    const w = world([{ x: 1, y: 1 }]);
    const m = w.enemies[0] as Mettik;
    if (w.player.x !== 1) placePlayerLane(w, 1);
    w.field.breakPanel(1, holeY, w.tick, T(30));
    run(w, T(tuning.mettik.MET_ACTION_DELAY) + T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME));
    expect(m.state).toBe('COUNTER');
    return { w, m };
  }

  it('attacks into a hole in front of it and the wave dies on its spawn cell', () => {
    const { w, m } = attackFrom(2);
    expect(w.dangerCells()).toEqual([]);
    run(w, T(tuning.mettik.COUNTER_TIME));
    expect(m.state).toBe('STRIKE');
    expect(w.attacks.filter((a) => a.kind === 'shockwave')).toHaveLength(0);
    run(w, 5 * T(tuning.mettik.MET_WAVE_CELL_TIME));
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('cuts the telegraph and the wave at the first hole', () => {
    const { w } = attackFrom(tuning.player.PLAYER_START_Y - 1);
    expect(w.dangerCells()).toEqual(
      Array.from({ length: tuning.player.PLAYER_START_Y - 3 }, (_, i) => ({ x: 1, y: 2 + i })),
    );
    // Long enough to reach the hole, short of the next strike.
    run(w, T(tuning.mettik.COUNTER_TIME) + 3 * T(tuning.mettik.MET_WAVE_CELL_TIME));
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

    run(w, 4 * T(tuning.mettik.MET_ACTION_DELAY));
    expect([m.x, m.y, m.hp]).toEqual([0, 1, m.maxHp]);
    expect(w.field.hazard(1, 1)).not.toBeNull();
  });
});
