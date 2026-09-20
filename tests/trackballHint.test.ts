import { describe, expect, it } from 'vitest';
import { ARM_BREATHE, HINT_PULSE_GAIN, ringPulseLevel } from '../src/terminal/parts/trackball';

// The tutorial's first hint ('move') fires with an empty Attack Queue, so the
// trackball is never armed while it is shown. The ring still has to breathe.

describe('ringPulseLevel', () => {
  it('breathes across the whole phase even with nothing armed, once a hint pulse is on', () => {
    for (const beat of [0, 0.25, 0.5, 0.75, 1]) {
      expect(ringPulseLevel(0, beat, true)).toBeGreaterThan(0);
    }
  });

  it('stays dark with nothing armed and no hint pulse', () => {
    for (const beat of [0, 0.25, 0.5, 0.75, 1]) {
      expect(ringPulseLevel(0, beat, false)).toBe(0);
    }
  });

  it('never dims an armed ring below its own (already amplified) breathing level', () => {
    // The hint floor can only raise the level (Math.max): it must never fall below
    // the plain armed*breathe term the ring already used before this fix existed.
    const armed = 0.8;
    const breathe = ARM_BREATHE * HINT_PULSE_GAIN;
    for (const beat of [0, 0.3, 0.6, 1]) {
      const armedOnly = armed * (1 - breathe + breathe * beat);
      expect(ringPulseLevel(armed, beat, true)).toBeGreaterThanOrEqual(armedOnly - 1e-9);
    }
  });
});
