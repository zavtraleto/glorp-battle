import { describe, expect, it } from 'vitest';
import { ejectPose, EJECT_MAX_Z } from '../src/terminal/chips/ejectArc';

// The cartridge is thrown out of the port like a spent casing: up, forward past
// the camera and out of the bottom of the frame (spec §9.3). No fading out.
describe('eject arc', () => {
  it('starts exactly in the slot', () => {
    const p = ejectPose(0, 0, 0);
    expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
    expect(p.scale).toBe(1);
    expect(p.rotX).toBeCloseTo(0, 10);
    expect(p.rotZ).toBeCloseTo(0, 10);
  });

  it('moves toward the camera the whole way', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const z = ejectPose(i / 20, 0, 0).z;
      expect(z).toBeGreaterThan(prev);
      prev = z;
    }
  });

  it('rises first and ends below the rail', () => {
    expect(ejectPose(0.2, 0, 0).y).toBeGreaterThan(0);
    expect(ejectPose(1, 0, 0).y).toBeLessThan(-5);
  });

  it('stays inside the near plane so it is never clipped in mid-air', () => {
    expect(ejectPose(1, 0, 0).z).toBeLessThan(EJECT_MAX_Z);
  });

  it('grows as it comes at the viewer', () => {
    expect(ejectPose(1, 0, 0).scale).toBeGreaterThan(ejectPose(0.5, 0, 0).scale);
    expect(ejectPose(0.5, 0, 0).scale).toBeGreaterThan(1);
  });

  it('carries the drift and spin it was given', () => {
    const a = ejectPose(1, 2, 3);
    expect(a.x).toBeGreaterThan(0);
    expect(a.rotZ).not.toBe(0);
    const b = ejectPose(1, -2, 3);
    expect(b.x).toBeLessThan(0);
  });

  it('tumbles forward as it flies', () => {
    expect(ejectPose(1, 0, 0).rotX).not.toBe(0);
  });
});
