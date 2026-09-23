import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipAim, type AimLookup } from '../src/sim/chips/aim';
import { useTicks } from '../src/sim/chips/executor';
import { Mettik } from '../src/sim/enemies/mettik';
import type { SimEvent } from '../src/sim/events';
import { World } from '../src/sim/world';

// The aim preview must show exactly what the chip will hit (decision 2026-09-19).

const T = (s: number) => secondsToTicks(s);
let uid = 1000;

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

function world(): World {
  const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  w.enemies.length = 0;
  return w;
}

function enemy(w: World, x: number, y: number): Mettik {
  const m = new Mettik(900 + w.enemies.length, x, y, w.tick);
  (m as unknown as { hp: number }).hp = 500;
  w.enemies.push(m);
  w.occupancy.place(m.id, x, y);
  return m;
}

function give(w: World, id: ChipId): void {
  w.giveChip({ uid: uid++, defId: id, code: '*', state: 'queued', deal: 0 });
}

const key = (cells: readonly { x: number; y: number }[]) => cells.map((c) => `${c.x},${c.y}`).sort();

/** Fires the loaded chip and returns the cells it damaged or showed. */
function fired(w: World): string[] {
  const events: SimEvent[] = [];
  w.step(1 / 60, { commands: [{ type: 'useChip' }], held: null });
  events.push(...w.events);
  for (let i = 0; i < T(3 * tuning.projectile.CELL_TRAVEL_TIME) + useTicks(CHIPS.minibomb) + 4; i++) {
    w.step(1 / 60, { commands: [], held: null });
    events.push(...w.events);
  }
  const cells: { x: number; y: number }[] = [];
  for (const e of events) {
    if (e.type === 'damaged' && e.targetId !== 0) cells.push({ x: e.x, y: e.y });
    if (e.type === 'bombLanded') cells.push(...e.cells);
  }
  return [...new Set(key(cells))];
}

describe('chip aim preview', () => {
  it('is empty when nothing is loaded', () => {
    const w = world();
    enemy(w, 1, 1);
    expect(w.aimPreview()).toBeNull();
  });

  it('a cannon aims at the first enemy in the lane, with a beam up to it', () => {
    const w = world();
    enemy(w, 1, 1);
    enemy(w, 1, 0);
    give(w, 'cannon');
    const aim = w.aimPreview()!;
    expect(key(aim.cells)).toEqual(['1,1']);
    expect(aim.beam).toEqual({ x: 1, fromY: w.player.y, toY: 1 });
    expect(fired(w)).toEqual(['1,1']);
  });

  it('a cannon with nothing in the lane aims at nothing, the beam runs to the far edge', () => {
    const w = world();
    enemy(w, 0, 0);
    give(w, 'cannon');
    const aim = w.aimPreview()!;
    expect(aim.cells).toEqual([]);
    expect(aim.beam?.toY).toBe(0);
  });

  it('a spreader aims at the target and every cell around it', () => {
    const w = world();
    enemy(w, 1, 1);
    give(w, 'spreader');
    expect(w.aimPreview()!.cells).toHaveLength(9);
  });

  it('a bomb aims three rows ahead, where it will land', () => {
    const w = world();
    enemy(w, 1, 1);
    give(w, 'minibomb');
    const aim = w.aimPreview()!;
    expect(key(aim.cells)).toEqual([`${w.player.x},${w.player.y - 3}`]);
    expect(fired(w)).toEqual(key(aim.cells));
  });

  it('a sword aims at the panel in front', () => {
    const w = world();
    enemy(w, 1, 0);
    give(w, 'sword');
    expect(key(w.aimPreview()!.cells)).toEqual([`${w.player.x},${w.player.y - 1}`]);
  });

  it('a heal aims at the player', () => {
    const w = world();
    enemy(w, 1, 0);
    give(w, 'recov10');
    expect(key(w.aimPreview()!.cells)).toEqual([`${w.player.x},${w.player.y}`]);
  });

  it('a wave runs up the lane and stops at a hole', () => {
    const l: AimLookup = {
      px: 1,
      py: 4,
      firstTargetRow: () => -1,
      owner: (_x, y) => (y <= 2 ? 'enemy' : 'player'),
      hole: (x, y) => x === 1 && y === 1,
      object: () => false,
      occupied: () => false,
    };
    expect(key(chipAim(CHIPS.shockwave, l).cells)).toEqual(['1,2', '1,3']);
  });

  it('field chips aim at the panels they change', () => {
    const l: AimLookup = {
      px: 1,
      py: 3,
      firstTargetRow: () => -1,
      owner: (_x, y) => (y <= 2 ? 'enemy' : 'player'),
      hole: () => false,
      object: () => false,
      occupied: (x, y) => x === 0 && y === 2,
    };
    expect(key(chipAim(CHIPS.areagrab, l).cells)).toEqual(['1,2', '2,2']);
    expect(key(chipAim(CHIPS.panlout3, l).cells)).toEqual(['0,2', '1,2', '2,2']);
    expect(chipAim(CHIPS.repair, l).cells).toHaveLength(9);
  });
});
