import { describe, expect, it } from 'vitest';
import { CHIPS, type ChipId } from '../src/data/chips';
import { CHIP_ICONS, ICON_PALETTE } from '../src/terminal/chips/chipIcons';
import { activeSlot } from '../src/terminal/chips/railPlan';
import { railDropIndex, railSlotRects, RAIL_SLOTS, trayLayout, trayTargetAt } from '../src/terminal/chips/trayLayout';
import { computeLayout } from '../src/terminal/layout';


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

describe('tray layout', () => {
  const layout = computeLayout(390, 844);
  const center = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;

  it('packs five rail slots inside the rail', () => {
    const slots = railSlotRects(layout);
    expect(slots).toHaveLength(RAIL_SLOTS);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(layout.rail.x);
      expect(s.x + s.w).toBeLessThanOrEqual(layout.rail.x + layout.rail.w);
    }
  });

  it('turns a drop into a packed selection index', () => {
    const slots = railSlotRects(layout);
    expect(railDropIndex(layout, ...center(slots[3]!), 1)).toBe(1);
    expect(railDropIndex(layout, ...center(slots[0]!), 3)).toBe(0);
    expect(railDropIndex(layout, ...center(slots[2]!), 4)).toBe(2);
    expect(railDropIndex(layout, center(slots[2]!)[0], layout.rail.y - 2, 4)).toBe(2); // slightly above
    expect(railDropIndex(layout, ...center(layout.crt), 0)).toBeNull();
  });

  it('lays out 5, 10 and 15 hand cells above the keys', () => {
    for (const n of [5, 10, 15]) {
      const t = trayLayout(layout, n);
      expect(t.cells).toHaveLength(n);
      for (const c of t.cells) {
        expect(c.y).toBeGreaterThanOrEqual(layout.deck.y);
        expect(c.y + c.h).toBeLessThanOrEqual(t.ok.y + 0.001);
      }
      expect(t.scale).toBeGreaterThan(0);
      expect(t.scale).toBeLessThanOrEqual(1);
    }
    expect(trayLayout(layout, 15).scale).toBeLessThan(trayLayout(layout, 5).scale);
  });

  it('keeps OK and ADD apart and large enough', () => {
    const t = trayLayout(layout, 5);
    expect(t.add.x + t.add.w).toBeLessThan(t.ok.x);
    expect(Math.min(t.ok.w, t.ok.h)).toBeGreaterThanOrEqual(56);
    expect(Math.min(t.add.w, t.add.h)).toBeGreaterThanOrEqual(56);
    expect(t.ok.y + t.ok.h).toBeLessThanOrEqual(layout.deck.y + layout.deck.h);
  });

  it('finds what a press hits', () => {
    const t = trayLayout(layout, 5);
    expect(trayTargetAt(layout, t, ...center(t.ok), 0)).toEqual({ kind: 'ok' });
    expect(trayTargetAt(layout, t, ...center(t.add), 0)).toEqual({ kind: 'add' });
    expect(trayTargetAt(layout, t, ...center(t.cells[2]!), 0)).toEqual({ kind: 'hand', slot: 2 });
    const slots = railSlotRects(layout);
    expect(trayTargetAt(layout, t, ...center(slots[1]!), 2)).toEqual({ kind: 'rail', index: 1 });
    expect(trayTargetAt(layout, t, ...center(slots[3]!), 2)).toBeNull();
  });
});
