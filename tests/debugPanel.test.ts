import { describe, expect, it } from 'vitest';
import * as debugPanel from '../src/debug/debugPanel';

describe('debug tuning order', () => {
  it('exposes series and counter timings through tuning', async () => {
    const { DEFAULT_TUNING } = await import('../src/config/tuning');
    const values = DEFAULT_TUNING as unknown as Record<string, Record<string, number>>;

    expect(values.chips?.CHIP_CHAIN_DELAY).toBeGreaterThan(0);
    expect(values.counter).toMatchObject({
      COUNTER_STAGGER_TIME: expect.any(Number),
      COUNTER_WINDOW_METTIK: expect.any(Number),
      COUNTER_WINDOW_CANODRON: expect.any(Number),
      COUNTER_WINDOW_BLADDY: expect.any(Number),
      COUNTER_WINDOW_BUNNY: expect.any(Number),
    });
  });

  it('sorts displayed tuning names alphabetically without depending on declaration order', () => {
    const alphabeticalKeys = (debugPanel as unknown as {
      alphabeticalKeys?: (values: Record<string, unknown>) => string[];
    }).alphabeticalKeys;
    expect(alphabeticalKeys).toBeTypeOf('function');
    if (!alphabeticalKeys) return;

    expect(alphabeticalKeys({ VIEW_FOV: 1, ACTIVE_FILL: 1, CHIP_TILT_DEG: 1 })).toEqual([
      'ACTIVE_FILL',
      'CHIP_TILT_DEG',
      'VIEW_FOV',
    ]);
    expect(alphabeticalKeys({ terminal: {}, chips: {}, battle: {} })).toEqual(['battle', 'chips', 'terminal']);
  });

  it('classifies hexadecimal tuning strings as colour controls', () => {
    expect(debugPanel.tuningControlKind('GLOW_COLOR', '#77C8DF')).toBe('color');
    expect(debugPanel.tuningControlKind('LABEL', 'hologram')).toBe('string');
    expect(debugPanel.tuningControlKind('HALO_STRENGTH', 0.46)).toBe('number');
  });
});
