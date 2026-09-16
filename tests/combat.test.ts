import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { Mettik } from '../src/sim/enemies/mettik';
import type { SimEvent } from '../src/sim/events';
import { World, type Cheats } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

let attackIds = 1000;

function makeWorld(opts: { ai?: boolean; god?: boolean; battle?: number } = {}): World {
  const cheats: Cheats = { god: opts.god ?? false, aiEnabled: opts.ai ?? true };
  return new World({ seed: 7, battleIndex: opts.battle ?? 1, cheats });
}

function addMettik(w: World, x: number, y: number, id: number): Mettik {
  const m = new Mettik(id, x, y, w.tick, () => attackIds++);
  w.occupancy.place(id, x, y);
  w.enemies.push(m);
  return m;
}

const collected: SimEvent[] = [];

function step(w: World, commands: Command[] = [], held: Dir | null = null): void {
  w.step(DT, { commands, held });
  collected.push(...w.drainEvents());
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

const press = (w: World) => step(w, [{ type: 'busterDown' }]);
const release = (w: World) => step(w, [{ type: 'busterUp' }]);
const tap = (w: World) => step(w, [{ type: 'busterDown' }, { type: 'busterUp' }]);
const move = (w: World, dir: Dir) => step(w, [{ type: 'move', dir }]);
const shots = () => collected.filter((e): e is Extract<SimEvent, { type: 'busterFired' }> => e.type === 'busterFired');

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
  collected.length = 0;
});

describe('buster', () => {
  it('tap hits the first enemy in the lane for 1 damage', () => {
    const w = makeWorld({ ai: false });
    const m = w.enemies[0] as Mettik;
    tap(w);
    expect(m.hp).toBe(tuning.mettik.MET_HP - 1);
    expect(shots()[0]).toMatchObject({ x: 1, fromY: 4, toY: 1, level: 0, damage: 1, hitId: m.id });
  });

  it('misses when no enemy is in the lane', () => {
    const w = makeWorld({ ai: false });
    move(w, 'left');
    run(w, 10);
    tap(w);
    expect((w.enemies[0] as Mettik).hp).toBe(tuning.mettik.MET_HP);
    expect(shots()[0]).toMatchObject({ toY: -1, hitId: null });
  });

  it('only hits the first enemy in the lane', () => {
    const w = makeWorld({ ai: false });
    const back = addMettik(w, 1, 0, 500);
    tap(w);
    expect((w.enemies[0] as Mettik).hp).toBe(tuning.mettik.MET_HP - 1);
    expect(back.hp).toBe(tuning.mettik.MET_HP);
  });

  it('enforces the cooldown and fires a queued shot when it ends', () => {
    const w = makeWorld({ ai: false });
    const m = w.enemies[0] as Mettik;
    tap(w); // tick 1
    run(w, 10);
    tap(w); // queued
    expect(m.hp).toBe(tuning.mettik.MET_HP - 1);
    // First shot at tick 1 → next allowed at tick 1 + cooldown; we are at tick 12.
    run(w, T(tuning.buster.BUSTER_COOLDOWN) - 12);
    expect(m.hp).toBe(tuning.mettik.MET_HP - 1);
    run(w, 1);
    expect(m.hp).toBe(tuning.mettik.MET_HP - 2);
    expect(w.player.buster.shots).toBe(2);
  });

  it('charges to level 1 and level 2', () => {
    const w = makeWorld({ ai: false });
    const m = w.enemies[0] as Mettik;
    press(w);
    run(w, T(tuning.buster.CHARGE_T1));
    release(w);
    expect(m.hp).toBe(tuning.mettik.MET_HP - 8);

    run(w, T(tuning.buster.BUSTER_COOLDOWN));
    press(w);
    run(w, T(tuning.buster.CHARGE_T2));
    release(w);
    expect(m.hp).toBe(tuning.mettik.MET_HP - 8 - 16);
    expect(shots().map((s) => s.level)).toEqual([1, 2]);
  });

  it('releasing just before the threshold gives a normal shot', () => {
    const w = makeWorld({ ai: false });
    press(w);
    run(w, T(tuning.buster.CHARGE_T1) - 2);
    release(w);
    expect(shots()[0]?.level).toBe(0);
  });

  it('respects CHARGE_ENABLED = false', () => {
    tuning.buster.CHARGE_ENABLED = false;
    const w = makeWorld({ ai: false });
    press(w);
    run(w, T(3));
    release(w);
    expect(shots()[0]?.damage).toBe(1);
  });

  it('a hit cancels the charge; holding through the flinch restarts it', () => {
    const w = makeWorld({ ai: false });
    press(w);
    run(w, T(tuning.buster.CHARGE_T1) + 5);
    w.player.takeHit(0, w.tick);
    expect(w.player.buster.chargeStartTick).toBeNull();
    run(w, T(tuning.player.PLAYER_FLINCH_TIME) + 1);
    expect(w.player.buster.chargeStartTick).not.toBeNull();
    release(w);
    expect(shots()[0]?.level).toBe(0);
  });

  it('a tap entirely during a flinch does nothing', () => {
    const w = makeWorld({ ai: false });
    w.player.takeHit(0, w.tick);
    step(w);
    tap(w);
    run(w, T(1));
    expect(shots()).toHaveLength(0);
  });
});

