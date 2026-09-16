import * as THREE from 'three';

export interface FitRegion {
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Screen area (CSS px) where the field must fit. */
  top: number;
  regionHeight: number;
  /** Fraction of the region the field may occupy (leaves padding). */
  fill: number;
}

/**
 * Tilted orthographic camera looking at the field center.
 * `fit` adjusts the frustum so the given world-space bounds land inside the
 * screen region, whatever the aspect ratio.
 */
export class FieldCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly corners: THREE.Vector3[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private bounds: THREE.Box3) {
    for (let i = 0; i < 8; i++) this.corners.push(new THREE.Vector3());
  }

  setTilt(tiltDeg: number, target: THREE.Vector3): void {
    const tilt = THREE.MathUtils.degToRad(tiltDeg);
    const distance = 20;
    // Camera sits "behind" the player side (+z) and above, looking at the target.
    this.camera.position.set(
      target.x,
      target.y + distance * Math.cos(tilt),
      target.z + distance * Math.sin(tilt),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
  }

  fit(region: FitRegion): void {
    const { min, max } = this.bounds;
    let i = 0;
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) (this.corners[i++] as THREE.Vector3).set(x, y, z);

    const view = this.camera.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of this.corners) {
      this.tmp.copy(c).applyMatrix4(view);
      minX = Math.min(minX, this.tmp.x);
      maxX = Math.max(maxX, this.tmp.x);
      minY = Math.min(minY, this.tmp.y);
      maxY = Math.max(maxY, this.tmp.y);
    }

    const fieldW = maxX - minX;
    const fieldH = maxY - minY;
    const w = Math.max(1, region.width);
    const h = Math.max(1, region.height);
    const regionH = Math.max(1, region.regionHeight);
    // World units per CSS pixel.
    const s = Math.max(fieldW / (w * region.fill), fieldH / (regionH * region.fill));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const screenCy = region.top + regionH / 2;

    this.camera.left = cx - (w / 2) * s;
    this.camera.right = cx + (w / 2) * s;
    this.camera.top = cy + screenCy * s;
    this.camera.bottom = this.camera.top - h * s;
    this.camera.updateProjectionMatrix();
  }
}
