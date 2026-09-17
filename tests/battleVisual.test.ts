import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cellKey, cellStates, type CellInputs } from '../src/render/cellStates';
import { bayer4, paletteIndex, signal } from '../src/render/palette';
import { fitView } from '../src/render/viewCamera';

describe('palette', () => {
  it('has a 4×4 Bayer matrix with 16 distinct steps', () => {
    const values = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) values.add(Math.round(bayer4(x, y) * 16));
    expect([...values].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    expect(bayer4(5, 6)).toBe(bayer4(1, 2));
  });

  it('maps signals to flat palette colours', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(paletteIndex(0, 1, 0, x, y)).toBe(1);
        expect(paletteIndex(1, 0, 0, x, y)).toBe(2);
        expect(paletteIndex(0, 0, 1, x, y)).toBe(3);
        expect(paletteIndex(0, 0, 0, x, y)).toBe(0);
      }
    }
  });

  it('dithers partial brightness in proportion', () => {
    let lit = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (paletteIndex(0, 0.5, 0, x, y)) lit++;
    expect(lit).toBe(8);
  });

  it('prefers accent, then red, when channels tie', () => {
    expect(paletteIndex(1, 1, 1, 0, 0)).toBe(3);
    expect(paletteIndex(1, 1, 0, 0, 0)).toBe(2);
  });

  it('builds signal colours on one channel', () => {
    expect(signal('red', 0.5).toArray()).toEqual([0.5, 0, 0]);
    expect(signal('phosphor', 2).toArray()).toEqual([0, 1, 0]);
    expect(signal('accent').toArray()).toEqual([0, 0, 1]);
  });
});

function inputs(over: Partial<CellInputs> = {}): CellInputs {
  return {
    cols: 3,
    rows: 6,
    tick: 100,
    player: { x: 1, y: 4 },
    danger: [],
    attacks: new Map(),
    spawns: new Map(),
    overrides: new Map(),
    attackTicks: 9,
    afterTicks: 12,
    spawnTicks: 36,
    ...over,
  };
}

describe('cellStates', () => {
  const k = (x: number, y: number) => cellKey(x, y, 3);

  it('marks the player cell ACTIVE and the rest NORMAL', () => {
    const s = cellStates(inputs());
    expect(s[k(1, 4)]!.state).toBe('ACTIVE');
    expect(s.filter((c) => c.state === 'NORMAL')).toHaveLength(17);
  });

  it('shows telegraphs, attacks and their afterglow', () => {
    const s = cellStates(
      inputs({
        danger: [{ x: 0, y: 3 }],
        attacks: new Map([
          [k(1, 1), { tick: 95, tone: 'accent' }],
          [k(2, 1), { tick: 85, tone: 'red' }],
          [k(0, 0), { tick: 50, tone: 'red' }],
        ]),
      }),
    );
    expect(s[k(0, 3)]!.state).toBe('DANGER');
    expect(s[k(1, 1)]).toEqual({ state: 'ATTACK', tone: 'accent', age: 5 });
    expect(s[k(2, 1)]).toEqual({ state: 'AFTER', tone: 'red', age: 6 });
    expect(s[k(0, 0)]!.state).toBe('NORMAL');
  });

  it('applies the priority order', () => {
    const s = cellStates(
      inputs({
        danger: [{ x: 1, y: 4 }, { x: 2, y: 2 }],
        attacks: new Map([[k(2, 2), { tick: 99, tone: 'red' }]]),
        spawns: new Map([[k(0, 0), 10]]),
        overrides: new Map([
          [k(0, 5), 'EMPTY'],
          [k(2, 2), 'BROKEN'],
          [k(1, 3), 'OBJECT'],
        ]),
      }),
    );
    expect(s[k(1, 4)]!.state).toBe('DANGER'); // danger beats the player highlight
    expect(s[k(2, 2)]!.state).toBe('BROKEN'); // debug break beats an attack
    expect(s[k(0, 5)]!.state).toBe('EMPTY');
    expect(s[k(0, 0)]).toEqual({ state: 'SPAWN', tone: null, age: 10 });
    expect(s[k(1, 3)]!.state).toBe('OBJECT');
  });

  it('ends spawn markers after their time and ignores future ones', () => {
    expect(cellStates(inputs({ spawns: new Map([[0, 40]]) }))[0]!.state).toBe('NORMAL');
    expect(cellStates(inputs({ spawns: new Map([[0, -1]]) }))[0]!.state).toBe('NORMAL');
  });
});

describe('fitView', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1.6, 0, -2.4), new THREE.Vector3(1.6, 1.1, 2.4));
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));

  for (const pitch of [20, 28, 45]) {
    it(`fits and centres the field at ${pitch}°`, () => {
      const cam = new THREE.PerspectiveCamera();
      fitView(cam, corners, { pitchDeg: pitch, fovDeg: 40, aspect: 0.75, fill: 0.92 });
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(cam);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      expect(Math.max(-minX, maxX, -minY, maxY)).toBeLessThanOrEqual(0.93);
      expect(Math.max(maxX - minX, maxY - minY) / 2).toBeGreaterThan(0.85);
      expect(Math.abs(minX + maxX)).toBeLessThan(0.05);
      expect(Math.abs(minY + maxY)).toBeLessThan(0.05);
      // Looking into the field: the near edge (+z) is lower on screen than the far edge.
      const near = new THREE.Vector3(0, 0, 2.4).project(cam);
      const far = new THREE.Vector3(0, 0, -2.4).project(cam);
      expect(near.y).toBeLessThan(far.y);
      // Perspective: the near row is wider than the far row.
      const nearW = new THREE.Vector3(1.6, 0, 2.4).project(cam).x - new THREE.Vector3(-1.6, 0, 2.4).project(cam).x;
      const farW = new THREE.Vector3(1.6, 0, -2.4).project(cam).x - new THREE.Vector3(-1.6, 0, -2.4).project(cam).x;
      expect(nearW).toBeGreaterThan(farW * 1.3);
    });
  }
});
