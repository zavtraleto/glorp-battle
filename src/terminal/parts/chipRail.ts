import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { tuning } from '../../config/tuning';
import type { ChipCode, ChipId } from '../../data/chips';
import { Spring } from '../anim/spring';
import { chipFaceTexture, FACE_H, FACE_W } from '../chips/chipFace';
import { activeSlot, planRail } from '../chips/railPlan';
import { rectToWorld, type TerminalLayout } from '../layout';

// Chip rail (TERMINAL.md §6.3, §6.5): five slots with contacts and chip
// cartridges. Used chips eject toward the camera, unused ones are thrown out
// when the Custom Screen opens, confirmed ones drop into place.

export const RAIL_SLOTS = 5;

export interface RailChip {
  uid: number;
  defId: ChipId;
  code: ChipCode;
}

type Phase = 'load' | 'idle' | 'eject' | 'burn';

interface Cart {
  uid: number;
  object: THREE.Group;
  faceMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  slot: number;
  phase: Phase;
  t: number;
  delay: number;
  lift: Spring;
  origin: THREE.Vector3;
  drift: number;
  spin: number;
}

const COLOR = {
  frame: 0x1c1d1f,
  body: 0x3a3833,
  clip: 0x8a8578,
  glow: new THREE.Color(0x55ff66),
  contactOff: new THREE.Color(0x8a7a4a),
  contactOn: new THREE.Color(0xffe9a8),
  faceActive: new THREE.Color(0xffffff),
  faceIdle: new THREE.Color(0x9a9a9a),
  faceBurnt: new THREE.Color(0x2a1a14),
};

/** Slots span this share of the rail width, starting at RAIL_LEFT from its centre. */
const RAIL_SPAN = 0.82;
const RAIL_LEFT = 0.475;
const BODY_DEPTH = 0.22;
const REST_Z = 0.14;
/** Eject: height of the pop and how far the chip flies (world units). */
const EJECT_POP = 0.25;
const EJECT_TOWARD = 5;
const EJECT_DROP = 2.5;
/** Eject: forward tilt at the end of the flight (radians); the face stays readable. */
const EJECT_TILT = 0.8;
/** Burn: launch speed and gravity (world units per s / s²). */
const BURN_UP = 3;
const BURN_GRAVITY = 30;
const LOAD_HEIGHT = 1.2;
const GLOW_PULSE_HZ = 2;

function contactTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 29;
  canvas.height = 5;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) ctx.fillRect(1 + i * 5, 0, 3, 5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export class ChipRail {
  readonly group = new THREE.Group();
  private readonly statics = new THREE.Group();
  private slots: (number | null)[] = new Array<number | null>(RAIL_SLOTS).fill(null);
  private carts: Cart[] = [];
  private slotPos: THREE.Vector3[] = [];
  private contacts: { mat: THREE.MeshBasicMaterial; left: number }[] = [];
  private chipW = 1;
  private chipH = 1;
  private texel = 0.02;
  private time = 0;
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly bodyGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.08);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);
  private readonly frameMat = new THREE.MeshLambertMaterial({ color: COLOR.frame, flatShading: true });
  private readonly bodyMat = new THREE.MeshLambertMaterial({ color: COLOR.body, flatShading: true });
  private readonly clipMat = new THREE.MeshLambertMaterial({ color: COLOR.clip, flatShading: true });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: COLOR.glow.clone() });
  private readonly contactTex = contactTexture();

  constructor() {
    this.group.add(this.statics);
  }

  build(layout: TerminalLayout, texel: number): void {
    this.statics.clear();
    for (const c of this.contacts) c.mat.dispose();
    this.contacts = [];
    this.texel = texel;
    const rail = rectToWorld(layout, layout.rail);
    const slotW = (rail.w * RAIL_SPAN) / RAIL_SLOTS;
    this.chipW = (FACE_W + 2) * texel;
    this.chipH = Math.min((FACE_H + 6) * texel, rail.h * 0.86);
    this.slotPos = [];
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const x = rail.cx - rail.w * RAIL_LEFT + slotW * (i + 0.5);
      const pos = new THREE.Vector3(x, rail.cy, REST_Z);
      this.slotPos.push(pos);
      const frame = new THREE.Mesh(this.unitBox, this.frameMat);
      frame.position.set(x, rail.cy, 0.02);
      frame.scale.set(this.chipW + 4 * texel, this.chipH + 4 * texel, 0.1);
      this.statics.add(frame);
      const mat = new THREE.MeshBasicMaterial({ map: this.contactTex, color: COLOR.contactOff.clone(), transparent: true });
      const pad = new THREE.Mesh(this.unitPlane, mat);
      pad.position.set(x, rail.cy - this.chipH * 0.3, 0.075);
      pad.scale.set(this.chipW * 0.8, 10 * texel, 1);
      this.statics.add(pad);
      this.contacts.push({ mat, left: 0 });
    }
    for (const c of this.carts) this.shape(c);
  }

  /** Brings the rail in line with the queue. `burning`: the Custom Screen is open. */
  sync(queue: readonly RailChip[], burning: boolean): void {
    const plan = planRail(
      this.slots,
      queue.map((c) => c.uid),
      burning,
    );
    if (plan.remove.length === 0 && plan.add.length === 0) return;
    let burnIndex = 0;
    for (const r of plan.remove) {
      const cart = this.carts.find((c) => c.slot === r.slot);
      this.slots[r.slot] = null;
      if (!cart) continue;
      cart.origin.copy(cart.object.position);
      cart.slot = -1;
      cart.t = 0;
      cart.phase = r.how;
      cart.drift = (r.slot - 2) * 0.15;
      cart.spin = r.how === 'burn' ? (burnIndex % 2 === 0 ? 1 : -1) * (1 + burnIndex * 0.3) : 0.4;
      cart.delay = r.how === 'burn' ? burnIndex++ * tuning.terminal.BURN_STAGGER : 0;
      cart.glow.visible = false;
      if (r.how === 'eject') this.flashContacts(r.slot);
    }
    plan.add.forEach((a, i) => {
      const chip = queue.find((c) => c.uid === a.uid);
      if (!chip) return;
      this.slots[a.slot] = a.uid;
      this.carts.push(this.makeCart(chip, a.slot, i * tuning.terminal.LOAD_STAGGER));
    });
  }

  /** Drops every cartridge instantly (a new World started). */
  reset(): void {
    for (const c of this.carts) this.removeCart(c);
    this.carts = [];
    this.slots = new Array<number | null>(RAIL_SLOTS).fill(null);
  }

  update(dt: number): void {
    const t = tuning.terminal;
    this.time += dt;
    const active = activeSlot(this.slots);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * Math.PI * 2 * GLOW_PULSE_HZ);
    this.glowMat.color.copy(COLOR.glow).multiplyScalar(pulse);

    for (const c of [...this.carts]) {
      c.t += dt;
      const o = c.object;
      switch (c.phase) {
        case 'load': {
          const rest = this.slotPos[c.slot] as THREE.Vector3;
          o.visible = c.t >= c.delay;
          const k = t.LOAD_TIME > 0 ? Math.min(1, Math.max(0, (c.t - c.delay) / t.LOAD_TIME)) : 1;
          o.position.set(rest.x, rest.y, rest.z + (1 - k) * (1 - k) * LOAD_HEIGHT);
          o.scale.setScalar(0.7 + 0.3 * k);
          if (k >= 1) {
            c.phase = 'idle';
            c.lift.snap(0);
            this.flashContacts(c.slot);
          }
          break;
        }
        case 'idle': {
          const rest = this.slotPos[c.slot] as THREE.Vector3;
          const isActive = c.slot === active;
          c.lift.target = isActive ? t.CHIP_ACTIVE_LIFT : 0;
          c.lift.step(dt, t.SPRING_STIFFNESS, t.SPRING_DAMPING);
          o.position.set(rest.x, rest.y + c.lift.value * 0.4, rest.z + c.lift.value);
          o.scale.setScalar(1);
          c.glow.visible = isActive;
          c.faceMat.color.copy(isActive ? COLOR.faceActive : COLOR.faceIdle);
          break;
        }
        case 'eject': {
          const lt = t.EJECT_LIFT_TIME;
          if (c.t < lt) {
            o.position.z = c.origin.z + EJECT_POP * (c.t / lt);
            break;
          }
          const p = t.EJECT_TIME > 0 ? (c.t - lt) / t.EJECT_TIME : 1;
          if (p >= 1) {
            this.dropCart(c);
            break;
          }
          o.position.set(
            c.origin.x + c.drift * p,
            c.origin.y - EJECT_DROP * p * p,
            c.origin.z + EJECT_POP + EJECT_TOWARD * p * p,
          );
          o.rotation.set(-EJECT_TILT * p, 0, c.spin * p);
          o.scale.setScalar(1 + 0.8 * p);
          c.faceMat.color.copy(COLOR.faceActive);
          break;
        }
        case 'burn': {
          const tt = c.t - c.delay;
          if (tt < 0) break;
          if (tt >= t.BURN_TIME) {
            this.dropCart(c);
            break;
          }
          o.position.set(
            c.origin.x + c.drift * tt,
            c.origin.y + BURN_UP * tt - 0.5 * BURN_GRAVITY * tt * tt,
            c.origin.z + Math.min(1, tt * 5) * 0.4,
          );
          o.rotation.set(0, 0, c.spin * tt * 4);
          c.faceMat.color.copy(COLOR.faceIdle).lerp(COLOR.faceBurnt, Math.min(1, tt / t.BURN_TIME));
          break;
        }
      }
    }

    const flash = t.CONTACT_FLASH_TIME;
    for (const ct of this.contacts) {
      ct.left = Math.max(0, ct.left - dt);
      ct.mat.color.copy(COLOR.contactOff).lerp(COLOR.contactOn, flash > 0 ? ct.left / flash : 0);
    }
  }

  private flashContacts(slot: number): void {
    const c = this.contacts[slot];
    if (c) c.left = tuning.terminal.CONTACT_FLASH_TIME;
  }

  private makeCart(chip: RailChip, slot: number, delay: number): Cart {
    const object = new THREE.Group();
    const faceMat = new THREE.MeshBasicMaterial({ map: chipFaceTexture(chip.defId, chip.code), color: COLOR.faceIdle.clone() });
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    const face = new THREE.Mesh(this.unitPlane, faceMat);
    const clip = new THREE.Mesh(this.unitBox, this.clipMat);
    const glow = new THREE.Mesh(this.unitBox, this.glowMat);
    body.name = 'body';
    face.name = 'face';
    clip.name = 'clip';
    glow.name = 'glow';
    glow.visible = false;
    object.add(glow, body, face, clip);
    const cart: Cart = {
      uid: chip.uid,
      object,
      faceMat,
      glow,
      slot,
      phase: 'load',
      t: 0,
      delay,
      lift: new Spring(0),
      origin: new THREE.Vector3(),
      drift: 0,
      spin: 0,
    };
    this.shape(cart);
    object.visible = false;
    this.group.add(object);
    return cart;
  }

  /** Sizes a cartridge's parts to the current texel size. */
  private shape(c: Cart): void {
    const tx = this.texel;
    const w = this.chipW;
    const h = this.chipH;
    const faceScale = Math.min(1, (h - 6 * tx) / (FACE_H * tx));
    for (const child of c.object.children) {
      switch (child.name) {
        case 'body':
          child.scale.set(w, h, BODY_DEPTH);
          break;
        case 'face':
          child.scale.set(FACE_W * tx * faceScale, FACE_H * tx * faceScale, 1);
          child.position.set(0, -tx, BODY_DEPTH / 2 + 0.002);
          break;
        case 'clip':
          child.scale.set(w * 0.4, 3 * tx, BODY_DEPTH * 1.1);
          child.position.set(0, h / 2 - 1.5 * tx, 0);
          break;
        case 'glow':
          child.scale.set(w + 4 * tx, h + 4 * tx, BODY_DEPTH * 0.6);
          break;
      }
    }
  }

  private dropCart(c: Cart): void {
    this.removeCart(c);
    this.carts = this.carts.filter((x) => x !== c);
  }

  private removeCart(c: Cart): void {
    this.group.remove(c.object);
    c.faceMat.dispose();
  }
}
