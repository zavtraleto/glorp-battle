import { describe, expect, it } from 'vitest';
import { hologramMotion, reflectionFootprint } from '../src/render/hologramMotion';

describe('hologram projection', () => {
  it('starts the floor reflection beyond the feet and keeps it within the standing cell', () => {
    const depth = 1.35;
    const cellCenter = 0;
    const feet = cellCenter + 0.18 * depth;
    const footprint = reflectionFootprint(feet, depth);
    expect(footprint.start).toBeGreaterThan(feet);
    expect(footprint.end).toBeLessThan(cellCenter + depth / 2);
    expect(footprint.center).toBeCloseTo((footprint.start + footprint.end) / 2);
  });

  it('leans toward horizontal travel, pitches on vertical travel, and settles after arrival', () => {
    const right = hologramMotion(1, 0, 0.5);
    const left = hologramMotion(-1, 0, 0.5);
    const up = hologramMotion(0, -1, 0.5);
    expect(right.leanX).toBeGreaterThan(0.25);
    expect(left.leanX).toBeLessThan(-0.25);
    expect(up.pitch).toBeLessThan(-0.15);
    expect(right.distortion).toBeGreaterThan(0.9);
    expect(hologramMotion(1, 0, 1).leanX).toBe(0);
    expect(hologramMotion(1, 0, 1).distortion).toBe(0);
  });
});
