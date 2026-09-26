import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { EnemyLevel } from '../src/data/enemies';
import type { EnemySpawn } from '../src/data/encounters';
import type { Punchy } from '../src/sim/enemies/punchy';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

// Punchy (Champy, MMBN6) — GDD §8.4.1: stands until the player is in its lane,
// then warps right in front of them (their side too) and punches.

const DT = 1 / 60;
const T = (seconds: number) => secondsToTicks(seconds);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(enemies: EnemySpawn[] = [{ kind: 'punchy', x: 1, y: 0 }]): World {
  return new World({
    seed: 7,
    battleIndex: 1,
    skipIntro: true,
    cheats: { god: false, aiEnabled: true },
    encounter: { id: 'punchy', tier: 'normal', minDepth: 1, maxDepth: 1, waves: [{ enemies }] },
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

/** Steps until the enemy enters `state` (fails after `limit` ticks). */
function until(w: World, e: Punchy, state: Punchy['state'], limit = 600): number {
  for (let i = 0; i < limit; i++) {
    if (e.state === state) return i;
    step(w);
  }
  throw new Error(`never reached ${state}, stuck in ${e.state}`);
}

function placePlayer(w: World, x: number, y: number): void {
  const p = w.player;
  if (p.x !== x || p.y !== y) w.occupancy.move(p.id, p.x, p.y, x, y);
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

const pos = (e: Punchy) => ({ x: e.x, y: e.y });
const punchy = (w: World, i = 0) => w.enemies[i] as Punchy;

describe('Punchy', () => {
  it('stands while the player is out of its lane', () => {
    const w = world();
    placePlayer(w, 0, 4);
    run(w, T(tuning.punchy.ACTION_DELAY) * 4);
    expect(punchy(w).state).toBe('IDLE');
    expect(pos(punchy(w))).toEqual({ x: 1, y: 0 });
  });

  it('commits after the decision delay and marks the arrival cell while still home', () => {
    const w = world();
    placePlayer(w, 1, 4);
    run(w, T(tuning.punchy.ACTION_DELAY) - 1);
    expect(punchy(w).state).toBe('IDLE');
    step(w);
    expect(punchy(w).state).toBe('INTENTION');
    expect(pos(punchy(w))).toEqual({ x: 1, y: 0 });
    const t = punchy(w).telegraph(w.field);
    expect(t?.kind).toBe('warp');
    expect(t?.cells).toEqual([{ x: 1, y: 3 }]);
  });

  it('warps onto the player side right in front of the player and fuses the punch cell', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'LOCK');
    expect(pos(e)).toEqual({ x: 1, y: 3 });
    expect(w.field.owner(1, 3)).toBe('player');
    const t = e.telegraph(w.field);
    expect(t?.kind).toBe('lane');
    expect(t?.cells).toEqual([{ x: 1, y: 4 }]);
    // The fuse burns out on the strike tick.
    until(w, e, 'STRIKE');
    expect(e.stateTick).toBe(t!.end);
  });

  it('punches the committed cell: a player who stays is hit', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    const hp = w.player.hp;
    until(w, e, 'STRIKE');
    expect(w.player.hp).toBe(hp - tuning.punchy.DMG);
  });

  it('keeps the committed cell when the player leaves the lane, and misses', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'INTENTION');
    placePlayer(w, 2, 4);
    const hp = w.player.hp;
    until(w, e, 'LOCK');
    expect(pos(e)).toEqual({ x: 1, y: 3 });
    until(w, e, 'RECOVERY');
    expect(w.player.hp).toBe(hp);
  });

  it('does not attack when the cell in front of the player is a hole or taken', () => {
    const w = world();
    placePlayer(w, 1, 4);
    w.field.breakPanel(1, 3, w.tick, 60 * 60);
    run(w, T(tuning.punchy.ACTION_DELAY) * 3);
    expect(punchy(w).state).toBe('IDLE');

    const w2 = world();
    placePlayer(w2, 1, 5);
    expect(w2.placeObject('rock', 1, 4, 'player')).not.toBeNull();
    run(w2, T(tuning.punchy.ACTION_DELAY) * 3);
    expect(punchy(w2).state).toBe('IDLE');
  });

  it('gives the counter window at least the warp minimum, even at level 3', () => {
    tuning.punchy.COUNTER_TIME = 0.05;
    const w = world([{ kind: 'punchy', x: 1, y: 0, level: 3 as EnemyLevel }]);
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'COUNTER');
    expect(e.stateEndTick - e.stateTick).toBeGreaterThanOrEqual(T(tuning.enemy.WARP_MIN_WINDOW));
  });

  it('recovers next to the player, then warps home and rests before the next check', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'RECOVERY');
    expect(pos(e)).toEqual({ x: 1, y: 3 });
    until(w, e, 'IDLE');
    expect(pos(e)).toEqual({ x: 1, y: 0 });
    // Still in the lane, but it rests first.
    run(w, T(tuning.punchy.REST_TIME) - 1);
    expect(e.state).toBe('IDLE');
    run(w, T(tuning.punchy.ACTION_DELAY) + 1);
    expect(e.state).toBe('INTENTION');
  });

  it('goes to the nearest free cell of its own when home is taken', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'RECOVERY');
    expect(w.placeObject('rock', 1, 0, 'enemy')).not.toBeNull();
    until(w, e, 'IDLE');
    expect(w.field.owner(e.x, e.y)).toBe('enemy');
    expect(Math.abs(e.x - 1) + Math.abs(e.y - 0)).toBe(1);
  });

  it('only one Punchy attacks at a time', () => {
    const w = world([
      { kind: 'punchy', x: 1, y: 0 },
      { kind: 'punchy', x: 1, y: 1 },
    ]);
    placePlayer(w, 1, 4);
    run(w, T(tuning.punchy.ACTION_DELAY) + 1);
    const states = w.enemies.map((e) => e.state).sort();
    expect(states).toEqual(['IDLE', 'INTENTION']);
  });

  it('a counter hit cancels the punch; after the stagger it goes home', () => {
    const w = world();
    const e = punchy(w);
    placePlayer(w, 1, 4);
    until(w, e, 'COUNTER');
    const hp = w.player.hp;
    expect(e.counter(w.tick)).toBe(true);
    expect(e.telegraph(w.field)).toBeNull();
    run(w, T(tuning.enemy.COUNTER_STAGGER_TIME) + 2);
    expect(w.player.hp).toBe(hp);
    expect(e.state).toBe('IDLE');
    expect(pos(e)).toEqual({ x: 1, y: 0 });
  });

  it('dies to one Sword but not to one Cannon [GDD §8.4.1]', () => {
    expect(tuning.sword.DAMAGE).toBeGreaterThanOrEqual(tuning.punchy.HP);
    expect(tuning.cannon.DAMAGE).toBeLessThan(tuning.punchy.HP);
  });
});
