import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Dir } from '../src/core/input/commands';
import type { Enemy, EnemyKind } from '../src/sim/enemies/enemyBase';
import { createEnemy } from '../src/sim/enemies/factory';
import { World } from '../src/sim/world';

// New viruses (roguelite spec §5.2).

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

let nextId = 600;

/** Battle 1 with its enemies replaced by one virus; the player stands at (1,4). */
function arena(kind: EnemyKind, x: number, y: number): { w: World; e: Enemy } {
  const w = new World({ seed: 3, battleIndex: 1, skipIntro: true, cheats: { god: false, aiEnabled: true } });
  for (const old of w.enemies) w.occupancy.remove(old.id, old.x, old.y);
  w.enemies = [];
  w.chips.attack = [];
  const e = createEnemy({ kind, x, y }, nextId++, w.tick);
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
  return { w, e };
}

const step = (w: World, dir?: Dir) => w.step(DT, { commands: dir ? [{ type: 'move', dir }] : [], held: null });

/** Steps until `done` holds; fails after `limit` seconds. */
function until(w: World, done: () => boolean, limit = 10): void {
  for (let i = 0; i < T(limit); i++) {
    if (done()) return;
    step(w);
  }
  expect(done(), 'condition not reached').toBe(true);
}

describe('Hopzap', () => {
  it('hops into the lane and paralyzes with its ring', () => {
    const { w } = arena('hopzap', 0, 0);
    until(w, () => w.player.hitsTaken > 0);
    expect(w.player.hp).toBe(100 - tuning.hopzap.HOP_DMG);
    expect(w.player.paralyzeTicks).toBeGreaterThan(0);
  });
});

describe('Bladdy', () => {
  it('walks to the front edge of the lane and hits two panels', () => {
    const { w, e } = arena('bladdy', 0, 0);
    until(w, () => w.player.hitsTaken > 0);
    expect([e.x, e.y]).toEqual([1, 2]);
    expect(w.player.hp).toBe(100 - tuning.bladdy.BLD_DMG);
  });
});

describe('Rattik', () => {
  it('sends a mine that turns toward the player on their row', () => {
    const { w } = arena('rattik', 1, 1);
    until(w, () => w.attacks.some((a) => a.kind === 'ratmine'));
    step(w, 'left');
    expect(w.player.x).toBe(0);
    until(w, () => w.player.hitsTaken > 0, 3);
    expect(w.player.hp).toBe(100 - tuning.rattik.RAT_DMG);
  });
});

describe('Helmhead', () => {
  it('ignores hits while closed and breaks the panel it shoots', () => {
    const { w, e } = arena('helmhead', 1, 1);
    w.damageEnemy(e, 30);
    expect(e.hp).toBe(tuning.helmhead.HELM_HP);
    until(w, () => e.state === 'TELEGRAPH');
    w.damageEnemy(e, 30);
    expect(e.hp).toBe(tuning.helmhead.HELM_HP - 30);
    until(w, () => w.player.hitsTaken > 0);
    expect(w.player.hp).toBe(100 - tuning.helmhead.HELM_DMG);
    expect(w.field.panel(1, 4)).toBe('CRACKED');
    until(w, () => !w.player.flinched, 1);
    step(w, 'left');
    expect(w.field.panel(1, 4)).toBe('BROKEN');
  });
});

describe('Finnik', () => {
  it('dashes through the lane unhittable and returns to its panel', () => {
    const { w, e } = arena('finnik', 1, 0);
    until(w, () => e.offField);
    expect(w.occupancy.isFree(1, 0)).toBe(true);
    w.damageEnemy(e, 30);
    expect(e.hp).toBe(tuning.finnik.FIN_HP);
    until(w, () => !e.offField, 3);
    expect(w.player.hp).toBe(100 - tuning.finnik.FIN_DMG);
    expect([e.x, e.y]).toEqual([1, 0]);
    expect(w.occupancy.get(1, 0)).toBe(e.id);
  });

  it('lands on the nearest free panel when its own is taken', () => {
    const { w, e } = arena('finnik', 1, 0);
    until(w, () => e.offField);
    w.occupancy.place(999, 1, 0);
    until(w, () => !e.offField, 3);
    expect(Math.abs(e.x - 1) + Math.abs(e.y)).toBe(1);
    expect(w.occupancy.get(e.x, e.y)).toBe(e.id);
  });
});
