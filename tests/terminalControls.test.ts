import { describe, expect, it } from 'vitest';
import { Spring } from '../src/terminal/anim/spring';
import {
  acceptsPress,
  cursorKind,
  organForKey,
  shotAvailability,
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
    player: { flinched: false, actionTicks: 0, paralyzeTicks: 0 },
    chips: { attack: [0], locked: false },
    ...over,
  };
}

describe('control rules', () => {
  it('lets the shot fire only for a free player with a queued chip', () => {
    expect(shotAvailability(cw())).toBe('ok');
    expect(shotAvailability(cw({ chips: { attack: [], locked: false } }))).toBe('dull');
    expect(shotAvailability(cw({ chips: { attack: [0], locked: true } }))).toBe('ok');
    expect(shotAvailability(cw({ activeChip: {} }))).toBe('ok');
    expect(shotAvailability(cw({ player: { flinched: true, actionTicks: 0, paralyzeTicks: 0 } }))).toBe('dull');
    expect(shotAvailability(cw({ player: { flinched: false, actionTicks: 3, paralyzeTicks: 0 } }))).toBe('ok');
    expect(shotAvailability(cw({ player: { flinched: false, actionTicks: 0, paralyzeTicks: 3 } }))).toBe('dull');
    expect(shotAvailability(cw({ state: 'BATTLE_INTRO' }))).toBe('dull');
  });

  it('accepts presses in battle, menu navigation in menus, pause always', () => {
    expect(acceptsPress('BATTLE', 'trackball')).toBe(true);
    expect(acceptsPress('TRANSITION', 'trackball')).toBe(false);
    expect(acceptsPress('TRANSITION', 'pause')).toBe(true);
    expect(acceptsPress('MENU', 'trackball')).toBe(true);
  });

  // There is no EXECUTE key any more: the shot keys animate the ball (spec §11.2).
  it('maps keys to controls', () => {
    expect(organForKey('ArrowLeft')).toEqual({ zone: 'trackball', dir: 'left' });
    expect(organForKey('KeyW')).toEqual({ zone: 'trackball', dir: 'up' });
    expect(organForKey('Space')).toEqual({ zone: 'trackball', fire: true });
    expect(organForKey('KeyF')).toEqual({ zone: 'trackball', fire: true });
    expect(organForKey('Escape')).toEqual({ zone: 'pause' });
    // Digits pick the chip in that hand slot (GDD §12).
    expect(organForKey('Digit1')).toEqual({ zone: 'rail', slot: 0 });
    expect(organForKey('Digit5')).toEqual({ zone: 'rail', slot: 4 });
    expect(organForKey('Digit6')).toBeNull();
    expect(organForKey('Digit0')).toBeNull();
    expect(organForKey('KeyQ')).toBeNull();
    expect(organForKey('KeyE')).toBeNull();
    expect(organForKey('KeyZ')).toBeNull();
  });

  it('picks the cursor', () => {
    expect(cursorKind(false, false)).toBe('default');
    expect(cursorKind(true, false)).toBe('point');
    expect(cursorKind(true, true)).toBe('press');
    expect(cursorKind(false, true)).toBe('press');
  });
});
