import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { CHIP_ICONS, ICON_PALETTE } from '../src/terminal/chips/chipIcons';
import { activeSlot, planRail } from '../src/terminal/chips/railPlan';

const E = null;

describe('planRail', () => {
  it('loads confirmed chips from the first slot', () => {
    expect(planRail([E, E, E, E, E], [7, 8, 9], false)).toEqual({
      remove: [],
      add: [
        { slot: 0, uid: 7 },
        { slot: 1, uid: 8 },
        { slot: 2, uid: 9 },
      ],
    });
  });

  it('ejects a used chip and leaves the others in place', () => {
    expect(planRail([7, 8, 9, E, E], [8, 9], false)).toEqual({ remove: [{ slot: 0, how: 'eject' }], add: [] });
  });

  it('burns what is left when the Custom Screen opens', () => {
    expect(planRail([E, 8, 9, E, E], [], true)).toEqual({
      remove: [
        { slot: 1, how: 'burn' },
        { slot: 2, how: 'burn' },
      ],
      add: [],
    });
  });

  it('does nothing when the rail matches the queue (ADD leaves it empty)', () => {
    expect(planRail([E, E, E, E, E], [], false)).toEqual({ remove: [], add: [] });
    expect(planRail([E, 8, 9, E, E], [8, 9], false)).toEqual({ remove: [], add: [] });
  });

  it('puts an appended chip after the last kept one', () => {
    expect(planRail([E, 8, E, E, E], [8, 30], false).add).toEqual([{ slot: 2, uid: 30 }]);
  });

  it('drops chips that do not fit', () => {
    expect(planRail([E, E, E, 8, 9], [8, 9, 30], false).add).toEqual([]);
    expect(planRail([E, E, E, E, E], [1, 2, 3, 4, 5, 6], false).add).toHaveLength(5);
  });

  it('replaces a burned rail with a new hand in one step', () => {
    expect(planRail([E, 8, E, E, E], [20, 21], true)).toEqual({
      remove: [{ slot: 1, how: 'burn' }],
      add: [
        { slot: 0, uid: 20 },
        { slot: 1, uid: 21 },
      ],
    });
  });

  it('finds the active slot', () => {
    expect(activeSlot([E, E, 9, 10, E])).toBe(2);
    expect(activeSlot([E, E, E, E, E])).toBe(-1);
  });
});

describe('chip icons', () => {
  it('covers every chip with a 16×16 icon from the palette', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      const rows = CHIP_ICONS[id];
      expect(rows, id).toHaveLength(16);
      for (const row of rows) {
        expect(row, id).toHaveLength(16);
        for (const ch of row) expect(ch === '.' || ch in ICON_PALETTE, `${id}: ${ch}`).toBe(true);
      }
    }
  });
});
