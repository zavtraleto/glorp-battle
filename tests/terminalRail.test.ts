import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { CHIP_ICONS, ICON_PALETTE } from '../src/terminal/chips/chipIcons';
import { Rng } from '../src/core/rng';
import { ChipSystem } from '../src/sim/chips/chipSystem';
import * as railPlan from '../src/terminal/chips/railPlan';

const { activeSlot, railChanges } = railPlan;

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
    // One chip: fired, then reshuffled straight back when its slot cooldown ends.
    const cs = new ChipSystem([{ defId: 'cannon', code: 'A' }], new Rng(1));
    cs.dealHand();
    const keys = () => cs.hand.map((c) => (c ? c.deal : null));
    const uid = cs.hand[0]?.uid;
    const before = keys();
    cs.toggleSelect(0);
    cs.startAttack();
    cs.takeNext(0);
    cs.finishAttack();
    cs.refillReady(240);
    expect(cs.hand[0]?.uid).toBe(uid);
    expect(railChanges(before, keys())).toEqual([{ slot: 0, eject: true, load: true }]);
  });
});

describe('cancel flash', () => {
  it('blinks the cartridge body three times over the configured duration', () => {
    const level = (railPlan as unknown as { cancelFlashLevel?: (remaining: number, total: number) => number }).cancelFlashLevel;
    expect(level).toBeTypeOf('function');
    if (!level) return;
    expect([0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0].map((left) => level(left, 0.6))).toEqual([1, 0, 1, 0, 1, 0, 0]);
  });

  it('reuses the same physical cartridge when a cancelled deal returns during eject', () => {
    const returning = (railPlan as unknown as {
      returningCartIndex?: (carts: readonly { deal: number; phase: string }[], deal: number) => number;
    }).returningCartIndex;
    expect(returning).toBeTypeOf('function');
    if (!returning) return;
    expect(returning([{ deal: 8, phase: 'idle' }, { deal: 4, phase: 'eject' }], 4)).toBe(1);
    expect(returning([{ deal: 4, phase: 'idle' }], 4)).toBe(-1);
  });
});

describe('shared cooldown presentation', () => {
  it('covers every unavailable chip without obscuring the committed tail', () => {
    const cooldownForSlot = (railPlan as unknown as {
      cooldownForSlot?: (state: string, progress: number | null) => number | null;
    }).cooldownForSlot;
    expect(cooldownForSlot).toBeTypeOf('function');
    if (!cooldownForSlot) return;

    expect(cooldownForSlot('locked', 0.5)).toBe(0.5);
    expect(cooldownForSlot('cooling', 0.5)).toBe(0.5);
    expect(cooldownForSlot('committed', 0.5)).toBeNull();
    expect(cooldownForSlot('ready', 0.5)).toBeNull();
  });
});
