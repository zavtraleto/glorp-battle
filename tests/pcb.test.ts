import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Pcb } from '../src/terminal/parts/pcb';

interface TraceSpan {
  first: number;
  count: number;
}

function horizontalLevels(pcb: Pcb, slot: number): number[] {
  const internals = pcb as unknown as { mesh: THREE.InstancedMesh; down: TraceSpan[] };
  const trace = internals.down[slot]!;
  const matrix = new THREE.Matrix4();
  const levels: number[] = [];
  for (let i = 0; i < trace.count; i++) {
    internals.mesh.getMatrixAt(trace.first + i, matrix);
    const e = matrix.elements;
    if (Math.abs(e[1]!) < 1e-6) levels.push(e[13]!);
  }
  return levels;
}

describe('PCB chip-to-ring routes', () => {
  it('uses a straight centre trace and two clearly separated lower bus levels', () => {
    const pcb = new Pcb();
    const slots = [-2, -1, 0, 1, 2].map((x) => ({ x, top: 1.5, bottom: 1 }));
    pcb.build(slots, 0, -1, 0.5, 2);

    const internals = pcb as unknown as { mesh: THREE.InstancedMesh; down: TraceSpan[] };
    const matrix = new THREE.Matrix4();
    const centre = internals.down[2]!;
    for (let i = 0; i < centre.count; i++) {
      internals.mesh.getMatrixAt(centre.first + i, matrix);
      expect(matrix.elements[12]).toBeCloseTo(0, 6);
    }

    const inner = Math.max(...horizontalLevels(pcb, 1));
    const outer = Math.max(...horizontalLevels(pcb, 0));
    expect(inner - outer).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...horizontalLevels(pcb, 3))).toBeCloseTo(inner, 6);
    expect(Math.max(...horizontalLevels(pcb, 4))).toBeCloseTo(outer, 6);
  });
});
