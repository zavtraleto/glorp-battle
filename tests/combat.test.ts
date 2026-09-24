import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import { CHIPS } from '../src/data/chips';
import { Shockwave } from '../src/sim/attacks/shockwave';
import { chipTiming } from '../src/sim/chips/executor';
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
  run(w, chipTiming(CHIPS.cannon).startupTicks);
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
    expect(w.player.hp).toBe(w.player.maxHp - tuning.mettik.MET_DMG);
    expect(w.player.flinched).toBe(true);
    expect(w.player.invulnerable).toBe(true);
    run(w, 5);
    expect(w.player.hp).toBe(w.player.maxHp - tuning.mettik.MET_DMG);
    expect(w.player.hitsTaken).toBe(1);
  });

  it('ignores hits while invulnerable', () => {
    const w = makeWorld({ ai: false });
    w.player.iframeTicks = 100;
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    run(w, 3);
    expect(w.player.hp).toBe(w.player.maxHp);
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
    expect(w.player.hp).toBe(w.player.maxHp);
  });
});

describe('Mettik', () => {
  it('attacks the player lane with a wave that arrives on schedule', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    const moveI = T(tuning.mettik.MET_ACTION_DELAY);
    const waveStep = T(tuning.mettik.MET_WAVE_CELL_TIME);
    run(w, moveI);
    expect(m.state).toBe('INTENTION');
    expect(w.dangerCells()).toEqual([]);
    run(w, T(tuning.mettik.INTENTION_TIME));
    expect(m.state).toBe('LOCK');
    expect(w.dangerCells()).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
      { x: 1, y: 5 },
    ]);
    run(w, T(tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    expect(m.state).toBe('STRIKE');
    expect(w.attacks).toHaveLength(1);
    // Wave spawns at y=2 and needs two steps to reach the player at y=4.
    run(w, 2 * waveStep - 1);
    expect(w.player.hp).toBe(w.player.maxHp);
    run(w, 1);
    expect(w.player.hp).toBe(w.player.maxHp - tuning.mettik.MET_DMG);
  });

  it('the wave can be dodged by leaving the lane before Strike', () => {
    const w = makeWorld();
    run(w, T(tuning.mettik.MET_ACTION_DELAY) + 5);
    move(w, 'left');
    run(w, T(2));
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('steps toward the player lane, one cell per interval, staying in its row', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    move(w, 'right');
    run(w, T(tuning.mettik.MET_ACTION_DELAY));
    expect([m.x, m.y]).toEqual([2, 1]);
    expect(m.state).toBe('MOVE');
  });

  it('is not interrupted by ordinary hits during Intention', () => {
    const w = makeWorld();
    const m = w.enemies[0] as Mettik;
    m.hp = 999;
    run(w, T(tuning.mettik.MET_ACTION_DELAY));
    w.damageEnemy(m, 1);
    expect(m.state).toBe('INTENTION');
    run(w, T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    expect(w.attacks.length).toBe(1);
  });

  it('takes turns: the other Mettik stands until the wave leaves, then acts after its own delay', () => {
    const w = makeWorld();
    const a = w.enemies[0] as Mettik;
    const b = addMettik(w, 1, 0, 501);
    run(w, T(tuning.mettik.MET_ACTION_DELAY));
    expect([a.state, b.state]).toEqual(['INTENTION', 'IDLE']);
    run(w, T(tuning.mettik.INTENTION_TIME + tuning.mettik.LOCK_TIME + tuning.mettik.COUNTER_TIME));
    expect(w.attacks.filter((attack) => attack.kind === 'shockwave')).toHaveLength(1);
    expect(b.state).toBe('IDLE');
    run(w, T(tuning.mettik.MET_ACTION_DELAY) - 1);
    expect(b.state).toBe('IDLE');
    run(w, 1);
    expect(b.state).toBe('INTENTION');
  });

  it('the wave travels to the last row and disappears', () => {
    const w = makeWorld({ ai: false });
    move(w, 'left');
    w.spawnAttack(new Shockwave(1, 1, 2, w.tick));
    run(w, 4 * T(tuning.projectile.CELL_TRAVEL_TIME) + 1);
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

  it('keeps both clocks running after the win so player-clock FX play out', () => {
    const w = makeWorld({ ai: false });
    (w.enemies[0] as Mettik).hp = 1;
    cannon(w);
    expect(w.state).toBe('BATTLE_WON');
    const [tick, playerTick] = [w.tick, w.playerTick];
    run(w, T(tuning.fx.RESULT_DELAY_WIN));
    expect(w.tick - tick).toBe(T(tuning.fx.RESULT_DELAY_WIN));
    expect(w.playerTick - playerTick).toBe(T(tuning.fx.RESULT_DELAY_WIN));
  });

  it('player death ends the battle and freezes the simulation', () => {
    const w = makeWorld({ ai: false });
    w.player.hp = 1;
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
    w.player.hp = 1;
    (w.enemies[0] as Mettik).hp = 1;
    // Enemy dies and the wave lands on the player in the same tick.
    w.killAllEnemies();
    w.spawnAttack(new Shockwave(1, 1, 4, w.tick));
    step(w);
    expect(w.state).toBe('PLAYER_DEAD');
  });
});
