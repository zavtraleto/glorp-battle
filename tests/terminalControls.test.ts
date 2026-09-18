import { describe, expect, it } from 'vitest';
import { Spring } from '../src/terminal/anim/spring';
import {
  acceptsPress,
  cursorKind,
  organForKey,
  shotAvailability,
  stepFocus,
  trayKeyAction,
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
    player: { flinched: false, actionTicks: 0 },
    chips: { attack: [0] },
    ...over,
  };
}

describe('control rules', () => {
  it('lets the shot fire only for a free player with a queued chip', () => {
    expect(shotAvailability(cw())).toBe('ok');
    expect(shotAvailability(cw({ chips: { attack: [] } }))).toBe('dull');
    expect(shotAvailability(cw({ activeChip: {} }))).toBe('dull');
    expect(shotAvailability(cw({ player: { flinched: true, actionTicks: 0 } }))).toBe('dull');
    expect(shotAvailability(cw({ player: { flinched: false, actionTicks: 3 } }))).toBe('dull');
    expect(shotAvailability(cw({ state: 'BATTLE_INTRO' }))).toBe('dull');
  });

  it('accepts presses in battle, menu navigation in menus, pause always', () => {
    expect(acceptsPress('BATTLE', 'trackball')).toBe(true);
    expect(acceptsPress('TRANSITION', 'trackball')).toBe(false);
    expect(acceptsPress('TRANSITION', 'pause')).toBe(true);
    expect(acceptsPress('MENU', 'trackball')).toBe(true);
    expect(acceptsPress('CHIP_SELECT', 'trackball')).toBe(false);
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

describe('tray keyboard', () => {
  it('maps keys to tray actions', () => {
    expect(trayKeyAction('ArrowRight', 5)).toEqual({ kind: 'focus', delta: 1 });
    expect(trayKeyAction('KeyW', 5)).toEqual({ kind: 'focus', delta: -5 });
    expect(trayKeyAction('Space', 5)).toEqual({ kind: 'pick' });
    expect(trayKeyAction('Backspace', 5)).toEqual({ kind: 'removeLast' });
    expect(trayKeyAction('Enter', 5)).toEqual({ kind: 'ok' });
    expect(trayKeyAction('KeyR', 5)).toEqual({ kind: 'add' });
    expect(trayKeyAction('KeyZ', 5)).toBeNull();
  });

  it('moves the focus over filled slots only', () => {
    const filled = [true, false, true, true, false, true];
    expect(stepFocus(0, 1, filled)).toBe(2);
    expect(stepFocus(3, 1, filled)).toBe(5);
    expect(stepFocus(5, 1, filled)).toBe(5);
    expect(stepFocus(0, -1, filled)).toBe(0);
    expect(stepFocus(0, 5, filled)).toBe(5);
    expect(stepFocus(3, -5, filled)).toBe(3);
  });
});
