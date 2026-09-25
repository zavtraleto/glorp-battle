import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { CHIPS } from '../src/data/chips';
import { FOLDER_SIZE } from '../src/data/folders';
import { RANDOM_MAX_COPIES, RANDOM_MAX_FIELD, randomFolder } from '../src/app/randomFolder';

describe('randomFolder', () => {
  it.each([1, 2, 3, 42, 999])('seed %i follows the rules', (seed) => {
    const f = randomFolder(new Rng(seed));
    expect(f).toHaveLength(FOLDER_SIZE);
    const counts = new Map<string, number>();
    for (const c of f) counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(RANDOM_MAX_COPIES);
    expect(f.filter((c) => CHIPS[c.defId].kind === 'field').length).toBeLessThanOrEqual(RANDOM_MAX_FIELD);
  });

  it('is deterministic', () => {
    expect(randomFolder(new Rng(7))).toEqual(randomFolder(new Rng(7)));
  });
});
