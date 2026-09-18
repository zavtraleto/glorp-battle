import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { Mettik } from '../src/sim/enemies/mettik';
import type { SimEvent } from '../src/sim/events';
import { World, type Cheats } from '../src/sim/world';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

function makeWorld(opts: { ai?: boolean; god?: boolean; battle?: number } = {}): World {
  const cheats: Cheats = { god: opts.god ?? false, aiEnabled: opts.ai ?? true };
  return new World({ seed: 7, battleIndex: opts.battle ?? 1, cheats, skipIntro: true });
}

function addMettik(w: World, x: number, y: number, id: number): Mettik {
  const m = new Mettik(id, x, y, w.tick);
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

const move = (w: World, dir: Dir) => step(w, [{ type: 'move', dir }]);

/** Queues a Cannon and fires it; the damage lands at the chip's hit frame. */
function cannon(w: World): void {
  w.chips.attack = [];
  w.giveChip({ uid: 9000 + w.tick, defId: 'cannon', code: '*', state: 'queued', deal: 0 });
  step(w, [{ type: 'useChip' }]);
  run(w, T(tuning.chips.CHIP_HIT_FRAME));
}

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
  collected.length = 0;
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
    m.hp = 999;
    run(w, T(tuning.mettik.MET_MOVE_INTERVAL));
    w.damageEnemy(m, 1);
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
    cannon(w);
    expect(w.state).toBe('BATTLE_WON');
    expect(collected.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(w.enemies).toHaveLength(1);
    run(w, T(tuning.fx.DELETE_ANIM_TIME));
    expect(w.enemies).toHaveLength(0);
    expect(w.occupancy.isFree(1, 1)).toBe(true);
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
    // Enemy dies and the wave lands on the player in the same tick.
    w.killAllEnemies();
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    step(w);
    expect(w.state).toBe('PLAYER_DEAD');
  });
});
