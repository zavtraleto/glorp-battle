import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { ChipId } from '../src/data/chips';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';

let uid = 30_000;
let enemyId = 40_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 7, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  for (const e of w.enemies) w.occupancy.remove(e.id, e.x, e.y);
  w.enemies = [];
  return w;
}

function addEnemy(w: World, x: number, y: number): void {
  const e = new Mettik(enemyId++, x, y, w.tick);
  w.occupancy.place(e.id, x, y);
  w.enemies.push(e);
}

function give(w: World, id: ChipId): void {
  w.giveChip({ uid: uid++, defId: id, code: '*', state: 'queued', deal: 0 });
}

describe('chip aim preview', () => {
  it('aims Cannon at the first lane target', () => {
    const w = world();
    addEnemy(w, 1, 1);
    give(w, 'cannon');
    expect(w.aimPreview()).toEqual({ cells: [{ x: 1, y: 1 }], beam: { x: 1, fromY: 4, toY: 1 } });
  });

  it('shows Spreader main and two side cells', () => {
    const w = world();
    addEnemy(w, 1, 1);
    give(w, 'spreader');
    expect(w.aimPreview()?.cells).toEqual([{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 1 }]);
  });

  it('shows Mine fixed two cells ahead', () => {
    const w = world();
    addEnemy(w, 2, 0);
    give(w, 'mine');
    expect(w.aimPreview()?.cells).toEqual([{ x: 1, y: 2 }]);
    expect(w.aimPreview()?.beam).toBeNull();
  });
});
