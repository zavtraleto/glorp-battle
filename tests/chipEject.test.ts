import { describe, expect, it } from 'vitest';
import {
  chooseEjectProfile,
  ejectAim,
  ejectPose,
  safeEjectDepth,
  type EjectProfile,
} from '../src/terminal/chips/ejectArc';

const CAMERA = { x: 0, y: 0, z: 40 };
const ORIGINS = [-2, -1, 0, 1, 2].map((x) => ({ x, y: -5, z: 0.5 }));

function groupProfiles(seed = 17): EjectProfile[] {
  const profiles: EjectProfile[] = [];
  for (let slot = 0; slot < ORIGINS.length; slot++) {
    profiles.push(chooseEjectProfile(seed + slot * 31, slot, profiles.map((profile) => profile.corridor)));
  }
  return profiles;
}

describe('eject route selection', () => {
  it('uses only the approved left, right and bottom exits', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (let slot = 0; slot < 5; slot++) {
        expect(['left', 'right', 'bottom']).toContain(chooseEjectProfile(seed, slot, []).side);
      }
    }
  });

  it('gives a simultaneous five-chip ejection five separate corridors', () => {
    const profiles = groupProfiles();
    expect(new Set(profiles.map((profile) => profile.corridor)).size).toBe(5);
  });

  it('keeps edge slots on their own side or sends them through the bottom', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(chooseEjectProfile(seed, 0, []).side).not.toBe('right');
      expect(chooseEjectProfile(seed, 1, []).side).not.toBe('right');
      expect(chooseEjectProfile(seed, 3, []).side).not.toBe('left');
      expect(chooseEjectProfile(seed, 4, []).side).not.toBe('left');
    }
  });

  it('is deterministic but varies route, timing and rotation by seed', () => {
    const sameA = chooseEjectProfile(123, 2, []);
    const sameB = chooseEjectProfile(123, 2, []);
    expect(sameA).toEqual(sameB);

    const variants = Array.from({ length: 12 }, (_, seed) => chooseEjectProfile(seed, 2, []));
    expect(new Set(variants.map((profile) => profile.corridor)).size).toBeGreaterThan(2);
    expect(new Set(variants.map((profile) => profile.durationScale.toFixed(3))).size).toBeGreaterThan(4);
    expect(new Set(variants.map((profile) => profile.turns.join(','))).size).toBeGreaterThan(4);
  });

  it('keeps every flight noticeably slower than the previous snap', () => {
    for (let seed = 0; seed < 100; seed++) {
      const profile = chooseEjectProfile(seed, seed % 5, []);
      expect(profile.durationScale).toBeGreaterThanOrEqual(1.12);
      expect(profile.durationScale).toBeLessThanOrEqual(1.48);
    }
  });
});

