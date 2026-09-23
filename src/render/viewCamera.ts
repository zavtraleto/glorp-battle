import * as THREE from 'three';

// Perspective battle camera (BATTLE_VISUAL.md §3): behind the player side, low,
// looking along the field into depth. Field rows with larger y are nearer (+z).

export interface ViewParams {
  pitchDeg: number;
  fovDeg: number;
  aspect: number;
  /** Share of the frame (NDC half-extent) the field may occupy. */
  fill: number;
  /** Where the field is centred horizontally, in NDC. */
  offsetX?: number;
  /** Where the field is centred vertically, NDC: negative drops it below the HUD band. */
  offsetY: number;
}

const OUTER = 5;
const BISECT = 32;

/** Places `camera` so every point is inside the frame, filling `fill`, centred on `offsetY`. */
export function fitView(camera: THREE.PerspectiveCamera, points: readonly THREE.Vector3[], p: ViewParams): void {
  const pitch = THREE.MathUtils.degToRad(p.pitchDeg);
  const forward = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const center = new THREE.Vector3();
  for (const v of points) center.add(v);
  center.divideScalar(Math.max(1, points.length));

  camera.fov = p.fovDeg;
  camera.aspect = p.aspect;
  camera.near = 0.05;
  camera.far = 500;
  camera.updateProjectionMatrix();

  const up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const offset = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  const tanV = Math.tan(THREE.MathUtils.degToRad(p.fovDeg) / 2);

  const place = (dist: number) => {
    camera.position
      .copy(center)
      .addScaledVector(forward, -dist)
      .addScaledVector(right, offset.x)
      .addScaledVector(up, offset.y);
    camera.lookAt(tmp.copy(camera.position).add(forward));
    camera.updateMatrixWorld(true);
  };
  const bounds = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of points) {
      tmp.copy(v).project(camera);
      minX = Math.min(minX, tmp.x);
      maxX = Math.max(maxX, tmp.x);
      minY = Math.min(minY, tmp.y);
      maxY = Math.max(maxY, tmp.y);
    }
    return { minX, maxX, minY, maxY };
  };

  let dist = 10;
  for (let outer = 0; outer < OUTER; outer++) {
    let lo = 0.5;
    let hi = 200;
    for (let i = 0; i < BISECT; i++) {
      dist = (lo + hi) / 2;
      place(dist);
      const b = bounds();
      const extent = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
      // Points behind the camera project wildly: treat as "too close".
      if (!Number.isFinite(extent) || extent > p.fill || behind(camera, points)) lo = dist;
      else hi = dist;
    }
    dist = hi;
    place(dist);
    const b = bounds();
    // Shift sideways/up so the field sits in the middle of the frame.
    offset.x += ((b.minX + b.maxX) / 2 - (p.offsetX ?? 0)) * dist * tanV * p.aspect;
    offset.y += ((b.minY + b.maxY) / 2 - p.offsetY) * dist * tanV;
  }
  place(dist);
}

function behind(camera: THREE.PerspectiveCamera, points: readonly THREE.Vector3[]): boolean {
  const v = new THREE.Vector3();
  for (const pt of points) {
    v.copy(pt).applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -camera.near) return true;
  }
  return false;
}
