import * as THREE from 'three';
import type { Rect } from '../layout';

// Plan rect → screen rect (spec §3.1). Once mounts are tilted and the camera
// moves, a zone's plan rectangle is no longer where the finger has to land, so
// the four corners are projected through the live camera and the screen-space
// bounding box becomes the hit rect. Cheap enough to redo whenever the camera
// or the layout changes, and it keeps the 2D hit test.

const v = new THREE.Vector3();

/** Screen-space bounding box of the projected corners, in CSS px. */
export function screenBounds(
  corners: readonly THREE.Vector3[],
  camera: THREE.Camera,
  viewW: number,
  viewH: number,
): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    v.copy(c).project(camera);
    const x = ((v.x + 1) / 2) * viewW;
    // NDC y grows up, screen y grows down.
    const y = ((1 - v.y) / 2) * viewH;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * World corners of a plan rect lying on a mount tilted by `tilt` radians about
 * a horizontal line at `pivotY`: the lower edge leans toward the viewer.
 * Matches how Mount transforms its contents, so hit rects follow the geometry.
 */
export function mountCorners(
  rect: { cx: number; cy: number; w: number; h: number },
  tilt: number,
  pivotY: number,
  out: THREE.Vector3[] = [],
): THREE.Vector3[] {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const half = rect.w / 2;
  const top = rect.cy + rect.h / 2;
  const bottom = rect.cy - rect.h / 2;
  const plan: readonly [number, number][] = [
    [rect.cx - half, top],
    [rect.cx + half, top],
    [rect.cx + half, bottom],
    [rect.cx - half, bottom],
  ];
  while (out.length < 4) out.push(new THREE.Vector3());
  plan.forEach(([x, y], i) => {
    const dy = y - pivotY;
    out[i]!.set(x, pivotY + dy * cos, -dy * sin);
  });
  return out;
}
