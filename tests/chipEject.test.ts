import { describe, expect, it } from 'vitest';
import { ejectPose } from '../src/terminal/chips/ejectArc';

// The cartridge is thrown out of the port at the player: a hop, then it
// tumbles at the camera and passes just under the lens (spec §9.3).
const AIM = { x: 1, y: 3, z: 40 };

describe('eject arc', () => {
  it('starts exactly in the slot', () => {
    const p = ejectPose(0, AIM, 0, 0);
    expect([p.x, p.y, p.z]).toEqual([0, 0, 0]);
    expect(p.scale).toBe(1);
    expect(p.rotX).toBeCloseTo(0, 10);
    expect(p.rotY).toBeCloseTo(0, 10);
    expect(p.rotZ).toBeCloseTo(0, 10);
  });

  it('moves toward the camera the whole way and speeds up', () => {
    let prev = 0;
    let prevStep = 0;
    for (let i = 1; i <= 20; i++) {
      const z = ejectPose(i / 20, AIM, 0, 0).z;
      expect(z).toBeGreaterThan(prev);
      expect(z - prev).toBeGreaterThan(prevStep);
      prevStep = z - prev;
      prev = z;
    }
  });

  it('ends at the aim point, never past it', () => {
    const end = ejectPose(1, AIM, 0, 0);
    expect(end.x).toBeCloseTo(AIM.x, 10);
    expect(end.y).toBeCloseTo(AIM.y, 10);
    expect(end.z).toBeCloseTo(AIM.z, 10);
    expect(ejectPose(2, AIM, 0, 0).z).toBeCloseTo(AIM.z, 10);
  });

  it('hops up out of the port before it heads for the aim', () => {
    const low = { x: 0, y: -5, z: 40 };
    expect(ejectPose(0.2, low, 0, 0).y).toBeGreaterThan(0);
    expect(ejectPose(1, low, 0, 0).y).toBeCloseTo(-5, 10);
  });

  it('tumbles on more than one axis', () => {
    const p = ejectPose(1, AIM, 0, 0.4);
    expect(Math.abs(p.rotX)).toBeGreaterThan(Math.PI * 2);
    expect(p.rotY).not.toBe(0);
    expect(p.rotZ).not.toBe(0);
  });

  it('carries the drift and spin it was given', () => {
    const still = { x: 0, y: 0, z: 40 };
    expect(ejectPose(1, still, 2, 3).x).toBeGreaterThan(0);
    expect(ejectPose(1, still, -2, 3).x).toBeLessThan(0);
    expect(Math.sign(ejectPose(1, still, 0, -1).rotY)).toBe(-1);
  });
});
