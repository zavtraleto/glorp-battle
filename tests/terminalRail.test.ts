import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { CHIP_ICONS, ICON_PALETTE } from '../src/terminal/chips/chipIcons';
import { Rng } from '../src/core/rng';
import { ChipSystem } from '../src/sim/chips/chipSystem';
import { activeSlot, railChanges } from '../src/terminal/chips/railPlan';

describe('activeSlot', () => {
  it('finds the first occupied slot', () => {
    expect(activeSlot([null, null, 9, 10, null])).toBe(2);
    expect(activeSlot([null, null, null, null, null])).toBe(-1);
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

describe('railChanges', () => {
  it('ejects gone chips and loads new ones, leaving unchanged slots alone', () => {
    expect(railChanges([1, 2, null, 4, null], [1, 7, 8, null, null])).toEqual([
      { slot: 1, eject: true, load: true },
      { slot: 2, eject: false, load: true },
      { slot: 3, eject: true, load: false },
    ]);
  });

  it('treats a chip re-dealt into the same slot as eject + load', () => {
    // One chip: fired, then reshuffled straight back into slot 0 by the Refresh.
    const cs = new ChipSystem([{ defId: 'cannon', code: 'A' }], new Rng(1));
    cs.dealHand();
    const keys = () => cs.hand.map((c) => (c ? c.deal : null));
    const uid = cs.hand[0]?.uid;
    const before = keys();
    cs.toggleSelect(0);
    cs.takeNext();
    cs.refresh();
    expect(cs.hand[0]?.uid).toBe(uid);
    expect(railChanges(before, keys())).toEqual([{ slot: 0, eject: true, load: true }]);
  });
});
