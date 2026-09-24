import { describe, expect, it } from 'vitest';
import * as debugPanel from '../src/debug/debugPanel';

describe('debug tuning order', () => {
  it('exposes series and counter timings through tuning', async () => {
    const { DEFAULT_TUNING } = await import('../src/config/tuning');
    const values = DEFAULT_TUNING as unknown as Record<string, Record<string, number>>;

    expect(values.chips?.HAND_REFILL_COOLDOWN).toBe(4);
    expect(values.player?.CELL_MOVE_TIME).toBe(0.2);
    expect(values.combo).toMatchObject({
      WORLD_TIME_SCALE: 0.7,
      SLOW_MO_ENTER: 0.1,
      SLOW_MO_EXIT: 0.15,
      COMBO_BREAK_EXIT: 0.08,
      CHIP_INPUT_BUFFER: 0.1,
    });
    expect(values.projectile?.CELL_TRAVEL_TIME).toBe(0.2);
    expect(values.chips).toMatchObject({
      CHIP_STARTUP_CANNON: 0.1,
      CHIP_RECOVERY_CANNON: 0.15,
    });
    for (const group of ['mettik', 'canodron', 'hopzap', 'bladdy']) {
      expect(values[group]).toMatchObject({
        INTENTION_TIME: expect.any(Number),
        LOCK_TIME: expect.any(Number),
        COUNTER_TIME: expect.any(Number),
        STRIKE_TIME: expect.any(Number),
        RECOVERY_TIME: expect.any(Number),
        MOVE_TIME: expect.any(Number),
      });
    }
    expect(values.counter).toMatchObject({
      COUNTER_STAGGER_TIME: expect.any(Number),
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
