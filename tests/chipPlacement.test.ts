import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { CHIPS, type ChipId } from '../src/data/chips';
import { chipTiming } from '../src/sim/chips/executor';
import { World } from '../src/sim/world';

const DT = 1 / 60;
let uid = 70_000;

beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function world(): World {
  const w = new World({ seed: 7, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
  for (const enemy of w.enemies) {
    enemy.hp = 100_000;
    // Keep the target lane clear: Mine and Break skip occupied cells.
    w.occupancy.move(enemy.id, enemy.x, enemy.y, 2, 0);
    enemy.x = enemy.prevX = 2;
    enemy.y = enemy.prevY = 0;
  }
  return w;
}

function useAtImpact(w: World, id: ChipId, commands: Command[] = []): void {
  w.giveChip({ uid: uid++, defId: id, state: 'queued', deal: 0 });
  w.step(DT, { commands: [{ type: 'useChip' }, ...commands], held: null });
  for (let i = 0; i < chipTiming(CHIPS[id]).startupTicks; i++) w.step(DT);
}

const mineRow = () => tuning.player.PLAYER_START_Y - tuning.chips.MINE_TARGET_DISTANCE;
const breakRow = () => tuning.player.PLAYER_START_Y - tuning.chips.BREAK_TARGET_DISTANCE;

describe('fixed-distance field chips', () => {
  it('places Mine exactly MINE_TARGET_DISTANCE cells ahead of the activation cell', () => {
    const w = world();
    const y = mineRow();

    useAtImpact(w, 'mine');

    expect(w.field.hazard(1, y)?.damage).toBe(CHIPS.mine.power);
    expect(w.field.hazard(1, y + 1)).toBeNull();
    expect(w.field.hazard(1, y - 1)).toBeNull();
  });

  it('reads the Mine and Break distances separately', () => {
    tuning.chips.MINE_TARGET_DISTANCE = 2;
    tuning.chips.BREAK_TARGET_DISTANCE = 3;
    const mined = world();
    const broken = world();
    const py = mined.player.y;

    useAtImpact(mined, 'mine');
    useAtImpact(broken, 'break');

    expect(mined.field.hazard(1, py - 2)).not.toBeNull();
    expect(broken.field.panel(1, py - 3)).toBe('BROKEN');
    expect(broken.field.panel(1, py - 2)).toBe('NORMAL');
  });

  it('keeps the activation cell as the anchor when the player moves during startup', () => {
    const w = world();

    useAtImpact(w, 'mine', [{ type: 'move', dir: 'left' }]);

    expect(w.player.x).toBe(0);
    expect(w.field.hazard(1, mineRow())).not.toBeNull();
    expect(w.field.hazard(0, mineRow())).toBeNull();
  });

  it('applies Break exactly BREAK_TARGET_DISTANCE cells ahead and destroys OCCUPY there first', () => {
    const w = world();
    const y = breakRow();
    w.placeBlock(1, y);

    useAtImpact(w, 'break');

    expect(w.objectAt(1, y)).toBeNull();
    expect(w.field.panel(1, y)).toBe('BROKEN');
    expect(w.field.panel(1, y + 1)).toBe('NORMAL');
  });
});
