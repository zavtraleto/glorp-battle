import * as THREE from 'three';

// Dynamic batches: every line or quad of a layer goes into one buffer with
// per-vertex signal colours, so a whole layer is a single draw call.

export class LineBatch {
  readonly object: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private count = 0;

  constructor(private capacity: number) {
    this.pos = new Float32Array(capacity * 2 * 3);
    this.col = new Float32Array(capacity * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.object = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
    this.object.frustumCulled = false;
  }

  begin(): void {
    this.count = 0;
  }

  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Color): void {
    if (this.count >= this.capacity) return;
    const i = this.count * 6;
    this.pos.set([ax, ay, az, bx, by, bz], i);
    this.col.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
    this.count++;
  }

  end(): void {
    const geo = this.object.geometry;
    geo.setDrawRange(0, this.count * 2);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class QuadBatch {
  readonly object: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private count = 0;

  constructor(private capacity: number) {
    this.pos = new Float32Array(capacity * 6 * 3);
    this.col = new Float32Array(capacity * 6 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.object = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, side: THREE.DoubleSide }),
    );
    this.object.frustumCulled = false;
  }

  begin(): void {
    this.count = 0;
  }

  /** Quad from four corners in order (a, b, c, d). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    if (this.count >= this.capacity) return;
    const i = this.count * 18;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z], i);
    for (let v = 0; v < 6; v++) this.col.set([color.r, color.g, color.b], i + v * 3);
    this.count++;
  }

  /** Axis-aligned quad on the field plane (y fixed). */
  flat(cx: number, cz: number, hw: number, hd: number, y: number, color: THREE.Color): void {
    A.set(cx - hw, y, cz - hd);
    B.set(cx + hw, y, cz - hd);
    C.set(cx + hw, y, cz + hd);
    D.set(cx - hw, y, cz + hd);
    this.quad(A, B, C, D, color);
  }

  end(): void {
    const geo = this.object.geometry;
    geo.setDrawRange(0, this.count * 6);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const D = new THREE.Vector3();