describe('player damage', () => {
  it('flinches, becomes invulnerable and is hit only once per attack', () => {
    const w = makeWorld({ ai: false });
    const wave = new Shockwave(1, 1, 4, w.tick);
    w.spawnAttack(wave);
    step(w);
    expect(w.player.hp).toBe(100 - tuning.mettik.MET_DMG);
    expect(w.player.flinched).toBe(true);
    expect(w.player.invulnerable).toBe(true);
    run(w, 5);
    expect(w.player.hp).toBe(100 - tuning.mettik.MET_DMG);
    expect(w.player.hitsTaken).toBe(1);
  });

  it('ignores hits while invulnerable', () => {
    const w = makeWorld({ ai: false });
    w.player.iframeTicks = 100;
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    run(w, 3);
    expect(w.player.hp).toBe(100);
  });

  it('cannot move while flinched', () => {
    const w = makeWorld({ ai: false });
    w.player.takeHit(10, w.tick);
    move(w, 'left');
    run(w, 3);
    expect(w.player.x).toBe(1);
  });

  it('god mode prevents HP loss', () => {
    const w = makeWorld({ ai: false, god: true });
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    step(w);
    expect(w.player.hp).toBe(100);
  });
});

describe('Mettik', () => {
  it('attacks the player lane with a wave that arrives on schedule', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    const moveI = T(tuning.mettik.MET_MOVE_INTERVAL);
    const tele = T(tuning.mettik.MET_TELEGRAPH);
    const waveStep = T(tuning.mettik.MET_WAVE_STEP);
    run(w, moveI);
    expect(m.state).toBe('TELEGRAPH');
    expect(w.dangerCells()).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ]);
    run(w, tele);
    expect(m.state).toBe('ATTACK');
    expect(w.attacks).toHaveLength(1);
    // Wave spawns at y=2 and needs two steps to reach the player at y=4.
    run(w, 2 * waveStep - 1);
    expect(w.player.hp).toBe(100);
    run(w, 1);
    expect(w.player.hp).toBe(100 - tuning.mettik.MET_DMG);
  });

  it('the wave can be dodged by leaving the lane during the telegraph', () => {
    const w = makeWorld();
    run(w, T(tuning.mettik.MET_MOVE_INTERVAL) + 5);
    move(w, 'left');
    run(w, T(2));
    expect(w.player.hp).toBe(100);
  });

  it('steps toward the player lane, one cell per interval, staying in its row', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    move(w, 'right');
    run(w, T(tuning.mettik.MET_MOVE_INTERVAL));
    expect([m.x, m.y]).toEqual([2, 1]);
    expect(m.state).toBe('MOVE');
  });

  it('is not interrupted by hits during the telegraph', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    run(w, T(tuning.mettik.MET_MOVE_INTERVAL));
    tap(w);
    expect(m.state).toBe('TELEGRAPH');
    run(w, T(tuning.mettik.MET_TELEGRAPH));
    expect(w.attacks.length).toBe(1);
  });

  it('multiple Mettiks take turns attacking', () => {
    const w = makeWorld();
    const a = w.enemies[0] as Mettik;
    const b = addMettik(w, 1, 0, 501);
    let both = false;
    let bAttacked = false;
    for (let i = 0; i < T(8); i++) {
      step(w);
      const busyA = a.state === 'TELEGRAPH' || a.state === 'ATTACK';
      const busyB = b.state === 'TELEGRAPH' || b.state === 'ATTACK';
      if (busyA && busyB) both = true;
      if (b.state === 'TELEGRAPH') bAttacked = true;
    }
    expect(both).toBe(false);
    expect(bAttacked).toBe(true);
  });

  it('the wave travels to the last row and disappears', () => {
    const w = makeWorld({ ai: false });
    move(w, 'left');
    w.spawnAttack(new Shockwave(1, 1, 2, w.tick));
    run(w, 4 * T(tuning.mettik.MET_WAVE_STEP) + 1);
    expect(w.attacks).toHaveLength(0);
  });
});

describe('battle outcome', () => {
  it('killing all enemies wins and removes them after the deletion animation', () => {
    const w = makeWorld({ ai: false });
    const m = w.enemies[0] as Mettik;
    m.hp = 1;
    tap(w);
    expect(w.state).toBe('BATTLE_WON');
    expect(collected.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(w.enemies).toHaveLength(1);
    run(w, T(tuning.fx.DELETE_ANIM_TIME));
    expect(w.enemies).toHaveLength(0);
    expect(w.occupancy.isFree(1, 1)).toBe(true);
  });

  it('a pure Buster fight against battle 1 can be won', () => {
    const w = makeWorld({ god: true });
    // Charge-shot loop: hold for level 2, release, wait out the cooldown.
    for (let i = 0; i < 10 && w.state === 'ACTION'; i++) {
      press(w);
      run(w, Math.max(T(tuning.buster.CHARGE_T2), T(tuning.buster.BUSTER_COOLDOWN)));
      release(w);
      run(w, T(0.5));
      // Stay in the Mettik's lane.
      const m = w.enemies[0];
      if (m && m.x !== w.player.x) move(w, m.x < w.player.x ? 'left' : 'right');
    }
    expect(w.state).toBe('BATTLE_WON');
  });

  it('player death ends the battle and freezes the simulation', () => {
    const w = makeWorld({ ai: false });
    w.player.hp = 5;
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    step(w);
    expect(w.state).toBe('PLAYER_DEAD');
    const m = w.enemies[0] as Mettik;
    const before = m.stateTick;
    run(w, 60);
    expect(m.stateTick).toBe(before);
  });

  it('kill-trade on the same tick counts as a loss', () => {
    const w = makeWorld({ ai: false });
    w.player.hp = 5;
    (w.enemies[0] as Mettik).hp = 1;
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    tap(w);
    expect(w.state).toBe('PLAYER_DEAD');
  });
});
