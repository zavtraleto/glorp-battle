import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import type { ChipCode, ChipId } from '../src/data/chips';
import type { EnemyKind } from '../src/sim/enemies/enemyBase';
import type { FolderChip } from '../src/sim/chips/chipSystem';
import * as runModule from '../src/app/run';

interface PlayEntry {
  defId: ChipId;
  code: ChipCode;
}

interface PlayApi {
  PLAY_CONTENT?: {
    chips: readonly PlayEntry[];
    enemies: readonly EnemyKind[];
  };
  createPlayFolder?: (rng: Pick<Rng, 'pick'>) => FolderChip[];
}

const api = runModule as PlayApi;
const createFolder = (rng: Pick<Rng, 'pick'>): FolderChip[] => api.createPlayFolder?.(rng) ?? [];

describe('Play content profile', () => {
  it('contains only the ten approved chips and four approved enemies', () => {
    expect(api.PLAY_CONTENT).toEqual({
      chips: [
        { defId: 'cannon', code: '*' },
        { defId: 'sword', code: '*' },
        { defId: 'areagrab', code: '*' },
        { defId: 'mine', code: '*' },
        { defId: 'block', code: '*' },
        { defId: 'break', code: '*' },
        { defId: 'airshot', code: '*' },
        { defId: 'spreader', code: '*' },
        { defId: 'widesword', code: '*' },
        { defId: 'guard', code: '*' },
      ],
      enemies: ['mettik', 'canodron', 'bladdy', 'hopzap'],
    });
  });

  it('deals the 8-chip starter folder: 3 Cannon, 2 Sword, 2 AreaGrab, 1 Guard', () => {
    const a = createFolder(new Rng(123));
    const b = createFolder(new Rng(123));
    expect(a).toHaveLength(8);
    expect(b).toEqual(a);

    const counts = new Map<ChipId, number>();
    for (const chip of a) counts.set(chip.defId, (counts.get(chip.defId) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({ cannon: 3, sword: 2, areagrab: 2, guard: 1 });
    const allowed = new Map((api.PLAY_CONTENT?.chips ?? []).map((entry) => [entry.defId, entry.code]));
    for (const chip of a) expect(chip.code).toBe(allowed.get(chip.defId));
  });

  it('does not let the RNG alter the prototype folder', () => {
    const firstEveryTime = { pick: <T>(items: readonly T[]) => items[0] as T };
    const folder = createFolder(firstEveryTime);
    expect(folder.filter((chip) => chip.defId === 'cannon')).toHaveLength(3);
    expect(folder).toHaveLength(8);
  });
});