describe('eject arc', () => {
  const profile = chooseEjectProfile(9, 0, []);
  const origin = ORIGINS[0]!;
  const aim = ejectAim(profile, origin, CAMERA);

  it('starts exactly at the cleared launch point', () => {
    const pose = ejectPose(0, aim, profile);
    expect([pose.x, pose.y, pose.z]).toEqual([0, 0, 0]);
    expect(pose.scale).toBe(1);
    expect([pose.rotX, pose.rotY, pose.rotZ]).toEqual([0, 0, 0]);
  });

  it('ends at its assigned boundary and never uses the top edge', () => {
    for (const candidate of groupProfiles()) {
      const candidateOrigin = ORIGINS[candidate.slot]!;
      const candidateAim = ejectAim(candidate, candidateOrigin, CAMERA);
      const end = ejectPose(1, candidateAim, candidate);
      const world = {
        x: candidateOrigin.x + end.x,
        y: candidateOrigin.y + end.y,
        z: candidateOrigin.z + end.z,
      };
      const remainingDepth = CAMERA.z - world.z;
      const projectedX = (world.x - CAMERA.x) / remainingDepth;
      const projectedY = (world.y - CAMERA.y) / remainingDepth;
      if (candidate.side === 'left') expect(projectedX).toBeLessThan(-1);
      if (candidate.side === 'right') expect(projectedX).toBeGreaterThan(1);
      if (candidate.side === 'bottom') expect(projectedY).toBeLessThan(-1);
      expect(projectedY).toBeLessThan(1);
    }
  });

  it('moves toward the camera without crossing it', () => {
    let previous = 0;
    for (let step = 1; step <= 40; step++) {
      const z = ejectPose(step / 40, aim, profile).z;
      expect(z).toBeGreaterThan(previous);
      expect(z).toBeLessThan(CAMERA.z - origin.z);
      previous = z;
    }
  });

  it('follows a weighted ballistic arc: up first, then an accelerating fall', () => {
    const bottom = Array.from({ length: 20 }, (_, seed) => chooseEjectProfile(seed, 2, []))
      .find((candidate) => candidate.side === 'bottom')!;
    const bottomAim = ejectAim(bottom, ORIGINS[2]!, CAMERA);
    const sample = (p: number) => ejectPose(p, bottomAim, bottom).y;

    expect(sample(0.1)).toBeGreaterThan(0);
    const ys = [0, 0.1, 0.2, 0.3, 0.4].map(sample);
    const peakAt = ys.indexOf(Math.max(...ys));
    expect(peakAt).toBeGreaterThan(0);
    expect(peakAt).toBeLessThan(4);

    const falling = [0.55, 0.65, 0.75, 0.85, 0.95].map(sample);
    const drops = falling.slice(1).map((y, index) => y - falling[index]!);
    for (let index = 1; index < drops.length; index++) {
      expect(drops[index]).toBeLessThan(drops[index - 1]!);
    }
  });

  it('separates a group as it approaches the player', () => {
    const profiles = groupProfiles();
    const initialGap = 1 / (CAMERA.z - ORIGINS[0]!.z);
    for (let step = 1; step <= 20; step++) {
      const p = step / 20;
      const projected = profiles.map((candidate, slot) => {
        const candidateOrigin = ORIGINS[slot]!;
        const pose = ejectPose(p, ejectAim(candidate, candidateOrigin, CAMERA), candidate);
        const depth = CAMERA.z - candidateOrigin.z - pose.z;
        return { x: (candidateOrigin.x + pose.x) / depth, y: (candidateOrigin.y + pose.y) / depth };
      });
      for (let a = 0; a < projected.length; a++) {
        for (let b = a + 1; b < projected.length; b++) {
          const dx = projected[a]!.x - projected[b]!.x;
          const dy = projected[a]!.y - projected[b]!.y;
          const gap = Math.hypot(dx, dy);
          expect(gap, `step ${step}, pair ${a}/${b}, corridors ${profiles[a]!.corridor}/${profiles[b]!.corridor}`).toBeGreaterThan(initialGap * 0.7);
        }
      }
    }
  });

  it('never crosses the central battle area', () => {
    const profiles = groupProfiles();
    for (const candidate of profiles) {
      const candidateOrigin = ORIGINS[candidate.slot]!;
      const candidateAim = ejectAim(candidate, candidateOrigin, CAMERA);
      for (let step = 1; step <= 40; step++) {
        const pose = ejectPose(step / 40, candidateAim, candidate);
        const depth = CAMERA.z - candidateOrigin.z - pose.z;
        const projectedX = (candidateOrigin.x + pose.x) / depth;
        const projectedY = (candidateOrigin.y + pose.y) / depth;
        // Camera-space slopes: the CRT picture occupies roughly ±0.12
        // horizontally and begins above -0.1 at the rail edge.
        const insideBattle = Math.abs(projectedX) < 0.12 && projectedY > -0.1;
        expect(insideBattle, `corridor ${candidate.corridor}, step ${step}`).toBe(false);
      }
    }
  });

  it('tumbles on all three axes with restrained rotation and angular drag', () => {
    const variants = groupProfiles();
    for (const candidate of variants) {
      const middle = ejectPose(0.5, ejectAim(candidate, ORIGINS[candidate.slot]!, CAMERA), candidate);
      const end = ejectPose(1, ejectAim(candidate, ORIGINS[candidate.slot]!, CAMERA), candidate);
      const rotations: readonly [number, number][] = [
        [middle.rotX, end.rotX],
        [middle.rotY, end.rotY],
        [middle.rotZ, end.rotZ],
      ];
      for (const [mid, finish] of rotations) {
        expect(Math.abs(finish)).toBeGreaterThan(Math.PI * 0.45);
        expect(Math.abs(finish)).toBeLessThan(Math.PI * 2.2);
        expect(Math.abs(mid)).toBeGreaterThan(Math.abs(finish - mid));
      }
    }
    expect(new Set(variants.map((candidate) => Math.sign(candidate.turns[0]))).size).toBe(2);
  });

  it('places the launch point in front of the CRT plane', () => {
    expect(safeEjectDepth(-2, 0.5)).toBe(0.5);
    expect(safeEjectDepth(0.8, 0.5)).toBe(0.8);
  });
});
