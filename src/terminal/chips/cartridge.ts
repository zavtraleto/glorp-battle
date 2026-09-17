import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ChipCode, ChipId } from '../../data/chips';
import { chipFaceTexture, FACE_H, FACE_W } from './chipFace';
import { CHIP_TEXELS_H, CHIP_TEXELS_W } from './trayLayout';

// A chip cartridge mesh (TERMINAL.md §6.1): rounded body, pixel face, metal
// clip and an optional glow frame. Shared by the rail and the tray.

export const CART_DEPTH = 0.22;

const COLOR = {
  body: 0x3a3833,
  clip: 0x8a8578,
  glow: 0x55ff66,
};

const shared = {
  box: new THREE.BoxGeometry(1, 1, 1),
  body: new RoundedBoxGeometry(1, 1, 1, 1, 0.08),
  plane: new THREE.PlaneGeometry(1, 1),
  bodyMat: new THREE.MeshLambertMaterial({ color: COLOR.body, flatShading: true }),
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

  constructor(
    readonly defId: ChipId,
    readonly code: ChipCode,
    legacyGen?: number,
  ) {
    this.faceMat = new THREE.MeshBasicMaterial({ map: chipFaceTexture(defId, code, legacyGen) });
    this.body = new THREE.Mesh(shared.body, shared.bodyMat);
    this.face = new THREE.Mesh(shared.plane, this.faceMat);
    this.clip = new THREE.Mesh(shared.box, shared.clipMat);
    this.glow = new THREE.Mesh(shared.box, shared.glowMat);
    this.glow.visible = false;
    this.object.add(this.glow, this.body, this.face, this.clip);
  }

  /** Sizes the parts: `texel` = world size of one render pixel; `maxH` caps the height. */
  shape(texel: number, maxH = Infinity): void {
    const w = CHIP_TEXELS_W * texel;
    const h = Math.min(CHIP_TEXELS_H * texel, maxH);
    const faceScale = Math.min(1, (h - 6 * texel) / (FACE_H * texel));
    this.body.scale.set(w, h, CART_DEPTH);
    this.face.scale.set(FACE_W * texel * faceScale, FACE_H * texel * faceScale, 1);
    this.face.position.set(0, -texel, CART_DEPTH / 2 + 0.002);
    this.clip.scale.set(w * 0.4, 3 * texel, CART_DEPTH * 1.1);
    this.clip.position.set(0, h / 2 - 1.5 * texel, 0);
    this.glow.scale.set(w + 4 * texel, h + 4 * texel, CART_DEPTH * 0.6);
  }

  dispose(): void {
    this.faceMat.dispose();
  }
}
