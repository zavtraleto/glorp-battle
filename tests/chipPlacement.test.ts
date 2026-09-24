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
  for (const enemy of w.enemies) enemy.hp = 100_000;
  return w;
}

function useAtImpact(w: World, id: ChipId, commands: Command[] = []): void {
  w.giveChip({ uid: uid++, defId: id, code: '*', state: 'queued', deal: 0 });
  w.step(DT, { commands: [{ type: 'useChip' }, ...commands], held: null });
  for (let i = 0; i < chipTiming(CHIPS[id]).startupTicks; i++) w.step(DT);
}

describe('fixed-distance field chips', () => {
  it('places Mine exactly two cells ahead of the activation cell', () => {
    const w = world();

    useAtImpact(w, 'mine');

    expect(w.field.hazard(1, 2)?.damage).toBe(CHIPS.mine.power);
    expect(w.field.hazard(1, 3)).toBeNull();
    expect(w.field.hazard(1, 1)).toBeNull();
  });

  it('keeps the activation cell as the anchor when the player moves during startup', () => {
    const w = world();

    useAtImpact(w, 'mine', [{ type: 'move', dir: 'left' }]);

    expect(w.player.x).toBe(0);
    expect(w.field.hazard(1, 2)).not.toBeNull();
    expect(w.field.hazard(0, 2)).toBeNull();
  });

  it('applies Break exactly two cells ahead and destroys OCCUPY there first', () => {
    const w = world();
    w.placeBlock(1, 2);

    useAtImpact(w, 'break');

    expect(w.objectAt(1, 2)).toBeNull();
    expect(w.field.panel(1, 2)).toBe('BROKEN');
    expect(w.field.panel(1, 3)).toBe('NORMAL');
  });
});
