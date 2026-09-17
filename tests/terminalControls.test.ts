import { describe, expect, it } from 'vitest';
import { Spring } from '../src/terminal/anim/spring';
import {
  acceptsPress,
  chipSelectAvailability,
  cursorKind,
  executeAvailability,
  organForKey,
  type ControlWorld,
} from '../src/terminal/controlRules';

describe('Spring', () => {
  it('converges to the target', () => {
    const s = new Spring(0);
    s.target = 1;
    for (let i = 0; i < 120; i++) s.step(1 / 60, 900, 60);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it('overshoots when underdamped', () => {
    const s = new Spring(1);
    s.target = 0;
    let min = Infinity;
    for (let i = 0; i < 60; i++) {
      s.step(1 / 60, 900, 22);
      min = Math.min(min, s.value);
    }
    expect(min).toBeLessThan(-0.05);
  });

  it('stays stable with long frames', () => {
    const s = new Spring(0);
    s.target = 1;
    for (let i = 0; i < 10; i++) s.step(0.25, 900, 22);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value - 1)).toBeLessThan(0.1);
  });

  it('snaps', () => {
    const s = new Spring(0);
    s.velocity = 5;
    s.snap(2);
    expect([s.value, s.target, s.velocity]).toEqual([2, 2, 0]);
  });
});

function cw(over: Partial<ControlWorld> = {}): ControlWorld {
  return {
    state: 'ACTION',
    activeChip: null,
    gauge: { full: false },
    player: { flinched: false, actionTicks: 0 },
    chips: { queue: [{}] },
    ...over,
  };
}

describe('control rules', () => {
  it('lets EXECUTE fire only for a free player with a queued chip', () => {
    expect(executeAvailability(cw())).toEqual({ press: 'ok', notice: null });
    expect(executeAvailability(cw({ chips: { queue: [] } }))).toEqual({ press: 'dull', notice: 'noChip' });
    expect(executeAvailability(cw({ activeChip: {} })).press).toBe('dull');
    expect(executeAvailability(cw({ player: { flinched: true, actionTicks: 0 } })).press).toBe('dull');
    expect(executeAvailability(cw({ player: { flinched: false, actionTicks: 3 } })).press).toBe('dull');
    expect(executeAvailability(cw({ state: 'BATTLE_START' }))).toEqual({ press: 'dull', notice: null });
  });

  it('lets CHIP SELECT fire only with a full gauge in ACTION', () => {
    expect(chipSelectAvailability(cw())).toBe('dull');
    expect(chipSelectAvailability(cw({ gauge: { full: true } }))).toBe('ok');
    expect(chipSelectAvailability(cw({ gauge: { full: true }, state: 'CUSTOM' }))).toBe('dull');
  });

  it('accepts presses only in battle, except pause', () => {
    expect(acceptsPress('BATTLE', 'execute')).toBe(true);
    expect(acceptsPress('TRANSITION', 'execute')).toBe(false);
    expect(acceptsPress('TRANSITION', 'trackball')).toBe(false);
    expect(acceptsPress('TRANSITION', 'pause')).toBe(true);
    expect(acceptsPress('MENU', 'chipSelect')).toBe(false);
  });

  it('maps keys to controls', () => {
    expect(organForKey('ArrowLeft')).toEqual({ zone: 'trackball', dir: 'left' });
    expect(organForKey('KeyW')).toEqual({ zone: 'trackball', dir: 'up' });
    expect(organForKey('Space')).toEqual({ zone: 'execute' });
    expect(organForKey('KeyE')).toEqual({ zone: 'chipSelect' });
    expect(organForKey('Escape')).toEqual({ zone: 'pause' });
    expect(organForKey('KeyZ')).toBeNull();
  });

  it('picks the cursor', () => {
    expect(cursorKind(null, false)).toBe('default');
    expect(cursorKind('execute', false)).toBe('point');
    expect(cursorKind('execute', true)).toBe('press');
    expect(cursorKind(null, true)).toBe('press');
  });
});
