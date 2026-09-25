import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { DeadTimeMeter, formatDeadTime } from '../src/debug/deadTime';
import { Mettik } from '../src/sim/enemies/mettik';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { World } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

/** One idle Mettik far from the player's lane, AI off: nothing threatens. */
function quietWorld(skipIntro = true): World {
  const w = new World({ seed: 3, battleIndex: 1, skipIntro, cheats: { god: true, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  const m = new Mettik(900, 0, 0, w.tick);
  w.occupancy.place(m.id, m.x, m.y);
  w.enemies = [m];
  return w;
}

function run(w: World, meter: DeadTimeMeter, ticks: number, commands: Command[] = []): void {
  for (let i = 0; i < ticks; i++) {
    w.step(DT, { commands: i === 0 ? commands : [], held: null });
    meter.observe(w);
  }
}

describe('dead time', () => {
  it('counts fight time with no threat and no player action as dead', () => {
    const w = quietWorld();
    const meter = new DeadTimeMeter();
    run(w, meter, 60);
    expect(meter.stats).toMatchObject({ total: 1, fight: 1, transition: 0, longest: 1 });
  });

  it('a step of the player is action, not dead time', () => {
    const w = quietWorld();
    const meter = new DeadTimeMeter();
    run(w, meter, T(tuning.player.CELL_MOVE_TIME), [{ type: 'move', dir: 'left' }]);
    expect(meter.stats.fight).toBe(0);
    run(w, meter, 30);
    expect(meter.stats.fight).toBeCloseTo(0.5, 5);
  });

  it('an enemy telegraph and an enemy attack on the field are threats', () => {
    const w = quietWorld();
    const meter = new DeadTimeMeter();
    w.enemies[0]!.forceAttack(w.tick);
    run(w, meter, 30);
    expect(meter.stats.fight).toBe(0);

    const calm = quietWorld();
    const meter2 = new DeadTimeMeter();
    calm.spawnAttack(new Shockwave(calm.nextAttackId(), 2, 0, calm.tick));
    run(calm, meter2, 10);
    expect(meter2.stats.fight).toBe(0);
  });

  it('counts the battle intro as transition and tracks the longest dead stretch', () => {
    const w = quietWorld(false);
    const meter = new DeadTimeMeter();
    const intro = T(tuning.flow.INTRO_TIME);
    run(w, meter, intro + 60);
    // The tick that ends the intro already runs ACTION.
    expect(Math.abs(meter.stats.transition - intro / 60)).toBeLessThanOrEqual(1 / 60 + 1e-9);
    expect(meter.stats.fight).toBeGreaterThan(0.9);
    expect(meter.stats.longest).toBeCloseTo(meter.stats.total, 5);
  });

  it('starts over when a new battle begins', () => {
    const meter = new DeadTimeMeter();
    run(quietWorld(), meter, 60);
    run(quietWorld(), meter, 30);
    expect(meter.stats.total).toBeCloseTo(0.5, 5);
  });

  it('formats a compact line', () => {
    expect(formatDeadTime({ total: 45, fight: 6.1, transition: 2.3, longest: 2.2 }))
      .toBe('dead 8.4s 19% (fight 6.1 + trans 2.3) max 2.2s / 45.0s');
    expect(formatDeadTime({ total: 0, fight: 0, transition: 0, longest: 0 })).toBe('dead 0.0s 0% (fight 0.0 + trans 0.0) max 0.0s / 0.0s');
  });
});
