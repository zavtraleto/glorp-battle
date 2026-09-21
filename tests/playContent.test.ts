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
  it('contains only the nine approved chips and four approved enemies', () => {
    expect(api.PLAY_CONTENT).toEqual({
      chips: [
        { defId: 'cannon', code: 'A' },
        { defId: 'vulcan', code: 'A' },
        { defId: 'barrier', code: 'A' },
        { defId: 'panlgrab', code: 'A' },
        { defId: 'sword', code: 'L' },
        { defId: 'widesword', code: 'L' },
        { defId: 'minibomb', code: 'L' },
        { defId: 'areagrab', code: 'L' },
        { defId: 'recover50', code: '*' },
      ],
      enemies: ['mettik', 'canodron', 'bladdy', 'hopzap'],
    });
  });

  it('builds 18 guaranteed cards plus two seeded bonus cards', () => {
    const a = createFolder(new Rng(123));
    const b = createFolder(new Rng(123));
    expect(a).toHaveLength(20);
    expect(b).toEqual(a);

    const counts = new Map<ChipId, number>();
    for (const chip of a) counts.set(chip.defId, (counts.get(chip.defId) ?? 0) + 1);
    for (const entry of api.PLAY_CONTENT?.chips ?? []) {
      expect(counts.get(entry.defId), entry.defId).toBeGreaterThanOrEqual(2);
      expect(a.filter((chip) => chip.defId === entry.defId).every((chip) => chip.code === entry.code)).toBe(true);
    }
    expect([...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 2), 0)).toBe(2);
  });

  it('allows both bonus draws to select the same chip', () => {
    const firstEveryTime = { pick: <T>(items: readonly T[]) => items[0] as T };
    const folder = createFolder(firstEveryTime);
    expect(folder.filter((chip) => chip.defId === 'cannon')).toHaveLength(4);
    expect(folder).toHaveLength(20);
  });
});
