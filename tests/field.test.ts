import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { SimEvent } from '../src/sim/events';
import { Field } from '../src/sim/field';

const T = (s: number) => secondsToTicks(s);
beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

function makeField(): { f: Field; ev: SimEvent[] } {
  const ev: SimEvent[] = [];
  return { f: new Field((e) => ev.push(e)), ev };
}
const free = () => true;

describe('Field', () => {
  it('starts NORMAL with owners by row', () => {
    const { f } = makeField();
    expect(f.panel(0, 0)).toBe('NORMAL');
    expect(f.owner(2, 2)).toBe('enemy');
    expect(f.owner(0, 3)).toBe('player');
    expect(f.owner(3, 0)).toBeNull();
    expect(f.canStand('player', 1, 4)).toBe(true);
    expect(f.canStand('player', 1, 2)).toBe(false);
  });

  it('turns a cracked panel into a hole when its occupant leaves', () => {
    const { f, ev } = makeField();
    expect(f.crack(1, 4)).toBe(true);
    expect(f.panel(1, 4)).toBe('CRACKED');
    expect(f.canStand('player', 1, 4)).toBe(true);
    f.onLeave(1, 4, 10);
    expect(f.panel(1, 4)).toBe('BROKEN');
    expect(f.canStand('player', 1, 4)).toBe(false);
    expect(ev).toEqual([
      { type: 'panelChanged', x: 1, y: 4, panel: 'CRACKED', owner: 'player' },
      { type: 'panelChanged', x: 1, y: 4, panel: 'BROKEN', owner: 'player' },
    ]);
  });

  it('only cracks an occupied panel on a heavy hit', () => {
    const { f } = makeField();
    f.breakPanel(0, 3, 0, true);
    expect(f.panel(0, 3)).toBe('CRACKED');
    f.breakPanel(2, 3, 0, false);
    expect(f.panel(2, 3)).toBe('BROKEN');
  });

  it('restores holes after PANEL_RESTORE_TIME', () => {
    const { f } = makeField();
    f.breakPanel(2, 3, 100, false);
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME) - 1, free);
    expect(f.panel(2, 3)).toBe('BROKEN');
    f.update(100 + T(tuning.field.PANEL_RESTORE_TIME), free);
    expect(f.panel(2, 3)).toBe('NORMAL');
  });

  it('gives a stolen panel back when its timer ends and the panel is free', () => {
    const { f } = makeField();
    expect(f.setOwner(0, 2, 'player', 0)).toBe(true);
    expect(f.canStand('player', 0, 2)).toBe(true);
    const back = T(tuning.field.STEAL_RESTORE_TIME);
    f.update(back, () => false);
    expect(f.owner(0, 2)).toBe('player');
    f.update(back + 1, free);
    expect(f.owner(0, 2)).toBe('enemy');
  });

  it('repairs any panel', () => {
    const { f } = makeField();
    f.breakPanel(1, 5, 0, false);
    expect(f.repair(1, 5)).toBe(true);
    expect(f.panel(1, 5)).toBe('NORMAL');
    expect(f.repair(1, 5)).toBe(false);
  });
});
