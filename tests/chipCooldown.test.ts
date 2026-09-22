import { describe, expect, it } from 'vitest';
import { cooldownBodyLevel, cooldownFaceRows, FACE_H } from '../src/terminal/chips/chipFace';

describe('chip cooldown face', () => {
  it('reveals the whole face in texel rows from bottom to top', () => {
    expect(cooldownFaceRows(-1)).toBe(0);
    expect(cooldownFaceRows(0)).toBe(0);
    expect(cooldownFaceRows(0.5)).toBe(FACE_H / 2);
    expect(cooldownFaceRows(0.999)).toBe(FACE_H - 1);
    expect(cooldownFaceRows(1)).toBe(FACE_H);
    expect(cooldownFaceRows(2)).toBe(FACE_H);
  });

  it('starts the cartridge body nearly dark and reaches its normal brightness', () => {
    expect(cooldownBodyLevel(-1)).toBeCloseTo(0.18, 5);
    expect(cooldownBodyLevel(0)).toBeCloseTo(0.18, 5);
    expect(cooldownBodyLevel(0.5)).toBeCloseTo(0.59, 5);
    expect(cooldownBodyLevel(1)).toBe(1);
    expect(cooldownBodyLevel(2)).toBe(1);
  });
});
