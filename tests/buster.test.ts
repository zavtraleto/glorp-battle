import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

// Battle 1: one Mettik at (1,1); the player starts at (1,4) in the same column.
function makeWorld(): World {
  const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false }, skipIntro: true });
  w.chips.queue = [];
  return w;
}

function run(w: World, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    w.step(DT);
    out.push(...w.drainEvents());
  }
  return out;
}

const shots = (ev: SimEvent[]) => ev.filter((e) => e.type === 'busterShot');

describe('auto Buster', () => {
  it('fires once per interval at the first enemy in the column', () => {
    const w = makeWorld();
    const met = w.enemies[0]!;
    const I = T(tuning.buster.BUSTER_INTERVAL);
    expect(shots(run(w, I - 1))).toHaveLength(0);
    const ev = run(w, 1);
    expect(shots(ev)).toEqual([{ type: 'busterShot', x: 1, fromY: 4, toY: 1 }]);
    expect(met.hp).toBe(tuning.mettik.MET_HP - tuning.buster.BUSTER_DAMAGE);
    expect(shots(run(w, I))).toHaveLength(1);
  });

  it('misses when the column is empty', () => {
    const w = makeWorld();
    w.step(DT, { commands: [{ type: 'move', dir: 'left' }], held: null });
    const ev = run(w, T(tuning.buster.BUSTER_INTERVAL));
    expect(shots(ev)).toEqual([{ type: 'busterShot', x: 0, fromY: 4, toY: -1 }]);
    expect(w.enemies[0]!.hp).toBe(tuning.mettik.MET_HP);
  });

  it('holds fire during a chip or a flinch and does not stack shots', () => {
    const w = makeWorld();
    const I = T(tuning.buster.BUSTER_INTERVAL);
    w.player.actionTicks = I * 3;
    expect(shots(run(w, I * 3 - 1))).toHaveLength(0);
    expect(shots(run(w, 2))).toHaveLength(1);
    w.player.flinchTicks = I * 2;
    expect(shots(run(w, I * 2 - 1))).toHaveLength(0);
    expect(shots(run(w, I))).toHaveLength(1);
  });

  it('can be switched off by the cheat', () => {
    const w = new World({ seed: 7, battleIndex: 1, cheats: { god: true, aiEnabled: false, buster: false }, skipIntro: true });
    expect(shots(run(w, T(tuning.buster.BUSTER_INTERVAL) * 3))).toHaveLength(0);
  });
});
