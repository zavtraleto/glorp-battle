import * as THREE from 'three';
import type { ChipCode, ChipId } from '../../data/chips';
import { cartridgeBackTexture, chipFaceTexture, FACE_H, FACE_W } from './chipFace';
import { CHIP_TEXELS_H, CHIP_TEXELS_W } from './railLayout';

// A chip cartridge (TERMINAL.md §6.1, simplified 2026-09-20): one extruded
// prism — a rectangle whose bottom-left corner is cut off by a real diagonal —
// and nothing else. No bevels, no ribs, no recess step: at the size a cartridge
// gets on screen those were sub-pixel detail that only cost triangles, and they
// belong in the texture. The contacts are the one piece of detail geometry.
//
// The lit states are the same geometry with a different emissive on the body.
// There is no halo and no outline glow: the light only ever comes from inside
// the plastic. The face is unlit on purpose, so the label and the icon keep
// their brightness whatever the cabinet's lighting does.

/** Body thickness as a share of the cartridge width (32 : 190 on the model sheet). */
export const CART_DEPTH_RATIO = 0.17;

/** The bottom band that carries the contacts, share of the body height. */
const STRIP_H = 14 / CHIP_TEXELS_H;
/** Bottom-left diagonal: equal in texels both ways, so it cuts at 45°. */
const CUT_W = 16 / CHIP_TEXELS_W;
const CUT_H = 16 / CHIP_TEXELS_H;
/**
 * Contacts: five plates, one per place in the Attack Queue (decision
 * 2026-09-20) — the queue position is read off how many of them are lit.
 */
const CONTACTS = 5;
const CONTACT_FILL = 0.62;
const CONTACT_DEPTH = 0.16;

const COLOR = {
  body: 0xa39d90,
  contactOff: 0x4a4a2e,
  contactOn: 0xffe9a8,
};

/** The whole silhouette: a rectangle with the bottom-left corner cut off. */
function bodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5 + CUT_W, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.lineTo(-0.5, -0.5 + CUT_H);
  s.closePath();
  return s;
}

function bodyGeometry(): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(bodyShape(), { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.5);
  return g;
}

const shared = {
  body: bodyGeometry(),
  contact: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  contactMat: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};

export class Cartridge {
  readonly object = new THREE.Group();
  readonly faceMat: THREE.MeshBasicMaterial;
  readonly bodyMat: THREE.MeshLambertMaterial;
  private readonly body: THREE.Mesh;
  private readonly face: THREE.Mesh;
  private readonly back: THREE.Mesh;
  private readonly contacts: THREE.InstancedMesh;
  private readonly baseBody = new THREE.Color(COLOR.body);
  private readonly c = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private shownLit = -1;

  constructor(
    readonly defId: ChipId,
    readonly code: ChipCode,
  ) {
    this.bodyMat = new THREE.MeshLambertMaterial({ color: COLOR.body, flatShading: true });
    // Unlit on purpose: the label's brightness is decided by the rail's tint
    // alone, never by the cabinet's lights (spec §6.1, decision 2026-09-20).
    this.faceMat = new THREE.MeshBasicMaterial({ map: chipFaceTexture(defId, code) });
    this.body = new THREE.Mesh(shared.body, this.bodyMat);
    this.face = new THREE.Mesh(shared.plane, this.faceMat);
    this.back = new THREE.Mesh(shared.plane, new THREE.MeshBasicMaterial({ map: cartridgeBackTexture() }));
    this.back.rotation.y = Math.PI;
    this.back.visible = false;
    this.contacts = new THREE.InstancedMesh(shared.contact, shared.contactMat, CONTACTS);
    this.object.add(this.body, this.face, this.back, this.contacts);
  }

  /** Sizes the parts: `texel` = world size of one render pixel; `maxH` caps the height. */
  shape(texel: number, maxH = Infinity): void {
    const w = CHIP_TEXELS_W * texel;
    const h = Math.min(CHIP_TEXELS_H * texel, maxH);
    const depth = w * CART_DEPTH_RATIO;
    this.body.scale.set(w, h, depth);
    // The face fills the front above the contact strip, leaving only a couple
    // of texels of plastic as a frame (spec §6.1: no wide grey field).
    const faceScale = Math.min(1, (h * (1 - STRIP_H) - 4 * texel) / (FACE_H * texel));
    const faceY = h * (STRIP_H / 2);
    this.face.scale.set(FACE_W * texel * faceScale, FACE_H * texel * faceScale, 1);
    this.face.position.set(0, faceY, depth / 2 + 0.002);
    this.back.scale.copy(this.face.scale);
    this.back.position.set(0, faceY, -depth / 2 - 0.002);
    // Contacts across the bottom strip, clear of the cut corner.
    const left = -0.5 + CUT_W + 0.03;
    const pitch = (0.45 - left) / CONTACTS;
    const plateW = pitch * CONTACT_FILL * w;
    const plateH = STRIP_H * 0.6 * h;
    const plateD = depth * CONTACT_DEPTH;
    const y = (-0.5 + STRIP_H / 2) * h;
    for (let i = 0; i < CONTACTS; i++) {
      this.m.makeScale(plateW, plateH, plateD);
      this.m.setPosition((left + pitch * (i + 0.5)) * w, y, depth / 2);
      this.contacts.setMatrixAt(i, this.m);
    }
    this.contacts.instanceMatrix.needsUpdate = true;
    this.shownLit = -1;
    this.setLitContacts(0);
  }

  /**
   * The light inside the plastic (spec §6.2): `level` 0 leaves the body dead, 1
   * is the full warm glow of a queued chip. Only the body carries it — there is
   * no halo and no outline, and the face is unlit.
   */
  setGlow(color: THREE.Color, level: number): void {
    this.bodyMat.emissive.copy(color).multiplyScalar(level);
  }

  /**
   * Multiplies the plastic and, separately, the face. White leaves the
   * cartridge as it is; a refused chip gets a dark cold `body` and a dimmer
   * `face`, so its panel and label drop back without becoming unreadable —
   * both are scaled together, which keeps the ink-to-panel contrast intact
   * (decision 2026-09-20). Lighting never touches the face: the material is
   * unlit and only this tint moves it.
   */
  setTint(body: THREE.Color, face: THREE.Color): void {
    this.bodyMat.color.copy(this.baseBody).multiply(body);
    this.faceMat.color.copy(face);
  }

  /** Place in the Attack Queue, shown as that many lit contacts (0 = none). */
  setLitContacts(n: number): void {
    if (n === this.shownLit) return;
    this.shownLit = n;
    for (let i = 0; i < CONTACTS; i++) {
      this.c.set(i < n ? COLOR.contactOn : COLOR.contactOff);
      this.contacts.setColorAt(i, this.c);
    }
    if (this.contacts.instanceColor) this.contacts.instanceColor.needsUpdate = true;
  }

  /** Ejected: the back comes into view as the cartridge tumbles. */
  setFlying(on: boolean): void {
    this.back.visible = on;
  }

  dispose(): void {
    this.faceMat.dispose();
    this.bodyMat.dispose();
    (this.back.material as THREE.Material).dispose();
    this.contacts.dispose();
  }
}
