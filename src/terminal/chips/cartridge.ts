import * as THREE from 'three';
import type { ChipCode, ChipId } from '../../data/chips';
import { drawText, measureText, type PixelSink } from '../crt/pixelFont';
import { chipFaceTexture, FACE_CUT, FACE_H, FACE_W } from './chipFace';
import { CHIP_TEXELS_H, CHIP_TEXELS_W } from './railLayout';

// A chip cartridge mesh (spec §9.1): a thick bevelled body with the top-right
// corner cut like an SD card, a pixel face, a metal clip and a glow frame.

/** Body thickness as a share of the cartridge width. */
export const CART_DEPTH_RATIO = 0.22;

const BEVEL_SIZE = 0.03;

/** Unit body outline: a rectangle with the top-right corner cut off. */
function bodyShape(): THREE.Shape {
  // Inset by the bevel, which grows the outline back out to ±0.5.
  const e = 0.5 - BEVEL_SIZE;
  const cx = (FACE_CUT / FACE_W) * 2 * e;
  const cy = (FACE_CUT / FACE_H) * 2 * e;
  const s = new THREE.Shape();
  s.moveTo(-e, -e);
  s.lineTo(e, -e);
  s.lineTo(e, e - cy);
  s.lineTo(e - cx, e);
  s.lineTo(-e, e);
  s.closePath();
  return s;
}

function bodyGeometry(): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(bodyShape(), {
    depth: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: BEVEL_SIZE,
    bevelThickness: 0.12,
    curveSegments: 1,
  });
  // The bevel spills past both ends of the extrusion, so the raw geometry is
  // deeper than 1. Normalise it to exactly -0.5..0.5 or the front face ends up
  // in front of the chip face and hides it.
  g.computeBoundingBox();
  const box = g.boundingBox as THREE.Box3;
  const depth = box.max.z - box.min.z;
  g.translate(0, 0, -(box.min.z + depth / 2));
  g.scale(1, 1, 1 / depth);
  return g;
}

const COLOR = {
  body: 0x3a3833,
  clip: 0x8a8578,
  glow: 0x55ff66,
  flight: 0x4a4639,
  order: '#0a0c0e',
  orderBack: '#55ff66',
};

/** Badge textures for the Attack Queue position, cached per digit. */
const orderCache = new Map<number, THREE.CanvasTexture>();

function orderTexture(n: number): THREE.CanvasTexture {
  const hit = orderCache.get(n);
  if (hit) return hit;
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = COLOR.orderBack;
  ctx.fillRect(0, 0, size, size);
  const text = String(n);
  drawText(ctx as unknown as PixelSink, text, Math.round((size - measureText(text, 2)) / 2), 1, 2, COLOR.order);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  orderCache.set(n, tex);
  return tex;
}

const shared = {
  box: new THREE.BoxGeometry(1, 1, 1),
  body: bodyGeometry(),
  plane: new THREE.PlaneGeometry(1, 1),
  bodyMat: new THREE.MeshLambertMaterial({ color: COLOR.body, flatShading: true }),
  /** In flight the cartridge leaves the lit rail: it glows faintly so it reads as a solid object. */
  flightMat: new THREE.MeshLambertMaterial({ color: COLOR.body, emissive: COLOR.flight, flatShading: true }),
  clipMat: new THREE.MeshLambertMaterial({ color: COLOR.clip, flatShading: true }),
  glowMat: new THREE.MeshBasicMaterial({ color: COLOR.glow }),
};

/** The shared glow material (its colour may be animated). */
export const cartridgeGlow = shared.glowMat;

export class Cartridge {
  readonly object = new THREE.Group();
  readonly faceMat: THREE.MeshBasicMaterial;
  readonly glow: THREE.Mesh;
  private readonly body: THREE.Mesh;
  private readonly face: THREE.Mesh;
  private readonly clip: THREE.Mesh;
  /** Attack Queue position badge; hidden at 0. */
  private readonly order: THREE.Mesh;
  private readonly orderMat: THREE.MeshBasicMaterial;
  private shownOrder = 0;

  constructor(
    readonly defId: ChipId,
    readonly code: ChipCode,
  ) {
    // alphaTest, not blending: the cut corner is punched out of the texture and
    // must not draw at all (blending would sort badly against the body).
    this.faceMat = new THREE.MeshBasicMaterial({
      map: chipFaceTexture(defId, code),
      alphaTest: 0.5,
    });
    this.body = new THREE.Mesh(shared.body, shared.bodyMat);
    this.face = new THREE.Mesh(shared.plane, this.faceMat);
    this.clip = new THREE.Mesh(shared.box, shared.clipMat);
    this.glow = new THREE.Mesh(shared.box, shared.glowMat);
    this.glow.visible = false;
    this.orderMat = new THREE.MeshBasicMaterial({ transparent: true });
    this.order = new THREE.Mesh(shared.plane, this.orderMat);
    this.order.visible = false;
    this.object.add(this.glow, this.body, this.face, this.clip, this.order);
  }

  /** Sizes the parts: `texel` = world size of one render pixel; `maxH` caps the height. */
  shape(texel: number, maxH = Infinity): void {
    const w = CHIP_TEXELS_W * texel;
    const h = Math.min(CHIP_TEXELS_H * texel, maxH);
    const depth = w * CART_DEPTH_RATIO;
    const faceScale = Math.min(1, (h - 4 * texel) / (FACE_H * texel));
    this.body.scale.set(w, h, depth);
    this.face.scale.set(FACE_W * texel * faceScale, FACE_H * texel * faceScale, 1);
    this.face.position.set(0, 0, depth / 2 + 0.002);
    // The clip sits left of the cut corner so it does not float over the notch.
    this.clip.scale.set(w * 0.34, 3 * texel, depth * 1.1);
    this.clip.position.set(-w * 0.12, h / 2 - 1.5 * texel, 0);
    this.glow.scale.set(w + 4 * texel, h + 4 * texel, depth * 0.6);
    // Bottom-left corner, clear of the cut and the code plaque.
    const badge = 14 * texel;
    this.order.scale.set(badge, badge, 1);
    this.order.position.set(-w / 2 + badge * 0.7, -h / 2 + badge * 0.7, depth / 2 + 0.01);
  }

  /** Shows the Attack Queue position, or hides the badge at 0 (GDD §7.2). */
  /** Ejected: the body lights itself, the rail's lights no longer reach it. */
  setFlying(on: boolean): void {
    this.body.material = on ? shared.flightMat : shared.bodyMat;
  }

  setOrder(n: number): void {
    if (n === this.shownOrder) return;
    this.shownOrder = n;
    this.order.visible = n > 0;
    if (n > 0) this.orderMat.map = orderTexture(n);
  }

  dispose(): void {
    this.faceMat.dispose();
    this.orderMat.dispose();
  }
}
