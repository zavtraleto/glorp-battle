import { describe, expect, it } from 'vitest';
import { railSlotRects, trayLayout, type TrayTarget } from '../src/terminal/chips/trayLayout';
import { TrayInput, type TrayActions } from '../src/terminal/interaction/trayInput';
import { computeLayout, type Rect } from '../src/terminal/layout';

const layout = computeLayout(390, 844);
const tray = trayLayout(layout, 5);
const slots = railSlotRects(layout);
const c = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2] as const;

function setup(opts: { selected?: number; pickable?: (slot: number) => boolean; enabled?: boolean } = {}) {
  const log: string[] = [];
  let selected = opts.selected ?? 0;
  const name = (t: TrayTarget) => (t.kind === 'hand' ? `hand${t.slot}` : t.kind === 'rail' ? `rail${t.index}` : t.kind);
  const actions: TrayActions = {
    layout: () => layout,
    tray: () => tray,
    selectedCount: () => selected,
    canPick: opts.pickable ?? (() => true),
    enabled: () => opts.enabled ?? true,
    select: (slot, index) => {
      log.push(`select ${slot}@${index}`);
      selected++;
    },
    unselect: (index) => {
      log.push(`unselect ${index}`);
      selected--;
    },
    reorder: (from, to) => log.push(`reorder ${from}->${to}`),
    refuse: (slot) => log.push(`refuse ${slot}`),
    focus: (slot) => log.push(`focus ${slot}`),
    keyDown: (k) => log.push(`down ${k}`),
    keyUp: (k, fire) => log.push(`up ${k} ${fire}`),
    drag: (s, _x, _y, i) => log.push(`drag ${name(s)} ${i}`),
    dragEnd: (s) => log.push(`end ${name(s)}`),
  };
  return { input: new TrayInput(actions), log };
}

describe('TrayInput', () => {
  it('taps a hand chip into the next slot', () => {
    const { input, log } = setup({ selected: 2 });
    input.down(1, ...c(tray.cells[3]!));
    input.up(1, ...c(tray.cells[3]!));
    expect(log).toEqual(['focus 3', 'select 3@2']);
  });

  it('drags a hand chip to a rail position', () => {
    const { input, log } = setup({ selected: 3 });
    input.down(1, ...c(tray.cells[0]!));
    input.move(1, ...c(slots[1]!));
    input.up(1, ...c(slots[1]!));
    expect(log).toEqual(['focus 0', 'drag hand0 1', 'end hand0', 'select 0@1']);
  });

  it('returns a chip dropped off the rail', () => {
    const { input, log } = setup();
    input.down(1, ...c(tray.cells[0]!));
    input.move(1, ...c(layout.crt));
    input.up(1, ...c(layout.crt));
    expect(log).toEqual(['focus 0', 'drag hand0 null', 'end hand0', 'refuse 0']);
  });

  it('does not pick disabled chips', () => {
    const { input, log } = setup({ pickable: () => false });
    expect(input.down(1, ...c(tray.cells[2]!))).toBe(true);
    input.up(1, ...c(tray.cells[2]!));
    expect(log).toEqual(['focus 2', 'refuse 2']);
  });

  it('ignores small jitter as a tap', () => {
    const { input, log } = setup();
    const [x, y] = c(tray.cells[1]!);
    input.down(1, x, y);
    input.move(1, x + 3, y + 3);
    input.up(1, x + 3, y + 3);
    expect(log).toEqual(['focus 1', 'select 1@0']);
  });

  it('taps a rail chip out and drags one out or along the rail', () => {
    const tap = setup({ selected: 3 });
    tap.input.down(1, ...c(slots[1]!));
    tap.input.up(1, ...c(slots[1]!));
    expect(tap.log).toEqual(['unselect 1']);

    const out = setup({ selected: 3 });
    out.input.down(1, ...c(slots[0]!));
    out.input.move(1, ...c(tray.cells[0]!));
    out.input.up(1, ...c(tray.cells[0]!));
    expect(out.log).toEqual(['drag rail0 null', 'end rail0', 'unselect 0']);

    const along = setup({ selected: 3 });
    along.input.down(1, ...c(slots[0]!));
    along.input.move(1, ...c(slots[2]!));
    along.input.up(1, ...c(slots[2]!));
    expect(along.log).toEqual(['drag rail0 2', 'end rail0', 'reorder 0->2']);
  });

  it('ignores empty rail slots', () => {
    const { input } = setup({ selected: 1 });
    expect(input.down(1, ...c(slots[3]!))).toBe(false);
  });

  it('fires OK only when released on it', () => {
    const a = setup();
    a.input.down(1, ...c(tray.ok));
    a.input.up(1, ...c(tray.ok));
    expect(a.log).toEqual(['down ok', 'up ok true']);
    const b = setup();
    b.input.down(1, ...c(tray.add));
    b.input.up(1, ...c(layout.crt));
    expect(b.log).toEqual(['down add', 'up add false']);
  });

  it('does nothing while disabled', () => {
    const { input, log } = setup({ enabled: false });
    expect(input.down(1, ...c(tray.cells[0]!))).toBe(false);
    expect(log).toEqual([]);
  });
});
